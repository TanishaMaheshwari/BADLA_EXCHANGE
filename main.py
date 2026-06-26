#!/usr/bin/env python3
"""Badla WebSocket client entrypoint."""

import argparse
import logging
import sys
from pathlib import Path
from websocket_client import BadlaWebSocketClient
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Badla WebSocket Client")
    p.add_argument("--data-dir",          default="data",                     help="Directory to store data (default: data)")
    p.add_argument("--settings-file",     default="instrument_settings.json", help="Instrument settings JSON (default: instrument_settings.json)")
    p.add_argument("--log-level",         default="INFO",                     choices=["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"])
    p.add_argument("--response-timeout",  default=1.0, type=float,            help="Response timeout in seconds (default: 1.0)")
    return p.parse_args()


def setup_logging(level: str, log_file: str = "badla_websocket.log") -> logging.Logger:
    logging.basicConfig(
        level=getattr(logging, level),
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        handlers=[
            logging.FileHandler(log_file),
            logging.StreamHandler(sys.stdout),
        ],
    )
    return logging.getLogger("BadlaMain")


def main() -> int:
    args   = parse_args()
    logger = setup_logging(args.log_level)

    logger.info("Starting Badla WebSocket Client")
    logger.info("  data-dir          : %s", args.data_dir)
    logger.info("  settings-file     : %s", args.settings_file)
    logger.info("  response-timeout  : %ss", args.response_timeout)

    try:
        BadlaWebSocketClient(
            data_dir=args.data_dir,
            settings_file=args.settings_file,
            response_timeout=args.response_timeout,
        ).run()
    except KeyboardInterrupt:
        logger.info("Shutdown requested — bye.")
    except Exception:
        logger.critical("Unhandled exception — exiting.", exc_info=True)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())