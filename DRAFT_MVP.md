# Draft Assistant MVP

## Objective

Provide a mobile-friendly, read-only live draft assistant that reduces a Sleeper rookie draft to the highest-value current decision while preserving user approval for the actual pick.

## Implemented capabilities

1. Import a Sleeper league by league ID.
2. Select the user's roster and one of the league's Sleeper drafts.
3. Import the draft's live pick history.
4. Remove drafted players from the available-player board automatically.
5. Load the Sleeper NFL player directory and FantasyCalc dynasty values.
6. Default to a rookie-only board with QB, RB, WR, and TE filters.
7. Search the remaining player pool by name.
8. Maintain a persistent player queue in browser local storage.
9. Calculate a transparent roster-needs score from current positional depth.
10. Generate a best-available recommendation from dynasty value, roster fit, liquidity, and risk heuristics.
11. Estimate whether the recommended player will remain available at the user's next selection.
12. Show the user's next-turn distance when Sleeper draft-order data is available.
13. Refresh live draft picks every 30 seconds while the draft status is `drafting`.
14. Preserve a local recommendation ledger with timestamp, pick number, player, value, fit, and score.
15. Provide an iPhone/iPad-friendly single-column layout at narrow viewports.
16. Keep the workflow read-only. The assistant never submits a Sleeper draft pick.

## Recommendation calculation

The MVP recommendation is an explicitly labeled heuristic, not a validated predictive model.

The player score combines:

- 55% normalized dynasty market value
- 25% current roster-need score
- 15% position-based liquidity estimate
- 5% inverse risk estimate

These weights are intentionally centralized in `draft.html` and should not be called validated until historical replay demonstrates improvement over a best-available-market-value baseline.

## Persistence

The page stores the following locally in the browser:

- last league ID
- selected roster ID
- selected draft ID
- player queue
- recommendation log

No credentials or private tokens are stored.

## Known limitations

- The MVP is a standalone GitHub Pages route at `draft.html`; the existing `index.html` already contains an earlier Draft tab, but this implementation is isolated to avoid destabilizing the current single-file dashboard during initial verification.
- Player availability is a heuristic rather than a calibrated manager-specific model.
- Incoming college prospects cannot appear until they are present in the Sleeper NFL player directory and the configured market source.
- Roster-fit targets are generic dynasty-depth targets, not yet generated from the league's exact starting-slot configuration.
- The page does not yet calculate trade-up or trade-down packages.
- The recommendation log remains browser-local and is not yet exported to a warehouse.
- Draft ownership changes and traded draft slots depend on the draft-order data returned by Sleeper.
- Network failure falls back only to already-rendered data during the current session; a full offline snapshot is not yet implemented.

## Verification checklist

Before merging:

- [ ] Open `draft.html` directly from the branch or a local static server.
- [ ] Connect a valid Sleeper league.
- [ ] Confirm all rosters appear in the team selector.
- [ ] Confirm all league drafts appear in the draft selector.
- [ ] Open a draft and verify the pick history matches Sleeper.
- [ ] Confirm drafted players are absent from the available-player board.
- [ ] Confirm Rookie, QB, RB, WR, and TE filters work.
- [ ] Add and remove players from the persistent queue.
- [ ] Refresh the page and verify the queue remains.
- [ ] Log a recommendation and verify it appears in the recommendation ledger.
- [ ] Confirm the layout works at iPhone and iPad widths.
- [ ] Confirm no action submits or modifies a Sleeper draft.
- [ ] Confirm browser console contains no uncaught errors.

## Next implementation milestone

After the standalone route passes verification, integrate this engine into the existing `index.html` Draft tab and add:

1. Exact league-slot-based roster construction.
2. Tier cliffs and positional scarcity.
3. Trade-up and trade-down valuation.
4. Draft recommendation export.
5. Historical replay and calibration.
6. Automated browser tests.
