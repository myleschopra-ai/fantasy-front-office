"""Refresh the validated FantasyPros draft snapshot.

The official API is called only from GitHub Actions or a local operator session
with ``FANTASYPROS_API_KEY`` configured.  A failed or incomplete refresh exits
before replacing the last known-good ``fantasypros.json`` snapshot.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any


API_ROOT = "https://api.fantasypros.com/public/v2/json"
OUTPUT = Path("fantasypros.json")
API_KEY = os.environ.get("FANTASYPROS_API_KEY")
SEASON = int(os.environ.get("NFL_SEASON", date.today().year))
SCORING = os.environ.get("FANTASY_SCORING", "HALF").upper()
POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DST"]
MINIMUM_RANKINGS = {"OVERALL": 100, "QB": 20, "RB": 30, "WR": 40, "TE": 20, "K": 20, "DST": 20}


def get_json(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    if not API_KEY:
        raise RuntimeError("FANTASYPROS_API_KEY is not set")
    query = urllib.parse.urlencode(params or {})
    url = f"{API_ROOT}/{path}{'?' + query if query else ''}"
    request = urllib.request.Request(
        url,
        headers={
            "x-api-key": API_KEY,
            "Accept": "application/json",
            "User-Agent": "FantasyFrontOffice/2.0",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def compact_ranking(player: dict[str, Any]) -> dict[str, Any]:
    position = player.get("player_position_id") or player.get("position_id")
    return {
        "player_id": player.get("player_id"),
        "name": player.get("player_name") or player.get("name"),
        "team": player.get("player_team_id") or player.get("team_id") or "",
        "position": position,
        "rank": player.get("rank_ecr") or player.get("rank"),
        "pos_rank": player.get("pos_rank"),
        "tier": player.get("tier"),
        "rank_min": player.get("rank_min"),
        "rank_max": player.get("rank_max"),
        "rank_std": player.get("rank_std"),
    }


def fetch_rankings() -> tuple[dict[str, list[dict[str, Any]]], dict[str, Any]]:
    rankings: dict[str, list[dict[str, Any]]] = {}
    metadata: dict[str, Any] = {}
    for position in POSITIONS:
        key = "OVERALL" if position == "ALL" else position
        payload = get_json(
            f"nfl/{SEASON}/consensus-rankings",
            {"position": position, "scoring": SCORING},
        )
        rows = [
            compact_ranking(player)
            for player in payload.get("players", [])
            if player.get("player_name") and player.get("rank_ecr") is not None
        ]
        rankings[key] = rows
        metadata[key] = {
            "count": len(rows),
            "last_updated": payload.get("last_updated"),
            "total_experts": payload.get("total_experts"),
            "position": position,
        }
        print(f"{key}: {len(rows)} rankings")
        time.sleep(1)
    return rankings, metadata


def fetch_projections() -> dict[str, list[dict[str, Any]]]:
    projections: dict[str, list[dict[str, Any]]] = {}
    for position in POSITIONS[1:]:
        rows: list[dict[str, Any]] = []
        for attempt in range(2):
            try:
                payload = get_json(
                    f"nfl/{SEASON}/projections",
                    {"position": position, "week": 0, "scoring": SCORING},
                )
                for player in payload.get("players", []):
                    stats_raw = player.get("stats") or {}
                    stats = stats_raw[0] if isinstance(stats_raw, list) and stats_raw else stats_raw
                    points = (
                        stats.get("points_half")
                        if SCORING == "HALF"
                        else stats.get("points_ppr")
                        if SCORING == "PPR"
                        else stats.get("points")
                    )
                    if points is not None:
                        rows.append(
                            {
                                "player_id": player.get("fpid") or player.get("player_id"),
                                "name": player.get("name") or player.get("player_name"),
                                "team": player.get("team_id") or "",
                                "position": player.get("position_id") or position,
                                "projected_points": round(float(points), 1),
                                "points_half": round(float(stats.get("points_half", points)), 1),
                            }
                        )
                if rows:
                    break
            except Exception as error:  # pragma: no cover - network behavior
                print(
                    f"WARNING: {position} projection attempt {attempt + 1} failed: {error}",
                    file=sys.stderr,
                )
            time.sleep(2)
        projections[position] = rows
        print(f"{position}: {len(rows)} projections")
        time.sleep(1)
    return projections


def fetch_injuries() -> list[dict[str, Any]]:
    payload = get_json("nfl/news", {"category": "injury", "limit": 50})
    return [
        {
            "name": item.get("player_name") or item.get("title"),
            "team": item.get("team_id") or "",
        }
        for item in payload.get("items", [])
        if item.get("player_name") or item.get("title")
    ]


def fetch_general_news() -> list[dict[str, Any]]:
    """Broader news feed, no category filter — same proven endpoint pattern as
    fetch_injuries(), just without narrowing to injury-only items. Intended to
    surface real current sentiment/analysis text for late-round evaluation,
    where public rankings alone don't capture recent buzz. Fails gracefully:
    if this shape doesn't hold on a live call, callers see an empty list, not
    a crash — the injury feed above is unaffected either way.
    """
    try:
        payload = get_json("nfl/news", {"limit": 100})
    except Exception as exc:
        print(f"WARNING: general news fetch failed: {exc}", file=sys.stderr)
        return []
    return [
        {
            "name": item.get("player_name") or item.get("title"),
            "team": item.get("team_id") or "",
            "headline": item.get("title") or "",
            "summary": item.get("content") or item.get("summary") or "",
        }
        for item in payload.get("items", [])
        if item.get("player_name") or item.get("title")
    ]


def validate_snapshot(snapshot: dict[str, Any]) -> None:
    if snapshot.get("season") != SEASON or snapshot.get("scoring") != SCORING:
        raise ValueError("Snapshot season or scoring does not match the request")
    rankings = snapshot.get("rankings") or {}
    for key, minimum in MINIMUM_RANKINGS.items():
        count = len(rankings.get(key, []))
        if count < minimum:
            raise ValueError(f"{key} ranking count {count} is below minimum {minimum}")
    for key, rows in rankings.items():
        ranks = [row.get("rank") for row in rows]
        if any(rank is None for rank in ranks):
            raise ValueError(f"{key} contains a missing rank")
        if len({row.get("name") for row in rows}) != len(rows):
            raise ValueError(f"{key} contains duplicate player names")


def atomic_write(snapshot: dict[str, Any], output: Path = OUTPUT) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=output.parent, delete=False
    ) as handle:
        json.dump(snapshot, handle, separators=(",", ":"), ensure_ascii=False)
        handle.write("\n")
        temporary = Path(handle.name)
    temporary.replace(output)


def main() -> None:
    if not API_KEY:
        print("ERROR: FANTASYPROS_API_KEY not set in environment.", file=sys.stderr)
        raise SystemExit(1)
    rankings, ranking_metadata = fetch_rankings()
    projections = fetch_projections()
    injuries = fetch_injuries()
    general_news = fetch_general_news()
    snapshot = {
        "schema_version": 2,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "season": SEASON,
        "scoring": SCORING,
        "source": {
            "id": "fantasypros_api",
            "name": "FantasyPros Public API",
            "url": "https://www.fantasypros.com/api-data/",
            "ranking_metadata": ranking_metadata,
        },
        "rankings": rankings,
        "injuries": injuries,
        "news": general_news,
        "projections": projections,
    }
    validate_snapshot(snapshot)
    atomic_write(snapshot)
    print(f"Wrote validated {OUTPUT}")


if __name__ == "__main__":
    main()
