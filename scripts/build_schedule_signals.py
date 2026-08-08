#!/usr/bin/env python3
"""Build per-team bye-week and full-schedule signals from collected nflverse data.

Deliberately outputs the *entire* week-by-week schedule per team rather than
a hardcoded "playoff weeks 15-17" assumption — actual playoff weeks vary by
league (Sleeper exposes this via league.settings.playoff_week_start). Downstream
consumers combine this file with a specific league's real playoff window rather
than this script guessing it.

Input:  data/raw/nflverse/schedules.parquet (written by scripts/collectors/nflverse.py)
Output: data/schedule_signals.json

This is a read-derive-write step, separate from collection (matching the
existing nflverse.py docstring's stated principle: "separates collection
from player evaluation"). It does not overwrite any published dashboard file.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEDULE_PATH = ROOT / "data" / "raw" / "nflverse" / "schedules.parquet"
OUTPUT_PATH = ROOT / "data" / "schedule_signals.json"


def build(season: int) -> dict:
    try:
        import polars as pl
    except ImportError:
        raise RuntimeError("polars is required (nflreadpy returns Polars DataFrames)")

    if not SCHEDULE_PATH.exists():
        raise FileNotFoundError(
            f"{SCHEDULE_PATH} not found — run scripts/collectors/nflverse.py first "
            "(via the Collect Football Data workflow) to produce raw schedule data."
        )

    df = pl.read_parquet(SCHEDULE_PATH)
    df = df.filter((pl.col("season") == season) & (pl.col("game_type") == "REG"))

    if df.height == 0:
        raise ValueError(f"No REG season {season} rows found in {SCHEDULE_PATH}")

    teams: dict[str, dict] = {}
    all_teams = set(df["home_team"].to_list()) | set(df["away_team"].to_list())
    all_weeks = sorted(set(df["week"].to_list()))

    for team in sorted(all_teams):
        home_games = df.filter(pl.col("home_team") == team)
        away_games = df.filter(pl.col("away_team") == team)

        schedule: dict[str, dict] = {}
        for row in home_games.iter_rows(named=True):
            schedule[str(row["week"])] = {"opponent": row["away_team"], "home": True}
        for row in away_games.iter_rows(named=True):
            schedule[str(row["week"])] = {"opponent": row["home_team"], "home": False}

        played_weeks = {int(w) for w in schedule.keys()}
        bye_candidates = [w for w in all_weeks if w not in played_weeks]
        bye_week = bye_candidates[0] if len(bye_candidates) == 1 else (bye_candidates[0] if bye_candidates else None)

        teams[team] = {
            "bye_week": bye_week,
            "schedule": schedule,
        }

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "season": season,
        "source": "nflverse schedules (scripts/collectors/nflverse.py)",
        "note": "Playoff-week relevance depends on each league's real playoff_week_start setting — not assumed here.",
        "teams": teams,
    }


def main() -> None:
    season = int(sys.argv[1]) if len(sys.argv) > 1 else datetime.now().year
    result = build(season)
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    byes_found = sum(1 for t in result["teams"].values() if t["bye_week"] is not None)
    print(f"Wrote {OUTPUT_PATH.relative_to(ROOT)}: {len(result['teams'])} teams, {byes_found} bye weeks resolved.")


if __name__ == "__main__":
    main()
