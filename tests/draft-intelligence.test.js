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

const vbdPercentilesIncomplete = D.computeVBDPercentiles(vorpPool, smallLeague);
assert.deepEqual(
  vbdPercentilesIncomplete,
  {},
  'partial projections that do not reach replacement level across QB/RB/WR/TE must fail closed instead of mixing true VORP with rank proxies',
);

// Draftable-player projection contract: top-50 coverage is never enough.
const completeProjectionPool = [];
for (const [position, count] of Object.entries({ QB: 32, RB: 72, WR: 84, TE: 32 })) {
  for (let index = 0; index < count; index += 1) {
    completeProjectionPool.push({
      key: `${position}-${index}`,
      name: `${position} Projection ${index}`,
      position,
      overallRank: completeProjectionPool.length + 1,
      projectedPoints: 350 - index,
      projectionSource: 'fantasypros_api',
    });
  }
}
const coverageContext = {
  teams: 12,
  league: { roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, BENCH: 6 } },
};
const completeCoverage = D.projectionCoverageContract(completeProjectionPool, coverageContext);
assert.equal(completeCoverage.complete, true, 'full positional depth must activate projected-points mode');
const shallowProjectionPool = completeProjectionPool.map((player, index) =>
  index < 50 ? player : { ...player, projectedPoints: null, projectionSource: null },
);
const shallowCoverage = D.projectionCoverageContract(shallowProjectionPool, coverageContext);
assert.equal(shallowCoverage.complete, false, 'top-50-only projections must fail the draftable-player contract');
assert.ok(shallowCoverage.depthBands.late.coverage < 0.95, 'late-round coverage must be measured explicitly');

const lateDiamond = {
  key: 'late-diamond', name: 'Late Diamond', position: 'WR', overallRank: 140,
  adp: 175, sourceRanks: { sourceA: 100, sourceB: 138, sourceC: 145 },
  sourceCount: 3, agreement: 80, projectedPoints: 175,
  projectionSource: 'fantasypros_api', projectionConfidence: 95,
  vbdPercentileScore: 70, schemeFit: { score: 70, confidence: 70 },
  pedigreeScore: 70, ageCurveScore: 70, tier: 7, consensusScore: 52,
};
const diamondProfile = D.lateRoundValueScore(lateDiamond, { teams: 12, round: 11, totalRounds: 16 });
assert.equal(diamondProfile.label, 'DIAMOND', 'a multi-source late value with projection and market discount must be identified');
const earlyDiamondScore = D.scorePlayer(lateDiamond, {
  ...coverageContext, round: 2, totalRounds: 16, poolSize: 250, survival: 50,
  picks: [], counts: {}, targets: D.starterTargets(coverageContext.league),
});
const lateDiamondScore = D.scorePlayer(lateDiamond, {
  ...coverageContext, round: 11, totalRounds: 16, poolSize: 250, survival: 50,
  picks: [], counts: {}, targets: D.starterTargets(coverageContext.league),
});
assert.ok(lateDiamondScore.diamondBonus > earlyDiamondScore.diamondBonus, 'diamond influence must rise late instead of causing an early reach');
assert.ok(lateDiamondScore.diamondBonus <= 6, 'diamond influence must remain bounded');

// Complete projection fixture: raw points-over-replacement must be comparable
// ACROSS positions, not re-normalized so every positional No. 1 equals 100.
const completeVorpPool = [];
for (const [position, top, step, count] of [
  ['QB', 360, 4, 24],
  ['RB', 300, 5, 30],
  ['WR', 285, 4, 30],
  ['TE', 230, 2, 20],
]) {
  for (let i = 0; i < count; i += 1) {
    completeVorpPool.push({
      key: `${position.toLowerCase()}-complete-${i + 1}`,
      position,
      projectedPoints: top - i * step,
    });
  }
}
const completeLeague = {
  teams: 8,
  league: { roster: { QB: 1, RB: 1, WR: 1, TE: 1 } },
  targets: D.starterTargets({ roster: { QB: 1, RB: 1, WR: 1, TE: 1 } }),
};
const completeVbd = D.computeVBDPercentiles(completeVorpPool, completeLeague);
assert.ok(
  Object.keys(completeVbd).length > 0,
  'complete replacement-level projection coverage must activate real projected-point VORP',
);
assert.ok(
  completeVbd['qb-complete-1'] !== completeVbd['te-complete-1'],
  'cross-position VORP must not force QB1 and TE1 to the same 100 score merely because each is first at his position',
);
assert.ok(
  completeVbd['qb-complete-1'] >= 0 && completeVbd['qb-complete-1'] <= 100,
  'global VORP percentile must remain normalized to 0-100',
);

// K/DST fallback VBD must never inherit a near-100 positional-rank score.
const earlyK = { key: 'early-k', name: 'Early K', position: 'K', overallRank: 70, posRank: 1, consensusScore: 72, tier: 1 };
const earlyKLeagueValue = D.leagueValueScore(earlyK, {
  league: kdstLeague, teams: 12, poolSize: 250, targets: kdstTargets,
});
assert.ok(
  earlyKLeagueValue <= 44,
  `K/DST league value must be capped below early-round skill-player territory; got ${earlyKLeagueValue}`,
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

// SCARCITY ENGINE — the three exact required regression scenarios.

// Build a realistic RB pool: 4 in tier 1 (premium), 6 in tier 2, matching a
// plausible draft-board shape so the test proves real behavior, not an
// artifact of a too-small fixture (the same mistake caught earlier).
function makeRBPool(tier1Count, tier2Count) {
  const pool = [];
  for (let i = 0; i < tier1Count; i += 1) {
    pool.push({ key: `rb-t1-${i}`, position: 'RB', name: `Premium RB ${i}`, overallRank: 5 + i, consensusScore: 95 - i, tier: 1 });
  }
  for (let i = 0; i < tier2Count; i += 1) {
    pool.push({ key: `rb-t2-${i}`, position: 'RB', name: `Solid RB ${i}`, overallRank: 20 + i, consensusScore: 75 - i, tier: 2 });
  }
  return pool;
}

// POSITION RUN: same premium RB, before and after several tier-1 RBs are
// removed from the pool (simulating a run) — scarcity must rise.
const fullRBPool = makeRBPool(4, 6);
const targetRB = fullRBPool[0]; // "Premium RB 0", stays in the pool both times
const scarcityBeforeRun = D.scarcityScore(targetRB, fullRBPool, { picksUntilNextTurn: 10 });

const afterRunPool = fullRBPool.filter((p) => p.key === 'rb-t1-0' || p.tier !== 1); // remove the other 3 tier-1 RBs
const scarcityAfterRun = D.scarcityScore(targetRB, afterRunPool, { picksUntilNextTurn: 10 });
assert.ok(
  scarcityAfterRun.scarcity > scarcityBeforeRun.scarcity,
  'POSITION RUN: removing several tier-1 RBs must raise scarcity for the remaining premium RB',
);
assert.ok(
  scarcityAfterRun.tierDepth < scarcityBeforeRun.tierDepth,
  'POSITION RUN: tier depth must actually decrease after the run',
);

// TIER CLIFF: same player, one tier-mate left vs. several remaining.
const onlyOneLeftPool = makeRBPool(1, 6);
const severalRemainPool = makeRBPool(5, 6);
const scarcityOneLeft = D.scarcityScore(onlyOneLeftPool[0], onlyOneLeftPool, { picksUntilNextTurn: 10 });
const scarcitySeveralLeft = D.scarcityScore(severalRemainPool[0], severalRemainPool, { picksUntilNextTurn: 10 });
assert.ok(
  scarcityOneLeft.scarcity > scarcitySeveralLeft.scarcity,
  'TIER CLIFF: being the last player in a strong tier must raise scarcity versus several tier-mates remaining',
);

// DEEP POSITION: many similarly-valued (same-tier) players remain — scarcity
// should stay low for any one of them.
const deepPool = makeRBPool(8, 6);
const deepScarcity = D.scarcityScore(deepPool[0], deepPool, { picksUntilNextTurn: 10 });
assert.ok(
  deepScarcity.scarcity < 40,
  'DEEP POSITION: scarcity must remain low when many comparable players remain at the position',
);

// ADP / WAIT-RISK — the three required regression scenarios. These test
// the categorization layer directly with an already-computed survival
// probability as input, since the real Monte Carlo survival simulation
// (which itself correctly incorporates ADP-driven CPU behavior and exact
// snake-turn distance) lives in the UI-coupled mock-draft-v4.js and isn't
// part of this pure-function test harness. What's validated here is the
// actual logic under test: given a survival signal, does the engine
// correctly decide whether to recommend taking now or waiting.

// MODEL LOVES / MARKET WAITS: strong model value, but market ADP suggests
// he'll likely still be there (high survival probability) — must NOT
// force an immediate TAKE_NOW.
const modelLovesMarketWaits = D.waitRiskCategory({
  survivalProbability: 80, playerValue: 85, scarcity: 30,
});
assert.notEqual(
  modelLovesMarketWaits.category, 'TAKE_NOW',
  'MODEL LOVES / MARKET WAITS: a high-value player with strong survival odds must not force TAKE_NOW',
);

// MARKET PRESSURE: identical intrinsic value, but market pressure drops
// survival probability — wait risk (and cost) must rise materially.
const marketPressure = D.waitRiskCategory({
  survivalProbability: 20, playerValue: 85, scarcity: 30,
});
assert.ok(
  marketPressure.waitCost > modelLovesMarketWaits.waitCost,
  'MARKET PRESSURE: lower survival probability for the same player value must raise wait cost',
);
assert.equal(marketPressure.category, 'TAKE_NOW', 'MARKET PRESSURE: sufficiently low survival must escalate to TAKE_NOW');

// TURN DISTANCE: the categorization layer must differentiate correctly
// when survival probability differs (which, in the live app, is exactly
// what a long vs. short snake-turn distance produces via the real
// simulation) — same player value, near-turn (low survival) vs.
// far-turn (high survival) must NOT produce the same recommendation.
const nearTurnDrafter = D.waitRiskCategory({ survivalProbability: 15, playerValue: 60, scarcity: 40 });
const farTurnDrafter = D.waitRiskCategory({ survivalProbability: 85, playerValue: 60, scarcity: 40 });
assert.notEqual(
  nearTurnDrafter.category, farTurnDrafter.category,
  'TURN DISTANCE: a near turn (low survival) and a far turn (high survival) must not produce the same recommendation for the same player',
);
assert.ok(
  nearTurnDrafter.waitCost > farTurnDrafter.waitCost,
  'TURN DISTANCE: a closer turn must carry higher wait cost than a distant one, same player',
);

// OPPONENT SIMULATION — deterministic seeded tests, since randomness is
// involved. Same seed must reproduce the same pick every time; bounded
// amplitude must not make an opponent choose an obviously worse player
// over a clearly superior one; scarcity must be able to tip a close
// decision.
const candidatesForChoice = [
  { player: { name: 'Best Player', overallRank: 1 }, score: 90, scarcity: 20 },
  { player: { name: 'Second Player', overallRank: 2 }, score: 70, scarcity: 20 },
  { player: { name: 'Third Player', overallRank: 3 }, score: 50, scarcity: 20 },
];

// REPRODUCIBILITY: same seed, same result, every time.
const seededPick1 = D.chooseBestCandidate(candidatesForChoice, {
  amplitude: 5, randomFn: D.seededRandom(42),
});
const seededPick2 = D.chooseBestCandidate(candidatesForChoice, {
  amplitude: 5, randomFn: D.seededRandom(42),
});
assert.equal(
  seededPick1.name, seededPick2.name,
  'OPPONENT SIMULATION: the same seed must produce the identical pick every time',
);

// BOUNDED RATIONALITY: with a low amplitude relative to a large score gap,
// the clearly-best player must win regardless of jitter — randomness must
// not make opponents behave irrationally.
let bestPlayerWinCount = 0;
for (let seed = 0; seed < 50; seed += 1) {
  const pick = D.chooseBestCandidate(candidatesForChoice, {
    amplitude: 5, randomFn: D.seededRandom(seed * 7919),
  });
  if (pick.name === 'Best Player') bestPlayerWinCount += 1;
}
assert.ok(
  bestPlayerWinCount >= 45,
  `OPPONENT SIMULATION: bounded randomness (amplitude 5 vs a 20-point score gap) must not make opponents choose an obviously worse player routinely — best player won only ${bestPlayerWinCount}/50`,
);

// SCARCITY INFLUENCE: a close score race, but one candidate is far more
// scarce — scarcity must be able to tip the decision toward it.
const closeRaceCandidates = [
  { player: { name: 'Close A', overallRank: 1 }, score: 70, scarcity: 10 },
  { player: { name: 'Close B (scarce)', overallRank: 2 }, score: 68, scarcity: 95 },
];
const scarcityTippedPick = D.chooseBestCandidate(closeRaceCandidates, {
  amplitude: 0, scarcityWeight: 0.3, randomFn: D.seededRandom(1),
});
assert.equal(
  scarcityTippedPick.name, 'Close B (scarce)',
  'OPPONENT SIMULATION: real scarcity must be able to tip a close decision, not just base score',
);

// OPPORTUNITY COST — reproduce the spec's own worked example precisely:
// "QB X has the higher intrinsic grade [than WR Y], but WR Y produces
// greater marginal starting-lineup value and the remaining QB tier is
// deeper." Fixture grades are deliberately ordered so QB X (94) cannot
// displace the incumbent starter (96) — he's genuinely bench-only, not
// a real upgrade — while still exceeding WR Y's grade (82).
const oppCostLeague = { roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, BENCH: 6 } };
const oppCostRoster = [
  { name: 'Incumbent Starting QB', position: 'QB', overallRank: 4, consensusScore: 96, tier: 1 },
  { name: 'Starting RB1', position: 'RB', overallRank: 12, consensusScore: 88, tier: 1 },
  { name: 'Starting RB2', position: 'RB', overallRank: 22, consensusScore: 80, tier: 2 },
  { name: 'Starting TE', position: 'TE', overallRank: 45, consensusScore: 68, tier: 2 },
  // WR slots (2 starters + 1 FLEX-eligible) intentionally left open.
];

const qbCandidate = { key: 'qb-x', name: 'QB X', position: 'QB', overallRank: 6, consensusScore: 94, tier: 1 };
const deepQBPool = Array.from({ length: 6 }, (_v, i) => ({
  key: `qb-depth-${i}`, name: `Depth QB ${i}`, position: 'QB', overallRank: 10 + i, consensusScore: 89 - i, tier: 1,
}));
const wrCandidate = { key: 'wr-y', name: 'WR Y', position: 'WR', overallRank: 25, consensusScore: 82, tier: 1 };
const scarceWRPool = [
  wrCandidate,
  { key: 'wr-depth-0', name: 'Depth WR', position: 'WR', overallRank: 60, consensusScore: 55, tier: 3 },
];
const fullAvailablePool = [qbCandidate, ...deepQBPool, ...scarceWRPool];
const oppCostContext = {
  picks: oppCostRoster, league: oppCostLeague, teams: 12, poolSize: 250, picksUntilNextTurn: 10,
};

assert.ok(
  D.playerGrade(qbCandidate) > D.playerGrade(wrCandidate),
  'setup check: QB X must genuinely have the higher intrinsic Player Grade for this test to be meaningful',
);
const qbOpportunityCost = D.opportunityCost(qbCandidate, fullAvailablePool, oppCostContext);
assert.equal(
  qbOpportunityCost.bestAlternativePosition, 'WR',
  'the best alternative to a bench-only QB with open WR slots must be a WR',
);
assert.ok(
  qbOpportunityCost.lineupImprovementForfeited,
  'must recognize that taking QB X forfeits a real starting-lineup improvement — WR Y would start, QB X would not',
);
assert.ok(
  qbOpportunityCost.opportunityCost >= 30,
  // Threshold calibrated against real inspected engine output (39 for this
  // exact fixture — verified directly: raw value gap -2.97, +25 lineup
  // improvement forfeited, +17 from real 85% scarcity), not picked
  // arbitrarily. 30 leaves real margin below the actual computed value
  // while still requiring a materially significant cost, not a token one.
  `taking QB X over WR Y must carry a real, material opportunity cost despite QB X's higher intrinsic grade — got ${qbOpportunityCost.opportunityCost}`,
);

// ---------------------------------------------------------------------
// POST-PICK RECALCULATION — integration test. Not a unit test of one
// function in isolation: this runs a real SEQUENCE of picks and verifies
// that every downstream system (available pool, roster counts, optimal
// lineup, need, scarcity, Pick Utility) correctly reflects updated state
// after each one, while Player Grade for the same watched candidate
// never moves — re-proving Phase 1 stability across a real sequence,
// not just a single before/after snapshot.
// ---------------------------------------------------------------------
const seqLeague = { roster: { QB: 1, RB: 2, WR: 2, TE: 1, BENCH: 6 } };
const seqTargets = D.starterTargets(seqLeague);

// A realistic pool: 2 tiers of WR/RB/QB so scarcity has something real to
// react to, plus the "watched" candidate whose treatment we track
// across the whole sequence.
const watchedWR = { key: 'watched-wr', name: 'Watched WR', position: 'WR', overallRank: 18, consensusScore: 84, tier: 1 };
let seqPool = [
  { key: 'seq-wr-1', name: 'Best WR', position: 'WR', overallRank: 8, consensusScore: 91, tier: 1 },
  watchedWR,
  { key: 'seq-wr-3', name: 'Third WR', position: 'WR', overallRank: 30, consensusScore: 74, tier: 2 },
  { key: 'seq-rb-1', name: 'Best RB', position: 'RB', overallRank: 5, consensusScore: 93, tier: 1 },
  { key: 'seq-rb-2', name: 'Second RB', position: 'RB', overallRank: 14, consensusScore: 86, tier: 1 },
  { key: 'seq-qb-1', name: 'Best QB', position: 'QB', overallRank: 10, consensusScore: 90, tier: 1 },
  { key: 'seq-qb-2', name: 'Second QB', position: 'QB', overallRank: 20, consensusScore: 83, tier: 1 },
];
let seqRoster = [];

function seqContext(picksUntilNextTurn) {
  return {
    league: seqLeague, teams: 12, round: seqRoster.length + 1, totalRounds: 16,
    picks: seqRoster, counts: D.rosterCounts(seqRoster), targets: seqTargets,
    superflex: false, poolSize: 250, survival: 50, picksUntilNextTurn,
  };
}

function draftInSequence(key) {
  const player = seqPool.find((p) => p.key === key);
  assert.ok(player, `test setup: player ${key} must exist in the sequence pool`);
  seqPool = seqPool.filter((p) => p.key !== key);
  seqRoster = [...seqRoster, player];
  return player;
}

// STEP 0 (before any picks): watched WR should show real starter-slot need.
const watchedGradeStep0 = D.playerGrade(watchedWR);
const watchedStep0 = D.scorePlayer(watchedWR, seqContext(10));
assert.ok(
  watchedStep0.components.need >= 70,
  'STEP 0: with both WR starter slots open, the watched WR must show real starter need',
);

// STEP 1: draft "Best WR" — fills one WR starter slot.
draftInSequence('seq-wr-1');
assert.equal(seqPool.some((p) => p.key === 'seq-wr-1'), false, 'drafted player must be removed from the available pool');
assert.equal(D.rosterCounts(seqRoster).WR, 1, 'roster counts must reflect the new pick');
const lineupAfterStep1 = D.optimalLineup(seqRoster, seqLeague);
assert.ok(
  lineupAfterStep1.starters.some((s) => s.slot === 'WR' && s.player && s.player.key === 'seq-wr-1'),
  'STEP 1: the optimal lineup must actually seat the newly drafted WR as a starter',
);
const watchedStep1 = D.scorePlayer(watchedWR, seqContext(10));
assert.equal(
  D.playerGrade(watchedWR), watchedGradeStep0,
  'STEP 1: Player Grade for the watched WR must not move just because a pick happened',
);
assert.ok(
  watchedStep1.components.need >= 70,
  'STEP 1: one WR starter slot is still open — watched WR need must remain high',
);

// STEP 2: draft "Best RB" — an unrelated position. Watched WR's need must
// be unaffected by a pick at a different position.
draftInSequence('seq-rb-1');
const watchedStep2 = D.scorePlayer(watchedWR, seqContext(10));
assert.equal(
  watchedStep2.components.need, watchedStep1.components.need,
  'STEP 2: a pick at an unrelated position (RB) must not change the watched WR need score',
);

// STEP 3: draft "Third WR" — fills the SECOND (final) WR starter slot.
// Now the watched WR would only be bench/FLEX-eligible — need must drop.
draftInSequence('seq-wr-3');
const watchedStep3 = D.scorePlayer(watchedWR, seqContext(10));
assert.equal(
  D.playerGrade(watchedWR), watchedGradeStep0,
  'STEP 3: Player Grade for the watched WR must STILL be identical after three real picks — full-sequence stability, not just a single snapshot',
);
assert.ok(
  watchedStep3.components.need < watchedStep1.components.need,
  'STEP 3: once both real WR starter slots are filled, watched WR need must genuinely drop versus when a slot was open',
);

// STEP 4: draft "Best QB" — verify the exact spec scenario now holds
// mid-sequence: a second QB must show suppressed need, but the position
// itself remains untouched by the unrelated WR/RB picks already made.
draftInSequence('seq-qb-1');
const secondQBStep4 = D.scorePlayer(seqPool.find((p) => p.key === 'seq-qb-2'), seqContext(10));
assert.ok(
  secondQBStep4.components.need < 30,
  'STEP 4: after drafting a QB in a 1QB league, a second QB must show suppressed need — mid-sequence, not just in isolation',
);

// Scarcity must also reflect the shrinking pool across the sequence —
// fewer WRs remain after two have been drafted.
const finalWRScarcity = D.scarcityScore(watchedWR, seqPool, seqContext(10));
assert.ok(
  finalWRScarcity.remainingSupply < 3,
  'STEP 4: remaining WR supply must reflect the two WRs actually drafted during the sequence',
);

// EXPLAINABILITY OUTPUT — structured, deterministic reasons from real
// engine state, no invented text.
const explainLeague = { roster: { QB: 1, RB: 2, WR: 2, TE: 1, BENCH: 6 } };
const explainContext = {
  league: explainLeague, teams: 12, round: 3, totalRounds: 16, picks: [],
  counts: {}, targets: D.starterTargets(explainLeague), superflex: false, poolSize: 250, survival: 50,
};
const explainWR = { key: 'exp-wr', name: 'Explain WR', position: 'WR', overallRank: 15, consensusScore: 88, tier: 1, tierEnd: true };
const explainQB = { key: 'exp-qb', name: 'Explain QB', position: 'QB', overallRank: 5, consensusScore: 95, tier: 1 };
const explainWREval = D.scorePlayer(explainWR, explainContext);
const explainQBEval = D.scorePlayer(explainQB, explainContext);
const explanation = D.explainPick(explainWR, explainWREval, [
  { player: explainWR, evaluation: explainWREval },
  { player: explainQB, evaluation: explainQBEval },
]);
assert.ok(Array.isArray(explanation.whyThisPlayer) && explanation.whyThisPlayer.length > 0, 'explainPick must produce real whyThisPlayer reasons');
assert.ok(
  explanation.whyThisPlayer.some((reason) => reason.includes('Tier')),
  'a tier-ending player must generate a tier-based reason, not just generic text',
);
assert.ok(
  explanation.whyNotAlternative.length > 0 && explanation.whyNotAlternative[0].includes('Explain QB'),
  'whyNotAlternative must correctly identify the higher-grade alternative that was NOT chosen',
);
assert.ok(
  explanation.canIWait && typeof explanation.canIWait.recommendation !== 'undefined',
  'canIWait must expose a real recommendation field',
);

// THREE-BOARD DATA MODEL — Consensus/Model/Draft Now must be genuinely
// distinct and react to different inputs, per the required test list.
const boardLeague1QB = { roster: { QB: 1, RB: 2, WR: 2, TE: 1, BENCH: 6 } };
const boardPlayers = [
  { key: 'b-qb1', name: 'Board QB1', position: 'QB', overallRank: 3, posRank: 14, consensusScore: 96, tier: 1 },
  { key: 'b-rb1', name: 'Board RB1', position: 'RB', overallRank: 5, posRank: 2, consensusScore: 94, tier: 1 },
  { key: 'b-wr1', name: 'Board WR1', position: 'WR', overallRank: 8, posRank: 3, consensusScore: 91, tier: 1 },
];
const boardContextEmpty = { league: boardLeague1QB, teams: 12, round: 1, totalRounds: 16, picks: [], counts: {}, targets: D.starterTargets(boardLeague1QB), superflex: false, poolSize: 250, survival: 50 };
const boardsEmpty = D.buildBoards(boardPlayers, boardContextEmpty);

// Draft state changes: QB1 gets drafted (roster changes).
const boardContextAfterQB = { ...boardContextEmpty, picks: [boardPlayers[0]], counts: D.rosterCounts([boardPlayers[0]]) };
const boardsAfterQB = D.buildBoards(boardPlayers, boardContextAfterQB);

assert.deepEqual(
  boardsEmpty.consensus.map((e) => e.player.key), boardsAfterQB.consensus.map((e) => e.player.key),
  'CONSENSUS board must remain stable after a roster change',
);
assert.deepEqual(
  boardsEmpty.model.map((e) => e.player.key), boardsAfterQB.model.map((e) => e.player.key),
  'MODEL board must remain stable after a roster change (only reacts to league config, not roster)',
);
assert.notDeepEqual(
  boardsEmpty.draftNow.map((e) => e.value), boardsAfterQB.draftNow.map((e) => e.value),
  'DRAFT NOW board values must change after a roster change (Pick Utility is roster-dependent)',
);

// League configuration change must move the MODEL board (QB1 vs Superflex).
const superflexLeagueForBoards = { roster: { QB: 1, RB: 2, WR: 2, TE: 1, SUPER_FLEX: 1, BENCH: 6 } };
const boardContextSuperflex = { ...boardContextEmpty, league: superflexLeagueForBoards, targets: D.starterTargets(superflexLeagueForBoards), superflex: true };
const boardsSuperflex = D.buildBoards(boardPlayers, boardContextSuperflex);
const qbModelValueEmpty = boardsEmpty.model.find((e) => e.player.key === 'b-qb1').value;
const qbModelValueSuperflex = boardsSuperflex.model.find((e) => e.player.key === 'b-qb1').value;
assert.notEqual(qbModelValueEmpty, qbModelValueSuperflex, 'MODEL board must change when league configuration changes');

// COMPLETED ROSTER VALIDATION
const validRosterLeague = { roster: { QB: 1, RB: 1, WR: 1, TE: 1, BENCH: 2 } };
const validRosterPicks = [
  { key: 'v-qb', name: 'V QB', position: 'QB', consensusScore: 90 },
  { key: 'v-rb', name: 'V RB', position: 'RB', consensusScore: 85 },
  { key: 'v-wr', name: 'V WR', position: 'WR', consensusScore: 80 },
  { key: 'v-te', name: 'V TE', position: 'TE', consensusScore: 70 },
  { key: 'v-bn1', name: 'V Bench 1', position: 'WR', consensusScore: 60 },
];
const rosterValidation = D.validateCompletedRoster(validRosterPicks, validRosterLeague);
assert.equal(rosterValidation.valid, true, 'a genuinely valid completed roster must pass validation with zero issues');
assert.equal(rosterValidation.issues.length, 0, 'a valid roster must report zero issues');

// Deliberately broken case: a duplicate player key must be caught.
const brokenRosterPicks = [...validRosterPicks, { key: 'v-qb', name: 'V QB', position: 'QB', consensusScore: 90 }];
const brokenValidation = D.validateCompletedRoster(brokenRosterPicks, validRosterLeague);
assert.equal(brokenValidation.valid, false, 'a roster with a duplicate player must fail validation');

// CONSENSUS GUARDRAILS — synthetic data with a deliberately inserted
// outlier, proving the validator actually catches it. Real execution
// against the live dataset still needs to happen in an environment with
// actual data access — this proves the LOGIC is correct.
const guardrailLeague = { roster: { QB: 1, RB: 2, WR: 2, TE: 1, BENCH: 6 } };
const guardrailPlayers = Array.from({ length: 60 }, (_v, i) => ({
  key: `g-${i}`, name: `Guardrail Player ${i}`, position: ['QB', 'RB', 'WR', 'TE'][i % 4],
  overallRank: i + 1, consensusScore: 100 - i, tier: Math.floor(i / 8) + 1,
}));
// Deliberately break one player's model-relevant fields so the model
// ranks him far below his real consensus rank — the exact "WR12 vs WR48"
// scenario the spec describes.
const outlierIndex = 5;
guardrailPlayers[outlierIndex] = {
  ...guardrailPlayers[outlierIndex],
  consensusScore: 20, // model will now rank him far lower than his overallRank of 6 suggests
};
const guardrailContext = { league: guardrailLeague, teams: 12, round: 1, totalRounds: 16, picks: [], counts: {}, targets: D.starterTargets(guardrailLeague), superflex: false, poolSize: 250, survival: 50 };
const guardrailReport = D.validateConsensusAlignment(guardrailPlayers, guardrailContext, { deviationThreshold: 10 });
assert.ok(
  guardrailReport.overallFlags.some((flag) => flag.name === 'Guardrail Player 5'),
  'Consensus Guardrails must actually flag a deliberately inserted large model-vs-consensus deviation',
);
assert.ok(
  guardrailReport.overlap.top12.overlap >= 8,
  'top-12 overlap must be broadly high when only one deliberate outlier exists among 60 players',
);

// BACKTEST HARNESS — synthetic historical fixture proving the math is
// correct. Real historical calibration still requires real outcome data
// this environment cannot fetch live.
const backtestRecords = Array.from({ length: 30 }, (_v, i) => ({
  key: `bt-${i}`, modelRank: i + 1, consensusRank: i + 1 + (i % 3), adpRank: i + 1 + (i % 5),
  actualOutcomeRank: i + 1 + ((i % 7) - 3), injuryDistorted: i === 29,
}));
const backtestResult = D.runBacktest(backtestRecords);
assert.ok(
  backtestResult.modelRankCorrelation > 0.7,
  'a model that closely tracks actual outcomes in the synthetic fixture must show strong positive correlation',
);
assert.equal(backtestResult.excludedInjuryDistorted, 1, 'injury-distorted records must be identifiably excluded, not silently blended into evidence');
assert.equal(D.spearmanCorrelation([[1, 1], [2, 2], [3, 3]]), 1, 'perfect rank agreement must produce correlation of exactly 1');

console.log('draft-intelligence.js tests passed');


// Advisor roster-state taxonomy regression tests.
(() => {
  const league = { roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 }, scoring: { reception: 0.5 } };
  const p = (name, position, overallRank, posRank) => ({ key: `${name}|${position}`, name, position, overallRank, rank: overallRank, posRank, consensusScore: Math.max(1, 101 - overallRank) });
  const roster = [
    p('QB One', 'QB', 12, 1),
    p('RB One', 'RB', 8, 1), p('RB Two', 'RB', 22, 8),
    p('WR One', 'WR', 10, 2), p('WR Two', 'WR', 28, 12),
    p('TE One', 'TE', 45, 6),
  ];
  const flexCandidate = p('WR Three', 'WR', 32, 14);
  const flexState = D.rosterNeedState(flexCandidate, { league, picks: roster, counts: D.rosterCounts(roster), superflex: false });
  assert.ok(['flex_need', 'starter_upgrade'].includes(flexState.state), 'rosterNeedState identifies FLEX need or lineup upgrade');

  const qbLuxury = p('QB Two', 'QB', 30, 4);
  const qbState = D.rosterNeedState(qbLuxury, { league, picks: roster, counts: D.rosterCounts(roster), superflex: false });
  assert.strictEqual(qbState.state, 'luxury', 'second 1QB is labeled luxury when it does not start');

  const withK = [...roster, p('K One', 'K', 180, 1)];
  const kState = D.rosterNeedState(p('K Two', 'K', 190, 2), { league, picks: withK, counts: D.rosterCounts(withK), superflex: false });
  assert.strictEqual(kState.state, 'saturated', 'second kicker is saturated after K slot filled');

  const completed = D.validateCompletedRoster([...withK, p('DST One', 'DST', 181, 1), p('RB Three', 'RB', 35, 15)], league);
  assert.ok(completed.lineup.starters.some((slot) => slot.slot === 'K' && slot.player), 'completed lineup seats kicker');
  assert.ok(completed.lineup.starters.some((slot) => slot.slot === 'DST' && slot.player), 'completed lineup seats defense');
})();
