'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const route = fs.readFileSync(path.join(__dirname, '..', 'draft.html'), 'utf8');
const room = fs.readFileSync(path.join(__dirname, '..', 'draft-room-v5.html'), 'utf8');
const iosRuntime = fs.readFileSync(path.join(__dirname, '..', 'js', 'draft-room-ios-v5.js'), 'utf8');
const sleeperRuntime = fs.readFileSync(path.join(__dirname, '..', 'js', 'draft-room-sleeper-v6.js'), 'utf8');
const sleeperStyles = fs.readFileSync(path.join(__dirname, '..', 'css', 'draft-room-sleeper-v6.css'), 'utf8');
const runtime = fs.readFileSync(path.join(__dirname, '..', 'js', 'mock-draft-v4.js'), 'utf8');
const leagueSwitcher = fs.readFileSync(path.join(__dirname, '..', 'js', 'league-switcher.js'), 'utf8');

assert.match(route, /draft-room-v5\.html/, 'candidate snake/mock route must open promoted iOS-first room');
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
  ,'session-status','provider-sync-status','provider-sync'
];
for (const id of requiredIds) {
  assert.match(room, new RegExp(`id=["']${id}["']`), `redesigned room must preserve engine DOM contract #${id}`);
}

assert.match(room, /Front Office recommendation/, 'recommendation must be a primary visual surface');
assert.match(room, /Search players/, 'player search must be immediately visible');
assert.match(room, /Expand board/, 'board must support compact/expanded modes');
assert.match(room, /data-pos="FLEX"/, 'quick position filters must include FLEX');
assert.match(room, /My Team/, 'roster must be a first-class navigation surface');
assert.match(room, /js\/draft-intelligence\.js/, 'room must use validated valuation engine');
assert.match(room, /js\/draft-review\.js/, 'room must load post-draft review and replay runtime');
assert.match(room, /js\/draft-calibration\.js/, 'room must load bounded local history calibration');
assert.match(room, /js\/mock-draft-v4\.js/, 'room must use validated draft-state engine');
assert.match(room, /css\/draft-room-ios-v5\.css/, 'room must load the iOS-first responsive stylesheet');
assert.match(room, /js\/draft-room-ios-v5\.js/, 'room must load the bounded iOS interaction helper');
assert.match(room, /css\/draft-room-sleeper-v6\.css/, 'room must load the Sleeper-inspired responsive hierarchy');
assert.match(room, /js\/draft-room-sleeper-v6\.js/, 'room must load the bounded draft-room navigation enhancement');
assert.match(room, /id="desktop-queue"/, 'desktop draft room must keep the queue visible');
assert.match(room, /class="player-columns"/, 'desktop player pool must expose table-style scouting columns');
assert.doesNotMatch(room, /<iframe/i, 'room must not introduce nested iframes');

assert.doesNotMatch(iosRuntime, /MutationObserver/, 'iOS helper must not use recursive DOM observation');
assert.doesNotMatch(sleeperRuntime, /MutationObserver/, 'v6 UI helper must not observe or rewrite dynamic draft state');
assert.match(sleeperStyles, /grid-template-columns:\s*minmax\(660px,1fr\) 330px/, 'desktop room must reserve a persistent queue and roster rail');
assert.match(runtime, /function renderDesktopQueue\(/, 'queue rail must be rendered from canonical draft state');
assert.match(runtime, /function approximateSurvival\(/, 'live board must use a cheap survival estimate');
assert.match(runtime, /function survival\(player, runs = 5\)/, 'full Monte Carlo survival must be bounded');
assert.match(runtime, /equityFor\(player, false\)/, 'scrolling player board must avoid full Monte Carlo for every row');
assert.match(runtime, /var\(--pickw,108px\)/, 'draft renderer and CSS must share the same responsive pick width contract');
assert.doesNotMatch(leagueSwitcher, /if \(!league\.provider_league_id\) showSetup/, 'mock boot must not be blocked by automatic provider setup');

console.log('stable Draft Room redesign candidate contract tests passed');
