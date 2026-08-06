# Scouting Intelligence Data Pipeline

## Objective

Build an evidence-backed 2027 prospect board without fabricating measurements, declaration decisions, market values, or model grades.

## Flow

1. Collect source records into `data/raw/`.
2. Resolve canonical player identities and aliases.
3. Convert source records into field-level observations.
4. Apply source-specific confidence from `config/source_registry.json`.
5. Calculate deterministic, position-specific derived metrics.
6. Preserve missing data as null.
7. Create dated prospect snapshots.
8. Generate `data/prospect_board.json` with `scripts/build_prospect_board.py`.
9. Validate before publishing or using grades in Draft recommendations.

## Required controls

- Every consequential field must reference evidence IDs.
- Conflicting values remain visible until resolved by an explicit rule.
- AI may summarize evidence and contradictions but may not invent numerical inputs.
- A grade without supporting evidence is invalid.
- Automated production publishing remains approval-gated until historical validation is complete.

## Initial repository state

The repository currently has live Sleeper data, FantasyCalc values, `fantasypros.json`, and `watcher_state.json`. It does not yet contain a populated verified college-prospect evidence store. Phase 1 establishes that store and its contracts before collectors are added.
