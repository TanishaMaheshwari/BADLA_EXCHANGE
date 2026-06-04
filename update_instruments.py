"""
discover_instruments.py
───────────────────────
Probes the WebSocket server to discover what instruments are available,
then merges them into instrument_settings.json.

Two-phase approach:
  Phase 1 — Listen & probe
    • Connects and listens passively for 15 s to catch any server broadcasts
    • Fires a series of common discovery events (instrument-list, search with
      wildcard, get-all-instruments, etc.) and records every unique response
    • Prints a full map of: event_name → payload shape seen

  Phase 2 — Merge
    • Takes every instrument found in Phase 1
    • Adds new ones to instrument_settings.json (with a skeleton entry)
    • Updates tokens / prices on existing ones

Usage:
    python discover_instruments.py
    python discover_instruments.py /path/to/instrument_settings.json

Tip: Run once with SAVE = False (dry-run) to see what would change,
     then set SAVE = True (default) to actually write the file.
"""

import websocket
import json
import ssl
import time
import threading
import random
import string
import logging
import sys
import os
import copy
from datetime import datetime, UTC
from collections import defaultdict

# ── Config ─────────────────────────────────────────────────────────────────────
WS_URL        = "wss://schart.99sports.games/socket.io/?api_token_temp=android&EIO=3&transport=websocket"
SETTINGS_FILE = "instrument_settings.json"

PASSIVE_LISTEN_SECS = 15   # how long to just listen before probing
PROBE_WAIT_SECS     = 6    # wait after each probe batch
PING_INTERVAL       = 25

SAVE = True   # set False for a dry-run that prints but doesn't write

HEADERS = {
    "Upgrade": "websocket",
    "Origin": "https://badla.dgexch.com",
    "Cache-Control": "no-cache",
    "Accept-Language": "en-US,en;q=0.9",
    "Pragma": "no-cache",
    "Connection": "Upgrade",
    "Sec-WebSocket-Key": "RDe/AiYvXbCu5MuIYdtSfA==",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/133.0.0.0 Safari/537.36"
    ),
    "Sec-WebSocket-Version": "13",
    "Sec-WebSocket-Extensions": "permessage-deflate; client_max_window_bits",
}

# ── Discovery probes ────────────────────────────────────────────────────────────
# Each entry: (event_name, payload_dict | None)
# The script will fire ALL of these and watch for any response event.
PROBE_EVENTS = [
    # Common listing/search patterns — cast a wide net
    ("instrument-list",       {}),
    ("get-all-instruments",   {}),
    ("instruments",           {}),
    ("instrument-search",     {"query": "*",   "search": "*"}),
    ("instrument-search",     {"query": "",    "search": ""}),
    ("instrument-search",     {"query": "NIFTY"}),
    ("instrument-search",     {"query": "BANK"}),
    ("instrument-search",     {"query": "GOLD"}),
    ("instrument-search",     {"query": "CRUDE"}),
    ("instrument-search",     {"query": "SILVER"}),
    ("instrument-search",     {"query": "SGX"}),
    ("search-instrument",     {"query": "*"}),
    ("search-instrument",     {"q": ""}),
    ("get-instruments",       {}),
    ("list-instruments",      {}),
    ("instrument-all",        {}),
    ("all-instruments",       {}),
    ("subscribe-all",         {}),
    ("market-instruments",    {}),
    ("fetch-instruments",     {}),
]

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("discover_instruments")


# ── Helpers ────────────────────────────────────────────────────────────────────
def rand_id(n=5):
    return "".join(random.choices(string.ascii_letters + string.digits, k=n))

def utc_now():
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")

def payload_shape(obj, depth=0):
    """Return a compact description of a payload's key structure."""
    if depth > 3:
        return "..."
    if isinstance(obj, dict):
        parts = []
        for k, v in list(obj.items())[:12]:
            parts.append(f"{k}:{payload_shape(v, depth+1)}")
        suffix = ", ..." if len(obj) > 12 else ""
        return "{" + ", ".join(parts) + suffix + "}"
    if isinstance(obj, list):
        if not obj:
            return "[]"
        return f"[{payload_shape(obj[0], depth+1)} ×{len(obj)}]"
    return type(obj).__name__

def load_settings(path):
    with open(path) as f:
        return json.load(f)

def save_settings(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    log.info(f"Saved → {path}")


# ── WebSocket wrapper ──────────────────────────────────────────────────────────
class WSConn:
    def __init__(self):
        self.ws   = None
        self._stop = threading.Event()

    def connect(self):
        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode    = ssl.CERT_NONE

        self.ws = websocket.create_connection(
            WS_URL, header=HEADERS, sslopt={"context": ssl_ctx}
        )
        msg = self.ws.recv()
        if not msg.startswith("0"):
            raise RuntimeError(f"Unexpected opening frame: {msg!r}")
        log.info("Got '0' (open) → sending '40'")
        self.ws.send("40")

        deadline = time.time() + 6
        while time.time() < deadline:
            msg = self.ws.recv()
            if msg == "40":
                log.info("Namespace connected ✓")
                break
            if msg == "2":
                self.ws.send("3")
        else:
            raise RuntimeError("Namespace connect timed out")

        self._stop.clear()
        threading.Thread(target=self._ping, daemon=True).start()

    def _ping(self):
        while not self._stop.wait(PING_INTERVAL):
            try:
                if self.ws and self.ws.connected:
                    self.ws.send("2")
            except Exception:
                break

    def emit(self, event, payload=None):
        data = [event] if payload is None else [event, payload or {}]
        self.ws.send(f"42{json.dumps(data)}")

    def recv(self, timeout=2.0):
        self.ws.settimeout(timeout)
        return self.ws.recv()

    def close(self):
        self._stop.set()
        try:
            self.ws.close()
        except Exception:
            pass


# ── Discovery engine ───────────────────────────────────────────────────────────
class Discoverer:

    def __init__(self, settings_path=SETTINGS_FILE):
        self.path        = settings_path
        self.raw         = load_settings(settings_path)
        self.instruments = self.raw["data"]
        self.conn        = WSConn()

        # Results
        self.event_log   = defaultdict(list)   # event_name → list of payloads seen
        self.found_instr = {}                   # token → instrument dict (from server)

    # ── Phase 1: listen + probe ────────────────────────────────────────────────
    def _listen(self, duration_secs, label="Listening"):
        """Receive all messages for `duration_secs` and record them."""
        log.info(f"{label} for {duration_secs}s…")
        deadline = time.time() + duration_secs
        count    = 0

        while time.time() < deadline:
            try:
                raw = self.conn.recv(timeout=1.5)
            except websocket.WebSocketTimeoutException:
                continue
            except Exception as e:
                log.debug(f"recv error: {e}")
                break

            if raw in ("2", "3"):
                self.conn.emit("3") if raw == "2" else None
                continue
            if not raw.startswith("42"):
                log.debug(f"  ignored frame: {raw[:80]}")
                continue

            try:
                arr = json.loads(raw[2:])
            except json.JSONDecodeError:
                continue

            if not isinstance(arr, list) or len(arr) < 1:
                continue

            event_name = arr[0]
            payload    = arr[1] if len(arr) > 1 else {}
            count += 1

            # Store at most 5 examples per event to avoid huge logs
            if len(self.event_log[event_name]) < 5:
                self.event_log[event_name].append(payload)

            # Try to extract instrument info from any event
            self._extract_instruments(event_name, payload)

        log.info(f"  → {count} message(s) received, "
                 f"{len(self.event_log)} unique event type(s) seen")

    def _extract_instruments(self, event_name, payload):
        """
        Parse any payload that looks like it contains instrument data.
        Tries several known shapes and a generic search.
        """
        if not isinstance(payload, dict):
            return

        # Shape A: payload is a single instrument  {"instrument_token": "...", ...}
        if "instrument_token" in payload and "tradingsymbol" in payload:
            self._register(payload)
            return

        # Shape B: payload has a list under common keys
        for key in ("instruments", "data", "results", "list", "items", "records"):
            val = payload.get(key)
            if isinstance(val, list):
                for item in val:
                    if isinstance(item, dict):
                        self._register(item)
                return

        # Shape C: payload IS a list (shouldn't happen with Socket.IO arr[1] but just in case)
        if isinstance(payload, list):
            for item in payload:
                if isinstance(item, dict):
                    self._register(item)

        # Shape D: get-instrument response (same as existing script uses)
        if event_name == "get-instrument":
            uid = payload.get("uniqId") or payload.get("_id")
            if uid:
                self.event_log["__get-instrument-uids"].append(uid)

    def _register(self, item):
        """Store a discovered instrument keyed by its token(s)."""
        tok = (
            item.get("instrument_token")
            or item.get("token")
            or item.get("instrumentToken")
        )
        if not tok:
            return
        for t in str(tok).split(","):
            t = t.replace("_full", "").strip()
            if t:
                self.found_instr[t] = item

    def _fire_probes(self):
        """Send all probe events then listen for responses."""
        log.info(f"\nFiring {len(PROBE_EVENTS)} probe event(s)…")
        for event, payload in PROBE_EVENTS:
            log.info(f"  → emit '{event}' payload={json.dumps(payload)[:80]}")
            self.conn.emit(event, payload)

        self._listen(PROBE_WAIT_SECS, label="Waiting for probe responses")

    def run_discovery(self):
        log.info("Connecting…")
        self.conn.connect()

        # Step 1: passive listen — catch anything the server pushes on connect
        self._listen(PASSIVE_LISTEN_SECS, label="Phase 1 — passive listen")

        # Step 2: active probes
        self._fire_probes()

        self.conn.close()

    # ── Print discovery report ─────────────────────────────────────────────────
    def print_report(self):
        log.info("\n" + "═" * 64)
        log.info("DISCOVERY REPORT")
        log.info("═" * 64)

        if not self.event_log:
            log.info("No events observed at all — server may require auth or a specific first message.")
        else:
            log.info(f"\n{len(self.event_log)} unique event type(s) seen:\n")
            for name, payloads in sorted(self.event_log.items()):
                log.info(f"  EVENT: {name!r}  ({len(payloads)} example(s))")
                for i, p in enumerate(payloads[:2], 1):
                    log.info(f"    example {i}: {payload_shape(p)}")
                log.info("")

        log.info(f"Instruments discovered from server: {len(self.found_instr)}")
        for tok, item in list(self.found_instr.items())[:20]:
            sym  = item.get("tradingsymbol") or item.get("name") or item.get("settingName") or "?"
            exch = item.get("exchange") or item.get("segment") or ""
            log.info(f"  token={tok:>15}  symbol={sym:<24}  {exch}")
        if len(self.found_instr) > 20:
            log.info(f"  … and {len(self.found_instr) - 20} more")

        log.info("═" * 64)

    # ── Phase 2: merge into settings ──────────────────────────────────────────
    def merge(self):
        if not self.found_instr:
            log.info("\nNo instruments found to merge.")
            return 0, 0

        existing_tokens = {}
        for inst in self.instruments:
            for tok in inst.get("instrumentToken", []):
                existing_tokens[str(tok)] = inst

        added   = 0
        updated = 0

        for tok, server_item in self.found_instr.items():
            sym = (
                server_item.get("tradingsymbol")
                or server_item.get("name")
                or server_item.get("settingName")
                or tok
            )

            if tok in existing_tokens:
                # ── Update existing entry ──────────────────────────────────
                inst = existing_tokens[tok]
                changed = False

                # Update last_price if available
                lp = server_item.get("last_price") or server_item.get("ltp")
                if lp is not None:
                    for detail in inst.get("instrumentsDetail", []):
                        if str(detail.get("instrument_token", "")) == tok:
                            detail["last_price"] = str(lp)
                            changed = True

                # Update instrumentsDetail if server sent a fuller record
                if server_item.get("instrumentsDetail"):
                    inst["instrumentsDetail"] = server_item["instrumentsDetail"]
                    changed = True

                if changed:
                    inst["updatedAt"] = utc_now()
                    updated += 1
                    log.info(f"  UPDATED  {inst['settingName']}  (token {tok})")

            else:
                # ── Add new skeleton entry ─────────────────────────────────
                new_entry = {
                    "_id":            server_item.get("_id") or f"discovered_{tok}",
                    "settingName":    sym,
                    "instrumentToken": [tok],
                    "equation":       server_item.get("equation") or "A",
                    "settingValue":   server_item.get("settingValue") or [{"Duty": 0}],
                    "instrumentsDetail": server_item.get("instrumentsDetail") or [
                        {
                            "instrument_token": tok,
                            "tradingsymbol":    sym,
                            "exchange":         server_item.get("exchange") or "",
                            "last_price":       str(server_item.get("last_price") or "0"),
                        }
                    ],
                    "isActive":   server_item.get("isActive", True),
                    "createdAt":  utc_now(),
                    "updatedAt":  utc_now(),
                    "_discovered": True,   # flag so you know these came from auto-discovery
                }
                self.instruments.append(new_entry)
                existing_tokens[tok] = new_entry
                added += 1
                log.info(f"  ADDED    {sym}  (token {tok})")

        log.info(f"\nMerge summary — added: {added}, updated: {updated}")
        return added, updated


# ── Entry point ────────────────────────────────────────────────────────────────
def main():
    path = sys.argv[1] if len(sys.argv) > 1 else SETTINGS_FILE
    script_dir = os.path.dirname(os.path.abspath(__file__))
    if not os.path.isabs(path):
        path = os.path.join(script_dir, path)

    if not os.path.exists(path):
        log.error(f"Settings file not found: {path}")
        sys.exit(1)

    log.info("=" * 64)
    log.info(f"discover_instruments.py  —  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log.info(f"File : {os.path.abspath(path)}")
    log.info(f"Save : {SAVE}")
    log.info("=" * 64)

    disc = Discoverer(settings_path=path)

    try:
        disc.run_discovery()
    except Exception as e:
        log.error(f"Discovery failed: {e}")
        raise

    disc.print_report()

    added, updated = disc.merge()

    if SAVE and (added or updated):
        disc.raw["data"] = disc.instruments
        save_settings(path, disc.raw)
    elif not SAVE:
        log.info("\nDry-run mode — nothing saved. Set SAVE = True to write changes.")
    else:
        log.info("\nNothing changed — file not rewritten.")

    log.info("Done ✓")
    sys.exit(0)


if __name__ == "__main__":
    main()