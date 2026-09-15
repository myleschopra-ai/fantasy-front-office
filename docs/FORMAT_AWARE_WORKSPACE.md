# Format-aware workspace: audit and implementation plan

## Source audit (8 September 2026)

The supplied brief describes DynastyHQ, but the actual source is Fantasy Front Office. The entire 3,173-line index was reviewed. It combines connection state, seven view renderers, inline styles and dormant draft simulation code. Shared files provide the navigation shell, registry switcher, roster model, and separate draft tools. The recovered trade and matchup pages are already published through GitHub.

Format assumptions in the existing index: a fixed dynasty/2QB/12-team FantasyCalc URL; repeated QB2/RB3/WR3/TE1 depth thresholds; offensive-only position lists; three future pick years with fabricated fallback prices; three-round/five-round limits; default FAAB100, playoff start15, six playoff teams; 1,500 simulations using proxy strength without the remaining actual schedule. Several market sums coerce missing values to zero. Season projections can enter a weekly field. Transaction history collects trades only and assumes failed requests mean empty history. League loads can race and commit mixed state. Name-only projection joins can override a conflicting ID.

Dormant code: initDraftCenter and its mock-board callbacks are no longer called; renderEmbeddedDraft uses the maintained draft.html tool instead. Retain those older routines during this bounded release, rather than changing the protected draft implementation. The new workspace does not use their assumptions or estimated pick prices.

iOS risks: narrow tables, 14px editable controls, hover-only evidence, competing header selectors, and storage exceptions. New controls use 16px text and 44px targets, flexible cards, keyboard tabs, tap-accessible provenance, safe-area padding, and guarded storage.

## Plan and data flow

Partender + NFL state -> discovered leagues -> selected league -> immutable format
-> cached player database + format-keyed market feed -> ID-safe player universe
-> rosters / users / transactions / trends / matchups / drafts / traded picks
-> power | trades | waivers | lineup | playoffs | draft capital
-> source-aware renderers -> shared site route + self-contained HTML export.

Implement pure functions separately for meaningful tests; generate a single HTML containing the exact tested engine, service, UI and existing design styles. The HTML needs no runtime build step. Link this workspace prominently from the existing site and shared navigation; retain existing draft/session and manual snapshot workflows. League switches commit a complete snapshot atomically and suppress superseded requests. Cache players and market values for 24 hours; other feeds have short TTLs. A shared queue caps requests at four concurrent and five starts per second, including retries.

## Risks and boundaries

- FantasyCalc does not expose custom PPR, TE premium, best-ball or IDP pricing parameters. Show the closest supported base market and each mismatch; never invent a premium. Keeper uses redraft base values with an explicit limitation.
- DynastyProcess is a whole-board dynasty fallback, not a selective overlay. Its scale must never be combined with FantasyCalc. Ambiguous normalized joins remain unmatched.
- Weekly projections are an undocumented Sleeper endpoint, behind a visible feature flag. A direct live response confirmed reachability, so new settings attempt it automatically. Score only supported returned statistics with the league's scoring rules; unsupported rules or incomplete coverage force value-only optimization. No season totals in weekly points.
- Playoff simulation needs a complete actual remaining schedule, aligned completed records and enough completed scoring observations to estimate variation. Division seeding and unsupported playoff rules are unavailable. Monte Carlo is a disclosed model, not calibrated transaction accuracy. Conditional win/loss odds indicate leverage, not mathematical elimination.
- Transaction tendencies describe observed events. Historical market prices are absent, so pick overpayment cannot be inferred from today's prices. Early RB sales mean completed trades in weeks 1-4, not a judgment about a player's career timing.
- Pick ownership comes from drafts and traded picks. Future base allotments use explicit league draft rounds and are labeled rule-derived entitlements. Unpriced rounds stay unavailable. No invented future slot or price.
- No automatic trades, lineup submissions, external messages, new production dependencies, draft weight changes, or historical predictive claims. These are outside the request or lack supporting evidence.

## Primary endpoint references

[Sleeper API](https://docs.sleeper.com/) documents the read-only league, player, transaction, matchup and draft endpoints. [DynastyProcess data](https://github.com/dynastyprocess/data) publishes the fallback CSV. FantasyCalc's public current-values endpoint is verified against a live response, but is not treated as a versioned API contract.

Verification, module changelog, live evidence and remaining limitations are recorded with the release after implementation.
