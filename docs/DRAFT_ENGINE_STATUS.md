# Draft Engine Status

Status date: 2026-08-24

## Production verdict

- Snake draft decision engine: **PRODUCTION — READ ONLY**
- Auction draft decision engine + full CPU mock: **PRODUCTION CANDIDATE — BROWSER-TESTED**
- Draft Room v5 engine + Sleeper-inspired v6 interface: **PRODUCTION CANDIDATE**
- Session restore and confirmed Sleeper pick reconciliation: **BROWSER-TESTED**

The limitation is data-source access, not a failing ranking or auction-economy gate: the configured direct FantasyPros API feed is legacy/sample-limited. Full-board validation therefore uses the repository's live aggregate path (`nflreadpy` FantasyPros ECR + FantasyCalc + configured sources).

## Shared valuation architecture

Both draft modes use the same calibrated player foundation:

1. Player Grade — intrinsic fantasy outlook.
2. Market Value — consensus/ADP market information.
3. League Value — format-specific cross-position value.
4. Pick Utility / Max Bid — roster- and draft-state decision value.

Roster state is not allowed to rewrite Player Grade or League Value. It changes the decision layer only.

## Snake draft

Validated behavior includes:

- league-aware 1QB vs Superflex valuation
- 2WR vs 3WR format sensitivity
- optimal starter/FLEX/Superflex assignment
- dynamic roster need and QB redundancy
- positional tiers and tier cliffs
- positional scarcity / run response
- ADP wait-risk and next-pick logic
- opponent simulation
- opportunity cost
- post-pick recalculation
- K and DST support
- three-board model: Consensus / Model / Draft Now
- structured explainability
- explicit raw score, weight, weighted points, and impact-vs-neutral breakdown
- completed-roster validation
- local post-draft starter/bench review, strategy audit, counterfactuals, archive, and replay JSON
- bounded local-history calibration after three or more observations
- source-timestamped forward decision ledger with deduplicated recommendation, selection, confidence, and outcome fields
- fail-closed WWPA promotion report using time-lock, sample-size, ECE, and positive paired-lift gates

Fresh 2026 acceptance results:

- 1QB consensus overlap: top12 11/12; top24 23/24; top50 49/50
- Superflex: 11/12; 23/24; 50/50
- 3WR: 11/12; 22/24; 49/50
- top-10 QB average model rank: 1QB 59.2 -> Superflex 9.4
- 1QB QB redundancy: PASS
- RB scarcity depletion: 47 -> 56
- WR scarcity depletion: 46 -> 55
- ADP wait-risk: PASS
- K/DST integration: PASS

## Auction draft

The auction layer deliberately does not convert rankings directly into arbitrary dollar values. It models a finite league economy.

Implemented behavior includes:

- intrinsic auction prices derived from calibrated League Value
- exact league-budget conservation
- required positional inventory before bench/depth allocation
- format-sensitive positional demand
- room inflation/deflation
- expected clearing price distinct from intrinsic value
- historical league price calibration by position/tier
- manager-specific price tendencies after three or more matched purchases
- current-room price learning after three completed sales, with recency weighting, outlier bounds, shrinkage, and explicit `LIVE-ADAPTING` disclosure
- sample-aware expected-price ranges with MAE/RMSE diagnostics
- leave-one-season-out pricing error and bias by position, tier, and manager
- roster-specific maximum bid
- legal-bid reserve for every remaining roster slot
- acquisition surplus
- opponent capable-bidder pressure
- nomination-to-buy / nomination-to-drain guidance
- purchase-state tracking
- endgame budget protection
- K/DST low-cap treatment
- rotating nominations and four CPU bidding strategies
- every-team roster assignment with FLEX/Superflex legality
- complete-auction simulation, unique-player enforcement, and nonnegative budgets
- league-wide draft board, recent sales, user decisions, and manual companion mode
- checksummed reload/resume of every roster, sale, nomination, and budget
- iPhone/iPad safe-area layout, 44px touch targets, and Safari zoom protection

Fresh 2026 acceptance results for a 12-team, $200 auction:

- league dollars allocated: exactly $2400 / $2400
- top-10 QB average intrinsic price: 1QB $15.5 -> Superflex $33.2
- top-20 WR average intrinsic price: 2WR $21.4 -> 3WR $22.0
- required K/DST inventory: 12 / 12
- current K/DST maximum intrinsic price in validation: $1 / $1
- second elite QB max bid: 1QB $15 -> Superflex $38
- strict real-data auction gate: PASS
- complete 1QB auction: 192/192 purchases, 12 legal rosters, 0 CPU ceiling overpays
- complete Superflex auction: 192/192 purchases, 12 legal rosters, 0 CPU ceiling overpays
- complete 3WR auction: 204/204 purchases, 12 legal rosters, 0 CPU ceiling overpays
- complete TE-premium auction: 192/192 purchases, 12 legal rosters, 0 CPU ceiling overpays
- TE-premium top-8 TE price: $17.7 -> $23.4

## Benchmark and regression protection

CI now runs:

1. snake draft JS regression suite
2. auction draft JS regression suite
3. identity-safe/tie-safe benchmark metric tests
4. Python regression suite
5. direct FantasyPros refresh attempt (fail-closed if incomplete)
6. fresh full 2026 draft-intelligence build
7. draft-intelligence snapshot validation
8. real-data snake validation
9. real-data auction validation
10. existing no-lookahead 2025 manager replay
11. post-draft review/replay and calibration contracts
12. provider normalization and sensitive-field rejection
13. confirmed-only Sleeper live-draft browser reconciliation, reload, and conflict fail-closed checks
14. archived-draft comparison filters and auction uncertainty browser flows
15. desktop/mobile draft-room layout, canonical queue synchronization, and horizontal-overflow checks
16. complete multi-format auction simulations with CPU bid-ceiling audits
17. desktop/iPhone/iPad auction interaction, completion, touch-target, and overflow checks
18. draftable-player projection contracts by position and depth band, including an explicit rejection of top-50-only samples
19. bounded late-round Diamond scoring using market discount, source evidence, projections, team environment, pedigree, and age curve
20. forward decision-ledger deduplication, source-timing failure, resolution, and promotion-gate contracts
21. live auction-room activation threshold, bounded response, confidence label, and non-calibrated premium cap

The hardened benchmark helper compares top-N results by player identity, detects duplicate keys, handles tied ranks with average ranks, and excludes missing outcomes instead of coercing them to zero.

## Known limitations / next production gates

- The configured FantasyPros key currently returns sample-depth data rather than a production-complete player projection set. Projected-point mode now requires at least QB 32, RB 72, WR 84, TE 32, K 20, and DST 20 direct season projections, with at least 95% direct coverage through ranks 51–200. The UI and CPU engine stay on the labeled format-value fallback until every enabled-position gate passes.
- League-specific auction clearing-price calibration improves when actual historical purchases are supplied; without them, manager-specific price tendencies remain generic.
- Current-room auction learning adapts clearing-price expectations, but it is deliberately not historical validation and cannot promote a bid ceiling to `CALIBRATED`.
- The current snapshot has incomplete season-projection coverage. Until production API access provides the required depth, CPU roster optimization uses calibrated format-specific League Value as the starter-success proxy. Late-round Diamond signals remain confidence-capped without a direct projection and can add no more than six Draft Fit points at the end of the draft.
- Sleeper live sync is read-only and never submits selections. Live auction ingestion is not implemented.
- Yahoo production activation remains subject to application approval, HTTPS deployment, and durable server-side sessions.
- ESPN is limited to the safe normalized import boundary. Authenticated live sync is not labeled supported because this deployment has no supported public ESPN fantasy OAuth/API contract.
- Draft Fit is a decision-process score, not projected points, win probability, or a guarantee.

## Canonical files

- `js/draft-intelligence.js`
- `js/mock-draft-v4.js`
- `js/decision-ledger.js`
- `js/auction-intelligence.js`
- `js/auction-mock-engine.js`
- `js/auction-room.js`
- `js/draft-review.js`
- `js/draft-calibration.js`
- `js/provider-contract.js`
- `draft-review.html`
- `scripts/import_draft_history.py`
- `schemas/draft_history.schema.json`
- `js/backtest-intelligence.js`
- `auction.html`
- `scripts/validate_live_draft_board_v2.js`
- `scripts/validate_live_auction_board.js`
- `scripts/validate_auction_mock_formats.js`
- `scripts/reconcile_wwpa_decisions.py`
- `schemas/decision_ledger.schema.json`
- `tests/draft-intelligence.test.js`
- `tests/auction-intelligence.test.js`
- `tests/auction-mock-engine.test.js`
- `tests/auction-mock-e2e.mjs`
- `tests/backtest-intelligence.test.js`
- `.github/workflows/validate-live-draft-intelligence.yml`
- `.github/workflows/validate-draft-learning.yml`
