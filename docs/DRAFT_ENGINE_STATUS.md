# Draft Engine Status

Status date: 2026-08-12

## Production verdict

- Snake draft decision engine: **PRODUCTION — READ ONLY**
- Auction draft decision engine: **PRODUCTION — MANUAL ROOM INPUT**
- Draft Room v5: **PROMOTED TO `main`**
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
- roster-specific maximum bid
- legal-bid reserve for every remaining roster slot
- acquisition surplus
- opponent capable-bidder pressure
- nomination-to-buy / nomination-to-drain guidance
- purchase-state tracking
- endgame budget protection
- K/DST low-cap treatment

Fresh 2026 acceptance results for a 12-team, $200 auction:

- league dollars allocated: exactly $2400 / $2400
- top-10 QB average intrinsic price: 1QB $15.5 -> Superflex $33.2
- top-20 WR average intrinsic price: 2WR $21.4 -> 3WR $22.0
- required K/DST inventory: 12 / 12
- current K/DST maximum intrinsic price in validation: $1 / $1
- second elite QB max bid: 1QB $15 -> Superflex $38
- strict real-data auction gate: PASS

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

The hardened benchmark helper compares top-N results by player identity, detects duplicate keys, handles tied ranks with average ranks, and excludes missing outcomes instead of coercing them to zero.

## Known limitations / next production gates

- Full direct FantasyPros production API access is not configured; the aggregate source path remains the validated source of truth.
- League-specific auction clearing-price calibration improves when actual historical purchases are supplied; without them, manager-specific price tendencies remain generic.
- Sleeper live sync is read-only and never submits selections. Live auction ingestion is not implemented.
- Yahoo production activation remains subject to application approval, HTTPS deployment, and durable server-side sessions.
- ESPN is limited to the safe normalized import boundary. Authenticated live sync is not labeled supported because this deployment has no supported public ESPN fantasy OAuth/API contract.
- Draft Fit is a decision-process score, not projected points, win probability, or a guarantee.

## Canonical files

- `js/draft-intelligence.js`
- `js/mock-draft-v4.js`
- `js/auction-intelligence.js`
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
- `tests/draft-intelligence.test.js`
- `tests/auction-intelligence.test.js`
- `tests/backtest-intelligence.test.js`
- `.github/workflows/validate-live-draft-intelligence.yml`
- `.github/workflows/validate-draft-learning.yml`
