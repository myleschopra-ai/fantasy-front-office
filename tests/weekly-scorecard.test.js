'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const W = require('../js/weekly-scorecard.js');

const positions = ['QB', 'RB', 'WR', 'FLEX', 'BN', 'BN'];
const players = { q1: { position: 'QB' }, r1: { position: 'RB' }, r2: { position: 'RB' }, w1: { position: 'WR' }, w2: { position: 'WR' }, q2: { position: 'QB' }, r3: { position: 'RB' }, w3: { position: 'WR' }, w4: { position: 'WR' } };
const history = {
  schema_version: 1, season: 2026, week: 3, generated_at: '2026-09-20T13:00:00Z', model_version: 'test', evidence_cutoff: 'before 2026 week 3',
  fields: ['sleeper_id', 'gsis_id', 'name', 'position', 'team', 'projected_points', 'p10', 'p90', 'availability_probability', 'injury_status', 'unavailable_reason', 'opponent', 'games_last_2'],
  players: [
    ['q1', null, 'Q One', 'QB', 'AAA', 20, 10, 30, 0.96, null, null, 'BBB', 2],
    ['r1', null, 'R One', 'RB', 'AAA', 15, 5, 25, 0.96, null, null, 'BBB', 2],
    ['r2', null, 'R Two', 'RB', 'AAA', 5, 1, 9, 0.96, null, null, 'BBB', 2],
    ['w1', null, 'W One', 'WR', 'AAA', 10, 3, 18, 0.96, null, null, 'BBB', 2],
    ['q2', null, 'Q Two', 'QB', 'BBB', 18, 9, 27, 0.96, null, null, 'AAA', 2],
    ['r3', null, 'R Three', 'RB', 'BBB', 12, 4, 20, 0.96, null, null, 'AAA', 2],
    ['w3', null, 'W Three', 'WR', 'BBB', 11, 4, 18, 0.96, null, null, 'AAA', 2],
    ['w4', null, 'W Four', 'WR', 'BBB', 9, 3, 15, 0.96, null, null, 'AAA', 2],
  ],
};
const index = W.snapshotIndex(history);
assert.equal(index.get('r1').points, 15);
assert.equal(index.has('w2'), false);
const published = W.snapshotIndex({ players: [{ source_ids: { sleeper: '42' }, projected_points: 7.5, distribution: { p10: 1, p50: 7.5, p90: 14 } }] });
assert.equal(published.get('42').points, 7.5);

const entries = [
  { roster_id: 1, matchup_id: 1, points: 43, starters: ['q1', 'r2', 'w1', 'w2'], players: ['q1', 'r1', 'r2', 'w1', 'w2'], players_points: { q1: 20, r1: 0, r2: 12, w1: 8, w2: 3 } },
  { roster_id: 2, matchup_id: 1, points: 40, starters: ['q2', 'r3', 'w3', 'w4'], players: ['q2', 'r3', 'w3', 'w4'], players_points: { q2: 18, r3: 10, w3: 7, w4: 5 } },
];
const scored = W.scoreWeek({ week: 3, entries, players, projections: index, rosterPositions: positions, history: { q1: [22], r2: [6], w1: [9], q2: [17], r3: [11], w3: [10], w4: [6] } });
const one = scored.teams.find(team => team.roster_id === 1);
assert.deepEqual(new Set(one.dashboard_starters), new Set(['q1', 'r1', 'w1', 'r2']), 'unprojected w2 sits; projected r1 starts');
assert.equal(one.dashboard, 40, 'dashboard lineup scores 20 + 0 + 8 + 12');
assert.equal(one.actual, 43);
assert.equal(one.optimal, 43);
assert.equal(one.dashboard_zero_starters, 1);
assert.equal(one.result_actual, 'W');
assert.equal(one.result_if_dashboard, 'T');
const two = scored.teams.find(team => team.roster_id === 2);
assert.equal(two.same_as_manager, true);
assert.equal(scored.league.dashboard_matches_manager, 1);
assert.equal(scored.league.wins_flipped_to_losses, 0);
assert.equal(scored.projection_error.starters, 7);
assert.ok(scored.projection_error.model_mae > 0 && scored.projection_error.rolling_average_mae > 0);

const ledger = W.ledgerRecords({ season: 2026, week: 3, leagueId: 'L1', scored, snapshotMeta: { path: 'x.json', generated_at: history.generated_at, model_version: 'test' } });
assert.equal(ledger.length, 2);
for (const field of ['id', 'league_id', 'roster_id', 'recommended_at', 'action_type', 'assets', 'expected_benefit', 'confidence', 'evidence', 'model_version', 'baseline', 'user_decision', 'outcome']) {
  assert.ok(field in ledger[0], `ledger row carries ${field}`);
}
assert.equal(ledger[0].id, '2026-w03-lineup-1');
assert.equal(ledger[0].outcome.status, 'RESOLVED');
assert.equal(ledger[1].user_decision, 'FOLLOWED');
const pending = W.ledgerRecords({ season: 2026, week: 4, leagueId: 'L1', pending: [{ roster_id: 1, dashboard_starters: ['q1'], dashboard_projected: 20, dashboard_unprojected_starters: 0 }], snapshotMeta: {} });
assert.equal(pending[0].outcome.status, 'PENDING');
assert.equal(pending[0].user_decision, null);

// The CLI replays a captured league end to end and is idempotent.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffo-scorecard-'));
const fixture = path.join(dir, 'fixture');
fs.mkdirSync(fixture);
fs.writeFileSync(path.join(fixture, 'league.json'), JSON.stringify({ roster_positions: positions }));
fs.writeFileSync(path.join(fixture, 'rosters.json'), JSON.stringify([
  { roster_id: 1, players: entries[0].players, settings: { wins: 1, losses: 0 } },
  { roster_id: 2, players: entries[1].players, settings: { wins: 0, losses: 1 } },
]));
fs.writeFileSync(path.join(fixture, 'players.json'), JSON.stringify(players));
fs.writeFileSync(path.join(fixture, 'matchups-1.json'), JSON.stringify(entries));
const snapshots = path.join(dir, 'snapshots');
fs.mkdirSync(snapshots);
fs.writeFileSync(path.join(snapshots, '2026-w01.json'), JSON.stringify(history));
fs.writeFileSync(path.join(snapshots, '2026-w02.json'), JSON.stringify(history));
const run = () => JSON.parse(execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'weekly_scorecard.mjs'),
  '--season', '2026', '--league', 'L1', '--roster', '1', '--fixture-dir', fixture, '--snapshots', snapshots,
  '--out', path.join(dir, 'scorecards'), '--ledger', path.join(dir, 'ledger'), '--no-benchmark'], { encoding: 'utf8' }));
const first = run();
assert.equal(first.weeks_scored, 1);
assert.ok(first.files_changed >= 3);
const week1 = JSON.parse(fs.readFileSync(path.join(dir, 'scorecards', '2026-w01.json'), 'utf8'));
assert.equal(week1.league.dashboard, 40);
assert.equal(fs.readFileSync(path.join(dir, 'ledger', '2026-w02.jsonl'), 'utf8').trim().split('\n').length, 2, 'next week is logged as pending');
assert.equal(run().files_changed, 0, 'a rerun with nothing new writes nothing');
fs.rmSync(dir, { recursive: true, force: true });

console.log('weekly scorecard contracts passed');
