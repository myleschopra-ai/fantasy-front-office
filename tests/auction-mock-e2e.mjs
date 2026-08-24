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
    await page.locator('#userTeam').fill('1');
    await page.locator('#biddingSeconds').fill('10');
    await page.locator('#bidResetSeconds').fill('5');
    await page.locator('#startMock').click();
    await page.waitForFunction(() => document.querySelector('#mockStatus')?.textContent === 'AWAITING_NOMINATION', null, { timeout: 30000 });
    await page.locator('#search').fill('Bijan');
    const bijan = page.locator('#board [data-k]').first();
    if (!(await bijan.count())) throw new Error(`${profile.name}: Bijan Robinson was not available for the first nomination`);
    await bijan.click();
    await page.locator('#nominateSelected').click();
    await page.waitForFunction(() => document.querySelector('#mockStatus')?.textContent === 'BIDDING');
    const openingBid = await page.evaluate(() => JSON.parse(localStorage.getItem('ffo_auction_session_v4')).payload.mockState.nomination?.bidHistory?.[0]?.amount);
    if (openingBid !== 1) throw new Error(`${profile.name}: nomination did not open at $1`);
    await page.waitForFunction(() => Number((document.querySelector('#lotBid')?.textContent || '').replace(/\D/g,'')) >= 2, null, { timeout:15000 });
    if (await page.locator('#bidLot').isEnabled()) await page.locator('#bidLot').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('ffo_auction_session_v4') || 'null')?.payload?.sold?.length >= 1, null, { timeout: 60000 });
    const firstSale = await page.evaluate(() => {
      const payload = JSON.parse(localStorage.getItem('ffo_auction_session_v4')).payload;
      const sale = payload.mockState.purchases[0], team = payload.mockState.teams[sale.teamId];
      return { name:sale.player.name, price:sale.price, rostered:team.roster.some(player => player.key === sale.player.key), remaining:team.remainingBudget };
    });
    if (!/Bijan/i.test(firstSale.name) || firstSale.price < 1 || !firstSale.rostered || firstSale.remaining !== 200-firstSale.price) throw new Error(`${profile.name}: first timed auction sale did not reconcile`);

    const beforeTen = await page.evaluate(() => JSON.parse(localStorage.getItem('ffo_auction_session_v4')).payload.sold.length);
    await page.locator('#autoTen').click();
    await page.waitForFunction(before => JSON.parse(localStorage.getItem('ffo_auction_session_v4') || 'null')?.payload?.sold?.length >= before + 10, beforeTen, { timeout: 30000 });
    const roomRead = (await page.locator('#tendencies').innerText()).trim();
    if (!/ROOM READ · ACTIVE/i.test(roomRead) || !/11 sales/i.test(roomRead) || !/LIVE-ADAPTING/i.test(roomRead) || !/current-room observations/i.test(roomRead)) throw new Error(`${profile.name}: live room learning did not activate and disclose its evidence after 11 sales (${roomRead})`);

    if (profile.complete) {
      await page.locator('#finishMock').click({ timeout: 120000 });
      try {
        await page.waitForFunction(() => document.querySelector('#mockStatus')?.textContent === 'COMPLETE', null, { timeout: 60000 });
      } catch (error) {
        const stalled = await page.evaluate(() => {
          const payload = JSON.parse(localStorage.getItem('ffo_auction_session_v4') || 'null')?.payload;
          return { status:document.querySelector('#mockStatus')?.textContent, purchases:payload?.mockState?.purchases?.length, recovery:document.querySelector('#auction-recovery-message')?.textContent || '' };
        });
        throw new Error(`desktop: finish did not complete (${JSON.stringify(stalled)})`, { cause:error });
      }
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
