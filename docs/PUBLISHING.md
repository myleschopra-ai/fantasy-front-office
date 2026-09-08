# Publishing and source locations

## One maintained application

- Source: https://github.com/myleschopra-ai/fantasy-front-office
- Live dashboard: https://myleschopra-ai.github.io/fantasy-front-office/
- Production source branch: `main`.

All maintained pages, JavaScript, CSS, data builders, tests, documentation, and compact published data belong in this repository. GitHub Pages serves the static application. GitHub Actions runs the existing scheduled data collectors/builders; using the dashboard does not require a laptop server. The optional Yahoo OAuth adapter is a separate service, as documented in `YAHOO_RENDER_DEPLOYMENT.md`.

Local clones and Codex previews are working copies, never alternate production sites. Keep links relative within the application so every route works beneath the GitHub Pages project path. Do not link to a developer drive, local server, or visualization folder from a finished artifact.

## September 2026 consolidation

The `trade-intelligence-current` working copy was on `codex/repair-decision-pages` at `1664e7d`. Its committed changes had reached PR #51 but had not reached the published `main` branch. One further draft-value precision and consensus-weight correction existed only in that working copy.

The published consolidation reconciles the Trade Intelligence board/package view, Matchup page, dashboard data retry behavior, and their regression tests with current `main`, retaining the newer automated data refreshes. It retains the existing multi-file application structure; this is not the separate DynastyHQ single-file rebuild described in an earlier brief.

The draft evidence/layout/reload changes remain on `codex/repair-decision-pages` in PR #51. The previously uncommitted draft correction is preserved in `archive/2026-09-draft-local-correction.patch`. With the refreshed data, that experimental draft correction still failed the unchanged strict gate (1QB top-24 overlap 19/24, minimum 20). These unfinished draft changes are not promoted by the consolidation release. The production draft engine and its validation thresholds are unchanged.

Older completed draft work at `8f50882` and mobile controls at `2da0b2f` are already ancestors of production `main`. The older uncommitted timed-auction prototype is preserved as `archive/2026-08-timed-auction-prototype.patch`, rather than overwriting newer auction code. See the archive README for recovery instructions.

Local raw downloads, validation caches, and browser artifacts are not application dependencies. The older player-data session handoff is superseded by `PLAYER_DATA_PROJECTION_PIPELINE.md` and the current data workflows; its historical local status is not a current release checklist. Local source copies are preserved for recovery.

## Release workflow

1. Start from current `origin/main` in a feature branch or isolated worktree. Read existing changes and recover intended unpublished work without replacing newer data.
2. Commit maintained source, runtime assets, relevant tests, documentation, and compact validated datasets. Keep raw downloads, secrets, private browser state, dependencies, and temporary artifacts out of Git.
3. Run relevant contracts, browser journeys, and `git diff --check`. `tests/repository-delivery.test.js` checks that static page dependencies and navigation resolve to tracked repository assets.
4. Push the reviewed branch and use the existing pull request when continuing a release. Check every triggered workflow, including live draft validation when applicable, before merging.
5. After merge, verify the GitHub Pages deployment and open Dashboard, Trade Intelligence, Matchup, Draft, and Auction on desktop and mobile. Compare deployed assets with the merged source. A pushed branch alone is not a published release.
6. Deliver the live URL and a precise account of passed checks and remaining limitations.

## Browser state

League selections and draft/session preferences are saved per browser origin. State from an older file preview is not automatically available at the published HTTPS address. Reconnect the league or use an existing supported session import/export when moving browsers. Never publish personal browser state as repository data.

## Running a development preview

From a checkout, run `python -m http.server 4185` and open `http://127.0.0.1:4185/`. This is a development check only; finished links must use the published site above.
