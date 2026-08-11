import { chromium } from 'playwright';

const base = process.env.AUCTION_SESSION_E2E_URL || 'http://127.0.0.1:4173/auction.html';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });

try {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.removeItem('ffo_auction_session_v4'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#board [data-k]').length > 5, null, { timeout: 30000 });

  // Buy one player at a legal, deterministic price.
  await page.locator('#board [data-k]').first().click();
  await page.locator('#currentPrice').fill('1');
  await page.locator('#winner').selectOption('me');
  await page.locator('#record').click();
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('ffo_auction_session_v4');
    if (!raw) return false;
    return JSON.parse(raw)?.payload?.myRoster?.length === 1;
  }, null, { timeout: 10000 });

  // Record an opponent sale as well so league-room state is part of recovery.
  await page.locator('#board [data-k]').first().click();
  await page.locator('#currentPrice').fill('3');
  await page.locator('#winner').selectOption('room');
  await page.locator('#record').click();

  const before = await page.evaluate(() => ({
    envelope: JSON.parse(localStorage.getItem('ffo_auction_session_v4') || 'null'),
    remaining: document.querySelector('#remaining')?.value,
    slots: document.querySelector('#slots')?.value,
    leagueRemaining: document.querySelector('#leagueRemaining')?.value,
    roster: document.querySelector('#roster')?.innerText || '',
    available: document.querySelectorAll('#board [data-k]').length,
  }));

  if (!before.envelope || before.envelope.schemaVersion !== 4 || !before.envelope.checksum) throw new Error('auction session is not a checksummed v4 envelope');
  if (before.envelope.payload.sold.length !== 2) throw new Error(`expected 2 canonical sales, found ${before.envelope.payload.sold.length}`);
  if (before.envelope.payload.myRoster.length !== 1) throw new Error('my roster purchase not persisted');
  const soldKeys = before.envelope.payload.sold.map(s => s.key);
  if (new Set(soldKeys).size !== soldKeys.length) throw new Error('duplicate sold player IDs before reload');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#board [data-k]').length > 5, null, { timeout: 30000 });

  const after = await page.evaluate(() => ({
    envelope: JSON.parse(localStorage.getItem('ffo_auction_session_v4') || 'null'),
    remaining: document.querySelector('#remaining')?.value,
    slots: document.querySelector('#slots')?.value,
    leagueRemaining: document.querySelector('#leagueRemaining')?.value,
    roster: document.querySelector('#roster')?.innerText || '',
    availableKeys: [...document.querySelectorAll('#board [data-k]')].map(el => el.dataset.k),
  }));

  if (errors.length) throw new Error(`auction browser errors: ${errors.join(' | ')}`);
  if (!after.envelope) throw new Error('auction session disappeared after reload');
  if (after.envelope.payload.sold.length !== before.envelope.payload.sold.length) throw new Error('sold history changed on reload');
  if (after.envelope.payload.myRoster.length !== 1) throw new Error('my roster did not restore');
  if (after.remaining !== before.remaining || after.slots !== before.slots || after.leagueRemaining !== before.leagueRemaining) {
    throw new Error(`auction budget/slot state drifted (${before.remaining}/${before.slots}/${before.leagueRemaining} -> ${after.remaining}/${after.slots}/${after.leagueRemaining})`);
  }
  if (after.roster !== before.roster) throw new Error('auction roster display changed after reload');
  for (const key of soldKeys) if (after.availableKeys.includes(String(key))) throw new Error(`sold player ${key} reappeared in available pool`);

  // Resumed auction remains actionable.
  const next = page.locator('#board [data-k]').first();
  await next.click();
  await page.locator('#currentPrice').fill('2');
  await page.locator('#winner').selectOption('room');
  await page.locator('#record').click();
  await page.waitForFunction(count => JSON.parse(localStorage.getItem('ffo_auction_session_v4') || 'null')?.payload?.sold?.length > count, before.envelope.payload.sold.length, { timeout: 10000 });

  console.log('auction refresh/resume passed · budgets, roster and sold pool restored');
} finally {
  await browser.close();
}
