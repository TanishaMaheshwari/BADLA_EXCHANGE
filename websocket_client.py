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
import requests
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

PUSH_URL = "http://localhost:3000/api/push"


class BadlaWebSocketClient:

    def __init__(self, data_dir="data", settings_file="instrument_settings.json", response_timeout=1.0):
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
        self.ping_interval = 25000
        self.connected = False
        self.response_timeout = response_timeout

        self.data_dir = data_dir
        os.makedirs(self.data_dir, exist_ok=True)

        self.settings_file = settings_file
        self.instrument_settings = self._load_instrument_settings()

        self.price_map: dict[str, float] = {}
        self.price_lock = threading.Lock()

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

    # ── equation evaluator ─────────────────────────────────────────────────────

    def _evaluate(self, instrument: dict) -> float | None:
        tokens = instrument.get("instrumentToken", [])
        equation = instrument.get("equation", "L1")
        duty_list = instrument.get("settingValue", [{"Duty": 15}])
        D1 = float(duty_list[0].get("Duty", 15)) if duty_list else 15.0

        with self.price_lock:
            prices = [self.price_map.get(str(t)) for t in tokens]

        if not prices or prices[0] is None:
            return None

        L1 = float(prices[0])
        L2 = float(prices[1]) if len(prices) > 1 and prices[1] is not None else 0.0
        L3 = float(prices[2]) if len(prices) > 2 and prices[2] is not None else 0.0

        try:
            result = eval(equation, {"__builtins__": {}}, {
                "L1": L1, "L2": L2, "L3": L3, "D1": D1,
                "Math": type('Math', (), {"round": round})(),
                "round": round, "abs": abs, "max": max, "min": min,
            })
            return float(result)
        except Exception as ex:
            logger.debug(f"Equation eval failed for {instrument.get('settingName')}: {ex}")
            return None

    # ── build push payload ─────────────────────────────────────────────────────

    def _build_push_payload(self, inst: dict) -> dict | None:
        tokens = inst.get("instrumentToken", [])
        if not tokens:
            return None

        instruments_detail = []
        for tok in tokens:
            price = self.price_map.get(str(tok))
            if price is None:
                continue
            detail = next(
                (d for d in inst.get("instrumentsDetail", [])
                 if str(d.get("instrument_token", "")) == str(tok)),
                {}
            )
            instruments_detail.append({
                "instrument_token": str(tok),
                "exchange":         detail.get("exchange", ""),
                "last_price":       price,
                "buy_price_0":      detail.get("buy_price_0") or price,
                "sell_price_0":     detail.get("sell_price_0") or price,
            })

        if len(instruments_detail) < 2:
            return None

        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        return {
            ts: {
                "timestamp":       ts,
                "instrument_id":   inst["_id"],
                "instrument_name": inst["settingName"],
                "badla_type":      inst.get("badlaType", "GOLD"),
                "reverse":         inst.get("reverse", "0"),
                "raw_data": {
                    "equation":    inst.get("equation", "L1"),
                    "displayName": inst.get("settingName"),
                    "data":        instruments_detail,
                }
            }
        }

    # ── push to server ─────────────────────────────────────────────────────────

    def _push_to_server(self, inst: dict):
        payload = self._build_push_payload(inst)
        if not payload:
            return
        try:
            requests.post(
                PUSH_URL,
                json={"name": inst["_id"], "data": payload},
                timeout=2
            )
        except Exception as e:
            logger.debug(f"Push failed for {inst['settingName']}: {e}")

    # ── save to disk ───────────────────────────────────────────────────────────

    def _save_data(self, instrument: dict, value: float):
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
            "timestamp":       ts,
            "instrument_id":   instrument["_id"],
            "instrument_name": setting_name,
            "computed_value":  value,
            "prices": {
                str(t): self.price_map.get(str(t))
                for t in instrument.get("instrumentToken", [])
            }
        }

        with open(filepath, 'w') as f:
            json.dump(existing, f, indent=4)

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
            self.ping_thread.start()
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
                        # also update buy/sell prices in instrumentsDetail
                        for inst in self.instrument_settings:
                            for detail in inst.get("instrumentsDetail", []):
                                if str(detail.get("instrument_token", "")) == tok:
                                    detail["buy_price_0"]  = item.get("buy_quantity") and item.get("last_price") or float(lp)
                                    detail["sell_price_0"] = item.get("sell_quantity") and item.get("last_price") or float(lp)
        except Exception as e:
            logger.debug(f"Frame parse error: {e}")

    # ── main loop ──────────────────────────────────────────────────────────────

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
                    time.sleep(0.5)
                    self.ws.settimeout(3.0)

                    cycle_start = time.time()
                    frames = 0

                    while True:
                        try:
                            msg = self.ws.recv()
                        except websocket.WebSocketTimeoutException:
                            if self.price_map:
                                saved = pushed = 0
                                for inst in self.instrument_settings:
                                    value = self._evaluate(inst)
                                    if value is not None:
                                        self._save_data(inst, value)
                                        self._push_to_server(inst)
                                        saved += 1
                                    pushed += 1
                                elapsed = time.time() - cycle_start
                                logger.info(
                                    f"Snapshot | elapsed={elapsed:.1f}s | frames={frames} | "
                                    f"pushed={saved}/{len(self.instrument_settings)} | "
                                    f"prices={len(self.price_map)}"
                                )
                                cycle_start = time.time()
                                frames = 0
                            else:
                                logger.warning("No prices yet, still waiting...")
                            continue

                        if msg in ("2", "3"):
                            continue
                        if not msg.startswith("42"):
                            continue

                        self._process_frame(msg)
                        frames += 1

                except Exception as e:
                    logger.error(f"Cycle error: {e}")
                    if not self.ws or not self.ws.connected:
                        time.sleep(1)

        except KeyboardInterrupt:
            logger.info("Shutting down...")
        finally:
            self.disconnect()


if __name__ == "__main__":
    client = BadlaWebSocketClient()
    client.run()