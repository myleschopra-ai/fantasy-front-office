#!/usr/bin/env python3
"""Auditable weekly projection model using only information known at cutoff."""
from __future__ import annotations

import math
import statistics
from collections import defaultdict
from typing import Any

from data_foundation import evidence_confidence, finite, normalize_name

SKILL_POSITIONS = {"QB", "RB", "WR", "TE", "K", "DST"}
MODEL_VERSION = "weekly-role-context-v1"


def value(row: dict[str, Any], *names: str, default: Any = None) -> Any:
    lowered = {str(key).lower(): item for key, item in row.items()}
    for name in names:
        item = lowered.get(name.lower())
        if item not in (None, ""):
            return item
    return default


def row_key(row: dict[str, Any]) -> str:
    identifier = value(row, "player_id", "gsis_id")
    if identifier not in (None, ""):
        return f"gsis:{identifier}"
    name = value(row, "player_display_name", "player_name", "full_name", "name")
    position = str(value(row, "position", "position_group", default="") or "").upper()
    return f"name:{normalize_name(name)}|{position}"


def before_cutoff(row: dict[str, Any], season: int, week: int) -> bool:
    row_season = int(finite(value(row, "season"), -1) or -1)
    row_week = int(finite(value(row, "week"), 0) or 0)
    return row_season < season or (row_season == season and row_week < week)


def player_keys(player: dict[str, Any]) -> list[str]:
    keys = []
    gsis = (player.get("source_ids") or {}).get("gsis")
    if gsis:
        keys.append(f"gsis:{gsis}")
    keys.append(f"name:{normalize_name(player.get('name'))}|{str(player.get('position') or '').upper()}")
    return keys


def index_rows(rows: list[dict[str, Any]], season: int, week: int) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if before_cutoff(row, season, week):
            result[row_key(row)].append(row)
    for values in result.values():
        values.sort(key=lambda row: (finite(value(row, "season"), 0) or 0, finite(value(row, "week"), 0) or 0))
    return result


def lookup(index: dict[str, list[dict[str, Any]]], player: dict[str, Any]) -> list[dict[str, Any]]:
    for key in player_keys(player):
        if key in index:
            return index[key]
    return []


def numbers(rows: list[dict[str, Any]], *fields: str) -> list[float]:
    result = []
    for row in rows:
        number = finite(value(row, *fields), None)
        if number is not None:
            result.append(number)
    return result


def average(values: list[float]) -> float | None:
    return statistics.mean(values) if values else None


def status_availability(status: str) -> float:
    status = str(status or "").upper()
    if any(word in status for word in ("OUT", "RESERVE", "PUP", "IR", "SUSPENDED")):
        return 0.02
    if "DOUBTFUL" in status:
        return 0.25
    if "QUESTIONABLE" in status:
        return 0.78
    if "LIMITED" in status:
        return 0.88
    return 0.96


def build_player(
    player: dict[str, Any], season: int, week: int,
    indexes: dict[str, dict[str, list[dict[str, Any]]]],
    game: dict[str, Any] | None = None,
) -> dict[str, Any]:
    weekly = lookup(indexes.get("weekly", {}), player)[-18:]
    recent6, recent3 = weekly[-6:], weekly[-3:]
    half_points = []
    for row in weekly:
        standard = finite(value(row, "fantasy_points"), None)
        ppr = finite(value(row, "fantasy_points_ppr"), None)
        receptions = finite(value(row, "receptions"), 0) or 0
        if standard is not None:
            half_points.append(max(0, standard + receptions * 0.5))
        elif ppr is not None:
            half_points.append(max(0, ppr - receptions * 0.5))
    recent_ppg = average(half_points[-6:])
    season_points = finite(player.get("projected_points"), None)
    expected_games = finite(player.get("expected_games"), 16.0) or 16.0
    season_baseline = season_points / expected_games if season_points is not None else None

    target6 = average(numbers(recent6, "targets"))
    target3 = average(numbers(recent3, "targets"))
    carries6 = average(numbers(recent6, "carries", "rushing_attempts"))
    carries3 = average(numbers(recent3, "carries", "rushing_attempts"))
    opportunities6 = (target6 or 0) + (carries6 or 0)
    opportunities3 = (target3 or 0) + (carries3 or 0)
    role_delta = 0.0
    if opportunities6 >= 2:
        role_delta = max(-0.20, min(0.20, opportunities3 / opportunities6 - 1))

    snaps = lookup(indexes.get("snaps", {}), player)
    snap_values = numbers(snaps[-6:], "offense_pct", "off_pct", "offense_snap_pct", "offensive_snap_pct")
    snap_share = average(snap_values)
    xfp_rows = lookup(indexes.get("opportunity", {}), player)
    xfp = average(numbers(xfp_rows[-6:], "fantasy_points_exp", "expected_fantasy_points", "total_fantasy_points_exp", "x_fp", "xfp"))

    components = [item for item in ((season_baseline, 0.50), (recent_ppg, 0.30), (xfp, 0.20)) if item[0] is not None]
    median = sum(value_ * weight for value_, weight in components) / sum(weight for _, weight in components) if components else 0.0
    median *= 1 + role_delta * 0.35

    injuries = lookup(indexes.get("injuries", {}), player)
    injury_status = str(value(injuries[-1], "report_status", "injury_status", "status", default="") or "") if injuries else str(player.get("injury_status") or "")
    availability = status_availability(injury_status)
    median *= availability

    depth = lookup(indexes.get("depth", {}), player)
    depth_rank = int(finite(value(depth[-1], "pos_rank", "depth_rank", "position_rank"), 0) or 0) if depth else None
    if depth_rank == 1:
        median *= 1.02
    elif depth_rank and depth_rank >= 3:
        median *= 0.94

    opponent = None
    home = None
    if game:
        team = str(player.get("team") or "").upper()
        home_team, away_team = str(game.get("home_team") or "").upper(), str(game.get("away_team") or "").upper()
        if team == home_team:
            opponent, home = away_team, True
        elif team == away_team:
            opponent, home = home_team, False

    sample_sd = statistics.pstdev(half_points[-8:]) if len(half_points) >= 3 else max(3.0, median * 0.34)
    p10 = max(0, median - 1.28 * sample_sd)
    p90 = max(median, median + 1.28 * sample_sd)
    coverage_values = [season_baseline, recent_ppg, target6 if player.get("position") in {"RB", "WR", "TE"} else 1, snap_share, injury_status or None, opponent]
    coverage = sum(item is not None for item in coverage_values) / len(coverage_values)
    identity = (finite(player.get("identity_confidence"), 55) or 55) / 100
    projection_confidence = (finite(player.get("projection_confidence"), 50) or 50) / 100
    confidence = evidence_confidence(identity=identity, freshness=0.90, coverage=coverage, agreement=projection_confidence, reliability=0.78)
    return {
        "player_key": player.get("player_key") or player_keys(player)[0],
        "source_ids": player.get("source_ids") or {},
        "name": player.get("name"), "position": player.get("position"), "team": player.get("team"),
        "season": season, "week": week, "projection_scope": "weekly",
        "projected_points": round(median, 2),
        "distribution": {"p10": round(p10, 2), "p50": round(median, 2), "p90": round(p90, 2)},
        "availability_probability": round(availability, 3),
        "injury_status": injury_status or None, "depth_chart_order": depth_rank,
        "opponent": opponent, "home": home,
        "features": {
            "season_baseline_ppg": round(season_baseline, 3) if season_baseline is not None else None,
            "recent_6_ppg": round(recent_ppg, 3) if recent_ppg is not None else None,
            "targets_6": round(target6, 3) if target6 is not None else None,
            "carries_6": round(carries6, 3) if carries6 is not None else None,
            "opportunity_trend": round(role_delta, 4),
            "snap_share": round(snap_share, 4) if snap_share is not None else None,
            "expected_fantasy_points": round(xfp, 3) if xfp is not None else None,
        },
        "data_confidence": {"score": confidence, "label": "HIGH" if confidence >= 80 else "MODERATE" if confidence >= 65 else "LOW" if confidence >= 45 else "INSUFFICIENT", "feature_coverage": round(coverage * 100)},
        "model_version": MODEL_VERSION,
        "evidence_cutoff": f"before {season} week {week}",
    }


def build(players: list[dict[str, Any]], datasets: dict[str, list[dict[str, Any]]], season: int, week: int) -> list[dict[str, Any]]:
    indexes = {name: index_rows(rows, season, week) for name, rows in datasets.items() if name != "schedules"}
    schedules = [row for row in datasets.get("schedules", []) if int(finite(value(row, "season"), -1) or -1) == season and int(finite(value(row, "week"), -1) or -1) == week]
    team_games = {}
    for game in schedules:
        for team in (game.get("home_team"), game.get("away_team")):
            if team:
                team_games[str(team).upper()] = game
    return [build_player(player, season, week, indexes, team_games.get(str(player.get("team") or "").upper())) for player in players if str(player.get("position") or "").upper() in SKILL_POSITIONS]
