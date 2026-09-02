#!/usr/bin/env python3
"""Shared provenance, identity, and confidence helpers for public data inputs."""
from __future__ import annotations

import hashlib
import json
import math
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_name(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", text, flags=re.I)
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def finite(value: Any, default: float | None = None) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except (TypeError, ValueError):
        return default


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def schema_fingerprint(columns: list[str]) -> str:
    return hashlib.sha256("\n".join(sorted(map(str, columns))).encode("utf-8")).hexdigest()


def artifact_record(
    path: Path,
    root: Path,
    *,
    dataset: str,
    source: str,
    source_url: str,
    license_name: str,
    rows: int | None,
    columns: list[str] | None = None,
    source_published_at: str | None = None,
    effective_as_of: str | None = None,
) -> dict[str, Any]:
    return {
        "dataset": dataset,
        "path": path.relative_to(root).as_posix(),
        "source": source,
        "source_url": source_url,
        "license": license_name,
        "retrieved_at": utc_now(),
        "source_published_at": source_published_at,
        "effective_as_of": effective_as_of,
        "rows": rows,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "schema_fingerprint": schema_fingerprint(columns or []),
        "columns": sorted(columns or []),
    }


def canonical_key(row: dict[str, Any]) -> tuple[str, str, int]:
    """Return canonical key, matching method, and confidence percentage."""
    identifiers = (
        ("gsis", row.get("gsis_id"), 100),
        ("sleeper", row.get("sleeper_id"), 96),
        ("espn", row.get("espn_id"), 94),
        ("yahoo", row.get("yahoo_id"), 94),
        ("pfr", row.get("pfr_id"), 92),
    )
    for namespace, value, confidence in identifiers:
        if value not in (None, "", "nan"):
            return f"{namespace}:{value}", f"{namespace}_id", confidence
    name = normalize_name(row.get("name") or row.get("display_name") or row.get("full_name"))
    position = str(row.get("position") or row.get("position_group") or "UNK").upper()
    team = str(row.get("team") or row.get("latest_team") or "FA").upper()
    return f"fallback:{name}|{position}|{team}", "name_position_team_fallback", 55


def evidence_confidence(
    *,
    identity: float,
    freshness: float,
    coverage: float,
    agreement: float,
    reliability: float,
) -> int:
    """Weighted geometric score: one weak foundation cannot be hidden by averages."""
    inputs = [max(0.01, min(1.0, float(value))) for value in (identity, freshness, coverage, agreement, reliability)]
    weights = (0.24, 0.20, 0.24, 0.14, 0.18)
    score = math.prod(value ** weight for value, weight in zip(inputs, weights))
    return round(score * 100)


def write_json_atomic(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)
