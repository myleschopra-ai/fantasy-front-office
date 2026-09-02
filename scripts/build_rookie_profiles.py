#!/usr/bin/env python3
"""Build evidence-backed rookie priors from public draft/combine/identity data."""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from data_foundation import finite, normalize_name, utc_now, write_json_atomic
from open_projection_engine import load_parquet_rows

POSITIONS = {"QB", "RB", "WR", "TE"}


def percentile(values: list[float], target: float, lower_better: bool = False) -> float:
    if not values:
        return 50.0
    rank = sum(value <= target for value in values) / len(values) * 100
    return 100 - rank if lower_better else rank


def build(identity_payload: dict, draft_rows: list[dict], combine_rows: list[dict], season: int) -> dict:
    identities = {
        (normalize_name(row.get("name")), str(row.get("position") or "").upper()): row
        for row in identity_payload.get("players", [])
    }
    combine_by_key = {}
    for row in combine_rows:
        name = row.get("player_name") or row.get("name") or row.get("player")
        pos = str(row.get("pos") or row.get("position") or "").upper()
        if name and pos in POSITIONS:
            combine_by_key[(normalize_name(name), pos)] = row
    position_tests: dict[str, dict[str, list[float]]] = {}
    for pos in POSITIONS:
        position_tests[pos] = {}
        rows = [row for (name, position), row in combine_by_key.items() if position == pos]
        for field in ("forty", "forty_yard", "vertical", "bench", "broad_jump", "cone", "three_cone", "shuttle"):
            position_tests[pos][field] = [number for row in rows if (number := finite(row.get(field), None)) is not None]

    profiles = []
    for draft in draft_rows:
        draft_year = int(finite(draft.get("season") or draft.get("draft_year"), 0) or 0)
        pos = str(draft.get("position") or draft.get("pos") or "").upper()
        if draft_year != season or pos not in POSITIONS:
            continue
        name = str(draft.get("pfr_player_name") or draft.get("player_name") or draft.get("name") or "").strip()
        if not name:
            continue
        key = (normalize_name(name), pos)
        identity = identities.get(key, {})
        combine = combine_by_key.get(key, {})
        pick = int(finite(draft.get("pick") or draft.get("draft_pick"), 260) or 260)
        draft_capital = round(max(0, min(100, 105 - pick / 2.55)))
        athletic_components = []
        for field, lower_better in (("forty", True), ("forty_yard", True), ("vertical", False), ("broad_jump", False), ("cone", True), ("three_cone", True), ("shuttle", True)):
            number = finite(combine.get(field), None)
            if number is not None:
                athletic_components.append(percentile(position_tests[pos].get(field, []), number, lower_better))
        athletic = round(statistics.mean(athletic_components)) if athletic_components else None
        evidence = ["NFL draft capital"]
        if combine:
            evidence.append("public combine measurements")
        if identity.get("college"):
            evidence.append("canonical college identity")
        completeness = sum(item is not None for item in (pick, identity.get("age"), identity.get("college"), athletic)) / 4
        profiles.append({
            "player_key": identity.get("player_key"), "name": identity.get("name") or name,
            "position": pos, "team": draft.get("team") or draft.get("draft_team") or identity.get("team"),
            "college": identity.get("college") or draft.get("college"), "age": identity.get("age"),
            "draft_year": season, "draft_round": int(finite(draft.get("round") or draft.get("draft_round"), 0) or 0),
            "draft_pick": pick, "draft_capital_score": draft_capital, "athletic_score": athletic,
            "college_production_score": None, "breakout_age": None, "early_declare": None,
            "rookie_prior_confidence": round(45 + completeness * 35),
            "evidence": evidence,
            "limitations": ["College production remains null until a licensed public college snapshot resolves this player."] if not identity.get("college") else ["College production metrics are not inferred from draft capital."],
        })
    profiles.sort(key=lambda row: (row["draft_pick"], row["name"]))
    return {
        "schema_version": 1, "generated_at": utc_now(), "draft_year": season,
        "players": profiles,
        "quality": {"players": len(profiles), "with_athletic_testing": sum(row["athletic_score"] is not None for row in profiles), "with_stable_identity": sum(bool(row["player_key"]) for row in profiles), "no_fabricated_college_grades": True},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, default=datetime.now().year)
    parser.add_argument("--identity", type=Path, default=Path("data/normalized/player_identity.json"))
    parser.add_argument("--nflverse-dir", type=Path, default=Path("data/raw/nflverse"))
    parser.add_argument("--output", type=Path, default=Path("data/rookie_profiles.json"))
    args = parser.parse_args()
    identity = json.loads(args.identity.read_text(encoding="utf-8"))
    payload = build(identity, load_parquet_rows(args.nflverse_dir / "draft_picks.parquet"), load_parquet_rows(args.nflverse_dir / "combine.parquet"), args.season)
    write_json_atomic(args.output, payload)
    print(json.dumps(payload["quality"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
