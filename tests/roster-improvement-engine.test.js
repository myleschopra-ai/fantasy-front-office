'use strict';
const assert = require('node:assert/strict');
const R = require('../js/roster-improvement-engine.js');

const slots = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN'];
const player = (id, position, projection, extra = {}) => ({ id, name: id, position, projection, marketValue: projection * 250, ...extra });

const myRoster = [
  player('QB1', 'QB', 20), player('RB1', 'RB', 17), player('RB2', 'RB', 8, { injury: 'Q', availabilityRisk: .4 }),
  player('WR1', 'WR', 16), player('WR2', 'WR', 15), player('WR3', 'WR', 14), player('TE1', 'TE', 12),
  player('Bench RB', 'RB', 7), player('Bench WR', 'WR', 9),
];
const leagueRosters = Array.from({ length: 12 }, (_, team) => ({
  id: String(team + 1), wins: team < 6 ? 5 : 3, pointsFor: 620 - team * 8,
  players: team === 0 ? myRoster : [
    player(`QB-${team}`, 'QB', 18 + team * .2), player(`RB-A-${team}`, 'RB', 15 + team * .1),
    player(`RB-B-${team}`, 'RB', 13 + team * .1), player(`WR-A-${team}`, 'WR', 16 + team * .1),
    player(`WR-B-${team}`, 'WR', 14 + team * .1), player(`WR-C-${team}`, 'WR', 12 + team * .1),
    player(`TE-${team}`, 'TE', 10 + team * .1), player(`Bench-${team}`, 'RB', 8 + team * .1),
  ],
}));

assert.equal(R.VERSION, '1.0.0');
assert.equal(R.eligible('QB', 'SUPER_FLEX'), true);
assert.equal(R.eligible('QB', 'FLEX'), false);

const lineup = R.optimizeLineup(myRoster, slots);
assert.equal(lineup.assigned.length, 7);
assert.equal(new Set(lineup.assigned.map(row => row.player.id)).size, 7, 'a player must fill only one slot');
assert.equal(lineup.projected, 102);

const replacement = R.replacementLevels(leagueRosters.flatMap(team => team.players), slots, 12);
assert.ok(replacement.levels.RB > 0);
assert.ok(replacement.demand.RB > 24, 'flex demand should raise the RB replacement cutoff');

const even = R.matchupWinProbability(120, 120);
const favorite = R.matchupWinProbability(130, 120);
assert.ok(Math.abs(even - .5) < .001);
assert.ok(favorite > even);

const ewa = R.expectedWinsAdded([.4, .5, .6], [.5, .6, .65]);
assert.equal(ewa.expectedWins, .25);
assert.equal(ewa.weeks.length, 3);

const marginal = R.marginalLineupValue({
  roster: myRoster, candidate: player('Target RB', 'RB', 16, { marketValue: 4200 }),
  rosterPositions: slots, opponentProjections: [105, 110, 100], remainingWeeks: 3,
});
assert.equal(marginal.weeklyPointGain, 8);
assert.ok(marginal.ewa > 0);

const transaction = R.transactionImpact({
  roster: myRoster, give: [{ name: 'Bench WR' }], receive: [player('Trade RB', 'RB', 15)],
  rosterPositions: slots, opponentProjections: [105, 110, 100], remainingWeeks: 3,
});
assert.equal(transaction.weeklyPointGain, 7);
assert.ok(transaction.ewa > 0);

const diagnostics = R.positionDiagnostics({ roster: myRoster, leagueRosters, rosterPositions: slots, teams: 12, replacement });
assert.ok(diagnostics.length >= 5);
assert.equal(diagnostics[0].slot, 'RB', 'weak and risky RB2 should be the primary constraint');
assert.ok(diagnostics[0].floorProbability > 0);
assert.ok(diagnostics[0].items.some(item => item.starterRank >= 10));

const bottlenecks = R.detectBottlenecks(diagnostics, 6, 6);
assert.equal(bottlenecks[0].rank, 1);
assert.ok(bottlenecks[0].opportunityShare > bottlenecks.at(-1).opportunityShare);
assert.ok(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(bottlenecks[0].severity));

const standingTeams = leagueRosters.map(team => ({
  id: team.id, projection: R.optimizeLineup(team.players, slots).projected, wins: team.wins, pointsFor: team.pointsFor,
}));
const championshipA = R.championshipProbability({ teams: standingTeams, teamId: '1', remainingWeeks: 5, playoffTeams: 6, simulations: 1200, seed: 42 });
const championshipB = R.championshipProbability({ teams: standingTeams, teamId: '1', remainingWeeks: 5, playoffTeams: 6, simulations: 1200, seed: 42 });
assert.deepEqual(championshipA, championshipB, 'seeded simulations must be reproducible');
assert.ok(championshipA.probability >= 0 && championshipA.probability <= 1);
assert.ok(championshipA.playoffProbability >= championshipA.probability);

const analysis = R.analyzeRoster({
  roster: myRoster, leagueRosters, rosterPositions: slots, teams: 12, teamId: '1',
  remainingWeeks: 5, playoffTeams: 6, simulations: 500, seed: 7,
});
assert.equal(analysis.primaryBottleneck.slot, 'RB');
assert.equal(analysis.lineup.projected, 102);
assert.ok(analysis.confidence > .9);

assert.equal(R.marketMispricing({ marketValue: 4200, teamValue: 6100 }).action, 'EXPLOIT');
assert.equal(R.marketMispricing({ marketValue: 7000, teamValue: 4900 }).action, 'SELL');

const ranked = R.rankAcquisitionTargets({
  roster: myRoster, rosterPositions: slots, opponentProjections: [105, 110, 100], remainingWeeks: 3,
  targets: [
    player('Depth WR', 'WR', 15.5, { marketValue: 2500, acquisitionCost: 2500 }),
    player('Target RB', 'RB', 16, { marketValue: 4200, acquisitionCost: 4200 }),
  ],
});
assert.equal(ranked[0].name, 'Target RB', 'ranking must prioritize actual lineup/championship utility over generic value');

const comparison = R.compareWaiverTrade({
  waiver: { ewa: .72, championshipProbabilityAdded: .03, cost: 18 },
  trade: { ewa: 1, championshipProbabilityAdded: .04, permanentAssetCost: 1200 },
});
assert.equal(comparison.recommended, 'WAIVER');
assert.equal(comparison.performanceShare, .72);

const universe = R.evaluateAcquisitionUniverse({
  roster:myRoster, rosterPositions:slots, opponentProjections:[105, 110, 100], remainingWeeks:3,
  leagueTeams:standingTeams, teamId:'1', playoffTeams:6, simulations:500, seed:19, budgetRemaining:80,
  candidates:[
    player('Waiver RB', 'RB', 14, { id:'waiver-rb', acquisitionType:'WAIVER', marketValue:1200 }),
    player('Trade RB', 'RB', 16, { id:'trade-rb', acquisitionType:'TRADE', ownerId:'2', ownerName:'Manager Two', marketValue:4200 }),
    player('Bench WR Target', 'WR', 10, { id:'bench-wr-target', acquisitionType:'TRADE', ownerId:'3', ownerName:'Manager Three', marketValue:1500 }),
    { id:'unknown', name:'Unknown Projection', position:'TE', projection:null, marketValue:900, acquisitionType:'WAIVER' },
  ],
});
assert.equal(universe.evaluatedCount, 4, 'every rostered and waiver candidate must be evaluated');
assert.equal(universe.waiverCount, 2);
assert.equal(universe.tradeCount, 2);
const waiverTarget = universe.targets.find(target => target.id === 'waiver-rb');
const tradeTarget = universe.targets.find(target => target.id === 'trade-rb');
const unknownTarget = universe.targets.find(target => target.id === 'unknown');
assert.equal(waiverTarget.permanentAssetCost, 0);
assert.equal(universe.targets[0].id, 'waiver-rb', 'a title-positive waiver has infinite return per permanent asset cost and should rank first');
assert.ok(waiverTarget.faabCost > 0 && waiverTarget.faabCost <= 80);
assert.equal(tradeTarget.path.ownerName, 'Manager Two');
assert.equal(tradeTarget.path.ownerId, '2');
assert.ok(tradeTarget.permanentAssetCost > tradeTarget.marketValue, 'owner leverage must remain distinct from market price');
assert.ok(Number.isFinite(tradeTarget.championshipReturnPer1000));
assert.ok(tradeTarget.championshipProbabilityAdded >= waiverTarget.championshipProbabilityAdded);
assert.equal(tradeTarget.pathRecommendation, 'WAIVER FIRST', 'a waiver providing most of the gain should be preferred before permanent asset spend');
assert.equal(tradeTarget.waiverAlternative.name, 'Waiver RB');
assert.equal(unknownTarget.dataStatus, 'NO_PROJECTION');
assert.ok(universe.targets.indexOf(unknownTarget) > universe.targets.indexOf(tradeTarget));

console.log('roster improvement engine phase 1 and phase 2 contracts passed');
