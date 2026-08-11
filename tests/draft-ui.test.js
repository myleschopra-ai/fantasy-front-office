'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'draft.html'), 'utf8');
const mock = fs.readFileSync(path.join(__dirname, '..', 'mock-draft-v4.html'), 'utf8');

assert.match(html, /mock-draft-v4\.html/, 'draft route must redirect to the validated snake/mock engine');
assert.match(html, /auction\.html/, 'draft route must redirect auction mode to the validated auction engine');
assert.doesNotMatch(html, /<iframe/i, 'draft route must not add another iframe layer around the engine');
assert.doesNotMatch(html, /document\.write/i, 'draft route must not rewrite its own document at runtime');
assert.doesNotMatch(html, /fetch\(/i, 'draft route must not async-fetch and bootstrap the engine');
assert.match(html, /location\.replace\(target/, 'draft route must use a browser-native navigation to the selected engine');
assert.match(html, /draftMode','manual'/, 'live mode must preserve manual companion intent');
assert.match(html, /params\.set\('embed','1'\)/, 'embedded dashboard route must preserve embed state');

for (const id of ['start','advance','undo','board','roster']) {
  assert.match(mock, new RegExp(`id=["']${id}["']`), `native mock engine must retain #${id}`);
}
assert.match(mock, /Start \/ Reset/, 'native draft engine must retain an explicit Start / Reset action');
assert.match(mock, /Available board/, 'native draft engine must retain the player board');
assert.match(mock, /Recommended/, 'native draft engine must retain recommendation navigation');

console.log('draft native-route UI regression tests passed');
