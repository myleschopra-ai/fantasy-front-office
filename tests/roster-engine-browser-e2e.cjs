'use strict';
const { chromium } = require('playwright');

const base = process.env.DASHBOARD_E2E_URL || 'http://127.0.0.1:4185/index.html';
const positions = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'RB', 'WR'];
const allPlayers = {};
const fcData = [];
const projections = [];
const rosters = [];
const users = [];

for (let team = 1; team <= 12; team += 1) {
  const ids = [];
  const teamPositions = team === 2 ? ['QB', 'QB', 'QB', 'RB', 'RB', 'TE', 'TE', 'TE', 'WR'] : positions;
  for (let index = 0; index < teamPositions.length; index += 1) {
    const id = `t${team}p${index + 1}`;
    const position = teamPositions[index];
    const name = `Team${team} ${position}${index + 1}`;
    const projected = team === 2 && position === 'QB' && index === 1 ? 24
      : position === 'QB' ? 20 - team * .1 : position === 'RB' ? 15 - index - team * .05 : position === 'WR' ? 16 - index * .5 - team * .05 : 11 - team * .05;
    ids.push(id);
    allPlayers[id] = { player_id:id, first_name:`Team${team}`, last_name:`${position}${index + 1}`, position, team:'BUF' };
    fcData.push({ player:{ sleeperId:id, name, position, maybeTeam:'BUF' }, value:5000 - index * 250, overallRank:index + 1, trend30Day:0 });
    projections.push({ projection_scope:'weekly', name, position, source_ids:{ sleeper:id }, projected_points:projected, distribution:{ p50:projected } });
  }
  rosters.push({ roster_id:team, owner_id:`u${team}`, players:ids, settings:{ wins:team <= 6 ? 5 : 3, fpts:650 - team * 10 } });
  users.push({ user_id:`u${team}`, display_name:`Team ${team}` });
}
for (const [id, name, position, projected, value] of [
  ['waiver-rb', 'Waiver Upgrade', 'RB', 16.5, 1800],
  ['waiver-wr', 'Waiver Receiver', 'WR', 15.5, 1400],
]) {
  allPlayers[id] = { player_id:id, first_name:name.split(' ')[0], last_name:name.split(' ')[1], position, team:'FA' };
  fcData.push({ player:{ sleeperId:id, name, position, maybeTeam:'FA' }, value, overallRank:250, trend30Day:20 });
  projections.push({ projection_scope:'weekly', name, position, source_ids:{ sleeper:id }, projected_points:projected, distribution:{ p50:projected } });
}

const snapshot = {
  fetched_at:new Date().toISOString(),
  league:{ league_id:'engine-test', name:'Roster Engine League', season:'2026', total_rosters:12,
    scoring_settings:{ rec:1 }, settings:{ type:0, waiver_budget:100, playoff_week_start:15, playoff_teams:6, leg:8 },
    roster_positions:['QB','RB','RB','WR','WR','TE','FLEX','BN','BN'] },
  rosters, users, traded_picks:[], all_players:allPlayers, fc_data:fcData,
  transactions:[{ type:'trade', transaction_id:'trade-1', created:Date.now(), roster_ids:[1,2],
    adds:{ t2p2:1, t1p8:2 }, drops:{ t2p2:2, t1p8:1 }, draft_picks:[] }],
  weekly_projection_data:{ projection_scope:'weekly', week:8, generated_at:new Date().toISOString(), players:projections },
};

(async () => {
  const browser = await chromium.launch({ headless:true });
  try {
    for (const viewport of [
      { name:'desktop', width:1440, height:1000 },
      { name:'iPhone', width:390, height:844 },
      { name:'iPad', width:834, height:1194 },
    ]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/data/weekly_projections.json*', route => route.fulfill({
        contentType:'application/json', body:JSON.stringify({ projection_scope:'weekly', week:8, generated_at:new Date().toISOString(), players:projections }),
      }));
      await page.goto(base, { waitUntil:'domcontentloaded' });
      await page.click('#paste-toggle');
      await page.fill('#paste-input', JSON.stringify(snapshot));
      await page.click('#paste-load-btn');
      await page.click('[data-roster-id="1"]');
      await page.waitForSelector('.rie-executive');
      const command = await page.locator('#command-content').innerText();
      if (!/Championship probability/i.test(command) || !/Primary bottleneck/i.test(command) || !/EWA opportunity/i.test(command)) throw new Error(`${viewport.name}: command engine summary missing`);
      await page.click('[data-tab="targets"]');
      await page.waitForSelector('.target-card');
      const targetText = await page.locator('#view-targets').innerText();
      if (!/candidates evaluated/i.test(targetText) || !/Available now/i.test(targetText) || !/Rostered by Team 2/i.test(targetText) || !/no permanent asset/i.test(targetText)) throw new Error(`${viewport.name}: combined owner-aware target board missing`);
      await page.click('[data-path="WAIVER"]');
      if ((await page.locator('.target-card').count()) < 1 || /Rostered by/i.test(await page.locator('#targets-list').innerText())) throw new Error(`${viewport.name}: waiver filter failed`);
      await page.click('[data-path="TRADE"]');
      if ((await page.locator('[data-build-trade]').count()) < 1) throw new Error(`${viewport.name}: trade paths are not connected to Trade Analyzer`);
      await page.click('[data-tab="roster"]');
      await page.waitForSelector('.rie-bottleneck');
      const diagnostics = await page.locator('#roster-improvement-diagnostics').innerText();
      if (!/attainable improvement/i.test(diagnostics) || !/Starter rank/i.test(diagnostics)) throw new Error(`${viewport.name}: bottleneck diagnostics missing`);
      await page.click('[data-tab="trade"]');
      await page.fill('#trade-search', 'Team1 RB8');
      await page.locator('.add-btn.give').first().click();
      await page.fill('#trade-search', 'Team2 QB2');
      await page.locator('.add-btn.get').first().click();
      const tradeImpact = await page.locator('#trade-championship-impact').innerText();
      if (!/Championship objective/i.test(tradeImpact) || !/ROS EWA/i.test(tradeImpact) || !/Market fairness remains separate/i.test(tradeImpact)) throw new Error(`${viewport.name}: trade outcome lens missing`);
      const rosterImpact = await page.locator('#trade-roster-impact').innerText();
      if (!/Asset Δ PPG/i.test(rosterImpact) || !/Δ VORP/i.test(rosterImpact) || !/Starting-lineup Δ/i.test(rosterImpact)) throw new Error(`${viewport.name}: trade PPG/VORP impact missing`);
      const counterparty = await page.locator('#trade-counterparty-view').innerText();
      if (!/Counter-party view/i.test(counterparty) || !/Team 2/i.test(counterparty) || !/Estimated acceptance/i.test(counterparty)) throw new Error(`${viewport.name}: counter-party analysis missing`);
      if (!/Snapshot FantasyCalc/i.test(await page.locator('#trade-market-source').innerText())) throw new Error(`${viewport.name}: market source label missing`);
      if (!/Probability breakdown/i.test(await page.locator('#trade-partners-list').innerText())) throw new Error(`${viewport.name}: partner acceptance breakdown missing`);
      await page.locator('#trade-analytics-section summary').click();
      const analytics = await page.locator('#trade-analytics-content').innerText();
      if (!/My trade record this season/i.test(analytics) || !/completed trades/i.test(analytics) || !/Team 2/i.test(analytics)) throw new Error(`${viewport.name}: trade analytics missing`);
      if (errors.length) throw new Error(`${viewport.name}: ${errors.join(' | ')}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (overflow > 1) throw new Error(`${viewport.name}: horizontal overflow ${overflow}px`);
      await page.close();
    }
    console.log('roster engine dashboard passed desktop, iPhone, and iPad browser journeys');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
