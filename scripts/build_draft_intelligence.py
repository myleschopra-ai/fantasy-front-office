#!/usr/bin/env python3
"""Build auditable draft rankings, tiers, strategy inputs, and scheme-fit context.

The pipeline prefers public/authorized APIs over brittle HTML extraction. Official
NFL team pages are parsed only for public coaching-staff names and roles. Raw
source payloads are not republished; the output contains normalized ranks,
derived metrics, provenance, and confidence.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import statistics
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
from open_projection_engine import build_for_players, load_parquet_rows


POSITIONS = {"QB", "RB", "WR", "TE", "K", "DST"}
USER_AGENT = "FantasyFrontOffice/2.0 (+https://github.com/myleschopra-ai/fantasy-front-office)"
PROFILE_SPECS = {
    "redraft_1qb_standard": {"dynasty": False, "qbs": 1, "ppr": 0.0, "ffc": "standard"},
    "redraft_1qb_half": {"dynasty": False, "qbs": 1, "ppr": 0.5, "ffc": "half-ppr"},
    "redraft_1qb_ppr": {"dynasty": False, "qbs": 1, "ppr": 1.0, "ffc": "ppr"},
    "redraft_superflex_half": {"dynasty": False, "qbs": 2, "ppr": 0.5, "ffc": None},
    "dynasty_1qb_half": {"dynasty": True, "qbs": 1, "ppr": 0.5, "ffc": None},
    "dynasty_superflex_half": {"dynasty": True, "qbs": 2, "ppr": 0.5, "ffc": None},
}
SOURCE_WEIGHTS = {
    "fantasypros_ecr": 0.45,
    "fantasycalc": 0.30,
    "fantasy_football_calculator": 0.25,
    "repository_positional_snapshot": 0.15,
}
DRAFTABLE_PROJECTION_MINIMUMS = {
    "QB": 32,
    "RB": 72,
    "WR": 84,
    "TE": 32,
    "K": 20,
    "DST": 20,
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def finite(value: Any, default: float | None = None) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except (TypeError, ValueError):
        return default


def clamp(value: Any, low: float = 0, high: float = 100) -> float:
    return max(low, min(high, finite(value, low) or low))


def normalize_name(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", text, flags=re.I)
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def normalize_position(value: Any) -> str:
    text = str(value or "").upper().strip()
    aliases = {"HB": "RB", "FB": "RB", "W/R/T": "WR"}
    return aliases.get(text, text)


def normalize_team(value: Any) -> str:
    text = str(value or "").upper().strip()
    aliases = {"JAC": "JAX", "LA": "LAR", "STL": "LAR", "OAK": "LV", "SD": "LAC", "WSH": "WAS"}
    return aliases.get(text, text)


def first_value(row: dict[str, Any], names: Iterable[str], default: Any = None) -> Any:
    lowered = {str(key).lower(): value for key, value in row.items()}
    for name in names:
        value = lowered.get(name.lower())
        if value not in (None, ""):
            return value
    return default


def fetch_json(url: str, timeout: int = 35) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_text(url: str, timeout: int = 35) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def source_record(
    source: str,
    name: Any,
    position: Any,
    *,
    rank: Any = None,
    pos_rank: Any = None,
    team: Any = "",
    sleeper_id: Any = None,
    value: Any = None,
    adp: Any = None,
    tier: Any = None,
) -> dict[str, Any] | None:
    pos = normalize_position(position)
    clean_name = str(name or "").strip()
    if not clean_name or pos not in POSITIONS:
        return None
    overall = finite(rank)
    positional = finite(pos_rank)
    if overall is None and positional is None:
        return None
    return {
        "source": source,
        "name": clean_name,
        "norm_name": normalize_name(clean_name),
        "position": pos,
        "rank": overall,
        "pos_rank": positional,
        "team": normalize_team(team),
        "sleeper_id": str(sleeper_id) if sleeper_id not in (None, "") else None,
        "value": finite(value),
        "adp": finite(adp),
        "tier": finite(tier),
    }


def fetch_fantasycalc(spec: dict[str, Any], teams: int) -> list[dict[str, Any]]:
    params = urllib.parse.urlencode(
        {
            "isDynasty": str(bool(spec["dynasty"])).lower(),
            "numQbs": spec["qbs"],
            "numTeams": teams,
            "ppr": spec["ppr"],
        }
    )
    payload = fetch_json(f"https://api.fantasycalc.com/values/current?{params}")
    records: list[dict[str, Any]] = []
    for index, item in enumerate(payload if isinstance(payload, list) else []):
        player = item.get("player") or {}
        record = source_record(
            "fantasycalc",
            first_value(player, ["name", "fullName", "full_name"]),
            first_value(player, ["position", "pos"]),
            rank=first_value(item, ["overallRank", "overall_rank", "rank"], index + 1),
            pos_rank=first_value(item, ["positionRank", "position_rank", "posRank"]),
            team=first_value(player, ["team", "maybeTeam", "nflTeam"]),
            sleeper_id=first_value(player, ["sleeperId", "sleeper_id"]),
            value=first_value(item, ["value", "tradeValue"]),
            adp=first_value(item, ["adp", "redraftAdp"]),
        )
        if record:
            records.append(record)
    if len(records) < 100:
        raise RuntimeError(f"FantasyCalc returned only {len(records)} usable skill-position records")
    return records


def fetch_fantasy_football_calculator(spec: dict[str, Any], teams: int, season: int) -> list[dict[str, Any]]:
    scoring = spec.get("ffc")
    if not scoring:
        return []
    url = f"https://fantasyfootballcalculator.com/api/v1/adp/{scoring}?teams={teams}&year={season}"
    payload = fetch_json(url)
    rows = payload.get("players", []) if isinstance(payload, dict) else []
    records: list[dict[str, Any]] = []
    for index, item in enumerate(rows):
        record = source_record(
            "fantasy_football_calculator",
            first_value(item, ["name", "player_name", "playerName"]),
            first_value(item, ["position", "pos"]),
            rank=first_value(item, ["overall_rank", "rank", "adp"], index + 1),
            pos_rank=first_value(item, ["position_rank", "pos_rank"]),
            team=first_value(item, ["team", "team_abbr"]),
            adp=first_value(item, ["adp", "average_pick", "averagePick"]),
        )
        if record:
            records.append(record)
    if len(records) < 75:
        raise RuntimeError(f"Fantasy Football Calculator returned only {len(records)} usable records")
    return records


def load_repository_positional_snapshot(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    records: list[dict[str, Any]] = []
    for position, players in (payload.get("rankings") or {}).items():
        for item in players or []:
            record = source_record(
                "repository_positional_snapshot",
                item.get("name"),
                position,
                pos_rank=item.get("rank"),
                tier=item.get("tier"),
            )
            if record:
                records.append(record)
    return records


def load_repository_projections(path: Path) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    if not path.exists():
        return {}, {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    result: dict[str, dict[str, Any]] = {}
    for position, rows in (payload.get("projections") or {}).items():
        normalized_position = normalize_position(position)
        for row in rows or []:
            name = str(row.get("name") or row.get("player_name") or "").strip()
            player_position = normalize_position(row.get("position") or normalized_position)
            if not name or player_position not in POSITIONS:
                continue
            result[f"{normalize_name(name)}|{player_position}"] = {
                **row,
                "name": name,
                "position": player_position,
            }
    return result, payload


def attach_projections(
    players: list[dict[str, Any]],
    projections: dict[str, dict[str, Any]],
    snapshot: dict[str, Any],
    spec: dict[str, Any],
    *,
    only_missing: bool = False,
) -> None:
    requested_ppr = float(spec.get("ppr", 0.5))
    requested_field = "points_ppr" if requested_ppr >= 0.75 else "points" if requested_ppr <= 0.25 else "points_half"
    snapshot_scoring = str(snapshot.get("scoring") or "").upper()
    compatible_fallback = (
        requested_ppr >= 0.75 and snapshot_scoring == "PPR"
    ) or (
        requested_ppr <= 0.25 and snapshot_scoring in {"STD", "STANDARD"}
    ) or (0.25 < requested_ppr < 0.75 and snapshot_scoring in {"", "HALF", "HALF_PPR"})
    for player in players:
        if only_missing and finite(player.get("projected_points")) is not None:
            continue
        row = projections.get(f"{normalize_name(player['name'])}|{player['position']}")
        if not row:
            continue
        points = finite(row.get(requested_field))
        if points is None and compatible_fallback:
            points = finite(row.get("projected_points"))
        if points is None:
            continue
        player["projected_points"] = round(points, 1)
        player["projection_ppr"] = requested_ppr
        player["projection_source"] = row.get("projection_source") or "fantasypros_api"
        player["projection_mode"] = row.get("projection_mode") or "DIRECT_PROJECTION"
        player["projection_confidence"] = int(finite(row.get("projection_confidence"), 95) or 95)
        if row.get("model_version"):
            player["projection_model_version"] = row["model_version"]
        if row.get("evidence"):
            player["projection_evidence"] = row["evidence"]
        if row.get("evidence_seasons") is not None:
            player["projection_evidence_seasons"] = row["evidence_seasons"]
        if isinstance(row.get("stats"), dict):
            player["projection_stats"] = row["stats"]


def projection_coverage(players: list[dict[str, Any]]) -> dict[str, Any]:
    eligible = [player for player in players if finite(player.get("projected_points")) is not None]
    direct = [player for player in eligible if player.get("projection_mode") != "OPEN_MODEL_PROJECTION"]
    modeled = [player for player in eligible if player.get("projection_mode") == "OPEN_MODEL_PROJECTION"]
    by_position: dict[str, Any] = {}
    complete = len(players) >= 240
    for position, minimum in DRAFTABLE_PROJECTION_MINIMUMS.items():
        pool_count = sum(1 for player in players if player.get("position") == position)
        eligible_count = sum(1 for player in eligible if player.get("position") == position)
        direct_count = sum(1 for player in direct if player.get("position") == position)
        modeled_count = sum(1 for player in modeled if player.get("position") == position)
        position_complete = pool_count >= minimum and eligible_count >= minimum
        complete = complete and position_complete
        by_position[position] = {
            "pool": pool_count,
            "direct": direct_count,
            "open_model": modeled_count,
            "eligible": eligible_count,
            "required": minimum,
            "complete": position_complete,
        }
    bands = {}
    for label, low, high in (("top_50", 1, 50), ("middle_51_120", 51, 120), ("late_121_200", 121, 200), ("deep_201_plus", 201, 10_000)):
        rows = [player for player in players if low <= int(player.get("overall_rank") or 10_000) <= high]
        projected = sum(1 for player in rows if finite(player.get("projected_points")) is not None)
        bands[label] = {
            "players": len(rows),
            "eligible": projected,
            "coverage": round(projected / len(rows), 3) if rows else 0,
        }
    return {
        "status": "complete" if complete else "incomplete",
        "pool_players": len(players),
        "direct_players": len(direct),
        "open_model_players": len(modeled),
        "eligible_players": len(eligible),
        "eligible_rate": round(len(eligible) / len(players), 3) if players else 0,
        "by_position": by_position,
        "depth_bands": bands,
        "activation_rule": "Every positional minimum must have an explicitly sourced direct or open-model season projection; top-50-only samples remain inactive.",
    }


def select_fantasypros_rows(rows: list[dict[str, Any]], profile_family: str) -> list[dict[str, Any]]:
    page_types = {
        "redraft_1qb": "redraft-overall",
        "redraft_superflex": "redraft-op",
        "dynasty_1qb": "dynasty-overall",
        "dynasty_superflex": "dynasty-op",
    }
    page_type = page_types[profile_family]
    date_fields = [name for name in ["scrape_date", "date", "timestamp", "last_updated"] if name in rows[0]]
    if date_fields:
        date_field = date_fields[0]
        latest = max(str(row.get(date_field) or "") for row in rows)
        rows = [row for row in rows if str(row.get(date_field) or "") == latest]
    return [row for row in rows if str(row.get("page_type") or "") == page_type]


def fantasypros_records(rows: list[dict[str, Any]], profile_family: str) -> list[dict[str, Any]]:
    selected = select_fantasypros_rows(rows, profile_family)

    records: list[dict[str, Any]] = []
    for item in selected:
        pos = first_value(item, ["pos", "position", "player_position"])
        name = first_value(item, ["player_name", "name", "player", "full_name"])
        record = source_record(
            "fantasypros_ecr",
            name,
            pos,
            rank=first_value(item, ["ecr", "rank_ecr", "overall_rank", "rank", "rank_ave"]),
            pos_rank=first_value(item, ["pos_rank", "position_rank", "rank_pos"]),
            team=first_value(item, ["team", "team_abbr"]),
            sleeper_id=first_value(item, ["sleeper_id", "sleeperid"]),
            tier=first_value(item, ["tier"]),
        )
        if record:
            records.append(record)
    if len(records) < 100:
        raise RuntimeError(f"nflreadpy {profile_family} ECR contained only {len(records)} usable records")
    return records


def load_fantasypros_ecr_sets() -> dict[str, list[dict[str, Any]]]:
    import nflreadpy as nfl  # type: ignore

    frame = nfl.load_ff_rankings(type="draft")
    rows = frame.to_dicts()
    if not rows:
        raise RuntimeError("nflreadpy returned no draft rankings")
    return {
        family: fantasypros_records(rows, family)
        for family in ("redraft_1qb", "redraft_superflex", "dynasty_1qb", "dynasty_superflex")
    }


def percentile_rank(rank: float, size: int) -> float:
    if size <= 1:
        return 50.0
    return clamp(100 - ((rank - 1) / (size - 1)) * 100)


def median(values: list[float]) -> float:
    return statistics.median(values) if values else 0.0


def assign_tiers(players: list[dict[str, Any]], score_field: str, tier_field: str, group_field: str | None = None) -> None:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for player in players:
        groups[str(player.get(group_field) or "ALL") if group_field else "ALL"].append(player)
    for rows in groups.values():
        rows.sort(key=lambda item: finite(item.get(score_field), 0) or 0, reverse=True)
        gaps = [
            max(0.0, (finite(rows[index].get(score_field), 0) or 0) - (finite(rows[index + 1].get(score_field), 0) or 0))
            for index in range(len(rows) - 1)
        ]
        gap_median = median(gaps)
        mad = median([abs(gap - gap_median) for gap in gaps])
        threshold = max(1.75, gap_median + max(1.0, mad * 1.35))
        tier = 1
        for index, player in enumerate(rows):
            gap_after = gaps[index] if index < len(gaps) else 0.0
            player[tier_field] = tier
            if tier_field == "position_tier":
                player["tier_gap_after"] = round(gap_after, 1)
                player["tier_end"] = index == len(rows) - 1 or gap_after >= threshold
            if index == len(rows) - 1 or gap_after >= threshold:
                tier += 1


def merge_rankings(source_sets: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    source_sizes = {source: max(1, len([row for row in rows if row.get("rank") is not None])) for source, rows in source_sets.items()}
    source_position_sizes: dict[tuple[str, str], int] = {}
    for source, rows in source_sets.items():
        for position in POSITIONS:
            source_position_sizes[(source, position)] = max(1, len([row for row in rows if row["position"] == position]))

    merged: dict[str, dict[str, Any]] = {}
    for source, rows in source_sets.items():
        for record in rows:
            key = f"{record['norm_name']}|{record['position']}"
            player = merged.setdefault(
                key,
                {
                    "name": record["name"],
                    "position": record["position"],
                    "team": record.get("team") or "",
                    "sleeper_id": record.get("sleeper_id"),
                    "market_value": None,
                    "adp": None,
                    "source_ranks": {},
                    "source_position_ranks": {},
                    "_overall_scores": [],
                    "_position_scores": [],
                    "_source_tiers": [],
                },
            )
            player["name"] = player["name"] or record["name"]
            player["team"] = record.get("team") or player["team"]
            player["sleeper_id"] = record.get("sleeper_id") or player["sleeper_id"]
            if record.get("value") is not None:
                player["market_value"] = record["value"]
            if record.get("adp") is not None:
                player["adp"] = record["adp"]
            weight = SOURCE_WEIGHTS.get(source, 0.1)
            if record.get("rank") is not None:
                rank = float(record["rank"])
                player["source_ranks"][source] = round(rank, 2)
                player["_overall_scores"].append((percentile_rank(rank, source_sizes[source]), weight))
            pos_rank = record.get("pos_rank")
            if pos_rank is None and record.get("rank") is not None:
                ordered = sorted(
                    [item for item in rows if item["position"] == record["position"] and item.get("rank") is not None],
                    key=lambda item: item["rank"],
                )
                pos_rank = next((index + 1 for index, item in enumerate(ordered) if item is record), None)
            if pos_rank is not None:
                player["source_position_ranks"][source] = round(float(pos_rank), 2)
                player["_position_scores"].append(
                    (percentile_rank(float(pos_rank), source_position_sizes[(source, record["position"])]), weight)
                )
            if record.get("tier") is not None:
                player["_source_tiers"].append(int(record["tier"]))

    players: list[dict[str, Any]] = []
    for player in merged.values():
        if not player["_overall_scores"]:
            continue
        total_weight = sum(weight for _, weight in player["_overall_scores"])
        player["consensus_score"] = round(sum(score * weight for score, weight in player["_overall_scores"]) / total_weight, 2)
        pos_weight = sum(weight for _, weight in player["_position_scores"])
        player["position_score"] = round(
            sum(score * weight for score, weight in player["_position_scores"]) / pos_weight if pos_weight else player["consensus_score"],
            2,
        )
        ranks = list(player["source_ranks"].values())
        player["source_count"] = len(set(player["source_ranks"]) | set(player["source_position_ranks"]))
        player["rank_range"] = [round(min(ranks), 1), round(max(ranks), 1)] if ranks else None
        spread = statistics.pstdev(ranks) if len(ranks) > 1 else 18.0
        player["agreement"] = round(clamp(100 - spread * 3.2))
        player["confidence"] = round(clamp(player["agreement"] * 0.55 + min(100, player["source_count"] * 32) * 0.45))
        player.pop("_overall_scores", None)
        player.pop("_position_scores", None)
        player.pop("_source_tiers", None)
        players.append(player)

    players.sort(key=lambda item: (-item["consensus_score"], item["name"]))
    for index, player in enumerate(players):
        player["overall_rank"] = index + 1
        if player["adp"] is None:
            player["adp"] = player["overall_rank"]
    position_counts: dict[str, int] = defaultdict(int)
    for player in sorted(players, key=lambda item: (-item["position_score"], item["name"])):
        position_counts[player["position"]] += 1
        player["position_rank"] = position_counts[player["position"]]
    assign_tiers(players, "consensus_score", "overall_tier")
    assign_tiers(players, "position_score", "position_tier", "position")
    return sorted(players, key=lambda item: item["overall_rank"])


def looks_like_name(value: str) -> bool:
    value = re.sub(r"\s+", " ", value).strip(" -|:")
    if not 3 <= len(value) <= 45 or any(term in value.lower() for term in ["coach", "coordinator", "offense", "defense", "staff", "profile"]):
        return False
    words = value.split()
    return 2 <= len(words) <= 5 and all(re.match(r"^[A-Z][A-Za-z.'-]*$", word) for word in words)


POSITION_ROLE_TERMS = {
    "QB": "quarterback",
    "RB": "running back",
    "WR": "wide receiver",
    "TE": "tight end",
    "OL": "offensive line",
}


class _StaffCardParser(HTMLParser):
    """Small stdlib fallback for official NFL staff cards.

    BeautifulSoup remains the preferred parser in the scheduled data workflow,
    but draft intelligence should still validate in a minimal/offline runtime.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.body_depth: int | None = None
        self.capture: str | None = None
        self.capture_depth: int | None = None
        self.buffer: list[str] = []
        self.card: dict[str, str] = {}
        self.cards: list[tuple[str, str, int]] = []

    @staticmethod
    def _classes(attrs: list[tuple[str, str | None]]) -> set[str]:
        value = next((value or "" for key, value in attrs if key == "class"), "")
        return set(value.split())

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.depth += 1
        classes = self._classes(attrs)
        if self.body_depth is None and "d3-o-media-object__body" in classes:
            self.body_depth = self.depth
            self.card = {}
        if self.body_depth is not None:
            if "d3-o-media-object__roofline" in classes:
                self.capture = "role"
            elif "d3-o-media-object__title" in classes:
                self.capture = "name"
            if self.capture:
                self.capture_depth = self.depth
                self.buffer = []

    def handle_data(self, data: str) -> None:
        if self.capture:
            self.buffer.append(data)

    def handle_endtag(self, tag: str) -> None:
        if self.capture and self.capture_depth == self.depth:
            self.card[self.capture] = re.sub(r"\s+", " ", " ".join(self.buffer)).strip()
            self.capture = None
            self.capture_depth = None
            self.buffer = []
        if self.body_depth == self.depth:
            role, name = self.card.get("role", ""), self.card.get("name", "")
            if role and looks_like_name(name):
                self.cards.append((role, name, len(self.cards)))
            self.body_depth = None
            self.card = {}
        self.depth = max(0, self.depth - 1)


def parse_staff_html(html: str, seed: dict[str, Any] | None = None) -> dict[str, Any]:
    result: dict[str, Any] = dict(seed or {})
    result.setdefault("position_coaches", {})
    parsed_fields: list[str] = []
    try:
        from bs4 import BeautifulSoup  # type: ignore

        soup = BeautifulSoup(html, "html.parser")
    except ImportError:
        fallback = _StaffCardParser()
        fallback.feed(html)
        cards = fallback.cards
    else:
        cards: list[tuple[str, str, int]] = []
        for index, role_node in enumerate(soup.select(".d3-o-media-object__roofline")):
            body = role_node.find_parent(class_=lambda value: value and "d3-o-media-object__body" in value)
            title = body.select_one(".d3-o-media-object__title") if body else None
            role = re.sub(r"\s+", " ", role_node.get_text(" ", strip=True)).strip()
            name = re.sub(r"\s+", " ", title.get_text(" ", strip=True)).strip() if title else ""
            if role and looks_like_name(name):
                cards.append((role, name, index))

    def choose(key: str) -> str | None:
        matches: list[tuple[int, int, str]] = []
        for role, name, index in cards:
            normalized = role.lower().replace("/", " / ")
            if key == "head_coach":
                if normalized == "head coach":
                    matches.append((0, index, name))
                continue
            if key == "offensive_coordinator":
                if normalized == "offensive coordinator":
                    matches.append((0, index, name))
                elif normalized.startswith("offensive coordinator /"):
                    matches.append((10, index, name))
                continue
            term = POSITION_ROLE_TERMS[key]
            if term not in normalized:
                continue
            exact_roles = {term, f"{term}s", f"{term} coach", f"{term}s coach"}
            priority = 0 if normalized in exact_roles else 12
            if "assistant" in normalized:
                priority += 30
            matches.append((priority, index, name))
        return min(matches)[2] if matches else None

    for key in ("head_coach", "offensive_coordinator", "QB", "RB", "WR", "TE", "OL"):
        chosen = choose(key)
        if not chosen:
            continue
        if key in POSITION_ROLE_TERMS:
            result["position_coaches"][key] = chosen
            parsed_fields.append(f"position_coaches.{key}")
        else:
            result[key] = chosen
            parsed_fields.append(key)
    result["parsed_fields"] = parsed_fields
    return result


def scrape_staff(url: str, seed: dict[str, Any] | None = None) -> dict[str, Any]:
    result = parse_staff_html(fetch_text(url), seed)
    result["source_url"] = url
    result["verified_at"] = utc_now()
    return result


def percentile(values: list[float], value: float) -> float:
    if not values:
        return 50.0
    below = sum(1 for item in values if item < value)
    equal = sum(1 for item in values if item == value)
    return 100 * (below + 0.5 * equal) / len(values)


def safe_rate(numerator: float, denominator: float) -> float:
    return numerator / denominator if denominator else 0.0


def build_scheme_data(
    seasons: list[int],
    roster_season: int,
    coaching_config: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    import nflreadpy as nfl  # type: ignore

    pbp = nfl.load_pbp(seasons)
    rosters = nfl.load_rosters(sorted(set(seasons + [roster_season])))
    roster_map: dict[str, dict[str, Any]] = {}
    for row in rosters.iter_rows(named=True):
        gsis = first_value(row, ["gsis_id", "player_id"])
        if not gsis:
            continue
        roster_map[str(gsis)] = {
            "name": first_value(row, ["full_name", "player_name", "display_name"]),
            "position": normalize_position(first_value(row, ["position", "depth_chart_position"])),
            "team": normalize_team(first_value(row, ["team", "team_abbr"])),
            "sleeper_id": first_value(row, ["sleeper_id"]),
        }

    desired_columns = [
        "season", "season_type", "game_id", "posteam", "play_type", "pass", "rush", "epa", "success",
        "pass_oe", "qtr", "wp", "yardline_100", "yards_gained", "air_yards", "complete_pass",
        "receiver_player_id", "receiver_player_name", "rusher_player_id", "rusher_player_name",
        "passer_player_id", "passer_player_name", "qb_scramble", "cpoe",
    ]
    columns = [column for column in desired_columns if column in pbp.columns]
    team_stats: dict[str, defaultdict[str, float]] = defaultdict(lambda: defaultdict(float))
    player_stats: dict[str, defaultdict[str, float]] = defaultdict(lambda: defaultdict(float))
    player_meta: dict[str, dict[str, Any]] = {}
    game_weights: dict[str, dict[str, float]] = defaultdict(dict)
    newest = max(seasons)

    for row in pbp.select(columns).iter_rows(named=True):
        if str(row.get("season_type") or "REG") != "REG":
            continue
        team = normalize_team(row.get("posteam"))
        if not team:
            continue
        season = int(finite(row.get("season"), newest) or newest)
        weight = 1.0 if season == newest else 0.35
        is_pass = finite(row.get("pass"), 0) == 1 or row.get("play_type") == "pass"
        is_rush = finite(row.get("rush"), 0) == 1 or row.get("play_type") == "run"
        if not (is_pass or is_rush):
            continue
        stats = team_stats[team]
        stats["plays"] += weight
        if row.get("game_id"):
            game_weights[team][str(row["game_id"])] = weight
        epa = finite(row.get("epa"), 0) or 0
        success = finite(row.get("success"), 1 if epa > 0 else 0) or 0
        yards = finite(row.get("yards_gained"), 0) or 0
        if is_pass:
            stats["passes"] += weight
            stats["pass_epa"] += epa * weight
            stats["pass_success"] += success * weight
            if yards >= 20:
                stats["explosive_passes"] += weight
        if is_rush:
            stats["rushes"] += weight
            stats["rush_epa"] += epa * weight
            stats["rush_success"] += success * weight
            if yards >= 10:
                stats["explosive_rushes"] += weight
        wp = finite(row.get("wp"))
        qtr = int(finite(row.get("qtr"), 4) or 4)
        if wp is not None and 0.2 <= wp <= 0.8 and qtr <= 3:
            stats["neutral_plays"] += weight
            if is_pass:
                stats["neutral_passes"] += weight
            pass_oe = finite(row.get("pass_oe"))
            if pass_oe is not None:
                stats["pass_oe_sum"] += pass_oe * weight
                stats["pass_oe_n"] += weight
        red_zone = (finite(row.get("yardline_100"), 101) or 101) <= 20
        if red_zone:
            stats["red_zone_plays"] += weight
            if is_pass:
                stats["red_zone_passes"] += weight
            if is_rush:
                stats["red_zone_rushes"] += weight

        receiver_id = row.get("receiver_player_id")
        if is_pass and receiver_id:
            meta = roster_map.get(str(receiver_id), {})
            position = normalize_position(meta.get("position"))
            if position in {"RB", "WR", "TE"}:
                stats[f"{position}_targets"] += weight
                stats["targets"] += weight
                if red_zone:
                    stats[f"{position}_red_zone_targets"] += weight
                key = str(receiver_id)
                player_meta[key] = {**meta, "name": meta.get("name") or row.get("receiver_player_name"), "position": position, "team": team}
                usage = player_stats[key]
                usage["targets"] += weight
                usage["receptions"] += (finite(row.get("complete_pass"), 0) or 0) * weight
                usage["air_yards"] += (finite(row.get("air_yards"), 0) or 0) * weight
                usage["receiving_yards"] += max(0, yards) * weight
                if red_zone:
                    usage["red_zone_targets"] += weight

        rusher_id = row.get("rusher_player_id")
        if is_rush and rusher_id:
            meta = roster_map.get(str(rusher_id), {})
            position = normalize_position(meta.get("position"))
            if position in {"QB", "RB"}:
                key = str(rusher_id)
                player_meta[key] = {**meta, "name": meta.get("name") or row.get("rusher_player_name"), "position": position, "team": team}
                usage = player_stats[key]
                usage["rushes"] += weight
                usage["rush_yards"] += yards * weight
                if red_zone:
                    usage["red_zone_rushes"] += weight
                if yards >= 10:
                    usage["explosive_rushes"] += weight
                if position == "RB":
                    stats["RB_rushes"] += weight
                if position == "QB" and finite(row.get("qb_scramble"), 0) != 1:
                    stats["QB_designed_rushes"] += weight

        passer_id = row.get("passer_player_id")
        if is_pass and passer_id:
            meta = roster_map.get(str(passer_id), {})
            key = str(passer_id)
            player_meta[key] = {**meta, "name": meta.get("name") or row.get("passer_player_name"), "position": "QB", "team": team}
            usage = player_stats[key]
            usage["attempts"] += weight
            usage["pass_epa"] += epa * weight
            usage["air_yards"] += (finite(row.get("air_yards"), 0) or 0) * weight
            if (finite(row.get("air_yards"), 0) or 0) >= 20:
                usage["deep_attempts"] += weight
            cpoe = finite(row.get("cpoe"))
            if cpoe is not None:
                usage["cpoe_sum"] += cpoe * weight
                usage["cpoe_n"] += weight

    raw_profiles: dict[str, dict[str, float]] = {}
    for team, stats in team_stats.items():
        games = sum(game_weights[team].values()) or 1
        raw_profiles[team] = {
            "plays_per_game": safe_rate(stats["plays"], games),
            "neutral_pass_rate": safe_rate(stats["neutral_passes"], stats["neutral_plays"]),
            # nflverse stores pass_oe in percentage points; the UI and the
            # remaining rate fields use decimal fractions.
            "pass_rate_over_expected": safe_rate(stats["pass_oe_sum"], stats["pass_oe_n"]) / 100,
            "pass_epa_per_play": safe_rate(stats["pass_epa"], stats["passes"]),
            "rush_epa_per_play": safe_rate(stats["rush_epa"], stats["rushes"]),
            "pass_success_rate": safe_rate(stats["pass_success"], stats["passes"]),
            "rush_success_rate": safe_rate(stats["rush_success"], stats["rushes"]),
            "red_zone_pass_rate": safe_rate(stats["red_zone_passes"], stats["red_zone_plays"]),
            "explosive_pass_rate": safe_rate(stats["explosive_passes"], stats["passes"]),
            "explosive_rush_rate": safe_rate(stats["explosive_rushes"], stats["rushes"]),
            "qb_designed_rush_rate": safe_rate(stats["QB_designed_rushes"], stats["rushes"]),
            "rb_rush_share": safe_rate(stats["RB_rushes"], stats["rushes"]),
            "rb_target_share": safe_rate(stats["RB_targets"], stats["targets"]),
            "wr_target_share": safe_rate(stats["WR_targets"], stats["targets"]),
            "te_target_share": safe_rate(stats["TE_targets"], stats["targets"]),
            "rb_red_zone_target_share": safe_rate(stats["RB_red_zone_targets"], stats["red_zone_passes"]),
            "wr_red_zone_target_share": safe_rate(stats["WR_red_zone_targets"], stats["red_zone_passes"]),
            "te_red_zone_target_share": safe_rate(stats["TE_red_zone_targets"], stats["red_zone_passes"]),
        }

    metrics = sorted(next(iter(raw_profiles.values())).keys()) if raw_profiles else []
    distributions = {metric: [profile[metric] for profile in raw_profiles.values()] for metric in metrics}
    team_profiles: dict[str, Any] = {}
    sources = coaching_config.get("teams") or {}
    for team, raw in raw_profiles.items():
        config = sources.get(team, {})
        staff: dict[str, Any] = {}
        if config.get("url"):
            try:
                staff = scrape_staff(config["url"], config.get("seed"))
                parsed = set(staff.get("parsed_fields") or [])
                staff_status = "verified" if {"head_coach", "offensive_coordinator"}.issubset(parsed) else "partial"
            except Exception as error:  # network/parser failures lower confidence; they do not invent a staff
                staff = dict(config.get("seed") or {})
                staff["source_url"] = config["url"]
                staff["error"] = str(error)
                staff_status = "partial" if staff else "unavailable"
        else:
            staff_status = "unavailable"
        percentiles = {metric: round(percentile(distributions[metric], raw[metric]), 1) for metric in metrics}
        transition = bool(config.get("transition"))
        environment = {
            "QB": 0.25 * percentiles["pass_epa_per_play"] + 0.20 * percentiles["neutral_pass_rate"] + 0.15 * percentiles["pass_rate_over_expected"] + 0.15 * percentiles["plays_per_game"] + 0.15 * percentiles["explosive_pass_rate"] + 0.10 * percentiles["qb_designed_rush_rate"],
            "RB": 0.20 * (100 - percentiles["neutral_pass_rate"]) + 0.15 * percentiles["rush_epa_per_play"] + 0.20 * (100 - percentiles["red_zone_pass_rate"]) + 0.20 * percentiles["rb_target_share"] + 0.10 * percentiles["plays_per_game"] + 0.15 * percentiles["explosive_rush_rate"],
            "WR": 0.20 * percentiles["neutral_pass_rate"] + 0.25 * percentiles["wr_target_share"] + 0.15 * percentiles["explosive_pass_rate"] + 0.15 * percentiles["pass_epa_per_play"] + 0.15 * percentiles["wr_red_zone_target_share"] + 0.10 * percentiles["plays_per_game"],
            "TE": 0.15 * percentiles["neutral_pass_rate"] + 0.35 * percentiles["te_target_share"] + 0.20 * percentiles["te_red_zone_target_share"] + 0.15 * percentiles["pass_epa_per_play"] + 0.15 * percentiles["plays_per_game"],
        }
        reliability = 0.55 if transition else 0.85
        environment = {position: round(50 + (score - 50) * reliability) for position, score in environment.items()}
        labels = {
            "pass_rate_over_expected": "aggressive pass tendency",
            "neutral_pass_rate": "neutral-situation passing",
            "pass_epa_per_play": "efficient passing",
            "rush_epa_per_play": "efficient rushing",
            "rb_target_share": "RB receiving usage",
            "wr_target_share": "WR target concentration",
            "te_target_share": "TE target usage",
            "explosive_pass_rate": "explosive passing",
            "explosive_rush_rate": "explosive rushing",
        }
        ranked_metrics = sorted(labels, key=lambda metric: percentiles[metric], reverse=True)
        strengths = [labels[metric] for metric in ranked_metrics[:3] if percentiles[metric] >= 62]
        constraints = [labels[metric] for metric in reversed(ranked_metrics) if percentiles[metric] <= 38][:2]
        team_profiles[team] = {
            "seasons": seasons,
            "staff": {
                "head_coach": staff.get("head_coach"),
                "offensive_coordinator": staff.get("offensive_coordinator"),
                "status": staff_status,
                "source_url": staff.get("source_url") or config.get("url"),
            },
            "position_coaches": staff.get("position_coaches") or {},
            "staff_transition": transition,
            "metrics": {metric: round(value, 4) for metric, value in raw.items()},
            "metric_percentiles": percentiles,
            "position_environment": environment,
            "strengths": strengths,
            "constraints": constraints,
            "attribution_note": "Team and staff-context signal; public play-by-play cannot prove an individual assistant caused the result.",
        }

    usage_profiles: dict[str, Any] = {}
    for player_id, usage in player_stats.items():
        meta = player_meta.get(player_id, {})
        name = str(meta.get("name") or "").strip()
        position = normalize_position(meta.get("position"))
        if not name or position not in POSITIONS:
            continue
        sample = usage["attempts"] + usage["targets"] + usage["rushes"]
        archetypes: list[str] = []
        if position == "QB":
            rush_share = safe_rate(usage["rushes"], usage["attempts"] + usage["rushes"])
            deep_rate = safe_rate(usage["deep_attempts"], usage["attempts"])
            if rush_share >= 0.16:
                archetypes.append("dual-threat")
            if deep_rate >= 0.12:
                archetypes.append("vertical passer")
            if not archetypes:
                archetypes.append("structure passer")
        elif position == "RB":
            if usage["targets"] >= 35:
                archetypes.append("receiving back")
            if usage["red_zone_rushes"] >= 20:
                archetypes.append("goal-line runner")
            if not archetypes:
                archetypes.append("early-down/committee back")
        else:
            adot = safe_rate(usage["air_yards"], usage["targets"])
            if adot >= 12:
                archetypes.append("vertical target")
            elif adot <= 7:
                archetypes.append("short-area/YAC target")
            else:
                archetypes.append("intermediate target")
            if usage["red_zone_targets"] >= 10:
                archetypes.append("red-zone target")
        usage_profiles[f"{normalize_name(name)}|{position}"] = {
            "name": name,
            "position": position,
            "team": normalize_team(meta.get("team")),
            "sleeper_id": str(meta.get("sleeper_id")) if meta.get("sleeper_id") else None,
            "sample": round(sample),
            "archetype": archetypes,
            "metrics": {key: round(value, 2) for key, value in usage.items()},
        }
    return team_profiles, usage_profiles


def attach_scheme_fit(players: list[dict[str, Any]], team_profiles: dict[str, Any], usage_profiles: dict[str, Any]) -> None:
    for player in players:
        team = normalize_team(player.get("team"))
        team_profile = team_profiles.get(team)
        usage = usage_profiles.get(f"{normalize_name(player['name'])}|{player['position']}")
        if not team_profile:
            player["scheme_fit"] = {"score": 50, "confidence": 20, "label": "unrated", "reasons": ["No verified team tendency profile"]}
            continue
        environment = finite(team_profile["position_environment"].get(player["position"]), 50) or 50
        compatibility = 50.0
        reasons: list[str] = []
        if usage:
            metrics = usage["metrics"]
            archetypes = usage["archetype"]
            if player["position"] == "QB":
                rush_share = safe_rate(metrics.get("rushes", 0), metrics.get("attempts", 0) + metrics.get("rushes", 0))
                team_rush = team_profile["metric_percentiles"].get("qb_designed_rush_rate", 50)
                if rush_share >= 0.16 and team_rush >= 60:
                    compatibility += 18
                    reasons.append("dual-threat profile aligns with designed-QB-run tendency")
                if "vertical passer" in archetypes and team_profile["metric_percentiles"].get("explosive_pass_rate", 50) >= 60:
                    compatibility += 12
                    reasons.append("vertical profile aligns with explosive-pass tendency")
            elif player["position"] == "RB":
                if "receiving back" in archetypes and team_profile["metric_percentiles"].get("rb_target_share", 50) >= 60:
                    compatibility += 18
                    reasons.append("receiving profile aligns with RB target usage")
                if "goal-line runner" in archetypes and team_profile["metric_percentiles"].get("red_zone_pass_rate", 50) <= 40:
                    compatibility += 12
                    reasons.append("goal-line profile aligns with red-zone rushing tendency")
            elif player["position"] in {"WR", "TE"}:
                if "vertical target" in archetypes and team_profile["metric_percentiles"].get("explosive_pass_rate", 50) >= 60:
                    compatibility += 16
                    reasons.append("vertical usage aligns with explosive-pass tendency")
                target_metric = "wr_target_share" if player["position"] == "WR" else "te_target_share"
                if team_profile["metric_percentiles"].get(target_metric, 50) >= 65:
                    compatibility += 10
                    reasons.append(f"team directs an above-average target share to {player['position']}")
        score = round(clamp(environment * 0.82 + compatibility * 0.18))
        sample = finite(usage.get("sample") if usage else 0, 0) or 0
        staff_verified = team_profile["staff"].get("status") == "verified"
        confidence = 42 + min(28, sample / 8) + (10 if staff_verified else 0) - (18 if team_profile.get("staff_transition") else 0)
        if team_profile.get("staff_transition"):
            reasons.append("new offensive staff lowers confidence in last-season tendencies")
        reasons.extend(team_profile.get("strengths", [])[:2])
        player["archetype"] = usage.get("archetype") if usage else []
        player["scheme_fit"] = {
            "score": score,
            "confidence": round(clamp(confidence)),
            "label": "strong" if score >= 72 else "positive" if score >= 60 else "neutral" if score >= 45 else "weak",
            "reasons": reasons[:4] or ["team position environment is near league average"],
        }


def source_meta(source_id: str, label: str, url: str, status: str, count: int = 0, error: str | None = None) -> dict[str, Any]:
    payload = {
        "id": source_id,
        "label": label,
        "url": url,
        "status": status,
        "record_count": count,
        "retrieved_at": utc_now(),
        "weight": SOURCE_WEIGHTS.get(source_id, 0),
    }
    if error:
        payload["error"] = error
    return payload


def build(args: argparse.Namespace) -> dict[str, Any]:
    generated_at = utc_now()
    sources: dict[str, dict[str, Any]] = {}
    repository_snapshot = load_repository_positional_snapshot(args.repository_snapshot)
    repository_projections, projection_snapshot = load_repository_projections(args.repository_snapshot)
    seasonal_stats_path = args.nflverse_dir / "seasonal_stats.parquet"
    try:
        open_projection_rows = load_parquet_rows(seasonal_stats_path)
        open_projection_error = None if open_projection_rows else "Seasonal stats file contained no rows"
    except Exception as error:
        open_projection_rows = []
        open_projection_error = str(error)
    if repository_snapshot:
        sources["repository_positional_snapshot"] = source_meta(
            "repository_positional_snapshot",
            "Repository positional snapshot",
            "fantasypros.json",
            "ok",
            len(repository_snapshot),
        )
    projection_count = len(repository_projections)
    sources["fantasypros_projection_snapshot"] = source_meta(
        "fantasypros_projection_snapshot",
        "FantasyPros season projections",
        "https://www.fantasypros.com/api-data/",
        "ok" if projection_count >= sum(DRAFTABLE_PROJECTION_MINIMUMS.values()) else "incomplete",
        projection_count,
        None if projection_count else "No usable season projections in repository snapshot",
    )
    sources["open_nflverse_model"] = source_meta(
        "open_nflverse_model",
        "Open nflverse season projection model",
        "https://nflreadpy.nflverse.com/api/load_functions/",
        "ok" if open_projection_rows else "unavailable",
        len(open_projection_rows),
        open_projection_error or (None if open_projection_rows else f"Missing {seasonal_stats_path}"),
    )

    try:
        ecr_sets = load_fantasypros_ecr_sets()
        sources["fantasypros_ecr"] = source_meta(
            "fantasypros_ecr",
            "FantasyPros format-adjusted ECR via nflreadpy/DynastyProcess",
            "https://nflreadpy.nflverse.com/api/load_functions/#nflreadpy.load_ff_rankings",
            "ok",
            sum(len(records) for records in ecr_sets.values()),
        )
    except Exception as error:
        ecr_sets = {}
        sources["fantasypros_ecr"] = source_meta(
            "fantasypros_ecr",
            "FantasyPros format-adjusted ECR via nflreadpy/DynastyProcess",
            "https://nflreadpy.nflverse.com/api/load_functions/#nflreadpy.load_ff_rankings",
            "failed",
            error=str(error),
        )

    coaching_config = json.loads(args.coaching_config.read_text(encoding="utf-8"))
    try:
        team_profiles, usage_profiles = build_scheme_data([args.season - 2, args.season - 1], args.season, coaching_config)
        scheme_error = None
    except Exception as error:
        team_profiles, usage_profiles = {}, {}
        scheme_error = str(error)

    profiles: dict[str, Any] = {}
    for profile_id, spec in PROFILE_SPECS.items():
        sets: dict[str, list[dict[str, Any]]] = {}
        profile_sources: list[str] = []
        try:
            records = fetch_fantasycalc(spec, args.teams)
            sets["fantasycalc"] = records
            profile_sources.append("fantasycalc")
            sources["fantasycalc"] = source_meta(
                "fantasycalc",
                "FantasyCalc current market",
                "https://fantasycalc.com/",
                "ok",
                len(records),
            )
        except Exception as error:
            sources["fantasycalc"] = source_meta(
                "fantasycalc", "FantasyCalc current market", "https://fantasycalc.com/", "failed", error=str(error)
            )
        profile_family = f"{'dynasty' if spec['dynasty'] else 'redraft'}_{'superflex' if spec['qbs'] == 2 else '1qb'}"
        ecr = ecr_sets.get(profile_family, [])
        if ecr:
            sets["fantasypros_ecr"] = ecr
            profile_sources.append("fantasypros_ecr")
        if not spec["dynasty"] and repository_snapshot:
            sets["repository_positional_snapshot"] = repository_snapshot
            profile_sources.append("repository_positional_snapshot")
        if spec.get("ffc"):
            try:
                ffc = fetch_fantasy_football_calculator(spec, args.teams, args.season)
                sets["fantasy_football_calculator"] = ffc
                profile_sources.append("fantasy_football_calculator")
                sources["fantasy_football_calculator"] = source_meta(
                    "fantasy_football_calculator",
                    "Fantasy Football Calculator ADP",
                    "https://help.fantasyfootballcalculator.com/article/42-adp-rest-api",
                    "ok",
                    len(ffc),
                )
            except Exception as error:
                sources["fantasy_football_calculator"] = source_meta(
                    "fantasy_football_calculator",
                    "Fantasy Football Calculator ADP",
                    "https://help.fantasyfootballcalculator.com/article/42-adp-rest-api",
                    "failed",
                    error=str(error),
                )
        players = merge_rankings(sets) if sets else []
        attach_projections(players, repository_projections, projection_snapshot, spec)
        open_projections = build_for_players(players, open_projection_rows, args.season) if open_projection_rows else {}
        if open_projections:
            attach_projections(players, open_projections, {"scoring": "HALF"}, spec, only_missing=True)
        attach_scheme_fit(players, team_profiles, usage_profiles)
        players = players[: args.max_players]
        profiles[profile_id] = {
            "generated_at": generated_at,
            "format": {"teams": args.teams, **spec},
            "source_ids": sorted(set(profile_sources)),
            "projection_source_ids": (
                (["fantasypros_projection_snapshot"] if repository_projections else [])
                + (["open_nflverse_model"] if open_projections else [])
            ),
            "projection_coverage": projection_coverage(players),
            "players": players,
        }
        time.sleep(0.25)

    healthy = [source for source in sources.values() if source["status"] == "ok"]
    return {
        "schema_version": 1,
        "generated_at": generated_at,
        "season": args.season,
        "status": "ready" if len(healthy) >= 2 else "degraded",
        "sources": list(sources.values()),
        "profiles": profiles,
        "team_profiles": team_profiles,
        "methodology": {
            "rank_fusion": "Source-weighted percentile rank fusion; available-source weights are renormalized per player.",
            "tiers": "Position-specific score-gap detection using median absolute deviation; no fixed player counts per tier.",
            "scheme_fit": "82% team position environment and 18% player-archetype compatibility; recommendation influence is capped in the browser model.",
            "coaching_attribution": "Official staff context is displayed, but team play-calling metrics are not asserted as individual-coach causation.",
            "strategy_weights": "Strategy presets alter a bounded component; VBD, tier cliffs, market value, and roster needs remain primary.",
            "projection_activation": "Projected-point VORP activates only when explicitly labeled direct or open-model projections reach every draftable positional minimum; otherwise the format-specific League Value fallback remains explicit.",
        },
        "limitations": [
            "Preseason coaching changes reduce scheme-fit confidence because current-season play-call evidence does not yet exist.",
            "Fantasy rankings and ADP measure different concepts; rank dispersion is preserved instead of averaged away.",
            "A favorable scheme is a tiebreaker, not a substitute for talent, role, health, or draft price.",
            "Assistant-coach context is descriptive unless a verified role history supports stronger attribution.",
            "OPEN_MODEL_PROJECTION values are estimates derived from open historical data and conservative priors; they are never represented as licensed vendor projections.",
        ] + ([f"Scheme data unavailable: {scheme_error}"] if scheme_error else []),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, default=datetime.now().year)
    parser.add_argument("--teams", type=int, default=12)
    parser.add_argument("--max-players", type=int, default=320)
    parser.add_argument("--output", type=Path, default=Path("data/draft_intelligence.json"))
    parser.add_argument("--coaching-config", type=Path, default=Path("config/coaching_sources.json"))
    parser.add_argument("--repository-snapshot", type=Path, default=Path("fantasypros.json"))
    parser.add_argument("--nflverse-dir", type=Path, default=Path("data/raw/nflverse"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    payload = build(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    temporary.replace(args.output)
    print(
        json.dumps(
            {
                "output": str(args.output),
                "status": payload["status"],
                "profiles": {key: len(value["players"]) for key, value in payload["profiles"].items()},
                "teams": len(payload["team_profiles"]),
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
