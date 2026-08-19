const assert = require('node:assert/strict');
const D = require('../js/dashboard-intelligence.js');

const now = Date.parse('2026-08-19T18:00:00Z');
assert.equal(D.freshness('2026-08-19T17:50:00Z', 0.25, now).status, 'CURRENT');
assert.equal(D.freshness('2026-08-19T16:00:00Z', 1, now).status, 'STALE');
assert.equal(D.freshness('2026-08-18T18:00:00Z', 1, now).status, 'EXPIRED');
assert.equal(D.freshness(null, 1, now).status, 'MISSING');

const manifest = D.sourceManifest([
  { id: 'league', timestamp: '2026-08-19T17:50:00Z', maxAgeHours: 1, required: true },
  { id: 'projection', timestamp: '2026-08-18T17:00:00Z', maxAgeHours: 6, required: false },
], now);
assert.equal(manifest.status, 'CURRENT', 'expired optional source must not degrade required source health');
assert.equal(manifest.currentCount, 1);

const profile = D.leagueProfile({
  total_rosters: 12,
  scoring_settings: { rec: 1, bonus_rec_te: 0.5 },
  settings: { type: 2, waiver_budget: 100, playoff_week_start: 15 },
  roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN', 'BN'],
});
assert.deepEqual(
  { scoring: profile.scoring, dynasty: profile.dynasty, superflex: profile.superflex, tePremium: profile.tePremium },
  { scoring: 'PPR', dynasty: true, superflex: true, tePremium: true }
);

const players = [
  { id: 'qb1', name: 'QB One', position: 'QB', projection: 24, marketValue: 7000, confidence: .9 },
  { id: 'qb2', name: 'QB Two', position: 'QB', projection: 21, marketValue: 5000, confidence: .85 },
  { id: 'rb1', name: 'RB One', position: 'RB', projection: 18, marketValue: 6000, confidence: .85 },
  { id: 'wr1', name: 'WR One', position: 'WR', projection: 17, marketValue: 5800, confidence: .85 },
  { id: 'te1', name: 'TE One', position: 'TE', projection: 13, marketValue: 3000, confidence: .8 },
  { id: 'wr2', name: 'WR Two', position: 'WR', projection: 16, marketValue: 4500, confidence: .8 },
];
const optimized = D.optimizeLineup(players, ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN']);
assert.equal(optimized.assigned.length, 6);
assert.equal(optimized.assigned.filter(row => row.player).length, 6);
assert.equal(new Set(optimized.assigned.map(row => row.player.id)).size, 6, 'a player cannot fill two lineup slots');
assert.ok(optimized.assigned.some(row => row.slot === 'SUPER_FLEX' && row.player.position === 'QB'), 'second QB should fill Superflex');

const roster = D.rosterAssessment(players, profile);
assert.ok(roster.gaps.some(gap => gap.position === 'RB'));
assert.ok(roster.gaps.some(gap => gap.position === 'QB'), 'Superflex should target three QBs');

const add = D.acquisitionDecision(
  { name: 'Target', projection: 16, marketValue: 4000, trend30: 80, confidence: .85 },
  { name: 'Drop', projection: 8, marketValue: 1000, confidence: .8 },
  80
);
assert.equal(add.action, 'ADD');
assert.equal(add.urgency, 'HIGH');
assert.ok(add.bidRange[0] >= 1 && add.bidRange[1] <= 80 && add.bidRange[1] > add.bidRange[0]);

const trade = D.tradeDecision(
  [{ value: 4000, projection: 12, position: 'WR' }],
  [{ value: 5200, projection: 17, position: 'RB' }],
  { gaps: [{ position: 'RB' }] }
);
assert.equal(trade.action, 'ACCEPT');
assert.ok(trade.valueDelta > 0 && trade.projectionDelta > 0 && trade.scarcity > 0);

const ranked = D.rankActions([
  { id: 'low', impact: 2, confidence: .5, urgency: .3 },
  { id: 'high', impact: 9, confidence: .9, urgency: 1 },
]);
assert.equal(ranked[0].id, 'high');
assert.equal(D.confidenceLabel(.82), 'HIGH');

console.log('dashboard intelligence phase contracts passed');
