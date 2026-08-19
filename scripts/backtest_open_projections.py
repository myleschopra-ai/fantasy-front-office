#!/usr/bin/env python3
"""Walk-forward, no-lookahead validation for the open projection model."""
from __future__ import annotations

import argparse
import json
import statistics
from collections import defaultdict
from pathlib import Path

from open_projection_engine import build_for_players, finite, load_parquet_rows, normalize_name, position_prior, value


def actual_half(row: dict) -> float:
    ppr = finite(value(row, "fantasy_points_ppr"), None)
    standard = finite(value(row, "fantasy_points"), None)
    receptions = finite(value(row, "receptions", "rec"), 0) or 0
    if standard is not None:
        return standard + receptions * 0.5
    return max(0, (ppr or 0) - receptions * 0.5)


def rank_values(values: list[float]) -> list[int]:
    order = sorted(range(len(values)), key=lambda index: values[index])
    ranks = [0] * len(values)
    for rank, index in enumerate(order, 1):
        ranks[index] = rank
    return ranks


def spearman(left: list[float], right: list[float]) -> float:
    if len(left) < 3:
        return 0
    a, b = rank_values(left), rank_values(right)
    mean_a, mean_b = statistics.mean(a), statistics.mean(b)
    numerator = sum((x - mean_a) * (y - mean_b) for x, y in zip(a, b))
    denominator = (sum((x - mean_a) ** 2 for x in a) * sum((y - mean_b) ** 2 for y in b)) ** 0.5
    return numerator / denominator if denominator else 0


def season_rows(rows: list[dict], season: int) -> list[dict]:
    return [row for row in rows if int(finite(value(row, "season"), -1) or -1) == season and str(value(row, "position", default="")).upper() in {"QB", "RB", "WR", "TE"}]


def evaluate(rows: list[dict], target: int, signals: dict[str, list[dict]]) -> dict:
    prior_rows = season_rows(rows, target - 1)
    actual_rows = season_rows(rows, target)
    prior_by_key = {(normalize_name(value(row, "player_display_name", "player_name")), str(value(row, "position")).upper()): row for row in prior_rows}
    actual_by_key = {(normalize_name(value(row, "player_display_name", "player_name")), str(value(row, "position")).upper()): row for row in actual_rows}
    common = [key for key in prior_by_key if key in actual_by_key and (finite(value(actual_by_key[key], "games"), 0) or 0) >= 4]
    by_position: dict[str, list[tuple]] = defaultdict(list)
    for key in common:
        by_position[key[1]].append(key)
    position_ranks = {}
    for position, keys in by_position.items():
        ordered = sorted(keys, key=lambda key: actual_half(prior_by_key[key]), reverse=True)
        position_ranks.update({key: rank for rank, key in enumerate(ordered, 1)})
    overall = sorted(common, key=lambda key: actual_half(prior_by_key[key]), reverse=True)
    overall_ranks = {key: rank for rank, key in enumerate(overall, 1)}
    players = [{"name": value(prior_by_key[key], "player_display_name", "player_name"), "position": key[1], "position_rank": position_ranks[key], "overall_rank": overall_ranks[key]} for key in common]
    projected = build_for_players(players, rows, target, signals)
    predictions, baselines, actuals, late = [], [], [], []
    for player in players:
        key = (normalize_name(player["name"]), player["position"])
        item = projected[f"{key[0]}|{key[1]}"]
        prior_standard, prior_rec = position_prior(player["position"], player["position_rank"])
        predictions.append(item["points_half"])
        baselines.append(prior_standard + prior_rec * 0.5)
        actuals.append(actual_half(actual_by_key[key]))
        if player["overall_rank"] > 120:
            late.append((item["points_half"], baselines[-1], actuals[-1]))
    threshold = statistics.quantiles([row[2] for row in late], n=4)[2] if len(late) >= 8 else float("inf")
    sample = min(30, len(late))
    model_late = sorted(late, key=lambda row: row[0], reverse=True)[:sample]
    baseline_late = sorted(late, key=lambda row: row[1], reverse=True)[:sample]
    return {
        "season": target,
        "players": len(players),
        "mae": round(statistics.mean(abs(predicted - actual) for predicted, actual in zip(predictions, actuals)), 3),
        "baseline_mae": round(statistics.mean(abs(predicted - actual) for predicted, actual in zip(baselines, actuals)), 3),
        "spearman": round(spearman(predictions, actuals), 4),
        "baseline_spearman": round(spearman(baselines, actuals), 4),
        "late_players": len(late),
        "late_hit_rate": round(sum(row[2] >= threshold for row in model_late) / sample, 4) if sample else 0,
        "baseline_late_hit_rate": round(sum(row[2] >= threshold for row in baseline_late) / sample, 4) if sample else 0,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path("data/raw/nflverse/seasonal_stats.parquet"))
    parser.add_argument("--nflverse-dir", type=Path, default=Path("data/raw/nflverse"))
    parser.add_argument("--output", type=Path, default=Path("reports/open_projection_backtest.json"))
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()
    rows = load_parquet_rows(args.input)
    seasons = sorted({int(value(row, "season")) for row in rows if finite(value(row, "season"), None) is not None})
    signals = {}
    for name, filename in {"opportunity": "ff_opportunity.parquet", "snaps": "snap_counts.parquet", "depth": "depth_charts.parquet", "injuries": "injuries.parquet"}.items():
        path = args.nflverse_dir / filename
        if path.exists():
            signals[name] = load_parquet_rows(path)
    results = [evaluate(rows, season, signals) for season in seasons[-2:] if season - 1 in seasons]
    passed = bool(results) and all(
        result["players"] >= 100
        and result["mae"] <= result["baseline_mae"] * 1.05
        and result["spearman"] >= result["baseline_spearman"] - 0.03
        and result["late_hit_rate"] >= result["baseline_late_hit_rate"] - 0.05
        for result in results
    )
    payload = {"schema_version": 1, "method": "walk-forward; target-season rows excluded from every model input", "passed": passed, "seasons": results}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 1 if args.strict and not passed else 0


if __name__ == "__main__":
    raise SystemExit(main())
