"""Refresh the validated FantasyPros draft snapshot.

The official API is called only from GitHub Actions or a local operator session
with ``FANTASYPROS_API_KEY`` configured. A failed or incomplete refresh exits
before replacing the last known-good ``fantasypros.json`` snapshot.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any


API_ROOT = "https://api.fantasypros.com/public/v2/json"
OUTPUT = Path("fantasypros.json")
REPORT_OUTPUT = Path(os.environ.get("FANTASYPROS_REFRESH_REPORT", "artifacts/fantasypros-refresh-report.json"))
API_KEY = os.environ.get("FANTASYPROS_API_KEY")
SEASON = int(os.environ.get("NFL_SEASON", date.today().year))
SCORING = os.environ.get("FANTASY_SCORING", "HALF").upper()
POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DST"]
MINIMUM_RANKINGS = {
    "OVERALL": 240,
    "QB": 32,
    "RB": 72,
    "WR": 84,
    "TE": 32,
    "K": 20,
    "DST": 20,
}
MINIMUM_PROJECTIONS = {
    "QB": 32,
    "RB": 72,
    "WR": 84,
    "TE": 32,
    "K": 20,
    "DST": 20,
}
PARTIAL_MINIMUM_RANKINGS = {
    "OVERALL": 40,
    "QB": 20,
    "RB": 40,
    "WR": 40,
    "TE": 20,
    "K": 10,
    "DST": 10,
}
PARTIAL_MINIMUM_PROJECTIONS = {position: 10 for position in MINIMUM_PROJECTIONS}
REQUEST_DIAGNOSTICS: list[dict[str, Any]] = []


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_params(params: dict[str, Any] | None) -> dict[str, Any]:
    """Keep diagnostics useful without dumping long player filters or secrets."""
    result: dict[str, Any] = {}
    for key, value in (params or {}).items():
        text = str(value)
        result[str(key)] = text if len(text) <= 120 else f"{text[:80]}… ({len(text)} chars)"
    return result


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
    started = time.monotonic()
    diagnostic: dict[str, Any] = {"path": path, "params": safe_params(params), "started_at": utc_now()}
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read())
            rows = payload.get("players") or payload.get("player") or []
            diagnostic.update(
                {
                    "status": "ok",
                    "http_status": getattr(response, "status", 200),
                    "reported_count": payload.get("count"),
                    "returned_rows": len(rows) if isinstance(rows, list) else None,
                    "duration_ms": round((time.monotonic() - started) * 1000),
                    "rate_limit": {
                        "limit": response.headers.get("x-ratelimit-limit"),
                        "remaining": response.headers.get("x-ratelimit-remaining"),
                        "reset": response.headers.get("x-ratelimit-reset"),
                    },
                }
            )
            REQUEST_DIAGNOSTICS.append(diagnostic)
            return payload
    except urllib.error.HTTPError as error:
        # Surface the API's validation message without ever printing the key.
        # This turned a previously opaque HTTP 400 into actionable CI evidence.
        try:
            body = error.read().decode("utf-8", errors="replace")[:2000]
        except Exception:
            body = ""
        diagnostic.update(
            {
                "status": "error",
                "http_status": error.code,
                "duration_ms": round((time.monotonic() - started) * 1000),
                "response_excerpt": body,
            }
        )
        REQUEST_DIAGNOSTICS.append(diagnostic)
        raise RuntimeError(
            f"FantasyPros HTTP {error.code} for {path} params={params or {}}: {body or error.reason}"
        ) from error
    except Exception as error:
        diagnostic.update(
            {
                "status": "error",
                "duration_ms": round((time.monotonic() - started) * 1000),
                "error": str(error),
            }
        )
        REQUEST_DIAGNOSTICS.append(diagnostic)
        raise


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


def compact_projection(player: dict[str, Any], fallback_position: str) -> dict[str, Any] | None:
    stats_raw = player.get("stats") or {}
    stats = stats_raw[0] if isinstance(stats_raw, list) and stats_raw else stats_raw
    if not isinstance(stats, dict):
        stats = {}
    point_fields = {
        key: round(float(stats[key]), 2)
        for key in ("points", "points_half", "points_ppr")
        if stats.get(key) is not None
    }
    if not point_fields:
        return None
    # Preserve the numeric stat line so custom league scoring and TE premium
    # can be calculated locally instead of treating half-PPR points as universal.
    numeric_stats: dict[str, float] = {}
    for key, value in stats.items():
        if key in point_fields:
            continue
        try:
            numeric_stats[str(key)] = round(float(value), 3)
        except (TypeError, ValueError):
            continue
    preferred = (
        point_fields.get("points_half")
        if SCORING == "HALF"
        else point_fields.get("points_ppr")
        if SCORING == "PPR"
        else point_fields.get("points")
    )
    if preferred is None:
        preferred = next(iter(point_fields.values()))
    return {
        "player_id": player.get("fpid") or player.get("player_id"),
        "name": player.get("name") or player.get("player_name"),
        "team": player.get("team_id") or "",
        "position": player.get("position_id") or fallback_position,
        "projected_points": round(float(preferred), 1),
        **point_fields,
        "stats": numeric_stats,
    }


def fetch_rankings() -> tuple[dict[str, list[dict[str, Any]]], dict[str, Any]]:
    rankings: dict[str, list[dict[str, Any]]] = {}
    metadata: dict[str, Any] = {}
    for position in POSITIONS:
        key = "OVERALL" if position == "ALL" else position
        # Be explicit about draft rankings. The v2 API supports multiple
        # ranking types and can otherwise resolve the request against a
        # context-dependent default (weekly/ROS during parts of the season).
        payload = get_json(
            f"nfl/{SEASON}/consensus-rankings",
            {"position": position, "scoring": SCORING, "type": "DRAFT"},
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
            "ranking_type": payload.get("ranking_type_name") or payload.get("type") or "DRAFT",
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
                for player in payload.get("players") or payload.get("player") or []:
                    compact = compact_projection(player, position)
                    if compact and compact.get("name"):
                        rows.append(compact)
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
    """Broader news feed, no category filter.

    This intentionally fails soft because news is enrichment rather than a
    ranking-critical source. Rankings/projections remain fail-closed.
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


def coverage_report(snapshot: dict[str, Any]) -> dict[str, Any]:
    rankings = snapshot.get("rankings") or {}
    projections = snapshot.get("projections") or {}
    ranking_counts = {key: len(rankings.get(key, [])) for key in MINIMUM_RANKINGS}
    projection_counts = {key: len(projections.get(key, [])) for key in MINIMUM_PROJECTIONS}
    issues = [
        f"{key} rankings {ranking_counts[key]}/{minimum}"
        for key, minimum in MINIMUM_RANKINGS.items()
        if ranking_counts[key] < minimum
    ] + [
        f"{key} projections {projection_counts[key]}/{minimum}"
        for key, minimum in MINIMUM_PROJECTIONS.items()
        if projection_counts[key] < minimum
    ]
    complete = not issues
    return {
        "status": "complete" if complete else "partial",
        "complete": complete,
        "ranking_counts": ranking_counts,
        "projection_counts": projection_counts,
        "issues": issues,
        "policy": "Partial direct coverage is permitted only as an explicitly labeled input to the open-model completion layer.",
    }


def validate_snapshot(snapshot: dict[str, Any], *, allow_partial: bool = False) -> None:
    if snapshot.get("season") != SEASON or snapshot.get("scoring") != SCORING:
        raise ValueError("Snapshot season or scoring does not match the request")
    rankings = snapshot.get("rankings") or {}
    ranking_minimums = PARTIAL_MINIMUM_RANKINGS if allow_partial else MINIMUM_RANKINGS
    for key, minimum in ranking_minimums.items():
        count = len(rankings.get(key, []))
        if count < minimum:
            raise ValueError(f"{key} ranking count {count} is below minimum {minimum}")
    for key, rows in rankings.items():
        ranks = [row.get("rank") for row in rows]
        if any(rank is None for rank in ranks):
            raise ValueError(f"{key} contains a missing rank")
        if len({row.get("name") for row in rows}) != len(rows):
            raise ValueError(f"{key} contains duplicate player names")
    projections = snapshot.get("projections") or {}
    projection_minimums = PARTIAL_MINIMUM_PROJECTIONS if allow_partial else MINIMUM_PROJECTIONS
    for key, minimum in projection_minimums.items():
        rows = projections.get(key, [])
        if len(rows) < minimum:
            raise ValueError(
                f"{key} projection count {len(rows)} is below draftable-player minimum {minimum}"
            )
        names = [row.get("name") for row in rows]
        if any(not name for name in names) or len(set(names)) != len(names):
            raise ValueError(f"{key} projections contain missing or duplicate player names")


def atomic_write(snapshot: dict[str, Any], output: Path = OUTPUT) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=output.parent, delete=False
    ) as handle:
        json.dump(snapshot, handle, separators=(",", ":"), ensure_ascii=False)
        handle.write("\n")
        temporary = Path(handle.name)
    temporary.replace(output)


def write_report(status: str, *, snapshot: dict[str, Any] | None = None, error: str | None = None) -> None:
    REPORT_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": 1,
        "generated_at": utc_now(),
        "status": status,
        "season": SEASON,
        "scoring": SCORING,
        "coverage": coverage_report(snapshot) if snapshot else None,
        "requests": REQUEST_DIAGNOSTICS,
    }
    if error:
        payload["error"] = error
    REPORT_OUTPUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> None:
    if not API_KEY:
        print("ERROR: FANTASYPROS_API_KEY not set in environment.", file=sys.stderr)
        write_report("failed", error="FANTASYPROS_API_KEY is not set")
        raise SystemExit(1)
    snapshot: dict[str, Any] | None = None
    try:
        rankings, ranking_metadata = fetch_rankings()
        projections = fetch_projections()
        injuries = fetch_injuries()
        general_news = fetch_general_news()
        snapshot = {
            "schema_version": 3,
            "generated_at": utc_now(),
            "season": SEASON,
            "scoring": SCORING,
            "source": {
                "id": "fantasypros_api",
                "name": "FantasyPros Public API",
                "url": "https://www.fantasypros.com/api-data/",
                "scope": "direct rankings and projections; partial provider coverage is completed by a separately labeled open model",
                "ranking_metadata": ranking_metadata,
            },
            "rankings": rankings,
            "injuries": injuries,
            "news": general_news,
            "projections": projections,
        }
        snapshot["coverage"] = coverage_report(snapshot)
        # The public/free provider can deliberately return a bounded sample.
        # Publish that sample only when it clears a meaningful floor and label
        # it partial; the draft-intelligence build must fill and revalidate the
        # complete player pool with explicitly sourced open-model projections.
        validate_snapshot(snapshot, allow_partial=True)
        atomic_write(snapshot)
        write_report("complete" if snapshot["coverage"]["complete"] else "partial", snapshot=snapshot)
        print(f"Wrote validated {OUTPUT} ({snapshot['coverage']['status']} direct coverage)")
    except Exception as error:
        write_report("failed", snapshot=snapshot, error=str(error))
        raise


if __name__ == "__main__":
    main()
