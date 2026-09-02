const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'dashboard-quality.css'), 'utf8');
const policy = JSON.parse(fs.readFileSync(path.join(root, 'config', 'dashboard_quality.json'), 'utf8'));

for (const tab of ['command', 'lineup', 'roster', 'targets', 'trade', 'validation', 'draft']) {
  assert.match(index, new RegExp(`data-tab="${tab}"`), `${tab} tab missing`);
  assert.match(index, new RegExp(`id="view-${tab}"`), `${tab} view missing`);
}
assert.match(index, /role="tablist"/);
assert.match(index, /aria-selected/);
assert.match(index, /ArrowLeft/);
assert.match(index, /dashboard-intelligence\.js/);
assert.match(index, /dashboard-observability\.js/);
assert.match(index, /dashboard-quality\.css/);
assert.match(index, /qualityManifest/);
assert.match(index, /data\/weekly_projections\.json/);
assert.match(index, /weeklyProjectionFor/);
assert.match(index, /no-lookahead/);
assert.match(index, /excluded from predictive decisions/);
assert.match(index, /FAAB \$/);
assert.match(index, /lowestDropForTarget/);
assert.match(index, /tradeDecision/);
assert.match(index, /decisionSummaryHTML/);
assert.match(css, /minimum|44px|decision-card|quality-strip/i);
assert.equal(policy.coverage.identity_match_rate, 0.995);
assert.equal(policy.release_policy.require_all_tab_journeys, true);
assert.equal(policy.release_policy.require_held_out_lift_for_weight_increase, true);
assert.ok(policy.performance.lcp_ms <= 2500);
assert.ok(policy.performance.inp_ms <= 200);

console.log('all-tab UX, accessibility, freshness, and release contracts passed');
