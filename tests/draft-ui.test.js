'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'draft.html'), 'utf8');

for (const id of ['room-frame','start-draft','advance-draft','turn-state','clock','mode-badge']) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `draft room must expose #${id}`);
}
for (const mode of ['mock','live','auction']) {
  assert.match(html, new RegExp(`data-mode=["']${mode}["']`), `draft room must expose ${mode} mode`);
}
for (const tab of ['board','recommended','queue','team']) {
  assert.match(html, new RegExp(`data-child-tab=["']${tab}["']`), `mobile draft nav must expose ${tab}`);
}
assert.match(html, /mock-draft-v4\.html/, 'snake/mock mode must load the validated mock engine');
assert.match(html, /auction\.html/, 'auction mode must load the validated auction engine');
assert.match(html, /getElementById\(['"]start['"]\)\?\.click\(\)/, 'Start Draft must dispatch to the child engine start action');
assert.match(html, /max-height:178px/, 'desktop draftboard must be compact rather than dominate the viewport');
assert.match(html, /max-height:142px/, 'mobile draftboard must be compact');
assert.match(html, /data-child-tab=["']recommended["']>Players</, 'mobile player workspace should follow Sleeper-style Players navigation');

console.log('draft.html Sleeper-style UI smoke tests passed');
