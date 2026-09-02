#!/usr/bin/env python3
"""Quota-aware collector for The Odds API free tier; never scrapes sportsbooks."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from data_foundation import normalize_name, utc_now, write_json_atomic

BASE = "https://api.the-odds-api.com/v4"
SPORT = "americanfootball_nfl"
DEFAULT_MARKETS = ["player_pass_yds", "player_rush_yds", "player_reception_yds"]
MARKET_NAMES = {
    "player_pass_yds": "passing_yards", "player_pass_tds": "passing_touchdowns",
    "player_rush_yds": "rushing_yards", "player_reception_yds": "receiving_yards",
    "player_receptions": "receptions", "player_anytime_td": "anytime_touchdown",
}


def get_json(path: str, params: dict[str, str]) -> tuple[object, dict[str, str]]:
    request = Request(f"{BASE}{path}?{urlencode(params)}", headers={"User-Agent": "FantasyFrontOffice/2.0", "Accept": "application/json"})
    with urlopen(request, timeout=45) as response:
        return json.loads(response.read().decode("utf-8")), {key.lower(): value for key, value in response.headers.items()}


def normalize_event(event: dict, retrieved_at: str) -> list[dict]:
    quotes = []
    for bookmaker in event.get("bookmakers", []):
        for market in bookmaker.get("markets", []):
            normalized_market = MARKET_NAMES.get(market.get("key"))
            if not normalized_market:
                continue
            grouped: dict[str, dict] = {}
            for outcome in market.get("outcomes", []):
                player_name = outcome.get("description") or outcome.get("name")
                if not player_name:
                    continue
                item = grouped.setdefault(normalize_name(player_name), {
                    "player_key": normalize_name(player_name), "player_name": player_name,
                    "market": normalized_market, "book": bookmaker.get("key"),
                    "event_id": event.get("id"), "commence_time": event.get("commence_time"),
                    "updated_at": market.get("last_update") or bookmaker.get("last_update") or retrieved_at,
                    "source_type": "documented_api", "projection_scope": "weekly",
                })
                side = str(outcome.get("name") or "").lower()
                if outcome.get("point") is not None:
                    item["line"] = outcome["point"]
                if side in {"over", "yes"}:
                    item["over_odds" if side == "over" else "yes_odds"] = outcome.get("price")
                elif side in {"under", "no"}:
                    item["under_odds" if side == "under" else "no_odds"] = outcome.get("price")
            quotes.extend(grouped.values())
    return quotes


def collect(api_key: str, markets: list[str], max_events: int, reserve_credits: int) -> dict:
    retrieved_at = utc_now()
    events, event_headers = get_json(f"/sports/{SPORT}/events", {"apiKey": api_key})
    quotes, inspected, remaining = [], 0, int(event_headers.get("x-requests-remaining", "999999"))
    for event in list(events)[:max_events]:
        if remaining <= reserve_credits:
            break
        payload, headers = get_json(
            f"/sports/{SPORT}/events/{event['id']}/odds",
            {"apiKey": api_key, "regions": "us", "markets": ",".join(markets), "oddsFormat": "american"},
        )
        quotes.extend(normalize_event(payload, retrieved_at))
        inspected += 1
        remaining = int(headers.get("x-requests-remaining", remaining))
    return {
        "version": 1, "provider": "the_odds_api", "source_type": "documented_api",
        "source_url": "https://the-odds-api.com/sports/nfl-odds.html", "retrieved_at": retrieved_at,
        "projection_scope": "weekly", "markets_requested": markets, "events_inspected": inspected,
        "quota": {"remaining": remaining, "reserve": reserve_credits, "stopped_for_reserve": remaining <= reserve_credits},
        "quotes": quotes,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--markets", nargs="+", default=DEFAULT_MARKETS, choices=sorted(MARKET_NAMES))
    parser.add_argument("--max-events", type=int, default=8)
    parser.add_argument("--reserve-credits", type=int, default=100)
    parser.add_argument("--output", type=Path, default=Path("data/vegas/the-odds-api-weekly.json"))
    args = parser.parse_args()
    key = os.getenv("THE_ODDS_API_KEY")
    if not key:
        raise SystemExit("THE_ODDS_API_KEY is required; use a free account key and store it only in the environment")
    payload = collect(key, args.markets, max(1, args.max_events), max(0, args.reserve_credits))
    write_json_atomic(args.output, payload)
    print(json.dumps({"quotes": len(payload["quotes"]), "events": payload["events_inspected"], "quota": payload["quota"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
