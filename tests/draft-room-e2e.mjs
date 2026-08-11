import { chromium } from 'playwright';

const base = process.env.DRAFT_E2E_URL || 'http://127.0.0.1:4173/draft.html';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });

try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/draft-room-v2\.html|draft-room-v4\.html/, { timeout: 15000 });
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
  };

  await assertSurface('cold boot');
  await page.click('#start');
  await page.waitForTimeout(400);
  await assertSurface('after start');

  for (let i = 1; i <= 3; i += 1) {
    const draftButton = page.locator('#board [data-k]').first();
    await draftButton.waitFor({ state: 'visible', timeout: 15000 });
    await draftButton.click();
    await page.waitForTimeout(500);
    await assertSurface(`after user pick ${i}`);
  }

  console.log('draft room multi-pick E2E regression passed');
} finally {
  await browser.close();
}
