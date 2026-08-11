'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'draft.html'), 'utf8');
const mock = fs.readFileSync(path.join(__dirname, '..', 'mock-draft-v4.html'), 'utf8');

assert.match(html, /mock-draft-v4\.html/, 'draft room must load the validated snake/mock engine');
assert.match(html, /auction\.html/, 'draft room must route auction mode to the validated auction engine');
assert.doesNotMatch(html, /<iframe/i, 'draft room must not add another iframe layer around the draft engine');
assert.match(html, /document\.write\(html\)/, 'draft room should write the selected engine directly into the current document');
assert.match(html, /max-height:\$\{embed\?'165px':'220px'\}/, 'embedded desktop draft board must remain compact');
assert.match(html, /max-height:128px/, 'mobile draft board must remain compact');
assert.match(html, /requested==='live'\?'manual':'sim'/, 'live mode must switch the snake engine to manual companion mode');
assert.match(html, /Draft Room failed to load/, 'draft loader must surface an actionable failure state');

for (const id of ['start','advance','undo','board','roster']) {
  assert.match(mock, new RegExp(`id=["']${id}["']`), `native mock engine must retain #${id}`);
}
assert.match(mock, /Start \/ Reset/, 'native draft engine must retain an explicit Start / Reset action');
assert.match(mock, /Available board/, 'native draft engine must retain the player board');
assert.match(mock, /Recommended/, 'native draft engine must retain recommendation navigation');

console.log('draft direct-loader UI regression tests passed');
