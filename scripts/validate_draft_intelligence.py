#!/usr/bin/env python3
"""Fail closed when a draft-intelligence refresh is incomplete or malformed."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


REQUIRED_PROFILES = {
    "redraft_1qb_half",
    "redraft_1qb_ppr",
    "redraft_1qb_standard",
    "redraft_superflex_half",
    "dynasty_1qb_half",
    "dynasty_superflex_half",
}
# Draftable player positions and scheme-environment positions are intentionally
# different concepts. K/DST belong in standard draft pools, but the coaching
# scheme model is defined only for offensive skill positions.
PLAYER_POSITIONS = {"QB", "RB", "WR", "TE", "K", "DST"}
SCHEME_POSITIONS = {"QB", "RB", "WR", "TE"}


def validate(path: Path, max_age_days: int = 7) -> list[str]:
    errors: list[str] = []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:
        return [f"Could not parse {path}: {error}"]

    if payload.get("schema_version") != 1:
        errors.append("schema_version must equal 1")
    generated_at = payload.get("generated_at")
    try:
        generated = datetime.fromisoformat(str(generated_at).replace("Z", "+00:00"))
        age = datetime.now(timezone.utc) - generated
        if age.days > max_age_days:
            errors.append(f"snapshot is {age.days} days old (limit {max_age_days})")
    except Exception:
        errors.append("generated_at is missing or invalid")

    healthy_sources = [source for source in payload.get("sources", []) if source.get("status") == "ok"]
    if len(healthy_sources) < 2:
        errors.append("fewer than two healthy ranking/ADP sources")

    profiles = payload.get("profiles") or {}
    missing = REQUIRED_PROFILES - set(profiles)
    if missing:
        errors.append(f"missing required profiles: {sorted(missing)}")
    for profile_id in REQUIRED_PROFILES & set(profiles):
        source_ids = profiles[profile_id].get("source_ids") or []
        if len(source_ids) < 2:
            errors.append(f"{profile_id} has fewer than two ranking sources")
        players = profiles[profile_id].get("players") or []
        if len(players) < 120:
            errors.append(f"{profile_id} has only {len(players)} players")
            continue
        keys: set[tuple[str, str]] = set()
        ranks: list[int] = []
        for player in players:
            key = (str(player.get("name") or "").lower(), str(player.get("position") or ""))
            if key in keys:
                errors.append(f"{profile_id} contains duplicate {key}")
                break
            keys.add(key)
            if player.get("position") not in PLAYER_POSITIONS:
                errors.append(f"{profile_id} contains invalid position {player.get('position')}")
                break
            rank = player.get("overall_rank")
            if not isinstance(rank, int) or rank < 1:
                errors.append(f"{profile_id} has invalid overall_rank for {player.get('name')}")
                break
            ranks.append(rank)
            for field in ["position_rank", "position_tier", "consensus_score", "source_count", "agreement"]:
                if player.get(field) is None:
                    errors.append(f"{profile_id} missing {field} for {player.get('name')}")
                    break
            scheme = player.get("scheme_fit") or {}
            if not isinstance(scheme.get("score"), (int, float)) or not 0 <= scheme["score"] <= 100:
                errors.append(f"{profile_id} has invalid scheme fit for {player.get('name')}")
                break
        if ranks and ranks != list(range(1, len(ranks) + 1)):
            errors.append(f"{profile_id} overall ranks are not contiguous")
        if sum(1 for player in players[:120] if player.get("source_count", 0) >= 2) < 100:
            errors.append(f"{profile_id} has insufficient multi-source coverage in its top 120")
        coverage = profiles[profile_id].get("projection_coverage") or {}
        if coverage.get("status") != "complete":
            errors.append(
                f"{profile_id} does not have complete sourced projections for its draftable player pool"
            )
        for position, details in (coverage.get("by_position") or {}).items():
            if not details.get("complete"):
                errors.append(
                    f"{profile_id} {position} projection depth is {details.get('eligible', details.get('direct', 0))}/{details.get('required', 0)}"
                )
        depth_bands = coverage.get("depth_bands") or {}
        for band in ("middle_51_120", "late_121_200"):
            details = depth_bands.get(band) or {}
            if details.get("players", 0) and details.get("coverage", 0) < 0.95:
                errors.append(
                    f"{profile_id} {band} sourced projection coverage is below 95%"
                )

    teams = payload.get("team_profiles") or {}
    if len(teams) < 28:
        errors.append(f"only {len(teams)} NFL team profiles were generated")
    verified_staff = sum(1 for profile in teams.values() if (profile.get("staff") or {}).get("status") == "verified")
    if verified_staff < 24:
        errors.append(f"only {verified_staff} team staffs were verified from official pages")
    for team, profile in teams.items():
        environment = profile.get("position_environment") or {}
        if set(environment) != SCHEME_POSITIONS:
            errors.append(f"{team} is missing offensive position-environment scores")
            continue
        if any(not isinstance(value, (int, float)) or not 0 <= value <= 100 for value in environment.values()):
            errors.append(f"{team} has an out-of-range position-environment score")
        staff = profile.get("staff") or {}
        suspicious = ("untitled", "arrives", "news", "gallery")
        for role in ("head_coach", "offensive_coordinator"):
            name = str(staff.get(role) or "").lower()
            if any(token in name for token in suspicious):
                errors.append(f"{team} has suspicious {role}: {staff.get(role)}")

    return errors


def build_report(path: Path, errors: list[str], max_age_days: int) -> dict:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        payload = {}
    profiles = payload.get("profiles") or {}
    coverage = {
        profile_id: {
            "status": (profile.get("projection_coverage") or {}).get("status", "missing"),
            "eligible_rate": (profile.get("projection_coverage") or {}).get("eligible_rate", 0),
            "direct_players": (profile.get("projection_coverage") or {}).get("direct_players", 0),
            "open_model_players": (profile.get("projection_coverage") or {}).get("open_model_players", 0),
        }
        for profile_id, profile in profiles.items()
    }
    sources = payload.get("sources") or []
    return {
        "schema_version": 1,
        "validated_at": datetime.now(timezone.utc).isoformat(),
        "status": "passed" if not errors else "failed",
        "path": str(path),
        "snapshot_generated_at": payload.get("generated_at"),
        "season": payload.get("season"),
        "max_age_days": max_age_days,
        "errors": errors,
        "source_summary": {
            "total": len(sources),
            "healthy": sum(1 for source in sources if source.get("status") == "ok"),
            "failed": [source.get("id") for source in sources if source.get("status") not in {"ok", "ready", "success"}],
        },
        "projection_coverage": coverage,
        "team_profiles": len(payload.get("team_profiles") or {}),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", nargs="?", type=Path, default=Path("data/draft_intelligence.json"))
    parser.add_argument("--max-age-days", type=int, default=7)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    errors = validate(args.path, args.max_age_days)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(build_report(args.path, errors, args.max_age_days), indent=2) + "\n", encoding="utf-8")
    if errors:
        print("Draft intelligence validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(f"Validated {args.path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
