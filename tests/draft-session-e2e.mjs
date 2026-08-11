import { chromium } from 'playwright';

const base = process.env.DRAFT_SESSION_E2E_URL || 'http://127.0.0.1:4173/draft.html';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const positions = ['WR','RB','WR','RB','QB','TE','K','DST'];
const mockMarket = Array.from({ length: 180 }, (_, index) => ({
  player: {
    sleeperId: `resume-${index + 1}`,
    id: `resume-${index + 1}`,
    name: `Resume Player ${index + 1}`,
    position: positions[index % positions.length],
    maybeTeam: ['BUF','KC','PHI','DET','SF','BAL'][index % 6],
  },
  overallRank: index + 1,
  rank: index + 1,
  value: Math.max(100, 9000 - index * 45),
}));

try {
  await page.route('**://api.fantasycalc.com/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(mockMarket),
  }));

  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/draft-room-v5\.html/, { timeout: 15000 });
  await page.evaluate(() => localStorage.removeItem('ffo_mock_draft_v4'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#start', { state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('#board [data-k]').length > 0, null, { timeout: 30000 });

  // Queue one player before the draft so queue restoration is part of the session contract.
  const queueButton = page.locator('#board [data-queue-k]').nth(4);
  await queueButton.click();
  await page.locator('#start').click();
  await page.waitForFunction(() => /YOU ARE ON THE CLOCK/i.test(document.querySelector('#clock')?.textContent || ''), null, { timeout: 10000 });

  for (let i = 0; i < 3; i += 1) {
    const first = page.locator('#board [data-k]').first();
    await first.waitFor({ state: 'visible', timeout: 10000 });
    await first.click();
    await page.waitForFunction(() => /YOU ARE ON THE CLOCK/i.test(document.querySelector('#clock')?.textContent || ''), null, { timeout: 10000 });
  }

  const before = await page.evaluate(() => {
    const raw = localStorage.getItem('ffo_mock_draft_v4');
    const envelope = JSON.parse(raw || 'null');
    return {
      envelope,
      summary: document.querySelector('#board-summary')?.textContent || '',
      roster: document.querySelector('#roster')?.innerText || '',
      status: document.querySelector('#session-status')?.textContent || '',
    };
  });

  if (!before.envelope || before.envelope.schemaVersion !== 4) throw new Error('session was not persisted as schema v4 envelope');
  if (!before.envelope.checksum) throw new Error('session envelope has no checksum');
  if (before.envelope.payload.picks.length < 3) throw new Error(`too few picks saved (${before.envelope.payload.picks.length})`);
  if (before.envelope.payload.queue.length !== 1) throw new Error(`queue was not saved (${before.envelope.payload.queue.length})`);
  const beforeKeys = before.envelope.payload.picks.map(p => p.key);
  if (new Set(beforeKeys).size !== beforeKeys.length) throw new Error('duplicate players existed before reload');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#start', { state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('#board [data-k]').length > 0, null, { timeout: 30000 });
  await page.waitForFunction(() => ['RUNNING','COMPLETE'].includes(document.querySelector('#session-status')?.textContent || ''), null, { timeout: 10000 });

  const after = await page.evaluate(() => {
    const envelope = JSON.parse(localStorage.getItem('ffo_mock_draft_v4') || 'null');
    return {
      envelope,
      summary: document.querySelector('#board-summary')?.textContent || '',
      roster: document.querySelector('#roster')?.innerText || '',
      status: document.querySelector('#session-status')?.textContent || '',
    };
  });

  if (errors.length) throw new Error(`browser errors after resume: ${errors.join(' | ')}`);
  if (!after.envelope) throw new Error('session disappeared after reload');
  if (after.envelope.payload.picks.length !== before.envelope.payload.picks.length) {
    throw new Error(`pick count changed on reload (${before.envelope.payload.picks.length} -> ${after.envelope.payload.picks.length})`);
  }
  const afterKeys = after.envelope.payload.picks.map(p => p.key);
  if (JSON.stringify(afterKeys) !== JSON.stringify(beforeKeys)) throw new Error('canonical pick order changed on reload');
  if (new Set(afterKeys).size !== afterKeys.length) throw new Error('reload created duplicate players');
  if (after.envelope.payload.queue.length !== 1 || after.envelope.payload.queue[0] !== before.envelope.payload.queue[0]) {
    throw new Error('queue changed on reload');
  }
  if (after.roster !== before.roster) throw new Error('optimized roster changed on reload');
  if (!/selection/i.test(after.summary)) throw new Error(`board summary missing after reload: ${after.summary}`);

  // Continue drafting after recovery. A resumed session must remain actionable.
  const resumedPickCount = after.envelope.payload.picks.length;
  await page.locator('#board [data-k]').first().click();
  await page.waitForFunction(count => {
    const raw = localStorage.getItem('ffo_mock_draft_v4');
    if (!raw) return false;
    const envelope = JSON.parse(raw);
    return envelope?.payload?.picks?.length > count;
  }, resumedPickCount, { timeout: 10000 });

  console.log(`snake refresh/resume passed · ${resumedPickCount} picks restored · status ${after.status}`);
} finally {
  await browser.close();
}
