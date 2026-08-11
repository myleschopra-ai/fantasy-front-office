'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const route = fs.readFileSync(path.join(__dirname, '..', 'draft.html'), 'utf8');
const room = fs.readFileSync(path.join(__dirname, '..', 'draft-room-v3.html'), 'utf8');
const polish = fs.readFileSync(path.join(__dirname, '..', 'js', 'draft-room-polish.js'), 'utf8');

assert.match(route, /draft-room-v3\.html/, 'snake/mock route must open Draft Room v3');
assert.match(route, /auction\.html/, 'auction mode must continue to open the validated auction engine');
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
  assert.match(room, new RegExp(`id=["']${id}["']`), `Draft Room v3 must preserve engine DOM contract #${id}`);
}

assert.match(room, /Front Office recommendation/, 'recommendation must remain the primary decision surface');
assert.match(room, /Search available players/, 'player search must be immediately visible');
assert.match(room, /Draft context/, 'compact draft context must remain visible');
assert.match(room, /Expand board/, 'draft board must have an explicit expand/collapse interaction');
assert.match(room, /quick-filters/, 'position quick filters must be first-class controls');
assert.match(room, /My Team/, 'roster must remain a first-class surface');
assert.match(room, /Advanced model detail/, 'advanced diagnostics must remain progressively disclosed');
assert.match(room, /max-height:104px/, 'desktop draft board must stay compact by default');
assert.match(room, /max-height:82px/, 'mobile draft board must stay compact by default');
assert.doesNotMatch(room, /<iframe/i, 'Draft Room v3 must run the engine directly without another iframe');
assert.match(room, /js\/draft-intelligence\.js/, 'Draft Room v3 must use the validated valuation engine');
assert.match(room, /js\/mock-draft-v4\.js/, 'Draft Room v3 must use the validated draft-state engine');
assert.match(room, /js\/draft-room-polish\.js/, 'Draft Room v3 must load its non-invasive polish layer');

assert.match(polish, /gridTemplateColumns=`40px repeat\(\$\{teams\}, var\(--pickw\)\)`/, 'polish layer must repair renderer/CSS draft-column mismatch');
assert.match(polish, /pos-qb/, 'polish layer must position-color draft/player cards');
assert.match(polish, /MutationObserver/, 'polish layer must re-apply decoration after engine renders');
assert.match(polish, /requestAnimationFrame/, 'polish updates must be batched to avoid render thrash');
assert.match(polish, /draftMode.*manual/, 'live companion routing must remain supported');

console.log('Draft Room v3 UI contract tests passed');
