#!/usr/bin/env python3
"""Collect college-football records from the official CollegeFootballData API.

Requires CFBD_API_KEY. Raw responses are stored with request provenance and are
not treated as verified prospect grades until normalized and validated.
"""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

import requests

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "cfbd"
BASE = "https://api.collegefootballdata.com"


def fetch(endpoint: str, params: dict, key: str) -> list | dict:
    response = requests.get(
        f"{BASE}{endpoint}",
        params=params,
        headers={"Authorization": f"Bearer {key}", "User-Agent": "fantasy-front-office/1.0"},
        timeout=45,
    )
    response.raise_for_status()
    return response.json()


def save(name: str, payload: object, endpoint: str, params: dict) -> dict:
    RAW.mkdir(parents=True, exist_ok=True)
    path = RAW / f"{name}.json"
    artifact = {
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "source": "CollegeFootballData API",
        "endpoint": endpoint,
        "params": params,
        "records": payload,
    }
    path.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    return {"dataset": name, "path": str(path.relative_to(ROOT)), "records": len(payload) if isinstance(payload, list) else None}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument("--teams", nargs="*", default=[])
    args = parser.parse_args()
    key = os.getenv("CFBD_API_KEY")
    if not key:
        raise SystemExit("CFBD_API_KEY is required; store it as a local environment variable or GitHub Actions secret")

    jobs: list[tuple[str, str, dict]] = [
        ("recruiting_players", "/recruiting/players", {"year": args.year}),
        ("draft_picks", "/draft/picks", {"year": args.year}),
    ]
    for team in args.teams:
        slug = "".join(ch.lower() if ch.isalnum() else "_" for ch in team).strip("_")
        jobs.extend([
            (f"roster_{slug}", "/roster", {"team": team, "year": args.year}),
            (f"player_stats_{slug}", "/stats/player/season", {"team": team, "year": args.year}),
        ])

    results = []
    for name, endpoint, params in jobs:
        try:
            results.append(save(name, fetch(endpoint, params, key), endpoint, params))
        except Exception as exc:
            results.append({"dataset": name, "status": "failed", "error": str(exc), "request": f"{endpoint}?{urlencode(params)}"})

    manifest = {
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "collector": "scripts/collectors/cfbd.py",
        "year": args.year,
        "artifacts": results,
    }
    RAW.mkdir(parents=True, exist_ok=True)
    (RAW / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))
    if any(r.get("status") == "failed" for r in results):
        raise SystemExit("One or more CFBD requests failed; inspect manifest.json")


if __name__ == "__main__":
    main()
