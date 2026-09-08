# League Decisions release — 8 September 2026

## Delivery and integration

- Added `league-decisions.html`, a complete self-contained six-tab workspace using the published Fantasy Front Office design and navigation. No runtime build or local server is required.
- Added the workspace to the home dashboard, desktop navigation, mobile More menu and tool search. Existing draft/session tools and manual snapshot workflows remain available.
- Shared source modules are tested directly, then embedded into the delivered HTML. CI checks that the file matches those sources.
- The legacy home dashboard's FantasyCalc request now also uses the shared format engine. Its older modeling views remain separate; this release does not claim to replace their draft or historical proxy models.

## Discovery, format and values

- Discover Partender and current NFL season/week, then all returned current-season leagues. League switches clear old views and commit a complete new snapshot; superseded loads cannot repaint the screen.
- Detect redraft/keeper/dynasty, Superflex, PPR, TE premium, best ball, IDP, lineup/bench/IR/taxi slots, team count, FAAB and playoff rules.
- Parameterize FantasyCalc per league; use DynastyProcess as a whole-board dynasty fallback. Exact supplied IDs take precedence; conflicting IDs and ambiguous names remain unresolved. Unique normalized-name/position matches are labeled fuzzy.
- Cache player/market feeds for 24 hours, deduplicate in-flight requests, retry transient failures, cap concurrency at four and start at most approximately five requests per second.
- Underlined metrics expose source, fetch time and calculation on hover or tap. The source audit lists every fuzzy/unresolved market identity.

## Power rankings

- Complete total, optimized starter and bench/reserve market values; partial coverage leaves totals unavailable.
- Positional market-strength grid; points per completed scoring week from actual results.
- Dynasty-only age-weighted descriptive window score with its exact formula. This is not a career-length or championship forecast.

## Trades

- Owner-aware one-, two- and three-player packages and target-specific fair counteroffers.
- Require improved starter market allocation for your team and unchanged or improved allocation for the counterparty. Include named counterparty roster-limit drops in the value guardrail.
- Neither side may lose more than 15% of sent market value. Unknown values cannot fund a package. Acceptance likelihood and weekly/championship gains are not invented.
- Show observed current-season trades, RB sales, early-season RB sales, waiver/free-agent acquisitions and picks acquired. Historical pick overpayment stays unavailable because at-transaction market prices are absent.

## Waivers

- Cross-reference global 24-hour add/drop feeds and resolved market IDs against all actual roster ownership, then eligible positions.
- Search the whole available free-agent universe. A missing trending entry is unavailable, not zero activity.
- Reference bid = median completed league waiver bid / starting FAAB × your remaining FAAB, rounded and bounded by the minimum/remaining budget. The UI explicitly distinguishes this budget/history reference from a player-specific winning-bid forecast. No bid is produced without history or in non-FAAB leagues.

## Lineup

- Exact slot assignment supports multi-position/flex and IDP eligibility; excludes IR and taxi.
- Experimental Sleeper weekly projections are behind a visible setting, enabled for new settings so reachable sources are attempted automatically. They are accepted only for the current season/week and supported scoring with complete candidate coverage. Missing stat components are not assumed to be zero.
- Value-only mode is explicit when usable weekly projections are absent. Best-ball leagues show a roster reference rather than suggesting manual submissions. Game locks and substitutions require review in Sleeper.

## Playoffs

- At least 5,000 seeded simulations using actual remaining matchups, current records, observed scoring means and empirical residuals. Model methodology is disclosed beside the output.
- Seed distributions, qualification probability and conditional win/loss leverage by week. Conditional leverage does not mean a loss mathematically eliminates a team.
- No odds with incomplete future schedules, missing completed scoring weeks, fewer than three completed scoring weeks, unsettled standings, or unsupported custom/division seeding. Median-game standings are handled explicitly.

## Draft capital

- Combine uncompleted drafts, traded picks and clearly labeled future allotments derived from explicit league draft-round rules.
- Generic year/round values use the same market source as player values. No inferred slot, invented discount or fallback price.
- Show owned pick value and net equity for each roster over the displayed years. Any missing pick price makes the affected total unavailable.

## Validation and live observations

Local contracts cover four synthetic formats, exact/fuzzy/conflicting joins, slot assignment, two- and three-player consolidations, ownership and fairness, cache/retry/storage behavior, actual-schedule simulation, and missing evidence. Chromium and WebKit journeys cover all six tabs at desktop and 375×812, counteroffers, rapid switches, failed discovery, dynasty fallback, experimental-source failure and tap-accessible provenance. Existing dashboard, roster-engine and decision-page journeys pass across desktop, iPhone and iPad sizes.

A live API/browser check on 8 September 2026 found one current Partender league: **The League of Shadows**, 12-team dynasty, half-PPR, one Superflex, no TE premium. All 27 players on **Liam Neeson Fatherhood FC** matched exact Sleeper IDs. The live FantasyCalc board required **zero fuzzy player matches**. Other unresolved market rows are listed in the in-app audit and are excluded.

At the initial live check (14:18 UTC), your market values were 53,325 total, 39,326 optimized starters and 13,999 bench/reserves. Remaining FAAB was $35. Displayed 2027–2029 pick equity was 18,742, or +4,298 versus original allotments. These are timestamped observations, not fixed reference data shipped in the app.

### Three alternative trade discussions from the tool

FantasyCalc half-PPR, 12-team dynasty, two-QB base; retrieved 8 September 2026 at 14:18 UTC. These alternatives overlap; do not combine them into one plan. Gains below are **starter market-value units**, not projected fantasy points or expected wins.

| Target / manager | Send | Receive | Your starter-value change | Counterparty condition |
| --- | --- | --- | --- | --- |
| Jordan Love / FatMan | Malik Willis 2,535 + Alvin Kamara 1,015 = **3,550** | **3,977** | **+1,442** | Starter value unchanged; additional depth is the incentive. Release Trey Lance 116: 3,550 received against 4,093 total outgoing cost, a 13.27% loss. |
| Marvin Harrison / Always Next Year | Romeo Doubs 1,535 + Kaleb Johnson 1,317 = **2,852** | **3,166** | **+1,329** | Starter value +9. Release Davis Mills 119: 2,852 received against 3,285 total cost, a 13.18% loss. |
| Kyle Pitts / Always Next Year | Romeo Doubs 1,535 + Alvin Kamara 1,015 = **2,550** | **2,753** | **+1,218** | Starter value +120. Release Davis Mills 119: 2,550 received against 2,872 total cost, an 11.21% loss. |

The tool identifies these as permissible starting discussions, not demonstrated manager willingness. Kamara had a Questionable injury designation in the player feed. Confirm health, role and counterparty depth needs before acting. No trades were sent.

## Assumptions and unverified behavior

- The actual repository is multi-file Fantasy Front Office, not an attached DynastyHQ source file. The requested new decision workspace is delivered as one complete HTML while the existing project structure and draft tools remain intact.
- FantasyCalc's public endpoint is live-verified but has no versioned schema contract available here; it has a visible feature flag. Custom PPR is mapped to the nearest supported base and labeled. TE premium, best-ball volatility, keeper contract economics and missing IDP values are not silently priced.
- The undocumented `https://api.sleeper.com/projections/nfl/{season}/{week}?season_type=regular` endpoint returned HTTP 200 and 9,419 current-week rows in a direct live check. Reachability does not establish complete scoring coverage or prediction accuracy. Its optional browser path has tested failure handling; this release does not claim calibrated weekly projections.
- Current Week 1 playoff odds are intentionally unavailable; historical scoring evidence does not yet exist. Synthetic simulations verify contracts, not real-world forecasting accuracy.
- Future draft entitlements are conditional on the league's current round rules. The tool does not infer unknown exact pick slots or unannounced future rule changes.
- Transaction windows are current season only. Early-season counts can include preseason activity stored by Sleeper in Week 1. Historical pick-overpayment claims require historical values and are unavailable.
- Keeper, best-ball and IDP behavior is verified with synthetic configurations; only the one current live Partender league was available for live validation.
- Browser state is local to each device. Provider data remains read-only, and all application materials are maintained in GitHub.
