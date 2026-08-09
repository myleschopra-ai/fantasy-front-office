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
  picks: [{ name: 'Josh Allen', position: 'QB', posRank: 1 }],
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

console.log('draft-intelligence.js tests passed');
