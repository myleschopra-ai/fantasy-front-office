#!/usr/bin/env python3
"""Auditable weekly projection model using only information known at cutoff."""
from __future__ import annotations

import math
import statistics
from collections import defaultdict
from typing import Any

from data_foundation import evidence_confidence, finite, normalize_name

SKILL_POSITIONS = {"QB", "RB", "WR", "TE", "K", "DST"}
MODEL_VERSION = "weekly-role-context-v2"

# nflverse and Sleeper disagree on one active franchise code; schedules use nflverse codes.
SCHEDULE_TEAM = {"LAR": "LA", "JAC": "JAX", "WSH": "WAS", "OAK": "LV", "SD": "LAC", "STL": "LA"}
SLEEPER_TEAM = {"LA": "LAR"}
# Weekly-roster statuses that mean the player cannot appear in the target game.
# INA is a game-day designation published ~90 minutes before kickoff, so it is
# deliberately ignored here to keep weekly builds free of game-day lookahead.
AVAILABLE_ROSTER_STATUSES = {"ACT", "INA"}

DEFAULT_POLICY = {
    # Preseason season-long baseline fades as current-season games accumulate.
    "baseline_weight": 0.50,
    "baseline_floor": 0.25,
    "baseline_decay_games": 8,
    "recent_weight": 0.30,
    "xfp_weight": 0.20,
    # On the roster for each of the last two weeks, not listed out or doubtful,
    # and still no snaps: a role problem, not an injury. Chosen from 1.0/0.5/0.3
    # on the 2026 weeks 2-6 walk-forward check (docs/DECISION_LOG.md); one
    # season of evidence, so treat as provisional.
    "absent_factor": 0.3,
}
ABSENT_INJURY_WORDS = ("OUT", "DOUBTFUL", "RESERVE", "IR", "PUP", "SUSPENDED")


def schedule_team(code: Any) -> str:
    text = str(code or "").upper()
    return SCHEDULE_TEAM.get(text, text)


def sleeper_team(code: Any) -> str | None:
    text = str(code or "").upper()
    return SLEEPER_TEAM.get(text, text) or None


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
    name = value(row, "player_display_name", "player_name", "full_name", "name", "player")
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
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    context = context or {}
    policy = {**DEFAULT_POLICY, **(context.get("policy") or {})}
    history = lookup(indexes.get("weekly", {}), player)
    weekly = history[-18:]
    season_games = [row for row in history if int(finite(value(row, "season"), -1) or -1) == season]
    games_last_2 = sum(1 for row in season_games if int(finite(value(row, "week"), 0) or 0) >= week - 2)
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

    decay_games = finite(policy.get("baseline_decay_games"), 0) or 0
    baseline_weight = policy["baseline_weight"]
    if decay_games > 0:
        baseline_weight *= max(policy["baseline_floor"], 1 - len(season_games) / decay_games)
    components = [item for item in ((season_baseline, baseline_weight), (recent_ppg, policy["recent_weight"]), (xfp, policy["xfp_weight"])) if item[0] is not None]
    median = sum(value_ * weight for value_, weight in components) / sum(weight for _, weight in components) if components else 0.0
    median *= 1 + role_delta * 0.35
    absent_weeks = recent_role_absence(player, season, week, indexes, history, snaps)
    role_absent = absent_weeks >= 2
    if role_absent:
        median *= finite(policy.get("absent_factor"), 1.0)
    base_points = median

    # Only the target week's own pre-game report counts. A report from an
    # earlier week (or last season) describes a game that has already happened.
    injuries = lookup(indexes.get("injuries", {}), player)
    injury_status = str(value(injuries[-1], "report_status", "injury_status", "status", default="") or "") if injuries else ""
    availability = status_availability(injury_status)
    roster_rows = lookup(indexes.get("rosters", {}), player)
    reserve_listed = False
    roster_status = str(value(roster_rows[-1], "status", default="") or "").upper() if roster_rows else None
    roster_team = value(roster_rows[-1], "team") if roster_rows else None
    unavailable_reason = None
    if roster_status and roster_status not in AVAILABLE_ROSTER_STATUSES:
        availability, unavailable_reason = 0.0, f"ROSTER_{roster_status}"
        reserve_listed = True
    if context.get("bye"):
        availability, unavailable_reason = 0.0, "BYE"
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
        team = schedule_team(context.get("team") or player.get("team"))
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
        "name": player.get("name"), "position": player.get("position"),
        "team": sleeper_team(context.get("team") or roster_team or player.get("team")),
        "season": season, "week": week, "projection_scope": "weekly",
        "universe_source": player.get("universe_source", "draft_board"),
        "projected_points": round(median, 2),
        # Points if the player suits up this week (before injury, bye, and roster
        # status). The dashboard re-applies live availability to this number.
        "base_points": round(base_points, 2),
        # Rest-of-season weekly strength for season simulations: zero while on a
        # reserve list, otherwise this week's healthy projection.
        "ros_points": 0.0 if reserve_listed else round(base_points, 2),
        "distribution": {"p10": round(p10, 2), "p50": round(median, 2), "p90": round(p90, 2)},
        "availability_probability": round(availability, 3),
        "injury_status": injury_status or None, "depth_chart_order": depth_rank,
        "roster_status": roster_status, "unavailable_reason": unavailable_reason, "bye": bool(context.get("bye")),
        "opponent": sleeper_team(opponent) if opponent else None, "home": home,
        "features": {
            "season_baseline_ppg": round(season_baseline, 3) if season_baseline is not None else None,
            "recent_6_ppg": round(recent_ppg, 3) if recent_ppg is not None else None,
            "targets_6": round(target6, 3) if target6 is not None else None,
            "carries_6": round(carries6, 3) if carries6 is not None else None,
            "opportunity_trend": round(role_delta, 4),
            "snap_share": round(snap_share, 4) if snap_share is not None else None,
            "expected_fantasy_points": round(xfp, 3) if xfp is not None else None,
            "games_this_season": len(season_games),
            "games_last_2": games_last_2,
            "role_absent_weeks": absent_weeks,
            "baseline_weight": round(baseline_weight, 3),
        },
        "data_confidence": {"score": confidence, "label": "HIGH" if confidence >= 80 else "MODERATE" if confidence >= 65 else "LOW" if confidence >= 45 else "INSUFFICIENT", "feature_coverage": round(coverage * 100)},
        "model_version": MODEL_VERSION,
        "evidence_cutoff": f"before {season} week {week}",
    }


def recent_role_absence(player: dict[str, Any], season: int, week: int, indexes: dict[str, dict[str, list[dict[str, Any]]]],
                        history: list[dict[str, Any]], snaps: list[dict[str, Any]]) -> int:
    """Count of the last two weeks the player was on the roster, not reported
    out or doubtful, yet recorded no game. Uses only weeks before the target."""
    roster_rows = lookup(indexes.get("rosters", {}), player)
    injury_rows = lookup(indexes.get("injury_history", {}), player)
    count = 0
    for prior in (week - 1, week - 2):
        if prior < 1:
            continue
        on_roster = any(int(finite(value(row, "week"), 0) or 0) == prior and str(value(row, "status", default="") or "").upper() in AVAILABLE_ROSTER_STATUSES for row in roster_rows)
        if not on_roster:
            continue
        def same_week(row: dict[str, Any]) -> bool:
            return int(finite(value(row, "season"), -1) or -1) == season and int(finite(value(row, "week"), 0) or 0) == prior
        injured = any(same_week(row) and any(word in str(value(row, "report_status", "injury_status", "status", default="") or "").upper() for word in ABSENT_INJURY_WORDS) for row in injury_rows)
        if injured:
            continue
        played = any(same_week(row) for row in history) or any(same_week(row) and (finite(value(row, "offense_pct", "off_pct", "offense_snap_pct"), 0) or 0) > 0 for row in snaps)
        if not played:
            count += 1
    return count


def latest_roster_rows(rows: list[dict[str, Any]], season: int, week: int) -> dict[str, list[dict[str, Any]]]:
    """Current-season weekly roster rows up to and including the target week."""
    result: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if int(finite(value(row, "season"), -1) or -1) != season:
            continue
        if int(finite(value(row, "week"), 0) or 0) > week:
            continue
        result[row_key(row)].append(row)
    for values in result.values():
        values.sort(key=lambda row: finite(value(row, "week"), 0) or 0)
    return result


def target_week_rows(rows: list[dict[str, Any]], season: int, week: int) -> dict[str, list[dict[str, Any]]]:
    """Pre-game reports published for the target week itself (no earlier week, no earlier season)."""
    result: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if int(finite(value(row, "season"), -1) or -1) == season and int(finite(value(row, "week"), 0) or 0) == week:
            result[row_key(row)].append(row)
    return result


def build(players: list[dict[str, Any]], datasets: dict[str, list[dict[str, Any]]], season: int, week: int, policy: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    special = {"schedules", "injuries", "rosters"}
    indexes = {name: index_rows(rows, season, week) for name, rows in datasets.items() if name not in special}
    indexes["injuries"] = target_week_rows(datasets.get("injuries", []), season, week)
    indexes["injury_history"] = index_rows(datasets.get("injuries", []), season, week)
    indexes["rosters"] = latest_roster_rows(datasets.get("rosters", []), season, week)
    schedules = [row for row in datasets.get("schedules", []) if int(finite(value(row, "season"), -1) or -1) == season and int(finite(value(row, "week"), -1) or -1) == week]
    team_games = {}
    for game in schedules:
        for team in (game.get("home_team"), game.get("away_team")):
            if team:
                team_games[schedule_team(team)] = game
    rows = []
    for player in players:
        if str(player.get("position") or "").upper() not in SKILL_POSITIONS:
            continue
        roster_rows = lookup(indexes["rosters"], player)
        team = value(roster_rows[-1], "team") if roster_rows else player.get("team")
        code = schedule_team(team)
        bye = bool(team_games) and bool(code) and code not in team_games
        context = {"team": team, "bye": bye, "policy": policy}
        rows.append(build_player(player, season, week, indexes, team_games.get(code), context))
    return rows
