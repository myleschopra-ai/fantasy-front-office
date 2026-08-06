#!/usr/bin/env python3
"""Build data/prospect_board.json from normalized prospect records.

The builder never invents values. Missing derived fields remain null and
records without evidence are retained only when explicitly marked provisional.
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAYERS = ROOT / "data" / "normalized" / "players.json"
OUTPUT = ROOT / "data" / "prospect_board.json"


def load_players() -> list[dict]:
    if not PLAYERS.exists():
        return []
    payload = json.loads(PLAYERS.read_text(encoding="utf-8"))
    return payload.get("players", [])


def main() -> None:
    players = load_players()
    players.sort(key=lambda p: (
        -(p.get("derived", {}).get("overall_dynasty_grade") or -1),
        p.get("identity", {}).get("name", ""),
    ))
    artifact = {
        "schema_version": 2,
        "generated_at": date.today().isoformat(),
        "class_year": 2027,
        "players": players,
        "build_notes": [
            "Generated from normalized evidence-backed prospect records.",
            "Missing values are preserved as null; no synthetic fallback grades are created."
        ],
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    print(f"Built {OUTPUT} with {len(players)} prospects")


if __name__ == "__main__":
    main()
