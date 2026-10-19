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

## In-season weekly decision feed

`.github/workflows/refresh-weekly-projections.yml` owns the weekly feed (Tue/Thu mornings, Saturday afternoon and Sunday before kickoff, September–January, plus any push to the engine):

1. Collect `weekly_stats`, `snap_counts`, `injuries`, `depth_charts`, `ff_opportunity`, `schedules` and `weekly_rosters` for the current and prior season.
2. `scripts/build_weekly_projections.py` projects every active QB/RB/WR/TE for the next NFL week (`scripts/resolve_projection_week.py`) into `data/weekly_projections.json`, and keeps a compact copy per week in `data/weekly_projections/<season>-wNN.json`. Missing earlier weeks are backfilled with the same evidence cutoff.
3. `scripts/validate_projection_pipeline.py` gates publication.
4. `scripts/weekly_scorecard.mjs` replays every completed week: the lineup the dashboard would have set from that week's snapshot, each manager's lineup, the hindsight optimum and Sleeper's projections as an outside benchmark. Results go to `data/scorecards/` and every lineup recommendation to `data/ledger/`.
5. A failed run pushes an ntfy alert (`NTFY_TOPIC`).

The dashboard applies today's Sleeper injury designation to `base_points` at render time and flags the feed stale when its week trails the NFL week or it is more than eight days old.
