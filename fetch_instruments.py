"""
fetch_instruments.py
────────────────────
Fetches the latest instrument list and updates instrument_settings.json.

HOW IT WORKS:
  1. Calls your local Node server (localhost:3000) to get currently streaming
     instruments — these already have valid tokens.
  2. Calls the live badla site API (with your session token) to pick up any
     NEW instruments not yet in your local server.
  3. Merges everything into instrument_settings.json.

SETUP:
  1. Make sure main.py is running (local Node server must be up)
  2. Get your session token from browser console:
       localStorage.getItem('badla_token')
  3. Set it:
       export BADLA_TOKEN="your_token_here"
  4. Run:
       python3 fetch_instruments.py

OPTIONS:
  --dry-run       Preview changes without saving
  --local-only    Only use local Node server (no live site call)
  --token TOKEN   Pass token directly instead of env var
"""

import requests
import json
import os
import sys
import argparse
import logging
from datetime import datetime, UTC

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("fetch_instruments")

# ── Config ─────────────────────────────────────────────────────────────────────
LOCAL_URL      = "http://localhost:3000"
LIVE_URL       = "https://badla.dgexch.com"
SETTINGS_FILE  = "instrument_settings.json"

# Live site API paths to try for new instruments
LIVE_API_PATHS = [
    "/api/instrument-settings",
    "/api/instruments",
    "/api/settings",
    "/api/market/instruments",
]


def utc_now():
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def load_json(path):
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)


def save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    log.info(f"Saved → {path}")


# ── Step 1: get instruments from local Node server ─────────────────────────────
def fetch_local(token):
    """
    GET localhost:3000/api/prices  → returns latestPrices (all streaming instruments)
    Each entry has: name, displayName, type, badlaBUY, badlaSELL, badlaLTP, ...
    We use this to know which instrument names/tokens are currently valid.
    """
    log.info("Step 1 — fetching from local Node server…")
    try:
        r = requests.get(
            f"{LOCAL_URL}/api/prices",
            headers={"x-session-token": token, "accessToken": token, "Authorization": f"Bearer {token}"},
            timeout=5,
        )
        if r.status_code == 401:
            log.error("Local server returned 401 — token may be expired, re-login in browser")
            return []
        if r.status_code != 200:
            log.warning(f"Local server returned {r.status_code}")
            return []
        data = r.json()
        log.info(f"  Local server: {len(data)} instruments currently streaming")
        return data
    except requests.exceptions.ConnectionError:
        log.warning("  Local server not reachable — is main.py running?")
        return []
    except Exception as e:
        log.warning(f"  Local server error: {e}")
        return []


# ── Step 2: get fresh instrument settings from live site ───────────────────────
def fetch_live(token):
    """
    Try known API paths on the live site to get the full instrument settings list.
    This is where new instruments (new month contracts) appear first.
    """
    log.info("Step 2 — fetching from live site…")
    session = requests.Session()
    session.headers.update({
        "Accept":           "application/json",
        "Origin":           LIVE_URL,
        "Referer":          LIVE_URL + "/",
        "User-Agent":       "Mozilla/5.0",
        "x-session-token":  token,
        "accessToken":      token,
        "Authorization":    f"Bearer {token}",
        "x-access-token":   token,
    })
    # Also set as cookie — some apps use cookie-based auth
    session.cookies.set("accessToken", token, domain="badla.dgexch.com")
    session.cookies.set("token",       token, domain="badla.dgexch.com")

    for path in LIVE_API_PATHS:
        try:
            r = session.get(f"{LIVE_URL}{path}", timeout=10)
            log.debug(f"  {path} → {r.status_code}")
            if r.status_code == 200:
                data = r.json()
                instruments = extract_instrument_list(data)
                if instruments:
                    log.info(f"  ✓ Found {len(instruments)} instruments at {path}")
                    return instruments
        except Exception as e:
            log.debug(f"  {path} error: {e}")

    log.warning("  Could not fetch from live site — will use local data only")
    return []


def extract_instrument_list(data):
    """Extract instrument list from various response shapes."""
    if isinstance(data, list) and data and isinstance(data[0], dict):
        if "settingName" in data[0] or "instrumentToken" in data[0]:
            return data
    if isinstance(data, dict):
        for key in ("data", "instruments", "settings", "result"):
            val = data.get(key)
            if isinstance(val, list) and val and isinstance(val[0], dict):
                if "settingName" in val[0] or "instrumentToken" in val[0] or "_id" in val[0]:
                    return val
    return None


# ── Step 3: merge everything into instrument_settings.json ─────────────────────
def merge(local_prices, live_instruments, existing_settings):
    """
    Merge strategy:
    - existing_settings is the base (has equation, duty, settingValue etc.)
    - live_instruments updates/adds entries (new months, new instruments)
    - local_prices confirms which tokens are currently valid (last_price update)
    """
    existing = {i["_id"]: i for i in existing_settings if "_id" in i}
    added = updated = price_updated = 0

    # Build a name→price map from local server
    price_map = {p["name"]: p for p in local_prices}

    # Apply live instruments (new/updated)
    if live_instruments:
        live_map = {i["_id"]: i for i in live_instruments if "_id" in i}
        for uid, inst in live_map.items():
            if uid in existing:
                # Merge: live overwrites existing fields
                existing[uid] = {**existing[uid], **inst, "updatedAt": utc_now()}
                updated += 1
            else:
                existing[uid] = {**inst, "updatedAt": utc_now()}
                added += 1
                log.info(f"  + New: {inst.get('settingName', uid)}")

    # Apply local price data to update last_price in instrumentsDetail
    for uid, inst in existing.items():
        name = inst.get("settingName", "")
        p = price_map.get(name)
        if not p:
            continue
        # Update last_price in each instrumentsDetail entry
        for detail in inst.get("instrumentsDetail", []):
            exchange = detail.get("exchange", "").upper()
            new_price = None
            if exchange == "MCX"   and p.get("mcx"):   new_price = p["mcx"].get("ltp")
            if exchange == "COMEX" and p.get("comex"): new_price = p["comex"].get("ltp")
            if exchange == "DGCX"  and p.get("dgcx"):  new_price = p["dgcx"].get("ltp")
            if new_price is not None:
                detail["last_price"] = str(new_price)
                price_updated += 1

    log.info(f"Merge result: {added} added, {updated} updated from live, {price_updated} prices refreshed")
    return list(existing.values()), added, updated


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Fetch and update instrument_settings.json")
    parser.add_argument("--token",      help="Session token (or set BADLA_TOKEN env var)")
    parser.add_argument("--settings",   default=SETTINGS_FILE)
    parser.add_argument("--dry-run",    action="store_true", help="Preview without saving")
    parser.add_argument("--local-only", action="store_true", help="Skip live site, use local server only")
    args = parser.parse_args()

    token = args.token or os.environ.get("BADLA_TOKEN", "").strip()
    if not token:
        log.error(
            "No token found.\n\n"
            "  1. Open your badla app in browser\n"
            "  2. Open DevTools Console (F12)\n"
            "  3. Run: copy(localStorage.getItem('badla_token'))\n"
            "  4. Then: export BADLA_TOKEN=\"paste_here\"\n"
            "  5. Run this script again\n"
        )
        return 1

    script_dir    = os.path.dirname(os.path.abspath(__file__))
    settings_path = args.settings if os.path.isabs(args.settings) else os.path.join(script_dir, args.settings)

    log.info("=" * 60)
    log.info(f"fetch_instruments.py — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log.info(f"Settings: {settings_path}")
    log.info(f"Dry run : {args.dry_run}")
    log.info("=" * 60)

    # Load existing
    existing_raw  = load_json(settings_path) or {"data": []}
    existing_list = existing_raw.get("data", [])
    log.info(f"Existing instruments: {len(existing_list)}")

    # Fetch
    local_prices    = fetch_local(token)
    live_instruments = [] if args.local_only else fetch_live(token)

    if not local_prices and not live_instruments:
        log.error("No data from either source — nothing to update")
        return 1

    # Merge
    merged, added, updated = merge(local_prices, live_instruments, existing_list)

    log.info("-" * 60)
    log.info(f"Total instruments after merge: {len(merged)}")

    if args.dry_run:
        log.info("Dry run — not saving. First 2 entries:")
        print(json.dumps(merged[:2], indent=2))
        return 0

    output = {
        "status":    True,
        "message":   "data found.",
        "data":      merged,
        "updatedAt": utc_now(),
    }
    save_json(settings_path, output)
    log.info("Done ✓")

    if added > 0:
        log.info(f"\n{added} new instrument(s) added — restart main.py to subscribe them")

    return 0


if __name__ == "__main__":
    sys.exit(main())