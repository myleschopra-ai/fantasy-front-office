# Fantasy Front Office

A local-first Sleeper fantasy football dashboard deployed with GitHub Pages.

## Pages

- `index.html` — existing front-office dashboard
- `draft.html` — production Draft Room with a Sleeper-inspired v6 interface for mock drafts and confirmed-only Sleeper live sync
- `draft-review.html` — local post-draft review, counterfactual audit, and replay export
- `auction.html` — iOS-first, Sleeper-inspired auction mock room with complete CPU teams, live draft board, finite-budget logic, and historical room calibration
- `auction-review.html` — auction spend, surplus, starter/bench, and unused-capital review

The draft assistant is available at:

`https://myleschopra-ai.github.io/fantasy-front-office/draft.html`

## Draft Assistant

The draft assistant currently supports:

- Sleeper league connection
- Team and draft selection
- Live Sleeper pick import
- Automatic removal of drafted players
- Rookie-only and position filters
- Persistent player queue
- Roster-needs scoring
- Best-available recommendation
- Estimated next-pick availability
- Mobile-responsive draft-day view
- Manual recommendation logging
- Automatic refresh every 30 seconds while a draft is active
- Read-only operation; it does not submit picks
- Checksummed session restore and conflict-safe provider reconciliation
- Transparent Draft Fit weights and weighted factor impacts
- Local post-draft starter/bench grading, strategy review, and replay artifacts
- Small-sample-guarded historical ADP and auction-manager calibration
- Auction confidence ranges with leave-one-season-out pricing error
- Complete auction simulation across every team and roster slot, with legal bids, rotating nominations, CPU strategy profiles, and reload-safe state
- Format-sensitive auction values for 1QB, Superflex, 2WR/3WR, PPR, TE premium, custom roster sizes, budget, and minimum bid
- Roster-aware maximum bids that preserve future minimum bids and prevent CPU overpayment beyond its calculated ceiling
- Archived mock comparisons by slot, format, and strategy
- Sleeper-inspired responsive draftboard, player table, persistent desktop queue/roster rail, and mobile draft-room navigation
- Draftable-player projection coverage gates across every enabled position and the middle/late-round board; shallow top-player samples cannot activate projected-point VORP
- Confidence-weighted late-round Diamond targets with a bounded influence that grows only after the early rounds

Sleeper is the supported live read-only provider. Yahoo requires the separately deployed OAuth adapter and provider approval. ESPN is currently a secret-rejecting manual import foundation only; browser credentials/cookies are not accepted.

See `DRAFT_MVP.md` for the scope, calculation notes, limitations, and verification checklist.

See `docs/DRAFT_INTELLIGENCE.md` for ranking-source policy, strategy weights, coaching/play-call methodology, refresh behavior, and validation gates.
