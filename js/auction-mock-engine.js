(function (root, factory) {
  const api = factory(root && root.FFOAuction, root && root.FFODraftIntelligence);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FFOAuctionMock = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Auction, DraftIntelligence) {
  'use strict';

  const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, numeric(value)));
  const keyOf = (player) => String(player?.key ?? player?.playerId ?? `${player?.name || 'player'}|${player?.position || '?'}`);
  const flex = new Set(['RB', 'WR', 'TE']);
  const superflex = new Set(['QB', 'RB', 'WR', 'TE']);
  const wrRbFlex = new Set(['RB', 'WR']);
  const receiverFlex = new Set(['WR', 'TE']);
  const bidLimitCache = new WeakMap();
  const completionCache = new WeakMap();
  const wwpaCache = new WeakMap();

  function rosterSlots(league = {}) {
    const roster = league.roster || {};
    const slots = [];
    const add = (slot, count) => {
      for (let index = 0; index < Math.max(0, Math.round(numeric(count))); index += 1) slots.push(`${slot}${index + 1}`);
    };
    add('QB', roster.QB);
    add('RB', roster.RB);
    add('WR', roster.WR);
    add('TE', roster.TE);
    add('FLEX', roster.FLEX);
    add('SUPER_FLEX', roster.SUPER_FLEX ?? roster.SF);
    add('WRRB_FLEX', roster.WRRB_FLEX ?? roster.RB_WR);
    add('REC_FLEX', roster.REC_FLEX ?? roster.WR_TE);
    add('WR_RB_TE', roster.WR_RB_TE);
    add('K', roster.K);
    add('DST', roster.DST);
    add('BENCH', roster.BENCH ?? roster.BN);
    return slots.length ? slots : ['QB1','RB1','RB2','WR1','WR2','TE1','FLEX1','FLEX2','K1','DST1','BENCH1','BENCH2','BENCH3','BENCH4','BENCH5','BENCH6'];
  }

  function slotType(slot) {
    return String(slot).replace(/\d+$/, '');
  }

  function eligible(position, slot) {
    const type = slotType(slot), pos = String(position || '').toUpperCase();
    if (type === 'BENCH') return ['QB','RB','WR','TE','K','DST'].includes(pos);
    if (type === 'FLEX') return flex.has(pos);
    if (type === 'SUPER_FLEX') return superflex.has(pos);
    if (type === 'WRRB_FLEX') return wrRbFlex.has(pos);
    if (type === 'REC_FLEX') return receiverFlex.has(pos);
    if (type === 'WR_RB_TE') return flex.has(pos);
    return type === pos;
  }

  function assignRoster(roster = [], league = {}) {
    const slots = rosterSlots(league);
    const players = roster.map((player, index) => ({ player, index, options: slots.map((slot, slotIndex) => eligible(player.position, slot) ? slotIndex : -1).filter((slotIndex) => slotIndex >= 0) }));
    players.sort((a, b) => a.options.length - b.options.length || a.index - b.index);
    const owner = new Array(slots.length).fill(-1);
    function place(playerIndex, seen) {
      for (const slotIndex of players[playerIndex].options) {
        if (seen.has(slotIndex)) continue;
        seen.add(slotIndex);
        if (owner[slotIndex] === -1 || place(owner[slotIndex], seen)) {
          owner[slotIndex] = playerIndex;
          return true;
        }
      }
      return false;
    }
    for (let index = 0; index < players.length; index += 1) {
      if (!place(index, new Set())) return { valid: false, assignments: [], openSlots: slots };
    }
    const assignments = owner.map((playerIndex, slotIndex) => playerIndex < 0 ? null : ({ slot: slots[slotIndex], player: players[playerIndex].player })).filter(Boolean);
    const used = new Set(assignments.map((entry) => entry.slot));
    return { valid: true, assignments, openSlots: slots.filter((slot) => !used.has(slot)) };
  }

  function canRoster(roster, player, league) {
    return assignRoster([...(roster || []), player], league).valid;
  }

  function projectedPoints(player) {
    return Math.max(0, numeric(player?.projectedPoints ?? player?.projected_points ?? player?.projection ?? player?.leagueValue ?? player?.value));
  }

  function optimalStarterPoints(roster = [], league = {}) {
    const settings = league.roster || {};
    const available = [...roster];
    const take = (positions, count) => {
      let total = 0;
      for (let index = 0; index < Math.max(0, Math.round(numeric(count))); index += 1) {
        let best = -1;
        available.forEach((player, playerIndex) => {
          if (!positions.has(String(player.position || '').toUpperCase())) return;
          if (best < 0 || projectedPoints(player) > projectedPoints(available[best])) best = playerIndex;
        });
        if (best >= 0) total += projectedPoints(available.splice(best, 1)[0]);
      }
      return total;
    };
    let total = 0;
    total += take(new Set(['QB']), settings.QB);
    total += take(new Set(['RB']), settings.RB);
    total += take(new Set(['WR']), settings.WR);
    total += take(new Set(['TE']), settings.TE);
    total += take(flex, settings.FLEX);
    total += take(superflex, settings.SUPER_FLEX ?? settings.SF);
    total += take(wrRbFlex, settings.WRRB_FLEX ?? settings.RB_WR);
    total += take(receiverFlex, settings.REC_FLEX ?? settings.WR_TE);
    total += take(flex, settings.WR_RB_TE);
    total += take(new Set(['K']), settings.K);
    total += take(new Set(['DST']), settings.DST);
    return Math.round(total * 10) / 10;
  }

  function marginalStarterPoints(team, player, league) {
    return Math.round((optimalStarterPoints([...(team.roster || []), player], league) - optimalStarterPoints(team.roster || [], league)) * 10) / 10;
  }

  function positionalNeed(team, player, league) {
    if (!canRoster(team.roster || [], player, league)) return 0;
    const assignment = assignRoster(team.roster || [], league);
    const pos = String(player.position || '').toUpperCase();
    const openTypes = assignment.openSlots.map(slotType);
    const direct = openTypes.includes(pos);
    const flexible = (flex.has(pos) && (openTypes.includes('FLEX') || openTypes.includes('WR_RB_TE'))) ||
      (superflex.has(pos) && openTypes.includes('SUPER_FLEX')) ||
      (wrRbFlex.has(pos) && openTypes.includes('WRRB_FLEX')) ||
      (receiverFlex.has(pos) && openTypes.includes('REC_FLEX'));
    const marginal = marginalStarterPoints(team, player, league);
    if (direct) return clamp(86 + marginal / 8, 86, 100);
    if (flexible) return clamp(74 + marginal / 8, 74, 96);
    if (marginal > 0) return clamp(58 + marginal / 6, 58, 88);
    const slotsLeft = Math.max(1, numeric(team.slotsLeft, assignment.openSlots.length));
    return clamp(42 + (slotsLeft <= 3 ? 12 : 0), 35, 70);
  }

  const strategies = [
    { id: 'balanced', aggression: 1.00, stars: 1.00, value: 1.03 },
    { id: 'stars-scrubs', aggression: 1.06, stars: 1.10, value: .98 },
    { id: 'value', aggression: .96, stars: .94, value: 1.10 },
    { id: 'scarcity', aggression: 1.02, stars: 1.02, value: 1.02 },
  ];

  function createState({ league = {}, players = [], userTeamId = '1', seed = 17, priceMap = {}, expectedPriceMap = {}, expectedPriceMapSales = null, leagueModel = null, projectionCoverage = null, biddingSeconds = 20, bidResetSeconds = 10 } = {}) {
    if (!Auction) throw new Error('FFOAuction is required before FFOAuctionMock.');
    const config = Auction.compileAuctionConfig({ league });
    const required = { QB:0, RB:0, WR:0, TE:0, K:0, DST:0 };
    rosterSlots(league).forEach((slot) => {
      const type = slotType(slot);
      if (Object.prototype.hasOwnProperty.call(required, type)) required[type] += config.teams;
    });
    const supply = players.reduce((counts, player) => {
      const position = String(player?.position || '').toUpperCase();
      counts[position] = (counts[position] || 0) + 1;
      return counts;
    }, {});
    const shortages = Object.entries(required).filter(([position, count]) => count > 0 && (supply[position] || 0) < count);
    if (players.length < config.totalSlots) shortages.push(['TOTAL', config.totalSlots]);
    if (shortages.length) {
      throw new Error(`Player pool cannot fill configured rosters: ${shortages.map(([position, count]) => `${position} needs ${count}, has ${position === 'TOTAL' ? players.length : supply[position] || 0}`).join('; ')}.`);
    }
    const teams = {};
    for (let number = 1; number <= config.teams; number += 1) {
      const id = String(number), strategy = strategies[(number + Math.abs(Math.round(seed))) % strategies.length];
      teams[id] = { id, name: id === String(userTeamId) ? 'My Team' : `Team ${number}`, remainingBudget: config.budget, slotsLeft: config.slotsPerTeam, roster: [], strategy: strategy.id };
    }
    return {
      version: 1,
      league,
      config,
      players: players.map((player) => ({ ...player, key: keyOf(player) })),
      remainingSupplyByPosition: { ...supply },
      priceMap: { ...priceMap },
      expectedPriceMap: { ...expectedPriceMap },
      expectedPriceMapSales,
      leagueModel,
      projectionCoverage,
      userTeamId: String(userTeamId),
      teams,
      draftedKeys: [],
      purchases: [],
      nominationIndex: 0,
      nomination: null,
      status: 'READY',
      seed: Math.abs(Math.round(seed)) || 17,
      auctionClock: {
        biddingSeconds: Math.max(10, Math.round(numeric(biddingSeconds, 20))),
        bidResetSeconds: Math.max(5, Math.round(numeric(bidResetSeconds, 10))),
      },
    };
  }

  function availablePlayers(state) {
    const drafted = new Set((state.draftedKeys || []).map(String));
    return state.players.filter((player) => !drafted.has(keyOf(player)));
  }

  function intrinsicPrice(state, player) {
    return Math.max(state.config.minBid, numeric(state.priceMap[keyOf(player)] ?? player.intrinsicPrice, state.config.minBid));
  }

  function expectedPrice(state, player) {
    const explicit = numeric(state.expectedPriceMap[keyOf(player)], null);
    const currentSales = (state.purchases || []).length;
    if (explicit != null && (state.expectedPriceMapSales == null || numeric(state.expectedPriceMapSales, 0) === currentSales)) return Math.max(state.config.minBid, explicit);
    return Auction.expectedLeaguePrice({ intrinsicPrice: intrinsicPrice(state, player), position: player.position, rank: player.overallRank ?? player.rank, tier: player.tier, model: state.leagueModel });
  }

  function leagueCompletionPossibleAfterPurchase(state, teamId, player) {
    let cache = completionCache.get(state);
    if (!cache) { cache = new Map(); completionCache.set(state, cache); }
    const cacheKey = `${teamId}|${String(player?.position || '').toUpperCase()}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const openSlots = [];
    for (const team of Object.values(state.teams || {})) {
      const roster = team.id === String(teamId) ? [...(team.roster || []), player] : team.roster || [];
      const assignment = assignRoster(roster, state.league);
      if (!assignment.valid) { cache.set(cacheKey, false); return false; }
      openSlots.push(...assignment.openSlots);
    }
    const remaining = availablePlayers(state).filter((candidate) => keyOf(candidate) !== keyOf(player));
    if (remaining.length < openSlots.length) { cache.set(cacheKey, false); return false; }

    // Tight endgames need a league-wide feasibility check, not just a check
    // that each roster is legal in isolation. This matching prevents one team
    // from consuming all FLEX-eligible players while another team still has a
    // FLEX opening, even when every fixed-position minimum remains satisfied.
    openSlots.sort((left, right) => {
      const leftOptions = remaining.reduce((count, candidate) => count + Number(eligible(candidate.position, left)), 0);
      const rightOptions = remaining.reduce((count, candidate) => count + Number(eligible(candidate.position, right)), 0);
      return leftOptions - rightOptions;
    });
    const owner = new Array(remaining.length).fill(-1);
    function place(slotIndex, seen) {
      for (let playerIndex = 0; playerIndex < remaining.length; playerIndex += 1) {
        if (seen.has(playerIndex) || !eligible(remaining[playerIndex].position, openSlots[slotIndex])) continue;
        seen.add(playerIndex);
        if (owner[playerIndex] === -1 || place(owner[playerIndex], seen)) {
          owner[playerIndex] = slotIndex;
          return true;
        }
      }
      return false;
    }
    for (let slotIndex = 0; slotIndex < openSlots.length; slotIndex += 1) {
      if (!place(slotIndex, new Set())) { cache.set(cacheKey, false); return false; }
    }
    cache.set(cacheKey, true);
    return true;
  }

  function preservesRequiredSupply(state, teamId, player) {
    // Every accepted purchase must leave enough undrafted players to fill
    // every team's remaining fixed-position slots. Without this guard a CPU
    // can legally stash a second K/DST (or another scarce position) on its
    // bench and strand a later nominator even though the opening pool was
    // globally valid.
    const position = String(player?.position || '').toUpperCase();
    const requiredPerTeam = Math.max(0, Math.round(numeric(state.league?.roster?.[position], 0)));
    if (requiredPerTeam > 0) {
      const trackedSupply = numeric(state.remainingSupplyByPosition?.[position], -1);
      const remainingAtPosition = trackedSupply >= 0
        ? Math.max(0, trackedSupply - 1)
        : availablePlayers(state)
          .filter((candidate) => keyOf(candidate) !== keyOf(player) && String(candidate.position || '').toUpperCase() === position)
          .length;
      let remainingDeficit = 0;
      for (const team of Object.values(state.teams || {})) {
        const owned = (team.roster || []).filter((candidate) => String(candidate.position || '').toUpperCase() === position).length;
        const afterPurchase = team.id === String(teamId) ? owned + 1 : owned;
        remainingDeficit += Math.max(0, requiredPerTeam - afterPurchase);
      }
      if (remainingAtPosition < remainingDeficit) return false;
    }
    const totalOpenAfter = Object.values(state.teams || {}).reduce(
      (total, team) => total + Math.max(0, numeric(team.slotsLeft, 0) - Number(team.id === String(teamId))),
      0,
    );
    const remainingPlayersAfter = Math.max(0, availablePlayers(state).length - 1);
    return remainingPlayersAfter - totalOpenAfter > state.config.teams * 2
      ? true
      : leagueCompletionPossibleAfterPurchase(state, teamId, player);
  }

  function teamBidLimit(state, teamId, player) {
    let cache = bidLimitCache.get(state);
    if (!cache) { cache = new Map(); bidLimitCache.set(state, cache); }
    const cacheKey = `${teamId}|${keyOf(player)}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const remember = (value) => { cache.set(cacheKey, value); return value; };
    const team = state.teams[String(teamId)];
    if (!team || team.slotsLeft <= 0 || !canRoster(team.roster, player, state.league)) return remember(0);
    if (!preservesRequiredSupply(state, teamId, player)) return remember(0);
    const legal = Auction.maximumLegalBid({ remainingBudget: team.remainingBudget, slotsLeft: team.slotsLeft, minBid: state.config.minBid });
    if (legal < state.config.minBid) return remember(0);
    const strategy = strategies.find((item) => item.id === team.strategy) || strategies[0];
    const base = intrinsicPrice(state, player), expected = expectedPrice(state, player);
    const need = positionalNeed(team, player, state.league);
    const marginal = marginalStarterPoints(team, player, state.league);
    const wwpa = teamWwpa(state, teamId, player);
    const elite = base >= state.config.budget * .18 ? strategy.stars : 1;
    const valueEdge = base > expected ? strategy.value : 1;
    const needMultiplier = .76 + (need / 100) * .30;
    const directProjectionMode = Boolean(state.projectionCoverage?.complete);
    const marginalShare = marginal / Math.max(1, projectedPoints(player));
    const marginalMultiplier = directProjectionMode
      ? .90 + Math.min(.18, Math.max(0, marginalShare) * .18)
      : 1 + Math.min(.08, marginal / 1000);
    const wwpaMultiplier = wwpa
      ? clamp(1 + numeric(wwpa.deltaPercentagePoints, 0) * 0.012, 0.94, 1.12)
      : 1;
    const pointsPerDollar = marginal / Math.max(state.config.minBid, expected);
    const efficiencyMultiplier = directProjectionMode
      ? 1 + Math.min(.08, Math.max(0, pointsPerDollar) / 100)
      : 1;
    const diamondMultiplier = team.slotsLeft <= Math.ceil(state.config.slotsPerTeam * .55) && numeric(player.diamondScore, 0) >= 72 && numeric(player.diamondConfidence, 0) >= 58
      ? 1 + Math.min(.06, (numeric(player.diamondScore) - 70) / 500)
      : 1;
    const endgame = team.slotsLeft <= 3 ? 1.08 : 1;
    const pace = team.remainingBudget / Math.max(1, team.slotsLeft);
    const releaseBudget = pace > expected * 1.7 ? 1.05 : 1;
    const raw = base * strategy.aggression * elite * valueEdge * needMultiplier * marginalMultiplier * wwpaMultiplier * efficiencyMultiplier * diamondMultiplier * endgame * releaseBudget;
    return remember(Math.max(state.config.minBid, Math.min(legal, Math.round(raw))));
  }

  function teamWwpa(state, teamId, player) {
    if (!DraftIntelligence?.weeklyWinProbabilityAdded) return null;
    let cache = wwpaCache.get(state);
    if (!cache) { cache = new Map(); wwpaCache.set(state, cache); }
    const cacheKey = `${teamId}|${keyOf(player)}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const team = state.teams[String(teamId)];
    const result = DraftIntelligence.weeklyWinProbabilityAdded(player, {
      league: state.league,
      teams: state.config.teams,
      picks: team?.roster || [],
      counts: DraftIntelligence.rosterCounts(team?.roster || []),
      poolSize: state.players.length,
    });
    cache.set(cacheKey, result);
    return result;
  }

  function nextNominator(state) {
    for (let offset = 0; offset < state.config.teams; offset += 1) {
      const index = (state.nominationIndex + offset) % state.config.teams;
      const id = String(index + 1);
      if (state.teams[id]?.slotsLeft > 0) return { id, index };
    }
    return null;
  }

  function nominationScore(state, teamId, player) {
    const team = state.teams[String(teamId)], max = teamBidLimit(state, teamId, player), expected = expectedPrice(state, player);
    if (!max) {
      // A manager may legally nominate a player it cannot roster or afford.
      // That matters in exact-supply endgames and is also a useful drain bid.
      // The sale remains protected because only legal bidders enter the lot.
      const legalBidders = bidderLimits(state, player);
      return legalBidders.length ? expected * .5 + legalBidders.length * 3 : -Infinity;
    }
    const need = positionalNeed(team, player, state.league), marginal = marginalStarterPoints(team, player, state.league);
    const buyEdge = max - expected;
    const wwpa = teamWwpa(state, teamId, player);
    return need * .7 + marginal * .12 + numeric(wwpa?.deltaPercentagePoints, 0) * 3 + buyEdge * 2 + intrinsicPrice(state, player) * .08;
  }

  function chooseNomination(state, teamId) {
    // Score a broad value frontier instead of repeatedly running the expensive
    // roster optimizer across the entire player pool. Legal filtering happens
    // before the cap, so scarce K/DST/required-position endgames still resolve.
    const candidates = availablePlayers(state)
      .filter((player) => bidderLimits(state, player).length > 0)
      .sort((a, b) => intrinsicPrice(state, b) - intrinsicPrice(state, a) || keyOf(a).localeCompare(keyOf(b)))
      .slice(0, 48);
    candidates.sort((a, b) => nominationScore(state, teamId, b) - nominationScore(state, teamId, a) || intrinsicPrice(state, b) - intrinsicPrice(state, a) || keyOf(a).localeCompare(keyOf(b)));
    return candidates[0] || null;
  }

  function bidderLimits(state, player) {
    return Object.keys(state.teams)
      .map((teamId) => ({ teamId, maxBid: teamBidLimit(state, teamId, player) }))
      .filter((entry) => entry.maxBid >= state.config.minBid)
      .sort((a, b) => b.maxBid - a.maxBid || Number(a.teamId) - Number(b.teamId));
  }

  function startNomination(state, { teamId, playerKey } = {}) {
    if (state.nomination) throw new Error('A nomination is already active.');
    const next = nextNominator(state);
    if (!next) return { ...state, status: 'COMPLETE' };
    const nominator = String(teamId || next.id);
    if (nominator !== next.id) throw new Error(`It is ${state.teams[next.id].name}'s nomination.`);
    const player = playerKey ? availablePlayers(state).find((item) => keyOf(item) === String(playerKey)) : chooseNomination(state, nominator);
    if (!player) throw new Error(`${state.teams[nominator].name} has no legal nomination.`);
    const clock = state.auctionClock || { biddingSeconds:20, bidResetSeconds:10 };
    return { ...state, nomination: {
      playerKey: keyOf(player), nominatorTeamId: nominator,
      openingBid: state.config.minBid, currentBid: state.config.minBid,
      leaderTeamId: nominator, passedTeamIds: [], awaitingUser: false,
      secondsRemaining: clock.biddingSeconds,
      bidHistory: [{ teamId:nominator, amount:state.config.minBid, kind:'NOMINATION' }],
    }, status: 'BIDDING' };
  }

  function nextBidAmount(state, amount = null) {
    const current = numeric(state.nomination?.currentBid, state.config.minBid - 1);
    return amount == null ? current + 1 : Math.max(current + 1, Math.round(numeric(amount, current + 1)));
  }

  function placeBid(state, { teamId, amount = null, kind = 'BID' } = {}) {
    if (!state.nomination || !['BIDDING','AWAITING_USER'].includes(state.status)) throw new Error('No player is open for bidding.');
    const id = String(teamId || '');
    const player = state.players.find((item) => keyOf(item) === state.nomination.playerKey);
    if (!player) throw new Error('Nominated player is unavailable.');
    if (!state.teams[id]) throw new Error('Unknown bidding team.');
    if ((state.nomination.passedTeamIds || []).includes(id)) throw new Error(`${state.teams[id].name} already passed on this player.`);
    if (id === String(state.nomination.leaderTeamId)) throw new Error(`${state.teams[id].name} already has the high bid.`);
    const bid = nextBidAmount(state, amount);
    const legal = teamBidLimit(state, id, player);
    if (bid > legal) throw new Error(`${state.teams[id].name}'s maximum legal bid is $${legal}.`);
    const reset = numeric(state.auctionClock?.bidResetSeconds, 10);
    const secondsRemaining = numeric(state.nomination.secondsRemaining, reset) <= reset ? reset : state.nomination.secondsRemaining;
    return { ...state, nomination: {
      ...state.nomination,
      currentBid: bid,
      leaderTeamId: id,
      awaitingUser: false,
      secondsRemaining,
      bidHistory: [...(state.nomination.bidHistory || []), { teamId:id, amount:bid, kind }],
    }, status:'BIDDING' };
  }

  function passBid(state, teamId) {
    if (!state.nomination) throw new Error('No player is open for bidding.');
    const id = String(teamId || '');
    if (id === String(state.nomination.leaderTeamId)) throw new Error('The current high bidder cannot pass.');
    const passed = new Set(state.nomination.passedTeamIds || []); passed.add(id);
    return { ...state, nomination:{ ...state.nomination, passedTeamIds:[...passed], awaitingUser:false }, status:'BIDDING' };
  }

  function cpuBidder(state) {
    if (!state.nomination) return null;
    const player = state.players.find((item) => keyOf(item) === state.nomination.playerKey);
    const current = numeric(state.nomination.currentBid, state.config.minBid);
    const passed = new Set(state.nomination.passedTeamIds || []);
    return bidderLimits(state, player)
      .filter((entry) => entry.teamId !== state.userTeamId && entry.teamId !== String(state.nomination.leaderTeamId) && !passed.has(entry.teamId) && entry.maxBid > current)
      .sort((a, b) => b.maxBid - a.maxBid || Number(a.teamId) - Number(b.teamId))[0] || null;
  }

  function advanceClock(state, { seconds = 1, allowCpuBid = true } = {}) {
    if (!state.nomination || state.status === 'COMPLETE') return state;
    let next = state;
    const cpu = allowCpuBid ? cpuBidder(next) : null;
    if (cpu) {
      const current = numeric(next.nomination.currentBid, next.config.minBid);
      const increment = current >= 50 ? 3 : current >= 20 ? 2 : 1;
      next = placeBid(next, { teamId:cpu.teamId, amount:Math.min(cpu.maxBid, current + increment), kind:'CPU_BID' });
    }
    const remaining = Math.max(0, numeric(next.nomination.secondsRemaining, 0) - Math.max(1, numeric(seconds, 1)));
    next = { ...next, nomination:{ ...next.nomination, secondsRemaining:remaining } };
    if (remaining > 0) return next;
    const player = next.players.find((item) => keyOf(item) === next.nomination.playerKey);
    return completePurchase(next, next.nomination.leaderTeamId, player, next.nomination.currentBid);
  }


  function completePurchase(state, teamId, player, price) {
    const ceilingAtPurchase = teamBidLimit(state, teamId, player);
    const next = Auction.applyPurchase(state, {
      teamId,
      player,
      price,
      ceilingAtPurchase,
      intrinsicPrice: intrinsicPrice(state, player),
      expectedPrice: expectedPrice(state, player),
    }, { league: state.league });
    const position = String(player.position || '').toUpperCase();
    const remainingSupplyByPosition = {
      ...(next.remainingSupplyByPosition || {}),
      [position]: Math.max(0, numeric(next.remainingSupplyByPosition?.[position], 0) - 1),
    };
    const completed = Object.values(next.teams).every((team) => team.slotsLeft === 0);
    return { ...next, remainingSupplyByPosition, nomination: null, nominationIndex: (state.nominationIndex + 1) % state.config.teams, status: completed ? 'COMPLETE' : 'RUNNING' };
  }

  function recordPurchase(state, { teamId, playerKey, price }) {
    if (state.nomination) throw new Error('Resolve the active nomination before recording a manual purchase.');
    const player = availablePlayers(state).find((item) => keyOf(item) === String(playerKey));
    if (!player) throw new Error('Selected player is no longer available.');
    if (!canRoster(state.teams[String(teamId)]?.roster || [], player, state.league)) throw new Error(`${state.teams[String(teamId)]?.name || teamId} cannot legally roster ${player.name}.`);
    return completePurchase(state, String(teamId), player, price);
  }

  function resolveNomination(state, { autoUser = false } = {}) {
    if (!state.nomination) return state;
    const player = state.players.find((item) => keyOf(item) === state.nomination.playerKey);
    if (!player) throw new Error('Nominated player is unavailable.');
    const limits = bidderLimits(state, player);
    if (!limits.length) throw new Error('No team can legally roster the nominated player.');
    const user = limits.find((entry) => entry.teamId === state.userTeamId);
    const cpus = limits.filter((entry) => entry.teamId !== state.userTeamId);
    if (!autoUser && user && user.maxBid >= state.config.minBid) {
      const topCpu = cpus[0];
      const opening = numeric(state.nomination.currentBid, state.config.minBid);
      const cpuCanRaise = topCpu && topCpu.maxBid >= opening + state.config.minBid;
      const currentBid = cpuCanRaise ? opening + state.config.minBid : opening;
      return { ...state, nomination: { ...state.nomination, currentBid, leaderTeamId: cpuCanRaise ? topCpu.teamId : state.nomination.leaderTeamId, awaitingUser: true, userMaxBid: user.maxBid, cpuMaxBid: topCpu?.maxBid || 0, bidCount: numeric(state.nomination.bidCount, 0) + (cpuCanRaise ? 1 : 0) }, status: 'AWAITING_USER' };
    }
    const winner = limits[0], second = limits[1];
    const price = Math.max(state.config.minBid, Math.min(winner.maxBid, numeric(second?.maxBid, state.config.minBid - 1) + 1));
    return completePurchase(state, winner.teamId, player, price);
  }

  function userDecision(state, decision) {
    if (!state.nomination?.awaitingUser) throw new Error('No user bid decision is pending.');
    const player = state.players.find((item) => keyOf(item) === state.nomination.playerKey);
    const cpus = bidderLimits(state, player).filter((entry) => entry.teamId !== state.userTeamId);
    if (String(decision).toUpperCase() === 'PASS') {
      const winner = cpus.find((entry) => entry.teamId === state.nomination.leaderTeamId) || cpus[0] || { teamId: state.nomination.nominatorTeamId, maxBid: state.config.minBid };
      return completePurchase(state, winner.teamId, player, Math.max(state.config.minBid, numeric(state.nomination.currentBid, state.config.minBid)));
    }
    const userMax = numeric(state.nomination.userMaxBid, 0), cpu = cpus[0], increment = state.config.minBid;
    if (userMax < state.config.minBid) throw new Error('User has no legal bid.');
    const userBid = numeric(state.nomination.currentBid, state.config.minBid) + increment;
    if (userBid > userMax) throw new Error(`Your roster-aware ceiling is $${userMax}. Pass or choose the comparable alternative.`);
    if (!cpu || cpu.maxBid < userBid + increment) return completePurchase(state, state.userTeamId, player, userBid);
    const cpuBid = userBid + increment;
    return { ...state, nomination: { ...state.nomination, currentBid: cpuBid, leaderTeamId: cpu.teamId, awaitingUser: true, userMaxBid: userMax, cpuMaxBid: cpu.maxBid, bidCount: numeric(state.nomination.bidCount, 0) + 2 }, status: 'AWAITING_USER' };
  }

  function step(state, { autoUser = false, playerKey = null } = {}) {
    let next = state;
    if (next.status === 'COMPLETE') return next;
    if (!next.nomination) {
      const nominator = nextNominator(next);
      if (!nominator) return { ...next, status: 'COMPLETE' };
      next = startNomination(next, { teamId: nominator.id, playerKey: nominator.id === next.userTeamId ? playerKey : null });
      if (nominator.id === next.userTeamId && !playerKey && !autoUser) return { ...next, nomination: null, status: 'AWAITING_NOMINATION' };
    }
    return resolveNomination(next, { autoUser });
  }

  function simulateComplete(state, { autoUser = true, maxSteps = 10000 } = {}) {
    let next = state;
    for (let count = 0; count < maxSteps && next.status !== 'COMPLETE'; count += 1) {
      next = step(next, { autoUser });
      if (!autoUser && ['AWAITING_USER','AWAITING_NOMINATION'].includes(next.status)) break;
    }
    if (next.status !== 'COMPLETE' && autoUser) throw new Error(`Auction did not complete; stopped in ${next.status}.`);
    return next;
  }

  function validateState(state, { requireComplete = false } = {}) {
    const issues = [], seen = new Set();
    Object.values(state.teams || {}).forEach((team) => {
      if (team.remainingBudget < -1e-9) issues.push(`${team.id}: negative budget`);
      if (team.slotsLeft !== state.config.slotsPerTeam - team.roster.length) issues.push(`${team.id}: slot count mismatch`);
      if (!assignRoster(team.roster, state.league).valid) issues.push(`${team.id}: illegal roster composition`);
      team.roster.forEach((player) => {
        const key = keyOf(player);
        if (seen.has(key)) issues.push(`${key}: drafted more than once`);
        seen.add(key);
      });
      if (requireComplete && team.slotsLeft !== 0) issues.push(`${team.id}: incomplete roster`);
    });
    if (seen.size !== (state.purchases || []).length) issues.push('purchase and roster totals disagree');
    return { valid: issues.length === 0, issues, drafted: seen.size, projectedPointsByTeam: Object.fromEntries(Object.values(state.teams || {}).map((team) => [team.id, optimalStarterPoints(team.roster, state.league)])) };
  }

  return { keyOf, rosterSlots, eligible, assignRoster, canRoster, optimalStarterPoints, marginalStarterPoints, positionalNeed, createState, availablePlayers, intrinsicPrice, expectedPrice, preservesRequiredSupply, teamBidLimit, nextNominator, chooseNomination, bidderLimits, startNomination, nextBidAmount, placeBid, passBid, cpuBidder, advanceClock, resolveNomination, userDecision, recordPurchase, step, simulateComplete, validateState };
});
