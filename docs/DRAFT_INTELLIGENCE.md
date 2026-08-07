# Draft Intelligence Pipeline

The mock-draft room now combines format-specific consensus rankings, overall and positional ranks, data-derived position tiers, value over replacement, roster construction, room simulation, strategy guardrails, and a bounded scheme-fit signal.

## Data collection policy

Use documented APIs and public release data before HTML extraction. Do not bypass logins, rate limits, robots controls, or paywalls, and do not republish proprietary source payloads.

| Input | Access | Used for | Failure behavior |
|---|---|---|---|
| [FantasyCalc](https://fantasycalc.com/) | Public JSON endpoint | Format-aware market rank, value, team, Sleeper ID | Continue with other sources and the last verified snapshot |
| [Fantasy Football Calculator ADP API](https://help.fantasyfootballcalculator.com/article/42-adp-rest-api) | Documented public API | Standard, half-PPR, and PPR ADP | Exclude that source; never fabricate a rank |
| [nflreadpy fantasy rankings](https://nflreadpy.nflverse.com/api/load_functions/#nflreadpy.load_ff_rankings) | Open release-data loader | FantasyPros-derived redraft, Superflex, and dynasty ECR | Exclude that source; retain rank provenance |
| Repository FantasyPros snapshot | Existing authenticated refresh | Positional rank/tier fallback | Use only when present and valid |
| [nflverse play-by-play and rosters](https://nflreadpy.nflverse.com/api/load_functions/) | Open release data | Play calling, efficiency, opportunity shares, player usage archetypes | Scheme becomes unrated; ranking model still works |
| Official club coaching directories | Public official pages | Current HC, OC, and QB/RB/WR/TE/OL coaches | Fall back to reviewed seed and lower confidence |

The builder filters the combined FantasyPros release by format before rank fusion. In particular, redraft, Superflex, dynasty, best-ball, rookie, IDP, and position pages are not allowed to leak into one another.

## Rank fusion and tiers

For each league profile, every available source rank is converted to a percentile and multiplied by its source weight. Available-source weights are renormalized per player, so a missing source does not silently count as a zero.

The output preserves:

- consensus overall rank;
- consensus position rank;
- source-specific ranks;
- source count and rank range;
- agreement/confidence;
- overall and position tiers;
- the score gap after each player and whether that gap closes a tier.

Position tiers use score-gap detection with median absolute deviation. They do not assume an arbitrary fixed number of players per tier.

Generated profiles:

- standard, half-PPR, and PPR redraft (1QB);
- half-PPR redraft Superflex;
- half-PPR dynasty (1QB and Superflex).

## Recommendation weights

All strategy weight rows sum to 100%. Scheme is capped at 7% in every profile and therefore cannot override market value, replacement value, a closing tier, or an unfilled starter slot.

| Strategy | Consensus | VBD | Tier | Need | Availability | Scheme | Strategy rule |
|---|---:|---:|---:|---:|---:|---:|---:|
| Adaptive VBD | 25% | 19% | 17% | 17% | 8% | 7% | 7% |
| Balanced BPA | 27% | 18% | 16% | 17% | 8% | 7% | 7% |
| Hero RB | 23% | 17% | 15% | 16% | 8% | 7% | 14% |
| Zero RB | 22% | 16% | 15% | 14% | 8% | 7% | 18% |
| Robust RB | 22% | 17% | 17% | 14% | 8% | 7% | 15% |
| Late-Round QB | 24% | 19% | 16% | 14% | 8% | 7% | 12% |
| Early QB / Superflex | 22% | 19% | 16% | 15% | 8% | 7% | 13% |
| Elite TE | 22% | 19% | 18% | 14% | 8% | 7% | 12% |

VBD compares a player with the format-specific replacement slot implied by teams, starters, FLEX, and Superflex. Live need penalizes duplicate premium QB and TE selections in 1QB formats. Availability comes from CPU room simulations and answers whether a player is likely to survive to the manager's next turn.

## Strategy guardrails

The strategy selector changes a bounded component; it does not force a position regardless of price.

- **Adaptive VBD:** follows market, VBD, and tier cliffs while adapting to the room.
- **Hero RB:** secures one premium RB, builds WR/FLEX strength, then attacks contingent and receiving RB depth.
- **Zero RB:** emphasizes WR/FLEX and elite-TE value early. Guardrails require a first RB by roughly Round 7 and rapid RB volume through Round 10. This follows the practical constraints in [Underdog's Zero RB research](https://underdognetwork.com/football/best-ball-research/dont-be-dumb-when-you-draft-a-zero-rb-team-in-2025).
- **Robust RB:** permits early RB volume only when the backs remain in the same value tier as alternatives, then stops after the allocation is filled.
- **Late-Round QB:** applies only to 1QB. Superflex produces an explicit incompatibility warning.
- **Early QB / Superflex:** prioritizes viable starting QBs in Superflex. In 1QB, it requires elite-tier value and strongly penalizes a duplicate starter.
- **Elite TE:** pays for a Tier 1 difference-maker, not the flat middle of the position.

The VBD implementation follows the distinction among replacement, next-available, and last-starter baselines described by [FantasyPros](https://www.fantasypros.com/2026/06/fantasy-football-draft-strategy-value-based-drafting-2026/) and [Subvertadown](https://subvertadown.com/article/guide-to-understanding-the-different-baselines-in-value-based-drafting-vbd-vols-vs-vorp-vs-man-games-and-beer-).

## Coaching, play calling, and scheme fit

Team context uses two weighted seasons of regular-season play-by-play, with the most recent season receiving more weight. The snapshot includes:

- plays per game;
- neutral-situation pass rate and pass rate over expected;
- pass/rush EPA per play and success rate;
- red-zone pass/rush tendency;
- explosive pass/rush rate;
- QB designed-run rate;
- RB rush and target shares;
- WR and TE target/red-zone shares.

Player usage produces transparent archetypes such as dual-threat QB, vertical passer, receiving back, goal-line runner, vertical target, and red-zone target. Position fit is 82% team position environment and 18% player-archetype compatibility.

Official club cards resolve HC, OC, and the primary position coach. The interface describes the position coach and the unit environment; it does **not** claim that an assistant caused the team's statistics. A new HC/OC lowers confidence and shrinks old-team tendencies toward neutral because current-season evidence does not yet exist.

## Refresh and validation

`scripts/build_draft_intelligence.py` writes `data/draft_intelligence.json` atomically. The scheduled workflow runs twice weekly from May through September and monthly otherwise.

The publish step fails closed unless:

- all six league profiles exist;
- each profile has at least 120 players and two ranking sources;
- at least 100 of the top 120 players have multi-source coverage;
- ranks are unique, contiguous, and position-valid;
- all player and team scheme scores are within 0–100;
- at least 28 team profiles exist and 24 official staffs verify;
- the snapshot is no more than seven days old;
- suspicious staff parses such as headlines or page titles are absent.

The browser can still use the live FantasyCalc market if a verified snapshot is temporarily unavailable, and it labels that condition as a single-source fallback.

## Commands

```bash
python scripts/build_draft_intelligence.py --season 2026 --teams 12
python scripts/validate_draft_intelligence.py data/draft_intelligence.json
node tests/draft-intelligence.test.js
python -m unittest tests/test_build_draft_intelligence.py
```
