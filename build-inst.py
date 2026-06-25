"""
build_instruments.py
────────────────────
Builds instrument_settings.json from scratch — no existing file needed.

HOW TO UPDATE THE PAYLOAD (do every few days / after rollover):
  1. Log in to https://badla.dgexch.com
  2. Open DevTools → Network → WS tab
  3. Click the websocket connection
  4. In Messages, find the outgoing frame:  42["watch-instruments", "..."]
  5. Copy the full text of that frame
  6. Replace the value of RAW_PAYLOAD below with the new text
     (paste as-is — escaped or unescaped both work)

Usage:
    python build_instruments.py
    python build_instruments.py /path/to/output/instrument_settings.json
"""

import websocket
import json
import ssl
import time
import threading
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
log = logging.getLogger("build_instruments")

# ── Output file ────────────────────────────────────────────────────────────────
OUTPUT_FILE = "instrument_settings.json"

# ── WebSocket config ───────────────────────────────────────────────────────────
WS_URL           = "wss://schart.99sports.games/socket.io/?api_token_temp=android&EIO=3&transport=websocket"
RESPONSE_TIMEOUT = 12
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

# ── RAW PAYLOAD ────────────────────────────────────────────────────────────────
# Paste the full outgoing 42["watch-instruments", "..."] frame here.
# Escaped (\") or unescaped (") both work — parse_payload handles either.
RAW_PAYLOAD = r"""{\"roomId\":\"yWf4p\",\"instrument_token\":\"73210686713_full,91084863423_full,44968_full,77897113617_full,28002925019_full,44695_full,20446366594_full,71069778201_full,20848323089_full,78072679092_full,91683347732_full,84282184193_full,39468535041_full,80316991964_full,73686685723_full,77764798265_full,23737742814_full,27494082360_full,70526413128_full,44439_full,71406830696_full,97967302236_full,77383798437_full,50617248258_full,74641093214_full,74166801835_full,44693_full,43680_full,99823636843_full,47436858279_full,43681_full,80517313346_full\",\"marketType\":\"badla\",\"uniqId\":\"batch_badla\",\"equation\":{\"6a338a407b72d976eef100dd\":{\"equation\":\"Math.round((((L1*100+6)*L3)/3.1104) + ((((L1*100+6)*L3)/3.1104) * D1 /100))\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"73210686713_full\",\"91084863423_full\",\"44968_full\"],\"settingName\":\"SILVER15%-(COMEXSEP-MCXSEP)@JULYDG\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a338a997b72d976eef100de\":{\"equation\":\"Math.round((((L1*100+15)*L3)/3.1104) + ((((L1*100+15)*L3)/3.1104) * D1 /100))\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"73210686713_full\",\"91084863423_full\",\"44968_full\"],\"settingName\":\"SILVER-15%(COMEXSEP-MCXSEP)@JULYDG@PREMIUM@15\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a339ce17b72d976eef100df\":{\"equation\":\"Math.round((((L1 * 100 + 15) * L3) / 3.1104) + D1)\",\"duty\":[{\"Duty\":31515.75}],\"instrumentTokens\":[\"73210686713_full\",\"91084863423_full\",\"44968_full\"],\"settingName\":\"SILVER-31515.75(COMEXSEP-MCXSEP)@JULYDG\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a34df927b72d976eef100e0\":{\"equation\":\"Math.round((L1*2.204623)*L3)\",\"duty\":[{\"Duty\":6.75}],\"instrumentTokens\":[\"77897113617_full\",\"28002925019_full\",\"44968_full\"],\"settingName\":\"COPPER(COMEXAUG-MCXJULY)@JULYDG (2.204623)\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a34dfcc7b72d976eef100e1\":{\"equation\":\"Math.round(((((L1*2.204623)*L3))*D1)/100) + (((L1*2.204623)*L3))\",\"duty\":[{\"Duty\":4}],\"instrumentTokens\":[\"77897113617_full\",\"28002925019_full\",\"44968_full\"],\"settingName\":\"COPPER4%(COMEXAUG-MCXJULY)@JULYDG\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a34e0d57b72d976eef100e2\":{\"equation\":\"L1\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"44695_full\",\"44968_full\",\"44968_full\"],\"settingName\":\"DG(JUNE)-DG(jULY)\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a38c3967b72d976eef100e6\":{\"equation\":\"Math.round(((L1*100)*(L3*0.321507)))\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"20446366594_full\",\"71069778201_full\",\"44695_full\"],\"settingName\":\"SILVER-(COMEXJULY-MCXJULY)@JUNEDG\",\"diffrenceValue\":0,\"reverse\":\"1\"},\"6a38c8827b72d976eef100e7\":{\"equation\":\"Math.round(((((L1 + 2) * L3)/3.1104) + ((((L1 + 2) * L3)/3.1104)*D1/100)) * 0.995)\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"20848323089_full\",\"78072679092_full\",\"44968_full\"],\"settingName\":\"GOLD-15%(COMEXAUG-MCXAUG)@JULYDG\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a38c8b97b72d976eef100e8\":{\"equation\":\"Math.round(((((L1 + 2) * L3)/3.1104) + ((((L1 + 2) * L3)/3.1104)*D1/100)) * 0.995)\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"20848323089_full\",\"78072679092_full\",\"44968_full\"],\"settingName\":\"GOLD-15%(COMEXAUG-MCXAUG)JULYDG@PREMIUM@2\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a38c9157b72d976eef100e9\":{\"equation\":\"Math.round(((L1 * L3) / 3.1104) * 0.995)\",\"duty\":[{\"Duty\":0}],\"instrumentTokens\":[\"20848323089_full\",\"78072679092_full\",\"44968_full\"],\"settingName\":\"GOLD-(COMEXAUG-MCXAUG)@JULYDG\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a3a28577b72d976eef100eb\":{\"equation\":\"Math.round(L1+L1)\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"91683347732_full\",\"84282184193_full\",\"84282184193_full\"],\"settingName\":\"dow@nasdaq@nasdaq\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a3a6b177b72d976eef100ec\":{\"equation\":\"L1*L3\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"39468535041_full\",\"80316991964_full\",\"44968_full\"],\"settingName\":\"NGAS(COMEXJULY-MCXJULY)JULYDG\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a33890db2d57f677d7aa427\":{\"equation\":\"L1*L3\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"73686685723_full\",\"77764798265_full\",\"44968_full\"],\"settingName\":\"CRUDE(COMEXJULY-MCXJULY)@JULYDG\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a3288cd4d3795115098c8eb\":{\"equation\":\"Math.round(((((L1 + 2) * L3)/3.1104) + (D1 * 0.995)))\",\"duty\":[{\"Duty\":19525.2}],\"instrumentTokens\":[\"20848323089_full\",\"78072679092_full\",\"44695_full\"],\"settingName\":\"GOLD-19525.2(COMEXAUG-MCXAUG)@JUNEDG\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a328b714d3795115098c8ec\":{\"equation\":\"Math.round((((L1 * 100 + 15) * L3) / 3.1104) + D1)\",\"duty\":[{\"Duty\":31515.75}],\"instrumentTokens\":[\"20446366594_full\",\"71069778201_full\",\"44695_full\"],\"settingName\":\"SILVER-31515.75(COMEXJULY-MCXJULY)@JUNEDG\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a0ae4d66121bd19cead3923\":{\"equation\":\"L1*L3\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"23737742814_full\",\"27494082360_full\",\"44695_full\"],\"settingName\":\"CRUDE(COMEXJUNE-MCXJUNE)@JUNEDG\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a0c2ca76121bd19cead3926\":{\"equation\":\"L1\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"70526413128_full\",\"20446366594_full\",\"44439_full\"],\"settingName\":\"GOLDMCX(JUNE)-SILVERMCX(JULY)\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a0e95a26121bd19cead3927\":{\"equation\":\"Math.round(((((L1 + 2) * L3)/3.1104) + ((((L1 + 2) * L3)/3.1104)*D1/100)) * 0.995)\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"20848323089_full\",\"78072679092_full\",\"44695_full\",\"44968_full\"],\"settingName\":\"GOLD-15%(COMEXAUG-MCXAUG)@JUNEDG\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a0e960f6121bd19cead3928\":{\"equation\":\"Math.round(((((L1 + 2) * L3)/3.1104) + ((((L1 + 2) * L3)/3.1104)*D1/100)) * 0.995)\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"20848323089_full\",\"78072679092_full\",\"44695_full\",\"44968_full\"],\"settingName\":\"GOLD-15%(COMEXAUG-MCXAUG)JUNEDG@PREMIUM@2\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a0e986c6121bd19cead392a\":{\"equation\":\"Math.round((((L1*100+6)*L3)/3.1104) + ((((L1*100+6)*L3)/3.1104) * D1 /100))\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"20446366594_full\",\"71069778201_full\",\"44695_full\",\"44968_full\"],\"settingName\":\"SILVER15%-(COMEXJULY-MCXJULY)@JUNEDG\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a1002dd6121bd19cead392b\":{\"equation\":\"L1*L3\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"71406830696_full\",\"97967302236_full\",\"44695_full\"],\"settingName\":\"NGAS(COMEXJUNE-MCXJUNE)JUNEDG\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a10033c6121bd19cead392c\":{\"equation\":\"Math.round(((((L1*2.204623)*L3))*D1)/100) + (((L1*2.204623)*L3))\",\"duty\":[{\"Duty\":4}],\"instrumentTokens\":[\"77383798437_full\",\"50617248258_full\",\"44695_full\"],\"settingName\":\"COPPER4%(COMEXJULY-MCXJUNE)@JUNEDG\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a10039d6121bd19cead392d\":{\"equation\":\"Math.round((L1*2.204623)*L3)\",\"duty\":[{\"Duty\":6.75}],\"instrumentTokens\":[\"77383798437_full\",\"50617248258_full\",\"44695_full\"],\"settingName\":\"COPPER(COMEXJULY-MCXJUNE)@JUNEDG (2.204623)\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a1577da6121bd19cead392e\":{\"equation\":\"Math.round((((L1*100+15)*L3)/3.1104) + ((((L1*100+15)*L3)/3.1104) * D1 /100))\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"20446366594_full\",\"71069778201_full\",\"44695_full\",\"44968_full\"],\"settingName\":\"SILVER-15%(COMEXJULY-MCXJULY)@JUNEDG@PREMIUM@15\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a157a466121bd19cead392f\":{\"equation\":\"L1*2\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"74641093214_full\",\"74166801835_full\",\"44695_full\"],\"settingName\":\"NIFTY-BANKNIFTY (JUNE)\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a157aae6121bd19cead3930\":{\"equation\":\"L1\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"74166801835_full\",\"44693_full\",\"44695_full\"],\"settingName\":\"NIFTY-SGX(JUNE)\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a159db66121bd19cead3931\":{\"equation\":\"L1\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"43680_full\",\"78072679092_full\",\"44695_full\",\"44968_full\"],\"settingName\":\"GOLD -SPOTGOLD(DEC) COMEXGOLD(AUG)\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a16cb836121bd19cead3932\":{\"equation\":\"Math.round(((((L1 + 2) * L3)/3.1104) + ((((L1 + 2) * L3)/3.1104)*D1/100)) * 0.995)\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"20848323089_full\",\"78072679092_full\",\"44695_full\"],\"settingName\":\"GOLD-15%REV(JUNEDG)\",\"diffrenceValue\":0,\"reverse\":\"1\"},\"6a16cccb6121bd19cead3933\":{\"equation\":\"Math.round((((L1*100+6)*L3)/3.1104) + ((((L1*100+6)*L3)/3.1104) * D1 /100))\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"20446366594_full\",\"71069778201_full\",\"44695_full\"],\"settingName\":\"SILVER15%REV@JUNEDG\",\"diffrenceValue\":0,\"reverse\":\"1\"},\"6a16cdaf6121bd19cead3934\":{\"equation\":\"L1\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"20848323089_full\",\"99823636843_full\",\"44695_full\"],\"settingName\":\"GOLD-MINIGOLD(JULY) MCXGOLD(AUG)\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"6a16ee9b6121bd19cead3935\":{\"equation\":\"Math.round(((L1*32.15)*L3) + D1)\",\"duty\":[{\"Duty\":5000}],\"instrumentTokens\":[\"20446366594_full\",\"71069778201_full\",\"44695_full\"],\"settingName\":\"SILVER@5000@REV@JUNEDG\",\"diffrenceValue\":0,\"reverse\":\"1\"},\"6a16eedf6121bd19cead3936\":{\"equation\":\"Math.round(((L1*32.15)*L3) + D1)\",\"duty\":[{\"Duty\":400000}],\"instrumentTokens\":[\"20848323089_full\",\"78072679092_full\",\"44695_full\"],\"settingName\":\"GOLD@400000@REV@JUNEDG\",\"diffrenceValue\":0,\"reverse\":\"1\"},\"6a1983726121bd19cead3937\":{\"equation\":\"Math.round(((L1 * L3) / 3.1104) * 0.995)\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"20848323089_full\",\"78072679092_full\",\"44695_full\"],\"settingName\":\"GOLD-(COMEXAUG-MCXAUG)@JUNEDG\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"69fc426dbab8e09015512d39\":{\"equation\":\"L1\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"70526413128_full\",\"47436858279_full\",\"44439_full\"],\"settingName\":\"GOLD-MINIGOLD(JUNE) MCXGOLD(JUNE)\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"699e91656754c439a4ad8e78\":{\"equation\":\"L1\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"43681_full\",\"91084863423_full\",\"44695_full\",\"44968_full\"],\"settingName\":\"SILVER -SPOTSILVER(DEC) COMEXSILVER(SEP)\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"69cb71586754c439a4ad8e89\":{\"equation\":\"L1/2\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"91683347732_full\",\"84282184193_full\",\"44695_full\"],\"settingName\":\"DOW-NASDAQ-SNP\",\"diffrenceValue\":0,\"reverse\":\"0\"},\"697c47bdd64a70878cc02b0d\":{\"equation\":\"L1\",\"duty\":[{\"Duty\":15}],\"instrumentTokens\":[\"20446366594_full\",\"80517313346_full\",\"44439_full\"],\"settingName\":\"SILVER -MINISILVER(JULY) MCXSILVER(JUNE)\",\"diffrenceValue\":0,\"reverse\":\"0\"}},\"response_type\":\"full\",\"duty\":[]}"""


# ── Helpers ────────────────────────────────────────────────────────────────────
def utc_now():
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def parse_payload(raw):
    """
    Parse the RAW_PAYLOAD string into a list of instrument dicts
    compatible with instrument_settings.json format.
    Each entry in the equation object becomes one instrument.

    Handles escaped payloads from DevTools automatically.
    """
    def try_loads(s):
        try:
            return json.loads(s)
        except Exception:
            return None

    # Try strategies in order until one works
    data = (
        try_loads(raw)
        or try_loads(raw.strip().strip('"').strip("'"))
        or try_loads(raw.replace('\\"', '"'))
    )
    if data is None:
        try:
            data = try_loads(raw.encode("utf-8").decode("unicode_escape"))
        except Exception:
            pass
    if data is None:
        raise ValueError(f"Cannot parse RAW_PAYLOAD. First 120 chars: {raw[:120]!r}")
    equations = data.get("equation", {})

    instruments = []
    for _id, eq in equations.items():
        tokens = [t.replace("_full", "") for t in eq.get("instrumentTokens", [])]
        inst = {
            "_id":             _id,
            "settingName":     eq.get("settingName", ""),
            "equation":        eq.get("equation", "L1"),
            "instrumentToken": tokens,
            "settingValue": [
                {"Duty": eq["duty"][0]["Duty"] if eq.get("duty") else 15}
            ],
            "diffrenceValue":  eq.get("diffrenceValue", 0),
            "reverse":         eq.get("reverse", "0"),
            "instrumentsDetail": [],
            "updatedAt":       utc_now(),
        }
        instruments.append(inst)

    log.info(f"Parsed {len(instruments)} instruments from payload")
    return instruments


# ── WebSocket connection ───────────────────────────────────────────────────────
class WSConn:
    def __init__(self):
        self.ws    = None
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

    def send(self, msg):  self.ws.send(msg)
    def recv(self, t):    self.ws.settimeout(t); return self.ws.recv()
    def close(self):
        self._stop.set()
        try: self.ws.close()
        except Exception: pass


# ── Builder ────────────────────────────────────────────────────────────────────
class InstrumentBuilder:

    def __init__(self, output_path, instruments):
        self.output_path = output_path
        self.instruments = instruments
        self.id_map      = {i["_id"]: i for i in instruments}
        self.responses   = {}
        self.conn        = WSConn()

    def _send_requests(self):
        """Send one set-instrument request per instrument."""
        import random, string
        def rand_id(n=5):
            return "".join(random.choices(string.ascii_letters + string.digits, k=n))

        for inst in self.instruments:
            tok_str = ",".join(f"{t}_full" for t in inst["instrumentToken"])
            duty    = inst["settingValue"][0]["Duty"]
            payload = {
                "roomId":           rand_id(),
                "instrument_token": tok_str,
                "marketType":       "badla",
                "uniqId":           inst["_id"],
                "equation":         inst.get("equation", "L1"),
                "response_type":    "full",
                "duty":             duty,
            }
            self.conn.send(f'42["set-instrument",{json.dumps(payload)}]')

    def _collect(self, timeout):
        """Collect get-instrument responses until all received or timeout."""
        remaining = set(self.id_map.keys())
        deadline  = time.time() + timeout * 2

        while remaining and time.time() < deadline:
            try:
                raw = self.conn.recv(timeout)
            except websocket.WebSocketTimeoutException:
                log.warning(f"  Timeout — still waiting for {len(remaining)} response(s)")
                break

            if raw in ("2", "3"):
                self.conn.send("3")
                continue
            if not raw.startswith("42"):
                continue

            try:
                arr = json.loads(raw[2:])
                if len(arr) >= 2 and arr[0] == "get-instrument":
                    # Strip timestamp suffix from uniqId e.g. "abc123_1780574755647"
                    uid_raw = arr[1].get("uniqId", "")
                    uid     = uid_raw.split("_")[0] if "_" in uid_raw else uid_raw

                    if uid and uid in remaining:
                        self.responses[uid] = arr[1]
                        remaining.discard(uid)
                        done = len(self.id_map) - len(remaining)
                        name = self.id_map[uid]["settingName"]
                        log.info(f"  [{done}/{len(self.id_map)}] ✓  {name}")
            except Exception as ex:
                log.debug(f"  Parse error: {ex}")

        return set(self.id_map.keys()) - remaining

    def _apply(self):
        """Write live data from responses back into instrument dicts."""
        updated = skipped = 0
        for inst in self.instruments:
            resp = self.responses.get(inst["_id"])
            if resp is None:
                log.warning(f"  No response for: {inst['settingName']}")
                skipped += 1
                continue

            # Store full instrument detail array
            if resp.get("data"):
                inst["instrumentsDetail"] = resp["data"]
                # Update last_price on each token detail
                for detail in inst["instrumentsDetail"]:
                    lp = detail.get("last_price")
                    if lp is not None:
                        detail["last_price"] = str(lp)

            # Update token list if server returned different tokens
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

    def run(self):
        log.info("=" * 64)
        log.info(f"build_instruments.py  —  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        log.info(f"Output      : {self.output_path}")
        log.info(f"Instruments : {len(self.instruments)}")
        log.info("=" * 64)

        try:
            log.info("Connecting to WebSocket…")
            self.conn.connect()
            log.info(f"Sending {len(self.instruments)} requests…")
            self._send_requests()
            received = self._collect(RESPONSE_TIMEOUT)
        finally:
            self.conn.close()

        updated, skipped = self._apply()

        log.info("\n" + "=" * 64)
        log.info(f"Responses received : {len(received)}/{len(self.instruments)}")
        log.info(f"Updated            : {updated}")
        log.info(f"Skipped (no resp)  : {skipped}")
        if skipped:
            log.info("Unresolved instruments:")
            for inst in self.instruments:
                if inst["_id"] not in self.responses:
                    log.info(f"  • {inst['settingName']}  tokens={inst['instrumentToken']}")
        log.info("=" * 64)

        output = {"status": True, "message": "data found.", "data": self.instruments}
        with open(self.output_path, "w") as f:
            json.dump(output, f, indent=2)
        log.info(f"Saved → {self.output_path}")
        log.info("Done ✓")
        return updated, skipped


# ── Run ────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    script_dir  = os.path.dirname(os.path.abspath(__file__))
    arg_path    = sys.argv[1] if len(sys.argv) > 1 else OUTPUT_FILE
    output_path = arg_path if os.path.isabs(arg_path) else os.path.join(script_dir, arg_path)

    # Diagnostic: show first few chars of RAW_PAYLOAD to confirm escaping style
    log.info(f"RAW_PAYLOAD first 6 chars: {[repr(c)+'/'+str(ord(c)) for c in RAW_PAYLOAD[:6]]}")
    instruments = parse_payload(RAW_PAYLOAD)
    builder     = InstrumentBuilder(output_path=output_path, instruments=instruments)
    updated, skipped = builder.run()
    sys.exit(0 if skipped == 0 else 1)