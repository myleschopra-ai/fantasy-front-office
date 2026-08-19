import { chromium } from 'playwright';

const base = process.env.DASHBOARD_E2E_URL || 'http://127.0.0.1:4185/index.html';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.click('#paste-toggle');
  const players = {
    p1:{player_id:'p1',first_name:'Alpha',last_name:'QB',position:'QB',team:'BUF'},
    p2:{player_id:'p2',first_name:'Beta',last_name:'RB',position:'RB',team:'DET'},
    p3:{player_id:'p3',first_name:'Gamma',last_name:'WR',position:'WR',team:'LAR'},
    p4:{player_id:'p4',first_name:'Delta',last_name:'TE',position:'TE',team:'KC'},
    p5:{player_id:'p5',first_name:'Epsilon',last_name:'WR',position:'WR',team:'MIN'},
  };
  const fc = Object.values(players).map((player, index) => ({ player:{ sleeperId:player.player_id,name:`${player.first_name} ${player.last_name}`,position:player.position,maybeTeam:player.team },value:5000-index*500,overallRank:index+1,trend30Day:70-index*10 }));
  const snapshot = {
    fetched_at:new Date().toISOString(),
    league:{league_id:'test',name:'Quality League',season:'2026',total_rosters:1,scoring_settings:{rec:1},settings:{type:0,waiver_budget:100},roster_positions:['QB','RB','WR','TE','BN']},
    rosters:[{roster_id:1,owner_id:'u1',players:['p1','p2','p3','p4'],settings:{waiver_budget_used:10}}],
    users:[{user_id:'u1',display_name:'Quality Team'}],traded_picks:[],all_players:players,fc_data:fc,
  };
  await page.fill('#paste-input', JSON.stringify(snapshot));
  await page.click('#paste-load-btn');
  await page.click('[data-roster-id="1"]');
  await page.waitForSelector('#quality-strip', { state:'visible' });

  for (const tab of ['command','lineup','roster','targets','trade','validation','draft']) {
    await page.click(`[data-tab="${tab}"]`);
    if (!(await page.locator(`#view-${tab}`).isVisible())) throw new Error(`${tab} did not become visible`);
  }
  await page.click('[data-tab="command"]');
  if ((await page.locator('.decision-card').count()) < 1) throw new Error('Command Center produced no ranked decisions');
  await page.click('[data-tab="targets"]');
  if (!/drop/i.test(await page.locator('#targets-list').innerText())) throw new Error('Targets lack matching drop guidance');
  await page.click('[data-tab="validation"]');
  const validationText = await page.locator('#validation-content').innerText();
  if (!/Decision System Gate/i.test(validationText)) throw new Error(`Validation lacks decision gate. Browser errors: ${pageErrors.join(' | ') || 'none'}. Content: ${validationText}`);
  if (pageErrors.length) throw new Error(`Dashboard emitted browser errors: ${pageErrors.join(' | ')}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) throw new Error(`mobile dashboard overflows by ${overflow}px`);
  console.log('all seven dashboard tabs passed mobile decision journey');
} finally {
  await browser.close();
}
