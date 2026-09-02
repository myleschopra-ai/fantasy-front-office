(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FFORosterEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = "1.0.0";
  const NON_STARTERS = new Set(["BN", "IR", "TAXI"]);
  const FLEX = {
    FLEX: ["RB", "WR", "TE"],
    SUPER_FLEX: ["QB", "RB", "WR", "TE"],
    WRRB_FLEX: ["WR", "RB"],
    REC_FLEX: ["WR", "TE"],
  };

  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, finite(value)));
  const round = (value, places = 3) => {
    const power = 10 ** places;
    return Math.round((finite(value) + Number.EPSILON) * power) / power;
  };
  const mean = values => values?.length ? values.reduce((sum, value) => sum + finite(value), 0) / values.length : 0;
  const stdev = values => {
    if (!values || values.length < 2) return 0;
    const average = mean(values);
    return Math.sqrt(mean(values.map(value => (finite(value) - average) ** 2)));
  };
  const projection = player => player?.projection === null || player?.projection === undefined ? null : finite(player.projection);
  const playerKey = (player, index = 0) => String(player?.id || player?.playerId || player?.name || `player-${index}`);

  function eligible(position, slot) {
    return position === slot || (FLEX[slot] || []).includes(position);
  }

  function starterSlots(rosterPositions = []) {
    return rosterPositions.filter(slot => !NON_STARTERS.has(slot));
  }

  function optimizeLineup(players = [], rosterPositions = []) {
    const pool = players.map((player, index) => ({ ...player, __key: playerKey(player, index) }));
    const slots = starterSlots(rosterPositions);
    const orderedSlots = slots.map((slot, index) => ({ slot, index })).sort((a, b) => {
      const options = value => pool.filter(player => eligible(player.position, value)).length;
      return options(a.slot) - options(b.slot) || a.index - b.index;
    });
    const used = new Set();
    const assigned = orderedSlots.map(({ slot, index }) => {
      const candidates = pool.filter(player => !used.has(player.__key) && eligible(player.position, slot));
      candidates.sort((a, b) => {
        const ap = projection(a), bp = projection(b);
        if (ap !== null || bp !== null) return finite(bp, -Infinity) - finite(ap, -Infinity);
        return finite(b.marketValue) - finite(a.marketValue);
      });
      const player = candidates[0] || null;
      if (player) used.add(player.__key);
      return { slot, index, player };
    }).sort((a, b) => a.index - b.index);
    const bench = pool.filter(player => !used.has(player.__key));
    const projected = assigned.reduce((sum, row) => sum + finite(projection(row.player)), 0);
    return { assigned, bench, projected: round(projected), covered: assigned.filter(row => projection(row.player) !== null).length };
  }

  function slotDemand(rosterPositions = [], teams = 12) {
    const demand = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0, DEF: 0 };
    starterSlots(rosterPositions).forEach(slot => {
      if (demand[slot] !== undefined) demand[slot] += teams;
      else if (slot === "FLEX") { demand.RB += teams * 0.4; demand.WR += teams * 0.45; demand.TE += teams * 0.15; }
      else if (slot === "SUPER_FLEX") { demand.QB += teams * 0.7; demand.RB += teams * 0.12; demand.WR += teams * 0.13; demand.TE += teams * 0.05; }
      else if (slot === "WRRB_FLEX") { demand.RB += teams * 0.45; demand.WR += teams * 0.55; }
      else if (slot === "REC_FLEX") { demand.WR += teams * 0.75; demand.TE += teams * 0.25; }
    });
    return Object.fromEntries(Object.entries(demand).map(([position, value]) => [position, Math.max(1, Math.ceil(value))]));
  }

  function replacementLevels(players = [], rosterPositions = [], teams = 12) {
    const demand = slotDemand(rosterPositions, teams);
    const positions = new Set(players.map(player => player.position).filter(Boolean));
    const levels = {};
    positions.forEach(position => {
      const ranked = players.filter(player => player.position === position && projection(player) !== null)
        .sort((a, b) => projection(b) - projection(a));
      const cutoff = Math.max(0, Math.min(ranked.length - 1, (demand[position] || teams) - 1));
      levels[position] = ranked.length ? round(projection(ranked[cutoff])) : 0;
    });
    return { levels, demand };
  }

  function normalCdf(value) {
    const sign = value < 0 ? -1 : 1;
    const x = Math.abs(value) / Math.sqrt(2);
    const t = 1 / (1 + 0.3275911 * x);
    const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
    return 0.5 * (1 + erf);
  }

  function matchupWinProbability(teamProjection, opponentProjection, teamSd = null, opponentSd = null) {
    const teamSpread = teamSd === null ? Math.max(10, finite(teamProjection) * 0.12) : Math.max(1, finite(teamSd));
    const opponentSpread = opponentSd === null ? Math.max(10, finite(opponentProjection) * 0.12) : Math.max(1, finite(opponentSd));
    const spread = Math.sqrt(teamSpread ** 2 + opponentSpread ** 2);
    return round(clamp(normalCdf((finite(teamProjection) - finite(opponentProjection)) / spread), 0.01, 0.99), 4);
  }

  function expectedWinsAdded(before = [], after = []) {
    const weeks = Math.max(before.length, after.length);
    const rows = [];
    for (let index = 0; index < weeks; index += 1) {
      const prior = finite(before[index]?.winProbability ?? before[index]);
      const next = finite(after[index]?.winProbability ?? after[index]);
      rows.push({ week: after[index]?.week || before[index]?.week || index + 1, before: prior, after: next, delta: round(next - prior, 4) });
    }
    return { expectedWins: round(rows.reduce((sum, row) => sum + row.delta, 0)), weeks: rows };
  }

  function seededRandom(seed = 2026) {
    let state = Math.abs(Math.trunc(finite(seed, 2026))) || 1;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function gaussian(random) {
    const u = Math.max(Number.EPSILON, random());
    const v = Math.max(Number.EPSILON, random());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function championshipProbability({
    teams = [], teamId, remainingWeeks = 6, playoffTeams = 6, simulations = 2000, seed = 2026,
  } = {}) {
    if (!teamId || teams.length < 2) return { probability: 0, playoffProbability: 0, simulations: 0, reason: "INSUFFICIENT_LEAGUE_STATE" };
    const clean = teams.map((team, index) => ({
      id: String(team.id ?? index + 1),
      projection: finite(team.projection),
      wins: finite(team.wins),
      pointsFor: finite(team.pointsFor),
      weeklySd: Math.max(6, finite(team.weeklySd, Math.max(10, finite(team.projection) * 0.12))),
    }));
    const targetId = String(teamId);
    if (!clean.some(team => team.id === targetId)) return { probability: 0, playoffProbability: 0, simulations: 0, reason: "TEAM_NOT_FOUND" };
    const random = seededRandom(seed);
    let titles = 0;
    let playoffs = 0;
    const iterations = Math.max(100, Math.trunc(simulations));
    for (let simulation = 0; simulation < iterations; simulation += 1) {
      const table = clean.map(team => ({ ...team, simWins: team.wins, simPoints: team.pointsFor }));
      for (let week = 0; week < Math.max(0, remainingWeeks); week += 1) {
        const scores = table.map(team => Math.max(0, team.projection + gaussian(random) * team.weeklySd));
        const count = table.length + (table.length % 2);
        const rotating = Array.from({ length: count - 1 }, (_, index) => index + 1);
        const shift = week % rotating.length;
        const order = [0].concat(rotating.slice(shift), rotating.slice(0, shift));
        for (let index = 0; index < count / 2; index += 1) {
          const a = order[index], b = order[count - 1 - index];
          if (a >= table.length || b >= table.length) continue;
          table[a].simPoints += scores[a]; table[b].simPoints += scores[b];
          if (scores[a] >= scores[b]) table[a].simWins += 1; else table[b].simWins += 1;
        }
      }
      const qualified = [...table].sort((a, b) => b.simWins - a.simWins || b.simPoints - a.simPoints).slice(0, Math.min(playoffTeams, table.length));
      if (qualified.some(team => team.id === targetId)) playoffs += 1;
      let field = qualified;
      while (field.length > 1) {
        const next = [];
        for (let index = 0; index < field.length; index += 2) {
          if (!field[index + 1]) { next.push(field[index]); continue; }
          const a = field[index], b = field[index + 1];
          const scoreA = a.projection + gaussian(random) * a.weeklySd;
          const scoreB = b.projection + gaussian(random) * b.weeklySd;
          next.push(scoreA >= scoreB ? a : b);
        }
        field = next;
      }
      if (field[0]?.id === targetId) titles += 1;
    }
    return { probability: round(titles / iterations, 4), playoffProbability: round(playoffs / iterations, 4), simulations: iterations, seed };
  }

  function positionDiagnostics({ roster = [], leagueRosters = [], rosterPositions = [], teams = 12, replacement = null } = {}) {
    const leaguePool = leagueRosters.flatMap(team => team.players || []);
    const pool = leaguePool.length ? leaguePool : roster;
    const replacementData = replacement || replacementLevels(pool, rosterPositions, teams);
    const lineup = optimizeLineup(roster, rosterPositions);
    const teamLineups = leagueRosters.map(team => optimizeLineup(team.players || [], rosterPositions));
    const grouped = new Map();
    lineup.assigned.forEach((row, index) => {
      const position = row.slot;
      const playerProjection = finite(projection(row.player));
      const comparable = teamLineups.map(team => finite(projection(team.assigned[index]?.player))).sort((a, b) => b - a);
      const rank = comparable.length ? comparable.filter(value => value > playerProjection).length + 1 : null;
      const baselinePositions = FLEX[position] || [position];
      const baseline = Math.max(...baselinePositions.map(pos => finite(replacementData.levels[pos])), 0);
      const benchOptions = lineup.bench.filter(player => eligible(player.position, position) && projection(player) !== null).sort((a, b) => projection(b) - projection(a));
      const backup = finite(projection(benchOptions[0]), baseline);
      const gap = Math.max(0, baseline - playerProjection);
      const replacementGap = Math.max(0, playerProjection - backup);
      const uncertainty = finite(row.player?.weeklySd, Math.max(2, playerProjection * 0.18));
      const floorThreshold = baseline * 0.8;
      const eliteThreshold = comparable.length ? comparable[Math.max(0, Math.ceil(comparable.length * 0.25) - 1)] : playerProjection * 1.25;
      const floorProbability = clamp(normalCdf((floorThreshold - playerProjection) / Math.max(1, uncertainty)), 0, 1);
      const ceilingProbability = clamp(1 - normalCdf((eliteThreshold - playerProjection) / Math.max(1, uncertainty)), 0, 1);
      const availabilityRisk = clamp(finite(row.player?.availabilityRisk, row.player?.injury ? 0.45 : 0.12), 0, 1);
      const schedule = clamp(finite(row.player?.scheduleMultiplier, 1), 0.75, 1.25);
      const weeklyAdvantage = Math.max(0, Math.max(...comparable, baseline) - playerProjection);
      const exposure = 1;
      const riskMultiplier = 1 + availabilityRisk + floorProbability * 0.35;
      const bottleneckScore = weeklyAdvantage * exposure * riskMultiplier * (2 - schedule) + gap + replacementGap * availabilityRisk;
      const item = {
        slot: position, player: row.player || null, projection: round(playerProjection), starterRank: rank,
        teams: comparable.length || teams, replacement: round(baseline), backup: round(backup),
        marginalPoints: round(playerProjection - baseline), replacementGap: round(replacementGap),
        ceilingProbability: round(ceilingProbability, 3), floorProbability: round(floorProbability, 3),
        consistency: round(1 / (1 + uncertainty), 3), availabilityRisk: round(availabilityRisk, 3),
        scheduleMultiplier: round(schedule, 3), bottleneckScore: round(bottleneckScore),
      };
      if (!grouped.has(position)) grouped.set(position, []);
      grouped.get(position).push(item);
    });
    return [...grouped.entries()].map(([slot, items]) => ({
      slot, items, bottleneckScore: round(items.reduce((sum, item) => sum + item.bottleneckScore, 0)),
      marginalPoints: round(items.reduce((sum, item) => sum + item.marginalPoints, 0)),
      worstRank: Math.max(...items.map(item => item.starterRank || teams)),
      floorProbability: round(Math.max(...items.map(item => item.floorProbability)), 3),
      availabilityRisk: round(Math.max(...items.map(item => item.availabilityRisk)), 3),
    })).sort((a, b) => b.bottleneckScore - a.bottleneckScore);
  }

  function detectBottlenecks(diagnostics = [], attainableWeeklyPoints = 6, remainingWeeks = 6) {
    const total = diagnostics.reduce((sum, diagnostic) => sum + Math.max(0, diagnostic.bottleneckScore), 0) || 1;
    return diagnostics.map((diagnostic, index) => {
      const share = Math.max(0, diagnostic.bottleneckScore) / total;
      const projectedPointGain = attainableWeeklyPoints * share;
      const estimatedEwa = projectedPointGain / 13.5 * Math.max(1, remainingWeeks) * 0.45;
      return {
        ...diagnostic, rank: index + 1, opportunityShare: round(share, 4),
        projectedPointGain: round(projectedPointGain), estimatedEwa: round(estimatedEwa),
        severity: share >= 0.45 ? "CRITICAL" : share >= 0.25 ? "HIGH" : share >= 0.12 ? "MEDIUM" : "LOW",
      };
    });
  }

  function marginalLineupValue({ roster = [], candidate, removePlayerId = null, rosterPositions = [], opponentProjections = [], remainingWeeks = 6 } = {}) {
    const beforeLineup = optimizeLineup(roster, rosterPositions);
    const afterRoster = roster.filter((player, index) => playerKey(player, index) !== String(removePlayerId || ""));
    if (candidate) afterRoster.push(candidate);
    const afterLineup = optimizeLineup(afterRoster, rosterPositions);
    const weeklyPointGain = afterLineup.projected - beforeLineup.projected;
    const before = [], after = [];
    const opponents = opponentProjections.length ? opponentProjections : Array.from({ length: remainingWeeks }, () => beforeLineup.projected);
    opponents.slice(0, remainingWeeks).forEach((opponentProjection, index) => {
      before.push({ week: index + 1, winProbability: matchupWinProbability(beforeLineup.projected, finite(opponentProjection)) });
      after.push({ week: index + 1, winProbability: matchupWinProbability(afterLineup.projected, finite(opponentProjection)) });
    });
    const ewa = expectedWinsAdded(before, after);
    return { beforeLineup, afterLineup, weeklyPointGain: round(weeklyPointGain), ewa: ewa.expectedWins, weeks: ewa.weeks };
  }

  function transactionImpact({ roster = [], give = [], receive = [], rosterPositions = [], opponentProjections = [], remainingWeeks = 6 } = {}) {
    const outgoing = new Set(give.map((item, index) => playerKey(item, index).toLowerCase()));
    const outgoingNames = new Set(give.map(item => String(item?.name || "").toLowerCase()).filter(Boolean));
    const retained = roster.filter((player, index) => !outgoing.has(playerKey(player, index).toLowerCase()) && !outgoingNames.has(String(player?.name || "").toLowerCase()));
    const beforeLineup = optimizeLineup(roster, rosterPositions);
    const afterLineup = optimizeLineup(retained.concat(receive), rosterPositions);
    const opponents = opponentProjections.length ? opponentProjections : Array.from({ length: remainingWeeks }, () => beforeLineup.projected);
    const before = opponents.slice(0, remainingWeeks).map((opponent, index) => ({ week: index + 1, winProbability: matchupWinProbability(beforeLineup.projected, opponent) }));
    const after = opponents.slice(0, remainingWeeks).map((opponent, index) => ({ week: index + 1, winProbability: matchupWinProbability(afterLineup.projected, opponent) }));
    const ewa = expectedWinsAdded(before, after);
    return { beforeLineup, afterLineup, weeklyPointGain: round(afterLineup.projected - beforeLineup.projected), ewa: ewa.expectedWins, weeks: ewa.weeks };
  }

  function marketMispricing({ marketValue = 0, teamValue = 0 } = {}) {
    const market = Math.max(0, finite(marketValue));
    const team = Math.max(0, finite(teamValue));
    const gap = team - market;
    const gapPct = market > 0 ? gap / market : team > 0 ? 1 : 0;
    const action = gapPct >= 0.35 ? "EXPLOIT" : gapPct >= 0.1 ? "BUY" : gapPct <= -0.2 ? "SELL" : "HOLD";
    return { marketValue: market, teamValue: team, gap: round(gap), gapPct: round(gapPct, 4), action };
  }

  function rankAcquisitionTargets({ targets = [], roster = [], rosterPositions = [], opponentProjections = [], remainingWeeks = 6 } = {}) {
    return targets.map(target => {
      const marginal = marginalLineupValue({ roster, candidate: target, rosterPositions, opponentProjections, remainingWeeks });
      const teamValue = finite(target.teamValue, finite(target.marketValue) + marginal.ewa * 2500);
      const mispricing = marketMispricing({ marketValue: target.marketValue, teamValue });
      const cost = Math.max(1, finite(target.acquisitionCost, target.marketValue || 1));
      const championshipAdded = finite(target.championshipProbabilityAdded, marginal.ewa * 0.04);
      return { ...target, marginal, mispricing, championshipProbabilityAdded: round(championshipAdded, 4), cpa: round(championshipAdded / cost, 7) };
    }).sort((a, b) => b.cpa - a.cpa || b.marginal.ewa - a.marginal.ewa);
  }

  function compareWaiverTrade({ waiver, trade } = {}) {
    const utility = action => finite(action?.championshipProbabilityAdded, finite(action?.ewa) * 0.04) / Math.max(1, finite(action?.permanentAssetCost, action?.cost || 1));
    const waiverUtility = utility(waiver), tradeUtility = utility(trade);
    const recommended = waiverUtility >= tradeUtility ? "WAIVER" : "TRADE";
    const performanceShare = finite(trade?.ewa) > 0 ? clamp(finite(waiver?.ewa) / finite(trade.ewa), 0, 2) : 0;
    return { recommended, waiverUtility: round(waiverUtility, 7), tradeUtility: round(tradeUtility, 7), performanceShare: round(performanceShare, 3) };
  }

  function targetPath(candidate = {}, budgetRemaining = 100) {
    const type = String(candidate.acquisitionType || (candidate.ownerId ? "TRADE" : "WAIVER")).toUpperCase();
    const marketValue = Math.max(0, finite(candidate.marketValue));
    if (type === "WAIVER") {
      return {
        type, label: "WAIVER", ownerId: null, ownerName: "Waivers",
        permanentAssetCost: 0, marketValue, ownerCost: 0,
        faabBudget: Math.max(0, finite(budgetRemaining, 100)),
      };
    }
    const leverage = clamp(finite(candidate.ownerLeverage, 1.08), 0.8, 1.5);
    return {
      type, label: "TRADE", ownerId: candidate.ownerId === undefined ? null : String(candidate.ownerId),
      ownerName: candidate.ownerName || "Unknown manager", permanentAssetCost: round(marketValue * leverage),
      marketValue, ownerCost: round(marketValue * leverage), faabBudget: null,
    };
  }

  function evaluateAcquisitionUniverse({
    candidates = [], roster = [], rosterPositions = [], opponentProjections = [], remainingWeeks = 6,
    leagueTeams = [], teamId = null, playoffTeams = 6, simulations = 300, seed = 2026,
    budgetRemaining = 100, teamValuePerEwa = 2500, teamValuePerTitlePoint = 120,
  } = {}) {
    const beforeLineup = optimizeLineup(roster, rosterPositions);
    const opponents = opponentProjections.length ? opponentProjections : leagueTeams
      .filter(team => String(team.id) !== String(teamId)).map(team => finite(team.projection));
    const weeks = Array.from({ length: Math.max(1, remainingWeeks) }, (_, index) => finite(opponents[index % Math.max(1, opponents.length)], beforeLineup.projected));
    const beforeProbabilities = weeks.map((opponent, index) => ({ week: index + 1, winProbability: matchupWinProbability(beforeLineup.projected, opponent) }));
    const baseChampionship = leagueTeams.length > 1 && teamId !== null ? championshipProbability({
      teams: leagueTeams, teamId, remainingWeeks, playoffTeams, simulations, seed,
    }) : { probability: 0, playoffProbability: 0, simulations: 0 };

    const evaluated = candidates.map((candidate, index) => {
      const path = targetPath(candidate, budgetRemaining);
      const afterLineup = optimizeLineup(roster.concat([{ ...candidate, id: candidate.id || `candidate-${index}` }]), rosterPositions);
      const weeklyPointGain = round(Math.max(0, afterLineup.projected - beforeLineup.projected));
      const afterProbabilities = weeks.map((opponent, week) => ({ week: week + 1, winProbability: matchupWinProbability(afterLineup.projected, opponent) }));
      const ewa = expectedWinsAdded(beforeProbabilities, afterProbabilities).expectedWins;
      let championship = baseChampionship;
      let championshipProbabilityAdded = 0;
      let playoffProbabilityAdded = 0;
      if (weeklyPointGain > 0 && baseChampionship.simulations) {
        const adjustedTeams = leagueTeams.map(team => String(team.id) === String(teamId) ? { ...team, projection: afterLineup.projected } : team);
        championship = championshipProbability({ teams: adjustedTeams, teamId, remainingWeeks, playoffTeams, simulations, seed });
        championshipProbabilityAdded = round(championship.probability - baseChampionship.probability, 4);
        playoffProbabilityAdded = round(championship.playoffProbability - baseChampionship.playoffProbability, 4);
      }
      const teamValue = Math.max(0, finite(candidate.teamValue,
        path.marketValue + ewa * teamValuePerEwa + championshipProbabilityAdded * 100 * teamValuePerTitlePoint));
      const mispricing = marketMispricing({ marketValue: path.marketValue, teamValue });
      const faabPct = path.type === "WAIVER" && weeklyPointGain > 0
        ? clamp(0.03 + weeklyPointGain * 0.018 + Math.max(0, ewa) * 0.16, 0.03, 0.65) : 0;
      const faabCost = path.type === "WAIVER" ? Math.min(path.faabBudget, Math.max(weeklyPointGain > 0 ? 1 : 0, Math.round(path.faabBudget * faabPct))) : null;
      const cpa = path.permanentAssetCost > 0 ? championshipProbabilityAdded / path.permanentAssetCost
        : championshipProbabilityAdded > 0 ? Infinity : 0;
      const championshipReturnPer1000 = path.permanentAssetCost > 0
        ? round(championshipProbabilityAdded * 100 / (path.permanentAssetCost / 1000), 3)
        : null;
      const actionable = projection(candidate) !== null && weeklyPointGain > 0;
      return {
        ...candidate, path, beforeLineup, afterLineup, weeklyPointGain, ewa,
        championshipBefore: baseChampionship.probability, championshipAfter: championship.probability,
        championshipProbabilityAdded, playoffProbabilityAdded, teamValue: round(teamValue), mispricing,
        permanentAssetCost: path.permanentAssetCost, faabCost, cpa, championshipReturnPer1000, actionable,
        dataStatus: projection(candidate) === null ? "NO_PROJECTION" : actionable ? "ACTIONABLE" : "NO_LINEUP_GAIN",
      };
    });

    const bestWaiverByPosition = {};
    evaluated.filter(item => item.path.type === "WAIVER" && item.actionable).forEach(item => {
      const current = bestWaiverByPosition[item.position];
      if (!current || item.championshipProbabilityAdded > current.championshipProbabilityAdded ||
          (item.championshipProbabilityAdded === current.championshipProbabilityAdded && item.ewa > current.ewa)) bestWaiverByPosition[item.position] = item;
    });
    evaluated.forEach(item => {
      const waiver = bestWaiverByPosition[item.position] || null;
      item.waiverAlternative = waiver ? {
        id: waiver.id, name: waiver.name, ewa: waiver.ewa, championshipProbabilityAdded: waiver.championshipProbabilityAdded,
        faabCost: waiver.faabCost,
      } : null;
      if (item.path.type === "TRADE" && waiver) {
        const share = item.ewa > 0 ? clamp(waiver.ewa / item.ewa, 0, 2) : 0;
        item.waiverPerformanceShare = round(share, 3);
        item.pathRecommendation = share >= 0.7 ? "WAIVER FIRST" : item.championshipProbabilityAdded > waiver.championshipProbabilityAdded ? "TRADE EDGE" : "WAIVER FIRST";
      } else item.pathRecommendation = item.path.type === "WAIVER" ? "CLAIM / BID" : "TRADE ONLY";
      const permanentDenominator = Math.max(1, item.permanentAssetCost);
      item.rankScore = item.actionable
        ? item.championshipProbabilityAdded * 100000 + item.ewa * 500 + item.weeklyPointGain * 10 +
          (item.path.type === "WAIVER" ? 120 : 0) + Math.max(-20, Math.min(40, item.mispricing.gapPct * 20)) -
          (item.path.type === "TRADE" ? Math.log10(permanentDenominator) * 4 : (item.faabCost || 0) * 0.15)
        : projection(item) !== null ? -10 : -20;
    });
    evaluated.sort((a, b) => {
      if (a.actionable !== b.actionable) return Number(b.actionable) - Number(a.actionable);
      const aFree = a.actionable && a.permanentAssetCost === 0, bFree = b.actionable && b.permanentAssetCost === 0;
      if (aFree !== bFree) return Number(bFree) - Number(aFree);
      if (aFree && bFree) return b.championshipProbabilityAdded - a.championshipProbabilityAdded || b.ewa - a.ewa || (a.faabCost || 0) - (b.faabCost || 0);
      if (a.actionable && b.actionable && a.championshipReturnPer1000 !== b.championshipReturnPer1000) return b.championshipReturnPer1000 - a.championshipReturnPer1000;
      return b.rankScore - a.rankScore || b.championshipProbabilityAdded - a.championshipProbabilityAdded || b.ewa - a.ewa || String(a.name).localeCompare(String(b.name));
    });
    evaluated.forEach((item, index) => { item.rank = index + 1; });
    return {
      version: VERSION, evaluatedCount: evaluated.length,
      waiverCount: evaluated.filter(item => item.path.type === "WAIVER").length,
      tradeCount: evaluated.filter(item => item.path.type === "TRADE").length,
      actionableCount: evaluated.filter(item => item.actionable).length,
      baseChampionship, bestWaiverByPosition, targets: evaluated,
    };
  }

  function analyzeRoster({ roster = [], leagueRosters = [], rosterPositions = [], teams = 12, teamId = null, standings = [], remainingWeeks = 6, playoffTeams = 6, simulations = 2000, seed = 2026 } = {}) {
    const allPlayers = leagueRosters.flatMap(team => team.players || []);
    const replacement = replacementLevels(allPlayers.length ? allPlayers : roster, rosterPositions, teams);
    const diagnostics = positionDiagnostics({ roster, leagueRosters, rosterPositions, teams, replacement });
    const bottlenecks = detectBottlenecks(diagnostics, 6, remainingWeeks);
    const lineup = optimizeLineup(roster, rosterPositions);
    const leagueTeams = standings.length ? standings : leagueRosters.map((team, index) => {
      const optimized = optimizeLineup(team.players || [], rosterPositions);
      return { id: String(team.id ?? index + 1), projection: optimized.projected, wins: finite(team.wins), pointsFor: finite(team.pointsFor) };
    });
    const championship = championshipProbability({ teams: leagueTeams, teamId, remainingWeeks, playoffTeams, simulations, seed });
    const primary = bottlenecks[0] || null;
    return { version: VERSION, lineup, replacement, diagnostics, bottlenecks, primaryBottleneck: primary, championship, confidence: round(lineup.covered / Math.max(1, lineup.assigned.length), 3) };
  }

  return {
    VERSION, finite, clamp, mean, stdev, eligible, starterSlots, optimizeLineup, slotDemand,
    replacementLevels, matchupWinProbability, expectedWinsAdded, championshipProbability,
    positionDiagnostics, detectBottlenecks, marginalLineupValue, transactionImpact, analyzeRoster,
    marketMispricing, rankAcquisitionTargets, compareWaiverTrade, targetPath, evaluateAcquisitionUniverse,
  };
});
