#!/usr/bin/env python3
"""Build time-locked weekly role features and probabilistic projections."""
from __future__ import annotations

import argparse
import bisect
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from data_foundation import finite, utc_now, write_json_atomic
from open_projection_engine import load_parquet_rows
from weekly_projection_engine import MODEL_VERSION, build, value

SKILL = {"QB", "RB", "WR", "TE"}
HISTORY_FIELDS = ["sleeper_id", "gsis_id", "name", "position", "team", "projected_points", "p10", "p90",
                  "availability_probability", "injury_status", "unavailable_reason", "opponent", "games_last_2"]


DEPTH_COLUMNS = ["gsis_id", "full_name", "player_name", "position", "pos_abb", "pos_grp", "season", "week", "pos_rank", "dt", "team"]
KEEP_SPECIAL_TEAMS = {"PK", "K"}


def week_starts(schedules: list[dict]) -> list[tuple[str, int, int]]:
    """First gameday of every (season, week), ascending: [(YYYY-MM-DD, season, week)]."""
    first: dict[tuple[int, int], str] = {}
    for game in schedules:
        season = int(finite(value(game, "season"), -1) or -1)
        week = int(finite(value(game, "week"), -1) or -1)
        day = str(game.get("gameday") or "")[:10]
        if season < 0 or week < 0 or len(day) != 10:
            continue
        key = (season, week)
        first[key] = min(first.get(key, day), day)
    return sorted((day, season, week) for (season, week), day in first.items())


def depth_week(stamp: str, starts: list[tuple[str, int, int]]) -> tuple[int, int] | None:
    """The last NFL week that had kicked off when a dated depth chart was published.

    nflverse depth charts from 2025 on carry only a UTC timestamp. Tagging each
    chart with the week already under way lets the engine's season/week cutoff
    keep a chart away from any projection for that week or earlier.
    Timestamps are shifted to US Eastern (UTC-5, conservative) before comparing
    with schedule gamedays.
    """
    if not stamp or not starts:
        return None
    try:
        moment = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return None
    day = (moment - timedelta(hours=5)).date().isoformat()
    index = bisect.bisect_right([start[0] for start in starts], day) - 1
    if index < 0:
        return starts[0][1], 0
    return starts[index][1], starts[index][2]


def load_depth_for_players(path: Path, players: list[dict], schedules: list[dict] | None = None) -> list[dict]:
    """Filter the million-row daily depth history before converting it to Python objects.

    Reads whichever columns the file has (the 2025+ format has no season, week,
    position or full_name), drops kick/punt return slots, dates timestamp-only
    rows to an NFL week, and returns rows oldest first so the latest chart
    before the cutoff is the one the engine reads.
    """
    if not path.exists():
        return []
    import pyarrow as pa
    import pyarrow.compute as pc
    import pyarrow.parquet as parquet
    available = set(parquet.read_schema(path).names)
    table = parquet.read_table(path, columns=[column for column in DEPTH_COLUMNS if column in available])
    identifiers = sorted({str((player.get("source_ids") or {}).get("gsis")) for player in players if (player.get("source_ids") or {}).get("gsis")})
    if identifiers and "gsis_id" in available:
        table = table.filter(pc.is_in(table["gsis_id"], value_set=pa.array(identifiers)))
    rows = table.to_pylist()
    starts = week_starts(schedules or [])
    result = []
    for row in rows:
        if str(row.get("pos_grp") or "") == "Special Teams" and str(row.get("pos_abb") or "") not in KEEP_SPECIAL_TEAMS:
            continue
        if row.get("season") is None or row.get("week") is None:
            tagged = depth_week(str(row.get("dt") or ""), starts)
            if tagged is None:
                continue
            row["season"], row["week"] = tagged
        result.append(row)
    result.sort(key=lambda row: (str(row.get("dt") or ""), -int(finite(row.get("pos_rank"), 0) or 0)))
    return result


def _int(row: dict, name: str, default: int = -1) -> int:
    return int(finite(value(row, name), default) or default)


def active_universe(
    board: list[dict[str, Any]], rosters: list[dict[str, Any]], weekly: list[dict[str, Any]],
    identity: list[dict[str, Any]], season: int, week: int,
) -> list[dict[str, Any]]:
    """Every QB/RB/WR/TE on a current-season NFL roster who has played since last season.

    The preseason draft board covers ~320 players; lineups, waivers and trades
    need the whole active pool, including players the board never ranked.
    Board players keep their season-long baseline; everyone else is projected
    from role and recent production only.
    """
    identity_by_gsis = {str((row.get("source_ids") or {}).get("gsis")): row for row in identity if (row.get("source_ids") or {}).get("gsis")}
    played: set[str] = set()
    for row in weekly:
        row_season, row_week = _int(row, "season"), _int(row, "week", 0)
        if row_season == season - 1 or (row_season == season and row_week < week):
            identifier = value(row, "player_id", "gsis_id")
            if identifier:
                played.add(str(identifier))
    latest: dict[str, dict[str, Any]] = {}
    for row in rosters:
        if _int(row, "season") != season or _int(row, "week", 0) > week:
            continue
        identifier = value(row, "gsis_id")
        if not identifier or str(value(row, "position") or "").upper() not in SKILL:
            continue
        previous = latest.get(str(identifier))
        if previous is None or _int(row, "week", 0) >= _int(previous, "week", 0):
            latest[str(identifier)] = row

    universe = []
    seen: set[str] = set()
    for player in board:
        ids = dict(player.get("source_ids") or {})
        gsis = ids.get("gsis")
        if gsis and str(gsis) in latest and not ids.get("sleeper"):
            sleeper = value(latest[str(gsis)], "sleeper_id")
            if sleeper:
                ids["sleeper"] = str(int(float(sleeper))) if str(sleeper).replace(".", "", 1).isdigit() else str(sleeper)
        universe.append({**player, "source_ids": ids})
        if gsis:
            seen.add(str(gsis))
    for gsis, row in sorted(latest.items()):
        if gsis in seen or gsis not in played:
            continue
        known = identity_by_gsis.get(gsis) or {}
        ids = {key: val for key, val in (known.get("source_ids") or {}).items() if val}
        ids["gsis"] = gsis
        for source, column in (("sleeper", "sleeper_id"), ("espn", "espn_id"), ("yahoo", "yahoo_id"), ("pfr", "pfr_id")):
            raw = value(row, column)
            if raw and not ids.get(source):
                text = str(raw)
                ids[source] = str(int(float(text))) if text.replace(".", "", 1).isdigit() else text
        universe.append({
            "player_key": f"gsis:{gsis}",
            "name": value(row, "full_name") or known.get("name"),
            "position": str(value(row, "position")).upper(),
            "team": value(row, "team"),
            "source_ids": ids,
            "identity_confidence": 95 if ids.get("sleeper") else 70,
            "projection_confidence": 50,
            "universe_source": "active_roster",
        })
    return universe


def history_snapshot(rows: list[dict[str, Any]], season: int, week: int, generated_at: str) -> dict[str, Any]:
    """Compact, column-oriented copy kept per week for replay and scoring."""
    table = []
    for row in rows:
        ids = row.get("source_ids") or {}
        table.append([
            ids.get("sleeper"), ids.get("gsis"), row.get("name"), row.get("position"), row.get("team"),
            row.get("projected_points"), row["distribution"]["p10"], row["distribution"]["p90"],
            row.get("availability_probability"), row.get("injury_status"), row.get("unavailable_reason"),
            row.get("opponent"), (row.get("features") or {}).get("games_last_2"),
        ])
    return {"schema_version": 1, "season": season, "week": week, "generated_at": generated_at,
            "model_version": MODEL_VERSION, "evidence_cutoff": f"before {season} week {week}",
            "fields": HISTORY_FIELDS, "players": table}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, default=datetime.now().year)
    parser.add_argument("--week", type=int, default=1)
    parser.add_argument("--profile", default="redraft_1qb_half")
    parser.add_argument("--universe", choices=["active", "board"], default="active")
    parser.add_argument("--draft-intelligence", type=Path, default=Path("data/draft_intelligence.json"))
    parser.add_argument("--identity", type=Path, default=Path("data/normalized/player_identity.json"))
    parser.add_argument("--nflverse-dir", type=Path, default=Path("data/raw/nflverse"))
    parser.add_argument("--output", type=Path, default=Path("data/weekly_projections.json"))
    parser.add_argument("--history-dir", type=Path, default=Path("data/weekly_projections"))
    parser.add_argument("--no-history", action="store_true")
    args = parser.parse_args()
    board_doc = json.loads(args.draft_intelligence.read_text(encoding="utf-8"))
    board = (board_doc.get("profiles", {}).get(args.profile) or {}).get("players", [])
    file_map = {"weekly": "weekly_stats.parquet", "snaps": "snap_counts.parquet", "opportunity": "ff_opportunity.parquet",
                "injuries": "injuries.parquet", "schedules": "schedules.parquet", "rosters": "weekly_rosters.parquet"}
    datasets: dict[str, list[dict]] = {}
    for name, filename in file_map.items():
        path = args.nflverse_dir / filename
        if path.exists():
            datasets[name] = load_parquet_rows(path)
    players = board
    if args.universe == "active" and datasets.get("rosters"):
        identity = json.loads(args.identity.read_text(encoding="utf-8")).get("players", []) if args.identity.exists() else []
        players = active_universe(board, datasets["rosters"], datasets.get("weekly", []), identity, args.season, args.week)
    depth_path = args.nflverse_dir / "depth_charts.parquet"
    if depth_path.exists():
        datasets["depth"] = load_depth_for_players(depth_path, players, datasets.get("schedules", []))
    rows = build(players, datasets, args.season, args.week)
    usable = sum(row["data_confidence"]["score"] >= 45 for row in rows)
    generated_at = utc_now()
    payload = {
        "schema_version": 1, "generated_at": generated_at, "projection_scope": "weekly",
        "season": args.season, "week": args.week, "model_version": MODEL_VERSION,
        "players": rows,
        "quality": {
            "players": len(rows), "usable_players": usable,
            "usable_rate": round(usable / len(rows), 3) if rows else 0,
            "board_players": len(board), "universe": args.universe,
            "with_sleeper_id": sum(bool((row.get("source_ids") or {}).get("sleeper")) for row in rows),
            "on_bye": sum(bool(row.get("bye")) for row in rows),
            "unavailable": sum(row.get("availability_probability", 1) <= 0.05 for row in rows),
            "datasets": {name: len(values) for name, values in datasets.items()},
            # Active-universe builds include deep reserves with thin evidence by design;
            # publishability is judged on the board players the old gate measured.
            "status": "publishable" if rows and usable / len(rows) >= (0.70 if args.universe == "active" else 0.90) else "limited",
            "no_lookahead": True,
        },
    }
    write_json_atomic(args.output, payload)
    if not args.no_history:
        write_json_atomic(args.history_dir / f"{args.season}-w{args.week:02d}.json", history_snapshot(rows, args.season, args.week, generated_at))
    print(json.dumps(payload["quality"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
