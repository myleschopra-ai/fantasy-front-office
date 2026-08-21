# Mock Draft Effectiveness and Promotion Gates

Updated: 2026-08-21

## Current evidence

The redraft mock has been evaluated with paired, no-lookahead historical replays. Identical draft slots, opponent processes, random seeds, weekly lineup rules and realized scoring are used for the framework and baseline rosters.

The 2024-2025 format replay contains 96 paired trials per format. The snake framework beat its ADP-first baseline by 107.62 season points on average and won 74.0% of paired trials. The auction framework beat a generic published-value bidder by 310.17 points and won 95.8% of paired trials.

The auction headline is not a production-grade estimate of expected advantage. The baseline buys only to a generic published price, while the framework uses roster-aware maximum bids. A separate sensitivity test raises the baseline willingness to pay for positional need. The framework advantage declines from 257.42 points at a 6% premium to 57.10 points at a 15% premium, where the 95% interval crosses zero, and 51.05 points at a 20% premium. This establishes useful price discipline but not a guaranteed league-winning edge.

A stronger 2024-2025 replay gives both baselines the same roster constraints and need awareness. Across 96 pairs, snake gained 30.12 points with a 54.2% paired win rate (95% interval +4.80 to +55.44). Auction gained 179.74 points with an 82.3% paired win rate (95% interval +139.76 to +219.72). Slot-level results exposed weak snake outcomes at picks 3, 4, 11 and 12, so the production advisor now evaluates two-player combinations at the turn and applies bounded early-tier protection instead of hard-coding slot bonuses. Unmodeled auction advice now caps the premium above format value at 12% until real position/tier clearing-price evidence is available.

Artifacts:

- `data/backtests/2025/report.json`: 48-pair 2025 manager replay with waivers, lineup management and playoffs.
- `data/backtests/redraft-mock-validation/report.json`: paired 2024-2025 snake and auction format replay.
- `data/backtests/auction-sensitivity/report.json`: auction robustness versus progressively more aggressive need-aware bidders.
- `data/backtests/redraft-mock-validation-strong/report.json`: paired replay against competent need-aware snake and auction baselines.

## Ratings

| Area | Rating | Evidence |
|---|---:|---|
| Snake roster construction | 8/10 | Positive paired scoring interval across 2024-2025. |
| Auction budget discipline | 8/10 | Strong against generic value and still positive in most aggressive scenarios. |
| Auction clearing-price calibration | 6/10 | No multi-season league-specific purchase warehouse is present. |
| Recommendation explanation | 8/10 | Separates market, roster fit, wait cost, fallback and confidence. |
| Historical proof maturity | 6/10 | Current harness approximates browser decisions instead of replaying every production branch. |

## Required promotion gates

1. Replay serialized decisions from the exact production engines, including league configuration, available pool, roster state, recommendation, maximum bid and chosen action.
2. Preserve at least one untouched season as a frozen holdout and prohibit post-outcome features from entering its input snapshot.
3. Report snake results by round and ADP band, including starter hit rate and late-round top-quartile hit rate.
4. Report auction results by price band, position, nomination phase, budget state and opponent aggression.
5. Require a positive paired scoring interval against a need-aware baseline; generic AAV alone is insufficient.
6. Require at least two seasons of real league auction purchases before presenting league-specific price effects as validated.
7. Keep Vegas and referee effects at zero historical weight until timestamped pre-draft or pregame snapshots exist.

These results measure the historical usefulness of the decision policy. They do not represent a guaranteed championship probability.
