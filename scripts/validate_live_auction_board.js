'use strict';
const fs = require('node:fs');
const path = require('node:path');
const D = require('../js/draft-intelligence.js');
const A = require('../js/auction-intelligence.js');

const ROOT = path.resolve(__dirname, '..');
const strict = process.argv.includes('--strict');
const outputArg = process.argv.find((arg) => arg.startsWith('--output-dir='));
const OUTPUT_DIR = path.resolve(ROOT, outputArg ? outputArg.split('=')[1] : 'reports');
const intelligence = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/draft_intelligence.json'), 'utf8'));

function leagueConfig({ superflex = false, wr = 2 } = {}) {
  return {
    name: `12-team half-PPR auction ${superflex ? 'Superflex' : '1QB'} ${wr}WR`,
    league_type: 'redraft', teams: 12, scoring: { reception: .5 },
    roster: { QB:1,RB:2,WR:wr,TE:1,FLEX:2,SUPER_FLEX:superflex?1:0,K:1,DST:1,BENCH:6 },
    draft: { format:'auction', budget:200, minimum_bid:1 },
  };
}
function ctx(league, players, picks=[]) { return { strategy:'adaptive',league,teams:12,round:picks.length+1,totalRounds:A.rosterSlotCount(league),picks,counts:D.rosterCounts(picks),targets:D.starterTargets(league),superflex:Number(league.roster.SUPER_FLEX||0)>0,poolSize:players.length,survival:50 }; }
function identity(p){ return String(p.key || `${D.normalizeName(p.name)}|${p.position}`); }
function prepare(league){
  const profile=D.selectProfile(intelligence,league); if(!profile) throw new Error(`No profile for ${league.name}`);
  let players=D.enrichPlayers([],profile); players=D.mergeSupplementalPositions(players,profile.players||[],league);
  const context=ctx(league,players);
  for(const p of players) p.leagueValue=D.leagueValueScore(p,context);
  const auction=A.buildIntrinsicPrices(players,{league,teams:12,budget:200,minBid:1,valueField:'leagueValue'});
  const priceMap=new Map(auction.rows.map(r=>[identity(r.player),r.intrinsicPrice]));
  return {league,profile,players,context,auction,priceMap};
}
function avg(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;}
function positionPrices(result,pos,n=10){return result.auction.rows.filter(r=>r.player.position===pos).slice(0,n).map(r=>r.intrinsicPrice);}
function formatSummary(result){
  const rows=result.auction.rows, cfg=result.auction.config;
  const byPos={}; for(const pos of ['QB','RB','WR','TE','K','DST']) byPos[pos]=rows.filter(r=>r.player.position===pos).length;
  const maxByPos={}; for(const pos of Object.keys(byPos)) maxByPos[pos]=Math.max(0,...rows.filter(r=>r.player.position===pos).map(r=>r.intrinsicPrice));
  return {profileId:result.profile.id,playerCount:result.players.length,draftableCount:rows.length,totalBudget:cfg.totalBudget,totalAssigned:result.auction.totalAssigned,replacementValue:result.auction.replacementValue,countsByPosition:byPos,maxPriceByPosition:maxByPos,top15:rows.slice(0,15).map(r=>({name:r.player.name,position:r.player.position,price:r.intrinsicPrice,leagueValue:Number(r.value.toFixed(2))}))};
}
function qbRedundancy(oneQB,superflex){
  const oneQBs=oneQB.players.filter(p=>p.position==='QB').sort((a,b)=>a.overallRank-b.overallRank);
  const q1=oneQBs[0], q2=oneQBs[1];
  const sfQ2=superflex.players.find(p=>identity(p)===identity(q2))||superflex.players.filter(p=>p.position==='QB').sort((a,b)=>a.overallRank-b.overallRank)[1];
  const oneEval=D.scorePlayer(q2,ctx(oneQB.league,oneQB.players,[q1]));
  const sfQ1=superflex.players.find(p=>identity(p)===identity(q1))||superflex.players.filter(p=>p.position==='QB').sort((a,b)=>a.overallRank-b.overallRank)[0];
  const sfEval=D.scorePlayer(sfQ2,ctx(superflex.league,superflex.players,[sfQ1]));
  const onePrice=oneQB.priceMap.get(identity(q2))||1, sfPrice=superflex.priceMap.get(identity(sfQ2))||1;
  const oneMax=A.maxBid({intrinsicPrice:onePrice,remainingBudget:150,slotsLeft:12,minBid:1,need:oneEval.components.need,scarcity:50,tierUrgency:50,upside:50,redundancy:Math.max(0,(50-oneEval.components.need)*2)});
  const sfMax=A.maxBid({intrinsicPrice:sfPrice,remainingBudget:150,slotsLeft:12,minBid:1,need:sfEval.components.need,scarcity:50,tierUrgency:50,upside:50,redundancy:Math.max(0,(50-sfEval.components.need)*2)});
  return {player:q2.name,oneQB:{intrinsic:onePrice,need:oneEval.components.need,maxBid:oneMax},superflex:{intrinsic:sfPrice,need:sfEval.components.need,maxBid:sfMax},pass:sfMax>oneMax&&sfEval.components.need>oneEval.components.need};
}
function main(){
  const oneQB=prepare(leagueConfig()), superflex=prepare(leagueConfig({superflex:true})), threeWR=prepare(leagueConfig({wr:3}));
  const failures=[];
  for(const [label,result] of Object.entries({oneQB,superflex,threeWR})){
    const cfg=result.auction.config;
    if(Math.abs(result.auction.totalAssigned-cfg.totalBudget)>.5) failures.push(`${label}: auction dollars do not conserve (${result.auction.totalAssigned} vs ${cfg.totalBudget})`);
    if(result.auction.rows.some(r=>r.intrinsicPrice<cfg.minBid)) failures.push(`${label}: player priced below minimum bid`);
    if(result.auction.rows[0]?.intrinsicPrice>cfg.budget*.40+.1) failures.push(`${label}: top player exceeds configured 40% budget ceiling`);
  }
  const oneSummary=formatSummary(oneQB), sfSummary=formatSummary(superflex), wrSummary=formatSummary(threeWR);
  if(oneSummary.countsByPosition.K<12) failures.push(`oneQB: only ${oneSummary.countsByPosition.K} kickers priced; need at least 12 for required K slots`);
  if(oneSummary.countsByPosition.DST<12) failures.push(`oneQB: only ${oneSummary.countsByPosition.DST} defenses priced; need at least 12 for required DST slots`);
  if(oneSummary.maxPriceByPosition.K>10) failures.push(`oneQB: kicker price too high ($${oneSummary.maxPriceByPosition.K})`);
  if(oneSummary.maxPriceByPosition.DST>10) failures.push(`oneQB: DST price too high ($${oneSummary.maxPriceByPosition.DST})`);
  const qb1=avg(positionPrices(oneQB,'QB',10)), qbSF=avg(positionPrices(superflex,'QB',10));
  if(!(qbSF>qb1*1.25)) failures.push(`Superflex QB auction premium too weak (${qb1?.toFixed(1)} -> ${qbSF?.toFixed(1)})`);
  const wr2=avg(positionPrices(oneQB,'WR',20)), wr3=avg(positionPrices(threeWR,'WR',20));
  if(!(wr3>wr2)) failures.push(`3WR did not raise top-WR auction value (${wr2?.toFixed(1)} -> ${wr3?.toFixed(1)})`);
  const redundancy=qbRedundancy(oneQB,superflex); if(!redundancy.pass) failures.push('1QB/Superflex second-QB max-bid differentiation failed');
  const report={generatedAt:new Date().toISOString(),verdict:failures.length?'FAIL':'PASS',formats:{oneQB:oneSummary,superflex:sfSummary,threeWR:wrSummary},sensitivity:{qbTop10Avg:{oneQB:qb1,superflex:qbSF},wrTop20Avg:{twoWR:wr2,threeWR:wr3}},qbRedundancy:redundancy,failures};
  fs.mkdirSync(OUTPUT_DIR,{recursive:true}); fs.writeFileSync(path.join(OUTPUT_DIR,'auction_validation_current.json'),JSON.stringify(report,null,2));
  const md=['# Auction Validation — Current','',`Generated: ${report.generatedAt}`,`Verdict: **${report.verdict}**`,'',`- 1QB dollars: ${oneQB.auction.totalAssigned}/${oneQB.auction.config.totalBudget}`,`- Superflex QB top-10 avg: $${qbSF?.toFixed(1)} vs 1QB $${qb1?.toFixed(1)}`,`- 3WR WR top-20 avg: $${wr3?.toFixed(1)} vs 2WR $${wr2?.toFixed(1)}`,`- K/DST priced: ${oneSummary.countsByPosition.K}/${oneSummary.countsByPosition.DST}; max $${oneSummary.maxPriceByPosition.K}/$${oneSummary.maxPriceByPosition.DST}`,`- Second-QB max bid: 1QB $${redundancy.oneQB.maxBid} vs Superflex $${redundancy.superflex.maxBid}`,'','## Failures',...(failures.length?failures.map(x=>`- ${x}`):['- None'])].join('\n')+'\n';
  fs.writeFileSync(path.join(OUTPUT_DIR,'auction_validation_current.md'),md); console.log(md); if(strict&&failures.length) process.exit(1);
}
main();
