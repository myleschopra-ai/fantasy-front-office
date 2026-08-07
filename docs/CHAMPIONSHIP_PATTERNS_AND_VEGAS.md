# Championship Patterns + Vegas Intelligence

## Purpose

Add two independent evidence layers to the Championship Equity Engine:

1. Verified championship-roster patterns from completed leagues.
2. Sportsbook consensus season forecasts translated into league-specific fantasy points.

Neither layer replaces football projections. Both are bounded adjustments to the player and roster grade.

## Championship warehouse

Primary row-level source: public Sleeper leagues. The collector normalizes league format, scoring, champion roster, champion starters and champion draft selections. ESPN/FantasyPros championship population articles and FFPC high-stakes results are validation layers rather than row-level training data.

Only leagues passing quality filters should feed model training. The warehouse should preserve league size, scoring, roster format and season so patterns are compared within comparable formats.

Derived champion features should include elite-anchor count, top-12 positional outcomes, points above replacement, value hits versus acquisition cost, ceiling density, positional allocation, bench optionality and waiver contribution. The model should compare champion distributions against playoff and non-playoff teams from the same league-season rather than learning from champions in isolation.

## Vegas consensus

Use season-long player markets where available: passing yards/TDs/interceptions, rushing yards/TDs, receptions, receiving yards/TDs. Normalize quotes across books and use the median line. Convert the consensus into fantasy points using the active league scoring configuration.

The player card should display:

- Model season points
- Vegas-implied season points
- Vegas delta
- Number of books
- Confidence/freshness
- Line movement when available

The grading library caps the sportsbook adjustment at +/-12 grade points and scales the effect down for thin or stale markets. Multi-book consensus receives more weight than a single sportsbook.

## Decision integration

Recommended conceptual score:

- football/talent + opportunity: 35%
- points above replacement: 20%
- championship archetype fit: 15%
- ADP/market value: 10%
- Vegas consensus: 10%
- upside/breakout/scarcity: 10%

These are initial priors. Backtesting should replace fixed weights once sufficient league-season outcomes are available.

## Files

- `config/championship_sources.json` — verified source registry and league-quality policy.
- `config/championship_patterns.json` — initial championship-build priors.
- `config/sleeper_verified_leagues.example.json` — seed list contract.
- `scripts/collect_sleeper_champions.py` — public Sleeper championship collector.
- `config/vegas_sources.json` — provider and confidence policy.
- `config/vegas_consensus.example.json` — normalized output contract.
- `scripts/build_vegas_consensus.py` — provider-neutral sportsbook consensus builder.
- `js/championship-intelligence.js` — bounded Vegas and championship grade adjustments for the front end.

## Safety against overfitting

No two seasons should be assumed identical. Championship patterns are structural priors, not player-name rules. Historical champion roster features must be conditioned on format and compared with same-season league baselines. Sportsbook disagreement is a signal, not proof; the UI should always preserve both the internal model and Vegas-implied projection so users can see the disagreement directly.
