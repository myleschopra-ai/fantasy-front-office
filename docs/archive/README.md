# Recovered local source

These historical patches preserve source that previously existed only in local working copies. They are not loaded by the published application and are not release-ready changes.

| Patch | Base commit | Contents / status |
| --- | --- | --- |
| `2026-08-timed-auction-prototype.patch` | `bdddaea2b2a93c2c6492e1c8f263102630bc8102` | Six uncommitted auction source, styling, and test changes from the older `fantasy-quality` prototype. Production has subsequent auction improvements; do not apply this over current `main`. |
| `2026-09-draft-local-correction.patch` | `1664e7d2a4a54fda32803d7f6a12a7af9d84207e` | Previously uncommitted draft consensus-weight and precision correction. The strict ranking gate still fails with the newer data: 1QB top-24 overlap 19/24, minimum 20. PR #51 contains the preceding draft work. |

To inspect a recovered version, create a separate worktree at the listed base commit, then run `git apply --check` followed by `git apply` against an absolute path to the relevant patch. Do not apply historical patches to the production checkout.

The originals remain untouched. Temporary browser screenshots, dependency caches, raw provider downloads, and local test-server logs are excluded. Maintained tests and compact published data remain in the normal repository directories. The older player-data session handoff is superseded by the maintained pipeline documentation.
