# Free sportsbook scraping path

The Vegas intelligence layer now has a free, credentialless ingestion path for NFL season-long player stat markets.

## Verified current target

As of August 2026, BetMGM exposes a public `2026/27 NFL: Regular season stats` page with season player markets including passing yards, passing touchdowns, rushing yards, rushing touchdowns, receiving markets and related over/under prices. The collector in `scripts/scrape_betmgm_season_props.py` converts the visible public page into the same provider-neutral quote contract consumed by `scripts/build_vegas_consensus.py`.

Example:

```bash
python scripts/scrape_betmgm_season_props.py \
  --url 'https://www.betmgm.com/en/sports/events/2026-27-nfl-regular-season-stats-19070789' \
  --output data/vegas/betmgm-season.json

python scripts/build_vegas_consensus.py \
  data/vegas/betmgm-season.json \
  data/vegas/consensus.json
```

A saved HTML page can also be parsed with `--html`, which is useful for reproducible tests and snapshots.

## GitHub scraper reference

`declanwalpole/sportsbook-odds-scraper` is retained as an external reference/fallback because it already normalizes markets from DraftKings, BetMGM, Caesars, BetRivers, Bovada and other books by querying their undocumented sportsbook endpoints. Its own documentation warns that those interfaces can change or block traffic without notice.

The first-party collector does not copy that project. It implements a narrow BetMGM season-market adapter so the Front Office data contract remains under our control.

## Reliability policy

Public sportsbook scraping is treated as a lower-confidence source than licensed APIs:

- Scraped sources are capped at 0.7 provider weight.
- Multi-book consensus remains preferred whenever available.
- The scraper fails closed when no recognized player markets are parsed.
- No login bypass, CAPTCHA solving, proxy rotation, geolocation evasion or other access-control circumvention is implemented.
- Store timestamps and source URLs with every quote so stale data can be excluded.

## Important limitation

The GitHub multi-book scraper is event-oriented. It proves that several sportsbook interfaces can be queried and normalized, but that alone does not establish that every sportsbook exposes season-long NFL player futures through the same event endpoint. BetMGM is currently the confirmed free season-long source. DraftKings and Caesars season-futures adapters should only be promoted after their current season-stat pages/endpoints are individually verified.
