#!/usr/bin/env python3
"""Blend weekly market lines into component-stat projections, with strict caps.

Baseline rows must contain player name, projected points, and a numeric `stats`
object. Only stat components actually offered by sportsbooks are replaced. A
missing market is never treated as zero and a points-only baseline is unchanged.
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

STAT_KEYS = {
    "passing_yards": ("pass_yds", "passing_yards"),
    "passing_touchdowns": ("pass_td", "passing_touchdowns"),
    "interceptions": ("pass_int", "interceptions"),
    "rushing_yards": ("rush_yds", "rushing_yards"),
    "rushing_touchdowns": ("rush_td", "rushing_touchdowns"),
    "receiving_yards": ("rec_yds", "receiving_yards"),
    "receiving_touchdowns": ("rec_td", "receiving_touchdowns"),
    "receptions": ("rec", "receptions"),
    "touchdowns": ("total_td", "touchdowns"),
    "anytime_touchdown": ("total_td", "touchdowns"),
}


def identity(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")


def scoring_rates(scoring: dict) -> dict:
    return {
        "passing_yards": float(scoring.get("pass_yd", 0.04)),
        "passing_touchdowns": float(scoring.get("pass_td", 4)),
        "interceptions": float(scoring.get("pass_int", -2)),
        "rushing_yards": float(scoring.get("rush_yd", 0.1)),
        "rushing_touchdowns": float(scoring.get("rush_td", 6)),
        "receiving_yards": float(scoring.get("rec_yd", 0.1)),
        "receiving_touchdowns": float(scoring.get("rec_td", 6)),
        "receptions": float(scoring.get("rec", 0.5)),
        "touchdowns": float(scoring.get("td", 6)),
        "anytime_touchdown": float(scoring.get("td", 6)),
    }


def baseline_stat(row: dict, market: str):
    stats = row.get("stats") or {}
    if market in {"touchdowns", "anytime_touchdown"}:
        if market == "touchdowns" and str(row.get("position") or "").upper() == "QB":
            try:
                return float(stats.get("pass_td", stats.get("passing_touchdowns")))
            except (TypeError, ValueError):
                return None
        direct = stats.get("total_td", stats.get("touchdowns"))
        if direct is not None:
            try:
                return float(direct)
            except (TypeError, ValueError):
                pass
        try:
            return float(stats.get("rush_td", 0)) + float(stats.get("rec_td", 0))
        except (TypeError, ValueError):
            return None
    for key in STAT_KEYS.get(market, ()):
        try:
            return float(stats[key])
        except (KeyError, TypeError, ValueError):
            continue
    return None


def market_rate(row: dict, market: str, rates: dict) -> float:
    if market == "touchdowns" and str(row.get("position") or "").upper() == "QB":
        return rates["passing_touchdowns"]
    return rates[market]


def implied_probability(american_odds):
    try:
        odds = float(american_odds)
    except (TypeError, ValueError):
        return None
    return (-odds / (-odds + 100)) if odds < 0 else (100 / (odds + 100))


def touchdown_probability(quote: dict):
    yes = implied_probability(quote.get("yes_odds") if quote.get("yes_odds") is not None else quote.get("over_odds"))
    no = implied_probability(quote.get("no_odds") if quote.get("no_odds") is not None else quote.get("under_odds"))
    if yes is not None and no is not None and yes + no > 0:
        return yes / (yes + no)
    return yes


def flatten_baselines(raw: dict) -> list[dict]:
    projections = raw.get("projections") if isinstance(raw, dict) else None
    if isinstance(projections, dict):
        return [row for rows in projections.values() for row in (rows or [])]
    return raw.get("players", []) if isinstance(raw, dict) else []


def build(baselines: dict, quote_payload: dict, scoring: dict, cap_pct: float = 0.10) -> dict:
    quotes = defaultdict(lambda: defaultdict(list))
    for quote in quote_payload.get("quotes") or []:
        if quote.get("projection_scope") != "weekly":
            continue
        if quote.get("line") is not None:
            quotes[identity(quote.get("player_key") or quote.get("player_name"))][quote.get("market")].append(quote)
    rates, output = scoring_rates(scoring), []
    for row in flatten_baselines(baselines):
        key = identity(row.get("player_key") or row.get("name") or row.get("player_name"))
        player_quotes = quotes.get(key)
        if not player_quotes:
            continue
        try:
            base_points = float(row.get("projected_points", row.get("points_half")))
        except (TypeError, ValueError):
            continue
        adjustments, details, books = [], {}, set()
        for market, market_quotes in player_quotes.items():
            baseline = baseline_stat(row, market)
            if baseline is None or market not in rates:
                continue
            by_book = {}
            for quote in market_quotes:
                book = str(quote.get("book") or "unknown")
                if market == "anytime_touchdown":
                    probability = touchdown_probability(quote)
                    if probability is None:
                        continue
                    by_book[book] = probability
                else:
                    by_book[book] = float(quote["line"])
                books.add(book)
            if not by_book:
                continue
            line = statistics.median(by_book.values())
            rate = market_rate(row, market, rates)
            point_delta = (line - baseline) * rate
            adjustments.append(point_delta)
            details[market] = {"baseline": baseline, "consensus": round(line, 4), "books": len(by_book),
                               "fantasy_point_rate": rate,
                               "book_lines": by_book, "point_delta": round(point_delta, 3)}
        if not adjustments:
            continue
        raw_delta = sum(adjustments)
        cap = abs(base_points) * cap_pct
        applied_delta = max(-cap, min(cap, raw_delta))
        output.append({
            "player_key": key, "player_name": row.get("name") or row.get("player_name"),
            "position": row.get("position"), "baseline_points": base_points,
            "adjusted_points": round(base_points + applied_delta, 2), "raw_market_delta": round(raw_delta, 2),
            "applied_market_delta": round(applied_delta, 2), "cap_pct": cap_pct,
            "books": len(books), "markets_used": len(details), "market_detail": details,
            "market_label": "single_book_signal" if len(books) == 1 else "multi_book_consensus",
            "confidence": round(min(1, len(books) / 3) * min(1, len(details) / 3), 3),
            "projection_scope": "weekly",
        })
    return {"version": 1, "kind": "weekly_vegas_adjusted_projections",
            "generated_at": datetime.now(timezone.utc).isoformat(), "players": output}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("baselines")
    parser.add_argument("quotes")
    parser.add_argument("output")
    parser.add_argument("--ppr", type=float, default=0.5)
    parser.add_argument("--pass-td", type=float, default=4)
    parser.add_argument("--interception", type=float, default=-2)
    parser.add_argument("--cap-pct", type=float, default=0.10)
    args = parser.parse_args()
    baseline_path = Path(args.baselines)
    quote_path = Path(args.quotes)
    if not baseline_path.exists():
        raise SystemExit(
            f"Weekly baseline not found: {baseline_path}. Supply a genuine current-week projection file "
            "with component stats; season projections are intentionally rejected as a substitute."
        )
    if not quote_path.exists():
        raise SystemExit(
            f"Weekly sportsbook quotes not found: {quote_path}. Run collect_sharpapi_weekly_props.py first."
        )
    scoring = {"rec": args.ppr, "pass_td": args.pass_td, "pass_int": args.interception}
    baseline_payload = json.loads(baseline_path.read_text(encoding="utf-8"))
    if baseline_payload.get("projection_scope") != "weekly":
        raise SystemExit("Baseline must declare projection_scope=weekly; refusing to blend season projections into weekly odds")
    result = build(baseline_payload, json.loads(quote_path.read_text(encoding="utf-8")), scoring, args.cap_pct)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"built {len(result['players'])} weekly Vegas-adjusted projections")


if __name__ == "__main__":
    main()
