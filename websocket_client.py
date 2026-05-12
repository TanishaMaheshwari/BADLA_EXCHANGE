import websocket
import json
import ssl
import time
import threading
import random
import string
import logging
from datetime import datetime
import os
import sys
from logging.handlers import RotatingFileHandler

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        RotatingFileHandler(
            "badla_websocket.log",
            maxBytes=5 * 1024 * 1024,  # 5MB
            backupCount=2
        ),
        logging.StreamHandler(sys.stdout)
    ]
)

logger = logging.getLogger("BadlaWebSocket")
class BadlaWebSocketClient:
    """
    WebSocket client for connecting to the Badla market data service.
    Fetches real-time market data for specified instruments and saves raw responses.
    """
    
    def __init__(self, data_dir="data", settings_file="instrument_settings.json", response_timeout=0.5):
        """Initialize the WebSocket client with configuration."""
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
        self.ping_interval = 25000  # Default ping interval in ms
        self.connected = False
        self.response_timeout = response_timeout  # Timeout for receiving responses in seconds
        
        # Create data directory if it doesn't exist
        self.data_dir = data_dir
        os.makedirs(self.data_dir, exist_ok=True)
        
        # Settings file path
        self.settings_file = settings_file
        
        # Load instrument settings
        self.instrument_settings = self._load_instrument_settings()
        
        # Generate unique room IDs for each setting
        self.room_ids = {setting["settingName"]: self._generate_room_id() for setting in self.instrument_settings}
        
        # Map to track which setting each uniqId belongs to
        self.uniqid_to_setting = {setting["_id"]: setting for setting in self.instrument_settings}
        
    def _generate_room_id(self):
        """Generate a random room ID for the WebSocket connection."""
        return ''.join(random.choices(string.ascii_letters + string.digits, k=5))
    
    def _load_instrument_settings(self):
        """Load instrument settings from the JSON file."""
        try:
            with open(self.settings_file, 'r') as f:
                settings_data = json.load(f)
                return settings_data["data"]
        except Exception as e:
            logger.error(f"Failed to load instrument settings from {self.settings_file}: {e}")
            return []
    
    def _send_ping(self):
        """Send periodic ping messages to keep the connection alive."""
        while self.connected:
            try:
                if self.ws and self.ws.connected:
                    self.ws.send("2")  # "2" is the ping message in socket.io v3
                    time.sleep(self.ping_interval / 1000)  # Convert ms to seconds
                else:
                    break
            except Exception as e:
                logger.error(f"Error sending ping: {e}")
                break

    def _push_to_server(self, data, setting_name):
        """Push latest data to Node server via HTTP POST — runs in background thread."""
        try:
            payload = json.dumps({"name": setting_name, "data": data}).encode()
            req = __import__('urllib.request', fromlist=['Request', 'urlopen'])
            request = req.Request(
                "http://localhost:3000/api/push",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            req.urlopen(request, timeout=0.5)
        except Exception:
            pass  # Never block the main loop on push failure

    def _write_file(self, save_data, filepath):
        """Write data to file — runs in background thread."""
        try:
            with open(filepath, 'w') as f:
                json.dump(save_data, f, indent=4)
            # logger.info(f"Data saved to {filepath}")
        except Exception as e:
            logger.error(f"Error writing file {filepath}: {e}")

    def _save_data(self, data, setting_name):
        """
        Push to Node server immediately (fast path),
        
        then write to disk in a background thread (non-blocking).
        """
        try:
            timestamp = data.get("timestamp", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
            save_data = {timestamp: data}

            # ── 1. Push to Node FIRST — no waiting ──────────────────────────
            threading.Thread(
                target=self._push_to_server,
                args=(save_data, setting_name),
                daemon=True
            ).start()

            # ── 2. Write file in background — doesn't slow down recv() ──────
            safe_name = ''.join(c if c.isalnum() else '_' for c in setting_name).strip('_')
            filepath = os.path.join(self.data_dir, f"{safe_name}.json")
            threading.Thread(
                target=self._write_file,
                args=(save_data, filepath),
                daemon=True
            ).start()

        except Exception as e:
            logger.error(f"Error in _save_data for {setting_name}: {e}")

    def _process_market_data(self, message):
        """
        Process the market data received from the WebSocket.
        
        Args:
            message (str): The WebSocket message
        
        Returns:
            tuple: (processed_data, setting_name) or (None, None) if processing fails
        """
        try:
            # Remove the Socket.IO prefix (42["event-name", ...])
            if message.startswith("42"):
                data = json.loads(message[2:])
                
                if len(data) >= 2 and data[0] == "get-instrument":
                    # Get the instrument ID from the response
                    instrument_id = data[1].get('uniqId')
                    
                    # Find the corresponding instrument setting
                    if instrument_id in self.uniqid_to_setting:
                        instrument_setting = self.uniqid_to_setting[instrument_id]
                        setting_name = instrument_setting["settingName"]
                        
                        # Create a data structure with the raw response and metadata
                        current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        
                        result = {
                            "timestamp": current_time,
                            "instrument_id": instrument_id,
                            "instrument_name": setting_name,
                            "badla_type": instrument_setting["badlaType"],
                            "room_id": self.room_ids[setting_name],
                            "raw_data": data[1]
                        }
                        
                        return result, setting_name
            
            return None, None
        except Exception as e:
            logger.error(f"Error processing market data: {e}")
            return None, None
    
    def _send_all_instrument_requests(self):
        """Send requests for all instrument data at once."""
        # logger.info("Sending all instrument requests together")
        
        for instrument_setting in self.instrument_settings:
            try:
                room_id = self.room_ids[instrument_setting["settingName"]]
                instrument_tokens = [f"{token}_full" for token in instrument_setting["instrumentToken"]]
                token_string = ",".join(instrument_tokens)
                
                payload = {
                    "roomId": room_id,
                    "instrument_token": token_string,
                    "marketType": "badla",
                    "uniqId": instrument_setting["_id"],
                    "equation": instrument_setting["equation"],
                    "response_type": "full",
                    "duty": instrument_setting["settingValue"][0]["Duty"]
                }
                
                message = f'42["set-instrument",{json.dumps(payload)}]'
                
                if self.ws and self.ws.connected:
                    self.ws.send(message)
                    # logger.info(f"Sent request for {instrument_setting['settingName']} with room ID {room_id}")
                else:
                    logger.warning("WebSocket not connected, cannot send request")
            except Exception as e:
                logger.error(f"Error sending instrument request: {e}")
    
    def connect(self):
        """Establish a WebSocket connection to the server."""
        try:
            ssl_context = ssl.create_default_context()
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE
            
            self.ws = websocket.create_connection(
                self.ws_url,
                header=self.headers,
                sslopt={"context": ssl_context}
            )
            
            initial_message = self.ws.recv()
            if initial_message.startswith("0"):
                try:
                    init_data = json.loads(initial_message[1:])
                    self.ping_interval = init_data.get('pingInterval', 25000)
                    logger.info(f"Connection established, ping interval: {self.ping_interval}ms")
                except json.JSONDecodeError:
                    logger.warning("Failed to parse initial message")
            
            self.connected = True
            self.ping_thread = threading.Thread(target=self._send_ping)
            self.ping_thread.daemon = True
            self.ping_thread.start()
            
            return True
        except Exception as e:
            logger.error(f"Error connecting to WebSocket: {e}")
            self.connected = False
            return False
    
    def disconnect(self):
        """Disconnect from the WebSocket server."""
        try:
            self.connected = False
            if self.ws:
                self.ws.close()
            logger.info("Disconnected from WebSocket server")
        except Exception as e:
            logger.error(f"Error disconnecting from WebSocket: {e}")
    
    def run(self):
        """Run the WebSocket client continuously."""
        try:
            while True:
                if not self.connected or not self.ws or not self.ws.connected:
                    if not self.connect():
                        logger.warning("Failed to connect, retrying in 5 seconds...")
                        time.sleep(5)
                        continue
                
                try:
                    self._send_all_instrument_requests()
                    self.ws.settimeout(self.response_timeout)
                    
                    responses_received = 0
                    expected_responses = len(self.instrument_settings)
                    start_time = time.time()
                    
                    while responses_received < expected_responses:
                        try:
                            received_message = self.ws.recv()
                            
                            if received_message in ["2", "3"]:
                                continue
                            
                            if received_message.startswith("42"):
                                processed_data, setting_name = self._process_market_data(received_message)
                                if processed_data and setting_name:
                                    # _save_data now returns immediately —
                                    # push + file write both happen in background threads
                                    self._save_data(processed_data, setting_name)
                                    responses_received += 1
                                    # logger.info(f"Received response {responses_received}/{expected_responses}")
                        
                        except websocket.WebSocketTimeoutException:
                            logger.warning(f"Timeout ({self.response_timeout}s) waiting for responses. Received {responses_received}/{expected_responses}")
                            break
                    
                    elapsed_time = time.time() - start_time
                    # logger.info(f"Completed cycle in {elapsed_time:.2f}s — {responses_received}/{expected_responses} responses")
                    
                except Exception as e:
                    logger.error(f"Error in request-response cycle: {e}")
                    if not self.ws or not self.ws.connected:
                        logger.warning("Connection lost, will reconnect")
                        time.sleep(1)
                        continue
                
                # logger.info("Starting next cycle immediately")
                
        except KeyboardInterrupt:
            logger.info("Keyboard interrupt received, shutting down...")
        except Exception as e:
            logger.error(f"Unexpected error: {e}")
        finally:
            self.disconnect()

if __name__ == "__main__":
    client = BadlaWebSocketClient()
    client.run()