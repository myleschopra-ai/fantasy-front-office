import { chromium } from 'playwright';

const base = process.env.DRAFT_E2E_URL || 'http://127.0.0.1:4173/draft-room-v5.html';
const browser = await chromium.launch({ headless: true });
const presets = [
  { id: 'standard', format: /1QB/, starters: 10 },
  { id: 'superflex', format: /SUPERFLEX/, starters: 11 },
  { id: 'twoqb', format: /2QB/, starters: 10 },
  { id: 'threewr', format: /3WR/, starters: 11 },
  { id: 'tep', format: /1QB/, starters: 10, detail: /FULL PPR.*\+0\.5 TEP/ },
];
const positions = ['WR','RB','QB','TE','K','DST'];
const market = Array.from({ length: 420 }, (_, index) => ({
  player: { sleeperId: `matrix-${index}`, id: `matrix-${index}`, name: `Matrix Player ${index}`, position: positions[index % positions.length], maybeTeam: 'NFL' },
  overallRank: index + 1, rank: index + 1, value: 10000 - index * 20,
}));

try {
  for (const preset of presets) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**://api.fantasycalc.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(market) }));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#board [data-k]').length > 0, null, { timeout: 30000 });
    await page.locator('#settings-open').click();
    await page.locator(`[data-draft-preset="${preset.id}"]`).click();
    await page.locator('#mode').selectOption('companion');
    await page.locator('#settings-done').click();
    await page.waitForFunction(() => document.querySelector('#draft-context')?.innerText.includes('FORMAT'));
    const context = await page.locator('#draft-context').innerText();
    if (!preset.format.test(context)) throw new Error(`${preset.id}: wrong format context: ${context}`);
    if (preset.detail && !preset.detail.test(context.replace(/\n/g, ' '))) throw new Error(`${preset.id}: scoring context missing: ${context}`);
    const slots = await page.locator('#roster .lineup-slot').count();
    if (slots !== preset.starters) throw new Error(`${preset.id}: expected ${preset.starters} starters, found ${slots}`);
    if (errors.length) throw new Error(`${preset.id}: browser errors: ${errors.join(' | ')}`);
    await page.close();
    console.log(`${preset.id}: context and ${slots}-starter lineup passed`);
  }

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.route('**://api.fantasycalc.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(market) }));
  await mobile.goto(base, { waitUntil: 'domcontentloaded' });
  await mobile.waitForFunction(() => document.querySelectorAll('#board [data-k]').length > 0, null, { timeout: 30000 });
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 2) throw new Error(`mobile: horizontal overflow ${overflow}px`);
  if (!(await mobile.locator('#draft-context').isVisible())) throw new Error('mobile: context strip is hidden');
  console.log('mobile: no horizontal overflow and context remains visible');
  await mobile.close();
} finally {
  await browser.close();
}
