# Fantasy Front Office

A local-first Sleeper fantasy football dashboard deployed with GitHub Pages.

## Pages

- `index.html` — existing front-office dashboard
- `draft.html` — production Draft Room v5 for mock drafts and confirmed-only Sleeper live sync
- `draft-review.html` — local post-draft review, counterfactual audit, and replay export
- `auction.html` — finite-budget auction engine with historical room and manager calibration
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
- Archived mock comparisons by slot, format, and strategy

Sleeper is the supported live read-only provider. Yahoo requires the separately deployed OAuth adapter and provider approval. ESPN is currently a secret-rejecting manual import foundation only; browser credentials/cookies are not accepted.

See `DRAFT_MVP.md` for the scope, calculation notes, limitations, and verification checklist.

See `docs/DRAFT_INTELLIGENCE.md` for ranking-source policy, strategy weights, coaching/play-call methodology, refresh behavior, and validation gates.
