# Player Data and Projection Pipeline

## Release contract

Fantasy Front Office separates observed results, current player state, market opinion, and model output. ADP, ECR, trade value, projections, and betting lines are evidence—not ground truth. Final game statistics are the evaluation truth.

The production build publishes four compact artifacts:

- `data/normalized/player_identity.json`: canonical IDs and current player metadata.
- `data/rookie_profiles.json`: public draft/combine evidence; unavailable college production remains null.
- `data/draft_intelligence.json`: format-specific rankings and probabilistic season projections.
- `data/weekly_projections.json`: time-locked weekly role projections with P10/P50/P90 ranges.

Raw public inputs remain local or in restricted CI artifacts. Every collected file receives a source URL, license note, retrieval timestamp, row count, SHA-256 digest, and schema fingerprint. Production outputs can therefore identify the exact evidence used without republishing entire upstream databases.

## Source hierarchy

1. nflverse releases: identities, results, rosters, snaps, participation, injuries, depth, expected opportunity, schedules, NGS, PFR advanced data, FTN charting, draft, and combine.
2. Sleeper read-only API: active player universe, status, injury/depth metadata, and add/drop trends. The complete player map is collected no more than daily.
3. DynastyProcess/FantasyPros ECR, FantasyCalc, and Fantasy Football Calculator: market/ranking evidence only.
4. CollegeFootballData and SportsDataverse-compatible inputs: optional college evidence. Missing records are never converted into synthetic grades.
5. The Odds API: optional quota-controlled weekly props. Direct sportsbook adapters remain manual and experimental.

## Projection models

The season model uses recency-weighted production, position priors, player-specific availability, bounded role trends, draft-capital rookie priors, and probability ranges. Direct provider projections remain separately labeled.

The weekly model blends season baseline, trailing production, expected fantasy opportunity, role trend, snap share, depth, injury availability, schedule, and opponent. Every row declares an evidence cutoff and a probability distribution. Future-week rows are excluded by construction.

Betting lines can adjust comparable stat components by at most 10 percent. A missing, stale, unmatched, or incomplete market has zero influence rather than being interpreted as zero production.

## Release gates

- At least 98% of published draft-board players must have a stable canonical identity.
- Every open season projection must include a probability range.
- Weekly projections must contain at least 240 players and declare no-lookahead behavior.
- P10 must be no greater than P50, and P50 no greater than P90.
- Source artifacts must include content and schema hashes.
- Rookie college grades cannot be inferred from draft capital or combine testing.
- Season and weekly walk-forward backtests must remain within their declared baseline tolerances.

The pipeline fails closed when a release gate fails. The previous verified dashboard artifact remains in production.

## Free-source operating policy

Prefer documented APIs and published data files over HTML scraping. Cache all successful responses, honor stated rate limits, use an identifiable user agent, and preserve attribution. A public GitHub scraper license covers its code, not permission to use the upstream website or data. No login automation, bot-defense bypass, CAPTCHA avoidance, stolen cookies, or access-control evasion is permitted.

## Known limits

Public data does not provide complete medical detail, premium film grades, proprietary route-quality grades, or every current sportsbook market. Those fields remain null and lower data confidence. They are never manufactured to make the player pool look complete.
