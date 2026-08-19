#!/usr/bin/env python3
"""No-key season projection model built from open nflverse history.

The model is intentionally auditable and conservative. Historical per-game
production is recency weighted, adjusted by a bounded opportunity trend, and
shrunk toward a position-rank prior. Players without NFL history receive the
prior with lower confidence so the draft board remains complete.
"""
from __future__ import annotations

import math
from collections import defaultdict
from pathlib import Path
from typing import Any

MODEL_VERSION = "open-nflverse-v1"
SKILL_POSITIONS = {"QB", "RB", "WR", "TE"}


def finite(value: Any, default: float | None = None) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except (TypeError, ValueError):
        return default


def normalize_name(value: Any) -> str:
    import re
    import unicodedata
    text = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode("ascii").lower()
    text = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", text)
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def value(row: dict[str, Any], *names: str, default: Any = None) -> Any:
    lowered = {str(key).lower(): item for key, item in row.items()}
    for name in names:
        if lowered.get(name.lower()) not in (None, ""):
            return lowered[name.lower()]
    return default


def position_prior(position: str, position_rank: int) -> tuple[float, float]:
    rank = max(1, position_rank)
    if position == "QB":
        return max(70.0, 345.0 - 6.6 * (rank - 1)), 0.5
    if position == "RB":
        receptions = max(8.0, 65.0 - 0.62 * (rank - 1))
        return max(32.0, 252.0 - 2.75 * (rank - 1)), receptions
    if position == "WR":
        receptions = max(15.0, 98.0 - 0.72 * (rank - 1))
        return max(30.0, 226.0 - 2.05 * (rank - 1)), receptions
    if position == "TE":
        receptions = max(12.0, 86.0 - 1.20 * (rank - 1))
        return max(25.0, 181.0 - 3.25 * (rank - 1)), receptions
    if position == "K":
        return max(82.0, 160.0 - 2.25 * (rank - 1)), 0.0
    return max(76.0, 154.0 - 2.35 * (rank - 1)), 0.0


def _season_lines(rows: list[dict[str, Any]]) -> list[dict[str, float]]:
    result = []
    for row in rows:
        games = max(1.0, finite(value(row, "games", "games_played"), 0) or 0)
        standard = finite(value(row, "fantasy_points"), None)
        receptions = finite(value(row, "receptions", "rec"), 0) or 0
        if standard is None:
            standard = (
                (finite(value(row, "passing_yards"), 0) or 0) * 0.04
                + (finite(value(row, "passing_tds"), 0) or 0) * 4
                - (finite(value(row, "interceptions"), 0) or 0) * 2
                + ((finite(value(row, "rushing_yards"), 0) or 0) + (finite(value(row, "receiving_yards"), 0) or 0)) * 0.1
                + ((finite(value(row, "rushing_tds"), 0) or 0) + (finite(value(row, "receiving_tds"), 0) or 0)) * 6
                - ((finite(value(row, "rushing_fumbles_lost"), 0) or 0) + (finite(value(row, "receiving_fumbles_lost"), 0) or 0)) * 2
            )
        result.append({
            "season": finite(value(row, "season"), 0) or 0,
            "games": games,
            "points_pg": max(0.0, standard / games),
            "rec_pg": max(0.0, receptions / games),
        })
    return sorted(result, key=lambda item: item["season"], reverse=True)


def index_history(rows: list[dict[str, Any]]) -> dict[tuple[str, str], list[dict[str, Any]]]:
    result: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        name = value(row, "player_display_name", "player_name", "name")
        position = str(value(row, "position", "position_group", default="") or "").upper()
        if name and position in SKILL_POSITIONS:
            result[(normalize_name(name), position)].append(row)
    return result


def project_player(player: dict[str, Any], history: dict[tuple[str, str], list[dict[str, Any]]], season: int) -> dict[str, Any]:
    position = str(player.get("position") or "").upper()
    pos_rank = int(finite(player.get("position_rank"), 99) or 99)
    prior_points, prior_rec = position_prior(position, pos_rank)
    lines = _season_lines(history.get((normalize_name(player.get("name")), position), []))[:3]
    if not lines or position not in SKILL_POSITIONS:
        standard, receptions = prior_points, prior_rec
        confidence = 48 if position in {"K", "DST"} else 42
        evidence = "position-rank prior; no usable NFL history"
        seasons: list[int] = []
    else:
        weights = [0.55, 0.30, 0.15][:len(lines)]
        divisor = sum(weights)
        expected_games = 15.5
        historical_points = sum(line["points_pg"] * weight for line, weight in zip(lines, weights)) / divisor * expected_games
        historical_rec = sum(line["rec_pg"] * weight for line, weight in zip(lines, weights)) / divisor * expected_games
        sample_games = sum(line["games"] for line in lines)
        reliability = min(0.82, 0.30 + sample_games / 70.0)
        trend = 0.0
        if len(lines) >= 2 and lines[1]["points_pg"] > 0:
            trend = max(-0.08, min(0.08, (lines[0]["points_pg"] / lines[1]["points_pg"] - 1) * 0.20))
        standard = (historical_points * (1 + trend)) * reliability + prior_points * (1 - reliability)
        receptions = historical_rec * reliability + prior_rec * (1 - reliability)
        confidence = min(84, round(50 + sample_games * 0.8 + (8 if len(lines) >= 2 else 0)))
        evidence = "recency-weighted NFL production, bounded trend, and regressed position prior"
        seasons = [int(line["season"]) for line in lines]
    return {
        "name": player.get("name"),
        "position": position,
        "points": round(max(0, standard), 1),
        "points_half": round(max(0, standard + receptions * 0.5), 1),
        "points_ppr": round(max(0, standard + receptions), 1),
        "stats": {"rec": round(max(0, receptions), 1)},
        "projection_source": "open_nflverse_model",
        "projection_mode": "OPEN_MODEL_PROJECTION",
        "projection_confidence": confidence,
        "model_version": MODEL_VERSION,
        "evidence": evidence,
        "evidence_seasons": seasons,
        "target_season": season,
    }


def build_for_players(players: list[dict[str, Any]], historical_rows: list[dict[str, Any]], season: int) -> dict[str, dict[str, Any]]:
    history = index_history(historical_rows)
    return {
        f"{normalize_name(player.get('name'))}|{str(player.get('position') or '').upper()}": project_player(player, history, season)
        for player in players
        if player.get("name") and player.get("position")
    }


def load_parquet_rows(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        import pyarrow.parquet as parquet  # type: ignore
        return parquet.read_table(path).to_pylist()
    except ImportError:
        try:
            import polars as pl  # type: ignore
            return pl.read_parquet(path).to_dicts()
        except ImportError:
            import pandas as pd  # type: ignore
            return pd.read_parquet(path).to_dict("records")
