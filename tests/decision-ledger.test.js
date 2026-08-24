'use strict';
const assert = require('node:assert/strict');
const Ledger = require('../js/decision-ledger.js');

const values = new Map();
const storage = { getItem:key=>values.has(key)?values.get(key):null, setItem:(key,value)=>values.set(key,value) };
const sessionId = 'snake-test';
const first = Ledger.capture({
  sessionId, kind:'snake', decisionNumber:7,
  capturedAt:'2026-08-24T15:00:00Z', sourceGeneratedAt:'2026-08-24T14:00:00Z',
  recommendation:{key:'p1',name:'Player One'}, predictedWinRate:58.5, predictedRange:{low:54,high:63}, wwpa:2.1,
}, storage);
assert.equal(first.timeLock.status,'LOCKED');
assert.equal(Ledger.forSession(sessionId,storage).length,1);

Ledger.capture({sessionId,kind:'snake',decisionNumber:7,sourceGeneratedAt:'2026-08-24T14:00:00Z',recommendation:{key:'p2'}},storage);
assert.equal(Ledger.forSession(sessionId,storage).length,1,'rerenders must update instead of duplicating a decision');
assert.equal(Ledger.forSession(sessionId,storage)[0].recommendation.key,'p2');
Ledger.markSelection(first.id,'p2',storage,'2026-08-24T15:01:00Z');
Ledger.resolve(first.id,{won:true,outcomeAt:'2027-01-10T00:00:00Z',modelPoints:2010,baselinePoints:1940},storage);
const snapshot=Ledger.sessionSnapshot(sessionId,storage);
assert.deepEqual(snapshot.summary,{captured:1,selected:1,followed:1,resolved:1,timeLocked:1,promotionEligible:false});
assert.equal(snapshot.records[0].outcome.won,1);

const future=Ledger.capture({sessionId,kind:'snake',decisionNumber:8,capturedAt:'2026-08-24T15:00:00Z',sourceGeneratedAt:'2026-08-25T15:00:00Z'},storage);
assert.equal(future.timeLock.status,'FAILED');
assert.equal(future.timeLock.valid,false);
console.log('decision-ledger.js tests passed');
