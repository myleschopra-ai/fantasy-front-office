'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../js/season-model.js');
const R = require('../js/roster-improvement-engine.js');

// Constants live in config/decision_policy.json; the module fallback must match it.
const policy = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'decision_policy.json'), 'utf8'));
for (const section of ['season_model', 'team_state', 'sell_window']) {
  for (const [key, value] of Object.entries(S.DEFAULT_POLICY[section])) {
    assert.equal(policy[section][key], value, `${section}.${key} fallback must match config/decision_policy.json`);
  }
}

// Games played comes from standings, not the calendar.
assert.equal(S.gamesPlayed([{ settings: { wins: 2, losses: 3, ties: 0 } }, { settings: { wins: 4, losses: 1 } }]), 5);

// A 12-team league with a round-robin schedule.
const ids = Array.from({ length: 12 }, (_, index) => String(index + 1));
const roundRobin = week => {
  const rotating = ids.slice(1);
  const shift = week % rotating.length;
  const order = [ids[0]].concat(rotating.slice(shift), rotating.slice(0, shift));
  return Array.from({ length: 6 }, (_, index) => [order[index], order[11 - index]]);
};
const matchupsByWeek = {};
for (let week = 1; week <= 14; week += 1) {
  matchupsByWeek[week] = roundRobin(week).flatMap(([a, b], index) => [
    { roster_id: Number(a), matchup_id: index + 1, points: week <= 5 ? 100 + Number(a) : 0 },
    { roster_id: Number(b), matchup_id: index + 1, points: week <= 5 ? 100 + Number(b) : 0 },
  ]);
}
const split = S.splitSeason({ matchupsByWeek, played: 5, playoffWeekStart: 15 });
assert.equal(split.past.length, 5);
assert.equal(split.schedule.length, 9, 'weeks 6-14 remain');
assert.deepEqual(split.scheduleWeeks, [6, 7, 8, 9, 10, 11, 12, 13, 14]);
assert.equal(split.schedule[0].length, 6);

const stats = S.seasonStats(split.past, ids);
assert.equal(stats.teams['12'].allPlayWins, 55, 'the top scorer beats all 11 others every week');
assert.equal(stats.teams['1'].allPlayLosses, 55);
assert.equal(stats.teams['12'].allPlayPct, 1);
assert.equal(stats.residualSd, 0, 'identical weekly scores leave no residual');

const sd = S.weeklySd({ residualSd: 20, games: 5, policy });
assert.equal(sd.source, 'LEAGUE_EMPIRICAL_SHRUNK');
assert.ok(sd.sd > 20 && sd.sd < 24.5, 'empirical SD is shrunk toward the 24.5 prior');
assert.equal(S.weeklySd({ residualSd: 20, games: 2, policy }).sd, 24.5);

// All-equal teams: every team's playoff odds sit near 6/12.
const equalTeams = ids.map(id => ({ id, projection: 120, weeklySd: 24.5, wins: 0, pointsFor: 0 }));
const equal = R.championshipProbability({ teams: equalTeams, teamId: '1', schedule: split.schedule, playoffTeams: 6, playoffByes: 2, simulations: 4000, seed: 11, allTeams: true });
assert.equal(equal.scheduleSource, 'LEAGUE');
assert.equal(equal.remainingWeeks, 9);
Object.values(equal.teams).forEach(team => {
  assert.ok(Math.abs(team.playoffProbability - 0.5) <= 0.05, `equal teams make the playoffs about half the time (${team.playoffProbability})`);
  assert.ok(Math.abs(team.probability - 1 / 12) <= 0.03, `equal teams win the title about 1/12 of the time (${team.probability})`);
  assert.ok(Math.abs(team.byeProbability - 2 / 12) <= 0.04);
});
const total = Object.values(equal.teams).reduce((sum, team) => sum + team.probability, 0);
assert.ok(Math.abs(total - 1) < 0.002, 'exactly one champion per simulation (rounded shares)');
const again = R.championshipProbability({ teams: equalTeams, teamId: '1', schedule: split.schedule, playoffTeams: 6, playoffByes: 2, simulations: 4000, seed: 11, allTeams: true });
assert.deepEqual(again, equal, 'same seed, same output');

// A 2-3 team scoring 25 below the league is a long shot; a 4-1 team scoring 30 above is near-certain.
const skewed = ids.map(id => ({ id, projection: id === '9' ? 98 : id === '4' ? 155 : 123, weeklySd: 24.5, wins: id === '9' ? 2 : id === '4' ? 4 : 3, pointsFor: 600 }));
const odds = R.championshipProbability({ teams: skewed, teamId: '9', schedule: split.schedule, playoffTeams: 6, playoffByes: 2, simulations: 3000, seed: 3, allTeams: true });
assert.ok(odds.playoffProbability < 0.15, `weak 2-3 team odds ${odds.playoffProbability}`);
assert.ok(odds.teams['4'].playoffProbability > 0.9);
assert.ok(odds.teams['4'].probability > odds.teams['9'].probability * 10);

// Legacy calls without a schedule keep their exact behavior.
const legacy = R.championshipProbability({ teams: equalTeams, teamId: '1', remainingWeeks: 6, simulations: 500, seed: 9 });
assert.equal(legacy.scheduleSource, undefined);

// Six-team bracket with two byes: if the better seed always wins, seed 1 wins.
const seeds = ['A', 'B', 'C', 'D', 'E', 'F'].map((id, index) => ({ id, seed: index + 1 }));
const bracket = R.playBracket(seeds, 2, (a, b) => (a.seed < b.seed ? a : b));
assert.equal(bracket.champion.id, 'A');
assert.deepEqual(bracket.finalists.map(team => team.id), ['A', 'B']);
const upset = R.playBracket(seeds, 2, (a, b) => (a.seed > b.seed ? a : b));
assert.equal(upset.champion.id, 'F', 'the 6 seed must win three games: 3, 2, then the 1-side winner');

// Strengths blend projection and season scoring, shrunk toward the mean.
const strengths = S.teamStrengths({
  teams: [{ id: '1', projection: 110, ppg: 150, games: 5 }, { id: '2', projection: 90, ppg: 100, games: 5 }, { id: '3', projection: 100, ppg: 125, games: 5 }],
  leagueMean: 125, policy,
});
assert.ok(strengths['1'].mean > strengths['3'].mean && strengths['3'].mean > strengths['2'].mean);
assert.ok(strengths['1'].mean < 150, 'season scoring is shrunk');
assert.equal(strengths['3'].mean, 125);
const noProjection = S.teamStrengths({ teams: [{ id: '1', projection: null, ppg: 140, games: 5 }, { id: '2', projection: null, ppg: 110, games: 5 }], leagueMean: 125, policy });
assert.equal(noProjection['1'].seasonWeight, 1);

// Team states.
assert.equal(S.classifyTeamState({ playoff: 0.9, allPlayPct: 0.7, valueRank: 2 }, policy).strategy, 'BUY');
assert.equal(S.classifyTeamState({ playoff: 0.5, allPlayPct: 0.5, valueRank: 6 }, policy).state, 'Fringe contender');
assert.equal(S.classifyTeamState({ playoff: 0.2, allPlayPct: 0.6, valueRank: 3 }, policy).state, 'Productive struggle');
const partender = S.classifyTeamState({ playoff: 0.068, allPlayPct: 15 / 55, valueRank: 9, teamCount: 12 }, policy);
assert.equal(partender.state, 'Structurally weak');
assert.equal(partender.strategy, 'SELL');
assert.equal(partender.policyStatus, 'UNCALIBRATED');
assert.equal(S.classifyTeamState({ playoff: 0.1, allPlayPct: 0.4, valueRank: 4, teamCount: 12 }, policy).state, 'Rebuilder');

// Contender demand and the sell window.
const lineups = {
  '4': { assigned: [{ slot: 'QB', player: { projection: 25 } }, { slot: 'RB', player: { projection: 6 } }, { slot: 'TE', player: { projection: 12 } }] },
  '7': { assigned: [{ slot: 'QB', player: { projection: 12 } }, { slot: 'RB', player: { projection: 18 } }, { slot: 'TE', player: { projection: 11 } }] },
  '9': { assigned: [{ slot: 'QB', player: { projection: 18 } }, { slot: 'RB', player: { projection: 10 } }, { slot: 'TE', player: { projection: 4 } }] },
};
const demand = S.contenderDemand({ teams: [{ id: '4', name: 'X Men', playoff: 0.99, title: 0.36 }, { id: '7', name: 'Richards Nixon', playoff: 0.95, title: 0.17 }, { id: '9', name: 'Partender', playoff: 0.07, title: 0.001 }], lineups, policy });
assert.deepEqual(demand.map(team => team.id), ['4', '7'], 'only contenders are buyers');
assert.ok(demand[0].needs.includes('RB'), 'X Men need a RB');
assert.ok(demand[1].needs.includes('QB'), 'Richards Nixon need a QB');
const window = S.sellWindow({
  roster: [
    { id: 'a', name: 'Alvin Kamara', position: 'RB', age: 31, marketValue: 1030 },
    { id: 'b', name: 'Courtland Sutton', position: 'WR', age: 31, marketValue: 1172 },
    { id: 'c', name: 'Puka Nacua', position: 'WR', age: 25, marketValue: 8300 },
    { id: 'd', name: 'Deep Vet', position: 'RB', age: 30, marketValue: 120 },
  ],
  demand, weeksToDeadline: 5, policy,
});
assert.deepEqual(window.map(row => row.name), ['Alvin Kamara', 'Courtland Sutton'], 'buyer-matched veterans first; young core and low-value players excluded');
assert.equal(window[0].buyers[0].name, 'X Men');
assert.equal(S.weeksUntilDeadline({ played: 5, tradeDeadline: 11 }), 5);

// A selling team never sends youth or picks for a veteran.
const blocked = S.strategyBlocks({ strategy: 'SELL', give: [{ name: 'Jordyn Tyson', age: 22 }], receive: [{ name: 'Derrick Henry', age: 32 }], policy });
assert.ok(blocked && blocked.includes('Jordyn Tyson'));
assert.equal(S.strategyBlocks({ strategy: 'BUY', give: [{ name: 'Jordyn Tyson', age: 22 }], receive: [{ name: 'Derrick Henry', age: 32 }], policy }), null);
assert.equal(S.strategyBlocks({ strategy: 'SELL', give: [{ name: 'Old Vet', age: 31 }], receive: [{ name: 'Young WR', age: 23 }], policy }), null);

console.log('season model contracts passed');
