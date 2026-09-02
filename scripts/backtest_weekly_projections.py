#!/usr/bin/env python3
"""Walk-forward weekly backtest with a prior-season PPG baseline."""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from data_foundation import finite, normalize_name, utc_now, write_json_atomic
from open_projection_engine import load_parquet_rows
from weekly_projection_engine import build, value

POSITIONS = {"QB", "RB", "WR", "TE"}


def half_points(row: dict) -> float:
    standard = finite(value(row, "fantasy_points"), None)
    receptions = finite(value(row, "receptions"), 0) or 0
    if standard is not None:
        return max(0, standard + receptions * 0.5)
    ppr = finite(value(row, "fantasy_points_ppr"), 0) or 0
    return max(0, ppr - receptions * 0.5)


def key(row: dict) -> str:
    identifier = value(row, "player_id", "gsis_id")
    return f"gsis:{identifier}" if identifier else f"name:{normalize_name(value(row, 'player_display_name', 'player_name'))}|{str(value(row, 'position') or '').upper()}"


def evaluate(rows: list[dict], season: int, extra: dict[str, list[dict]]) -> dict:
    prior_rows = [row for row in rows if int(finite(value(row, "season"), -1) or -1) == season - 1 and str(value(row, "position") or "").upper() in POSITIONS]
    prior: dict[str, list[dict]] = defaultdict(list)
    for row in prior_rows:
        prior[key(row)].append(row)
    players = []
    baselines = {}
    for player_key, games in prior.items():
        name = value(games[-1], "player_display_name", "player_name")
        position = str(value(games[-1], "position") or "").upper()
        total = sum(half_points(row) for row in games)
        ppg = total / len(games)
        players.append({"player_key": player_key, "name": name, "position": position, "team": value(games[-1], "team"), "projected_points": total, "expected_games": len(games), "identity_confidence": 90, "projection_confidence": 65, "source_ids": {"gsis": player_key.removeprefix("gsis:")} if player_key.startswith("gsis:") else {}})
        baselines[player_key] = ppg
    model_errors, baseline_errors = [], []
    evaluation_weeks = (8, 16)
    for week in evaluation_weeks:
        actual = {key(row): half_points(row) for row in rows if int(finite(value(row, "season"), -1) or -1) == season and int(finite(value(row, "week"), -1) or -1) == week and str(value(row, "position") or "").upper() in POSITIONS}
        projected = build(players, {"weekly": rows, **extra}, season, week)
        for projection in projected:
            player_key = projection["player_key"]
            if player_key in actual and player_key in baselines:
                model_errors.append(abs(projection["projected_points"] - actual[player_key]))
                baseline_errors.append(abs(baselines[player_key] - actual[player_key]))
    model_mae = statistics.mean(model_errors) if model_errors else float("inf")
    baseline_mae = statistics.mean(baseline_errors) if baseline_errors else float("inf")
    return {"season": season, "evaluation_weeks": list(evaluation_weeks), "observations": len(model_errors), "mae": round(model_mae, 3), "baseline_mae": round(baseline_mae, 3), "mae_delta": round(model_mae - baseline_mae, 3), "passed": len(model_errors) >= 350 and model_mae <= baseline_mae * 1.03}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--nflverse-dir", type=Path, default=Path("data/raw/nflverse"))
    parser.add_argument("--output", type=Path, default=Path("reports/weekly_projection_backtest.json"))
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()
    rows = load_parquet_rows(args.nflverse_dir / "weekly_stats.parquet")
    extra = {}
    # Full role/injury joins are validated in the current release build. The
    # historical gate uses weekly targets/carries and schedule context at two
    # representative checkpoints so CI remains bounded and repeatable.
    for name, filename in {"schedules": "schedules.parquet"}.items():
        path = args.nflverse_dir / filename
        if path.exists():
            extra[name] = load_parquet_rows(path)
    seasons = sorted({int(finite(value(row, "season"), 0) or 0) for row in rows})
    results = [evaluate(rows, season, extra) for season in seasons[-2:] if season - 1 in seasons]
    payload = {"schema_version": 1, "generated_at": utc_now(), "method": "walk-forward; each projection uses rows strictly before its target week", "baseline": "prior-season half-PPR points per game", "passed": bool(results) and all(row["passed"] for row in results), "seasons": results}
    write_json_atomic(args.output, payload)
    print(json.dumps(payload, indent=2))
    return 1 if args.strict and not payload["passed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
