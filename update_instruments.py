"""
update_instruments.py
─────────────────────
Run this whenever you want to refresh instrument_settings.json.

HOW TO GET FRESH INSTRUMENTS FROM THE SITE (do every few days):
  1. Log in to https://badla.dgexch.com
  2. Open DevTools → Network tab → refresh the page
  3. Find the request that returns instrument/settings data
     (URL will contain "instrument" or "setting")
  4. Right-click → Copy → Copy Response
  5. Paste into  instruments_override.json  in this folder
  6. Run this script — it will use the fresh list automatically

Without instruments_override.json it falls back to instrument_settings.json.

Usage:
    python update_instruments.py
    python update_instruments.py /path/to/instrument_settings.json
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
from datetime import datetime, UTC

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("update_instruments")

# ── Config ─────────────────────────────────────────────────────────────────────
WS_URL           = "wss://schart.99sports.games/socket.io/?api_token_temp=android&EIO=3&transport=websocket"
SETTINGS_FILE    = "instrument_settings.json"
OVERRIDE_FILE    = "instruments_override.json"   # paste fresh data from browser here
RESPONSE_TIMEOUT = 10
RETRY_TIMEOUT    = 8
PING_INTERVAL    = 25

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


# ── Helpers ────────────────────────────────────────────────────────────────────
def rand_id(n=5):
    return "".join(random.choices(string.ascii_letters + string.digits, k=n))


def utc_now():
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def parse_settings(raw):
    """Accept {status, data:[...]} OR a bare list OR a single object."""
    if isinstance(raw, dict):
        if "data" in raw and isinstance(raw["data"], list):
            return raw, raw["data"]
        # bare dict — wrap it
        wrapped = {"status": True, "message": "data found.", "data": [raw]}
        return wrapped, wrapped["data"]
    if isinstance(raw, list):
        wrapped = {"status": True, "message": "data found.", "data": raw}
        return wrapped, wrapped["data"]
    raise ValueError("Unrecognised JSON shape — expected list or {data:[...]}")


def load_file(path):
    with open(path, "r") as f:
        return json.load(f)


def save_settings(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    log.info(f"Saved → {path}")


def resolve_instrument_file(base_path):
    """
    Returns (source_label, settings_dict, instruments_list).
    Priority:
      1. instruments_override.json in same dir  ← fresh from browser
      2. the file passed in (instrument_settings.json)
    """
    base_dir     = os.path.dirname(os.path.abspath(base_path))
    override_path = os.path.join(base_dir, OVERRIDE_FILE)

    if os.path.exists(override_path):
        log.info(f"Using OVERRIDE file: {override_path}")
        raw = load_file(override_path)
        settings, instruments = parse_settings(raw)
        return "override", settings, instruments, override_path

    log.info(f"Using settings file: {base_path}")
    raw = load_file(base_path)
    settings, instruments = parse_settings(raw)
    return "settings", settings, instruments, base_path


# ── WebSocket connection ───────────────────────────────────────────────────────
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
        log.info("Got '0' (open) → sending '40' (namespace connect)")
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

    def send(self, msg):   self.ws.send(msg)
    def recv(self, t):     self.ws.settimeout(t); return self.ws.recv()
    def close(self):
        self._stop.set()
        try: self.ws.close()
        except Exception: pass


# ── Core updater ───────────────────────────────────────────────────────────────
class InstrumentUpdater:

    def __init__(self, settings_path):
        source, self.settings, self.instruments, self.source_path = \
            resolve_instrument_file(settings_path)
        self.output_path = settings_path   # always write back to instrument_settings.json
        self.source_label = source

        # Give every instrument a room_id for the WS request
        for inst in self.instruments:
            if "_id" not in inst:
                inst["_id"] = "gen_" + rand_id(8)
        self.id_map   = {i["_id"]: i for i in self.instruments}
        self.room_map = {i["_id"]: rand_id() for i in self.instruments}
        self.responses = {}
        self.conn = WSConn()

    # ── Build WS payload ──────────────────────────────────────────────────────
    def _send_request(self, inst, token_override=None, duty_override=None):
        tokens  = token_override or inst.get("instrumentToken", [])
        duty    = duty_override  or inst["settingValue"][0]["Duty"]
        tok_str = ",".join(f"{t}_full" for t in tokens)
        payload = {
            "roomId":           self.room_map[inst["_id"]],
            "instrument_token": tok_str,
            "marketType":       "badla",
            "uniqId":           inst["_id"],
            "equation":         inst.get("equation", "L1"),
            "response_type":    "full",
            "duty":             duty,
        }
        self.conn.send(f'42["set-instrument",{json.dumps(payload)}]')

    # ── Collect responses ─────────────────────────────────────────────────────
    def _collect(self, expected_ids, timeout):
        remaining = set(expected_ids)
        deadline  = time.time() + timeout * 2
        while remaining and time.time() < deadline:
            try:
                raw = self.conn.recv(timeout)
            except websocket.WebSocketTimeoutException:
                log.warning(f"  Timeout — still waiting for {len(remaining)} response(s)")
                break
            if raw in ("2", "3"):
                self.conn.send("3"); continue
            if not raw.startswith("42"): continue
            try:
                arr = json.loads(raw[2:])
                if len(arr) >= 2 and arr[0] == "get-instrument":
                    uid = arr[1].get("uniqId")
                    if uid and uid in remaining:
                        self.responses[uid] = arr[1]
                        remaining.discard(uid)
                        done = len(expected_ids) - len(remaining)
                        log.info(f"  [{done}/{len(expected_ids)}] ✓  {self.id_map[uid]['settingName']}")
            except Exception as e:
                log.debug(f"  Parse error: {e}")
        return set(expected_ids) - remaining

    # ── Round 1: send all ─────────────────────────────────────────────────────
    def _round1(self):
        log.info(f"\nRound 1 — sending {len(self.instruments)} requests…")
        for inst in self.instruments:
            self._send_request(inst)
        received = self._collect(list(self.id_map.keys()), RESPONSE_TIMEOUT)
        missed = [i for i in self.instruments if i["_id"] not in received]
        log.info(f"Round 1: {len(received)}/{len(self.instruments)} received")
        return missed

    # ── Round 2: retry missed with varied duty ────────────────────────────────
    def _round2(self, missed):
        if not missed:
            return []
        log.info(f"\nRound 2 — retrying {len(missed)} missed instrument(s) with duty variants…")
        duty_variants = [6, 6.75, 15, 4, 5, 10]
        ids_to_watch = []
        for inst in missed:
            current_duty = inst["settingValue"][0]["Duty"]
            for duty in duty_variants:
                if duty == current_duty:
                    continue
                self._send_request(inst, duty_override=duty)
            # also retry original
            self._send_request(inst)
            ids_to_watch.append(inst["_id"])

        received  = self._collect(ids_to_watch, RETRY_TIMEOUT)
        still_missed = [i for i in missed if i["_id"] not in received]
        log.info(f"Round 2: resolved {len(received)}/{len(missed)}")
        return still_missed

    # ── Apply updates ─────────────────────────────────────────────────────────
    def _apply(self):
        updated = skipped = 0
        for inst in self.instruments:
            resp = self.responses.get(inst["_id"])
            if resp is None:
                skipped += 1
                continue

            if resp.get("instrumentsDetail"):
                inst["instrumentsDetail"] = resp["instrumentsDetail"]

            # Update last_price per token
            prices = resp.get("prices") or resp.get("ltp") or {}
            if isinstance(prices, dict):
                for detail in inst.get("instrumentsDetail", []):
                    tok = str(detail.get("instrument_token", ""))
                    if tok in prices:
                        detail["last_price"] = str(prices[tok])

            # Update token list if server echoed different tokens
            if resp.get("instrument_token"):
                new_toks = [
                    t.replace("_full", "")
                    for t in resp["instrument_token"].split(",") if t.strip()
                ]
                if new_toks and new_toks != inst.get("instrumentToken"):
                    log.info(
                        f"  Token updated: '{inst['settingName']}' "
                        f"{inst.get('instrumentToken')} → {new_toks}"
                    )
                    inst["instrumentToken"] = new_toks

            inst["updatedAt"] = utc_now()
            updated += 1

        return updated, skipped

    # ── Entry point ───────────────────────────────────────────────────────────
    def run(self):
        log.info("=" * 64)
        log.info(f"update_instruments.py  —  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        log.info(f"Source      : {self.source_label}  ({self.source_path})")
        log.info(f"Output      : {self.output_path}")
        log.info(f"Instruments : {len(self.instruments)}")
        log.info("=" * 64)

        try:
            log.info("Connecting to WebSocket…")
            self.conn.connect()
            missed       = self._round1()
            still_missed = self._round2(missed)
        finally:
            self.conn.close()

        updated, skipped = self._apply()

        log.info("\n" + "=" * 64)
        log.info(f"Responses received : {len(self.responses)}/{len(self.instruments)}")
        log.info(f"Updated            : {updated}")
        log.info(f"Skipped (no resp)  : {skipped}")
        if skipped:
            log.info("Still unresolved — check tokens or fetch fresh list from browser:")
            for inst in self.instruments:
                if inst["_id"] not in self.responses:
                    log.info(f"  • {inst['settingName']}  {inst.get('instrumentToken', [])}")
        log.info("=" * 64)

        self.settings["data"] = self.instruments
        save_settings(self.output_path, self.settings)
        log.info("Done ✓")
        return updated, skipped


# ── Run ────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    script_dir = os.path.dirname(os.path.abspath(__file__))
    arg_path   = sys.argv[1] if len(sys.argv) > 1 else SETTINGS_FILE
    path       = arg_path if os.path.isabs(arg_path) else os.path.join(script_dir, arg_path)

    if not os.path.exists(path):
        log.error(f"Settings file not found: {path}")
        sys.exit(1)

    updater = InstrumentUpdater(settings_path=path)
    updated, skipped = updater.run()
    sys.exit(0 if skipped == 0 else 1)