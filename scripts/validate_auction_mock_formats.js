'use strict';

const fs = require('node:fs');
const path = require('node:path');
const D = require('../js/draft-intelligence.js');
const A = require('../js/auction-intelligence.js');
global.FFOAuction = A;
const M = require('../js/auction-mock-engine.js');

const ROOT = path.resolve(__dirname, '..');
const strict = process.argv.includes('--strict');
const outputArg = process.argv.find(arg => arg.startsWith('--output-dir='));
const outputDir = path.resolve(ROOT, outputArg ? outputArg.split('=')[1] : 'reports');
const intelligence = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/draft_intelligence.json'), 'utf8'));

function league(id, overrides = {}) {
  return {
    id, name:id, league_type:'redraft', teams:12,
    scoring:{ reception:.5, te_premium:0, ...(overrides.scoring || {}) },
    roster:{ QB:1,RB:2,WR:2,TE:1,FLEX:2,SUPER_FLEX:0,K:1,DST:1,BENCH:6, ...(overrides.roster || {}) },
    draft:{ format:'auction',budget:200,minimum_bid:1 },
  };
}

function prepare(config) {
  const profile = D.selectProfile(intelligence, config);
  let players = D.enrichPlayers([], profile);
  const supplemental = Object.values(intelligence.profiles || {}).flatMap(item => item.players || []);
  players = D.mergeSupplementalPositions(players, supplemental, config);
  const context = { strategy:'adaptive',league:config,teams:config.teams,round:1,totalRounds:A.rosterSlotCount(config),picks:[],counts:{},targets:D.starterTargets(config),superflex:Boolean(config.roster.SUPER_FLEX),poolSize:players.length,survival:50 };
  const vbd = D.computeVBDPercentiles(players, context);
  players.forEach(player => {
    if (vbd[player.key] != null) player.vbdPercentileScore = vbd[player.key];
    player.leagueValue = D.leagueValueScore(player, context);
    player.projectedPoints = Number(player.projectedPoints ?? player.projected_points) || 0;
  });
  const pricing = A.buildIntrinsicPrices(players, { league:config,valueField:'leagueValue' });
  return { profile, players, pricing };
}

function topAverage(prepared, position, count) {
  const values = prepared.pricing.rows.filter(row => row.player.position === position).slice(0, count).map(row => row.intrinsicPrice);
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function run(config) {
  const prepared = prepare(config);
  const start = Date.now();
  const completed = M.simulateComplete(M.createState({ league:config,players:prepared.players,userTeamId:'7',seed:29,priceMap:prepared.pricing.prices }));
  const validation = M.validateState(completed, { requireComplete:true });
  const overpays = completed.purchases.filter(purchase => purchase.price > purchase.ceilingAtPurchase);
  const projectionCoverage = prepared.players.filter(player => player.projectedPoints > 0).length;
  return {
    config, prepared, completed,
    summary:{
      profile:prepared.profile.id,
      playerCount:prepared.players.length,
      purchases:completed.purchases.length,
      teams:Object.keys(completed.teams).length,
      slotsPerTeam:completed.config.slotsPerTeam,
      valid:validation.valid,
      issues:validation.issues,
      cpuOverpays:overpays.length,
      minStarterValue:Math.min(...Object.values(validation.projectedPointsByTeam)),
      maxStarterValue:Math.max(...Object.values(validation.projectedPointsByTeam)),
      projectionCoverage,
      metric:projectionCoverage === prepared.players.length ? 'projected points' : 'format-adjusted starter value',
      durationMs:Date.now() - start,
    },
  };
}

const formats = {
  oneQB:run(league('1QB · 2WR')),
  superflex:run(league('Superflex', { roster:{ SUPER_FLEX:1,BENCH:5 } })),
  threeWR:run(league('1QB · 3WR', { roster:{ WR:3 } })),
  tePremium:run(league('TE Premium', { scoring:{ reception:1,te_premium:.5 } })),
};
const sensitivity = {
  qbTop10:{ oneQB:topAverage(formats.oneQB.prepared,'QB',10),superflex:topAverage(formats.superflex.prepared,'QB',10) },
  wrTop20:{ twoWR:topAverage(formats.oneQB.prepared,'WR',20),threeWR:topAverage(formats.threeWR.prepared,'WR',20) },
  teTop8:{ base:topAverage(formats.oneQB.prepared,'TE',8),premium:topAverage(formats.tePremium.prepared,'TE',8) },
};
const failures = [];
for (const [name, result] of Object.entries(formats)) {
  if (!result.summary.valid) failures.push(`${name}: ${result.summary.issues.join('; ')}`);
  if (result.summary.purchases !== result.summary.teams * result.summary.slotsPerTeam) failures.push(`${name}: purchase count mismatch`);
  if (result.summary.cpuOverpays) failures.push(`${name}: ${result.summary.cpuOverpays} purchases exceeded CPU ceilings`);
}
if (!(sensitivity.qbTop10.superflex > sensitivity.qbTop10.oneQB * 1.25)) failures.push('Superflex QB premium is too weak');
if (!(sensitivity.wrTop20.threeWR > sensitivity.wrTop20.twoWR)) failures.push('3WR did not increase top-WR prices');
if (!(sensitivity.teTop8.premium > sensitivity.teTop8.base)) failures.push('TE premium did not increase top-TE prices');

const report = {
  generatedAt:new Date().toISOString(),
  verdict:failures.length ? 'FAIL' : 'PASS',
  formats:Object.fromEntries(Object.entries(formats).map(([name, result]) => [name, result.summary])),
  sensitivity,
  limitations:['The current intelligence snapshot has incomplete season-projection coverage; CPU optimization therefore uses format-adjusted league value as its starter-success proxy.'],
  failures,
};
fs.mkdirSync(outputDir, { recursive:true });
fs.writeFileSync(path.join(outputDir, 'auction_mock_validation.json'), `${JSON.stringify(report, null, 2)}\n`);
const lines = [
  '# Auction Mock Validation', '', `Verdict: **${report.verdict}**`, '',
  ...Object.entries(report.formats).map(([name, result]) => `- ${name}: ${result.purchases} purchases, ${result.teams} legal rosters, ${result.cpuOverpays} CPU overpays, ${result.metric}`),
  `- Superflex QB top-10: $${sensitivity.qbTop10.superflex.toFixed(1)} vs $${sensitivity.qbTop10.oneQB.toFixed(1)}`,
  `- 3WR WR top-20: $${sensitivity.wrTop20.threeWR.toFixed(1)} vs $${sensitivity.wrTop20.twoWR.toFixed(1)}`,
  `- TE-premium TE top-8: $${sensitivity.teTop8.premium.toFixed(1)} vs $${sensitivity.teTop8.base.toFixed(1)}`,
  '', '## Limitations', ...report.limitations.map(item => `- ${item}`), '', '## Failures', ...(failures.length ? failures.map(item => `- ${item}`) : ['- None']), '',
];
fs.writeFileSync(path.join(outputDir, 'auction_mock_validation.md'), lines.join('\n'));
console.log(lines.join('\n'));
if (strict && failures.length) process.exit(1);
