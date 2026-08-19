'use strict';
const assert = require('node:assert/strict');
const A = require('../js/auction-intelligence.js');

const league = { roster: { QB:1,RB:2,WR:2,TE:1,FLEX:1,K:1,DST:1,BENCH:6 }, draft:{budget:200,minimum_bid:1} };
const cfg = A.compileAuctionConfig({ league, teams:12 });
assert.equal(cfg.slotsPerTeam, 15);
assert.equal(cfg.totalBudget, 2400);
assert.equal(cfg.discretionaryPool, 2220);
assert.equal(A.maximumLegalBid({remainingBudget:200,slotsLeft:15,minBid:1}),186);
assert.equal(A.maximumLegalBid({remainingBudget:17,slotsLeft:3,minBid:1}),15);

const positions=['RB','WR','QB','TE'];
const players=Array.from({length:240},(_,i)=>({key:`p${i}`,name:`P${i}`,position:positions[i%4],leagueValue:100-i*0.35,rank:i+1}));
const prices=A.buildIntrinsicPrices(players,{league,teams:12});
assert.equal(prices.rows.length,180);
assert.ok(Math.abs(prices.totalAssigned-2400)<0.2,`budget must conserve, got ${prices.totalAssigned}`);
assert.ok(prices.rows.every(r=>r.intrinsicPrice>=1));
assert.ok(prices.rows[0].intrinsicPrice>prices.rows[100].intrinsicPrice);
assert.ok(prices.rows[0].intrinsicPrice<=80.1);
const threeWrLeague={...league,roster:{...league.roster,WR:3}};
const threeWrPrices=A.buildIntrinsicPrices(players,{league:threeWrLeague,teams:12});
const topWr=(result)=>result.rows.filter(row=>row.player.position==='WR').slice(0,20).reduce((sum,row)=>sum+row.intrinsicPrice,0)/20;
assert.ok(topWr(threeWrPrices)>topWr(prices),'a third required WR must raise top-WR auction prices');
assert.ok(Math.abs(threeWrPrices.totalAssigned-2400)<0.2,'3WR prices must conserve the room budget');
const tePremiumLeague={...league,scoring:{reception:1,te_premium:.5}};
const tePremiumPrices=A.buildIntrinsicPrices(players,{league:tePremiumLeague,teams:12});
const topTe=(result)=>result.rows.filter(row=>row.player.position==='TE').slice(0,10).reduce((sum,row)=>sum+row.intrinsicPrice,0)/10;
assert.ok(topTe(tePremiumPrices)>topTe(prices),'TE premium must raise top-TE auction prices');

const cheapRoom=A.roomInflation({remainingDollars:1800,remainingBaselineValue:1600,remainingSlots:100,minBid:1});
const expensiveRoom=A.roomInflation({remainingDollars:1400,remainingBaselineValue:1600,remainingSlots:100,minBid:1});
assert.ok(cheapRoom>1,'cheap early purchases should leave inflation > 1');
assert.ok(expensiveRoom<1,'expensive early purchases should create deflation < 1');

const history={budget:200,seasons:[{season:2025,budget:200,purchases:[
  {name:'RB A',position:'RB',rank:10,price:60,generic_aav:50},
  {name:'RB B',position:'RB',rank:20,price:42,generic_aav:35},
  {name:'WR A',position:'WR',rank:10,price:45,generic_aav:50},
]}]};
const model=A.leagueModel(history,{budget:200});
const rbExpected=A.expectedLeaguePrice({intrinsicPrice:50,position:'RB',rank:10,model,currentInflation:1});
const wrExpected=A.expectedLeaguePrice({intrinsicPrice:50,position:'WR',rank:10,model,currentInflation:1});
assert.ok(rbExpected>wrExpected,'history should preserve position-specific price tendencies');
assert.equal(model.overall.n,3);
assert.ok(model.overall.mae>0,'calibration must report held-in absolute pricing error');
assert.equal(model.position.RB.confidence,'LOW');
const rbRange=A.expectedLeaguePriceRange({intrinsicPrice:50,position:'RB',rank:10,model,currentInflation:1});
assert.ok(rbRange.low<=rbRange.expected&&rbRange.high>=rbRange.expected,'uncertainty interval must contain expected price');
assert.equal(rbRange.evidence,3,'position and tier evidence should both contribute');
assert.equal(A.expectedLeaguePriceRange({intrinsicPrice:50,position:'TE',rank:10,model}).confidence,'UNMODELED');
const walkForward=A.calibrationBacktest({seasons:[
  {season:2024,purchases:[{name:'RB 24',position:'RB',rank:10,price:55,generic_aav:50,manager:'M'}]},
  {season:2025,purchases:[{name:'RB 25',position:'RB',rank:10,price:60,generic_aav:50,manager:'M'}]},
]});
assert.equal(walkForward.sufficient,true);
assert.equal(walkForward.overall.n,2);
assert.ok(walkForward.overall.mae>=0&&walkForward.position.RB.n===2,'walk-forward error must report by position');
assert.equal(A.calibrationBacktest(history).sufficient,false,'one season cannot claim held-out validation');

const strongBid=A.maxBid({intrinsicPrice:50,remainingBudget:80,slotsLeft:5,minBid:1,need:90,scarcity:85,tierUrgency:80,upside:70,redundancy:0});
const redundantBid=A.maxBid({intrinsicPrice:50,remainingBudget:80,slotsLeft:5,minBid:1,need:10,scarcity:85,tierUrgency:80,upside:70,redundancy:80});
assert.ok(strongBid>redundantBid,'roster need must change max bid without changing intrinsic price');
assert.ok(strongBid<=76,'max bid must preserve $1 for every remaining roster slot');

assert.equal(A.recommendation({currentPrice:41,expectedPrice:45,maxBid:52,intrinsicPrice:50,surplus:9}),'PRIORITY BUY');
assert.equal(A.recommendation({currentPrice:53,expectedPrice:51,maxBid:52,intrinsicPrice:50,surplus:-3}),'PASS');
assert.equal(A.nomination({surplus:-5,expectedPrice:55,maxBid:45,roomInflation:1.1,opponentsNeedingPosition:4}),'NOMINATE TO DRAIN');
assert.equal(A.nomination({surplus:8,expectedPrice:40,maxBid:50,roomInflation:1.0,need:80}),'NOMINATE TO BUY');

let state={league,teams:{me:{remainingBudget:20,slotsLeft:3,roster:[]}},draftedKeys:[],purchases:[]};
assert.throws(()=>A.applyPurchase(state,{teamId:'me',player:{key:'x'},price:19},{league,teams:12}),/cannot bid/);
state=A.applyPurchase(state,{teamId:'me',player:{key:'x',position:'RB'},price:15},{league,teams:12});
assert.equal(state.teams.me.remainingBudget,5);
assert.equal(state.teams.me.slotsLeft,2);
assert.ok(state.draftedKeys.includes('x'));

const health=A.budgetHealth({remainingBudget:100,slotsLeft:8,minBid:1,targetSpendRemaining:70});
assert.equal(health.status,'UNDERSPENT');

const evalNeed=A.evaluatePlayer({
  player:{key:'rb',position:'RB',rank:20},intrinsicPrice:45,teamState:{remainingBudget:100,slotsLeft:8,leagueModel:null},
  draftEvaluation:{components:{need:90}},scarcity:80,tierUrgency:80,upside:60,inflation:1,minBid:1,
});
const evalRedundant=A.evaluatePlayer({
  player:{key:'rb',position:'RB',rank:20},intrinsicPrice:45,teamState:{remainingBudget:100,slotsLeft:8,leagueModel:null},
  draftEvaluation:{components:{need:10}},scarcity:80,tierUrgency:80,upside:60,inflation:1,minBid:1,
});
assert.equal(evalNeed.intrinsicPrice,evalRedundant.intrinsicPrice);
assert.ok(evalNeed.maxBid>evalRedundant.maxBid);

console.log('auction-intelligence.js tests passed');
