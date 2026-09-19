'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const styles = ['css/ffo-2.css', 'css/league-decisions.css'].map(file => `/* ${file} */\n${read(file)}`).join('\n');
const files = ['js/league-decision-engine.js', 'js/league-decision-data.js', 'js/ffo-shell.js', 'js/league-decision-ui.js'];
const scripts = files.map(file => {
  let source = read(file);
  if (file === 'js/ffo-shell.js') source = source.replace("$('link[data-ffo2]')", " $('[data-ffo2]')");
  if (/<\/script/i.test(source)) throw new Error(`Unsafe inline script terminator in ${file}`);
  return `<script>\n/* Embedded unchanged except shell inline-style detection: ${file} */\n${source}\n</script>`;
}).join('\n');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>League Decisions · Fantasy Front Office</title>
<meta name="description" content="Format-aware Sleeper league decisions with sourced values, real ownership and explicit evidence limits.">
<base href="https://myleschopra-ai.github.io/fantasy-front-office/">
<style data-ffo2="true">${styles}</style></head><body>
<main class="ld-workspace" id="main-content">
<div class="ld-header"><div><span class="ld-kicker">Fantasy Front Office · Partender</span><h1>Your league. Your next move.</h1><p>One format, six views, evidence behind every decision.</p></div>
<div class="ld-controls"><label for="ld-league">Active Sleeper league<select id="ld-league"><option>Discovering leagues…</option></select></label><label for="ld-team">Your team<select id="ld-team"><option>Waiting for league…</option></select></label><button class="ld-button" id="ld-refresh">Refresh</button><button class="ld-button" id="ld-settings-open">Data settings</button></div></div>
<div id="ld-status" class="ld-status" role="status" aria-live="polite"></div><div id="ld-format" class="ld-format" aria-label="Detected league format"></div><div id="ld-warnings"></div>
<nav id="ld-tabs" class="ld-tabs" role="tablist" aria-label="League decisions"></nav><section id="ld-panel" class="ld-panel" role="tabpanel" tabindex="0"></section>
<details class="ld-details"><summary>Sources, freshness and identity audit</summary><div id="ld-source-list"></div></details>
<p class="ld-muted">Read-only. Values are a market reference; model outputs are labeled. Refresh updates league data; player and market caches expire after one day. Companion draft and legacy dashboard tools stay in the same GitHub site.</p>
<noscript>This dashboard requires JavaScript to load public Sleeper league data.</noscript>
</main>
<dialog id="ld-settings" class="ld-dialog" aria-labelledby="ld-settings-title"><h2 id="ld-settings-title">Data settings</h2><p>Settings are saved in this browser. These public endpoints require no credentials.</p>
<label><input type="checkbox" id="ld-market-flag">Use FantasyCalc’s public market endpoint. Its schema is not a versioned API contract. DynastyProcess is the dynasty fallback.</label>
<label><input type="checkbox" id="ld-projection-flag">Try experimental Sleeper weekly projections. This undocumented endpoint is enabled for new settings and can be turned off here. Missing statistics or unsupported scoring keep the lineup in value-only mode.</label>
<button id="ld-settings-save" class="ld-button ld-primary">Save and reload league</button><form method="dialog"><button class="ld-button" style="margin-top:12px">Cancel</button></form></dialog>
<dialog id="ld-evidence" class="ld-dialog" aria-labelledby="ld-evidence-title"><h2 id="ld-evidence-title">Source and calculation</h2><div id="ld-evidence-content"></div><button class="ld-button" id="ld-evidence-close">Close</button></dialog>
${scripts}
</body></html>\n`;
if (process.argv.includes('--check')) {
  if (read('league-decisions.html') !== html) throw new Error('Standalone workspace is out of date. Run node scripts/build_league_workspace.cjs');
  console.log('Standalone HTML matches tested source modules and shared design.');
} else { fs.writeFileSync(path.join(root, 'league-decisions.html'), html); console.log(`Built self-contained league-decisions.html (${Buffer.byteLength(html)} bytes)`); }
