#!/usr/bin/env python3
"""Build a canonical, cross-platform player registry without silent fuzzy joins."""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from data_foundation import canonical_key, finite, normalize_name, utc_now, write_json_atomic
from open_projection_engine import load_parquet_rows

POSITIONS = {"QB", "RB", "WR", "TE", "K", "DST"}


def position(value: Any) -> str:
    raw = str(value or "").upper()
    return {"DEF": "DST", "HB": "RB", "FB": "RB"}.get(raw, raw)


def age_on(birth_date: Any, as_of: date) -> float | None:
    try:
        born = datetime.fromisoformat(str(birth_date)[:10]).date()
        return round((as_of - born).days / 365.2425, 1)
    except (TypeError, ValueError):
        return None


def unique_index(rows: list[dict], key_fn) -> dict[Any, dict]:
    grouped: dict[Any, list[dict]] = defaultdict(list)
    for row in rows:
        key = key_fn(row)
        if key not in (None, "", ("", "")):
            grouped[key].append(row)
    return {key: values[0] for key, values in grouped.items() if len(values) == 1}


def build(nfl_players: list[dict], cross_ids: list[dict], sleeper: dict[str, dict], board: dict | None, season: int) -> dict:
    nfl_by_gsis = unique_index(nfl_players, lambda row: row.get("gsis_id"))
    nfl_by_name_pos = unique_index(nfl_players, lambda row: (normalize_name(row.get("display_name")), position(row.get("position"))))
    ids_by_sleeper = unique_index(cross_ids, lambda row: str(row.get("sleeper_id")) if row.get("sleeper_id") not in (None, "") else None)
    ids_by_name_pos = unique_index(cross_ids, lambda row: (normalize_name(row.get("name")), position(row.get("position"))))

    board_keys = set()
    for profile in (board or {}).get("profiles", {}).values():
        for row in profile.get("players", []):
            board_keys.add((normalize_name(row.get("name")), position(row.get("position"))))

    records, unresolved = [], []
    for sleeper_id, source in sleeper.items():
        pos = position(source.get("position"))
        if pos not in POSITIONS:
            continue
        name = str(source.get("full_name") or f"{source.get('first_name') or ''} {source.get('last_name') or ''}").strip()
        if pos == "DST":
            name = name or str(source.get("team") or sleeper_id)
        if not name:
            continue
        key = (normalize_name(name), pos)
        ids = ids_by_sleeper.get(str(sleeper_id)) or ids_by_name_pos.get(key) or {}
        nfl = nfl_by_gsis.get(ids.get("gsis_id")) or nfl_by_name_pos.get(key) or {}
        merged = {
            "name": name,
            "position": pos,
            "team": source.get("team") or ids.get("team") or nfl.get("latest_team"),
            "sleeper_id": str(sleeper_id),
            "gsis_id": ids.get("gsis_id") or nfl.get("gsis_id"),
            "espn_id": ids.get("espn_id") or nfl.get("espn_id"),
            "yahoo_id": ids.get("yahoo_id"),
            "pfr_id": ids.get("pfr_id") or nfl.get("pfr_id"),
        }
        player_key, method, confidence = canonical_key(merged)
        source_ids = {namespace: str(value) for namespace, value in {
            "gsis": merged.get("gsis_id"), "sleeper": sleeper_id, "espn": merged.get("espn_id"),
            "yahoo": merged.get("yahoo_id"), "pfr": merged.get("pfr_id"), "fantasypros": ids.get("fantasypros_id"),
            "cfbref": ids.get("cfbref_id"),
        }.items() if value not in (None, "", "nan")}
        aliases = sorted({value for value in (name, ids.get("name"), nfl.get("display_name"), nfl.get("football_name")) if value})
        record = {
            "player_key": player_key, "name": name, "position": pos, "team": merged.get("team"),
            "identity_method": method, "identity_confidence": confidence,
            "source_ids": source_ids, "aliases": aliases,
            "birth_date": nfl.get("birth_date") or ids.get("birthdate"),
            "age": finite(ids.get("age"), age_on(nfl.get("birth_date") or ids.get("birthdate"), date(season, 9, 1))),
            "years_experience": finite(nfl.get("years_of_experience")),
            "height": nfl.get("height") or ids.get("height") or source.get("height"),
            "weight": finite(nfl.get("weight"), finite(ids.get("weight"), finite(source.get("weight")))),
            "status": source.get("status") or nfl.get("status"),
            "injury_status": source.get("injury_status"),
            "depth_chart_order": int(source["depth_chart_order"]) if finite(source.get("depth_chart_order")) is not None else None,
            "college": nfl.get("college_name") or ids.get("college") or source.get("college"),
            "rookie_season": int(nfl["rookie_season"]) if finite(nfl.get("rookie_season")) is not None else None,
            "draft_year": int(nfl["draft_year"]) if finite(nfl.get("draft_year")) is not None else None,
            "draft_round": int(nfl["draft_round"]) if finite(nfl.get("draft_round")) is not None else None,
            "draft_pick": int(nfl["draft_pick"]) if finite(nfl.get("draft_pick")) is not None else None,
            "on_draft_board": key in board_keys,
        }
        records.append(record)
        if confidence < 90 and key in board_keys:
            unresolved.append({"name": name, "position": pos, "team": merged.get("team"), "reason": method})

    records.sort(key=lambda row: (not row["on_draft_board"], row["position"], row["name"]))
    board_rows = [row for row in records if row["on_draft_board"]]
    stable = sum(row["identity_confidence"] >= 90 for row in board_rows)
    return {
        "schema_version": 1, "generated_at": utc_now(), "season": season,
        "players": records,
        "quality": {
            "players": len(records), "draft_board_players": len(board_rows),
            "stable_draft_board_players": stable,
            "stable_draft_board_rate": round(stable / len(board_rows), 3) if board_rows else 0,
            "unresolved_draft_board_players": unresolved,
            "policy": "Exact platform IDs are preferred. Name-position joins are accepted only when unique; no fuzzy joins are silent.",
        },
    }


def apply_reviewed_aliases(payload: dict, alias_payload: dict) -> None:
    by_key = {(normalize_name(row.get("name")), position(row.get("position"))): row for row in payload.get("players", [])}
    for mapping in alias_payload.get("aliases", []):
        if mapping.get("status") != "human_reviewed":
            continue
        target = by_key.get((normalize_name(mapping.get("canonical")), position(mapping.get("position"))))
        alias = str(mapping.get("alias") or "").strip()
        if target and alias and alias not in target["aliases"]:
            target["aliases"].append(alias)
            target["aliases"].sort()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, default=datetime.now().year)
    parser.add_argument("--nflverse-dir", type=Path, default=Path("data/raw/nflverse"))
    parser.add_argument("--sleeper", type=Path, default=Path("data/raw/sleeper/players.json"))
    parser.add_argument("--board", type=Path, default=Path("data/draft_intelligence.json"))
    parser.add_argument("--output", type=Path, default=Path("data/normalized/player_identity.json"))
    parser.add_argument("--aliases", type=Path, default=Path("config/player_aliases.json"))
    args = parser.parse_args()
    if not args.sleeper.exists():
        raise SystemExit("Sleeper player snapshot is required")
    sleeper = json.loads(args.sleeper.read_text(encoding="utf-8"))
    board = json.loads(args.board.read_text(encoding="utf-8")) if args.board.exists() else None
    payload = build(
        load_parquet_rows(args.nflverse_dir / "players.parquet"),
        load_parquet_rows(args.nflverse_dir / "ff_playerids.parquet"),
        sleeper, board, args.season,
    )
    if args.aliases.exists():
        apply_reviewed_aliases(payload, json.loads(args.aliases.read_text(encoding="utf-8")))
    write_json_atomic(args.output, payload)
    print(json.dumps(payload["quality"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
