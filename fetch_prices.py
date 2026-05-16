#!/usr/bin/env python3
"""
Fetches real Steam Community Market prices for all CS2 case items.
Saves to prices.json which the frontend reads automatically.

Usage: python3 fetch_prices.py
"""

import json
import time
import urllib.request
import urllib.parse
import os
import sys

CRATES_URL = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/crates.json'
STEAM_PRICE_URL = 'https://steamcommunity.com/market/priceoverview/'
CACHE_FILE = 'prices.json'
DELAY = 1.8  # seconds between Steam API requests (stay under rate limit)


def fetch_steam_price(market_hash_name):
    """Fetch the lowest/median price for an item from Steam Market."""
    params = urllib.parse.urlencode({
        'appid': '730',
        'currency': '1',  # USD
        'market_hash_name': market_hash_name
    })
    url = f"{STEAM_PRICE_URL}?{params}"
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
            if data.get('success'):
                price_str = data.get('lowest_price') or data.get('median_price')
                if price_str:
                    price_str = price_str.replace('$', '').replace(',', '').strip()
                    return round(float(price_str), 2)
    except Exception as e:
        # Rate limited or item not found
        err = str(e)
        if '429' in err:
            print(f"\n⚠ Rate limited! Waiting 30s...")
            time.sleep(30)
            return fetch_steam_price(market_hash_name)  # Retry
    return None


def main():
    # Load existing cache
    cache = {}
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, 'r') as f:
            cache = json.load(f)
        print(f"Loaded {len(cache)} cached prices from {CACHE_FILE}")

    # Fetch crates database
    print("Fetching CS2 crates database...")
    req = urllib.request.Request(CRATES_URL, headers={
        'User-Agent': 'Mozilla/5.0'
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        all_crates = json.loads(resp.read())

    cases = [c for c in all_crates if c.get('type') == 'Case' and c.get('contains')]
    cases.sort(key=lambda c: c.get('first_sale_date', ''), reverse=True)
    print(f"Found {len(cases)} weapon cases\n")

    # ── Collect everything we need to price ──
    to_fetch = []  # (market_hash_name, description)
    seen = set(cache.keys())

    # 1. Case prices
    for case in cases:
        mhn = case.get('market_hash_name')
        if mhn and mhn not in seen:
            to_fetch.append((mhn, f"📦 {case['name']}"))
            seen.add(mhn)

    # 2. Skin prices – we fetch Field-Tested (most common/liquid)
    #    Frontend derives other wears from multipliers.
    #    Skins like Doppler, Fade, Marble Fade only exist in FN/MW, so we also fetch FN.
    for case in cases:
        all_items = case.get('contains', []) + case.get('contains_rare', [])
        for item in all_items:
            name = item.get('name', '')
            if not name:
                continue
            mhn_ft = f"{name} (Field-Tested)"
            mhn_fn = f"{name} (Factory New)"
            # We want to fetch FT, but if it fails we might need FN, so track the base name
            if mhn_ft not in seen and mhn_fn not in seen:
                to_fetch.append((name, f"🔫 {name}"))
                # Note: we don't add to seen yet, we'll add the specific wear when we fetch
                seen.add(mhn_ft)

    total = len(to_fetch)
    if total == 0:
        print("✅ All prices already cached! Nothing to fetch.")
        return

    est_min = int(total * DELAY / 60)
    print(f"Need to fetch {total} prices (estimated ~{est_min} minutes)")
    print(f"Progress will be saved every 10 items.\n")

    fetched = 0
    found = 0
    for target, desc in to_fetch:
        fetched += 1
        short_desc = desc[:55].ljust(55)
        sys.stdout.write(f"\r[{fetched}/{total}] {short_desc}")
        sys.stdout.flush()

        if desc.startswith("📦"):
            # It's a case, target is the exact market hash name
            mhn = target
            price = fetch_steam_price(mhn)
            if price is not None:
                cache[mhn] = price
                found += 1
        else:
            # It's a skin, target is the base name
            # First try Field-Tested
            mhn_ft = f"{target} (Field-Tested)"
            price = fetch_steam_price(mhn_ft)
            if price is not None:
                cache[mhn_ft] = price
                found += 1
            else:
                # Fallback to Factory New for skins like Fade/Doppler
                time.sleep(DELAY)
                mhn_fn = f"{target} (Factory New)"
                price = fetch_steam_price(mhn_fn)
                if price is not None:
                    cache[mhn_fn] = price
                    found += 1

        # Save progress every 10 items
        if fetched % 10 == 0:
            with open(CACHE_FILE + '.tmp', 'w') as f:
                json.dump(cache, f)
            os.rename(CACHE_FILE + '.tmp', CACHE_FILE)

        if fetched < total:
            time.sleep(DELAY)

    # Final save
    with open(CACHE_FILE + '.tmp', 'w') as f:
        json.dump(cache, f, indent=2)
    os.rename(CACHE_FILE + '.tmp', CACHE_FILE)

    print(f"\n\n✅ Done! Fetched {found}/{total} prices successfully.")
    print(f"Total cached: {len(cache)} prices in {CACHE_FILE}")
    print(f"The frontend will automatically pick up these prices on next refresh.")


if __name__ == '__main__':
    main()
