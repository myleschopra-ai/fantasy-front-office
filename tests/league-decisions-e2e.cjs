'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const { fixture } = require('./fixtures/league-decisions.cjs');
const base = process.env.DASHBOARD_E2E_URL || 'http://127.0.0.1:4185/';
const types = ['redraft', 'dynasty', 'bestball', 'idp'], fixtures = Object.fromEntries(types.map(type => [type, fixture(type)]));
async function mock(page, { marketFailure = false, discoveryFailure = false } = {}) {
  const calls = [];
  await page.route('https://api.sleeper.app/v1/**', async route => {
    const url = new URL(route.request().url()), p = url.pathname; calls.push(p); let data;
    if (discoveryFailure && p.includes('/user/')) return route.fulfill({ status: 404, body: '{}' });
    if (p === '/v1/state/nfl') data = { season: '2026', week: 5, season_type: 'regular' };
    else if (p === '/v1/user/Partender') data = { user_id: 'u1', username: 'Partender' };
    else if (p.includes('/user/u1/leagues/')) data = types.map(t => fixtures[t].league);
    else if (p === '/v1/players/nfl') data = fixtures.idp.players;
    else if (p.includes('/trending/add')) data = fixtures.redraft.trendingAdd;
    else if (p.includes('/trending/drop')) data = fixtures.redraft.trendingDrop;
    else {
      const parts = p.split('/'), ctx = fixtures[parts[3]];
      if (!ctx) return route.fulfill({ status: 404, body: '{}' });
      if (parts.length === 4) data = ctx.league;
      else if (parts[4] === 'rosters') data = ctx.rosters;
      else if (parts[4] === 'users') data = ctx.users;
      else if (parts[4] === 'drafts') data = ctx.drafts;
      else if (parts[4] === 'traded_picks') data = ctx.tradedPicks;
      else if (parts[4] === 'transactions') data = ctx.transactions.filter(t => t.week === Number(parts[5]));
      else if (parts[4] === 'matchups') data = ctx.matchups[parts[5]] || [];
    }
    assert(data !== undefined, `Unmocked route ${p}`);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.route('https://api.fantasycalc.com/**', route => { calls.push(route.request().url()); return route.fulfill({ status: marketFailure ? 503 : 200, contentType: 'application/json', body: JSON.stringify(fixtures.redraft.marketRows) }); });
  await page.route('https://raw.githubusercontent.com/dynastyprocess/**', route => route.fulfill({ contentType: 'text/plain', body: 'player,pos,value_1qb,value_2qb,scrape_date\n' + fixtures.redraft.marketRows.filter(r => r.value !== null).map(r => `"${r.player.name}",${r.player.position},${r.value},${r.value},2026-09-08`).join('\n') }));
  await page.route('https://api.sleeper.com/projections/**', route => { calls.push('experimental-projections'); return route.fulfill({ status: 404, body: '{}' }); });
  return calls;
}
(async () => {
  const browser = await (process.env.BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true });
  try {
    for (const width of [1440, 375]) {
      const context = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : 1000 }, isMobile: width === 375, hasTouch: width === 375 });
      const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => localStorage.setItem('ffo-decision-flags', JSON.stringify({ market: true, projections: false })));
      const calls = await mock(page); await page.goto(new URL('league-decisions.html', base).href, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.FFO_DECISION_STATE?.context.league.league_id === 'redraft', { timeout: 60000 });
      for (const type of types) {
        await page.selectOption('#ld-league', type);
        await page.waitForFunction(t => window.FFO_DECISION_STATE?.context.league.league_id === t, type, { timeout: 60000 });
        for (const tab of ['power', 'trades', 'waivers', 'lineup', 'playoffs', 'capital']) {
          await page.click(`[data-ld-tab="${tab}"]`);
          assert.equal(await page.locator(`[data-ld-tab="${tab}"]`).getAttribute('aria-selected'), 'true');
          const text = await page.locator('#ld-panel').innerText(); assert(text.length > 60); assert(!/undefined|NaN/.test(text), `${type}/${tab}: ${text}`);
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px overflow: ${type}/${tab}`);
          if (tab === 'trades') { assert(await page.locator('[data-offer]').count() > 0); await page.selectOption('#ld-target', 't2p2'); assert(await page.locator('#ld-counteroffers [data-offer]').count() > 0); }
          if (tab === 'lineup') assert(/VALUE ONLY · NO PROJECTIONS/.test(text));
          if (tab === 'playoffs') assert(/5,000/.test(text));
          if (tab === 'waivers') { await page.fill('#ld-waiver-search', 'unvalued'); assert(/Unavailable/.test(await page.locator('#ld-waiver-results').innerText())); assert(!/t1p0/.test(await page.locator('#ld-waiver-results').innerText())); }
        }
      }
      await page.click('[data-ld-tab="power"]'); await page.locator('#ld-panel [data-evidence]').first().click(); assert(await page.locator('#ld-evidence').isVisible()); assert(/Fetched:/.test(await page.locator('#ld-evidence').innerText())); await page.click('#ld-evidence-close');
      await page.click('#ld-settings-open'); await page.check('#ld-projection-flag'); await page.click('#ld-settings-save');
      await page.waitForFunction(() => window.FFO_DECISION_STATE?.context.sources.projections?.status === 'Unavailable', { timeout: 60000 });
      await page.click('[data-ld-tab="lineup"]'); assert(/No projections available/.test(await page.locator('#ld-panel').innerText()));
      assert(calls.includes('experimental-projections'));
      // Rapid switches must never paint the superseded league.
      await page.selectOption('#ld-league', 'dynasty'); await page.selectOption('#ld-league', 'redraft');
      await page.waitForFunction(() => window.FFO_DECISION_STATE?.context.league.league_id === 'redraft', { timeout: 60000 });
      assert.equal(await page.locator('#ld-league').inputValue(), 'redraft');
      assert.equal(calls.filter(p => p === '/v1/players/nfl').length, 1, 'Player DB is shared across league switches');
      assert(calls.some(p => p.includes('isDynasty=false&numQbs=1&numTeams=4&ppr=1')));
      assert(calls.some(p => p.includes('isDynasty=true&numQbs=2&numTeams=4&ppr=1')));
      assert.deepEqual(errors, []);
      fs.mkdirSync(path.join(__dirname, '../artifacts'), { recursive: true });
      await page.screenshot({ path: path.join(__dirname, `../artifacts/league-decisions-${width}-${process.env.BROWSER || 'chromium'}.png`), fullPage: true });
      await context.close();
    }
    const fallbackContext = await browser.newContext(), fallback = await fallbackContext.newPage(); await mock(fallback, { marketFailure: true });
    await fallback.addInitScript(() => localStorage.setItem('ffo-decision-league', JSON.stringify('dynasty')));
    await fallback.goto(new URL('league-decisions.html', base).href); await fallback.waitForFunction(() => window.FFO_DECISION_STATE?.context.market.source === 'DynastyProcess', { timeout: 60000 });
    assert(/Fuzzy match/.test(await fallback.locator('body').innerText()) || await fallback.evaluate(() => FFO_DECISION_STATE.context.market.fuzzy.length > 0));
    await fallbackContext.close();
    const privateContext = await browser.newContext(), privatePage = await privateContext.newPage(), privateErrors = [];
    privatePage.on('pageerror', e => privateErrors.push(e.message)); await mock(privatePage);
    await privatePage.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage disabled', 'SecurityError'); } }));
    await privatePage.goto(new URL('league-decisions.html', base).href); await privatePage.waitForFunction(() => window.FFO_DECISION_STATE?.context, null, { timeout: 60000 });
    assert.deepEqual(privateErrors, []); await privateContext.close();
    const failure = await browser.newPage(); await mock(failure, { discoveryFailure: true }); await failure.goto(new URL('league-decisions.html', base).href); await failure.waitForFunction(() => document.getElementById('ld-status').textContent.includes('Discovery unavailable')); assert.equal(await failure.evaluate(() => window.FFO_DECISION_STATE ?? null), null); await failure.close();
    console.log('League decisions: all six tabs in four formats at desktop/375px; fairness, counteroffers, cache, race, fallback, failed discovery, experimental failure and source dialog passed.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
