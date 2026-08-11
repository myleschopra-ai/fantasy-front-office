import { chromium } from 'playwright';

const base = process.env.DRAFT_E2E_URL || 'http://127.0.0.1:4173/draft.html';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });

const positions = ['WR','RB','WR','RB','QB','TE'];
const mockMarket = Array.from({ length: 120 }, (_, index) => ({
  player: {
    sleeperId: `e2e-${index + 1}`,
    id: `e2e-${index + 1}`,
    name: `E2E Player ${index + 1}`,
    position: positions[index % positions.length],
    maybeTeam: ['BUF','KC','PHI','DET','SF','BAL'][index % 6],
  },
  overallRank: index + 1,
  rank: index + 1,
  value: Math.max(100, 9000 - index * 55),
}));

try {
  await page.route('**://api.fantasycalc.com/**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockMarket) });
  });

  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/draft-room-v2\.html|draft-room-v3\.html|draft-room-v4\.html/, { timeout: 15000 });
  await page.waitForSelector('#start', { state: 'visible', timeout: 15000 });
  await page.waitForSelector('#board', { state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('#board [data-k]').length > 0, null, { timeout: 30000 });

  const assertSurface = async (label) => {
    const boardVisible = await page.locator('#draft-grid').isVisible();
    const playersVisible = await page.locator('#board').isVisible();
    const startVisible = await page.locator('#start').isVisible();
    if (!boardVisible || !playersVisible || !startVisible) {
      throw new Error(`${label}: draft surface disappeared (board=${boardVisible}, players=${playersVisible}, start=${startVisible})`);
    }
    const playerRows = await page.locator('#board [data-k]').count();
    if (playerRows < 1) throw new Error(`${label}: no draftable player rows remain visible`);
    if (pageErrors.length) throw new Error(`${label}: browser errors: ${pageErrors.join(' | ')}`);
  };

  await assertSurface('cold boot');
  await page.click('#start');
  await page.waitForTimeout(700);
  await assertSurface('after start');

  for (let i = 1; i <= 3; i += 1) {
    const draftButton = page.locator('#board [data-k]').first();
    await draftButton.waitFor({ state: 'visible', timeout: 15000 });
    await draftButton.click();
    await page.waitForTimeout(800);
    await assertSurface(`after user pick ${i}`);
  }

  const picksText = await page.locator('#board-summary').textContent();
  if (!picksText || !/selection/i.test(picksText)) throw new Error(`board summary did not update after multiple picks: ${picksText}`);

  console.log('draft room multi-pick E2E regression passed');
} finally {
  await browser.close();
}
