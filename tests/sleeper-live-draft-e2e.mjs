import { chromium } from 'playwright';

const base = process.env.SLEEPER_LIVE_E2E_URL || 'http://127.0.0.1:4180/draft.html';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });

const positions = ['WR','RB','QB','TE','WR','RB','WR','QB'];
const market = Array.from({ length: 120 }, (_, index) => ({
  player: {
    sleeperId: `p${index + 1}`,
    id: `p${index + 1}`,
    name: `Live Player ${index + 1}`,
    position: positions[index % positions.length],
    maybeTeam: ['BUF','KC','PHI','DET'][index % 4],
  },
  overallRank: index + 1,
  rank: index + 1,
  value: 9000 - index * 50,
}));

const draft = {
  draft_id: 'DRAFT-LIVE-1',
  league_id: 'LEAGUE-LIVE-1',
  season: '2026',
  status: 'drafting',
  type: 'snake',
  settings: { rounds: 3, teams: 12 },
  slot_to_roster_id: { '1': 10, '2': 20, '3': 30, '4': 40, '5': 50, '6': 60, '7': 70, '8': 80, '9': 90, '10': 100, '11': 110, '12': 120 },
  draft_order: {},
};

const pick = (number, playerId, rosterId, slot = number) => ({
  draft_id: draft.draft_id,
  pick_no: number,
  round: 1,
  draft_slot: slot,
  roster_id: String(rosterId),
  player_id: playerId,
  picked_by: `user-${rosterId}`,
  metadata: {
    first_name: 'Live', last_name: `Player ${playerId.slice(1)}`, position: positions[(number - 1) % positions.length], team: 'BUF',
  },
});

let providerPicks = [pick(1,'p1',10,1), pick(2,'p2',20,2)];

try {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.route('**://api.fantasycalc.com/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(market),
  }));
  await page.route('https://api.sleeper.app/v1/league/LEAGUE-LIVE-1/drafts', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([draft]),
  }));
  await page.route('https://api.sleeper.app/v1/draft/DRAFT-LIVE-1', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(draft),
  }));
  await page.route('https://api.sleeper.app/v1/draft/DRAFT-LIVE-1/picks', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(providerPicks),
  }));

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/draft-room-v5\.html/, { timeout: 15000 });
  await page.evaluate(() => {
    localStorage.removeItem('ffo_mock_draft_v4');
    localStorage.setItem('ffo_provider_league_ids_v1', JSON.stringify({ 'sleeper-partender-dynasty': 'LEAGUE-LIVE-1' }));
    localStorage.setItem('ffo_active_league_id_v1', 'sleeper-partender-dynasty');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#start', { state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('#board [data-k]').length > 20, null, { timeout: 30000 });
  await page.waitForFunction(() => window.FFO_ACTIVE_LEAGUE?.provider_league_id === 'LEAGUE-LIVE-1', null, { timeout: 10000 });

  await page.selectOption('#mode', 'live');
  await page.locator('#start').click();
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('ffo_mock_draft_v4');
    if (!raw) return false;
    return JSON.parse(raw)?.payload?.picks?.length === 2;
  }, null, { timeout: 30000 });

  let snapshot = await page.evaluate(() => ({
    envelope: JSON.parse(localStorage.getItem('ffo_mock_draft_v4') || 'null'),
    providerStatus: document.querySelector('#provider-sync-status')?.textContent || '',
    syncVisible: getComputedStyle(document.querySelector('#provider-sync')).display !== 'none',
    boardKeys: [...document.querySelectorAll('#board [data-k]')].map(el => el.dataset.k),
  }));
  if (!snapshot.syncVisible) throw new Error('Sleeper sync control is not visible in live mode');
  if (snapshot.envelope.payload.providerDraftId !== 'DRAFT-LIVE-1') throw new Error('provider draft binding not persisted');
  if (snapshot.envelope.payload.providerLeagueId !== 'LEAGUE-LIVE-1') throw new Error('provider league binding not persisted');
  if (snapshot.envelope.payload.picks.map(p => p.key).join(',') !== 'p1,p2') throw new Error('initial confirmed picks not canonical');
  if (!/CURRENT|SYNCED|ADVANCED/.test(snapshot.providerStatus)) throw new Error(`unexpected initial provider status: ${snapshot.providerStatus}`);
  if (snapshot.boardKeys.includes('p1') || snapshot.boardKeys.includes('p2')) throw new Error('confirmed players remained draftable');

  // A Draft button in live mode is advisory only; it must not write a speculative pick.
  await page.locator('#board [data-k]').first().click();
  await page.waitForTimeout(100);
  snapshot = await page.evaluate(() => ({
    count: JSON.parse(localStorage.getItem('ffo_mock_draft_v4') || 'null')?.payload?.picks?.length,
    providerStatus: document.querySelector('#provider-sync-status')?.textContent || '',
  }));
  if (snapshot.count !== 2) throw new Error(`live-mode local click mutated canonical picks (${snapshot.count})`);

  // Provider confirms one more pick. Manual sync must append exactly that pick.
  providerPicks = [...providerPicks, pick(3,'p3',10,3)]; // traded destination: slot 3 pick belongs to roster 10/team 1.
  await page.locator('#provider-sync').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('ffo_mock_draft_v4') || 'null')?.payload?.picks?.length === 3, null, { timeout: 10000 });
  snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem('ffo_mock_draft_v4') || 'null'));
  if (snapshot.payload.picks.map(p => p.key).join(',') !== 'p1,p2,p3') throw new Error('provider extension was not appended exactly once');
  if (snapshot.payload.picks[2].team !== 1) throw new Error(`traded pick destination roster mapped to wrong team (${snapshot.payload.picks[2].team})`);

  // Refresh must restore provider binding and confirmed history, then remain live.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#board [data-k]').length > 20, null, { timeout: 30000 });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('ffo_mock_draft_v4') || 'null')?.payload?.picks?.length === 3, null, { timeout: 15000 });
  snapshot = await page.evaluate(() => ({
    envelope: JSON.parse(localStorage.getItem('ffo_mock_draft_v4') || 'null'),
    mode: document.querySelector('#mode')?.value,
    providerStatus: document.querySelector('#provider-sync-status')?.textContent || '',
  }));
  if (snapshot.mode !== 'live') throw new Error(`live mode did not restore (${snapshot.mode})`);
  if (snapshot.envelope.payload.providerDraftId !== 'DRAFT-LIVE-1') throw new Error('provider draft binding lost on reload');
  if (snapshot.envelope.payload.picks.length !== 3) throw new Error('confirmed picks changed on reload');

  // Provider conflict at pick 2 must fail closed: no local deletion/rewrite.
  providerPicks = [pick(1,'p1',10,1), pick(2,'p9',20,2), pick(3,'p3',10,3)];
  await page.locator('#provider-sync').click();
  await page.waitForFunction(() => /CONFLICT/.test(document.querySelector('#provider-sync-status')?.textContent || ''), null, { timeout: 10000 });
  snapshot = await page.evaluate(() => ({
    envelope: JSON.parse(localStorage.getItem('ffo_mock_draft_v4') || 'null'),
    status: document.querySelector('#provider-sync-status')?.textContent || '',
    title: document.querySelector('#provider-sync-status')?.title || '',
  }));
  if (snapshot.envelope.payload.picks.map(p => p.key).join(',') !== 'p1,p2,p3') throw new Error('conflicting provider history overwrote local canonical picks');
  if (!/pick 2/i.test(`${snapshot.status} ${snapshot.title}`)) throw new Error('conflict location is not visible to user');
  if (errors.length) throw new Error(`browser errors: ${errors.join(' | ')}`);

  console.log('Sleeper live draft E2E passed · confirmed-only mutation · extension · reload · conflict fail-closed');
} finally {
  await browser.close();
}
