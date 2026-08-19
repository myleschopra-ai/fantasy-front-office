# Open Projection Engine

The draft engine can produce complete, format-adjustable season estimates without a paid projection key. These values are labeled `OPEN_MODEL_PROJECTION`; they are not represented as licensed or directly observed vendor projections.

## Free inputs

- Sleeper public API: active NFL player universe, stable IDs, status metadata, and daily add/drop trends.
- nflverse through nflreadpy: historical player production plus available roster, snap-count, injury, depth-chart, and expected-opportunity releases.
- Existing FantasyCalc, Fantasy Football Calculator, and repository ranking inputs: draftable pool and position-rank priors.

## Model behavior

For players with NFL history, `open-nflverse-v1` annualizes recency-weighted per-game production, applies a bounded recent trend, and shrinks the estimate toward a position-rank prior. The shrinkage prevents a small or injured sample from dominating. Players without usable NFL history receive a conservative prior and lower confidence. K and DST currently use conservative rank priors because nflverse player-stat tables do not provide a directly comparable full unit projection.

Standard, half-PPR, and PPR totals are stored separately. Reception totals remain attached so custom reception scoring and TE premium can be recalculated in the browser. The draft engine activates projected-points VORP only when every positional depth minimum and the middle/late coverage gates pass.

## Refresh

```bash
python scripts/collectors/nflverse.py --seasons 2023 2024 2025
python scripts/collectors/sleeper_players.py
python scripts/build_draft_intelligence.py --season 2026 --teams 12
python scripts/validate_draft_intelligence.py data/draft_intelligence.json
```

Sleeper's full-player endpoint should be fetched at most once daily. Raw data remains an auditable workflow artifact; `data/draft_intelligence.json` is the browser-ready derived output.

## Known limitations and next calibration gate

- Rookie estimates rely heavily on market position rank until professional usage exists.
- K/DST estimates are intentionally conservative.
- The bounded opportunity trend currently uses fantasy production per game; snap, route, target, and expected-opportunity deltas should become explicit features after historical column coverage is validated.
- Production activation requires a no-lookahead historical backtest covering positional MAE, rank correlation, points above replacement, and late-round hit rate.
