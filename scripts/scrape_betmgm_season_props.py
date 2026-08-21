#!/usr/bin/env python3
"""Scrape public BetMGM NFL regular-season player stat markets into the Vegas quote contract.

⚠️ TOS WARNING (confirmed 2026-08-05): BetMGM's own Terms of Use explicitly
prohibit "using any robot, scraper, spider, or any other automatic device or
manual process to monitor or copy any content" — this applies regardless of
whether the page requires login. This script violates that clause even though
it only hits a public page with no CAPTCHA/login bypass. It is NOT wired into
any automated workflow (confirmed clean as of this date) and should stay that
way — manual-invocation-only, at real ToS risk if run. Do not schedule this.
Prefer a licensed odds API (e.g. The Odds API, SharpAPI) once one is verified.

This collector deliberately uses only a normal public page request. It does not authenticate,
solve CAPTCHAs, rotate proxies, or bypass sportsbook controls. If BetMGM blocks the request or
changes its markup, the collector fails closed and the paid/provider adapters remain available.

Examples:
  python scripts/scrape_betmgm_season_props.py --url \
    'https://www.betmgm.com/en/sports/events/2026-27-nfl-regular-season-stats-19070789' \
    --output data/vegas/betmgm-season.json

  python scripts/scrape_betmgm_season_props.py --html saved-betmgm.html --output out.json
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

MARKETS = {
    "passing yards o/u": "passing_yards",
    "passing tds": "passing_touchdowns",
    "passing touchdowns": "passing_touchdowns",
    "interceptions": "interceptions",
    "rushing yards o/u": "rushing_yards",
    "rushing tds": "rushing_touchdowns",
    "rushing touchdowns": "rushing_touchdowns",
    "receiving yards o/u": "receiving_yards",
    "receiving tds": "receiving_touchdowns",
    "receiving touchdowns": "receiving_touchdowns",
    "receptions o/u": "receptions",
    "receptions": "receptions",
}

ODDS_RE = re.compile(r"^[+-]?\d+(?:\.\d+)?$")
LINE_RE = re.compile(r"^[OU]\s*([0-9]+(?:\.[0-9]+)?)$", re.I)


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def fetch(url: str) -> str:
    req = Request(
        url,
        headers={
            "User-Agent": "FantasyFrontOffice/1.0 (+public-data-research)",
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    with urlopen(req, timeout=25) as resp:
        if resp.status != 200:
            raise RuntimeError(f"BetMGM returned HTTP {resp.status}")
        return resp.read().decode("utf-8", errors="replace")


def visible_lines(raw_html: str) -> list[str]:
    # Preserve rough block boundaries before stripping tags; enough for BetMGM's SSR text.
    text = re.sub(r"<(?:br|/div|/p|/li|/span|/h\d|/button)[^>]*>", "\n", raw_html, flags=re.I)
    text = re.sub(r"<script\b[^>]*>.*?</script>", "\n", text, flags=re.I | re.S)
    text = re.sub(r"<style\b[^>]*>.*?</style>", "\n", text, flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    out = []
    for line in text.splitlines():
        line = re.sub(r"\s+", " ", line).strip()
        if line:
            out.append(line)
    return out


def market_for(line: str) -> str | None:
    low = line.lower().strip()
    for label, market in MARKETS.items():
        if low == label or low.endswith(label):
            return market
    return None


def looks_like_name(line: str) -> bool:
    if len(line) < 3 or len(line) > 60:
        return False
    if market_for(line) or LINE_RE.match(line) or ODDS_RE.match(line):
        return False
    bad = ("show more", "over under", "regular season", "image", "main", "passing", "rushing", "receiving")
    low = line.lower()
    return not any(low == x for x in bad) and bool(re.search(r"[A-Za-z]", line))


def parse(raw_html: str, source_url: str | None = None) -> dict:
    lines = visible_lines(raw_html)
    quotes = []
    current_market = None
    i = 0
    captured_at = datetime.now(timezone.utc).isoformat()

    while i < len(lines):
        maybe_market = market_for(lines[i])
        if maybe_market:
            current_market = maybe_market
            i += 1
            continue

        if current_market and looks_like_name(lines[i]):
            player = lines[i]
            # BetMGM typically emits player, O line, over price, U line, under price.
            # Stop at the next market heading so one player's look-ahead can
            # never absorb the following market's line and prices.
            window = []
            for token in lines[i + 1 : i + 8]:
                if market_for(token):
                    break
                window.append(token)
            over_line = under_line = over_odds = under_odds = None
            for j, token in enumerate(window):
                m = LINE_RE.match(token)
                if not m:
                    continue
                val = float(m.group(1))
                side = token[0].upper()
                price = None
                if j + 1 < len(window) and ODDS_RE.match(window[j + 1]):
                    price = float(window[j + 1])
                if side == "O":
                    over_line, over_odds = val, price
                else:
                    under_line, under_odds = val, price
                if over_line is not None and under_line is not None:
                    break
            if over_line is not None or under_line is not None:
                line = over_line if over_line is not None else under_line
                if over_line is not None and under_line is not None and abs(over_line - under_line) > 0.01:
                    line = (over_line + under_line) / 2
                quotes.append(
                    {
                        "player_key": slug(player),
                        "player_name": player,
                        "position": None,
                        "book": "BetMGM",
                        "market": current_market,
                        "line": line,
                        "over_odds": over_odds,
                        "under_odds": under_odds,
                        "updated_at": captured_at,
                        "source_url": source_url,
                        "source_type": "public_scrape",
                    }
                )
                i += 1
                continue
        i += 1

    return {
        "version": 1,
        "provider": "betmgm_public",
        "captured_at": captured_at,
        "source_url": source_url,
        "quotes": quotes,
    }


def self_test() -> None:
    sample = """
    <div>Passing yards O/U</div><div>Jared Goff</div><span>O 4050.5</span><span>1.91</span><span>U 4050.5</span><span>1.91</span>
    <div>Rushing yards O/U</div><div>Jahmyr Gibbs</div><span>O 1225.5</span><span>1.95</span><span>U 1225.5</span><span>1.87</span>
    """
    data = parse(sample)
    assert len(data["quotes"]) == 2, data
    assert data["quotes"][0]["market"] == "passing_yards"
    assert data["quotes"][0]["line"] == 4050.5
    assert data["quotes"][1]["market"] == "rushing_yards"
    print("self-test passed")


def main() -> None:
    ap = argparse.ArgumentParser()
    group = ap.add_mutually_exclusive_group(required=False)
    group.add_argument("--url")
    group.add_argument("--html")
    ap.add_argument("--output")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()

    if args.self_test:
        self_test()
        return
    if not args.url and not args.html:
        ap.error("one of --url or --html is required")
    if not args.output:
        ap.error("--output is required")

    raw = fetch(args.url) if args.url else Path(args.html).read_text(encoding="utf-8")
    data = parse(raw, args.url)
    if not data["quotes"]:
        raise SystemExit("No season player markets parsed; page may be blocked or markup may have changed.")
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"wrote {len(data['quotes'])} BetMGM quotes to {out}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"scrape failed: {exc}", file=sys.stderr)
        raise
