import { chromium } from 'playwright';

const base = process.env.DRAFT_LEARNING_E2E_URL || 'http://127.0.0.1:4190';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });

try {
  await page.goto(`${base}/draft-review.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const league = { roster: { QB: 1, RB: 1, WR: 1, TE: 1, FLEX: 1, BENCH: 2 } };
    const picks = [
      { key: 'qb', name: 'QB One', position: 'QB', pick: 1, overallRank: 3, team: 2, mine: true },
      { key: 'rb', name: 'RB One', position: 'RB', pick: 2, overallRank: 10, team: 2, mine: true },
      { key: 'wr', name: 'WR One', position: 'WR', pick: 3, overallRank: 20, team: 2, mine: true },
      { key: 'te', name: 'TE One', position: 'TE', pick: 4, overallRank: 35, team: 2, mine: true },
      { key: 'wr2', name: 'WR Two', position: 'WR', pick: 5, overallRank: 44, team: 2, mine: true },
    ];
    const payload = { teams: 12, slot: 2, rounds: 5, strategy: 'balanced', mode: 'sim', leagueSnapshot: league, picks };
    localStorage.setItem('ffo_mock_draft_v4', JSON.stringify(FFODraftSession.createEnvelope('snake', payload)));
    const archive = [
      { id: 'one', savedAt: '2026-08-10T00:00:00Z', artifact: { configuration: { slot: 2, teams: 12, strategy: 'balanced' }, review: { gradeScore: 80, totalValue: 2, starterValue: 3, benchValue: -1, teamSlot: 2, format: '12-team 1QB', strategy: { selected: 'balanced', observed: 'balanced' }, counterfactuals: [] } } },
      { id: 'two', savedAt: '2026-08-11T00:00:00Z', artifact: { configuration: { slot: 5, teams: 12, strategy: 'hero-rb' }, review: { gradeScore: 90, totalValue: 7, starterValue: 8, benchValue: 1, teamSlot: 5, format: '12-team 1QB', strategy: { selected: 'hero-rb', observed: 'hero-rb' }, counterfactuals: [{ utilityGap: 5 }] } } },
    ];
    localStorage.setItem(FFODraftReview.ARCHIVE_KEY, JSON.stringify(archive));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#compare-results');
  if (!/2/.test(await page.locator('#compare-results').innerText())) throw new Error('archive comparison did not load both drafts');
  await page.selectOption('#compare-slot', '5');
  const filtered = await page.locator('#compare-results').innerText();
  if (!/1/.test(filtered) || !/hero-rb/.test(filtered)) throw new Error(`slot filter did not isolate archived draft: ${filtered}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#compare-slot');
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (mobileOverflow > 1) throw new Error(`mobile comparison page overflows by ${mobileOverflow}px`);
  await page.setViewportSize({ width: 1100, height: 820 });

  await page.goto(`${base}/auction.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.FFOAuction));
  const calibration = await page.evaluate(() => {
    const history = { seasons: [{ purchases: [
      { name: 'A', position: 'RB', rank: 5, price: 60, generic_aav: 50, manager: 'M' },
      { name: 'B', position: 'RB', rank: 15, price: 42, generic_aav: 40, manager: 'M' },
      { name: 'C', position: 'RB', rank: 30, price: 28, generic_aav: 30, manager: 'M' },
    ] }] };
    const model = FFOAuction.leagueModel(history);
    return { model, range: FFOAuction.expectedLeaguePriceRange({ intrinsicPrice: 50, position: 'RB', rank: 5, model }) };
  });
  if (!(calibration.model.overall.mae > 0)) throw new Error('auction calibration MAE missing');
  if (calibration.range.confidence === 'UNMODELED' || calibration.range.low > calibration.range.expected || calibration.range.high < calibration.range.expected) throw new Error('auction confidence interval invalid');
  const twoSeasonHistory = { seasons: [
    { season: 2024, purchases: [{ name: 'A', position: 'RB', rank: 5, price: 55, generic_aav: 50, manager: 'M' }] },
    { season: 2025, purchases: [{ name: 'B', position: 'RB', rank: 5, price: 60, generic_aav: 50, manager: 'M' }] },
  ] };
  await page.locator('#history').fill(JSON.stringify(twoSeasonHistory));
  await page.locator('#apply').click();
  const status = await page.locator('#history-status').innerText();
  const tendencies = await page.locator('#tendencies').innerText();
  if (!/held-out MAE/i.test(status) || !/Leave-one-season-out validation/i.test(tendencies)) throw new Error(`held-out validation is not visible: ${status} | ${tendencies}`);

  console.log('draft learning browser E2E passed · comparisons · filters · auction uncertainty');
} finally {
  await browser.close();
}
