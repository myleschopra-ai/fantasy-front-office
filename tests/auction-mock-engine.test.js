'use strict';
const assert = require('node:assert/strict');
global.FFOAuction = require('../js/auction-intelligence.js');
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

console.log('auction mock engine tests passed');
