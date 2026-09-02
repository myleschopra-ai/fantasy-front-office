#!/usr/bin/env python3
"""Build time-locked weekly role features and probabilistic projections."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from data_foundation import utc_now, write_json_atomic
from open_projection_engine import load_parquet_rows
from weekly_projection_engine import MODEL_VERSION, build


def load_depth_for_players(path: Path, players: list[dict]) -> list[dict]:
    """Filter the million-row daily depth history before converting it to Python objects."""
    if not path.exists():
        return []
    import pyarrow as pa
    import pyarrow.compute as pc
    import pyarrow.parquet as parquet
    table = parquet.read_table(path, columns=[
        "gsis_id", "full_name", "player_name", "position", "pos_abb", "season", "week", "pos_rank", "dt", "team"
    ])
    identifiers = sorted({str((player.get("source_ids") or {}).get("gsis")) for player in players if (player.get("source_ids") or {}).get("gsis")})
    if identifiers:
        table = table.filter(pc.is_in(table["gsis_id"], value_set=pa.array(identifiers)))
    return table.to_pylist()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, default=datetime.now().year)
    parser.add_argument("--week", type=int, default=1)
    parser.add_argument("--profile", default="redraft_1qb_half")
    parser.add_argument("--draft-intelligence", type=Path, default=Path("data/draft_intelligence.json"))
    parser.add_argument("--nflverse-dir", type=Path, default=Path("data/raw/nflverse"))
    parser.add_argument("--output", type=Path, default=Path("data/weekly_projections.json"))
    args = parser.parse_args()
    board = json.loads(args.draft_intelligence.read_text(encoding="utf-8"))
    players = (board.get("profiles", {}).get(args.profile) or {}).get("players", [])
    file_map = {"weekly": "weekly_stats.parquet", "snaps": "snap_counts.parquet", "opportunity": "ff_opportunity.parquet", "injuries": "injuries.parquet", "depth": "depth_charts.parquet", "schedules": "schedules.parquet"}
    datasets = {}
    for name, filename in file_map.items():
        path = args.nflverse_dir / filename
        if not path.exists():
            continue
        datasets[name] = load_depth_for_players(path, players) if name == "depth" else load_parquet_rows(path)
    rows = build(players, datasets, args.season, args.week)
    usable = sum(row["data_confidence"]["score"] >= 45 for row in rows)
    payload = {
        "schema_version": 1, "generated_at": utc_now(), "projection_scope": "weekly",
        "season": args.season, "week": args.week, "model_version": MODEL_VERSION,
        "players": rows,
        "quality": {
            "players": len(rows), "usable_players": usable,
            "usable_rate": round(usable / len(rows), 3) if rows else 0,
            "datasets": {name: len(values) for name, values in datasets.items()},
            "status": "publishable" if rows and usable / len(rows) >= 0.90 else "limited",
            "no_lookahead": True,
        },
    }
    write_json_atomic(args.output, payload)
    print(json.dumps(payload["quality"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
