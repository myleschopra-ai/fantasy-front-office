# Fantasy Front Office

## Canonical delivery

- Source repository: https://github.com/myleschopra-ai/fantasy-front-office
- Published application: https://myleschopra-ai.github.io/fantasy-front-office/
- Keep application source, runtime assets, compact publishable data, tests, and maintained documentation in this repository.
- Local checkouts, worktrees, and visualization folders are development copies. A local file URL is not a finished delivery.
- For authorized publication, finish the pull request, check CI, merge to `main`, and verify the deployed Pages routes. Report the published URL and distinguish local checks from deployed checks.
- Preserve older worktrees and user changes. Reconcile changes with current `main`; never overwrite newer source or data with an entire older folder.
- Never commit secrets, raw provider downloads, browser storage exports, dependency folders, or temporary test artifacts. Run data collection in the repository's GitHub Actions workflows for production refreshes.

## Verification and integrity

- Run all `tests/*.test.js` with Node after source changes and `python -m unittest discover -s tests` after Python changes.
- Run `node tests/repository-delivery.test.js` and `git diff --check` before publication.
- Browser checks: `tests/dashboard-tabs-e2e.mjs`, `tests/roster-engine-browser-e2e.cjs`, and `tests/decision-pages-e2e.mjs` against a local HTTP server. CI installs pinned Playwright; preserve desktop, iPhone, and iPad coverage.
- Run the draft/session/live validation workflows for changes to their engines. Do not weaken validation gates to publish.
- Keep unknown values and projections visibly unavailable. Market value, modeled production, and observed performance are distinct evidence.
- Preserve the existing design, league selection, draft/session logic, and iOS safe areas.

See `docs/PUBLISHING.md` for the release and location contract.
