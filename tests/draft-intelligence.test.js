'use strict';

const assert = require('node:assert/strict');
const D = require('../js/draft-intelligence.js');

for (const [name, strategy] of Object.entries(D.STRATEGIES)) {
  const total = Object.values(strategy.weights).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `${name} weights must sum to 1`);
  assert.ok(strategy.weights.scheme <= .08, `${name} scheme weight must remain a tiebreaker`);
  assert.ok(strategy.weights.pedigree <= .06, `${name} pedigree weight must remain a tiebreaker`);
  assert.ok(strategy.weights.ageCurve <= .06, `${name} ageCurve weight must remain a tiebreaker`);
}

const tierPlayers = [
  { name: 'A', position: 'WR', consensusScore: 97 },
  { name: 'B', position: 'WR', consensusScore: 96 },
  { name: 'C', position: 'WR', consensusScore: 95 },
  { name: 'D', position: 'WR', consensusScore: 82 },
  { name: 'E', position: 'WR', consensusScore: 81 }
];
D.assignTiers(tierPlayers);
assert.equal(tierPlayers[2].tierEnd, true, 'large score drop must close the tier');
assert.ok(tierPlayers[3].tier > tierPlayers[2].tier, 'player after cliff must enter a later tier');

const league = {
  league_type: 'redraft',
  scoring: { reception: .5 },
  roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2 }
};
const intelligence = { profiles: { redraft_1qb_half: { players: [] }, dynasty_superflex_half: { players: [] } } };
assert.equal(D.selectProfile(intelligence, league).id, 'redraft_1qb_half');

const commonContext = {
  strategy: 'adaptive',
  league,
  teams: 12,
  round: 2,
  poolSize: 250,
  survival: 25,
  picks: [{ name: 'Josh Allen', position: 'QB', posRank: 1, overallRank: 3, tier: 1, consensusScore: 98, schemeFit: { score: 88, confidence: 80 } }],
  counts: { QB: 1, RB: 0, WR: 0, TE: 0 },
  targets: D.starterTargets(league),
  superflex: false
};
const secondQB = { name: 'QB Two', position: 'QB', overallRank: 8, posRank: 2, tier: 1, consensusScore: 97, sourceCount: 3, agreement: 90, schemeFit: { score: 80, confidence: 75 } };
const startingRB = { name: 'RB One', position: 'RB', overallRank: 18, posRank: 8, tier: 2, consensusScore: 91, sourceCount: 3, agreement: 86, schemeFit: { score: 62, confidence: 75 } };
assert.ok(
  D.scorePlayer(startingRB, commonContext).score > D.scorePlayer(secondQB, commonContext).score,
  'an already-filled elite QB slot must not outrank an open RB starter merely on overall rank'
);

const zeroEarly = D.scorePlayer(startingRB, { ...commonContext, strategy: 'zero-rb', round: 3, counts: { QB: 0, RB: 0, WR: 2, TE: 0 }, picks: [] });
const zeroCatchup = D.scorePlayer(startingRB, { ...commonContext, strategy: 'zero-rb', round: 7, counts: { QB: 1, RB: 0, WR: 4, TE: 1 }, picks: [] });
assert.ok(zeroCatchup.score > zeroEarly.score, 'Zero RB must turn back toward RB after the early-round window');

const sfLeague = { ...league, roster: { ...league.roster, SUPER_FLEX: 1 } };
assert.equal(D.strategyCompatibility('late-qb', sfLeague).viable, false, 'Late QB must warn in Superflex');

// Round-dependent weight blending: real draft methodology should shift from
// pure value (early) toward need/situational factors (late), not stay static.
const baseWeights = D.STRATEGIES.adaptive.weights;
const earlyRoundWeights = D.roundAdjustedWeights(baseWeights, 1, 16);
const lateRoundWeights = D.roundAdjustedWeights(baseWeights, 16, 16);
const earlySum = Object.values(earlyRoundWeights).reduce((sum, value) => sum + value, 0);
const lateSum = Object.values(lateRoundWeights).reduce((sum, value) => sum + value, 0);
assert.ok(Math.abs(earlySum - 1) < 1e-9, 'round-adjusted weights must sum to 1 at round 1');
assert.ok(Math.abs(lateSum - 1) < 1e-9, 'round-adjusted weights must sum to 1 at the final round');
assert.ok(
  lateRoundWeights.need > earlyRoundWeights.need,
  'need weight must increase in later rounds',
);
assert.ok(
  lateRoundWeights.market < earlyRoundWeights.market,
  'market weight must decrease in later rounds',
);

// PHASE 1: Player Grade must be provably stable with respect to my own
// roster — this is the exact litmus test from the architecture spec.
// "Joe Burrow does not become a worse quarterback because I already
// drafted Lamar Jackson." Player Grade must not move; Pick Utility must.
const burrow = { name: 'Joe Burrow', position: 'QB', overallRank: 6, posRank: 3, tier: 1, consensusScore: 96, sourceCount: 4, agreement: 92, schemeFit: { score: 85, confidence: 80 }, adp: 22 };
const emptyRosterContext = { ...league, teams: 12, round: 4, totalRounds: 16, counts: { QB: 0, RB: 1, WR: 1, TE: 0 }, targets: D.starterTargets(league), superflex: false, poolSize: 250, survival: 50 };
const filledQBContext = { ...emptyRosterContext, counts: { QB: 1, RB: 1, WR: 1, TE: 0 } };

const burrowBeforeLamar = D.scorePlayer(burrow, emptyRosterContext);
const burrowAfterLamar = D.scorePlayer(burrow, filledQBContext);

assert.equal(
  burrowBeforeLamar.playerGrade,
  burrowAfterLamar.playerGrade,
  'Player Grade must be identical regardless of my own roster state (Joe Burrow test)',
);
assert.ok(
  burrowAfterLamar.pickUtility < burrowBeforeLamar.pickUtility,
  'Pick Utility must drop once the QB slot is already filled, even though Player Grade does not',
);

// Player Grade must also be independent of survival/availability (draft-state,
// not player-intrinsic) and of which strategy is active.
const burrowLowSurvival = D.scorePlayer(burrow, { ...emptyRosterContext, survival: 5 });
const burrowHighSurvival = D.scorePlayer(burrow, { ...emptyRosterContext, survival: 95 });
assert.equal(
  burrowLowSurvival.playerGrade,
  burrowHighSurvival.playerGrade,
  'Player Grade must not depend on survival probability',
);

// League Value must react to league settings even though Player Grade does not.
const oneQBLeague = { ...league, roster: { ...league.roster, SUPER_FLEX: 0 } };
const superflexLeague = { ...league, roster: { ...league.roster, SUPER_FLEX: 1 } };
const oneQBContext = { ...emptyRosterContext, league: oneQBLeague, targets: D.starterTargets(oneQBLeague), superflex: false };
const superflexContext = { ...emptyRosterContext, league: superflexLeague, targets: D.starterTargets(superflexLeague), superflex: true };
const burrowOneQB = D.scorePlayer(burrow, oneQBContext);
const burrowSuperflex = D.scorePlayer(burrow, superflexContext);
assert.equal(
  burrowOneQB.playerGrade,
  burrowSuperflex.playerGrade,
  'Player Grade must not depend on league format',
);
assert.ok(
  burrowSuperflex.leagueValue > burrowOneQB.leagueValue,
  'League Value must be higher for a QB in Superflex than 1QB, even though Player Grade is unchanged',
);

// Market Value must reflect ADP specifically, distinct from Player Grade.
const earlyADP = { ...burrow, adp: 3 };
const lateADP = { ...burrow, adp: 60 };
assert.ok(
  D.marketValueScore(earlyADP, emptyRosterContext) > D.marketValueScore(lateADP, emptyRosterContext),
  'Market Value must be higher for an earlier ADP',
);
assert.equal(
  D.playerGrade(earlyADP),
  D.playerGrade(lateADP),
  'Player Grade must not be affected by ADP alone (ADP is Market Value, not quality)',
);

// PHASE 1 (continued): Dynamic Roster Need via the real optimal-lineup
// engine, not a flat count-vs-target heuristic. These are the exact
// regression scenarios required: 1QB QB redundancy, and the Superflex
// counter-test proving demand suppression is NOT incorrectly applied
// when a second QB-eligible slot exists. Generic mechanism — no player
// is special-cased by name.
const oneQBRosterLeague = { roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, BENCH: 6 } };
const superflexRosterLeague = { roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, SUPER_FLEX: 1, BENCH: 6 } };

const firstQB = { name: 'Elite QB One', position: 'QB', overallRank: 5, posRank: 1, tier: 1, consensusScore: 97, adp: 5 };
const secondEliteQB = { name: 'Elite QB Two', position: 'QB', overallRank: 9, posRank: 2, tier: 1, consensusScore: 95, adp: 9 };
const openStarterRB = { name: 'Open RB', position: 'RB', overallRank: 20, posRank: 10, tier: 2, consensusScore: 88, adp: 20 };

const rosterWithOneQB = [firstQB];

// 1QB: after drafting an elite QB, a second elite QB must retain a high
// Player Grade (intrinsic quality, generic mechanism proves this) but
// receive a sharply lower need score than an open RB starter slot.
const secondQBNeed1QB = D.scorePlayer(secondEliteQB, {
  league: oneQBRosterLeague, teams: 12, round: 3, totalRounds: 16,
  picks: rosterWithOneQB, counts: D.rosterCounts(rosterWithOneQB),
  targets: D.starterTargets(oneQBRosterLeague), superflex: false, poolSize: 250, survival: 50,
});
const openRBNeed1QB = D.scorePlayer(openStarterRB, {
  league: oneQBRosterLeague, teams: 12, round: 3, totalRounds: 16,
  picks: rosterWithOneQB, counts: D.rosterCounts(rosterWithOneQB),
  targets: D.starterTargets(oneQBRosterLeague), superflex: false, poolSize: 250, survival: 50,
});
assert.ok(
  secondQBNeed1QB.playerGrade > 70,
  '1QB: second elite QB must retain a high Player Grade even though he cannot start',
);
assert.ok(
  secondQBNeed1QB.components.need < openRBNeed1QB.components.need,
  '1QB: second elite QB need score must be well below an open RB starter slot',
);
assert.ok(
  secondQBNeed1QB.pickUtility < openRBNeed1QB.pickUtility,
  '1QB: second elite QB Pick Utility must be lower than filling an open starter slot',
);

// Superflex counter-test: the same second elite QB, same roster, but a
// SUPER_FLEX slot exists — demand suppression must NOT apply the same way.
const secondQBNeedSuperflex = D.scorePlayer(secondEliteQB, {
  league: superflexRosterLeague, teams: 12, round: 3, totalRounds: 16,
  picks: rosterWithOneQB, counts: D.rosterCounts(rosterWithOneQB),
  targets: D.starterTargets(superflexRosterLeague), superflex: true, poolSize: 250, survival: 50,
});
assert.ok(
  secondQBNeedSuperflex.components.need > secondQBNeed1QB.components.need,
  'Superflex: second elite QB need score must be materially higher than in 1QB',
);
assert.equal(
  secondQBNeedSuperflex.playerGrade,
  secondQBNeed1QB.playerGrade,
  'Player Grade must be identical for the same player regardless of league format',
);

// FLEX eligibility: optimalLineup must correctly seat an RB/WR/TE in FLEX
// but never seat a QB/K/DST in FLEX unless the slot explicitly allows it.
const flexTestLeague = { roster: { QB: 1, RB: 1, WR: 1, TE: 1, FLEX: 1, BENCH: 4 } };
const flexTestRoster = [
  { name: 'Starting QB', position: 'QB', overallRank: 10, consensusScore: 90 },
  { name: 'Starting RB', position: 'RB', overallRank: 15, consensusScore: 85 },
  { name: 'Starting WR', position: 'WR', overallRank: 12, consensusScore: 88 },
  { name: 'Starting TE', position: 'TE', overallRank: 40, consensusScore: 70 },
  { name: 'Second RB', position: 'RB', overallRank: 25, consensusScore: 80 },
];
const flexLineup = D.optimalLineup(flexTestRoster, flexTestLeague);
const flexSlot = flexLineup.starters.find((s) => s.slot === 'FLEX');
assert.ok(
  flexSlot.player && ['RB', 'WR', 'TE'].includes(flexSlot.player.position),
  'FLEX slot must be filled by an RB/WR/TE-eligible player',
);
assert.equal(flexSlot.player.name, 'Second RB', 'FLEX must seat the best remaining eligible player (Second RB), not a bench-only leftover');

// K/DST: must be represented as real starter slots with real replacement demand.
const kdstLeague = { roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 } };
const kdstTargets = D.starterTargets(kdstLeague);
assert.equal(kdstTargets.K, 1, 'starterTargets must represent a real K starter demand');
assert.equal(kdstTargets.DST, 1, 'starterTargets must represent a real DST starter demand');
const kdstRoster = [];
const kicker = { name: 'Test Kicker', position: 'K', overallRank: 180, consensusScore: 30 };
const kickerLineup = D.optimalLineup([...kdstRoster, kicker], kdstLeague);
assert.ok(
  kickerLineup.starters.some((s) => s.slot === 'K' && s.player === kicker),
  'K must be assignable to a real K starter slot',
);

// VORP: replacement level must be derived from real projected points and
// respond to league size/format, not a universal hardcoded rank.
const vorpPool = [
  ...Array.from({ length: 35 }, (_v, i) => ({
    key: `qb${i + 1}`,
    position: 'QB',
    projectedPoints: 400 - i * 5,
  })),
  { key: 'rb1', position: 'RB', projectedPoints: 290 },
  { key: 'rb2', position: 'RB', projectedPoints: 240 },
  { key: 'rb3', position: 'RB', projectedPoints: 190 },
];
const smallLeague = { teams: 8, league: { roster: { QB: 1, RB: 2, WR: 2, TE: 1 } }, targets: D.starterTargets({ roster: { QB: 1, RB: 2, WR: 2, TE: 1 } }) };
const bigSuperflexLeague = { teams: 14, league: { roster: { QB: 1, RB: 2, WR: 2, TE: 1, SUPER_FLEX: 1 } }, targets: D.starterTargets({ roster: { QB: 1, RB: 2, WR: 2, TE: 1, SUPER_FLEX: 1 } }) };
const replacementSmall = D.computeReplacementPoints(vorpPool, smallLeague);
const replacementBig = D.computeReplacementPoints(vorpPool, bigSuperflexLeague);
assert.ok(
  replacementBig.QB < replacementSmall.QB,
  'a bigger Superflex league must push QB replacement level deeper into the pool (lower points) than a small 1QB league',
);

const vbdPercentiles = D.computeVBDPercentiles(vorpPool, smallLeague);
assert.ok(
  vbdPercentiles.qb1 > vbdPercentiles.qb35,
  'the highest-projected QB must have a higher VBD percentile than the lowest',
);
assert.ok(
  vbdPercentiles.qb1 >= 0 && vbdPercentiles.qb1 <= 100,
  'VBD percentile must be normalized to 0-100',
);

// K/DST pool integration: must actually enter the draftable pool from a
// supplemental source when the primary (FantasyCalc) pool lacks them,
// with no duplicates, nullable ADP/points (never fabricated), real
// fallback valuation, retained provenance, and absence when disabled.
const livePoolNoKDST = [
  { key: 'wr1', position: 'WR', name: 'Test WR', overallRank: 10, consensusScore: 90 },
];
const intelKDST = [
  { name: 'Test Kicker', position: 'K', overall_rank: 190, sleeper_id: 'k-1' },
  { name: '49ers', position: 'DST', overall_rank: 195, sleeper_id: 'dst-1' },
  { name: 'Another WR', position: 'WR', overall_rank: 50, sleeper_id: 'wr-99' }, // must NOT duplicate — WR already in live pool
];
const kdstEnabledLeague = { roster: { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 } };
const kdstDisabledLeague = { roster: { QB: 1, RB: 2, WR: 2, TE: 1 } };

const mergedEnabled = D.mergeSupplementalPositions(livePoolNoKDST, intelKDST, kdstEnabledLeague);
const mergedDisabled = D.mergeSupplementalPositions(livePoolNoKDST, intelKDST, kdstDisabledLeague);

assert.ok(
  mergedEnabled.some((p) => p.position === 'K' && p.name === 'Test Kicker'),
  'K must actually enter the pool when the league starts a kicker',
);
assert.ok(
  mergedEnabled.some((p) => p.position === 'DST' && p.name === '49ers'),
  'DST must actually enter the pool when the league starts a defense',
);
assert.equal(
  mergedEnabled.filter((p) => p.position === 'WR').length,
  1,
  'must not duplicate WR — the live pool already has it, supplemental WR must be skipped',
);
assert.equal(
  mergedDisabled.filter((p) => p.position === 'K' || p.position === 'DST').length,
  0,
  'K/DST must be entirely absent when the league configuration does not start them',
);
const mergedKicker = mergedEnabled.find((p) => p.position === 'K');
assert.equal(mergedKicker.adp, null, 'ADP must be null when unavailable, never fabricated');
assert.equal(mergedKicker.projectedPoints, null, 'projected points must be null when unavailable, never fabricated');
assert.equal(mergedKicker.source, 'supplemental', 'provenance must be retained');
assert.ok(mergedKicker.value < 50, 'K fallback valuation must reflect real late-round draft value, not an arbitrary high number');
assert.equal(mergedKicker.key, 'k-1', 'canonical ID must use the real sleeper_id when available');

// K/DST must be selectable in the actual optimal lineup once merged in.
const kdstLineupTest = D.optimalLineup([...livePoolNoKDST, mergedKicker], kdstEnabledLeague);
assert.ok(
  kdstLineupTest.starters.some((s) => s.slot === 'K' && s.player === mergedKicker),
  'merged K must be selectable into a real starting lineup slot',
);

console.log('draft-intelligence.js tests passed');
