'use strict';
const E = require('../../js/league-decision-engine.js');
function fixture(type = 'dynasty') {
  const league = { league_id: type, name: `${type} fixture`, season: '2026', total_rosters: 4,
    settings: { type: type === 'redraft' ? 0 : 2, best_ball: type === 'bestball' ? 1 : 0, waiver_budget: 100, waiver_type: 2, reserve_slots: 2, taxi_slots: 1, playoff_week_start: 9, playoff_teams: 2, draft_rounds: 3, start_week: 1 },
    scoring_settings: { rec: 1, rec_yd: 0.1, rush_yd: 0.1, pass_yd: 0.04, ...(type === 'dynasty' ? { bonus_rec_te: 0.5 } : {}) },
    roster_positions: ['QB', 'RB', 'WR', 'WR', 'TE', 'FLEX', ...(type === 'dynasty' ? ['SUPER_FLEX'] : []), ...(type === 'idp' ? ['DL', 'LB', 'DB', 'IDP_FLEX'] : []), ...Array(12).fill('BN')] };
  const players = {}, marketRows = [], rosters = [];
  const add = (id, pos, value, roster) => { players[id] = { full_name: `${id} Player`, position: pos, fantasy_positions: [pos], team: 'BUF', age: 25 }; marketRows.push({ player: { sleeperId: id, name: players[id].full_name, position: pos }, value }); if (roster) roster.players.push(id); };
  for (let team = 1; team <= 4; team++) {
    const roster = { roster_id: team, owner_id: `u${team}`, players: [], reserve: [], taxi: [], settings: { wins: team === 1 ? 3 : team === 2 ? 1 : 2, losses: team === 1 ? 1 : team === 2 ? 3 : 2, ties: 0, fpts: 400 + team * 10, fpts_decimal: 25, waiver_budget_used: 40 } };
    const spec = team === 1 ? [['QB', 100], ['QB', 95], ['RB', 30], ['WR', 120], ['WR', 110], ['WR', 100], ['WR', 85], ['WR', 75], ['WR', 40], ['WR', 35], ['TE', 40]] : [['QB', 90], ['QB', 80], ['RB', 140], ['RB', 60], ['WR', 5], ['WR', 5], ['TE', 35]];
    spec.forEach(([pos, value], i) => add(`t${team}p${i}`, pos, value, roster));
    for (const pos of ['DE', 'LB', 'CB', 'S']) add(`t${team}${pos}`, pos, 20, roster);
    rosters.push(roster);
  }
  add('free', 'RB', 12); add('unvalued', 'RB', null);
  const f = E.format(league), market = E.joinValues(players, marketRows, 'FantasyCalc', '2026-09-08T15:00:00Z', f), matchups = {};
  for (let week = 1; week <= 8; week++) matchups[week] = rosters.map((r, i) => ({ roster_id: r.roster_id, matchup_id: week % 2 ? Math.floor(i / 2) : i % 2, points: week < 5 ? 80 + ((week * 17 + i * 13) % 50) : 0 }));
  const transactions = [{ transaction_id: 'bid1', type: 'waiver', status: 'complete', week: 1, adds: { free: 2 }, settings: { waiver_bid: 10 } }, { transaction_id: 'bid2', type: 'waiver', status: 'complete', week: 2, adds: { free: 3 }, settings: { waiver_bid: 20 } }];
  return { league, format: f, week: 5, players, market, marketRows, rosters, users: rosters.map(r => ({ user_id: r.owner_id, display_name: `Team ${r.roster_id}` })),
    tradedPicks: [{ season: '2027', round: 1, roster_id: 2, owner_id: 1 }], drafts: [{ season: '2026', status: 'complete', settings: { rounds: 3 } }],
    trendingAdd: [{ player_id: 'free', count: 100 }, { player_id: 'unvalued', count: 50 }, { player_id: 't1p0', count: 1000 }], trendingDrop: [{ player_id: 'free', count: 5 }],
    transactions, matchups, projections: { scores: {}, reason: 'No projections available.' } };
}
module.exports = { fixture };
