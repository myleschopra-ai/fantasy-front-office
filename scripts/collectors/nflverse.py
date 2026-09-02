#!/usr/bin/env python3
"""Collect selected nflverse datasets without mirroring upstream repositories.

The adapter uses nflreadpy, records provenance, and writes local Parquet files.
It deliberately separates collection from player evaluation.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import nflreadpy as nfl

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "nflverse"
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
from data_foundation import artifact_record, utc_now

SOURCE_URL = "https://github.com/nflverse/nflverse-data/releases"
LICENSE = "CC-BY-4.0; verify dataset-specific upstream terms"


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
    columns = list(getattr(frame, "columns", []) or [])
    return artifact_record(
        path, ROOT, dataset=name, source=source, source_url=SOURCE_URL,
        license_name=LICENSE, rows=rows, columns=columns,
    )


def _with_preseason_fallback(loader: Callable[[list[int]], object], seasons: list[int]) -> object:
    """Retry without an unpublished current season while preserving schedules/depth separately."""
    try:
        return loader(seasons)
    except Exception:
        current = datetime.now(timezone.utc).year
        historical = [season for season in seasons if season < current]
        if historical and historical != seasons:
            return loader(historical)
        raise


def task_specs(seasons: list[int]) -> list[tuple[str, Callable[[], object], str]]:
    return [
        ("players", lambda: nfl.load_players(), "nflverse/nflverse-data players release"),
        ("ff_playerids", lambda: nfl.load_ff_playerids(), "nflverse fantasy-football cross-platform identifier release"),
        ("rosters", lambda: nfl.load_rosters(seasons), "nflverse/nflverse-data roster releases"),
        ("weekly_rosters", lambda: nfl.load_rosters_weekly(seasons), "nflverse weekly roster releases"),
        ("weekly_stats", lambda: _with_preseason_fallback(lambda years: nfl.load_player_stats(years, summary_level="week"), seasons), "nflverse/nflverse-data weekly stats"),
        ("seasonal_stats", lambda: _with_preseason_fallback(lambda years: nfl.load_player_stats(years, summary_level="reg"), seasons), "nflverse/nflverse-data seasonal stats"),
        ("draft_picks", lambda: nfl.load_draft_picks(), "nflverse/nflverse-data draft picks"),
        ("combine", lambda: nfl.load_combine(), "nflverse/nflverse-data combine"),
        ("schedules", lambda: nfl.load_schedules(seasons), "nflverse/nflverse-data schedules — source for bye weeks and playoff-week opponents"),
        ("snap_counts", lambda: _with_preseason_fallback(nfl.load_snap_counts, seasons), "nflverse/nflverse-data snap-count releases"),
        ("injuries", lambda: _with_preseason_fallback(nfl.load_injuries, seasons), "nflverse/nflverse-data injury releases"),
        ("depth_charts", lambda: nfl.load_depth_charts(seasons), "nflverse/nflverse-data depth-chart releases"),
        ("ff_opportunity", lambda: _with_preseason_fallback(nfl.load_ff_opportunity, seasons), "nflverse expected fantasy-opportunity releases"),
        ("participation", lambda: _with_preseason_fallback(nfl.load_participation, seasons), "nflverse play participation releases"),
        ("ngs_passing", lambda: _with_preseason_fallback(lambda years: nfl.load_nextgen_stats(years, stat_type="passing"), seasons), "NFL Next Gen Stats passing via nflverse"),
        ("ngs_rushing", lambda: _with_preseason_fallback(lambda years: nfl.load_nextgen_stats(years, stat_type="rushing"), seasons), "NFL Next Gen Stats rushing via nflverse"),
        ("ngs_receiving", lambda: _with_preseason_fallback(lambda years: nfl.load_nextgen_stats(years, stat_type="receiving"), seasons), "NFL Next Gen Stats receiving via nflverse"),
        ("pfr_passing", lambda: _with_preseason_fallback(lambda years: nfl.load_pfr_advstats(years, stat_type="pass", summary_level="week"), seasons), "PFR advanced passing via nflverse"),
        ("pfr_rushing", lambda: _with_preseason_fallback(lambda years: nfl.load_pfr_advstats(years, stat_type="rush", summary_level="week"), seasons), "PFR advanced rushing via nflverse"),
        ("pfr_receiving", lambda: _with_preseason_fallback(lambda years: nfl.load_pfr_advstats(years, stat_type="rec", summary_level="week"), seasons), "PFR advanced receiving via nflverse"),
        ("ftn_charting", lambda: _with_preseason_fallback(nfl.load_ftn_charting, seasons), "FTN charting public release via nflverse"),
    ]


def collect(seasons: list[int], datasets: set[str] | None = None) -> list[dict]:
    tasks = task_specs(seasons)
    if datasets:
        tasks = [task for task in tasks if task[0] in datasets]
        missing = datasets - {task[0] for task in tasks}
        if missing:
            raise ValueError(f"Unknown nflverse datasets: {sorted(missing)}")
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
    parser.add_argument(
        "--datasets",
        nargs="+",
        choices=[task[0] for task in task_specs([2024])],
        help="Collect only the named datasets. Omit for the complete bundle.",
    )
    args = parser.parse_args()
    seasons = sorted(set(args.seasons))
    requested = set(args.datasets or [])
    results = collect(seasons, requested or None)
    unavailable = [r for r in results if r.get("status") == "unavailable"]
    successful = [r for r in results if r.get("path")]
    retrieved_at = utc_now()
    manifest = {
        "schema_version": 2,
        "snapshot_id": f"nflverse-{retrieved_at.replace(':', '').replace('-', '')}",
        "retrieved_at": retrieved_at,
        "collector": "scripts/collectors/nflverse.py",
        "upstream": "nflverse/nflreadpy",
        "seasons": seasons,
        "requested_datasets": sorted(requested) if requested else "all",
        "status": "partial" if unavailable else "complete",
        "successful_datasets": len(successful),
        "unavailable_datasets": len(unavailable),
        "artifacts": results,
        "retention_policy": "Raw files are local/CI evidence; derived feature snapshots and hashes are published for reproducibility.",
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
