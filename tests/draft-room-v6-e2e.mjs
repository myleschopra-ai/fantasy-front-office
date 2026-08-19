import { chromium } from 'playwright';

const base = process.env.DRAFT_ROOM_V6_URL || 'http://127.0.0.1:4175/draft.html';
const positions = ['WR','RB','QB','TE','WR','RB','K','DST'];
const market = Array.from({ length: 160 }, (_, index) => ({
  player: {
    sleeperId: `room-v6-${index + 1}`,
    id: `room-v6-${index + 1}`,
    name: `Draft Room Player ${index + 1}`,
    position: positions[index % positions.length],
    maybeTeam: ['BUF','KC','PHI','DET','SF','BAL'][index % 6],
  },
  overallRank: index + 1,
  rank: index + 1,
  value: Math.max(100, 9000 - index * 50),
}));

const browser = await chromium.launch({ headless: true });
try {
  for (const profile of [
    { name: 'desktop', viewport: { width: 1440, height: 900 } },
    { name: 'iPhone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    { name: 'iPad', viewport: { width: 834, height: 1194 }, isMobile: true, hasTouch: true },
  ]) {
    const context = await browser.newContext(profile);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**://api.fantasycalc.com/**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(market),
    }));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/draft-room-v5\.html/, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('#board [data-k]').length > 0, null, { timeout: 30000 });

    const state = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
      columns: getComputedStyle(document.querySelector('#board .player-row')).gridTemplateColumns,
      railVisible: Boolean(document.querySelector('#desktop-queue')?.offsetParent),
      navVisible: Boolean(document.querySelector('.tabbar')?.offsetParent),
      boardHeight: document.querySelector('#board-shell')?.getBoundingClientRect().height || 0,
      searchFontSize: parseFloat(getComputedStyle(document.querySelector('#search')).fontSize),
      queueTarget: document.querySelector('#board [data-queue-k]')?.getBoundingClientRect().height || 0,
      draftTarget: document.querySelector('#board [data-k]')?.getBoundingClientRect().height || 0,
      navTarget: document.querySelector('.nav-btn')?.getBoundingClientRect().height || 0,
      tabWidth: document.querySelector('.tabbar')?.getBoundingClientRect().width || 0,
      offenders: [...document.querySelectorAll('body *')].filter(element => {
        const box = element.getBoundingClientRect();
        return box.right > document.documentElement.clientWidth + 1 || box.left < -1;
      }).slice(0, 8).map(element => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.className && typeof element.className === 'string' ? `.${element.className.trim().replace(/\s+/g,'.')}` : ''}`),
    }));
    if (state.width > state.viewport + 1) throw new Error(`${profile.name}: page overflows horizontally (${state.width}/${state.viewport}) via ${state.offenders.join(', ')}`);
    if (!/px/.test(state.columns)) throw new Error(`${profile.name}: player pool is not using the structured grid`);
    if (profile.name === 'desktop' && !state.railVisible) throw new Error('desktop: persistent queue rail is hidden');
    if (profile.name === 'desktop' && state.navVisible) throw new Error('desktop: mobile bottom navigation should be hidden');
    if (profile.name !== 'desktop' && !state.navVisible) throw new Error(`${profile.name}: bottom navigation is hidden`);
    if (profile.name !== 'desktop') {
      if (state.searchFontSize < 16) throw new Error(`${profile.name}: search font can trigger Safari zoom (${state.searchFontSize}px)`);
      if (state.queueTarget < 44 || state.draftTarget < 44 || state.navTarget < 44) throw new Error(`${profile.name}: touch target below 44px (${state.queueTarget}/${state.draftTarget}/${state.navTarget})`);
      if (state.tabWidth < state.viewport * .75) throw new Error(`${profile.name}: bottom navigation is too narrow (${state.tabWidth}/${state.viewport})`);
      if (state.boardHeight > 310) throw new Error(`${profile.name}: compact board consumes too much of the player workspace (${state.boardHeight}px)`);
      await page.locator('.nav-btn[data-nav="board"]').click();
      await page.waitForTimeout(250);
      const expandedHeight = await page.locator('#board-shell').evaluate(element => element.getBoundingClientRect().height);
      if (expandedHeight < state.boardHeight + 100) throw new Error(`${profile.name}: Board view did not materially expand (${state.boardHeight}px -> ${expandedHeight}px)`);
      await page.locator('.nav-btn[data-nav="players"]').click();
    }

    await page.locator('#board [data-queue-k]').first().click();
    const storedQueue = await page.evaluate(() => JSON.parse(localStorage.getItem('ffo_mock_draft_v4') || '{}')?.payload?.queue || []);
    if (storedQueue.length !== 1) throw new Error(`${profile.name}: queue action did not update canonical state`);
    if (profile.name === 'desktop') {
      await page.waitForFunction(() => document.querySelectorAll('#desktop-queue .queue-rail-row').length === 1);
      const count = (await page.locator('#queue-count').textContent() || '').trim();
      if (count !== '1 player') throw new Error(`desktop: queue rail count is stale (${count})`);
    } else {
      await page.locator('.nav-btn[data-nav="queue"]').click();
      if (!await page.locator('#overlay').isVisible()) throw new Error(`${profile.name}: queue did not open in a navigable sheet`);
      if (await page.locator('#queue-view [data-k]').count() !== 1) throw new Error(`${profile.name}: queue sheet does not match canonical queue`);
    }
    if (errors.length) throw new Error(`${profile.name}: page errors ${errors.join(' | ')}`);
    console.log(`${profile.name} Sleeper-inspired draft room passed`);
    await context.close();
  }
} finally {
  await browser.close();
}
