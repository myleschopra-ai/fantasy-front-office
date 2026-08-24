'use strict';
const assert = require('node:assert/strict');
global.FFOAuction = require('../js/auction-intelligence.js');
global.FFODraftIntelligence = require('../js/draft-intelligence.js');
const M = require('../js/auction-mock-engine.js');

function league({ teams = 6, budget = 100, superflex = 0, wr = 2, flex = 1, tePremium = 0 } = {}) {
  return { teams, scoring: { reception: .5, te_premium: tePremium }, roster: { QB:1,RB:2,WR:wr,TE:1,FLEX:flex,SUPER_FLEX:superflex,K:1,DST:1,BENCH:3 }, draft: { format:'auction',budget,minimum_bid:1 } };
}
function players(count = 180) {
  const positions = ['QB','RB','WR','TE','RB','WR','K','DST'];
  return Array.from({ length: count }, (_, index) => ({ key:`p${index}`, name:`Player ${index}`, position:positions[index % positions.length], rank:index + 1, tier:Math.floor(index / 24) + 1, projectedPoints:Math.max(30, 340 - index), leagueValue:Math.max(1, 100 - index * .35) }));
}
function stateFor(l) {
  const pool = players(), priced = FFOAuction.buildIntrinsicPrices(pool, { league:l, valueField:'leagueValue' });
  return M.createState({ league:l, players:pool, priceMap:priced.prices, userTeamId:'1', seed:22 });
}

const l = league();
assert.equal(M.rosterSlots(l).length, 12);
assert.throws(() => M.createState({ league:l,players:players(20) }), /cannot fill configured rosters/, 'undersized pools must fail before the auction starts');
assert.equal(M.canRoster([], { position:'QB' }, l), true);
const tooManyQbs = Array.from({ length:4 }, (_, index) => ({ key:`q${index}`, position:'QB' }));
assert.equal(M.assignRoster(tooManyQbs, l).valid, true, 'QB plus bench capacity should be legal');
assert.equal(M.canRoster(tooManyQbs, { key:'q5', position:'QB' }, l), false, 'position hoarding cannot consume reserved non-QB slots');

let state = stateFor(l);
const mappedPlayer = state.players[0];
const mappedKey = M.keyOf(mappedPlayer);
let mappedState = { ...state, expectedPriceMap:{ [mappedKey]:99 }, expectedPriceMapSales:0 };
assert.equal(M.expectedPrice(mappedState,mappedPlayer),99,'a current room price map should remain authoritative');
mappedState = { ...mappedState,purchases:[{player:mappedPlayer,price:10,intrinsicPrice:8}],leagueModel:FFOAuction.adaptiveLeagueModel(null,[{player:mappedPlayer,price:10,intrinsicPrice:8}]) };
assert.notEqual(M.expectedPrice(mappedState,mappedPlayer),99,'a stale room price map must fall through to the newly learned model during bulk simulation');
state = M.simulateComplete(state);
const validation = M.validateState(state, { requireComplete:true });
assert.equal(validation.valid, true, validation.issues.join(' | '));
assert.equal(state.purchases.length, l.teams * M.rosterSlots(l).length);
assert.equal(new Set(state.purchases.map((purchase) => purchase.player.key)).size, state.purchases.length);
for (const team of Object.values(state.teams)) {
  assert.equal(team.roster.length, M.rosterSlots(l).length);
  assert.ok(team.remainingBudget >= 0);
  assert.ok(M.optimalStarterPoints(team.roster, l) > 0);
}

const scarceLeague = league({ teams:4 });
const scarceCounts = { QB:8,RB:14,WR:14,TE:4,K:4,DST:4 };
const scarcePlayers = Object.entries(scarceCounts).flatMap(([position,count]) => Array.from({length:count},(_unused,index)=>({
  key:`scarce-${position}-${index}`,name:`${position} ${index}`,position,rank:index+1,
  projectedPoints:Math.max(20,250-index),leagueValue:Math.max(1,90-index),
})));
const scarcePricing = FFOAuction.buildIntrinsicPrices(scarcePlayers,{league:scarceLeague,valueField:'leagueValue'});
const scarceComplete = M.simulateComplete(M.createState({league:scarceLeague,players:scarcePlayers,priceMap:scarcePricing.prices,userTeamId:'1',seed:29}));
assert.equal(M.validateState(scarceComplete,{requireComplete:true}).valid,true,'CPU auction must preserve exact K/DST supply for every roster');
assert.ok(Object.values(scarceComplete.teams).every(team=>team.roster.filter(player=>player.position==='K').length>=1&&team.roster.filter(player=>player.position==='DST').length>=1));

const sf = league({ superflex:1 }), one = league();
const oneState = stateFor(one), sfState = stateFor(sf);
const qb = oneState.players.find((player) => player.position === 'QB');
assert.ok(M.positionalNeed(sfState.teams['2'], qb, sf) >= M.positionalNeed(oneState.teams['2'], qb, one));

let interactive = stateFor(l);
interactive = M.step(interactive, { autoUser:false });
assert.equal(interactive.status, 'AWAITING_NOMINATION');
const nominated = M.chooseNomination(interactive, '1');
interactive = M.step(interactive, { autoUser:false, playerKey:nominated.key });
assert.equal(interactive.status, 'AWAITING_USER');
interactive = M.userDecision(interactive, 'PASS');
assert.equal(interactive.purchases.length, 1);
assert.equal(interactive.nomination, null);

let live = stateFor(l);
const livePlayer = M.chooseNomination(live, '1');
live = M.startNomination(live, { teamId:'1', playerKey:livePlayer.key });
assert.equal(live.status, 'BIDDING');
assert.equal(live.nomination.currentBid, 1, 'nomination opens at the league minimum');
assert.equal(live.nomination.secondsRemaining, 20, 'opening clock uses the configured live-auction window');
const firstOpponent = M.bidderLimits(live, livePlayer).find(entry => entry.teamId !== '1' && entry.maxBid >= 2);
assert.ok(firstOpponent, 'at least one opponent must be able to bid');
live = M.placeBid(live, { teamId:firstOpponent.teamId, amount:2 });
assert.equal(live.nomination.currentBid, 2);
assert.equal(live.nomination.leaderTeamId, firstOpponent.teamId);
live = { ...live, nomination:{ ...live.nomination, secondsRemaining:4 } };
const counterBidder = M.bidderLimits(live, livePlayer).find(entry => entry.teamId !== firstOpponent.teamId && entry.maxBid >= 3);
assert.ok(counterBidder, 'a second solvent team must be able to counter');
live = M.placeBid(live, { teamId:counterBidder.teamId, amount:3 });
assert.equal(live.nomination.secondsRemaining, 10, 'a late bid resets the wrap-up clock to ten seconds');
const winningTeam = live.nomination.leaderTeamId;
const budgetBefore = live.teams[winningTeam].remainingBudget;
live = M.advanceClock(live, { seconds:10, allowCpuBid:false });
assert.equal(live.purchases.length, 1, 'the high bidder wins when the clock reaches zero');
assert.equal(live.teams[winningTeam].roster.length, 1, 'the sold player is rostered to the winner');
assert.equal(live.teams[winningTeam].remainingBudget, budgetBefore - 3, 'the winning price is deducted atomically');
assert.equal(live.nomination, null);

console.log('auction mock engine tests passed');
