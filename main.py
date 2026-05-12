#!/usr/bin/env python3
"""
Main script to run the Badla WebSocket client.
"""

import argparse
import logging
import sys
from websocket_client import BadlaWebSocketClient

def main():
    """Main function to run the WebSocket client."""
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Badla WebSocket Client')
    parser.add_argument('--data-dir', type=str, default='data',
                        help='Directory to store data (default: data)')
    parser.add_argument('--settings-file', type=str, default='instrument_settings.json',
                        help='Path to instrument settings JSON file (default: instrument_settings.json)')
    parser.add_argument('--log-level', type=str, default='INFO',
                        choices=['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'],
                        help='Logging level (default: INFO)')
    parser.add_argument('--response-timeout', type=float, default=1.0,
                        help='Timeout in seconds for receiving responses (default: 1.0)')
    args = parser.parse_args()

    # Configure logging
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler("badla_websocket.log"),
            logging.StreamHandler(sys.stdout)
        ]
    )
    logger = logging.getLogger("BadlaMain")

    logger.info(f"Starting Badla WebSocket Client with data directory: {args.data_dir}")
    logger.info(f"Using settings file: {args.settings_file}")
    logger.info(f"Response timeout: {args.response_timeout} seconds")

    try:
        # Create and run the WebSocket client
        client = BadlaWebSocketClient(
            data_dir=args.data_dir, 
            settings_file=args.settings_file,
            response_timeout=args.response_timeout
        )
        client.run()
    except KeyboardInterrupt:
        logger.info("Keyboard interrupt received, shutting down...")
    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
        return 1
    
    return 0

if __name__ == "__main__":
    sys.exit(main()) 