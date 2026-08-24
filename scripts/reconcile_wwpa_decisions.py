#!/usr/bin/env python3
"""Score exported forward WWPA decisions without rewriting production validation state."""
from __future__ import annotations

import argparse
import json
import math
from datetime import datetime
from pathlib import Path
from statistics import mean
from typing import Any


MIN_DECISIONS = 100
MAX_ECE = 0.05


def parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def extract_records(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict):
        return []
    for candidate in (
        payload.get("records"),
        payload.get("decisionLedger", {}).get("records") if isinstance(payload.get("decisionLedger"), dict) else None,
        payload.get("payload", {}).get("decisionLedger", {}).get("records") if isinstance(payload.get("payload"), dict) else None,
    ):
        if isinstance(candidate, list):
            return [row for row in candidate if isinstance(row, dict)]
    return []


def is_time_locked(row: dict[str, Any]) -> bool:
    source = parse_time(row.get("sourceGeneratedAt"))
    captured = parse_time(row.get("capturedAt"))
    return bool(source and captured and source <= captured)


def expected_calibration_error(rows: list[tuple[float, int]], bins: int = 10) -> float | None:
    if not rows:
        return None
    total = len(rows)
    error = 0.0
    for index in range(bins):
        low, high = index / bins, (index + 1) / bins
        bucket = [(probability, outcome) for probability, outcome in rows if low <= probability < high or (index == bins - 1 and probability == 1)]
        if bucket:
            error += len(bucket) / total * abs(mean(value[0] for value in bucket) - mean(value[1] for value in bucket))
    return error


def paired_interval(values: list[float]) -> dict[str, float | int | None]:
    if not values:
        return {"n": 0, "meanLift": None, "lower95": None, "upper95": None}
    average = mean(values)
    if len(values) == 1:
        return {"n": 1, "meanLift": average, "lower95": None, "upper95": None}
    variance = sum((value - average) ** 2 for value in values) / (len(values) - 1)
    margin = 1.96 * math.sqrt(variance / len(values))
    return {"n": len(values), "meanLift": average, "lower95": average - margin, "upper95": average + margin}


def build_report(records: list[dict[str, Any]]) -> dict[str, Any]:
    unique = {str(row.get("id") or f"row-{index}"): row for index, row in enumerate(records)}
    rows = list(unique.values())
    resolved: list[tuple[dict[str, Any], float, int]] = []
    for row in rows:
        outcome = row.get("outcome") if isinstance(row.get("outcome"), dict) else {}
        won = outcome.get("won")
        probability = row.get("predictedWinRate")
        try:
            probability = float(probability) / 100
        except (TypeError, ValueError):
            continue
        if won in (0, 1, False, True) and 0 <= probability <= 1:
            resolved.append((row, probability, int(bool(won))))
    calibration_rows = [(probability, won) for _row, probability, won in resolved]
    locked_resolved = [(row, probability, won) for row, probability, won in resolved if is_time_locked(row)]
    lifts = []
    for row, _probability, _won in locked_resolved:
        outcome = row.get("outcome", {})
        try:
            lifts.append(float(outcome["modelPoints"]) - float(outcome["baselinePoints"]))
        except (KeyError, TypeError, ValueError):
            pass
    ece = expected_calibration_error(calibration_rows)
    brier = mean((probability - won) ** 2 for probability, won in calibration_rows) if calibration_rows else None
    paired = paired_interval(lifts)
    gates = {
        "minimumResolvedDecisions": len(resolved) >= MIN_DECISIONS,
        "allResolvedInputsTimeLocked": len(resolved) > 0 and len(locked_resolved) == len(resolved),
        "eceAtMostFivePercent": ece is not None and ece <= MAX_ECE,
        "positivePairedLift95CI": paired["lower95"] is not None and paired["lower95"] > 0,
    }
    return {
        "status": "PROMOTION_READY" if all(gates.values()) else "EVIDENCE_ACCUMULATING",
        "policy": {"minimumResolvedDecisions": MIN_DECISIONS, "maximumECE": MAX_ECE, "requiresTimeLock": True, "requiresPositivePairedLift95CI": True},
        "counts": {"captured": len(rows), "resolved": len(resolved), "timeLockedResolved": len(locked_resolved), "pairedPointComparisons": len(lifts)},
        "probability": {"brierScore": brier, "expectedCalibrationError": ece},
        "decisionLift": paired,
        "gates": gates,
        "note": "This report is evidence only. Production validation status must be promoted in a reviewed change after every gate passes.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Exported draft session or decision-ledger JSON")
    parser.add_argument("--output", type=Path, help="Optional report destination")
    args = parser.parse_args()
    report = build_report(extract_records(json.loads(args.input.read_text(encoding="utf-8"))))
    rendered = json.dumps(report, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)


if __name__ == "__main__":
    main()
