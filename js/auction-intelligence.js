(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FFOAuction = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
  const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const sum = (values) => values.reduce((acc, value) => acc + numeric(value, 0), 0);
  const mean = (values) => values && values.length ? sum(values) / values.length : 0;
  const median = (values) => {
    if (!values || !values.length) return 0;
    const sorted = [...values].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const quantile = (values, probability) => {
    const sorted = [...(values || [])].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const index = (sorted.length - 1) * clamp(probability, 0, 1);
    const lower = Math.floor(index), upper = Math.ceil(index);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  };

  function auctionTier(playerOrRank) {
    if (playerOrRank && typeof playerOrRank === 'object') {
      const explicit = numeric(playerOrRank.tier ?? playerOrRank.positionTier ?? playerOrRank.position_tier, null);
      if (explicit != null) return Math.max(1, Math.round(explicit));
      playerOrRank = playerOrRank.overallRank ?? playerOrRank.rank;
    }
    const rank = numeric(playerOrRank, 999);
    return rank <= 12 ? 1 : rank <= 36 ? 2 : rank <= 72 ? 3 : rank <= 120 ? 4 : 5;
  }

  function rosterSlotCount(league = {}) {
    const roster = league.roster || {};
    const keys = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'SF', 'K', 'DST', 'BENCH'];
    const total = keys.reduce((acc, key) => acc + Math.max(0, numeric(roster[key], 0)), 0);
    return total || 15;
  }

  function compileAuctionConfig(options = {}) {
    const league = options.league || {};
    const draft = league.draft || {};
    const teams = Math.max(2, Math.round(numeric(options.teams ?? league.teams ?? league.total_rosters, 12)));
    const budget = Math.max(1, numeric(options.budget ?? draft.budget, 200));
    const minBid = Math.max(1, numeric(options.minBid ?? draft.minimum_bid, 1));
    const slotsPerTeam = Math.max(1, Math.round(numeric(options.slotsPerTeam, rosterSlotCount(league))));
    const totalSlots = teams * slotsPerTeam;
    const totalBudget = teams * budget;
    const reservedMinimum = totalSlots * minBid;
    if (reservedMinimum > totalBudget) throw new Error('Auction configuration is impossible: minimum bids exceed total league budget.');
    return { league, teams, budget, minBid, slotsPerTeam, totalSlots, totalBudget, reservedMinimum, discretionaryPool: totalBudget - reservedMinimum };
  }

  function normalizeHistory(history, budget = 200) {
    const out = [];
    for (const season of history?.seasons || []) {
      for (const purchase of season.purchases || []) {
        const seasonBudget = numeric(season.budget ?? history.budget, budget) || budget;
        const price = Math.max(0, numeric(purchase.price, 0));
        const baseline = Math.max(0, numeric(purchase.generic_aav ?? purchase.baseline_price ?? purchase.expected_price, 0));
        out.push({ ...purchase, season: season.season, budget: seasonBudget, price, generic_aav: baseline, price_pct: seasonBudget ? price / seasonBudget : 0, aav_pct: seasonBudget && baseline ? baseline / seasonBudget : 0, tier: auctionTier(purchase) });
      }
    }
    return out;
  }

  function leagueModel(history, { budget = 200 } = {}) {
    const rows = normalizeHistory(history, budget);
    const byPosition = {}, byTier = {}, byManager = {}, matched = [];
    for (const row of rows) {
      if (!(row.generic_aav > 0) || !(row.price > 0)) continue;
      const ratio = row.price / row.generic_aav;
      const observation = { ratio, error: row.price - row.generic_aav, absError: Math.abs(row.price - row.generic_aav) };
      matched.push(observation);
      const position = String(row.position || '').toUpperCase();
      if (position) (byPosition[position] ||= []).push(observation);
      if (position) (byTier[`${position}:${row.tier}`] ||= []).push(observation);
      if (row.manager) (byManager[row.manager] ||= []).push(observation);
    }
    const summary = (values) => {
      const ratios = values.map((item) => item.ratio);
      return {
        n: values.length,
        ratio: mean(ratios),
        median_ratio: median(ratios),
        low_ratio: quantile(ratios, 0.2),
        high_ratio: quantile(ratios, 0.8),
        mae: mean(values.map((item) => item.absError)),
        rmse: Math.sqrt(mean(values.map((item) => item.error ** 2))),
        confidence: values.length >= 20 ? 'HIGH' : values.length >= 8 ? 'MEDIUM' : 'LOW',
      };
    };
    const summarize = (groups) => Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, summary(values)]));
    return { rows: rows.length, matchedRows: matched.length, overall: summary(matched), position: summarize(byPosition), tier: summarize(byTier), manager: summarize(byManager) };
  }

  function shrink(observed, n, prior = 1, k = 8) {
    return ((numeric(observed, prior) * numeric(n, 0)) + (prior * k)) / (numeric(n, 0) + k);
  }

  function maximumLegalBid({ remainingBudget, slotsLeft, minBid = 1 }) {
    const budget = Math.max(0, numeric(remainingBudget, 0));
    const slots = Math.max(1, Math.round(numeric(slotsLeft, 1)));
    const minimum = Math.max(1, numeric(minBid, 1));
    return Math.max(0, budget - Math.max(0, (slots - 1) * minimum));
  }

  function requiredPositionCounts(config) {
    const roster = config.league?.roster || {};
    return {
      QB: config.teams * Math.max(0, numeric(roster.QB, 0)),
      RB: config.teams * Math.max(0, numeric(roster.RB, 0)),
      WR: config.teams * Math.max(0, numeric(roster.WR, 0)),
      TE: config.teams * Math.max(0, numeric(roster.TE, 0)),
      K: config.teams * Math.max(0, numeric(roster.K, 0)),
      DST: config.teams * Math.max(0, numeric(roster.DST, 0)),
    };
  }

  function positionDemandMultiplier(position, config) {
    const roster = config.league?.roster || {};
    const scoring = config.league?.scoring || {};
    const flex = Math.max(0, numeric(roster.FLEX, 0));
    const sf = Math.max(0, numeric(roster.SUPER_FLEX ?? roster.SF, 0));
    const tePremium = Math.max(0, numeric(scoring.te_premium ?? scoring.tePremium ?? scoring.bonus_rec_te, 0));
    const explicit = Math.max(0, numeric(roster[position], 0));
    if (position === 'QB') return 1 + sf * 0.55 + Math.max(0, explicit - 1) * 0.45;
    // A third required WR increases league-wide starting demand by 50%.
    // Apply diminishing-return elasticity instead of a small flat bump so
    // that the scarce top of the position gains value while the fixed room
    // budget still remains conserved.  sqrt(3 / 2) ~= 1.225; four-WR
    // formats continue to rise, but do not receive a linear 2x premium.
    if (position === 'WR') return Math.sqrt(Math.max(1, explicit / 2)) + flex * 0.035;
    if (position === 'RB') return 1 + Math.max(0, explicit - 2) * 0.12 + flex * 0.03;
    if (position === 'TE') return 1 + Math.max(0, explicit - 1) * 0.12 + flex * 0.012 + tePremium * 0.18;
    if (position === 'K' || position === 'DST') return 0.035;
    return 1;
  }

  function positionPriceCap(position, config, maxShare) {
    if (position === 'K' || position === 'DST') return Math.max(config.minBid, Math.min(10, config.budget * 0.025));
    return config.budget * maxShare;
  }

  function selectDraftablePool(eligible, config) {
    const required = requiredPositionCounts(config);
    const selected = new Set();
    const draftable = [];
    for (const [position, count] of Object.entries(required)) {
      if (!(count > 0)) continue;
      const candidates = eligible.filter((entry) => entry.player.position === position).slice(0, count);
      for (const entry of candidates) {
        if (selected.has(entry.index)) continue;
        selected.add(entry.index);
        draftable.push(entry);
      }
    }
    const remaining = eligible.filter((entry) => !selected.has(entry.index));
    remaining.sort((a, b) => {
      const aWeighted = a.value * positionDemandMultiplier(a.player.position, config);
      const bWeighted = b.value * positionDemandMultiplier(b.player.position, config);
      return bWeighted - aWeighted || a.index - b.index;
    });
    for (const entry of remaining) {
      if (draftable.length >= config.totalSlots) break;
      selected.add(entry.index);
      draftable.push(entry);
    }
    draftable.sort((a, b) => b.value - a.value || a.index - b.index);
    return draftable.slice(0, config.totalSlots);
  }

  function buildIntrinsicPrices(players, options = {}) {
    const config = compileAuctionConfig(options);
    const valueField = options.valueField || 'leagueValue';
    const exponent = clamp(numeric(options.exponent, 1.35), 1, 2.5);
    const maxShare = clamp(numeric(options.maxShare, 0.4), 0.15, 0.6);
    const eligible = (players || [])
      .map((player, index) => ({ player, value: numeric(player[valueField] ?? player.leagueValue ?? player.modelValue ?? player.value, 0), index }))
      .filter((entry) => entry.player && entry.player.position)
      .sort((a, b) => b.value - a.value || a.index - b.index);
    const draftable = selectDraftablePool(eligible, config);
    if (!draftable.length) return { config, replacementValue: 0, prices: {}, rows: [], totalAssigned: 0 };

    const replacementValue = Math.min(...draftable.map((entry) => entry.value));
    const weights = draftable.map((entry, index) => {
      const edge = Math.max(0, entry.value - replacementValue);
      const rankFloor = Math.max(0.001, (draftable.length - index) / draftable.length);
      const demand = positionDemandMultiplier(entry.player.position, config);
      return Math.pow(edge + rankFloor * 0.15, exponent) * demand;
    });
    const prices = new Array(draftable.length).fill(config.minBid);
    let remainingPool = Math.max(0, config.totalBudget - draftable.length * config.minBid);
    let active = draftable.map((_entry, index) => index);
    let activeWeights = [...weights];

    while (remainingPool > 0.0001 && active.length) {
      const weightTotal = sum(activeWeights);
      if (!(weightTotal > 0)) break;
      let spentThisRound = 0;
      const nextActive = [], nextWeights = [];
      for (let j = 0; j < active.length; j += 1) {
        const index = active[j];
        const share = remainingPool * (activeWeights[j] / weightTotal);
        const cap = positionPriceCap(draftable[index].player.position, config, maxShare);
        const room = Math.max(0, cap - prices[index]);
        const add = Math.min(room, share);
        prices[index] += add;
        spentThisRound += add;
        if (room - add > 0.0001) { nextActive.push(index); nextWeights.push(activeWeights[j]); }
      }
      remainingPool -= spentThisRound;
      active = nextActive;
      activeWeights = nextWeights;
      if (spentThisRound <= 0.0001) break;
    }

    if (remainingPool > 0.0001) {
      const order = draftable.map((_entry, index) => index).filter((index) => !['K', 'DST'].includes(draftable[index].player.position));
      for (let pass = 0; pass < 3 && remainingPool > 0.0001; pass += 1) {
        for (const index of order) {
          if (remainingPool <= 0.0001) break;
          const cap = positionPriceCap(draftable[index].player.position, config, maxShare);
          const room = Math.max(0, cap - prices[index]);
          const add = Math.min(room, remainingPool);
          prices[index] += add;
          remainingPool -= add;
        }
      }
    }

    const rounded = prices.map((price) => Math.round(price * 10) / 10);
    let diffTenths = Math.round((config.totalBudget - sum(rounded)) * 10);
    const adjustable = draftable
      .map((_entry, index) => index)
      .filter((index) => !['K', 'DST'].includes(draftable[index].player.position));
    let cursor = 0;
    let guard = 0;
    while (diffTenths !== 0 && adjustable.length && guard < 100000) {
      const index = adjustable[cursor % adjustable.length];
      const step = diffTenths > 0 ? 0.1 : -0.1;
      const cap = positionPriceCap(draftable[index].player.position, config, maxShare);
      const next = Math.round((rounded[index] + step) * 10) / 10;
      if (next >= config.minBid - 1e-9 && next <= cap + 1e-9) {
        rounded[index] = next;
        diffTenths += diffTenths > 0 ? -1 : 1;
      }
      cursor += 1;
      guard += 1;
    }

    const rows = draftable
      .map((entry, index) => ({ player: entry.player, value: entry.value, intrinsicPrice: rounded[index], auctionRank: index + 1, replacementValue }))
      .sort((a, b) => b.intrinsicPrice - a.intrinsicPrice || b.value - a.value);
    const priceMap = Object.fromEntries(rows.map((row) => [String(row.player.key ?? `${row.player.name}|${row.player.position}`), row.intrinsicPrice]));
    return { config, replacementValue, prices: priceMap, rows, totalAssigned: Math.round(sum(rows.map((row) => row.intrinsicPrice)) * 10) / 10 };
  }

  function roomInflation({ remainingDollars, remainingBaselineValue, remainingSlots = 0, minBid = 1 }) {
    const dollars = Math.max(0, numeric(remainingDollars, 0));
    const baseline = Math.max(0, numeric(remainingBaselineValue, 0));
    const reserve = Math.max(0, numeric(remainingSlots, 0) * Math.max(1, numeric(minBid, 1)));
    return clamp(Math.max(0, dollars - reserve) / Math.max(0.01, baseline - reserve), 0.65, 1.55);
  }

  function expectedLeaguePrice({ intrinsicPrice, genericAav, position, rank, tier, model, currentInflation = 1, capableBidders = 1 }) {
    const baseline = Math.max(1, numeric(intrinsicPrice ?? genericAav, 1));
    const pos = String(position || '').toUpperCase();
    const tierNo = numeric(tier, auctionTier(rank));
    let ratio = 1, evidence = 0;
    const positionModel = model?.position?.[pos];
    const tierModel = model?.tier?.[`${pos}:${tierNo}`];
    if (positionModel) { const n = numeric(positionModel.n, 0), observed = numeric(positionModel.median_ratio ?? positionModel.ratio, 1); ratio += (observed - 1) * clamp(n / 16, 0, 0.45); evidence += n; }
    if (tierModel) { const n = numeric(tierModel.n, 0), observed = numeric(tierModel.median_ratio ?? tierModel.ratio, 1); ratio += (observed - 1) * clamp(n / 12, 0, 0.55); evidence += n; }
    ratio = shrink(ratio, evidence, 1, 8);
    const bidderPressure = 1 + Math.min(0.12, Math.max(0, numeric(capableBidders, 1) - 1) * 0.012);
    return Math.max(1, Math.round(baseline * ratio * clamp(currentInflation, 0.65, 1.55) * bidderPressure * 10) / 10);
  }

  function expectedLeaguePriceRange(options = {}) {
    const expected = expectedLeaguePrice(options);
    const pos = String(options.position || '').toUpperCase();
    const tierNo = numeric(options.tier, auctionTier(options.rank));
    const groups = [options.model?.position?.[pos], options.model?.tier?.[`${pos}:${tierNo}`]].filter(Boolean);
    const evidence = groups.reduce((sum, group) => sum + numeric(group.n, 0), 0);
    if (!groups.length || evidence < 3) return { expected, low: expected, high: expected, confidence: 'UNMODELED', evidence, mae: null };
    const weighted = (field, fallback) => groups.reduce((sum, group) => sum + numeric(group[field], fallback) * numeric(group.n, 0), 0) / evidence;
    const center = weighted('median_ratio', 1);
    const lowRatio = shrink(weighted('low_ratio', center), evidence, center, 10);
    const highRatio = shrink(weighted('high_ratio', center), evidence, center, 10);
    const scale = expected / Math.max(0.01, center);
    const low = Math.max(1, Math.round(Math.min(lowRatio, highRatio) * scale * 10) / 10);
    const high = Math.max(low, Math.round(Math.max(lowRatio, highRatio) * scale * 10) / 10);
    return {
      expected,
      low: Math.min(expected, low),
      high: Math.max(expected, high),
      confidence: evidence >= 28 ? 'HIGH' : evidence >= 12 ? 'MEDIUM' : 'LOW',
      evidence,
      mae: Math.round(weighted('mae', 0) * 10) / 10,
    };
  }

  function calibrationBacktest(history, { budget = 200 } = {}) {
    const seasons = Array.isArray(history?.seasons) ? history.seasons : [];
    const observations = [];
    seasons.forEach((season, heldOutIndex) => {
      const training = { ...history, seasons: seasons.filter((_item, index) => index !== heldOutIndex) };
      const model = leagueModel(training, { budget });
      if (!model.matchedRows) return;
      normalizeHistory({ ...history, seasons: [season] }, budget).forEach((row) => {
        if (!(row.generic_aav > 0) || !(row.price > 0)) return;
        const predicted = expectedLeaguePrice({ intrinsicPrice: row.generic_aav, position: row.position, rank: row.rank, tier: row.tier, model });
        observations.push({ ...row, predicted, error: predicted - row.price, absError: Math.abs(predicted - row.price) });
      });
    });
    const metrics = (rows) => ({
      n: rows.length,
      mae: rows.length ? mean(rows.map((row) => row.absError)) : null,
      rmse: rows.length ? Math.sqrt(mean(rows.map((row) => row.error ** 2))) : null,
      bias: rows.length ? mean(rows.map((row) => row.error)) : null,
    });
    const group = (keyFn) => {
      const groups = {};
      observations.forEach((row) => {
        const key = keyFn(row);
        if (key) (groups[key] ||= []).push(row);
      });
      return Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, metrics(rows)]));
    };
    return {
      method: 'leave-one-season-out',
      seasons: seasons.length,
      sufficient: seasons.length >= 2 && observations.length > 0,
      overall: metrics(observations),
      position: group((row) => String(row.position || '').toUpperCase()),
      tier: group((row) => `${String(row.position || '').toUpperCase()}:${row.tier}`),
      manager: group((row) => row.manager || ''),
    };
  }

  function maxBid({ intrinsicValue, intrinsicPrice, remainingBudget, slotsLeft, minBid = 1, need = 50, scarcity = 50, tierUrgency = 50, upside = 50, redundancy = 0 }) {
    const base = Math.max(1, numeric(intrinsicPrice ?? intrinsicValue, 1));
    const needMod = (clamp(need, 0, 100) - 50) / 50 * 0.08;
    const scarcityMod = (clamp(scarcity, 0, 100) - 50) / 50 * 0.06;
    const tierMod = (clamp(tierUrgency, 0, 100) - 50) / 50 * 0.04;
    const upsideMod = (clamp(upside, 0, 100) - 50) / 50 * 0.03;
    const redundancyPenalty = clamp(redundancy, 0, 100) / 100 * 0.16;
    const rosterAdjusted = base * Math.max(0.55, 1 + needMod + scarcityMod + tierMod + upsideMod - redundancyPenalty);
    const legalCap = maximumLegalBid({ remainingBudget, slotsLeft, minBid });
    return Math.max(Math.min(minBid, legalCap), Math.round(Math.min(rosterAdjusted, legalCap)));
  }

  function acquisitionSurplus({ intrinsicValue, intrinsicPrice, price, expectedPrice }) {
    return Math.round((numeric(intrinsicPrice ?? intrinsicValue, 0) - numeric(price ?? expectedPrice, 0)) * 10) / 10;
  }

  function recommendation({ currentPrice, expectedPrice, maxBid: bidCap, intrinsicPrice, surplus }) {
    const market = numeric(currentPrice ?? expectedPrice, 0), max = numeric(bidCap, 0), intrinsic = numeric(intrinsicPrice, 0);
    const edge = numeric(surplus, intrinsic - market);
    if (market > max) return 'PASS';
    if (edge >= Math.max(5, intrinsic * 0.12)) return 'PRIORITY BUY';
    if (edge >= Math.max(2, intrinsic * 0.05)) return 'TARGET';
    if (market <= max && market <= intrinsic) return 'BUY TO MAX';
    if (market <= max) return 'PRICE SENSITIVE';
    return 'PASS';
  }

  function nomination({ surplus, expectedPrice, maxBid: bidCap, roomInflation: inflation = 1, need = 50, opponentsNeedingPosition = 0, endgame = false }) {
    const edge = numeric(surplus, 0), expected = numeric(expectedPrice, 0), max = numeric(bidCap, 0);
    if (endgame && expected <= max && numeric(need, 50) >= 55) return 'NOMINATE TO BUY';
    if (edge >= 4 && expected <= max && inflation <= 1.08) return 'NOMINATE TO BUY';
    if ((edge <= -3 || expected > max) && numeric(opponentsNeedingPosition, 0) >= 2) return 'NOMINATE TO DRAIN';
    return 'HOLD NOMINATION';
  }

  function capableBidderCount(teamStates, price, minBid = 1) {
    return (teamStates || []).filter((team) => maximumLegalBid({ remainingBudget: team.remainingBudget, slotsLeft: team.slotsLeft, minBid }) >= price).length;
  }

  function applyPurchase(state, purchase, configInput = {}) {
    const config = compileAuctionConfig(configInput.league ? configInput : { ...configInput, league: state.league || {} });
    const teams = { ...(state.teams || {}) }, teamId = String(purchase.teamId);
    const existing = teams[teamId] || { remainingBudget: config.budget, slotsLeft: config.slotsPerTeam, roster: [] };
    const price = Math.max(config.minBid, numeric(purchase.price, config.minBid));
    const legal = maximumLegalBid({ remainingBudget: existing.remainingBudget, slotsLeft: existing.slotsLeft, minBid: config.minBid });
    if (price > legal) throw new Error(`Illegal auction purchase: ${teamId} cannot bid ${price}; max legal bid is ${legal}.`);
    if (existing.slotsLeft <= 0) throw new Error(`Illegal auction purchase: ${teamId} has no roster slots left.`);
    teams[teamId] = { ...existing, remainingBudget: Math.round((existing.remainingBudget - price) * 10) / 10, slotsLeft: existing.slotsLeft - 1, roster: [...(existing.roster || []), { ...purchase.player, price }] };
    const drafted = new Set([...(state.draftedKeys || []), String(purchase.player?.key ?? purchase.playerKey ?? '')]);
    return { ...state, teams, draftedKeys: [...drafted], purchases: [...(state.purchases || []), { ...purchase, price }] };
  }

  function budgetHealth({ remainingBudget, slotsLeft, minBid = 1, targetSpendRemaining }) {
    const legalMax = maximumLegalBid({ remainingBudget, slotsLeft, minBid });
    const reserve = Math.max(0, (Math.max(1, slotsLeft) - 1) * minBid);
    const excess = Math.max(0, remainingBudget - reserve), target = numeric(targetSpendRemaining, excess), ratio = target > 0 ? excess / target : 1;
    return { legalMax, reserve, discretionaryRemaining: excess, paceRatio: ratio, status: ratio > 1.15 ? 'UNDERSPENT' : ratio < 0.85 ? 'OVERSPENT' : 'ON_PACE' };
  }

  function evaluatePlayer({ player, intrinsicPrice, expectedPrice, currentPrice, teamState, draftEvaluation = {}, scarcity = 50, tierUrgency = 50, upside = 50, capableBidders = 1, inflation = 1, opponentsNeedingPosition = 0, minBid = 1, availablePlayers = [], priceForPlayer = null }) {
    const need = numeric(draftEvaluation.components?.need ?? draftEvaluation.need, 50), redundancy = need < 50 ? (50 - need) * 2 : 0;
    const rawBidCap = maxBid({ intrinsicPrice, remainingBudget: teamState.remainingBudget, slotsLeft: teamState.slotsLeft, minBid, need, scarcity, tierUrgency, upside, redundancy });
    const positionEvidence = numeric(teamState.leagueModel?.position?.[String(player.position || '').toUpperCase()]?.n, 0);
    const tierEvidence = numeric(teamState.leagueModel?.tier?.[`${String(player.position || '').toUpperCase()}:${numeric(player.tier, auctionTier(player.overallRank ?? player.rank))}`]?.n, 0);
    const priceEvidence = positionEvidence + tierEvidence;
    const premiumCap = priceEvidence >= 12 ? .21 : priceEvidence >= 3 ? .16 : .12;
    const evidenceCap = Math.max(minBid, Math.round(numeric(intrinsicPrice, minBid) * (1 + premiumCap)));
    const bidCap = teamState.slotsLeft <= 3 ? rawBidCap : Math.min(rawBidCap, evidenceCap);
    const clearingPrice = expectedLeaguePrice({ intrinsicPrice, position: player.position, rank: player.overallRank ?? player.rank, tier: player.tier, model: teamState.leagueModel, currentInflation: inflation, capableBidders });
    const observedPrice = currentPrice == null ? clearingPrice : numeric(currentPrice, clearingPrice);
    const surplus = acquisitionSurplus({ intrinsicPrice, price: observedPrice });
    const alternatives = (availablePlayers || []).filter((candidate) => candidate !== player && candidate.key !== player.key && candidate.position === player.position).map((candidate) => {
      const price = typeof priceForPlayer === 'function' ? numeric(priceForPlayer(candidate), minBid) : numeric(candidate.intrinsicPrice, minBid);
      return { player: candidate, price, valueDrop: Math.max(0, Math.round((intrinsicPrice - price) * 10) / 10), sameTier: numeric(candidate.tier, 99) === numeric(player.tier, 99) };
    }).sort((a, b) => Number(b.sameTier) - Number(a.sameTier) || a.valueDrop - b.valueDrop || a.price - b.price);
    const nextComparable = alternatives[0] || null;
    const nextBid = Math.max(minBid, Math.round(observedPrice + minBid));
    const dollarsToCeiling = Math.max(0, Math.round((bidCap - observedPrice) * 10) / 10);
    let bidAdvice = nextBid > bidCap ? 'PASS TO COMPARABLE' : dollarsToCeiling <= minBid ? 'FINAL BID ONLY' : observedPrice < clearingPrice ? 'BID — BELOW MARKET' : 'BID IF NEEDED';
    if (nextComparable && nextComparable.valueDrop <= Math.max(2, intrinsicPrice * .08) && observedPrice >= bidCap - minBid) bidAdvice = 'PASS TO COMPARABLE';
    return { player, intrinsicPrice, expectedPrice: clearingPrice, currentPrice: observedPrice, maxBid: bidCap, rawMaxBid: rawBidCap, priceEvidence, priceConfidence: priceEvidence >= 12 ? 'CALIBRATED' : priceEvidence >= 3 ? 'LIMITED' : 'UNMODELED', surplus, recommendation: recommendation({ currentPrice: observedPrice, expectedPrice: clearingPrice, maxBid: bidCap, intrinsicPrice, surplus }), bidAdvice, nextBid, dollarsToCeiling, nextComparable, nomination: nomination({ surplus, expectedPrice: clearingPrice, maxBid: bidCap, roomInflation: inflation, need, opponentsNeedingPosition, endgame: teamState.slotsLeft <= 3 }), need, scarcity, tierUrgency, inflation };
  }

  return { clamp, quantile, auctionTier, rosterSlotCount, compileAuctionConfig, requiredPositionCounts, positionDemandMultiplier, normalizeHistory, leagueModel, calibrationBacktest, maximumLegalBid, buildIntrinsicPrices, roomInflation, expectedLeaguePrice, expectedLeaguePriceRange, maxBid, acquisitionSurplus, recommendation, nomination, capableBidderCount, applyPurchase, budgetHealth, evaluatePlayer };
});
