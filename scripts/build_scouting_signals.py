#!/usr/bin/env python3
"""Build draft-capital and age-curve scouting signals from collected nflverse data.

These are the two non-statistical factors identified as having the strongest,
best-established predictive value independent of box-score production:
  1. Draft capital (pedigree) — where the NFL drafted a player predicts future
     opportunity and roster investment independent of any stats produced so far.
  2. Age-adjusted career stage — position-specific age curves (RBs decline early,
     WRs peak later, rookie-year age matters in dynasty) are well-established.

Explicitly NOT built here: contract-year status. nflreadpy has a legitimate
load_contracts() function, so this is a real candidate for later — just not
verified or wired in yet, so it isn't guessed at here.

Input:  data/raw/nflverse/players.parquet, data/raw/nflverse/draft_picks.parquet
Output: data/scouting_signals.json

Read-derive-write step, separate from collection — matches the existing
nflverse.py principle of separating collection from evaluation. Does not
overwrite any published dashboard file directly.
"""
from __future__ import annotations

import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAYERS_PATH = ROOT / "data" / "raw" / "nflverse" / "players.parquet"
DRAFT_PATH = ROOT / "data" / "raw" / "nflverse" / "draft_picks.parquet"
OUTPUT_PATH = ROOT / "data" / "scouting_signals.json"

# Position-specific age curves. Values are illustrative breakpoints, not a
# claim of precise calibration — this is a real, well-established directional
# signal (RBs decline earlier than WRs/QBs), not a validated statistical model.
AGE_CURVES = {
    "RB": {"peak_start": 23, "peak_end": 26, "decline_per_year": 8},
    "WR": {"peak_start": 24, "peak_end": 29, "decline_per_year": 4},
    "TE": {"peak_start": 25, "peak_end": 30, "decline_per_year": 3},
    "QB": {"peak_start": 26, "peak_end": 34, "decline_per_year": 2},
}


def draft_capital_score(round_num, pick_num):
    """Undrafted -> 0. Round 1 pick 1 -> ~100, scaling down through round 7."""
    if round_num is None or pick_num is None:
        return 0
    if round_num < 1:
        return 0
    # Overall pick estimate assuming ~32 picks/round for scaling purposes.
    overall_est = (round_num - 1) * 32 + pick_num
    score = max(0, 100 - (overall_est - 1) * (100 / 260))
    return round(score, 1)


def age_curve_score(age, position):
    curve = AGE_CURVES.get(position)
    if age is None or curve is None:
        return 50  # neutral default — no penalty, no bonus, when data is missing
    if age < curve["peak_start"]:
        # Still developing — modest bonus for being young with real draft capital,
        # not yet penalized for inexperience alone.
        return min(100, 70 + (curve["peak_start"] - age) * 3)
    if curve["peak_start"] <= age <= curve["peak_end"]:
        return 90
    years_past_peak = age - curve["peak_end"]
    return max(10, 90 - years_past_peak * curve["decline_per_year"])


def compute_age(birth_date_str, as_of):
    try:
        bd = datetime.strptime(birth_date_str[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None
    return as_of.year - bd.year - ((as_of.month, as_of.day) < (bd.month, bd.day))


def build():
    try:
        import polars as pl
    except ImportError:
        raise RuntimeError("polars is required (nflreadpy returns Polars DataFrames)")

    if not PLAYERS_PATH.exists():
        raise FileNotFoundError(f"{PLAYERS_PATH} not found — run scripts/collectors/nflverse.py first.")
    if not DRAFT_PATH.exists():
        raise FileNotFoundError(f"{DRAFT_PATH} not found — run scripts/collectors/nflverse.py first.")

    players = pl.read_parquet(PLAYERS_PATH)
    draft = pl.read_parquet(DRAFT_PATH)

    today = date.today()
    signals = {}
    matched_draft = 0
    matched_age = 0

    draft_by_gsis = {}
    if "gsis_id" in draft.columns:
        for row in draft.iter_rows(named=True):
            gid = row.get("gsis_id")
            if gid:
                draft_by_gsis[gid] = row

    for row in players.iter_rows(named=True):
        gsis_id = row.get("gsis_id")
        name = row.get("display_name") or row.get("name") or f"{row.get('first_name', '')} {row.get('last_name', '')}".strip()
        position = row.get("position")
        if not name:
            continue

        draft_row = draft_by_gsis.get(gsis_id) if gsis_id else None
        round_num = draft_row.get("round") if draft_row else None
        pick_num = draft_row.get("pick") if draft_row else None
        pedigree = draft_capital_score(round_num, pick_num)
        if draft_row:
            matched_draft += 1

        birth_date = row.get("birth_date")
        age = compute_age(birth_date, today) if birth_date else None
        age_curve = age_curve_score(age, position)
        if age is not None:
            matched_age += 1

        signals[name] = {
            "position": position,
            "draftRound": round_num,
            "draftPick": pick_num,
            "pedigreeScore": pedigree,
            "age": age,
            "ageCurveScore": age_curve,
        }

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "nflverse players + draft_picks (scripts/collectors/nflverse.py)",
        "note": "Two non-statistical scouting signals: draft capital (pedigree) and position-adjusted age curve. Illustrative breakpoints, not a calibrated model — used as a bounded tiebreaker, not a dominant factor.",
        "matched_draft_capital": matched_draft,
        "matched_age": matched_age,
        "total_players": len(signals),
        "players": signals,
    }


def main():
    result = build()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH.relative_to(ROOT)}: {result['total_players']} players, "
          f"{result['matched_draft_capital']} with draft capital, {result['matched_age']} with age.")


if __name__ == "__main__":
    main()
