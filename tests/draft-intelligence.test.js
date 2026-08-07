'use strict';

const assert = require('node:assert/strict');
const D = require('../js/draft-intelligence.js');

for (const [name, strategy] of Object.entries(D.STRATEGIES)) {
  const total = Object.values(strategy.weights).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `${name} weights must sum to 1`);
  assert.ok(strategy.weights.scheme <= .08, `${name} scheme weight must remain a tiebreaker`);
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

console.log('draft-intelligence.js tests passed');
