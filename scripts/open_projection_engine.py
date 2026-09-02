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

MODEL_VERSION = "open-nflverse-v2-opportunity-availability"
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


def index_history(rows: list[dict[str, Any]], target_season: int | None = None) -> dict[tuple[str, str], list[dict[str, Any]]]:
    result: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        name = value(row, "player_display_name", "player_name", "name")
        position = str(value(row, "position", "position_group", default="") or "").upper()
        season = finite(value(row, "season"), None)
        if name and position in SKILL_POSITIONS and (target_season is None or season is None or int(season) < target_season):
            result[(normalize_name(name), position)].append(row)
    return result


def _row_position(row: dict[str, Any]) -> str:
    raw = str(value(row, "position", "position_group", "pos_abb", "pos", default="") or "").upper()
    aliases = {"HB": "RB", "FB": "RB"}
    return aliases.get(raw, raw)


def _row_name(row: dict[str, Any]) -> str:
    return str(value(row, "player_display_name", "player_name", "full_name", "player", "name", default="") or "").strip()


def _before_target(row: dict[str, Any], target_season: int) -> bool:
    season = finite(value(row, "season"), None)
    if season is not None:
        return int(season) < target_season
    stamp = str(value(row, "dt", "date", "timestamp", default="") or "")
    return bool(stamp[:4].isdigit() and int(stamp[:4]) < target_season)


def index_signal_rows(rows: list[dict[str, Any]], target_season: int) -> dict[tuple[str, str], list[dict[str, Any]]]:
    result: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        name, position = _row_name(row), _row_position(row)
        if name and position in SKILL_POSITIONS and _before_target(row, target_season):
            result[(normalize_name(name), position)].append(row)
    return result


def _ordered_values(rows: list[dict[str, Any]], fields: tuple[str, ...]) -> list[float]:
    ordered = sorted(
        rows,
        key=lambda row: (
            finite(value(row, "season"), 0) or 0,
            finite(value(row, "week"), 0) or 0,
            str(value(row, "dt", "date", default="") or ""),
        ),
    )
    result = []
    for row in ordered:
        number = finite(value(row, *fields), None)
        if number is not None:
            result.append(number)
    return result


def _window_delta(values: list[float], window: int = 6) -> float | None:
    if len(values) < 4:
        return None
    split = min(window, len(values) // 2)
    recent, previous = values[-split:], values[-2 * split:-split]
    prior = sum(previous) / len(previous) if previous else 0
    if prior <= 0:
        return None
    current = sum(recent) / len(recent)
    return max(-0.25, min(0.25, current / prior - 1))


def role_signals(
    player: dict[str, Any],
    indexes: dict[str, dict[tuple[str, str], list[dict[str, Any]]]],
) -> dict[str, Any]:
    key = (normalize_name(player.get("name")), str(player.get("position") or "").upper())
    opportunity = _window_delta(_ordered_values(indexes.get("opportunity", {}).get(key, []), (
        "fantasy_points_exp", "expected_fantasy_points", "total_fantasy_points_exp", "x_fp", "xfp", "expected_points",
    )))
    snap = _window_delta(_ordered_values(indexes.get("snaps", {}).get(key, []), (
        "offense_pct", "off_pct", "offense_snap_pct", "offense_snaps_pct", "offensive_snap_pct",
    )))
    depth_rows = indexes.get("depth", {}).get(key, [])
    depth_values = _ordered_values(depth_rows, ("pos_rank", "depth_rank", "position_rank"))
    depth_rank = int(depth_values[-1]) if depth_values else None
    injury_rows = sorted(
        indexes.get("injuries", {}).get(key, []),
        key=lambda row: (finite(value(row, "season"), 0) or 0, finite(value(row, "week"), 0) or 0),
    )
    injury_status = str(value(injury_rows[-1], "report_status", "injury_status", "status", default="") or "").upper() if injury_rows else ""
    depth_adjustment = 0.04 if depth_rank == 1 else 0 if depth_rank in (None, 2) else -0.03
    injury_adjustment = -0.12 if any(term in injury_status for term in ("OUT", "RESERVE", "PUP", "IR")) else -0.08 if "DOUBTFUL" in injury_status else -0.03 if "QUESTIONABLE" in injury_status else 0
    adjustment = max(-0.15, min(0.15, (opportunity or 0) * 0.28 + (snap or 0) * 0.12 + depth_adjustment + injury_adjustment))
    evidence = []
    if opportunity is not None:
        evidence.append(f"expected-opportunity trend {opportunity:+.0%}")
    if snap is not None:
        evidence.append(f"offensive-snap trend {snap:+.0%}")
    if depth_rank is not None:
        evidence.append(f"latest historical depth rank {depth_rank}")
    if injury_status:
        evidence.append(f"latest historical injury status {injury_status}")
    return {
        "adjustment": round(adjustment, 4),
        "opportunity_delta": round(opportunity, 4) if opportunity is not None else None,
        "snap_delta": round(snap, 4) if snap is not None else None,
        "depth_rank": depth_rank,
        "injury_status": injury_status or None,
        "evidence": evidence,
    }


def project_player(
    player: dict[str, Any],
    history: dict[tuple[str, str], list[dict[str, Any]]],
    season: int,
    signal_indexes: dict[str, dict[tuple[str, str], list[dict[str, Any]]]] | None = None,
) -> dict[str, Any]:
    position = str(player.get("position") or "").upper()
    pos_rank = int(finite(player.get("position_rank"), 99) or 99)
    prior_points, prior_rec = position_prior(position, pos_rank)
    draft_pick = finite(player.get("draft_pick"), None)
    rookie_adjustment = 0.0
    if draft_pick is not None and int(finite(player.get("draft_year"), 0) or 0) == season:
        rookie_adjustment = 0.12 if draft_pick <= 32 else 0.07 if draft_pick <= 64 else 0.03 if draft_pick <= 100 else -0.05
        prior_points *= 1 + rookie_adjustment
        prior_rec *= 1 + rookie_adjustment
    lines = _season_lines(history.get((normalize_name(player.get("name")), position), []))[:3]
    if not lines or position not in SKILL_POSITIONS:
        standard, receptions = prior_points, prior_rec
        confidence = 48 if position in {"K", "DST"} else 42
        evidence = "position-rank prior; no usable NFL history"
        if rookie_adjustment:
            evidence += f"; NFL draft-capital prior {rookie_adjustment:+.0%}"
        seasons: list[int] = []
        expected_games = 15.5
    else:
        weights = [0.55, 0.30, 0.15][:len(lines)]
        divisor = sum(weights)
        sample_games = sum(line["games"] for line in lines)
        weighted_availability = sum(min(17.0, line["games"]) / 17.0 * weight for line, weight in zip(lines, weights)) / divisor
        experience_weight = min(0.72, sample_games / 70.0)
        availability_rate = 0.91 * (1 - experience_weight) + weighted_availability * experience_weight
        expected_games = max(11.5, min(16.7, 17.0 * availability_rate))
        historical_points = sum(line["points_pg"] * weight for line, weight in zip(lines, weights)) / divisor * expected_games
        historical_rec = sum(line["rec_pg"] * weight for line, weight in zip(lines, weights)) / divisor * expected_games
        reliability = min(0.82, 0.30 + sample_games / 70.0)
        trend = 0.0
        if len(lines) >= 2 and lines[1]["points_pg"] > 0:
            trend = max(-0.08, min(0.08, (lines[0]["points_pg"] / lines[1]["points_pg"] - 1) * 0.20))
        standard = (historical_points * (1 + trend)) * reliability + prior_points * (1 - reliability)
        receptions = historical_rec * reliability + prior_rec * (1 - reliability)
        confidence = min(84, round(50 + sample_games * 0.8 + (8 if len(lines) >= 2 else 0)))
        evidence = "recency-weighted NFL production, bounded trend, and regressed position prior"
        seasons = [int(line["season"]) for line in lines]
    signals = role_signals(player, signal_indexes or {})
    standard *= 1 + signals["adjustment"]
    receptions *= 1 + signals["adjustment"]
    confidence = min(88, confidence + min(8, len(signals["evidence"]) * 2))
    median_half = max(0, standard + receptions * 0.5)
    uncertainty = max(0.13, min(0.34, 0.38 - confidence / 400))
    return {
        "name": player.get("name"),
        "position": position,
        "points": round(max(0, standard), 1),
        "points_half": round(max(0, standard + receptions * 0.5), 1),
        "points_ppr": round(max(0, standard + receptions), 1),
        "points_distribution": {
            "p10": round(max(0, median_half * (1 - uncertainty * 1.25)), 1),
            "p50": round(median_half, 1),
            "p90": round(median_half * (1 + uncertainty), 1),
        },
        "expected_games": round(expected_games, 1),
        "availability_probability": round(expected_games / 17.0, 3),
        "rookie_draft_capital_adjustment": round(rookie_adjustment, 3) if rookie_adjustment else None,
        "stats": {"rec": round(max(0, receptions), 1)},
        "projection_source": "open_nflverse_model",
        "projection_mode": "OPEN_MODEL_PROJECTION",
        "projection_confidence": confidence,
        "model_version": MODEL_VERSION,
        "evidence": evidence,
        "role_signal_evidence": signals["evidence"],
        "role_signals": {key: item for key, item in signals.items() if key != "evidence"},
        "evidence_seasons": seasons,
        "target_season": season,
    }


def build_for_players(
    players: list[dict[str, Any]],
    historical_rows: list[dict[str, Any]],
    season: int,
    signal_rows: dict[str, list[dict[str, Any]]] | None = None,
) -> dict[str, dict[str, Any]]:
    history = index_history(historical_rows, season)
    signal_indexes = {
        name: index_signal_rows(rows, season)
        for name, rows in (signal_rows or {}).items()
    }
    return {
        f"{normalize_name(player.get('name'))}|{str(player.get('position') or '').upper()}": project_player(player, history, season, signal_indexes)
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
