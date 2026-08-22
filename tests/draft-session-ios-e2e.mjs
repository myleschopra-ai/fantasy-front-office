import { webkit, devices } from 'playwright';
import { readFileSync } from 'node:fs';

const base = process.env.DRAFT_SESSION_IOS_URL || 'http://127.0.0.1:4175/draft.html';
const positions = ['WR','RB','WR','RB','QB','TE','K','DST'];
const market = Array.from({ length: 360 }, (_, index) => ({
  player: {
    sleeperId: `ios-resume-${index + 1}`,
    id: `ios-resume-${index + 1}`,
    name: `iOS Resume ${index + 1}`,
    position: positions[index % positions.length],
    maybeTeam: ['BUF','KC','PHI','DET','SF','BAL'][index % 6],
  },
  overallRank: index + 1,
  rank: index + 1,
  value: Math.max(100, 9000 - index * 45),
}));
const localJson = {
  'draft_intelligence.json': readFileSync(new URL('../data/draft_intelligence.json', import.meta.url), 'utf8'),
  'fantasypros.json': readFileSync(new URL('../fantasypros.json', import.meta.url), 'utf8'),
  'scouting_signals.json': JSON.stringify({ schema_version: 1, players: {} }),
};

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
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**://api.fantasycalc.com/**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(market),
    }));
    await page.route(/\/(draft_intelligence|fantasypros|scouting_signals)\.json(?:\?.*)?$/, route => {
      const filename = new URL(route.request().url()).pathname.split('/').pop();
      return route.fulfill({ status: 200, contentType: 'application/json', body: localJson[filename] });
    });

    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/draft-room-v5\.html/, { timeout: 15000 });
    await page.evaluate(() => localStorage.removeItem('ffo_mock_draft_v4'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#board [data-k]').length > 0, null, { timeout: 30000 });

    await page.locator('#board [data-queue-k]').nth(3).click();
    await page.locator('#start').click();
    await page.waitForFunction(() => /YOU ARE ON THE CLOCK/i.test(document.querySelector('#clock')?.textContent || ''), null, { timeout: 10000 });

    for (let i = 0; i < 2; i += 1) {
      await page.locator('#board [data-k]').first().click();
      await page.waitForFunction(() => /YOU ARE ON THE CLOCK/i.test(document.querySelector('#clock')?.textContent || ''), null, { timeout: 10000 });
    }

    // Explicitly exercise the Safari lifecycle checkpoint path before reload.
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    const before = await page.evaluate(() => {
      const e = JSON.parse(localStorage.getItem('ffo_mock_draft_v4') || 'null');
      return {
        picks: e?.payload?.picks?.map(p => p.key) || [],
        queue: e?.payload?.queue || [],
        roster: document.querySelector('#roster')?.innerText || '',
      };
    });
    if (before.picks.length < 2) throw new Error(`${profile.name}: lifecycle checkpoint did not preserve picks`);
    if (before.queue.length !== 1) throw new Error(`${profile.name}: lifecycle checkpoint did not preserve queue`);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#board [data-k]').length > 0, null, { timeout: 30000 });
    await page.waitForFunction(() => ['RUNNING','COMPLETE'].includes(document.querySelector('#session-status')?.textContent || ''), null, { timeout: 10000 });

    const recoveryVisible = await page.locator('#session-recovery').isVisible();
    if (!recoveryVisible) throw new Error(`${profile.name}: recovered session did not surface recovery banner`);
    const recoveryText = (await page.locator('#session-recovery-message').textContent() || '').trim();
    if (!/Recovered\s+\d+\s+selections/i.test(recoveryText)) {
      throw new Error(`${profile.name}: recovery message is not specific (${recoveryText})`);
    }

    const after = await page.evaluate(() => {
      const e = JSON.parse(localStorage.getItem('ffo_mock_draft_v4') || 'null');
      return {
        picks: e?.payload?.picks?.map(p => p.key) || [],
        queue: e?.payload?.queue || [],
        roster: document.querySelector('#roster')?.innerText || '',
        status: document.querySelector('#session-status')?.textContent || '',
      };
    });
    if (JSON.stringify(after.picks) !== JSON.stringify(before.picks)) throw new Error(`${profile.name}: pick history changed after recovery`);
    if (JSON.stringify(after.queue) !== JSON.stringify(before.queue)) throw new Error(`${profile.name}: queue changed after recovery`);
    if (after.roster !== before.roster) throw new Error(`${profile.name}: optimized roster changed after recovery`);
    if (new Set(after.picks).size !== after.picks.length) throw new Error(`${profile.name}: duplicate player after recovery`);
    if (errors.length) throw new Error(`${profile.name}: browser errors ${errors.join(' | ')}`);

    // Resume is non-destructive and the draft remains actionable.
    await page.locator('#session-resume').click();
    if (await page.locator('#session-recovery').isVisible()) throw new Error(`${profile.name}: Resume did not dismiss recovery banner`);
    const count = after.picks.length;
    await page.locator('#board [data-k]').first().click();
    await page.waitForFunction(previous => {
      const e = JSON.parse(localStorage.getItem('ffo_mock_draft_v4') || 'null');
      return (e?.payload?.picks?.length || 0) > previous;
    }, count, { timeout: 10000 });

    console.log(`${profile.name} WebKit session recovery passed · ${count} picks restored`);
    await context.close();
  }
} finally {
  await browser.close();
}
