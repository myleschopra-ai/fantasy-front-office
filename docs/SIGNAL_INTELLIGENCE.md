# Signal Intelligence Process

## Objective

Separate repeatable developmental signal from temporary fantasy noise and expose the conclusion consistently across Draft, Scouting, Trade, Team, and League views.

## Required player decomposition

Every evaluated player is scored across four independent layers:

1. **Talent** — prospect pedigree, age-adjusted production, athletic profile, draft capital, efficiency, and historical archetype fit.
2. **Opportunity** — snaps, routes, touches, high-value usage, depth-chart access, contracts, injuries, and coaching deployment.
3. **Production** — fantasy scoring, targets, carries, yards, touchdowns, and efficiency already realized.
4. **Market** — dynasty value, ADP, trade demand, trend, and the implied probability already priced by managers.

The dashboard must not treat production as proof of talent or temporary opportunity as a permanent role.

## Shared qualifier contract

`config/player_qualifiers.json` is the canonical icon and meaning registry. The same qualifier key must mean the same thing in every dashboard module.

Compact rows show at most four primary icons. Detailed views must expose the evidence, confidence, sample size, and calculation that produced each icon.

## Initial deterministic qualifier rules

These are provisional presentation rules until the historical Developmental Intelligence Engine is trained and backtested:

- **Blue Chip**: top board tier, high model score, and high evidence confidence.
- **Prototype**: strong model score with verified pedigree or projection support.
- **Hidden Gem**: positive trend plus a meaningful score/value mismatch outside the highest market tier.
- **Breakout Signal**: positive market or usage trend with adequate confidence.
- **Opportunity Rising**: positive role or trend signal; future NFL usage inputs will supersede market trend proxies.
- **Market Lag**: model score materially exceeds normalized market value.
- **False Breakout Risk**: price or production is rising while supporting evidence or confidence is weak.
- **Small Sample**: confidence falls below the preferred evidence threshold.
- **Verified Evidence**: confidence meets the publication threshold.
- **Conflicting Evidence**: material source disagreement or unresolved identity linkage.
- **Decline Signal**: sustained negative trend or deteriorating role inputs.

## Evidence order

The UI presents information in this order:

1. Action
2. Qualifier icons
3. Confidence and market gap
4. Key positive signals
5. Key risks and noise warnings
6. Historical cohort outcomes
7. Source-level evidence
8. Raw data

## Developmental Intelligence roadmap

The current icons are a common visual language. Their production-grade implementation requires:

- career-stage snapshots;
- position-specific features;
- historical success and failure cohorts;
- nearest-neighbor comparables;
- explicit breakout definitions and time horizons;
- market-implied probability;
- backtesting without future-data leakage;
- calibration and false-positive reporting;
- thesis tracking and invalidation conditions.

No icon is proof by itself. It is a compact indicator of a reproducible underlying claim.
