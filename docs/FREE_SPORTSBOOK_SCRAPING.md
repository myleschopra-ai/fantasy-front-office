# Free Vegas data collection

Fantasy Front Office uses separate, fail-closed collection paths. A complete
August 21, 2026 SharpAPI NFL coverage traversal returned 2,662 records across 14
pages but no season-long statistical player props. SharpAPI is therefore weekly
only. DraftKings and BetMGM remain the season-long sources.

## Source order

1. `scripts/scrape_draftkings_season_props.py` — unofficial DraftKings season futures.
2. `scripts/scrape_betmgm_season_props.py` — manual BetMGM season cross-check.
3. `scripts/collect_sharpapi_weekly_props.py` — documented weekly event props.

The SportsGameOdds integration is intentionally absent because that service is
not reachable in the deployment environment.

## SharpAPI

Keep the key in the environment. Never place it in a tracked file, URL, command
argument, browser JavaScript, or generated quote file.

PowerShell:

```powershell
Set-Location "C:\Users\Tournamentops\.codex\.chatgpt-projects\g-p-69cbdadfb78c8191b5ad8e2748d9e60a\fantasy-front-office"
$env:SHARP_API_KEY = "your-key"
python scripts/collect_sharpapi_season_props.py --coverage-report
python scripts/collect_sharpapi_season_props.py --output data/vegas/sharpapi-season.json
```

The coverage report lists market types without publishing data or exposing the
key. It is diagnostic only: SharpAPI currently has no supported season-stat
markets, so do not repeatedly run the season-output command. Its clean no-data
exit directs season collection to DraftKings and BetMGM.
Both SharpAPI collectors follow cursor pagination, space requests at least 5.25
seconds apart for the free tier, and honor one provider-supplied `Retry-After`
window without discarding the current cursor. Do not start multiple collectors
in parallel with the same free key.

## Separate season and weekly projection paths

Season-long sportsbook markets feed draft value, roster construction, and the
draft-room Vegas badge. They never enter the weekly lineup projection file.

Event-specific player props are collected separately:

```powershell
python scripts/collect_sharpapi_weekly_props.py --output data/vegas/sharpapi-weekly.json
```

The confirmed weekly feed includes receptions, anytime-touchdown, and touchdown
markets plus game/team context such as totals, spreads, and moneylines. Anytime
touchdown Yes/No prices are converted to a de-vigged probability before they
adjust the baseline touchdown component. Ambiguous `points_player` markets are
not treated as fantasy points.

Weekly lines are blended only into a genuine weekly baseline containing numeric
component stats. The builder replaces only the components for which a market is
available, preserves every uncovered baseline component, and caps the total
market adjustment at 10 percent by default:

`data/projections/weekly-baseline.json` is an input contract, not a bundled live
dataset. Create it from a verified current-week projection provider. A documented
shape is available at `config/weekly_projection_baseline.example.json`. Do not
rename the example and treat its placeholder player as data.

```powershell
python scripts/build_weekly_vegas_projections.py `
  data/projections/weekly-baseline.json `
  data/vegas/sharpapi-weekly.json `
  data/vegas/weekly-projections.json `
  --ppr 0.5 --pass-td 4 --interception -2
```

The dashboard loads `weekly-projections.json` for lineup and start/sit decisions.
It displays the applied sportsbook adjustment next to the weekly projection. If
the file is absent, stale, mislabeled, or lacks component-stat overlap, baseline
projections remain unchanged. A season projection must never be supplied as the
weekly baseline.

## DraftKings adaptation

The DraftKings collector adapts the MIT-licensed
`yzRobo/draftkings_api_explorer` project at commit
`9a0eceedeb8b38e81e4529c578a00dc9980b0a4a`. It retains:

- Live category and subcategory discovery.
- The current NFL sportscontent endpoint.
- Regular-season market-name parsing.
- Embedded `Over 3949.5` line parsing.
- DraftKings' `main` marker so alternate lines are not selected as primary.

It deliberately omits the upstream GUI, updater, executable packaging, and TLS
browser impersonation. It uses a truthful application user agent and stops on
an authentication denial, access denial, or rate limit.

```powershell
python scripts/scrape_draftkings_season_props.py --output data/vegas/draftkings-season.json
```

This is an undocumented public feed and must not be scheduled without permission
compatible with the intended use.

## BetMGM

BetMGM remains available for manual collection from a supplied public page or a
saved HTML snapshot:

```powershell
python scripts/scrape_betmgm_season_props.py --url "PUBLIC-SEASON-STATS-URL" --output data/vegas/betmgm-season.json
```

The collector does not authenticate, solve CAPTCHAs, rotate proxies, or bypass
access controls. It remains experimental and manual-only.

## Merge and consensus

```powershell
python scripts/merge_vegas_quotes.py data/vegas/sharpapi-season.json data/vegas/draftkings-season.json data/vegas/betmgm-season.json --output data/vegas/quotes.json
python scripts/build_vegas_consensus.py data/vegas/quotes.json data/vegas/consensus.json
```

The merger counts each sportsbook only once per player and market. If SharpAPI
and the direct DraftKings collector both observe DraftKings, the licensed API
quote wins; DraftKings is not counted as two independent opinions. Within the
same source class, the newest timestamp wins.

Generated `data/vegas/*.json` files and local `.env` files are ignored by Git.
No example or stale data is substituted when live collection fails.

## Reliability and display rules

- Direct sportsbook collectors are capped below verified API sources.
- A single book is labeled a single-book signal, not Vegas consensus.
- Multi-book consensus requires at least two distinct sportsbook names.
- Every quote retains provider, sportsbook, market, line, prices, and timestamp.
- Unsupported, stale, inactive, ambiguous, or non-season markets fail closed.
- No login bypass, CAPTCHA solving, proxy rotation, geolocation evasion, browser
  impersonation, or access-control circumvention is permitted.
