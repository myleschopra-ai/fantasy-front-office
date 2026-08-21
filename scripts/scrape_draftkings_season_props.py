#!/usr/bin/env python3
"""Collect DraftKings NFL season-long player futures into the Vegas quote contract.

Adapted from yzRobo/draftkings_api_explorer (MIT): live category discovery,
the current sportscontent endpoint, season-prefix handling, embedded lines, and
DraftKings' `main` marker. Its GUI, updater, TLS impersonation, and executable
packaging are intentionally omitted.

This remains an unofficial, manually invoked collector for an undocumented
public feed. It does not authenticate, solve CAPTCHAs, rotate proxies, emulate a
browser, evade geolocation, or retry an access denial.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

NFL_LEAGUE_ID = "88808"
DEFAULT_API_BASE = "https://sportsbook-nash.draftkings.com/api/sportscontent/dkusoh/v1"
SEED_CATEGORY_ID = "1286"
UPSTREAM_REPOSITORY = "https://github.com/yzRobo/draftkings_api_explorer"
UPSTREAM_COMMIT = "9a0eceedeb8b38e81e4529c578a00dc9980b0a4a"
MARKET_ALIASES = {
    "passing yards": "passing_yards", "passing touchdowns": "passing_touchdowns",
    "passing tds": "passing_touchdowns", "interceptions": "interceptions",
    "rushing yards": "rushing_yards", "rushing touchdowns": "rushing_touchdowns",
    "rushing tds": "rushing_touchdowns", "receiving yards": "receiving_yards",
    "receiving touchdowns": "receiving_touchdowns", "receiving tds": "receiving_touchdowns",
    "receptions": "receptions",
}
PREFIX_RE = re.compile(r"^[A-Za-z]{2,5}\s+\d{4}(?:/\d{2,4})?\s+-\s+")
EMBEDDED_LINE_RE = re.compile(r"^(Over|Under)\s+([+-]?\d+(?:\.\d+)?)$", re.I)


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def get_json(url: str) -> dict:
    request = Request(url, headers={"User-Agent": "FantasyFrontOffice/2.0 (+public-data-research)", "Accept": "application/json"})
    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8", errors="replace"))
    except HTTPError as exc:
        if exc.code in {401, 403, 429}:
            raise RuntimeError(f"DraftKings denied or limited access (HTTP {exc.code}); stopping without bypass") from exc
        raise


def build_url(api_base: str, league_id: str, category_id: str, subcategory_id: str = "") -> str:
    url = f"{api_base.rstrip('/')}/leagues/{league_id}/categories/{category_id}"
    return f"{url}/subcategories/{subcategory_id}" if subcategory_id else url


def normalize_market_name(name: str) -> str:
    return PREFIX_RE.sub("", name or "").strip()


def market_key(name: str) -> str | None:
    normalized = normalize_market_name(name).lower()
    for label, key in MARKET_ALIASES.items():
        if normalized.endswith(label) or f"regular season {label}" in normalized:
            return key
    return None


def split_player_market(name: str) -> tuple[str | None, str | None]:
    normalized = normalize_market_name(name)
    match = re.match(r"^(.*?)\s+Regular Season\s+(.*)$", normalized, re.I)
    if match:
        return match.group(1).strip(), market_key(match.group(2))
    if " - " in normalized:
        player, _, market = normalized.partition(" - ")
        return player.strip(), market_key(market)
    for label in sorted(MARKET_ALIASES, key=len, reverse=True):
        suffix = f" {label}"
        if normalized.lower().endswith(suffix):
            return normalized[:-len(suffix)].strip(), MARKET_ALIASES[label]
    return None, None


def outcome_side_and_line(selection: dict) -> tuple[str | None, float | None]:
    label = str(selection.get("label") or "").strip()
    points = selection.get("points")
    match = EMBEDDED_LINE_RE.match(label)
    if match:
        label = match.group(1).title()
        points = points if points is not None else match.group(2)
    elif selection.get("outcomeType") in {"Over", "Under"}:
        label = selection["outcomeType"]
    try:
        line = float(points) if points is not None else None
    except (TypeError, ValueError):
        line = None
    return (label.lower() if label.lower() in {"over", "under"} else None), line


def discover_player_subcategories(payload: dict) -> list[tuple[str, str, str]]:
    categories = {str(item.get("id")): str(item.get("name") or "") for item in payload.get("categories", [])}
    matches = []
    for sub in payload.get("subcategories", []):
        category_id, subcategory_id = str(sub.get("categoryId") or ""), str(sub.get("id") or "")
        subcategory_name = str(sub.get("name") or "")
        combined = f"{categories.get(category_id, '')} {subcategory_name}".lower()
        if category_id and subcategory_id and ("player" in combined or "future" in combined):
            if market_key(subcategory_name) or any(label in combined for label in MARKET_ALIASES):
                matches.append((category_id, subcategory_id, subcategory_name))
    return sorted(set(matches))


def parse_feed(payload: dict, source_url: str, captured_at: str | None = None) -> list[dict]:
    captured_at = captured_at or datetime.now(timezone.utc).isoformat()
    markets = {item.get("id"): item for item in payload.get("markets", [])}
    grouped: dict[tuple, dict] = {}
    for selection in payload.get("selections", []):
        market = markets.get(selection.get("marketId"), {})
        player, normalized_market = split_player_market(str(market.get("name") or ""))
        side, line = outcome_side_and_line(selection)
        if not player or not normalized_market or not side or line is None:
            continue
        odds = (selection.get("displayOdds") or {}).get("american")
        if isinstance(odds, str):
            odds = odds.replace("−", "-").replace("+", "")
        try:
            odds = int(odds) if odds is not None else None
        except (TypeError, ValueError):
            odds = None
        key = (selection.get("marketId"), player, normalized_market, line)
        row = grouped.setdefault(key, {
            "player_key": slug(player), "player_name": player, "position": None,
            "book": "DraftKings", "market": normalized_market, "line": line,
            "over_odds": None, "under_odds": None, "updated_at": captured_at,
            "source_url": source_url, "source_type": "public_undocumented_api",
            "source_provider": "draftkings_public", "market_id": str(selection.get("marketId") or ""),
            "is_main_line": False,
        })
        row[f"{side}_odds"] = odds
        row["is_main_line"] = row["is_main_line"] or bool(selection.get("main", False))
    rows = list(grouped.values())
    main_markets = {(row["player_key"], row["market"]) for row in rows if row["is_main_line"]}
    return [row for row in rows if (row["player_key"], row["market"]) not in main_markets or row["is_main_line"]]


def scrape(api_base: str = DEFAULT_API_BASE) -> dict:
    seed_url = build_url(api_base, NFL_LEAGUE_ID, SEED_CATEGORY_ID)
    subcategories = discover_player_subcategories(get_json(seed_url))
    if not subcategories:
        raise RuntimeError("No live NFL player-futures subcategories were discovered")
    captured_at, quotes, fetched = datetime.now(timezone.utc).isoformat(), [], []
    for category_id, subcategory_id, name in subcategories:
        url = build_url(api_base, NFL_LEAGUE_ID, category_id, subcategory_id)
        fetched.append({"category_id": category_id, "subcategory_id": subcategory_id, "name": name, "url": url})
        quotes.extend(parse_feed(get_json(url), url, captured_at))
    if not quotes:
        raise RuntimeError("Discovered DraftKings futures categories but parsed no supported season player lines")
    return {"version": 1, "provider": "draftkings_public", "captured_at": captured_at,
            "upstream": {"repository": UPSTREAM_REPOSITORY, "commit": UPSTREAM_COMMIT},
            "discovered_subcategories": fetched, "quotes": quotes}


def self_test() -> None:
    sample = {"markets": [{"id": 10, "name": "NFL 2026/27 - Test QB Regular Season Passing Yards"}], "selections": [
        {"marketId": 10, "label": "Over 4050.5", "displayOdds": {"american": "−110"}, "main": True},
        {"marketId": 10, "label": "Under 4050.5", "displayOdds": {"american": "+100"}, "main": True}]}
    rows = parse_feed(sample, "test", "2026-08-21T00:00:00+00:00")
    assert len(rows) == 1 and rows[0]["market"] == "passing_yards", rows
    assert rows[0]["over_odds"] == -110 and rows[0]["under_odds"] == 100, rows
    print("self-test passed")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    parser.add_argument("--api-base", default=DEFAULT_API_BASE)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test(); return
    if not args.output:
        parser.error("--output is required")
    data, output = scrape(args.api_base), Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"wrote {len(data['quotes'])} DraftKings quotes to {output}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"collection failed: {exc}", file=sys.stderr)
        raise
