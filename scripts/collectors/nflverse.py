#!/usr/bin/env python3
"""Collect selected nflverse datasets without mirroring upstream repositories.

The adapter uses nflreadpy, records provenance, and writes local Parquet files.
It deliberately separates collection from player evaluation.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import nflreadpy as nfl

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "nflverse"


def _write_frame(name: str, frame, source: str) -> dict:
    RAW.mkdir(parents=True, exist_ok=True)
    path = RAW / f"{name}.parquet"
    # nflreadpy may return Polars or pandas depending on version/config.
    if hasattr(frame, "write_parquet"):
        frame.write_parquet(path)
        rows = getattr(frame, "height", None)
    elif hasattr(frame, "to_parquet"):
        frame.to_parquet(path, index=False)
        rows = len(frame)
    else:
        raise TypeError(f"Unsupported dataframe type for {name}: {type(frame)!r}")
    return {"dataset": name, "path": str(path.relative_to(ROOT)), "rows": rows, "source": source}


def collect(seasons: list[int]) -> list[dict]:
    tasks: list[tuple[str, Callable[[], object], str]] = [
        ("players", lambda: nfl.load_players(), "nflverse/nflverse-data players release"),
        ("rosters", lambda: nfl.load_rosters(seasons), "nflverse/nflverse-data roster releases"),
        ("weekly_stats", lambda: nfl.load_player_stats(seasons, summary_level="week"), "nflverse/nflverse-data weekly stats"),
        ("seasonal_stats", lambda: nfl.load_player_stats(seasons, summary_level="reg"), "nflverse/nflverse-data seasonal stats"),
        ("draft_picks", lambda: nfl.load_draft_picks(), "nflverse/nflverse-data draft picks"),
        ("combine", lambda: nfl.load_combine(), "nflverse/nflverse-data combine"),
    ]
    results = []
    for name, loader, source in tasks:
        try:
            results.append(_write_frame(name, loader(), source))
        except Exception as exc:  # one unavailable dataset should not erase successful pulls
            results.append({"dataset": name, "status": "unavailable", "error": str(exc), "source": source})
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seasons", nargs="+", type=int, default=[2024, 2025, 2026])
    args = parser.parse_args()
    seasons = sorted(set(args.seasons))
    results = collect(seasons)
    unavailable = [r for r in results if r.get("status") == "unavailable"]
    successful = [r for r in results if r.get("path")]
    manifest = {
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "collector": "scripts/collectors/nflverse.py",
        "upstream": "nflverse/nflreadpy",
        "seasons": seasons,
        "status": "partial" if unavailable else "complete",
        "successful_datasets": len(successful),
        "unavailable_datasets": len(unavailable),
        "artifacts": results,
    }
    RAW.mkdir(parents=True, exist_ok=True)
    (RAW / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))
    if not successful:
        raise SystemExit("No nflverse datasets were collected")
    if unavailable:
        print(f"Warning: {len(unavailable)} dataset(s) were not published upstream yet; continuing with available artifacts.")


if __name__ == "__main__":
    main()
