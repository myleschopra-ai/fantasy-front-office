#!/usr/bin/env python3
"""Select the next NFL regular-season week from the collected schedule."""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta
from pathlib import Path

from open_projection_engine import finite, load_parquet_rows


def resolve(rows: list[dict], season: int, today: date) -> int:
    candidates = []
    for row in rows:
        if int(finite(row.get("season"), -1) or -1) != season or str(row.get("game_type") or "REG").upper() != "REG":
            continue
        try:
            gameday = datetime.fromisoformat(str(row.get("gameday"))[:10]).date()
        except ValueError:
            continue
        week = int(finite(row.get("week"), 1) or 1)
        if gameday >= today - timedelta(days=1):
            candidates.append((gameday, week))
    return min(candidates)[1] if candidates else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, default=datetime.now().year)
    parser.add_argument("--schedule", type=Path, default=Path("data/raw/nflverse/schedules.parquet"))
    args = parser.parse_args()
    print(resolve(load_parquet_rows(args.schedule), args.season, date.today()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
