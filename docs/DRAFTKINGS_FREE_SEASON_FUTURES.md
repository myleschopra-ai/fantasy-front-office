# DraftKings free season-futures adapter

The Vegas intelligence layer now has an experimental second free sportsbook input for NFL season-long player markets.

## Evidence

DraftKings currently exposes NFL `Player Futures` navigation with season categories including Passing Yards, Passing TDs, Receiving Yards, Receiving TDs, Rushing Yards and Rushing TDs. DraftKings' football rules also explicitly define `Regular Season Player Prop Season-Long Markets`.

The collector uses the public DraftKings sportsbook JSON endpoint family documented by older open-source scrapers, including the NFL event-group id `88808`. Those interfaces are undocumented and may change without notice.

## Collector

```bash
python scripts/scrape_draftkings_season_props.py \
  --output data/vegas/draftkings-season.json
```

Then combine with BetMGM or other provider-neutral quote files before building consensus.

## Confidence policy

DraftKings public JSON is treated as an experimental cross-check at weight 0.65. It does not outrank the football model or a licensed multi-book feed. The collector fails closed if it cannot discover a Player Futures category or parse recognized season markets.

No authentication, CAPTCHA solving, proxy rotation, geolocation evasion or access-control circumvention is implemented.

## Operational target

The free consensus path is now:

1. BetMGM public season-stat markets.
2. DraftKings public Player Futures when the JSON endpoint remains available.
3. Multi-book external scraper/reference for additional verification.
4. Licensed APIs as higher-confidence fallbacks when needed.

The system should increase the Vegas adjustment only when independent books agree. A large model-vs-Vegas disagreement from one experimental source remains a flag for review, not an automatic override.
