const assert = require('assert');
const S = require('../js/draft-session.js');

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    dump(key) { return map.get(key); },
  };
}

const pick = (n, key) => ({ pick: n, pickNo: n, key, playerId: key, name: key, position: 'WR' });

(() => {
  const payload = {
    version: 4,
    teams: 12,
    slot: 7,
    rounds: 16,
    picks: [pick(1, 'a'), pick(2, 'b'), pick(3, 'c')],
    queue: ['q1'],
  };
  const storage = memoryStorage();
  const saved = S.safeSave(storage, 'snake', 'snake', payload, { source: 'test' });
  assert.ok(saved.ok, `snake save failed: ${(saved.issues || []).join(', ')}`);
  const loaded = S.safeLoad(storage, 'snake', 'snake');
  assert.ok(loaded.ok, `snake load failed: ${(loaded.issues || []).join(', ')}`);
  assert.strictEqual(loaded.payload.picks.length, 3);
  assert.deepStrictEqual(loaded.payload.queue, ['q1']);
  assert.strictEqual(loaded.status, S.STATES.RECOVERING);
})();

(() => {
  const legacy = {
    version: 3,
    teams: 12, slot: 7, rounds: 16, strategy: 'adaptive', mode: 'sim', variance: 'medium',
    picks: [pick(1, 'a'), pick(2, 'b')], queue: ['q'], profiles: {}, selectedTeam: 7,
  };
  const storage = memoryStorage({ snake: JSON.stringify(legacy) });
  const loaded = S.safeLoad(storage, 'snake', 'snake');
  assert.ok(loaded.ok, `legacy migration failed: ${(loaded.issues || []).join(', ')}`);
  assert.strictEqual(loaded.migrated, true);
  assert.strictEqual(loaded.envelope.schemaVersion, S.SCHEMA_VERSION);
  assert.strictEqual(loaded.payload.picks[1].key, 'b');
})();

(() => {
  const duplicatePlayer = S.validateSnakeSession({ teams: 12, slot: 1, rounds: 16, picks: [pick(1, 'a'), pick(2, 'a')] });
  assert.ok(!duplicatePlayer.valid);
  assert.ok(duplicatePlayer.issues.some(i => /appears more than once/.test(i)));

  const duplicatePick = S.validateSnakeSession({ teams: 12, slot: 1, rounds: 16, picks: [pick(1, 'a'), pick(1, 'b')] });
  assert.ok(!duplicatePick.valid);
  assert.ok(duplicatePick.issues.some(i => /Duplicate pick number/.test(i)));

  const gap = S.validateSnakeSession({ teams: 12, slot: 1, rounds: 16, picks: [pick(1, 'a'), pick(3, 'b')] });
  assert.ok(!gap.valid);
  assert.ok(gap.issues.some(i => /Pick history gap/.test(i)));
})();

(() => {
  const storage = memoryStorage();
  const saved = S.safeSave(storage, 'snake', 'snake', { teams: 12, slot: 1, rounds: 16, picks: [pick(1, 'a')] });
  assert.ok(saved.ok);
  const envelope = JSON.parse(storage.dump('snake'));
  envelope.payload.picks[0].name = 'tampered';
  storage.setItem('snake', JSON.stringify(envelope));
  const loaded = S.safeLoad(storage, 'snake', 'snake');
  assert.ok(!loaded.ok);
  assert.ok(loaded.issues.some(i => /checksum mismatch/.test(i)));
})();

(() => {
  const goodAuction = {
    initialBudget: 200,
    remainingBudget: 145,
    slotsLeft: 15,
    minBid: 1,
    sold: [{ key: 'rb1', playerId: 'rb1', name: 'RB1', position: 'RB', price: 55, winner: 'me' }],
    myRoster: [{ key: 'rb1', playerId: 'rb1', name: 'RB1', position: 'RB', price: 55 }],
  };
  assert.ok(S.validateAuctionSession(goodAuction).valid);
  const badBudget = { ...goodAuction, remainingBudget: 180 };
  const invalid = S.validateAuctionSession(badBudget);
  assert.ok(!invalid.valid);
  assert.ok(invalid.issues.some(i => /does not reconcile/.test(i)));

  const duplicate = {
    ...goodAuction,
    sold: [goodAuction.sold[0], { ...goodAuction.sold[0] }],
  };
  assert.ok(!S.validateAuctionSession(duplicate).valid);
})();

(() => {
  const player = { key: 'wr1', playerId: 'wr1', name: 'WR1', position: 'WR', price: 31 };
  const payload = {
    initialBudget: 200,
    remainingBudget: 169,
    slotsLeft: 1,
    minBid: 1,
    sold: [{ ...player, winner: 'me', teamId: '1' }],
    myRoster: [player],
    mockState: {
      version: 1,
      userTeamId: '1',
      teams: {
        1: { id: '1', name: 'My Team', remainingBudget: 169, slotsLeft: 1, roster: [player], strategy: 'balanced' },
        2: { id: '2', name: 'Team 2', remainingBudget: 200, slotsLeft: 2, roster: [], strategy: 'value' },
      },
      draftedKeys: ['wr1'],
      purchases: [{ teamId: '1', player, price: 31 }],
      nominationIndex: 1,
      nomination: null,
      status: 'RUNNING',
      seed: 29,
    },
  };
  const storage = memoryStorage();
  const saved = S.safeSave(storage, 'auction', 'auction', payload);
  assert.ok(saved.ok, `auction mock save failed: ${(saved.issues || []).join(', ')}`);
  const loaded = S.safeLoad(storage, 'auction', 'auction');
  assert.ok(loaded.ok, `auction mock load failed: ${(loaded.issues || []).join(', ')}`);
  assert.strictEqual(loaded.payload.mockState.purchases.length, 1);
  assert.strictEqual(loaded.payload.mockState.teams['1'].roster[0].key, 'wr1');

  const broken = structuredClone(payload);
  broken.mockState.teams['2'].roster.push(player);
  assert.ok(!S.validateAuctionSession(broken).valid, 'duplicate cross-team player must be rejected');
})();

(() => {
  const exported = S.diagnosticExport('snake', {
    teams: 12, slot: 1, rounds: 16, picks: [],
    sourceSnapshot: { api_key: 'secret-value', token: 'bearer-value', generated_at: 'now' },
  }, { access_token: 'hidden' });
  assert.strictEqual(exported.payload.sourceSnapshot.api_key, '[REDACTED]');
  assert.strictEqual(exported.payload.sourceSnapshot.token, '[REDACTED]');
  assert.strictEqual(exported.access_token, '[REDACTED]');
})();

console.log('draft session reliability tests passed');
