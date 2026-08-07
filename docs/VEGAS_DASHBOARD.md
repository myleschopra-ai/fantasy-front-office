# Vegas Intelligence Dashboard

`vegas-intelligence.html` is the decision-facing view for sportsbook information.

It is designed around the fantasy-manager decisions where betting-market information has the most value rather than displaying raw odds.

## Priority metrics

1. **Vegas-implied points above replacement (V-PAR)** — converts sportsbook season totals into league-scoring fantasy points and compares them with the positional replacement baseline.
2. **Vegas vs ADP value gap** — compares sportsbook-implied production rank with current FantasyCalc draft cost to identify market lag.
3. **Multi-book model disagreement** — compares the internal football projection with the betting consensus while weighting book count and agreement.
4. **Line movement** — uses changes between consensus snapshots to identify rising or falling expectations.

## Decision labels

The dashboard converts these metrics into `DRAFT NOW`, `TARGET`, `WAIT`, `AVOID AT COST`, or `HOLD GRADE` states. Strong labels require corroboration; a single experimental sportsbook cannot create the same confidence as multiple agreeing books.

## Market triangle

Every inspected player is evaluated across three independent markets:

- Football model projection
- Fantasy draft market / ADP
- Vegas-implied projection

The highest-value target state is generally football model bullish + Vegas bullish + fantasy market lagging. Fantasy-market enthusiasm that is contradicted by both the football model and multiple sportsbooks is treated as a fade signal.

## League awareness

The view reads the active league from `js/league-switcher.js`, selects standard/half-PPR/PPR Vegas fantasy totals accordingly, and recalculates the positional replacement baseline. Superflex leagues request two-QB FantasyCalc market data.

## Data behavior

The view first attempts to load `data/vegas/consensus.json`. When no production snapshot is present it falls back to `config/vegas_consensus.example.json` so the UI contract remains testable. The source line explicitly identifies when coverage is limited.

Sportsbook influence remains bounded by `js/championship-intelligence.js`; it is an independent information source, not an automatic override of the football model.