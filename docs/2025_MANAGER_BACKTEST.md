# 2025 manager replay: findings and next model changes

## What was tested

The replay treats 2025 as a no-lookahead historical season. It starts with a 12-team half-PPR snake draft, uses a seeded random draft position, performs weekly waiver and lineup decisions, and runs a six-team playoff through Week 17.

The fairness pass compares two paired user strategies inside otherwise equivalent leagues:

- **Front Office framework:** draft-time market rank + roster fit + positional scarcity + acquisition value.
- **ADP baseline:** best available historical ADP subject to roster caps.

All teams receive the same generic projection-based weekly management. Emerging players are added to the waiver pool when they first appear in that week's published projection data. The paired leagues share draft slot, opponent process, schedule and random seed.

No future actual result is used to make an earlier decision.

## 2025 holdout results

The primary seeded draft drew **slot 9 of 12**. The framework finished **10-4**, scored **1,406.3** regular-season points, earned the No. 2 seed and won the simulated championship. The paired ADP roster finished **4-10**, scored **1,194.7** points and missed the playoffs. This single run is illustrative only.

Across **240 paired leagues**:

| Metric | Front Office | ADP baseline | Paired edge |
| --- | ---: | ---: | ---: |
| Regular-season points | 1,303.7 | 1,202.6 | **+101.0** |
| Wins | 7.62 | 6.25 | **+1.36** |
| Playoff rate | 62.5% | 35.8% | **+26.7 pp** |
| Championship rate | 8.7% | 5.4% | **+3.3 pp** |
| Lineup capture | 89.1% | 87.3% | +1.8 pp |
| Starter projection MAE | 5.82 | 5.80 | essentially flat |

The paired regular-season point edge was **+101.05 points**, with a simple 95% confidence interval of **+83.62 to +118.49**. The framework beat its paired ADP roster in total regular-season points in **77.9%** of leagues.

As a weekly process scorecard—not a gambling recommendation—the framework outscored the paired ADP roster in **60.1% of weeks**, averaging **+6.32 fantasy points per week**.

## What the result does and does not prove

This is positive evidence that the draft/roster-construction heuristic contains useful signal relative to a naive ADP-only manager in this simulator. It is **not sufficient to call the model premium** yet.

Reasons for restraint:

1. The replay approximates the current draft engine rather than reproducing every Championship Equity component.
2. It omits DST and kicker roster mechanics.
3. Trade decisions are not replayed.
4. Historical weekly projection data comes from one published projection source.
5. 2025 is now an observed validation season. Any parameters tuned after reviewing this result must be tested on another untouched period.
6. The championship result for a single random slot is high variance; cohort metrics matter more.

The baseline title rate of 5.4% and framework rate of 8.7% are far more plausible than the first unfair simulation, in which the user had better waiver management than opponents and CPU drafts were too weak. That first result was rejected rather than treated as evidence.

## Accuracy bottleneck: weekly projections

The framework starter projection MAE was **5.82 fantasy points per player**. In the primary run, position-level MAE was:

- QB: **6.88**
- WR: **5.45**
- RB: **5.32**
- TE: **4.96**

Quarterback is the largest calibration problem in this sample.

The primary roster's largest hindsight lineup regrets were:

- Week 14: **30.2 points** left on the roster
- Week 11: **28.8**
- Week 5: **26.1**
- Week 6: **20.6**
- Week 4: **18.3**

A premium system must reduce these tail failures, not merely improve average ranking accuracy.

## Waiver-process weakness found by the replay

The current generic waiver rule is too weekly-myopic. In the primary run it was willing to drop players such as Mike Evans, Kyler Murray, Tony Pollard and Sam LaPorta when their current-week score fell below an available alternative.

That is unacceptable for a season-long front office because a weekly projection is not the same thing as rest-of-season asset value.

The waiver model should therefore separate:

- **current-week lineup value**
- **rest-of-season production value**
- **market/trade value**
- **injury/bye stash value**
- **role-growth optionality**

A high-value injured or temporarily suppressed player should require a much larger acquisition edge before becoming droppable.

## Changes most likely to improve total points

### 1. Calibrate the base projection before stacking adjustments

Use a two-stage model:

1. position-specific calibrated base projection;
2. bounded evidence adjustments from role, injury, matchup, Vegas, weather and officiating.

Do not use referee or Vegas modifiers to compensate for a biased base forecast.

### 2. Replace box-score waiver trend with role trend

Prioritize routes, target share, carries, snap share, goal-line work, third-down/two-minute participation and depth-chart consolidation. Recent fantasy points remain an outcome signal, not the primary opportunity input.

### 3. Add rest-of-season asset protection to waiver decisions

A drop decision should include a persistent asset floor from draft/market value, future role and injury horizon. Temporary zero projections should not automatically erase season-long value.

### 4. Add lineup fragility and close-call logic

When two players project within a small band, compare floor, ceiling, role certainty and game environment instead of treating a 0.4-point median edge as decisive. During the regular season, favor robust expected points; in playoff elimination weeks, allow controlled ceiling seeking when the matchup state calls for it.

### 5. Target QB calibration first

QB had the largest primary position MAE. Recalibrate passing/rushing components separately, because a rushing QB's fantasy floor and distribution are structurally different from a pocket passer's.

### 6. Use Vegas where it has real information advantage

Once timestamped historical player props are archived, test whether same-week multi-book consensus improves player-level error after the base projection. Vegas should be most valuable for start/sit, injury redistribution and game-environment updates, not as a blanket season-long bonus.

### 7. Keep referee/crew effects small and conditional

The officiating layer stays at zero historical weight in this 2025 replay because the necessary dated assignment + pregame market snapshot set has not yet been reconstructed. It should only earn weight after improving held-out prediction beyond closing totals, teams, venue and weather.

### 8. Optimize playoffs differently from the regular season

When the roster reaches Weeks 15-17, the decision objective can shift from season-long stability toward single-week advancement probability. The model should explicitly compare median points, ceiling concentration, correlation/stacking and opponent strength.

## Validation protocol from here

Do **not** tune parameters on 2025 and then cite the same 2025 result as proof.

The next rigorous calibration cycle should use earlier seasons for development—for example 2021-2024 walk-forward folds—then freeze the model and use 2025 as the untouched final test. Future 2026 weekly predictions should be logged before games so live forward performance becomes the strongest validation set.

The model earns a larger weight only when it improves held-out fantasy points, lineup accuracy, playoff qualification or championship equity without materially worsening downside risk.
