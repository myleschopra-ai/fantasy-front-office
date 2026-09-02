#!/usr/bin/env python3
"""Fail-closed release gate for identity, season, rookie, weekly, and provenance outputs."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import jsonschema

from data_foundation import utc_now, write_json_atomic

ROOT = Path(__file__).resolve().parents[1]


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def validate(args: argparse.Namespace) -> dict:
    errors, metrics = [], {}
    identity = load(args.identity)
    identity_schema = load(ROOT / "schemas" / "player_identity.schema.json")
    for row in identity.get("players", []):
        jsonschema.validate(row, identity_schema)
    iq = identity.get("quality") or {}
    metrics["identity"] = iq
    if float(iq.get("stable_draft_board_rate") or 0) < 0.98:
        errors.append("canonical identity coverage is below 98% of the published draft board")

    draft = load(args.draft)
    profiles = draft.get("profiles") or {}
    for profile_id, profile in profiles.items():
        players = profile.get("players") or []
        if players and sum(bool(row.get("player_key")) for row in players) / len(players) < 0.98:
            errors.append(f"{profile_id} has less than 98% canonical player keys")
        if any(not isinstance(row.get("data_confidence", {}).get("score"), int) for row in players):
            errors.append(f"{profile_id} contains players without numeric data confidence")
        if any(row.get("projection_mode") == "OPEN_MODEL_PROJECTION" and not row.get("projection_distribution") for row in players):
            errors.append(f"{profile_id} open projections are missing probability ranges")
    metrics["draft_profiles"] = len(profiles)

    rookies = load(args.rookies)
    rq = rookies.get("quality") or {}
    metrics["rookies"] = rq
    if not rq.get("no_fabricated_college_grades"):
        errors.append("rookie build did not affirm the no-fabricated-college-grade policy")

    weekly = load(args.weekly)
    weekly_schema = load(ROOT / "schemas" / "weekly_projection.schema.json")
    for row in weekly.get("players", []):
        jsonschema.validate(row, weekly_schema)
        distribution = row["distribution"]
        if not distribution["p10"] <= distribution["p50"] <= distribution["p90"]:
            errors.append(f"invalid weekly distribution ordering for {row.get('name')}")
            break
    wq = weekly.get("quality") or {}
    metrics["weekly"] = wq
    if len(weekly.get("players", [])) < 240:
        errors.append("weekly projection pool contains fewer than 240 players")
    if not wq.get("no_lookahead"):
        errors.append("weekly build does not declare no-lookahead behavior")

    if args.manifest.exists():
        manifest = load(args.manifest)
        jsonschema.validate(manifest, load(ROOT / "schemas" / "source_manifest.schema.json"))
        for artifact in manifest.get("artifacts", []):
            if artifact.get("path") and not artifact.get("sha256"):
                errors.append(f"{artifact.get('dataset')} is missing a SHA-256 digest")
        metrics["source_artifacts"] = len(manifest.get("artifacts", []))
    else:
        errors.append("nflverse source manifest is missing")
    return {"schema_version": 1, "validated_at": utc_now(), "status": "passed" if not errors else "failed", "errors": errors, "metrics": metrics}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--identity", type=Path, default=Path("data/normalized/player_identity.json"))
    parser.add_argument("--draft", type=Path, default=Path("data/draft_intelligence.json"))
    parser.add_argument("--rookies", type=Path, default=Path("data/rookie_profiles.json"))
    parser.add_argument("--weekly", type=Path, default=Path("data/weekly_projections.json"))
    parser.add_argument("--manifest", type=Path, default=Path("data/raw/nflverse/manifest.json"))
    parser.add_argument("--report", type=Path, default=Path("reports/projection_pipeline_validation.json"))
    args = parser.parse_args()
    result = validate(args)
    write_json_atomic(args.report, result)
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
