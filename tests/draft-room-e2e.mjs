import { chromium } from 'playwright';

// Desktop/tablet Chromium validates the same v5 room and advisor state that
// WebKit exercises. This is deliberately behavior-focused: repeated picks,
// visible draft surface, deterministic need labels, and a real optimized
// starter/bench roster rather than position counts.
const base = process.env.DRAFT_E2E_URL || 'http://127.0.0.1:4173/draft.html';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });

const positions = ['WR','RB','WR','RB','QB','TE','K','DST'];
const mockMarket = Array.from({ length: 360 }, (_, index) => ({
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
  await page.waitForURL(/draft-room-v5\.html/, { timeout: 15000 });
  await page.waitForSelector('#start', { state: 'visible', timeout: 15000 });
  await page.waitForSelector('#board', { state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('#board [data-k]').length > 0, null, { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('.ffo-league-modal'), null, { timeout: 5000 });

  const configuredStarterSlots = await page.evaluate(() => {
    const roster = window.FFO_ACTIVE_LEAGUE?.roster || { QB:1, RB:2, WR:2, TE:1, FLEX:2, K:1, DST:1 };
    return Object.entries(roster)
      .filter(([name, count]) => !['BENCH','BN','TAXI','IR'].includes(name) && Number(count) > 0)
      .map(([name]) => name === 'SF' ? 'SUPER_FLEX' : name);
  });

  const assertAdvisorState = async (label) => {
    const badges = (await page.locator('#board .action-badge').allTextContents()).map(v => v.trim());
    const validNeedLabels = ['STARTER NEED','FLEX NEED','STARTER UPGRADE','DEPTH UPSIDE','DEPTH','LUXURY','SATURATED'];
    if (!badges.some(text => validNeedLabels.includes(text))) {
      throw new Error(`${label}: no deterministic roster-need badge found (${badges.slice(0, 12).join(' / ')})`);
    }
    const contradictions = await page.locator('#board .compact-rec').evaluateAll(rows => rows.flatMap(row => {
      const texts = [...row.querySelectorAll('.action-badge')].map(el => (el.textContent || '').trim());
      return texts.includes('DRAFT NOW') && (texts.includes('LUXURY') || texts.includes('SATURATED')) ? [texts.join(' + ')] : [];
    }));
    if (contradictions.length) throw new Error(`${label}: contradictory advisor action (${contradictions.join(' | ')})`);
    const why = (await page.locator('#why').textContent() || '').trim();
    if (why && !/(fills|projects|starter|depth|slot|prioritize)/i.test(why)) {
      throw new Error(`${label}: recommendation lacks roster consequence explanation (${why})`);
    }
  };

  const assertOptimizedRoster = async (label) => {
    const slots = page.locator('#roster .lineup-slot');
    const slotCount = await slots.count();
    if (slotCount < 4) throw new Error(`${label}: optimized starter view has too few slots (${slotCount})`);
    const slotLabels = await page.locator('#roster .lineup-slot > span:first-child').allTextContents();
    for (const required of configuredStarterSlots) {
      if (!slotLabels.some(labelText => labelText.startsWith(required))) {
        throw new Error(`${label}: missing configured ${required} starter slot (${slotLabels.join(', ')})`);
      }
    }
    const starterNames = (await page.locator('#roster .lineup-slot strong').allTextContents())
      .map(v => v.trim())
      .filter(v => v && v !== 'Empty');
    if (starterNames.some(v => /^\d+$/.test(v))) {
      throw new Error(`${label}: roster regressed to numeric position counts (${starterNames.join(', ')})`);
    }
  };

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
    await assertAdvisorState(label);
    await assertOptimizedRoster(label);
  };

  const timedClick = async (locator, label, maxMs = 8000) => {
    const started = Date.now();
    await locator.click({ timeout: maxMs });
    const elapsed = Date.now() - started;
    if (elapsed > maxMs) throw new Error(`${label}: interaction exceeded ${maxMs}ms (${elapsed}ms)`);
    console.log(`${label}: ${elapsed}ms`);
  };

  await assertSurface('cold boot');
  await timedClick(page.locator('#start'), 'start/reset');
  const startState = await page.evaluate(() => ({ clock: document.querySelector('#clock')?.textContent, error: document.querySelector('#setup-error')?.textContent, errorHidden: document.querySelector('#setup-error')?.hidden, teams: document.querySelector('#teams')?.value, rounds: document.querySelector('#rounds')?.value, mode: document.querySelector('#mode')?.value }));
  console.log('start state:', JSON.stringify(startState));
  await page.waitForFunction(() => /YOU ARE ON THE CLOCK/i.test(document.querySelector('#clock')?.textContent || ''), null, { timeout: 8000 });
  await assertSurface('after start and CPU opening picks');
  const openingAudit = await page.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem('ffo_decision_ledger_v1') || '[]');
    const sessionId = rows.at(-1)?.sessionId;
    const current = rows.filter(row => row.sessionId === sessionId);
    return { captured:current.length, locked:current.filter(row => row.timeLock?.valid).length };
  });
  if (openingAudit.captured !== 1 || openingAudit.locked !== 1) throw new Error(`opening recommendation was not captured and time-locked (${JSON.stringify(openingAudit)})`);
  const workspaceGeometry = await page.evaluate(() => Object.fromEntries(['.app','.board-shell','.main','.workspace','.decision','.players','#board','#board [data-k]','.tabbar'].map(selector => {
    const rect = document.querySelector(selector)?.getBoundingClientRect();
    return [selector,rect ? { top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right,height:rect.height } : null];
  })));
  if (workspaceGeometry['.decision']?.bottom > workspaceGeometry['.players']?.top + 1) throw new Error(`decision surface overlaps the player drawer (${JSON.stringify(workspaceGeometry)})`);
  if (workspaceGeometry['#board [data-k]']?.bottom > workspaceGeometry['.tabbar']?.top) throw new Error(`first player action starts behind bottom navigation (${JSON.stringify(workspaceGeometry)})`);

  for (let i = 1; i <= 4; i += 1) {
    const before = await page.locator('#board-summary').textContent();
    const draftButton = page.locator('#board [data-k]').first();
    await draftButton.waitFor({ state: 'visible', timeout: 8000 });
    await timedClick(draftButton, `user pick ${i}`);
    await page.waitForFunction(() => /YOU ARE ON THE CLOCK/i.test(document.querySelector('#clock')?.textContent || ''), null, { timeout: 8000 });
    await assertSurface(`after full CPU cycle ${i}`);
    const after = await page.locator('#board-summary').textContent();
    if (after === before) throw new Error(`after pick ${i}: board summary did not advance`);
  }

  const forwardAudit = await page.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem('ffo_decision_ledger_v1') || '[]');
    const sessionId = rows.at(-1)?.sessionId;
    const current = rows.filter(row => row.sessionId === sessionId);
    return { captured:current.length,selected:current.filter(row => row.selectedKey).length,unique:new Set(current.map(row => row.id)).size,proof:document.querySelector('#decision-trust')?.textContent || '' };
  });
  if (forwardAudit.captured !== 5 || forwardAudit.selected !== 4 || forwardAudit.unique !== 5 || !/FORWARD AUDIT/i.test(forwardAudit.proof)) throw new Error(`forward decision evidence is incomplete or duplicated (${JSON.stringify(forwardAudit)})`);

  await page.locator('.nav-btn', { hasText: 'Team' }).click();
  await page.waitForSelector('#team-roster-view', { state: 'visible', timeout: 5000 });
  const teamText = await page.locator('#team-roster-view').innerText();
  if (!/QB|RB|WR|TE/.test(teamText) || !/BENCH/.test(teamText)) {
    throw new Error(`team view is not an optimized starter/bench roster: ${teamText.slice(0, 300)}`);
  }

  const summary = await page.locator('#board-summary').textContent();
  if (!summary || !/selection/i.test(summary)) throw new Error(`board summary invalid after multiple picks: ${summary}`);

  console.log('draft room advisor + multi-pick E2E regression passed');
} finally {
  await browser.close();
}
