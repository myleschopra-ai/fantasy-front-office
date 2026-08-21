#!/usr/bin/env python3
"""Collect SharpAPI NFL regular-season player props into the Vegas quote contract.

The key is read only from SHARP_API_KEY (or another explicitly named environment
variable). It is never accepted on the command line or written to output.
Event-specific props are rejected by default.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

DEFAULT_BASE_URL = "https://api.sharpapi.io/api/v1"
MARKET_ALIASES = {
    "passing_yards": "passing_yards", "player_passing_yards": "passing_yards",
    "passing_touchdowns": "passing_touchdowns", "player_passing_touchdowns": "passing_touchdowns",
    "passing_tds": "passing_touchdowns", "interceptions": "interceptions",
    "player_interceptions": "interceptions", "rushing_yards": "rushing_yards",
    "player_rushing_yards": "rushing_yards", "rushing_touchdowns": "rushing_touchdowns",
    "player_rushing_touchdowns": "rushing_touchdowns", "receiving_yards": "receiving_yards",
    "player_receiving_yards": "receiving_yards", "receiving_touchdowns": "receiving_touchdowns",
    "player_receiving_touchdowns": "receiving_touchdowns", "receptions": "receptions",
    "player_receptions": "receptions",
    "anytime_td": "anytime_touchdown", "anytime_touchdown": "anytime_touchdown",
    "touchdowns": "touchdowns", "player_touchdowns": "touchdowns",
}
SEASON_MARKERS = ("regular season", "season", "season_long", "season-long", "future")
FREE_TIER_MIN_INTERVAL_SECONDS = 5.25


class SharpRateLimitError(RuntimeError):
    def __init__(self, retry_after: float, detail: str = ""):
        super().__init__(detail or f"SharpAPI rate limit reached; retry after {retry_after:.0f} seconds")
        self.retry_after = max(1.0, min(60.0, float(retry_after or 60)))


class NoSupportedMarketsError(RuntimeError):
    pass


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def canonical_market(row: dict) -> str | None:
    for value in (row.get("stat_category"), row.get("market_type"), row.get("market")):
        normalized = re.sub(r"[^a-z0-9]+", "_", str(value or "").lower()).strip("_")
        if normalized in MARKET_ALIASES:
            return MARKET_ALIASES[normalized]
        for alias, market in MARKET_ALIASES.items():
            if normalized.endswith(alias):
                return market
    return None


def is_season_row(row: dict) -> bool:
    text = " ".join(str(row.get(key) or "") for key in (
        "event_id", "event_name", "market_type", "market", "market_id", "market_segment", "stat_category"
    )).lower()
    return any(marker in text for marker in SEASON_MARKERS)


def fetch_page(api_key: str, base_url: str, offset: int = 0, limit: int = 200, cursor: str | None = None) -> dict:
    params = {"sport": "football", "league": "nfl", "live": "false", "limit": limit}
    # SharpAPI caps offset pagination at 500. All deeper pages must use the
    # opaque cursor returned by the immediately preceding response.
    if cursor:
        params["cursor"] = cursor
    else:
        params["offset"] = min(int(offset or 0), 500)
    query = urlencode(params)
    url = f"{base_url.rstrip('/')}/odds?{query}"
    request = Request(url, headers={"X-API-Key": api_key, "Accept": "application/json"})
    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8", errors="replace"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:300]
        if exc.code == 429:
            retry_after = exc.headers.get("Retry-After")
            try:
                body = json.loads(detail)
                error = body.get("error") or {}
                retry_after = error.get("retryAfter") or error.get("retry_after") or retry_after
            except (json.JSONDecodeError, AttributeError):
                pass
            raise SharpRateLimitError(float(retry_after or 60), detail) from exc
        raise RuntimeError(f"SharpAPI returned HTTP {exc.code}: {detail}") from exc


def fetch_all_rows(api_key: str, base_url: str, max_pages: int = 20, limit: int = 200) -> tuple[list[dict], int]:
    rows, offset, cursor, pages = [], 0, None, 0
    for _ in range(max_pages):
        if pages:
            time.sleep(FREE_TIER_MIN_INTERVAL_SECONDS)
        try:
            payload = fetch_page(api_key, base_url, offset=offset, limit=limit, cursor=cursor)
        except SharpRateLimitError as exc:
            # Preserve the same cursor and retry this page once after the
            # provider-declared reset window. Never spin indefinitely.
            time.sleep(exc.retry_after)
            payload = fetch_page(api_key, base_url, offset=offset, limit=limit, cursor=cursor)
        pages += 1
        batch = payload.get("data") or []
        rows.extend(batch)
        pagination = payload.get("pagination") or {}
        if not pagination.get("has_more") or not batch:
            break
        next_cursor = pagination.get("next_cursor")
        if next_cursor:
            cursor = str(next_cursor)
        elif offset < 500:
            offset = min(500, int(pagination.get("next_offset") or (offset + len(batch))))
        else:
            raise RuntimeError("SharpAPI indicated more data but did not return the required next_cursor")
    return rows, pages


def parse_rows(rows: list[dict], captured_at: str, include_event_props: bool = False) -> tuple[list[dict], dict]:
    groups: dict[tuple, dict] = {}
    rejected = {"unsupported_market": 0, "not_season_long": 0, "inactive": 0, "incomplete": 0}
    for row in rows:
        if row.get("is_active") is False:
            rejected["inactive"] += 1; continue
        market = canonical_market(row)
        if not market:
            rejected["unsupported_market"] += 1; continue
        if not include_event_props and not is_season_row(row):
            rejected["not_season_long"] += 1; continue
        player = str(row.get("player_name") or "").strip()
        book = str(row.get("sportsbook_name") or row.get("sportsbook") or "").strip()
        selection = str(row.get("selection_type") or row.get("selection") or "").lower()
        side = ("over" if "over" in selection else "under" if "under" in selection else
                "yes" if selection in {"yes", "y"} or " yes" in selection else
                "no" if selection in {"no", "n"} or " no" in selection else None)
        try:
            line = float(row["line"])
        except (KeyError, TypeError, ValueError):
            line = 0.5 if market == "anytime_touchdown" and side in {"yes", "no"} else None
        if not player or not book or not side or line is None:
            rejected["incomplete"] += 1; continue
        key = (slug(player), book.lower(), market, line)
        quote = groups.setdefault(key, {
            "player_key": slug(player), "player_name": player, "position": row.get("position"),
            "book": book, "market": market, "line": line, "over_odds": None, "under_odds": None,
            "yes_odds": None, "no_odds": None,
            "updated_at": row.get("timestamp") or captured_at, "source_url": DEFAULT_BASE_URL,
            "source_type": "licensed_api", "source_provider": "sharpapi",
            "event_id": row.get("event_id"), "market_id": row.get("market_id"),
        })
        quote[f"{side}_odds"] = row.get("odds_american")
    return list(groups.values()), rejected


def collect(api_key: str, base_url: str = DEFAULT_BASE_URL, include_event_props: bool = False, max_pages: int = 20) -> dict:
    captured_at = datetime.now(timezone.utc).isoformat()
    rows, pages = fetch_all_rows(api_key, base_url, max_pages=max_pages)
    quotes, rejected = parse_rows(rows, captured_at, include_event_props)
    if not quotes:
        raise NoSupportedMarketsError("SharpAPI currently exposes no supported season-long NFL statistical player props")
    return {"version": 1, "provider": "sharpapi", "captured_at": captured_at,
            "records_examined": len(rows), "pages_examined": pages, "rejected": rejected, "quotes": quotes}


def coverage_report(api_key: str, base_url: str) -> dict:
    rows, pages = fetch_all_rows(api_key, base_url)
    counts, season_counts = {}, {}
    for row in rows:
        name = str(row.get("stat_category") or row.get("market_type") or "unknown")
        counts[name] = counts.get(name, 0) + 1
        if is_season_row(row):
            season_counts[name] = season_counts.get(name, 0) + 1
    return {"records_examined": len(rows), "pages_examined": pages, "all_markets": counts, "season_markets": season_counts,
            "contains_supported_season_props": any(canonical_market(row) and is_season_row(row) for row in rows)}


def self_test() -> None:
    sample = [
        {"player_name": "Test WR", "sportsbook": "draftkings", "market_type": "regular_season_player_receiving_yards", "selection": "Over", "line": 999.5, "odds_american": -110, "timestamp": "2026-08-21T00:00:00Z"},
        {"player_name": "Test WR", "sportsbook": "draftkings", "market_type": "regular_season_player_receiving_yards", "selection": "Under", "line": 999.5, "odds_american": -110, "timestamp": "2026-08-21T00:00:00Z"},
    ]
    quotes, rejected = parse_rows(sample, "test")
    assert len(quotes) == 1 and quotes[0]["market"] == "receiving_yards", (quotes, rejected)
    assert quotes[0]["over_odds"] == -110 and quotes[0]["under_odds"] == -110
    print("self-test passed")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--key-env", default="SHARP_API_KEY")
    parser.add_argument("--include-event-props", action="store_true")
    parser.add_argument("--coverage-report", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test(); return
    api_key = os.environ.get(args.key_env)
    if not api_key:
        parser.error(f"set {args.key_env} in the environment; API keys are not accepted as arguments")
    if args.coverage_report:
        print(json.dumps(coverage_report(api_key, args.base_url), indent=2)); return
    if not args.output:
        parser.error("--output is required")
    data, output = collect(api_key, args.base_url, args.include_event_props), Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"wrote {len(data['quotes'])} SharpAPI quotes to {output}")


if __name__ == "__main__":
    try:
        main()
    except SharpRateLimitError as exc:
        print(f"SharpAPI free-tier limit is still active. Wait {exc.retry_after:.0f} seconds, then rerun the same command.", file=sys.stderr)
        raise SystemExit(2)
    except NoSupportedMarketsError as exc:
        print(f"No season file created: {exc}. Use DraftKings and BetMGM for season-long draft signals.", file=sys.stderr)
        raise SystemExit(3)
    except Exception as exc:
        print(f"collection failed: {exc}", file=sys.stderr)
        raise
