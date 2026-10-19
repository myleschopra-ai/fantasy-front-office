// Week 6 review regressions: a 12-team Superflex league mid-season with a real
// schedule, live injury designations, byes, a stale-projection case, and a
// selling team. Fixture is synthetic and deterministic.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const base = process.env.DASHBOARD_E2E_URL || 'http://127.0.0.1:4185/index.html';
const slots = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'FLEX', 'SUPER_FLEX', ...Array(15).fill('BN')];
const shape = { QB: 3, RB: 6, WR: 9, TE: 3 };
const players = {};
const fcData = [];
const projections = [];
const rosters = [];
const users = [];
let serial = 0;
for (let team = 1; team <= 12; team += 1) {
  const ids = [];
  // Team 9 is weak and old; teams 1-4 are strong.
  const quality = team === 9 ? 0.72 : team <= 4 ? 1.18 : 1;
  for (const [position, count] of Object.entries(shape)) {
    for (let depth = 0; depth < count; depth += 1) {
      serial += 1;
      const id = `p${serial}`;
      const age = team === 9 ? 29 + (depth % 4) : 23 + ((serial * 7) % 9);
      players[id] = { player_id: id, first_name: `T${team}`, last_name: `${position}${depth + 1}`, position, team: ['BUF', 'KC', 'DET', 'LAR', 'SF'][serial % 5], age, injury_status: null };
      const base = { QB: 19, RB: 13, WR: 12, TE: 8 }[position] * quality * (1 - depth * 0.16);
      projections.push({
        projection_scope: 'weekly', season: 2026, week: 7, name: `T${team} ${position}${depth + 1}`, position, team: players[id].team,
        source_ids: { sleeper: id }, projected_points: Math.round(base * 0.96 * 100) / 100, base_points: Math.round(base * 100) / 100, ros_points: Math.round(base * 100) / 100,
        distribution: { p10: base * 0.4, p50: base * 0.96, p90: base * 1.6 }, availability_probability: 0.96, injury_status: null, bye: false, unavailable_reason: null,
        features: { games_this_season: 5, games_last_2: 2, opportunity_trend: 0, role_absent_weeks: 0 }, data_confidence: { score: 80, label: 'HIGH' },
      });
      fcData.push({ player: { sleeperId: id, name: `T${team} ${position}${depth + 1}`, position, maybeTeam: players[id].team }, value: Math.round(base * 220 * (team === 9 ? 0.8 : 1)), overallRank: serial, trend30Day: 10 });
      ids.push(id);
    }
  }
  rosters.push({ roster_id: team, owner_id: `u${team}`, players: ids, settings: { wins: team <= 4 ? 4 : team === 9 ? 2 : (team % 3) + 1, losses: team <= 4 ? 1 : team === 9 ? 3 : 5 - ((team % 3) + 1), ties: 0, fpts: 600, fpts_decimal: 0, waiver_budget_used: 20 } });
  users.push({ user_id: `u${team}`, display_name: `Manager ${team}` });
}
// Team 9's best WR is ruled out today; its WR2 is on bye.
const idOf = (team, label) => Object.keys(players).find(id => players[id].first_name === `T${team}` && players[id].last_name === label);
players[idOf(9, 'WR1')].injury_status = 'Out';
const bye = projections.find(row => row.source_ids.sleeper === idOf(9, 'WR2'));
Object.assign(bye, { bye: true, unavailable_reason: 'BYE', projected_points: 0, availability_probability: 0 });
// Free agents: a hurt one with a big projection and a healthy one.
players.fa1 = { player_id: 'fa1', first_name: 'Hurt', last_name: 'Runner', position: 'RB', team: 'MIA', age: 24, injury_status: 'Out' };
players.fa2 = { player_id: 'fa2', first_name: 'Healthy', last_name: 'Runner', position: 'RB', team: 'NYG', age: 24, injury_status: null };
for (const id of ['fa1', 'fa2']) {
  projections.push({ projection_scope: 'weekly', season: 2026, week: 7, name: `${players[id].first_name} ${players[id].last_name}`, position: 'RB', team: players[id].team, source_ids: { sleeper: id }, projected_points: 15, base_points: 15.6, ros_points: 15.6, distribution: { p10: 6, p50: 15, p90: 24 }, availability_probability: 0.96, features: { games_this_season: 5, games_last_2: 2, opportunity_trend: 0.1, role_absent_weeks: 0 }, data_confidence: { score: 80, label: 'HIGH' } });
  fcData.push({ player: { sleeperId: id, name: `${players[id].first_name} ${players[id].last_name}`, position: 'RB', maybeTeam: players[id].team }, value: 900, overallRank: 300, trend30Day: 40 });
}
// Round-robin schedule; weeks 1-5 scored, 6-14 ahead.
const matchups = {};
for (let week = 1; week <= 14; week += 1) {
  const rotating = Array.from({ length: 11 }, (_, index) => index + 2);
  const shift = week % 11;
  const order = [1].concat(rotating.slice(shift), rotating.slice(0, shift));
  matchups[week] = [];
  for (let index = 0; index < 6; index += 1) {
    for (const rosterId of [order[index], order[11 - index]]) {
      const strength = rosterId <= 4 ? 140 : rosterId === 9 ? 98 : 120;
      matchups[week].push({ roster_id: rosterId, matchup_id: index + 1, points: week <= 5 ? strength + ((rosterId * week) % 13) : 0 });
    }
  }
}
const snapshot = (projectionWeek, nflWeek) => ({
  fetched_at: new Date().toISOString(),
  league: { league_id: 'season-e2e', name: 'Season League', season: '2026', total_rosters: 12, roster_positions: slots, scoring_settings: { rec: 0.5 },
    settings: { type: 2, waiver_budget: 100, playoff_week_start: 15, playoff_teams: 6, trade_deadline: 11, leg: nflWeek } },
  rosters, users, traded_picks: [], all_players: players, fc_data: fcData,
  weekly_projection_data: { projection_scope: 'weekly', season: 2026, week: projectionWeek, generated_at: new Date().toISOString(), model_version: 'weekly-role-context-v2', players: projections.map(row => ({ ...row, week: projectionWeek })), quality: { status: 'publishable', players: projections.length, usable_players: projections.length, no_lookahead: true } },
  nfl_state: { week: nflWeek, season: '2026', season_type: 'regular' },
  matchups_by_week: matchups,
});

async function load(page, bundle) {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.click('#paste-toggle');
  await page.fill('#paste-input', JSON.stringify(bundle));
  await page.click('#paste-load-btn');
  await page.click('[data-roster-id="9"]');
  await page.waitForSelector('[data-season-headline]');
}

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ name: 'desktop', options: { viewport: { width: 1440, height: 1000 } } }, { name: 'iPhone', options: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } }]) {
    const page = await browser.newPage(viewport.options);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await load(page, snapshot(6, 6));
    const command = await page.locator('#command-content').innerText();
    if (!/Structurally weak|Rebuilder/.test(command)) throw new Error(`${viewport.name}: weak 2-3 team is not classified as selling: ${command.slice(0, 300)}`);
    if (!/deadline in 5 weeks/.test(command)) throw new Error(`${viewport.name}: trade deadline countdown missing`);
    if (!/9 remaining regular-season weeks · league schedule/.test(command)) throw new Error(`${viewport.name}: season model is not using the real remaining schedule`);
    if (/Stale projections/.test(command)) throw new Error(`${viewport.name}: current projections flagged stale`);
    if (/Address [A-Z_]+ first/.test(command)) throw new Error(`${viewport.name}: selling team still told to buy a starter`);
    if (!/Sell window/i.test(command) || !/NEEDS YOUR APPROVAL/.test(command)) throw new Error(`${viewport.name}: sell window action missing or marked reversible`);
    const warRows = await page.locator('[data-war-room] tbody tr').count();
    if (warRows !== 12) throw new Error(`${viewport.name}: war room shows ${warRows} teams`);
    const sellRows = await page.locator('[data-sell-window-row]').count();
    if (!sellRows) throw new Error(`${viewport.name}: no veterans listed in the sell window`);
    if (!/Buyers: Manager [1-4]/.test(await page.locator('[data-sell-window-row]').first().innerText())) throw new Error(`${viewport.name}: sell window does not name a contender buyer`);
    if (/Add (K|DEF) depth/.test(command)) throw new Error(`${viewport.name}: kicker or defense depth requested in a league without those slots`);

    await page.click('[data-tab="lineup"]');
    const lineup = await page.locator('#view-lineup').innerText();
    const starters = lineup.split(/Bench \(/)[0];
    if (/T9 WR1/.test(starters)) throw new Error(`${viewport.name}: a player ruled out today is in the suggested lineup`);
    if (/T9 WR2/.test(starters)) throw new Error(`${viewport.name}: a player on bye is in the suggested lineup`);
    if (!/Out \(live\)/.test(lineup) || !/BYE/.test(lineup)) throw new Error(`${viewport.name}: live availability notes missing`);

    await page.click('[data-tab="targets"]');
    await page.waitForSelector('.target-card');
    const hurt = await page.locator('[data-target-id="fa1"]').innerText().catch(() => '');
    if (hurt && !/Out today|Filtered out|No current lineup gain/.test(hurt)) throw new Error(`${viewport.name}: injured free agent still recommended: ${hurt}`);
    const healthy = await page.locator('[data-target-id="fa2"]').innerText();
    if (!/EDGE/.test(healthy)) throw new Error(`${viewport.name}: healthy free agent lacks an availability reason`);
    const vets = await page.locator('.target-card[data-actionable="true"]').allInnerTexts();
    if (vets.some(text => /TRADE/.test(text) && /Selling team/.test(text))) throw new Error(`${viewport.name}: a blocked veteran is still actionable`);

    await page.click('[data-tab="validation"]');
    if (!/Weekly Scorecard/i.test(await page.locator('#view-validation').innerText())) throw new Error(`${viewport.name}: scorecard block missing`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    if (overflow) throw new Error(`${viewport.name}: page overflows horizontally`);
    if (errors.length) throw new Error(`${viewport.name}: page errors ${errors.join(' | ')}`);
    await page.close();
  }

  // Stale feed: projections for Week 6 while the NFL is in Week 7.
  const stale = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const staleErrors = [];
  stale.on('pageerror', error => staleErrors.push(error.message));
  await load(stale, snapshot(6, 7));
  const staleCommand = await stale.locator('#command-content').innerText();
  if (!/Stale projections/.test(staleCommand) || !/Week 6, but the NFL is in Week 7/.test(staleCommand)) throw new Error('stale projections are not flagged on the Command Center');
  if (/HIGH confidence/.test(staleCommand.split('items need')[0])) throw new Error('stale projections still drive a HIGH-confidence action');
  if (!/PROJECTIONS STALE/.test(await stale.locator('#quality-strip').innerText())) throw new Error('source health strip hides stale projections');
  await stale.click('[data-tab="targets"]');
  await stale.waitForSelector('.target-card');
  const staleTargets = await stale.locator('#view-targets').innerText();
  if (/FAAB \$\d/.test(staleTargets) || !/FAAB bid hidden until projections refresh/.test(staleTargets)) throw new Error('FAAB bids are shown on stale projections');
  if (staleErrors.length) throw new Error(`stale: page errors ${staleErrors.join(' | ')}`);
  console.log('season model, live availability, sell window, and freshness gate passed desktop, iPhone, and stale journeys');
} finally {
  await browser.close();
}
