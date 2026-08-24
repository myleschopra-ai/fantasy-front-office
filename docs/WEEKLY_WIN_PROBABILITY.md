# Weekly Win Probability Added (WWPA)

Status: implemented decision layer for snake and auction draft rooms.

## Product objective

Fantasy Front Office optimizes for the probability that the best legal weekly lineup outscores a league-specific opponent. Season points, consensus rank, VORP, Player Grade, Market Value, League Value, scarcity, roster need, wait risk, opportunity cost, auction price, and late-round optionality remain inputs. They are not presented as the final outcome.

For team weekly score `T` and opponent weekly score `O`, the fast in-browser model uses:

```text
P(win) = NormalCDF(
  (mean(T) - mean(O)) /
  sqrt(variance(T) + variance(O) - 2 * covariance(T, O))
)
```

For candidate player `p`:

```text
WWPA(p) = P(win | current roster + p) - P(win | current roster)
Expected wins added = WWPA(p) * regular-season weeks
```

The dashboard displays WWPA in percentage points, not as a vague player score.

## Implemented decision flow

1. Read league size, scoring, active roster slots, flexible-slot eligibility, regular-season length, and draft format.
2. Convert season projections into weekly player distributions.
3. Reprice projections for reception scoring, TE premium, passing-touchdown value, passing-yard value, interception value, and first-down categories when the required source stats exist.
4. Adjust usable production for weekly availability and bye-week replacement.
5. Build the highest-mean legal weekly lineup. Empty future slots receive a league-configuration completion baseline so an early-draft roster is compared with a plausible final team rather than a roster full of zeros.
6. Include bounded within-team covariance for same-team QB/pass-catcher stacks and competing RB/WR combinations.
7. Compare the lineup distribution with league data when supplied, or a transparent configuration-derived opponent distribution otherwise.
8. Calculate win rate before the pick, win rate after the pick, WWPA, usable PPG added, and expected regular-season record.
9. Give non-starting bench players conservative injury-insurance and breakout optionality rather than crediting all bench points as lineup production.
10. Add a bounded WWPA adjustment above the established draft engine. Thin estimated projections cannot erase market, VORP, tier, roster, scarcity, wait-risk, strategy, and opportunity-cost guardrails.

## Snake behavior

The recommendation surface now leads with:

- expected weekly H2H win rate after the pick;
- WWPA;
- projected team PPG;
- weekly edge versus the league opponent baseline;
- expected regular-season record;
- Draft Fit as the supporting decision score.

Player rows and comparison cards expose both projected win rate and WWPA. ADP best available remains separate from the roster-aware recommendation. The existing survival simulation, position-run response, dynamic scarcity, next-comparable analysis, and two-pick turn plan remain active.

Snake settings also support:

- standard snake or third-round reversal;
- arbitrary 4–20 team rooms;
- QB, RB, WR, TE, FLEX, Superflex, RB/WR, WR/TE, K, DST, and bench counts;
- standard, half-PPR, or PPR scoring;
- four- or six-point passing touchdowns;
- TE premium.

## Auction behavior

Every live bid recalculates:

- current price;
- expected clearing price and evidence range;
- legal maximum bid;
- expected weekly win rate if acquired;
- WWPA if acquired;
- the next comparable player's WWPA and savings.

WWPA affects the roster-specific maximum bid and nomination priority inside a bounded range. Auction inflation, price evidence, minimum-bid reserves, opponent budgets, legal roster assignment, capable bidders, and comparable-player walk-away logic remain authoritative. An unmodeled league still caps premiums above format value until real clearing-price evidence exists.

The CPU auction room applies the same legal-lineup WWPA signal to bid ceilings and nominations for every team; it does not resolve the room with a hidden sealed winner.

## Variance and uncertainty

The probability equation handles risk directionally:

- when the roster is favored, lower variance protects the mean edge;
- when the roster is an underdog, higher variance can improve upset probability.

There is no universal consistency or stacking bonus. Explicit weekly standard deviation, floor/ceiling, availability, and projection confidence are preferred. When absent, the UI labels the result `ESTIMATED` and uses position-specific volatility and league-value priors.

## Data contract

Preferred per-player inputs are:

```text
weeklyProjection
weeklyStdDev
weeklyFloor
weeklyCeiling
availabilityProbability
probabilityOfBecomingStarter
projectionConfidence
projectedPoints
projectedGames
projectionStats
projectionScoring
```

Preferred league inputs are:

```text
teams
roster
scoring
regular_season_weeks or playoff_week_start
opponentWeeklyMean
opponentWeeklyStdDev
replacementWeeklyPoints
```

The current public projection feed is season-oriented, so weekly distributions are partly estimated until direct weekly means, variances, and availability probabilities are populated.

## Verification and validation boundary

Deterministic tests cover:

- the normal-CDF probability calculation;
- positive lineup WWPA;
- stronger players producing larger win-rate lift;
- expected record length;
- variance helping an underdog and hurting a favorite;
- availability reducing usable WWPA;
- six-point passing-TD repricing;
- bounded WWPA influence on snake Draft Fit and auction max bids;
- custom flex-slot handling and UI contracts.

This is a production decision model, not yet a historically validated claim of universal win-rate advantage. The existing replay suite validates draft economics and projected-points outcomes, but it does not contain time-stamped preseason weekly distributions plus actual historical weekly lineups for a leakage-free WWPA comparison.

## Required historical validation phase

Before labeling WWPA as empirically superior, replay at least two historical seasons using only information available before each season:

1. Normalize preseason projections, ADP, known injuries, league settings, and actual weekly results.
2. Simulate every snake slot, third-round reversal, and auction across 8-, 10-, 12-, 14-, and 16-team formats.
3. Compare ADP, ECR, raw projection, static VORP, named roster strategies, and WWPA.
4. Optimize only legal lineups with information available at that historical week.
5. Report H2H win rate, all-play win rate, top-half rate, expected wins, confidence intervals, and results by format/slot.
6. Reject any experiment with future-data leakage.

Success requires repeatable average improvement—not the best simulated season—across both snake and auction formats.

## Decision confidence and promotion contract

The live rooms now display a confidence grade and a win-rate range beside the point estimate. The grade combines source freshness, complete draftable-player projection coverage, player-level evidence, and the published model-validation state in `data/model_validation.json`.

The range is deliberately wider when direct projection coverage is partial, the open model supplies more of the pool, player evidence is thin, or WWPA calibration is pending. It is an uncertainty disclosure, not a confidence interval manufactured from unavailable historical observations.

The reusable backtest layer now calculates Brier score, calibration buckets, expected calibration error, paired outcome deltas, confidence intervals, and time-lock violations. WWPA remains labeled `estimated` until a holdout contains at least 100 time-locked probability decisions, expected calibration error is at most five percentage points, and the paired scoring interval is positive. Auction price calibration remains `limited` until at least two seasons of matched league purchases are supplied.

The live decision contract is:

1. Recommendation and ADP best available stay separate.
2. `Why now` must identify roster, tier, scarcity, or survival pressure.
3. `If you wait` must identify the next comparable player and expected value loss.
4. Auction advice must show both `bid through` and `walk away` prices.
5. The interface must disclose whether the probability is calibrated or estimated.
6. No backtest may pass promotion when an input timestamp occurs after its decision boundary.
