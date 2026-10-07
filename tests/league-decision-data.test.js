'use strict';
const assert = require('node:assert/strict');
const { DataService } = require('../js/league-decision-data.js');
(async () => {
  let calls = 0, time = Date.now(); const stored = new Map();
  const storage = { getItem: k => stored.get(k), setItem: (k, v) => stored.set(k, v) };
  const service = new DataService({ interval: 0, now: () => time, storage, fetcher: async () => { calls++; return { ok: true, json: async () => ({ value: 7 }) }; } });
  const [a, b] = await Promise.all([service.get('https://fixture/players', { ttl: 86400000 }), service.get('https://fixture/players', { ttl: 86400000 })]); assert.equal(calls, 1); assert.deepEqual(a, b);
  await service.get('https://fixture/players', { ttl: 86400000 }); assert.equal(calls, 1);
  time += 86400001; await service.get('https://fixture/players', { ttl: 86400000 }); assert.equal(calls, 2);
  let retries = 0; const retry = new DataService({ interval: 0, fetcher: async () => { retries++; return retries < 3 ? { ok: false, status: 503 } : { ok: true, json: async () => [] }; } });
  await retry.get('https://fixture/retry'); assert.equal(retries, 3);
  let active = 0, peak = 0; const batch = new DataService({ interval: 1, fetcher: async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 15)); active--; return { ok: true, json: async () => [] }; } });
  await Promise.all(Array.from({ length: 12 }, (_, i) => batch.get(`https://fixture/${i}`))); assert(peak <= 4);
  const badStorage = new DataService({ interval: 0, storage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); } }, fetcher: async () => ({ ok: true, json: async () => [1] }) });
  assert.deepEqual((await badStorage.get('https://fixture/private', { ttl: 86400000 })).data, [1]);
  console.log('League data contracts passed: request deduplication, 24-hour TTL, retry, bounded concurrency and blocked storage.');
})().catch(e => { console.error(e); process.exitCode = 1; });
