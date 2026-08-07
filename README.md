# Fantasy Front Office

A local-first Sleeper fantasy football dashboard deployed with GitHub Pages.

## Pages

- `index.html` — existing front-office dashboard
- `draft.html` — live Sleeper draft assistant MVP
- `mock-draft.html` — consensus mock simulator with format-aware tiers, VBD, strategy guardrails, and bounded scheme fit

After this branch is merged, the draft assistant will be available at:

`https://myleschopra-ai.github.io/fantasy-front-office/draft.html`

## Draft Assistant MVP

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

See `DRAFT_MVP.md` for the scope, calculation notes, limitations, and verification checklist.

See `docs/DRAFT_INTELLIGENCE.md` for ranking-source policy, strategy weights, coaching/play-call methodology, refresh behavior, and validation gates.
