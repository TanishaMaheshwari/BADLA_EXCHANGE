import websocket
import json
import ssl
import time
import threading
import random
import string
import logging
import os
import sys
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("badla_websocket.log"),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("BadlaWebSocket")

# ── Tunable knobs ──────────────────────────────────────────────────────────────
PUSH_INTERVAL               = 0.08   # ~12 Hz — go lower if CPU allows
MIN_PUSH_INTERVAL_PER_INST  = 0.06
DISK_SAVE_INTERVAL          = 5.0
BASE_DIR       = os.path.dirname(os.path.abspath(__file__))
BROADCAST_FILE = os.path.join(BASE_DIR, "broadcast.json")
LIVE_PRICES_FILE = os.path.join(BASE_DIR, "live_prices.json")
# ──────────────────────────────────────────────────────────────────────────────

DISPLAY_NAME_OVERRIDES = {
    'GOLD-6%(COMEXJUNE-MCXJUNE)@MAYDG':       'GOLD15%-(COMEXJUNE-MCXJUNE)@MAYDG',
    'SILVER6%-(COMEXJULY-MCXJULY)@MAYDG':     'SILVER15%-(COMEXJULY-MCXJULY)@MAYDG',
}


class BadlaWebSocketClient:

    def __init__(self, data_dir="data", settings_file="instrument_settings.json",
                 response_timeout=0.08):
        self.ws_url = "wss://schart.99sports.games/socket.io/?api_token_temp=android&EIO=3&transport=websocket"
        self.headers = {
            "Upgrade": "websocket",
            "Origin": "https://badla.dgexch.com",
            "Cache-Control": "no-cache",
            "Accept-Language": "en-US,en;q=0.9",
            "Pragma": "no-cache",
            "Connection": "Upgrade",
            "Sec-WebSocket-Key": "RDe/AiYvXbCu5MuIYdtSfA==",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
            "Sec-WebSocket-Version": "13",
            "Sec-WebSocket-Extensions": "permessage-deflate; client_max_window_bits"
        }

        self.ws = None
        self.ping_thread = None
        self.push_thread = None
        self.save_thread = None
        self.ping_interval = 25000
        self.connected = False
        self.response_timeout = response_timeout

        self.data_dir = data_dir
        os.makedirs(self.data_dir, exist_ok=True)

        self.settings_file = settings_file
        self.instrument_settings = self._load_instrument_settings()

        self.price_map: dict[str, float] = {}
        self.price_lock = threading.Lock()
        self.bid_map: dict[str, float] = {}
        self.ask_map: dict[str, float] = {}

        self._last_push_ts: dict[str, float] = {}
        self._push_ts_lock = threading.Lock()

        # Buffer for slow disk saves
        self._save_buf: dict[str, tuple] = {}
        self._save_lock = threading.Lock()
        self._broadcast_lock = threading.Lock()

    # ── helpers ────────────────────────────────────────────────────────────────

    def _generate_room_id(self):
        return ''.join(random.choices(string.ascii_letters + string.digits, k=5))

    def _load_instrument_settings(self):
        try:
            with open(self.settings_file, 'r') as f:
                return json.load(f)["data"]
        except Exception as e:
            logger.error(f"Failed to load instrument settings: {e}")
            return []

    def _snapshot(self) -> tuple:
        with self.price_lock:
            return dict(self.price_map), dict(self.bid_map), dict(self.ask_map)

    # ── equation evaluator ─────────────────────────────────────────────────────

    def _evaluate(self, instrument: dict, prices: dict) -> float | None:
        tokens    = instrument.get("instrumentToken", [])
        equation  = instrument.get("equation", "L1")
        duty_list = instrument.get("settingValue", [{"Duty": 15}])
        D1        = float(duty_list[0].get("Duty", 15)) if duty_list else 15.0

        vals = [prices.get(str(t)) for t in tokens]
        if not vals or vals[0] is None:
            return None

        L1 = float(vals[0])
        L2 = float(vals[1]) if len(vals) > 1 and vals[1] is not None else 0.0
        L3 = float(vals[2]) if len(vals) > 2 and vals[2] is not None else 0.0

        try:
            return float(eval(equation, {"__builtins__": {}}, {
                "L1": L1, "L2": L2, "L3": L3, "D1": D1,
                "Math": type('Math', (), {"round": round})(),
                "round": round, "abs": abs, "max": max, "min": min,
            }))
        except Exception as ex:
            logger.debug(f"Equation eval failed for {instrument.get('settingName')}: {ex}")
            return None

    # ── calculate badla (mirrors server.js calculateBadla) ─────────────────────

    def _calculate_badla(self, inst: dict, prices: dict,
                         bids: dict, asks: dict) -> dict | None:
        """Run the full badla calculation in Python so Node gets a ready result."""
        tokens = inst.get("instrumentToken", [])
        if not tokens:
            return None

        detail_map = {
            str(d.get("instrument_token", "")): d
            for d in inst.get("instrumentsDetail", [])
        }

        def _get(tok):
            p = prices.get(str(tok))
            if p is None:
                return None
            d = detail_map.get(str(tok), {})
            return {
                "instrument_token": str(tok),
                "exchange":         d.get("exchange", ""),
                "last_price":       p,
                "buy_price_0":      bids.get(str(tok), p),
                "sell_price_0":     asks.get(str(tok), p),
            }

        instruments_detail = [r for r in (_get(t) for t in tokens) if r]
        if len(instruments_detail) < 2:
            return None
        
        mcx_data   = next((i for i in instruments_detail if i["exchange"] == "MCX"),   None)
        comex_data = next((i for i in instruments_detail if i["exchange"] in ("COMEX","SPOT")), None)
        dgcx_data  = next((i for i in instruments_detail if i["exchange"] == "DGCX"),  None)
        # Fallback: for non MCX+COMEX pairs (NSE, SGX, MCX+MCX etc.)
        # assign positionally so L1=first token, L2=second token
        if not mcx_data or not comex_data:
            non_dgcx = [i for i in instruments_detail if i["exchange"] != "DGCX"]
            if len(non_dgcx) < 2:
                return None
            comex_data = non_dgcx[0]   # L1
            mcx_data   = non_dgcx[1]   # L2
            reverse = "1" 

        equation = inst.get("equation", "L1")
        duty_list = inst.get("settingValue", [{"Duty": 15}])
        D1 = float(duty_list[0].get("Duty", 15)) if duty_list else 15.0
        reverse = inst.get("reverse", "0")

        def _eval(L1, L2, L3):
            try:
                return float(eval(equation, {"__builtins__": {}}, {
                    "L1": L1, "L2": L2, "L3": L3, "D1": D1,
                    "Math": type('Math', (), {"round": round})(),
                    "round": round, "abs": abs, "max": max, "min": min,
                }))
            except Exception:
                return None

        L1 = comex_data["last_price"]
        L2 = mcx_data["last_price"]
        L3 = (10000 / dgcx_data["last_price"]) if dgcx_data else 1

        ltp  = _eval(L1, L2, L3)
        buy  = _eval(comex_data["buy_price_0"]  or L1,
                     mcx_data["buy_price_0"]    or L2,
                     (10000 / (dgcx_data["sell_price_0"] or dgcx_data["last_price"])) if dgcx_data else 1)
        sell = _eval(comex_data["sell_price_0"] or L1,
                     mcx_data["sell_price_0"]   or L2,
                     (10000 / (dgcx_data["buy_price_0"]  or dgcx_data["last_price"])) if dgcx_data else 1)

        if ltp is None or buy is None or sell is None:
            return None

        final_ltp  = (ltp  - L2) if reverse == "1" else (L2 - ltp)
        final_buy  = (sell - mcx_data["buy_price_0"])  if reverse == "1" else (mcx_data["buy_price_0"]  - sell)
        final_sell = (buy  - mcx_data["sell_price_0"]) if reverse == "1" else (mcx_data["sell_price_0"] - buy)

        converted_ltp = _eval(L1, 0, L3)
        dgcx_bid_l3 = (10000 / (dgcx_data["buy_price_0"]  or dgcx_data["last_price"])) if dgcx_data else 1
        dgcx_ask_l3 = (10000 / (dgcx_data["sell_price_0"] or dgcx_data["last_price"])) if dgcx_data else 1

        name = inst["settingName"]
        return {
            "id":          inst["_id"],
            "name":        name,
            "displayName": DISPLAY_NAME_OVERRIDES.get(inst.get("raw_data", {}).get("displayName", name),
                           DISPLAY_NAME_OVERRIDES.get(name, name)),
            "type":        inst.get("badlaType", "GOLD"),
            "timestamp":   datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "badlaLTP":    f"{final_ltp:.2f}",
            "badlaBUY":    f"{final_buy:.2f}",
            "badlaSELL":   f"{final_sell:.2f}",
            "mcx": {
                "bid": mcx_data["buy_price_0"],
                "ask": mcx_data["sell_price_0"],
                "ltp": L2,
            },
            "comex": {
                "bid": comex_data["buy_price_0"],
                "ask": comex_data["sell_price_0"],
                "ltp": L1,
                "convertedLTP": f"{converted_ltp:.2f}" if converted_ltp is not None else None,
                "convertedBID": f"{sell:.2f}",
                "convertedASK": f"{buy:.2f}",
            },
            "dgcx": {
                "bid": dgcx_data["buy_price_0"],
                "ask": dgcx_data["sell_price_0"],
                "ltp": dgcx_data["last_price"],
                "convertedLTP": f"{L3:.4f}",
                "convertedBID": f"{dgcx_bid_l3:.4f}",
                "convertedASK": f"{dgcx_ask_l3:.4f}",
            } if dgcx_data else None,
        }

    # ── atomic broadcast file write ────────────────────────────────────────────

    def _write_broadcast(self, results: dict):
        tmp = BROADCAST_FILE + ".tmp"
        with self._broadcast_lock:
            try:
                with open(tmp, "w") as f:
                    json.dump({"ts": time.time(), "data": results}, f, separators=(',', ':'))
                os.replace(tmp, BROADCAST_FILE)
            except FileNotFoundError:
                pass  # tmp was consumed by another process (Node watcher) — harmless

    # ── disk save (slow path) ──────────────────────────────────────────────────

    def _save_data(self, instrument: dict, value: float, prices: dict):
        setting_name = instrument["settingName"]
        safe_name = ''.join(c if c.isalnum() else '_' for c in setting_name).strip('_')
        filepath = os.path.join(self.data_dir, f"{safe_name}.json")
        try:
            existing = {}
            if os.path.exists(filepath):
                with open(filepath, 'r') as f:
                    existing = json.load(f)
        except Exception:
            existing = {}
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        existing[ts] = {
            "timestamp":      ts,
            "instrument_id":  instrument["_id"],
            "instrument_name": setting_name,
            "computed_value": value,
            "prices": {str(t): prices.get(str(t)) for t in instrument.get("instrumentToken", [])}
        }
        with open(filepath, 'w') as f:
            json.dump(existing, f, indent=4)

    def _disk_save_loop(self):
        logger.info(f"Disk-save thread started (interval={DISK_SAVE_INTERVAL}s)")
        while self.connected:
            time.sleep(DISK_SAVE_INTERVAL)
            with self._save_lock:
                batch = dict(self._save_buf)
                self._save_buf.clear()
            for _, (inst, value, prices) in batch.items():
                try:
                    self._save_data(inst, value, prices)
                except Exception as e:
                    logger.warning(f"Disk save failed for {inst.get('settingName')}: {e}")
        logger.info("Disk-save thread stopped")

    # ── push all (no HTTP — just file write) ───────────────────────────────────

    def _push_all(self):
        if not self.price_map:
            return

        prices, bids, asks = self._snapshot()
        now = time.time()
        results = {}

        for inst in self.instrument_settings:
            inst_id = inst["_id"]

            with self._push_ts_lock:
                if now - self._last_push_ts.get(inst_id, 0) < MIN_PUSH_INTERVAL_PER_INST:
                    continue
                self._last_push_ts[inst_id] = now

            result = self._calculate_badla(inst, prices, bids, asks)
            if result is None:
                continue

            results[inst_id] = result

            # Queue disk save
            value = self._evaluate(inst, prices)
            if value is not None:
                with self._save_lock:
                    self._save_buf[inst_id] = (inst, value, dict(prices))

        if results:
            self._write_broadcast(results)
            # Also update live_prices.json for any other readers
            with self.price_lock:
                state = {"last": dict(self.price_map), "bid": dict(self.bid_map),
                         "ask": dict(self.ask_map), "ts": time.time()}
            tmp = LIVE_PRICES_FILE + ".tmp"
            with open(tmp, "w") as f:
                json.dump(state, f)
            os.replace(tmp, LIVE_PRICES_FILE)

            logger.debug(f"Broadcast {len(results)}/{len(self.instrument_settings)} instruments")

    # ── timer thread ───────────────────────────────────────────────────────────

    def _timed_push(self):
        logger.info(f"Push timer started ({1/PUSH_INTERVAL:.0f} Hz)")
        next_tick = time.monotonic() + PUSH_INTERVAL
        while self.connected:
            sleep_for = next_tick - time.monotonic()
            if sleep_for > 0:
                time.sleep(sleep_for)
            next_tick += PUSH_INTERVAL
            if self.connected and self.price_map:
                try:
                    self._push_all()
                except Exception as e:
                    logger.error(f"Push timer error: {e}", exc_info=True)  # ← add exc_info=True
        logger.info("Push timer stopped")

    # ── websocket ──────────────────────────────────────────────────────────────

    def _send_ping(self):
        while self.connected:
            try:
                if self.ws and self.ws.connected:
                    self.ws.send("2")
                    time.sleep(self.ping_interval / 1000)
                else:
                    break
            except Exception as e:
                logger.error(f"Ping error: {e}")
                break

    def connect(self):
        try:
            ssl_ctx = ssl.create_default_context()
            ssl_ctx.check_hostname = False
            ssl_ctx.verify_mode = ssl.CERT_NONE

            self.ws = websocket.create_connection(
                self.ws_url, header=self.headers, sslopt={"context": ssl_ctx}
            )
            msg = self.ws.recv()
            if msg.startswith("0"):
                try:
                    self.ping_interval = json.loads(msg[1:]).get('pingInterval', 25000)
                except Exception:
                    pass
            logger.info(f"Connection established, ping interval: {self.ping_interval}ms")

            self.ws.send("40")
            deadline = time.time() + 6
            while time.time() < deadline:
                msg = self.ws.recv()
                if msg == "40":
                    logger.info("Namespace connected ✓")
                    break
                if msg == "2":
                    self.ws.send("3")

            self.connected = True
            self.ping_thread = threading.Thread(target=self._send_ping, daemon=True)
            self.push_thread = threading.Thread(target=self._timed_push, daemon=True)
            self.save_thread = threading.Thread(target=self._disk_save_loop, daemon=True)
            for t in (self.ping_thread, self.push_thread, self.save_thread):
                t.start()
            return True

        except Exception as e:
            logger.error(f"Connection error: {e}")
            self.connected = False
            return False

    def disconnect(self):
        try:
            self.connected = False
            if self.ws:
                self.ws.close()
            logger.info("Disconnected")
        except Exception as e:
            logger.error(f"Disconnect error: {e}")

    def _send_watch_request(self):
        equation_dict = {}
        all_tokens = set()

        for s in self.instrument_settings:
            tokens = s.get("instrumentToken") or []
            if not tokens:
                continue
            token_fulls = [f"{t}_full" for t in tokens]
            all_tokens.update(token_fulls)
            duty = s["settingValue"][0]["Duty"] if s.get("settingValue") else 15
            equation_dict[s["_id"]] = {
                "equation":         s.get("equation", "L1"),
                "duty":             [{"Duty": duty}],
                "instrumentTokens": token_fulls,
                "settingName":      s["settingName"],
                "diffrenceValue":   s.get("diffrenceValue", 0),
                "reverse":          s.get("reverse", "0"),
            }

        payload = {
            "roomId":           self._generate_room_id(),
            "instrument_token": ",".join(sorted(all_tokens)),
            "marketType":       "badla",
            "uniqId":           "batch_badla",
            "equation":         equation_dict,
            "response_type":    "full",
            "duty":             [],
        }
        self.ws.send(f'42["watch-instruments",{json.dumps(payload)}]')
        logger.info(f"Sent watch-instruments for {len(equation_dict)} instruments")

    def _process_frame(self, raw: str):
        try:
            arr = json.loads(raw[2:])
            if arr[0] != "instrument-data":
                return
            items = arr[1].get("data", [])
            with self.price_lock:
                for item in items:
                    tok = str(item.get("instrument_token", ""))
                    lp = item.get("last_price")
                    if tok and lp is not None:
                        self.price_map[tok] = float(lp)
                        self.bid_map[tok]   = float(item.get("buy_price_0") or lp)
                        self.ask_map[tok]   = float(item.get("sell_price_0") or lp)
        except Exception as e:
            logger.debug(f"Frame parse error: {e}")

    def run(self):
        try:
            while True:
                if not self.connected or not self.ws or not self.ws.connected:
                    if not self.connect():
                        logger.warning("Reconnecting in 5s...")
                        time.sleep(5)
                        continue
                try:
                    self._send_watch_request()
                    time.sleep(0.2)
                    self.ws.settimeout(self.response_timeout)
                    logger.info("Subscribed — listening for live ticks...")
                    while True:
                        try:
                            msg = self.ws.recv()
                        except websocket.WebSocketTimeoutException:
                            continue
                        if msg in ("2", "3"):
                            self.ws.send("3") if msg == "2" else None
                            continue
                        if not msg.startswith("42"):
                            continue
                        self._process_frame(msg)
                except Exception as e:
                    logger.error(f"Connection lost: {e}")
                    self.connected = False
                    time.sleep(2)
        except KeyboardInterrupt:
            logger.info("Shutting down...")
        finally:
            self.disconnect()


if __name__ == "__main__":
    client = BadlaWebSocketClient()
    client.run()