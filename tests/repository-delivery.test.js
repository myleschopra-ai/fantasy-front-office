'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tracked = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean));
const pages = [...tracked].filter(file => !file.includes('/') && file.endsWith('.html'));
let references = 0;
function verifyReference(raw, from) {
  const url = raw.replace(/&amp;/g, '&').trim();
  if (!url || url.includes('${') || url.includes('<%')) return;
  assert(!/^file:|^[A-Za-z]:[\\/]|^https?:\/\/(localhost|127\.0\.0\.1)([:/]|$)/i.test(url), `${from}: developer-only URL ${url}`);
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) return;
  const pathname = decodeURIComponent(url.split(/[?#]/)[0]);
  if (!pathname) return;
  assert(!pathname.startsWith('/'), `${from}: root-relative URL escapes the GitHub Pages project path: ${url}`);
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), pathname));
  assert(tracked.has(resolved), `${from}: dependency/navigation target is not tracked: ${resolved}`);
  assert(fs.existsSync(path.join(root, resolved)), `${from}: missing dependency ${resolved}`);
  references++;
}
for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  // Inspect actual HTML tags, excluding JavaScript strings in inline scripts.
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, tag => tag.slice(0, tag.indexOf('>') + 1));
  for (const match of markup.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi)) verifyReference(match[2], page);
}
const shell = fs.readFileSync(path.join(root, 'js/ffo-shell.js'), 'utf8');
for (const match of shell.matchAll(/href:\s*'([^']+)'/g)) verifyReference(match[1], 'index.html');
for (const required of ['index.html', 'trade-intelligence.html', 'matchup.html', 'draft.html', 'auction.html', 'js/trade-intelligence-v2.js', 'js/matchup-page.js', 'data/weekly_projections.json', 'data/vegas/game-lines.json']) {
  assert(tracked.has(required), `Published application asset is not tracked: ${required}`);
}
assert(![...tracked].some(file => /^(node_modules\/|\.codex-|artifacts\/|data\/raw\/)/.test(file)), 'Development artifacts must not be published as application source');
console.log(`Repository delivery passed: ${pages.length} HTML entry points, ${references} tracked dependencies/navigation links`);
