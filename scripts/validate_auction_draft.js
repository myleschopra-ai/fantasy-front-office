'use strict';
const fs = require('node:fs');
const path = require('node:path');
const D = require('../js/draft-intelligence.js');
const A = require('../js/auction-intelligence.js');
const ROOT = path.resolve(__dirname, '..');
const strict = process.argv.includes('--strict');
const outArg = process.argv.find((x) => x.startsWith('--output-dir='));
const OUTPUT = path.resolve(ROOT, outArg ? outArg.split('=')[1] : 'reports');
const intel = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/draft_intelligence.json'), 'utf8'));

function league(superflex = false) {
  return {
    name: superflex ? '12-team Half-PPR Superflex Auction' : '12-team Half-PPR 1QB Auction',
    league_type: 'redraft', teams: 12,
    scoring: { reception: 0.5 },
    draft: { format: 'auction', budget: 200, minimum_bid: 1 },
    roster: { QB:1,RB:2,WR:2,TE:1,FLEX:2,SUPER_FLEX:superflex?1:0,K:1,DST:1,BENCH:6 },
  };
}
function context(lg, players, picks=[]) {
  return { league: lg, teams: 12, strategy: 'adaptive', round: 1, totalRounds: 16, picks, counts: D.rosterCounts(picks), targets: D.starterTargets(lg), superflex: !!lg.roster.SUPER_FLEX, poolSize: players.length, survival: 50 };
}
function prepare(lg) {
  const profile = D.selectProfile(intel, lg);
  if (!profile) throw new Error(`No profile for ${lg.name}`);
  let players = D.enrichPlayers([], profile);
  players = D.mergeSupplementalPositions(players, profile.players || [], lg);
  const ctx = context(lg, players);
  return players.map((p) => {
    const e = D.scorePlayer(p, ctx);
    return { ...p, leagueValue: e.leagueValue, playerGrade: e.playerGrade, draftEvaluation: e };
  });
}
function build(lg) {
  const players = prepare(lg);
  const prices = A.buildIntrinsicPrices(players, { league: lg, teams: 12, budget: 200, minBid: 1, valueField: 'leagueValue' });
  return { lg, players, prices };
}
function avgTopPosition(result, pos, n=10) {
  const rows = result.prices.rows.filter((r) => r.player.position === pos).slice(0,n);
  return rows.length ? rows.reduce((s,r)=>s+r.intrinsicPrice,0)/rows.length : 0;
}
function topPositionPrice(result, pos) {
  return result.prices.rows.find((r)=>r.player.position===pos)?.intrinsicPrice || 0;
}
function redundancyCheck(result) {
  const ctx = context(result.lg, result.players);
  const qbs = result.players.filter(p=>p.position==='QB').sort((a,b)=>a.overallRank-b.overallRank);
  if(qbs.length<2) return { pass:false, reason:'insufficient QBs' };
  const candidate=qbs[1];
  const basePrice=result.prices.prices[String(candidate.key)] || 1;
  const openEval=D.scorePlayer(candidate,ctx);
  const filledEval=D.scorePlayer(candidate,context(result.lg,result.players,[qbs[0]]));
  const open=A.maxBid({intrinsicPrice:basePrice,remainingBudget:200,slotsLeft:16,minBid:1,need:openEval.components.need,scarcity:60,tierUrgency:60,upside:50,redundancy:0});
  const filled=A.maxBid({intrinsicPrice:basePrice,remainingBudget:200,slotsLeft:15,minBid:1,need:filledEval.components.need,scarcity:60,tierUrgency:60,upside:50,redundancy:Math.max(0,50-filledEval.components.need)*2});
  return {player:candidate.name,intrinsicPrice:basePrice,openMaxBid:open,afterEliteQBMaxBid:filled,pass:filled<open};
}
function endgameCheck() {
  const cap=A.maximumLegalBid({remainingBudget:12,slotsLeft:4,minBid:1});
  const bid=A.maxBid({intrinsicPrice:20,remainingBudget:12,slotsLeft:4,minBid:1,need:90,scarcity:90,tierUrgency:90,upside:80,redundancy:0});
  return {legalMax:cap,recommendedMax:bid,pass:bid<=cap&&cap===9};
}
const one=build(league(false));
const sf=build(league(true));
const totalExpected=one.prices.config.totalBudget;
const kTop=topPositionPrice(one,'K'), dstTop=topPositionPrice(one,'DST');
const q1=avgTopPosition(one,'QB'), qsf=avgTopPosition(sf,'QB');
const redundancy=redundancyCheck(one), endgame=endgameCheck();
const failures=[];
if(Math.abs(one.prices.totalAssigned-totalExpected)>1) failures.push(`1QB intrinsic auction dollars do not conserve budget: ${one.prices.totalAssigned} vs ${totalExpected}`);
if(Math.abs(sf.prices.totalAssigned-sf.prices.config.totalBudget)>1) failures.push('Superflex intrinsic auction dollars do not conserve budget');
if(!(qsf>q1*1.25)) failures.push(`Superflex QB prices did not rise materially: ${q1.toFixed(1)} -> ${qsf.toFixed(1)}`);
if(kTop>8) failures.push(`K auction price too high: $${kTop}`);
if(dstTop>8) failures.push(`DST auction price too high: $${dstTop}`);
if(!redundancy.pass) failures.push('1QB redundancy did not reduce second-QB max bid');
if(!endgame.pass) failures.push('Endgame legal-bid reserve failed');
const report={generatedAt:new Date().toISOString(),verdict:failures.length?'FAIL':'PASS',oneQB:{totalAssigned:one.prices.totalAssigned,totalBudget:totalExpected,topQBAvg:q1,topK:kTop,topDST:dstTop},superflex:{totalAssigned:sf.prices.totalAssigned,totalBudget:sf.prices.config.totalBudget,topQBAvg:qsf},qbInflation:q1?qsf/q1:null,redundancy,endgame,failures};
fs.mkdirSync(OUTPUT,{recursive:true});
fs.writeFileSync(path.join(OUTPUT,'auction_validation_current.json'),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(OUTPUT,'auction_validation_current.md'),`# Auction Draft Validation\n\nVerdict: **${report.verdict}**\n\n- 1QB allocated: $${one.prices.totalAssigned} / $${totalExpected}\n- Superflex allocated: $${sf.prices.totalAssigned} / $${sf.prices.config.totalBudget}\n- Top-10 QB avg: 1QB $${q1.toFixed(1)} → Superflex $${qsf.toFixed(1)}\n- Top K: $${kTop}; Top DST: $${dstTop}\n- 1QB redundancy: ${redundancy.pass?'PASS':'FAIL'} (${redundancy.openMaxBid} → ${redundancy.afterEliteQBMaxBid})\n- Endgame reserve: ${endgame.pass?'PASS':'FAIL'}\n- Failures: ${failures.length?failures.join('; '):'None'}\n`);
console.log(fs.readFileSync(path.join(OUTPUT,'auction_validation_current.md'),'utf8'));
if(strict&&failures.length) process.exit(1);
