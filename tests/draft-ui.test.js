'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const route = fs.readFileSync(path.join(__dirname, '..', 'draft.html'), 'utf8');
const room = fs.readFileSync(path.join(__dirname, '..', 'draft-room-v2.html'), 'utf8');

assert.match(route, /draft-room-v2\.html/, 'production snake/mock route must open stable Draft Room v2');
assert.match(route, /auction\.html/, 'auction mode must continue to open the validated auction engine');
assert.doesNotMatch(route, /draft-room-v3\.html/, 'production route must not use unstable Draft Room v3');
assert.doesNotMatch(route, /<iframe/i, 'draft route must not create nested iframe layers');
assert.doesNotMatch(route, /document\.write/i, 'draft route must not rewrite its own document');
assert.doesNotMatch(route, /fetch\(/i, 'draft route must not async-bootstrap another page');
assert.match(route, /location\.replace/, 'draft route must use browser-native navigation');

const requiredIds = [
  'mode','teams','slot','rounds','strategy','variance','league-note',
  'start','advance','undo','board-summary','tab-board','tab-team','tab-selections','tab-queue','tab-recommended',
  'draft-grid-view','draft-grid','team-roster-view','selections-view','queue-view','recommended-view',
  'best','why','pick-label','clock','equity','delta','ceiling','breakout','bust','survive','alts',
  'source','pos','search','board','roster','equity-bar','roster-equity','profile',
  'intelligence-status','strategy-playbook','weight-summary','room-status','picks',
  'player-modal-backdrop','player-modal-title','close-player-modal','player-blurb','player-scheme','player-compare'
];
for (const id of requiredIds) {
  assert.match(room, new RegExp(`id=["']${id}["']`), `stable Draft Room v2 must preserve engine DOM contract #${id}`);
}

assert.match(room, /Front Office recommendation/, 'recommendation must be a primary visual surface');
assert.match(room, /Search available players/, 'player search must be immediately visible');
assert.match(room, /Draft context/, 'draft board must remain available as compact context');
assert.match(room, /My Team/, 'roster must be a first-class navigation surface');
assert.match(room, /Advanced model detail/, 'advanced diagnostics must use progressive disclosure');
assert.doesNotMatch(room, /draft-room-polish\.js/, 'stable production room must not load the experimental v3 polish observer');
assert.doesNotMatch(room, /<iframe/i, 'stable room must run the engine directly without another iframe');
assert.match(room, /js\/draft-intelligence\.js/, 'stable room must use the validated valuation engine');
assert.match(room, /js\/mock-draft-v4\.js/, 'stable room must use the validated draft-state engine');

console.log('stable Draft Room v2 production UI contract tests passed');
