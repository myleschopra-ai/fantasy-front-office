# Fantasy Front Office 2.0 — UI/UX Implementation Contract

Status: proposed implementation contract

Repository baseline: `main` at `bdddaea2b2a93c2c6492e1c8f263102630bc8102` (inventory date: 2026-08-20)

Scope: information architecture and presentation migration only; existing production valuation, draft, auction, trade, provider, calibration, and session logic is protected unless a change is explicitly identified below.

## 1. Purpose

Fantasy Front Office 2.0 turns the current collection of capable but visually separate tools into one league-centered fantasy management product. The interaction model combines:

- a persistent league context and dark, draft-friendly density;
- a predictable `Home → Team → Matchup → Players → League` mental model;
- compact, sortable player-management tables; and
- Fantasy Front Office's differentiator: auditable recommendations, bounded evidence adjustments, simulations, valuation, and post-decision review.

This document is the implementation contract. A screen is not complete because it looks correct in one screenshot: it must preserve the underlying calculations, work at all defined breakpoints, expose loading/empty/error/stale/offline states, support keyboard and touch interaction, and meet the acceptance criteria in section 16.

## 2. Non-goals and protected contracts

### 2.1 Non-goals

- Do not rewrite the application engines as part of the visual migration.
- Do not turn the read-only provider integrations into pick, lineup, waiver, or trade submission tools.
- Do not store provider passwords, cookies, client secrets, or refresh tokens in the browser.
- Do not present experimental or single-source signals as fact.
- Do not remove legacy routes until redirects, state migration, analytics evidence, and rollback coverage exist.
- Do not infer live matchup, transaction, or roster data when a provider has not supplied it.

### 2.2 Protected logic

The following are behavioral contracts. Their public inputs, outputs, caps, confidence labels, persistence formats, and deterministic results remain unchanged during phases 0–3 unless a separate logic RFC is approved:

- draft ranking, Draft Fit, roster need, tier pressure, survival/next-pick availability, CPU selection, strategy profiles, and roster equity;
- projected-points coverage gates, source-health penalties, late-round Diamond bounds, historical ADP calibration, and recommendation explanations;
- Sleeper read-only draft polling and provider reconciliation;
- checksummed snake and auction session migration, validation, restore, recovery, and diagnostic export;
- auction intrinsic price, expected price/range, inflation, legal maximum bid, capable-bidder logic, nomination, roster feasibility, CPU strategy, purchase application, and calibration backtest;
- post-draft and post-auction grading, counterfactual thresholds, archive comparison, and replay artifacts;
- dashboard lineup optimization, acquisition decisions, trade decisions, action ranking, and source freshness;
- adjustment-ledger caps and confidence weighting; championship, Vegas, schedule, playoff, season-management, and backtest intelligence;
- provider normalization and sensitive-field rejection.

The UI may adapt these outputs into view models. It may not recalculate or silently relabel them.

## 3. Repository inventory

### 3.1 Current user-facing routes

| Current route | Current responsibility | 2.0 destination | Disposition |
|---|---|---|---|
| `index.html` | Command center; connect/paste data; team selection; highest-value actions; lineup; roster; acquisitions; trade analyzer; validation; embedded draft center | `/home`, `/team/roster`, `/players`, `/trade`, `/league/data-health` | Split into focused screens; preserve all tools |
| `hub.html` | Minimal link hub | `/home` | Redirect after parity |
| `draft.html` | Production entry to Sleeper-style draft room | `/draft/room` | Canonical legacy redirect |
| `draft-room-v2.html` | Older draft-room shell | `/draft/room` | Redirect; no unique logic |
| `draft-room-v3.html` | Expanded board, roster, selections, setup | `/draft/room` | Redirect after parity |
| `draft-room-v5.html` | Current rich draft shell, provider sync, recovery, mobile tabs | `/draft/room` | Primary visual migration source |
| `mock-draft.html` | Redirect to v4 mock engine | `/draft/room?mode=simulator` | Redirect |
| `mock-draft-v2.html` | CPU simulator, manual companion, basic review | `/draft/room` and `/draft/review` | Preserve capabilities; retire shell |
| `mock-draft-v3.html` | Empirical mock learning and next-turn forecast | `/draft/room` and `/draft/review` | Preserve capabilities; retire shell |
| `mock-draft-v4.html` | Championship Draft Engine | `/draft/room` | Protected engine; new shell |
| `draft-review.html` | Draft grade, process, counterfactuals, steals/reaches, archive comparison, replay export | `/draft/review/:sessionId` | Rebuild |
| `draft-summary.html` | Simple summary/load utility | `/draft/review/:sessionId` | Merge and redirect |
| `draft-slot-blueprints.html` | Simulation board for every draft slot | `/draft/blueprints` | Rebuild |
| `draft-blueprints.html` | Redirect alias | `/draft/blueprints` | Redirect |
| `auction.html` | Auction setup, live lot, player board, valuation, roster/teams, history calibration, recovery/export | `/draft/auction` | Rebuild around existing engine |
| `auction-draft.html` | Auction route alias | `/draft/auction` | Redirect |
| `auction-review.html` | Spend, surplus, unused budget, buys/overpays, roster construction, replay | `/draft/auction/review/:sessionId` | Rebuild |
| `trade-intelligence.html` | Acquisition board, Vegas/model/market comparison, trade package sandbox | `/trade` | Rebuild |
| `trade.html` | Redirect alias | `/trade` | Redirect |
| `vegas-intelligence.html` | Vegas-adjusted player board and decision lens | `/players?view=markets` | Merge as a Players view; deep link remains |
| `decision-intelligence.html` | Interactive bounded adjustment ledger and policy explanation | `/players/:playerId/intelligence` plus `/lab/adjustments` | Player drawer for normal use; Lab preserves sandbox |
| `league-config.html` | Provider, league type, teams, scoring, draft format/order, auction constraints | `/league/settings` | Rebuild |
| `yahoo-connect.html` | Secure Yahoo adapter setup guidance and browser-local adapter URL | `/league/connections/yahoo` | Rebuild; preserve security model |

### 3.2 Current feature modules and ownership in 2.0

| Module | Existing behavior to preserve | 2.0 consumer |
|---|---|---|
| `js/dashboard-intelligence.js` | source manifest/freshness, league profile, normalization, lineup optimizer, roster assessment, acquisition/trade decisions, ranked actions | Home, Roster, Players, Trade |
| `js/dashboard-observability.js` | local-first quality/usage telemetry | application shell and quality dashboard |
| `js/draft-intelligence.js` | league context, positional demand, value/tier/need/upside/scarcity, recommendation evaluation | Draft Room, player drawer, review |
| `js/mock-draft-v4.js` | simulator/companion/live modes, CPU teams, strategies, survival, recommendation, board, roster, queue, player snapshot | Draft Room controller behind an adapter |
| `js/draft-calibration.js` | guarded local snake/auction historical calibration | Draft Room and Auction settings/source details |
| `js/draft-source-health.js` | data coverage/freshness assessment and confidence penalty | global Data Health indicator, Draft Room |
| `js/draft-session.js` | checksums, validation, migrations, safe save/load, diagnostics | all draft modes and reviews |
| `js/provider-contract.js` | manual/Sleeper/ESPN/Yahoo normalization; sensitive-field rejection | Connections and import flow |
| `js/provider-draft-sync.js` | validate, reconcile, conflict detection, confirmed-pick application | Draft Room live mode |
| `js/sleeper-draft-client.js` | league draft choice, details/picks, 30-second poller | Sleeper connection and Draft Room |
| `js/draft-review.js` | draft/auction analysis, archives, replay artifacts | Draft Review and Auction Review |
| `js/auction-intelligence.js` | format-aware pricing, inflation, bid cap, surplus, nomination, calibration | Auction Room and Auction Review |
| `js/auction-mock-engine.js` | legal full-room auction simulation, CPU behavior, roster assignment and validation | Auction Room |
| `js/auction-room.js` | auction orchestration, local history/session, UI events | Replace DOM writes with Auction view-model adapter; preserve orchestration semantics |
| `js/championship-intelligence.js` | championship-pattern and bounded Vegas interpretation | Players, Draft, Trade |
| `js/adjustment-ledger.js` | confidence, bounded adjustments, referee environment | Player Intelligence and Lab |
| `js/season-management-intelligence.js` | asset protection, lineup score, waiver value | Home, Roster, Players |
| `js/playoff-schedule-intelligence.js` | playoff weeks/opponents/byes | Roster, Players, Matchup/planning |
| `js/backtest-intelligence.js` | calibration/validation insights | League Data Health and Lab |
| `js/league-switcher.js` | active league, provider snapshot/team, Yahoo auth/sync/setup, league-change event | global League Switcher and Connections |
| `server/yahoo_oauth.py` | private OAuth adapter and league snapshots | unchanged server boundary |
| `server/render_app.py` | static application serving | migration/deployment support |

### 3.3 Data and configuration surfaces

- `config/leagues.json` remains the registry default; browser-local overrides remain explicit and league-scoped.
- `data/draft_intelligence.json` remains the compiled draft source consumed by draft/auction views.
- Fantasy market, Vegas consensus, source registry, qualifiers, coaching, schedule, scouting, and championship data retain provenance and freshness labels.
- Draft and auction history remain local unless a future storage RFC creates a user account boundary.
- Every cached snapshot must carry `provider`, `leagueId`, `retrievedAt`, and freshness state in the view model.

## 4. Product architecture

### 4.1 League-centered shell

Every authenticated-or-local session has one `ActiveLeagueContext`:

```text
ActiveLeagueContext
  provider: sleeper | yahoo | espn | manual
  leagueId, leagueName, season, leagueType
  scoring, roster, draft
  activeTeamId, activeTeamName
  syncState, retrievedAt, dataHealth
```

Changing leagues updates all league-dependent views through one event and invalidates incompatible derived view models. A stale screen must never continue to show the previous league under the newly selected league name.

### 4.2 Canonical route map

```text
/home
/team/roster
/matchup/:week
/players?view=available|waivers|markets|watchlist
/players/:playerId/intelligence
/trade
/league/overview
/league/standings
/league/activity
/league/settings
/league/data-health
/league/connections/:provider
/draft/room
/draft/blueprints
/draft/review/:sessionId
/draft/auction
/draft/auction/review/:sessionId
/lab/adjustments
```

`/matchup`, standings, activity, and transaction execution are provider-data-aware shells. They show honest unavailable/connection states when the current snapshot lacks those fields; they must not fabricate parity with ESPN, Yahoo, or Sleeper.

## 5. Navigation contract

### 5.1 Desktop, 1200 px and wider

- Left rail: 240 px expanded, 72 px collapsed; fixed and independently scrollable.
- Top context bar: 64 px; league switcher, season/week selector, data-health status, global search, settings/profile menu.
- Primary rail: Home, Team, Matchup, Players, Trade, Draft, League.
- Draft expands to Room, Auction, Blueprints, Reviews. League expands to Overview, Standings, Activity, Settings, Data Health, Connections.
- The current item uses icon, label, and a 3 px accent bar; color alone is insufficient.
- The shell preserves the last subroute per primary section.
- `Ctrl/Cmd+K` opens global player/action search. `/` focuses the current player-table search unless an input already has focus.

### 5.2 iPad/tablet, 768–1199 px

- Rail collapses to 72 px icons; tapping the logo or menu opens a labeled overlay rail.
- Top bar retains league switcher and health; global search becomes an icon.
- Two-column page layouts become content plus a 320 px contextual drawer when space permits; otherwise drawer overlays.
- Draft Room uses board/table as the main region and a right overlay for queue, roster, picks, and intelligence.

### 5.3 Mobile, 320–767 px

- Bottom navigation: Home, Team, Players, Draft, More. Minimum target 44×44 px.
- More contains Matchup, Trade, League, Data Health, Connections, and Lab.
- Header: 52 px with compact league switcher, page title, health dot, contextual action.
- Tabs immediately below the header may be horizontally scrollable but must show the active tab fully.
- Back uses route history when safe and section root otherwise. Drawers become full-height sheets.
- Preserve scroll position per tab and filters per league.
- Never hide a destructive or state-resetting action behind a swipe-only gesture.

### 5.4 Navigation safeguards

- Changing league during an unsaved draft/auction opens a confirm dialog describing what will be preserved.
- Leaving an active live draft does not stop provider polling until the page controller unmounts; returning restores and reconciles before accepting local action.
- Deep links load directly with skeleton states and do not require visiting Home first.
- Legacy links retain query strings and hashes where meaningful.

## 6. Responsive breakpoints and layout grid

| Name | Width | Columns/gutters | Behavioral rule |
|---|---:|---|---|
| Compact | 320–479 | 4 columns, 16 px margins, 12 px gutter | single-column; bottom nav; full-screen sheets |
| Mobile | 480–767 | 4 columns, 20 px margins, 16 px gutter | single-column; compact tables/cards |
| Tablet | 768–1023 | 8 columns, 24 px margins, 20 px gutter | collapsed rail; 1–2 columns |
| iPad landscape | 1024–1199 | 12 columns, 24 px margins, 20 px gutter | collapsed rail; contextual panel |
| Desktop | 1200–1599 | 12 columns, max content 1440 px, 24 px gutter | expanded/collapsible rail; 2–3 regions |
| Wide | 1600+ | 12 columns, max content 1680 px, 28 px gutter | draft board may show both queue and roster rails |

At 200% zoom, the interface must reflow without lost content or two-dimensional page scrolling, except intentional data grids and draft boards with labeled scroll regions.

## 7. Visual design rules

### 7.1 Tokens

```text
Canvas       #070A12        Surface       #0E1421
Surface-2    #151D2D        Border        #263247
Text         #F5F7FB        Text-muted    #9AA7BA
Accent       #7C5CFC        Accent-hover  #9279FF
Positive     #35C78A        Warning       #F4B740
Negative     #F06A6A        Info          #4CA6FF
QB           #EF4444        RB            #22C55E
WR           #3B82F6        TE            #F59E0B
K            #A855F7        DST           #64748B
```

- Accent is for primary actions and selection, not every metric.
- Positive/negative colors require text or icon labels.
- Position colors are narrow identifiers (badge/edge), not large tinted surfaces.
- Confidence is `Very high`, `High`, `Medium`, or `Low`, with source count and freshness available nearby.

### 7.2 Type, spacing, shape, and motion

- Font: Inter or system UI; tabular numerals for ranks, values, bids, scores, and clocks.
- Type scale: 12 metadata, 14 body/table, 16 emphasized body, 20 section, 28 page, 36 hero metric.
- Spacing follows a 4 px base: 4, 8, 12, 16, 24, 32, 48.
- Control height: 36 desktop/tablet, 44 touch; mobile inputs never render below 16 px text.
- Radius: 8 controls, 12 cards/drawers, 16 modal/sheet. Borders create hierarchy; shadows are reserved for overlays.
- Motion: 120–200 ms; respect `prefers-reduced-motion`; no count-up animation for decision metrics.

### 7.3 Density

- Player rows: 52 px default, 44 px compact desktop, 64–72 px mobile card-row.
- A desktop table should show at least 12 player rows at 900 px viewport height.
- Secondary evidence is progressive disclosure; the decision, why, uncertainty, and next action remain visible without expansion.

## 8. Component library contract

### 8.1 Foundations and shell

| Component | Required variants/states |
|---|---|
| `AppShell` | desktop rail, tablet rail, mobile bottom nav; skip link; route focus management |
| `LeagueSwitcher` | provider mark, league/team, loading, stale, disconnected, switching, unsaved-session guard |
| `DataHealthBadge` | healthy, aging, stale, incomplete, error; timestamp and source detail popover |
| `PageHeader` | title, context, actions, tabs, sticky compact state |
| `ToastRegion` | success/info/warning/error, polite/assertive announcements, retry action |
| `Modal`, `Drawer`, `BottomSheet` | focus trap, escape/back close, labelled title, return focus |

### 8.2 Fantasy primitives

| Component | Contract |
|---|---|
| `PlayerIdentity` | headshot fallback, name, position/team, status/injury; click opens player intelligence |
| `PositionBadge` | position text plus token color |
| `PlayerRow` | identity, opponent/status, projection/market metric, FFO decision, confidence, queue/watch action |
| `PlayerTable` | sort, search, filters, column chooser desktop, compact mobile row, virtualize over 150 rows |
| `DecisionBadge` | stable labels such as Draft Now, Wait, Target, Hold, Avoid at Cost; never color-only |
| `ConfidenceIndicator` | label, numeric optional, samples/books/sources, freshness |
| `Metric` | label, value, unit, delta, provenance tooltip; missing values render `—`, never zero |
| `EvidenceLedger` | base value, bounded adjustments, caps, confidence, final value; expandable detail |
| `RosterSlot` | slot, player/empty, projection, opponent, status, swap/change action |
| `TeamRoster` | starters/bench/IR/taxi where supplied; optimized and provider lineup clearly distinguished |
| `DraftPickCard` | overall/round pick, team, player, position; active, user, traded, empty, keeper states |
| `DraftBoard` | zoom/fit, position filter, active-pick centering, keyboard pan, accessible list alternative |
| `Queue` | reorder, remove, drafted-disabled, persistent state, empty guidance |
| `RecommendationCard` | decision first, Draft Fit, survives-next-turn, roster need, tier, concise why, full breakdown |
| `AuctionLot` | nominator, player, current bid, bidder/clock if known, Bid/Pass or record-sale actions |
| `BudgetMeter` | spent, remaining, slots, max legal bid, average per slot; warning and invalid states |
| `TradeSide` | Give/Get assets, reorder/remove, totals, validation, roster effect |
| `SourceDisclosure` | model/market/provider/source, retrieved time, confidence, limitation |
| `StatePanel` | loading skeleton, empty, first-use, disconnected, stale, error, recovery, permission |

### 8.3 Interaction semantics

- Buttons describe actions (`Add to queue`, not `+`; accessible name required even when icon-only).
- Table row click opens detail; nested controls do not also trigger the row.
- Optimistic state is allowed only for browser-local queue/watch/filter changes. Provider sync and draft reconciliation show pending until confirmed.
- Undo is available for local simulator/manual actions. Confirmed provider picks are not undoable locally.
- Reset, clear history, and finish-CPU actions require confirmation and describe the affected session.

## 9. Screen-by-screen specification

### 9.1 Home / Command Center — `/home`

Purpose: answer “What should I do next in this league?”

```text
┌ Context bar: league · week · sync health · search ┐
├ Page: Command Center               [Sync] [Connect] ┤
├ Priority action cards (ranked, confidence, why)      ┤
├ My Team snapshot ─────┬ Matchup / season snapshot    ┤
│ lineup issues         │ score/status or unavailable  │
│ roster strengths      │ record/playoff context       │
├ Acquisition targets ──┼ Market & source alerts       ┤
└ Draft/offseason card ─┴ Recent local decisions       ┘
```

- Preserve `Highest-Value Actions`, suggested lineup, roster assessment, acquisitions, provider connection/paste import, team selection, validation, and draft entry from `index.html`.
- Do not duplicate full roster/trade tools; show the top three items with `View all`.
- In-season and offseason layouts differ by server/provider season status, not calendar guessing.
- With no league: first-use panel offers Sleeper, Yahoo adapter, ESPN/manual import, and sample/demo data clearly labeled.
- With partial data: rank only supported actions and state what input is missing.

### 9.2 Team / Roster — `/team/roster`

```text
┌ Team header: logo/name · record · projected rank ┐
├ Tabs: Roster | Lineup | Needs | Picks             ┤
├ Starter lineup / optimized comparison ┬ Team intel┤
│ slot rows, projections, status         │ strengths │
│ bench / IR / taxi                      │ needs     │
│ likely drops                           │ playoff   │
└ Source and last sync disclosure ──────────────────┘
```

- Provider lineup and FFO optimized lineup are labeled separately.
- Preserve lineup optimization, lineup moves, roster assessment, likely drop candidates, asset protection, playoff schedule, and traded picks.
- If provider write-back is unsupported, `Change` opens analysis only and states “Read-only; make this move in [Provider].”
- Mobile uses Starter/Bench segmented control and a sticky team summary.

### 9.3 Matchup — `/matchup/:week`

- Side-by-side lineups at tablet/desktop; stacked with sticky score ribbon on mobile.
- Projected and actual points, game status, remaining players, FFO projection difference, and swing players when data exists.
- Week selector retains route history.
- When matchup data is absent, show connection/manual-import requirements and link to roster/start-sit analysis; do not synthesize an opponent.

### 9.4 Players — `/players`

```text
┌ Players [Available | Waivers | Markets | Watchlist] ┐
├ Search · position/status/team filters · sort · view  ┤
├ dense player table                    ┬ detail drawer ┤
│ player/opponent/market/FFO/confidence │ decision      │
│ queue/watch/add/drop/trade actions    │ evidence      │
└ source coverage and freshness footer ┴ trends         ┘
```

- Consolidate acquisition targets, Vegas board, breakout/decline qualifiers, waiver evaluation, schedule/playoff signals, and source disclosures.
- `Markets` preserves Vegas/model/ADP, V-PAR, agreement, books, movement, bounded grade effect, and decision applications.
- Selecting a player updates a route-addressable drawer; mobile opens a sheet.
- The drawer leads with decision and uncertainty, then role, market, model, Vegas, schedule, evidence ledger, and relevant Draft/Trade actions.
- If a player is not on the current provider roster/market, retain intelligence but disable invalid roster actions.

### 9.5 Trade Center — `/trade`

```text
┌ Trade Center         [New package] [Clear] ┐
├ Target/acquisition board ──┬ Package builder│
│ filters, market lag, PAR   │ You give       │
│ player decision            │ You receive    │
├ Potential partners ────────┼ Result          │
│ needs and fit              │ market/production/roster
└ traded picks / caveats ────┴ confidence/why  ┘
```

- Merge the original trade analyzer and potential partners from `index.html` with `trade-intelligence.html` acquisition signals and sandbox.
- Preserve market anchor, model/Vegas production, V-PAR, value gap, multi-book confirmation, movement, package totals, and roster-before/after evaluation.
- Package validation covers duplicate asset, same-player both sides, missing values, roster illegality when known, and unsupported draft-pick valuation.
- Results use `Favors give`, `Balanced`, or `Favors receive` plus magnitude and confidence; never imply provider acceptance.
- Share/export creates a local JSON artifact in phase 2; provider submission remains out of scope.

### 9.6 Draft Room — `/draft/room`

Desktop/wide:

```text
┌ Draft status: mode · provider sync · pick clock/status · actions ┐
├ Draft board (team columns / round rows; active pick centered)     ┤
├ Player table ───────────────────┬ Recommendation ┬ Queue/Roster  ┤
│ search/positions/available rows │ Draft Now/Wait │ tabbed rail   │
│ rank, tier, survival, Draft Fit │ why/breakdown  │ picks/team    │
└ Session health · source health · read-only disclosure ───────────┘
```

Mobile:

```text
┌ status / current pick / sync ┐
├ recommendation summary       ┤
├ Players | Queue | Team | Board | Picks ┤
├ active tab content           ┤
└ sticky contextual action     ┘
```

- Modes: Simulator, Manual Companion, Sleeper Live. Yahoo live is shown only when its provider contract is implemented; ESPN remains manual import.
- Setup includes teams, slot, rounds, strategy, CPU variance, active league settings, and provider draft selection.
- Preserve position and rookie-only filters, search, queue persistence/reorder, full board, selections, all team rosters, user roster, pick log, player snapshot, Draft Fit breakdown, next-turn forecast, strategy, simulation, manual record, undo, start/reset, simulate-to-pick, provider sync, 30-second polling, recovery, export, and source health.
- Primary recommendation always shows player, action, Draft Fit, survival to next pick, roster need, tier pressure, confidence, and two plain-language reasons.
- Full weighted factor impacts remain available under `Why this recommendation`.
- Provider-confirmed history is visually locked. Conflict state blocks new manual picks until reconciliation/recovery.
- `Draft Now` in live mode logs a recommendation/manual intent only and explicitly does not submit a provider pick.

### 9.7 Draft Slot Blueprints — `/draft/blueprints`

- Inputs: teams, rounds, simulations per slot, scoring, QB format, and active league defaults.
- Results show every slot, median build, opening path, starter strength, depth, stable targets, and position counts.
- Selecting a slot opens round-by-round distributions and `Start mock from this slot`.
- Long-running builds expose progress and cancellation; results state simulation count and seed/policy version.

### 9.8 Draft Review — `/draft/review/:sessionId`

- Header: draft identity, mode, completion status, grade, export.
- Sections: Summary, Process/strategy observed, Decision audit, Counterfactuals, Steals, Reaches, Roster construction, History comparison, Replay.
- Preserve the minimum material-gap threshold and small-sample labels.
- Missing or incomplete session displays recovery/import actions, not an empty grade.
- Archived filters remain slot, format, and selected strategy.

### 9.9 Auction Room — `/draft/auction`

```text
┌ Auction status · inflation · source health · actions ┐
├ Current lot ───────────────┬ My budget/roster         ┤
│ player, bid, expected      │ remaining/slots/max bid │
│ Bid / Pass / record sale   │ position needs          │
├ Available player board ────┼ Valuation / teams       │
│ price range, max, surplus  │ expected vs intrinsic   │
└ Nomination + history calibration + session recovery ┘
```

- Preserve league presets and custom roster/scoring/budget/minimum bid controls.
- Preserve start, advance, auto 10, finish CPU, select/nominate, bid/pass, manual winner/price, expected price reset, player filters, rosters/teams, room inflation, historical JSON, calibration/backtest, clear, recovery, retry, reset, and export.
- `Bid` is only a local simulation decision; the label becomes `Simulate bid` when ambiguity is possible.
- The maximum legal bid and required future minimum dollars are always visible before a user decision.
- Invalid roster/budget states block purchase and explain the violated rule.

### 9.10 Auction Review — `/draft/auction/review/:sessionId`

- Preserve Draft Fit grade/score, spend, total surplus, unused capital, value buys, overpays, starter/bench surplus, roster validity, and replay JSON.
- Add price-range calibration/source context without altering review calculations.

### 9.11 League — `/league/*`

- Overview: league identity, format, scoring summary, roster rules, provider status, and quick links.
- Standings and Activity: render provider data when supplied; otherwise honest connection/unsupported states.
- Settings: preserve provider, league type, teams, draft format, order, PPR, passing TD, TE premium, auction budget/minimum, and local-save behavior. Include full roster slots already consumed by engines.
- Data Health: source manifest, coverage gates, retrieved times, stale/incomplete/error states, model policy/version, last successful sync, validation status, and diagnostic export.
- Connections: Sleeper identifier/selection and verified read-only state; Yahoo private adapter URL/OAuth flow; ESPN/manual secret-rejecting JSON import; remove/refresh actions.

### 9.12 Intelligence Lab — `/lab/adjustments`

- Preserve the current interactive base projection and signal-confidence controls for Vegas, referee/crew, matchup, role, injury, weather, and championship fit.
- Show base, each bounded adjustment, cap, confidence band, net, and final projection.
- Lab is clearly marked as a sandbox and never mutates production weights or league/player records.

## 10. Global state and interaction behavior

### 10.1 Required state machine

Every data-backed screen implements:

```text
idle → loading → ready
              ↘ empty
              ↘ partial/stale
              ↘ disconnected
              ↘ error → retrying → ready|error
ready → refreshing (retain last confirmed data) → ready|stale|error
```

- Skeletons match the eventual layout and have no fake data.
- Refresh retains confirmed content with a visible updating state.
- `No results` from filters differs from `No data from provider`.
- Stale data remains visible when safe, with timestamp and decision-confidence effect.
- Errors include what failed, the impact, and a retry/recovery action.

### 10.2 Persistence keys and migration

- Existing local storage/session envelopes are read before any 2.0 namespace.
- Use an idempotent migration registry: `legacyKey → schemaVersion → leagueScopedKey`.
- Never delete legacy data during the first two releases; mark migrated copies with checksum and source key.
- Filters, compact mode, rail state, and last section are league-scoped where relevant.
- Queue/session/archive/history remain compatible with current tests and exports.

### 10.3 Freshness and provenance

- Every recommendation view model includes `computedAt`, `sourceHealth`, `confidence`, and `limitations`.
- Provider truth (roster/picks), market ranking, internal model, and experimental signals are visually distinct.
- Missing values use `—` plus explanation; `0` is reserved for a real measured zero.

## 11. Accessibility and content

- Target WCAG 2.2 AA: contrast, keyboard operation, visible focus, semantic landmarks, labels, error association, zoom/reflow, and reduced motion.
- Draft board and dense tables expose a semantic list/table alternative and announce pick changes without stealing focus.
- Position, trend, confidence, injury, and recommendation are never communicated by color alone.
- All sheets/modals trap focus, close with Escape, and return focus to the opener.
- Live status uses polite announcements; blocking reconciliation errors use assertive announcements.
- Plain-language copy leads: `Draft now — tier drop before your next pick` before factor names or formulas.
- Security/read-only copy is persistent at consequential moments, not buried in setup.

## 12. Performance and reliability budgets

- Initial shell renders in ≤2.5 s on a mid-tier mobile device under a simulated fast-3G profile; cached revisit ≤1.5 s.
- Interaction response ≤100 ms for filters, queue, tabs, and local calculations; show progress for longer simulations.
- Avoid loading `data/draft_intelligence.json` on routes that do not consume it.
- Virtualize player lists above 150 rows and memoize derived player view models by league/data version.
- No layout shift greater than 0.1 cumulative on core screens.
- Provider polling is single-instance, abortable, visibility-aware, and conflict-safe.
- Session save failure, corrupt envelope, quota failure, and partial provider response have tested recovery paths.

## 13. Analytics and observability

Local-first observability may record route, breakpoint, state transitions, latency bucket, feature action, and error code. It must not record provider credentials, imported raw rosters, private player notes, or full trade/draft payloads.

Required quality measures:

- task completion for connect/import, find player, queue player, start/restore draft, reconcile picks, evaluate trade, and export review;
- stale/error/recovery frequency;
- legacy-route usage and redirect success;
- breakpoint and overflow/a11y failures;
- recommendation expansion rate and source-disclosure access.

## 14. Phased migration plan

### Phase 0 — Freeze behavior and establish contracts

1. Snapshot current routes, storage keys, exports, engine APIs, and representative screenshots.
2. Expand characterization tests around protected modules and current fixtures.
3. Add view-model adapters without changing engine modules.
4. Establish tokens, accessibility helpers, shell prototypes, feature flags, and legacy-route telemetry.

Exit: protected tests pass unchanged; session artifacts round-trip; route/feature inventory is signed off.

### Phase 1 — Shell, league context, Home, Team, League

1. Implement responsive shell, navigation, league switcher, global health, and route state.
2. Split `index.html` into Home, Roster, League Settings, Data Health, and Connections.
3. Implement local-state migration and provider-aware empty states.
4. Keep legacy pages available behind direct URLs.

Exit: league switching cannot leak prior-league data; core pages meet accessibility and responsive acceptance tests.

### Phase 2 — Players, Trade, intelligence surfaces

1. Build shared PlayerTable, player drawer, evidence ledger, metrics, and source disclosures.
2. Consolidate acquisition, Vegas, season, schedule, playoff, and trade surfaces.
3. Preserve Lab as a separate sandbox.

Exit: every legacy trade/Vegas/decision function has a mapped, tested 2.0 path and parity fixtures.

### Phase 3 — Draft and auction rooms

1. Wrap protected draft/auction/session/provider engines with view models.
2. Build responsive Draft Room, Auction Room, Blueprints, and Reviews.
3. Run deterministic, E2E, recovery, provider reconciliation, iOS viewport, and auction legality suites.
4. Shadow-write sessions to both new and legacy-compatible formats during rollout.

Exit: identical fixtures produce identical recommendations, prices, legal bids, CPU outcomes, grades, and exports.

### Phase 4 — Redirect, hardening, and retirement

1. Run visual regression, accessibility, performance, corrupted-state, offline/stale, and browser/device matrices.
2. Make 2.0 routes default under a reversible feature flag.
3. Redirect aliases while preserving parameters; monitor failures for at least one release cycle.
4. Retire duplicate shells only after legacy usage and parity exceptions reach zero; retain protected engines.

Exit: definition of done is met; rollback to legacy shell remains documented and tested.

## 15. Exact feature migration checklist

### Dashboard and season management

- [ ] Connect league, paste/import JSON, and select team → Home/Connections.
- [ ] Highest-value ranked actions → Home.
- [ ] Suggested starting lineup, starters/bench, roster, likely drops → Team/Roster.
- [ ] Acquisition targets and waiver value → Players/Available or Waivers.
- [ ] Trade analyzer, potential partners, give/get builder → Trade.
- [ ] Traded draft picks → Team/Picks and Trade.
- [ ] Data validation/source manifest → League/Data Health.
- [ ] Embedded Live Draft Center → Draft Room link/status card.
- [ ] Asset protection, playoff schedule, lineup/waiver intelligence → Team and Players.

### Snake draft

- [ ] Simulator, manual companion, Sleeper live mode; teams, slot, rounds, strategy, variance.
- [ ] Start/reset, simulate to user, advance, record pick, user pick, undo.
- [ ] Full board, active pick, selections, every team roster, user roster, picks.
- [ ] Available player table; position, rookie, search, and queue filters/actions.
- [ ] Persistent queue and mobile Players/Queue/Team/Board/Picks tabs.
- [ ] Recommendation, Draft Fit, need, scarcity, tier, upside, market, survival/next-turn forecast.
- [ ] Weighted explanations, scheme/scouting/news/qualifier details, player snapshot.
- [ ] Local historical calibration and mock archive.
- [ ] Sleeper draft selection/polling/import, confirmed-only reconciliation, read-only disclosure.
- [ ] Source health, projection coverage gates, confidence penalty, stale state.
- [ ] Checksummed save/restore/migration/conflict/recovery/diagnostic export.
- [ ] Post-draft process, counterfactual, steal/reach, grade, comparison, replay.
- [ ] Slot blueprint simulation for each draft position.

### Auction

- [ ] Format presets and custom scoring/roster/team/budget/minimum-bid settings.
- [ ] Intrinsic/expected price and range, inflation, max legal bid, surplus, recommendation, nomination.
- [ ] Complete CPU room, rotating nominations, legal rosters/budgets, team strategy profiles.
- [ ] Start, advance, auto 10, finish, nominate, bid, pass, manual record, winner, price reset.
- [ ] Player filters, current lot, available board, roster/teams, budget health.
- [ ] Historical purchase import, local persistence, league model, held-out calibration reporting.
- [ ] Session restore/recovery/reset/export and source/projection status.
- [ ] Auction review grade, spend, surplus, unused capital, value/overpay, starter/bench, validity, replay.

### Markets, evidence, providers, and settings

- [ ] Vegas/model/ADP triangle, implied points, PAR, agreement, books, movement, value gap, bounded effect.
- [ ] Trade acquisition classifications and package market/production/value-gap totals.
- [ ] Adjustment ledger with all current signals, caps, confidence, and final projection.
- [ ] Provider-agnostic league normalization and sensitive-field rejection.
- [ ] Sleeper supported read-only; Yahoo private OAuth adapter; ESPN/manual import only.
- [ ] Local league overrides for provider/type/teams/draft/order/scoring/auction settings.
- [ ] Secure Yahoo adapter URL save/remove and connection instructions.

## 16. Acceptance criteria

### 16.1 Functional parity

1. The migration checklist has an owner, implementation link, and passing test for every item.
2. Golden fixtures produce equal protected outputs before and after UI migration, including rounding and confidence labels.
3. Existing snake/auction sessions, archives, histories, and replay exports load without destructive conversion.
4. Sleeper sync imports only confirmed picks, polls at the protected cadence, prevents duplicate pollers, and surfaces conflicts.
5. Yahoo secrets never enter client storage; ESPN/manual imports reject sensitive fields.
6. No UI claims to submit a pick, bid, lineup, waiver, or trade to a provider.

### 16.2 Responsive and visual

1. Home, Roster, Players, Trade, Draft Room, Auction Room, Review, Settings, and Data Health pass at 320, 375, 430, 768, 1024, 1280, 1440, and 1920 px.
2. There is no unintended horizontal page scroll; intentional grids identify their scroll affordance.
3. Touch targets, sticky regions, drawers, keyboard viewport changes, orientation, and safe areas pass on iOS Safari and iPadOS Safari.
4. Visual regression covers ready, loading, empty, stale, error, drawer/sheet, and high-density states.

### 16.3 Accessibility

1. Automated WCAG checks report no serious/critical issues on canonical routes.
2. Keyboard-only users can switch league, filter/select a player, manage queue, operate a local draft decision, build a trade, open/close detail, and recover a session.
3. Screen-reader smoke tests cover navigation, player table, draft status updates, error/recovery, and modal focus.
4. Contrast, 200% zoom/reflow, reduced motion, visible focus, semantic headings, and form errors pass manual review.

### 16.4 Reliability and performance

1. Corrupt, old-version, quota-failed, missing, partial, stale, and offline data fixtures render recoverable states.
2. Performance budgets in section 12 pass in CI or a documented device lab.
3. Deterministic draft and auction E2E suites pass with the same seeds and outcomes.
4. Legacy routes redirect without broken query/hash state and have a tested rollback.

## 17. Definition of done

Fantasy Front Office 2.0 is done only when:

- all canonical screens and state variants are implemented and approved against this contract;
- every existing feature is mapped, preserved, intentionally deprecated with approval, or explicitly deferred behind an honest unavailable state;
- protected valuation, draft, auction, trade, session, calibration, provider, and review behavior has parity evidence;
- responsive, accessibility, security, performance, browser/device, recovery, and visual-regression gates pass;
- analytics show legacy redirects and critical task failures within agreed thresholds for one release cycle;
- migration and rollback runbooks exist, local data migration is reversible, and legacy sessions remain recoverable;
- repository docs, route map, component usage, provider limitations, and read-only behavior are current; and
- no production logic was changed under the guise of a visual refactor.

## 18. Implementation decision log required during build

Any deviation from this specification must add a dated entry containing: affected route/component, requested change, protected behavior impact, accessibility/responsive impact, migration consequence, tests, decision owner, and approval. Visual convenience alone is not sufficient reason to drop a current feature or weaken an evidence disclosure.
