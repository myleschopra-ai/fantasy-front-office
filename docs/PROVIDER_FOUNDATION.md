# Provider integration boundary

Fantasy Front Office uses a read-only normalized provider contract. `js/provider-contract.js` accepts explicitly exported league/draft JSON, strips provider-specific shape, rejects token/cookie/secret fields, and never submits picks or roster changes.

## Current support

- Sleeper: live read-only draft discovery and reconciliation are production-tested.
- Yahoo: the OAuth server adapter exists, but production activation remains gated on Yahoo application approval, HTTPS, and durable server-side sessions. Secrets never belong in GitHub Pages or browser storage.
- ESPN: manual JSON normalization is available as a safe foundation. Authenticated live sync is not labeled production-ready because ESPN does not provide a supported public fantasy API/OAuth contract for this browser deployment. Do not paste `espn_s2`, `SWID`, cookies, or passwords into the app.

The provider contract is intentionally narrow: league settings and confirmed draft results in; no write operations out. A future server adapter must return this same normalized shape and pass the provider contract tests before activation.
