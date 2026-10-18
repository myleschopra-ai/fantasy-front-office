'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const base = process.env.LIVE_WORKSPACE_URL || 'http://127.0.0.1:4185/league-decisions.html';
(async () => {
  const browser = await (process.env.BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true });
  const output = { url: base, browser: process.env.BROWSER || 'chromium', checkedAt: new Date().toISOString(), views: [] };
  try {
    for (const width of [1440, 375]) {
      const context = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : 1000 }, isMobile: width === 375, hasTouch: width === 375 });
      const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(base, { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.FFO_DECISION_STATE?.context, null, { timeout: 120000 });
      for (const tab of ['power', 'trades', 'waivers', 'lineup', 'playoffs', 'capital']) {
        await page.click(`[data-ld-tab="${tab}"]`); const text = await page.locator('#ld-panel').innerText();
        assert(!/undefined|NaN/.test(text), `${tab} emitted invalid values`);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width} ${tab} overflow`);
        output.views.push({ width, tab, text: text.slice(0, 12000) });
      }
      assert.deepEqual(errors, []);
      if (width === 1440) output.evidence = await page.evaluate(() => {
        const { context: c, myId, computed } = FFO_DECISION_STATE;
        return { league: c.league.name, leagueId: c.league.league_id, myId, format: c.format, marketSource: c.market.source, fetchedAt: c.market.fetchedAt,
          rosterCoverage: FFOLeagueDecision.power(c), fuzzy: c.market.fuzzy, unmatched: c.market.unmatched, pickNames: c.market.picks.map(p => ({ name: p.name, value: p.value })),
          recommendations: computed.trades, waivers: computed.waivers?.rows.slice(0, 5), sources: c.sources, playoffState: computed.playoffs };
      });
      await page.click('[data-ld-tab="trades"]');
      fs.mkdirSync(path.join(__dirname, '../artifacts'), { recursive: true });
      await page.screenshot({ path: path.join(__dirname, `../artifacts/live-league-${width}-${output.browser}.png`), fullPage: true });
      await context.close();
    }
    fs.writeFileSync(path.join(__dirname, `../artifacts/live-league-${output.browser}.json`), JSON.stringify(output, null, 2));
    console.log(JSON.stringify({ url: base, browser: output.browser, league: output.evidence.league, views: output.views.length, recommendations: output.evidence.recommendations?.length, market: output.evidence.marketSource, fuzzy: output.evidence.fuzzy.length, playoffState: output.evidence.playoffState }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
