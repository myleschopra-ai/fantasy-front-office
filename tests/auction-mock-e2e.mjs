import { chromium } from 'playwright';

const base = process.env.AUCTION_MOCK_E2E_URL || 'http://127.0.0.1:4175/auction.html';
const browser = await chromium.launch({ headless: true });

try {
  for (const profile of [
    { name: 'desktop', viewport: { width: 1440, height: 900 }, complete: true },
    { name: 'iPhone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    { name: 'iPad', viewport: { width: 834, height: 1194 }, isMobile: true, hasTouch: true },
  ]) {
    const context = await browser.newContext(profile);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.removeItem('ffo_auction_session_v4'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#board [data-k]').length > 100, null, { timeout: 30000 });

    const layout = await page.evaluate(() => {
      const targetIds = ['startMock','advanceMock','autoTen','finishMock','nominateSelected','bidLot','passLot'];
      return {
        width: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
        searchFont: parseFloat(getComputedStyle(document.querySelector('#search')).fontSize),
        targetHeights: Object.fromEntries(targetIds.map(id => [id, document.getElementById(id)?.getBoundingClientRect().height || 0])),
        teamCards: document.querySelectorAll('#teamBoard .team-card').length,
      };
    });
    if (layout.width > layout.viewport + 1) throw new Error(`${profile.name}: horizontal overflow (${layout.width}/${layout.viewport})`);
    if (layout.teamCards !== 12) throw new Error(`${profile.name}: expected 12 team cards, found ${layout.teamCards}`);
    if (profile.isMobile) {
      if (layout.searchFont < 16) throw new Error(`${profile.name}: search font can trigger iOS zoom (${layout.searchFont}px)`);
      for (const [id, height] of Object.entries(layout.targetHeights)) {
        if (height < 44) throw new Error(`${profile.name}: ${id} touch target is ${height}px`);
      }
    }

    if (profile.complete) {
      await page.locator('#teamCount').fill('6');
      await page.locator('#userTeam').fill('1');
      await page.evaluate((values) => Object.entries(values).forEach(([id, value]) => { document.getElementById(id).value = String(value); }),
        { rosterQB:1, rosterRB:2, rosterWR:2, rosterTE:1, rosterFLEX:2, rosterSF:0, rosterK:1, rosterDST:1, rosterBench:6 });
    }

    await page.locator('#board [data-k]').first().click();
    if ((await page.locator('#intrinsic').textContent() || '').trim() === '—') throw new Error(`${profile.name}: live valuation did not render`);
    await page.locator('#startMock').click();
    await page.waitForFunction(() => ['AWAITING_USER','AWAITING_NOMINATION'].includes(document.querySelector('#mockStatus')?.textContent), null, { timeout: 30000 });
    if (await page.locator('#passLot').isEnabled()) await page.locator('#passLot').click();
    else {
      await page.locator('#board [data-k]').first().click();
      await page.locator('#nominateSelected').click();
      await page.waitForFunction(() => document.querySelector('#mockStatus')?.textContent === 'AWAITING_USER');
      await page.locator('#passLot').click();
    }
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('ffo_auction_session_v4') || 'null')?.payload?.sold?.length >= 1, null, { timeout: 30000 });

    const beforeTen = await page.evaluate(() => JSON.parse(localStorage.getItem('ffo_auction_session_v4')).payload.sold.length);
    await page.locator('#autoTen').click();
    await page.waitForFunction(before => JSON.parse(localStorage.getItem('ffo_auction_session_v4') || 'null')?.payload?.sold?.length >= before + 10, beforeTen, { timeout: 30000 });

    if (profile.complete) {
      await page.locator('#finishMock').click();
      await page.waitForFunction(() => document.querySelector('#mockStatus')?.textContent === 'COMPLETE', null, { timeout: 60000 });
      const completion = await page.evaluate(() => {
        const payload = JSON.parse(localStorage.getItem('ffo_auction_session_v4')).payload;
        const mock = payload.mockState;
        const rosterKeys = Object.values(mock.teams).flatMap(team => team.roster.map(player => String(player.key)));
        return {
          status: mock.status,
          purchases: mock.purchases.length,
          sold: payload.sold.length,
          expected: Object.keys(mock.teams).length * (mock.teams['1'].roster.length),
          slots: Object.values(mock.teams).map(team => team.slotsLeft),
          budgets: Object.values(mock.teams).map(team => team.remainingBudget),
          unique: new Set(rosterKeys).size,
          rostered: rosterKeys.length,
          visibleCount: document.querySelector('#purchaseCount')?.textContent || '',
        };
      });
      if (completion.status !== 'COMPLETE') throw new Error(`desktop: persisted status is ${completion.status}`);
      if (completion.purchases !== completion.expected || completion.sold !== completion.expected) throw new Error(`desktop: full auction has ${completion.purchases}/${completion.sold} of ${completion.expected} purchases`);
      if (completion.slots.some(value => value !== 0)) throw new Error('desktop: at least one CPU roster is incomplete');
      if (completion.budgets.some(value => value < 0)) throw new Error('desktop: at least one team overspent');
      if (completion.unique !== completion.rostered) throw new Error('desktop: a player appears on multiple rosters');
      if (!completion.visibleCount.includes(`${completion.expected} of ${completion.expected}`)) throw new Error(`desktop: board completion display is stale (${completion.visibleCount})`);
    }
    if (errors.length) throw new Error(`${profile.name}: browser errors ${errors.join(' | ')}`);
    console.log(`${profile.name} auction room passed${profile.complete ? ' · every legal purchase completed' : ' · responsive interactions verified'}`);
    await context.close();
  }
} finally {
  await browser.close();
}
