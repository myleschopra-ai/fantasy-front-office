import { webkit, devices } from 'playwright';

const base = process.env.DRAFT_E2E_URL || 'http://127.0.0.1:4173/draft.html';
const positions = ['WR','RB','WR','RB','QB','TE','K','DST'];
const mockMarket = Array.from({ length: 180 }, (_, index) => ({
  player: {
    sleeperId: `ios-${index + 1}`,
    id: `ios-${index + 1}`,
    name: `iOS Player ${index + 1}`,
    position: positions[index % positions.length],
    maybeTeam: ['BUF','KC','PHI','DET','SF','BAL'][index % 6],
  },
  overallRank: index + 1,
  rank: index + 1,
  value: Math.max(100, 9000 - index * 40),
}));

const browser = await webkit.launch({ headless: true });
const profiles = [
  { name: 'iPhone', context: { ...devices['iPhone 15 Pro'], locale: 'en-US' } },
  { name: 'iPad', context: { ...devices['iPad Pro 11'], locale: 'en-US' } },
];

try {
  for (const profile of profiles) {
    const context = await browser.newContext(profile.context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**://api.fantasycalc.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockMarket) }));

    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/draft-room-v5\.html/, { timeout: 15000 });
    await page.waitForSelector('#start', { state: 'visible', timeout: 15000 });
    await page.waitForSelector('#draft-grid', { state: 'visible', timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('#board [data-k]').length > 0, null, { timeout: 30000 });

    const cssLoaded = await page.evaluate(() => {
      const grid = document.querySelector('.draft-grid-wrap');
      const cell = document.querySelector('.draft-cell:not(.round)');
      const tab = document.querySelector('.tabbar');
      const gs = grid ? getComputedStyle(grid) : null;
      const cs = cell ? getComputedStyle(cell) : null;
      return {
        gridHeight: grid?.getBoundingClientRect().height || 0,
        cellWidth: cell?.getBoundingClientRect().width || 0,
        bg: cs?.backgroundColor || '',
        tabHeight: tab?.getBoundingClientRect().height || 0,
        overflow: gs?.overflowY || '',
      };
    });
    if (cssLoaded.gridHeight < 160) throw new Error(`${profile.name}: draft board too small (${cssLoaded.gridHeight}px)`);
    if (cssLoaded.cellWidth < 75 || cssLoaded.cellWidth > 120) throw new Error(`${profile.name}: draft tile width invalid (${cssLoaded.cellWidth}px)`);
    if (cssLoaded.tabHeight < 45) throw new Error(`${profile.name}: bottom navigation too small (${cssLoaded.tabHeight}px)`);

    await page.locator('#start').click();
    await page.waitForFunction(() => /YOU ARE ON THE CLOCK/i.test(document.querySelector('#clock')?.textContent || ''), null, { timeout: 10000 });

    for (let i = 0; i < 3; i += 1) {
      const first = page.locator('#board [data-k]').first();
      await first.waitFor({ state: 'visible', timeout: 10000 });
      await first.click();
      await page.waitForFunction(() => /YOU ARE ON THE CLOCK/i.test(document.querySelector('#clock')?.textContent || ''), null, { timeout: 10000 });
      if (!(await page.locator('#draft-grid').isVisible())) throw new Error(`${profile.name}: draft board disappeared after pick ${i + 1}`);
      if (!(await page.locator('#board').isVisible())) throw new Error(`${profile.name}: player drawer disappeared after pick ${i + 1}`);
      if (errors.length) throw new Error(`${profile.name}: browser errors: ${errors.join(' | ')}`);
    }

    const horizontalScroll = await page.evaluate(() => {
      const el = document.querySelector('.draft-grid-wrap');
      if (!el) return false;
      const before = el.scrollLeft;
      el.scrollLeft = Math.min(el.scrollWidth - el.clientWidth, before + 180);
      return el.scrollLeft > before || el.scrollWidth <= el.clientWidth;
    });
    if (!horizontalScroll) throw new Error(`${profile.name}: draft board horizontal scrolling failed`);

    console.log(`${profile.name} WebKit draft regression passed`);
    await context.close();
  }
} finally {
  await browser.close();
}
