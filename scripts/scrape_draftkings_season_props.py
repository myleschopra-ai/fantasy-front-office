#!/usr/bin/env python3
"""Collect DraftKings NFL season-long player futures into the Vegas quote contract.

Uses DraftKings' public sportsbook JSON endpoints only. No authentication, CAPTCHA solving,
proxy rotation, geolocation evasion, or access-control circumvention is implemented.
The endpoint family is undocumented and therefore experimental; failures are expected to fail closed.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

NFL_EVENT_GROUP = "88808"
BASE = "https://sportsbook.draftkings.com/sites/US-SB/api/v5/eventgroups"
MARKET_MAP = {
    "passing yards": "passing_yards",
    "passing tds": "passing_touchdowns",
    "passing touchdowns": "passing_touchdowns",
    "interceptions": "interceptions",
    "rushing yards": "rushing_yards",
    "rushing tds": "rushing_touchdowns",
    "rushing touchdowns": "rushing_touchdowns",
    "receiving yards": "receiving_yards",
    "receiving tds": "receiving_touchdowns",
    "receiving touchdowns": "receiving_touchdowns",
    "receptions": "receptions",
}


def get_json(url: str) -> dict:
    req = Request(url, headers={"User-Agent": "FantasyFrontOffice/1.0 (+public-data-research)", "Accept": "application/json"})
    with urlopen(req, timeout=25) as resp:
        if resp.status != 200:
            raise RuntimeError(f"DraftKings returned HTTP {resp.status}")
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def norm_market(name: str | None) -> str | None:
    low = (name or "").strip().lower()
    for key, val in MARKET_MAP.items():
        if low == key or key in low:
            return val
    return None


def discover_categories(group: dict) -> list[dict]:
    eg = group.get("eventGroup") or {}
    return eg.get("offerCategories") or []


def select_player_futures(categories: list[dict]) -> list[dict]:
    out = []
    for c in categories:
        name = (c.get("name") or "").lower()
        if "player futures" in name or ("player" in name and "future" in name):
            out.append(c)
    return out


def flatten_offers(obj):
    if isinstance(obj, dict):
        if "outcomes" in obj and isinstance(obj["outcomes"], list):
            yield obj
        for v in obj.values():
            yield from flatten_offers(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from flatten_offers(v)


def parse_category(category_payload: dict, source_url: str) -> list[dict]:
    captured = datetime.now(timezone.utc).isoformat()
    quotes = []
    for offer in flatten_offers(category_payload):
        label = offer.get("label") or offer.get("name") or offer.get("marketName")
        market = norm_market(label)
        if not market:
            continue
        outcomes = offer.get("outcomes") or []
        if not outcomes:
            continue
        participant = None
        line = None
        over_odds = under_odds = None
        for o in outcomes:
            participant = participant or o.get("participant") or o.get("participantName") or o.get("label")
            if o.get("line") is not None:
                try:
                    line = float(o.get("line"))
                except Exception:
                    pass
            side = str(o.get("label") or o.get("outcomeType") or "").lower()
            odds = o.get("oddsAmerican") or o.get("odds")
            if "over" in side:
                over_odds = odds
            elif "under" in side:
                under_odds = odds
        if not participant or line is None:
            continue
        quotes.append({
            "player_key": slug(str(participant)),
            "player_name": str(participant),
            "position": None,
            "book": "DraftKings",
            "market": market,
            "line": line,
            "over_odds": over_odds,
            "under_odds": under_odds,
            "updated_at": captured,
            "source_url": source_url,
            "source_type": "public_undocumented_api",
        })
    return quotes


def scrape() -> dict:
    group_url = f"{BASE}/{NFL_EVENT_GROUP}/?format=json"
    group = get_json(group_url)
    cats = select_player_futures(discover_categories(group))
    if not cats:
        raise RuntimeError("DraftKings Player Futures category not found")
    quotes = []
    for c in cats:
        cid = c.get("offerCategoryId") or c.get("offerCategoryIdStr") or c.get("id")
        if cid is None:
            continue
        category_url = f"{BASE}/{NFL_EVENT_GROUP}/categories/{cid}?format=json"
        payload = get_json(category_url)
        quotes.extend(parse_category(payload, category_url))
    if not quotes:
        raise RuntimeError("No recognized season-long player futures parsed from DraftKings")
    return {
        "version": 1,
        "provider": "draftkings_public",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "quotes": quotes,
    }


def self_test():
    sample = {"offerCategories":[{"offerCategory":{"offers":[[{"label":"Passing Yards","outcomes":[{"participant":"Test QB","label":"Over","line":4050.5,"oddsAmerican":-110},{"participant":"Test QB","label":"Under","line":4050.5,"oddsAmerican":-110}]}]]}}]}
    q = parse_category(sample, "test")
    assert len(q) == 1 and q[0]["market"] == "passing_yards" and q[0]["line"] == 4050.5, q
    print("self-test passed")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        self_test(); return
    if not args.output:
        ap.error("--output is required")
    data = scrape()
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"wrote {len(data['quotes'])} DraftKings quotes to {out}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"scrape failed: {exc}", file=sys.stderr)
        raise
