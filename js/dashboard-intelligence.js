(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FFODashboardIntel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = "1.0.0";
  const HOUR = 3600000;
  const POSITION_DEPTH = { QB: 2, RB: 4, WR: 5, TE: 2, K: 1, DEF: 1, DST: 1 };

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, finite(value)));
  }

  function ageHours(timestamp, now = Date.now()) {
    if (timestamp === null || timestamp === undefined || timestamp === "") return Infinity;
    const parsed = new Date(timestamp).getTime();
    return Number.isFinite(parsed) ? Math.max(0, (now - parsed) / HOUR) : Infinity;
  }

  function freshness(timestamp, maxAgeHours, now = Date.now()) {
    const age = ageHours(timestamp, now);
    if (!Number.isFinite(age)) return { status: "MISSING", ageHours: null, usable: false, confidence: 0 };
    if (age <= maxAgeHours) return { status: "CURRENT", ageHours: age, usable: true, confidence: 1 };
    if (age <= maxAgeHours * 3) return { status: "STALE", ageHours: age, usable: true, confidence: 0.55 };
    return { status: "EXPIRED", ageHours: age, usable: false, confidence: 0.15 };
  }

  function sourceManifest(sources, now = Date.now()) {
    const rows = (sources || []).map(source => {
      const health = freshness(source.timestamp, finite(source.maxAgeHours, 6), now);
      return { ...source, ...health };
    });
    const required = rows.filter(row => row.required !== false);
    const usable = required.filter(row => row.usable);
    const current = required.filter(row => row.status === "CURRENT");
    const status = required.some(row => row.status === "MISSING" || row.status === "EXPIRED")
      ? "DEGRADED"
      : required.some(row => row.status === "STALE") ? "STALE" : "CURRENT";
    return {
      version: VERSION,
      generatedAt: new Date(now).toISOString(),
      status,
      sources: rows,
      requiredCount: required.length,
      usableCount: usable.length,
      currentCount: current.length,
      confidence: required.length ? required.reduce((sum, row) => sum + row.confidence, 0) / required.length : 0,
    };
  }

  function leagueProfile(league) {
    const scoring = league?.scoring_settings || {};
    const settings = league?.settings || {};
    const slots = league?.roster_positions || [];
    const receptions = finite(scoring.rec);
    return {
      teams: finite(league?.total_rosters, 12),
      scoring: receptions >= 1 ? "PPR" : receptions >= 0.5 ? "HALF_PPR" : "STANDARD",
      dynasty: finite(settings.type) === 2,
      keeper: finite(settings.type) === 1,
      superflex: slots.includes("SUPER_FLEX"),
      tePremium: finite(scoring.bonus_rec_te) > 0 || finite(scoring.rec_te) > receptions,
      starters: slots.filter(slot => !["BN", "IR", "TAXI"].includes(slot)).length,
      bench: slots.filter(slot => slot === "BN").length,
      waiverBudget: settings.waiver_budget === undefined ? null : finite(settings.waiver_budget),
      playoffStart: finite(settings.playoff_week_start, null),
    };
  }

  function normalizedPlayer(player, market, projection) {
    const position = player?.position || market?.player?.position || "UNK";
    const name = player?.name || market?.player?.name || `${player?.first_name || ""} ${player?.last_name || ""}`.trim() || "Unknown";
    const projected = projection === null || projection === undefined ? null : finite(projection);
    return {
      id: String(player?.player_id || player?.id || market?.player?.sleeperId || name),
      name,
      position,
      team: player?.team || market?.player?.maybeTeam || null,
      injury: player?.injury_status || player?.status || null,
      marketValue: market ? finite(market.value) : null,
      marketRank: market ? finite(market.overallRank, null) : null,
      trend30: market ? finite(market.trend30Day, null) : null,
      projection: projected,
      confidence: projected !== null ? (player?.injury_status ? 0.68 : 0.86) : market ? 0.5 : 0.2,
    };
  }

  function eligible(position, slot) {
    if (slot === position) return true;
    if (slot === "FLEX") return ["RB", "WR", "TE"].includes(position);
    if (slot === "SUPER_FLEX") return ["QB", "RB", "WR", "TE"].includes(position);
    if (slot === "WRRB_FLEX") return ["WR", "RB"].includes(position);
    if (slot === "REC_FLEX") return ["WR", "TE"].includes(position);
    return false;
  }

  function decisionMetric(player) {
    if (!player) return -Infinity;
    if (player.projection !== null && player.projection !== undefined) return finite(player.projection) * 1000 + finite(player.marketValue) / 100;
    return finite(player.marketValue);
  }

  function optimizeLineup(players, rosterPositions) {
    const slots = (rosterPositions || []).filter(slot => !["BN", "IR", "TAXI"].includes(slot));
    const ranked = [...(players || [])].sort((a, b) => decisionMetric(b) - decisionMetric(a));
    const used = new Set();
    const assigned = [];
    const constrained = [...slots].sort((a, b) => {
      const options = slot => ranked.filter(player => eligible(player.position, slot)).length;
      return options(a) - options(b);
    });
    constrained.forEach(slot => {
      const player = ranked.find(candidate => !used.has(candidate.id) && eligible(candidate.position, slot));
      if (player) used.add(player.id);
      assigned.push({ slot, player: player || null });
    });
    const slotOrder = new Map(slots.map((slot, index) => [slot + ":" + index, index]));
    assigned.sort((a, b) => {
      const ai = slots.indexOf(a.slot);
      const bi = slots.indexOf(b.slot);
      return ai - bi || finite(slotOrder.get(a.slot + ":0")) - finite(slotOrder.get(b.slot + ":0"));
    });
    const bench = ranked.filter(player => !used.has(player.id));
    const projected = assigned.filter(row => row.player?.projection !== null).reduce((sum, row) => sum + finite(row.player.projection), 0);
    return { assigned, bench, projected, projectedStarters: assigned.filter(row => row.player?.projection !== null).length };
  }

  function lineupMoves(assigned, bench) {
    const moves = [];
    (assigned || []).forEach(row => {
      if (!row.player) return;
      const alternative = (bench || [])
        .filter(player => eligible(player.position, row.slot) && player.projection !== null)
        .sort((a, b) => finite(b.projection) - finite(a.projection))[0];
      if (!alternative || row.player.projection === null) return;
      const delta = finite(row.player.projection) - finite(alternative.projection);
      if (Math.abs(delta) <= 3) moves.push({ slot: row.slot, starter: row.player, alternative, delta, confidence: Math.min(row.player.confidence, alternative.confidence) });
    });
    return moves.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
  }

  function rosterAssessment(players, profile) {
    const counts = {};
    const values = {};
    (players || []).forEach(player => {
      counts[player.position] = (counts[player.position] || 0) + 1;
      values[player.position] = (values[player.position] || 0) + finite(player.marketValue);
    });
    const gaps = Object.entries(POSITION_DEPTH).filter(([position, minimum]) => {
      const adjusted = position === "QB" && profile?.superflex ? Math.max(3, minimum) : minimum;
      return (counts[position] || 0) < adjusted;
    }).map(([position, minimum]) => ({ position, count: counts[position] || 0, target: position === "QB" && profile?.superflex ? 3 : minimum }));
    const totalValue = Object.values(values).reduce((sum, value) => sum + value, 0);
    const injuryCount = (players || []).filter(player => player.injury).length;
    const confidence = clamp((players || []).reduce((sum, player) => sum + finite(player.confidence), 0) / Math.max(1, players?.length || 0), 0, 1);
    return { counts, values, gaps, totalValue, injuryCount, confidence, state: gaps.length >= 3 ? "STRUCTURALLY_THIN" : injuryCount >= 3 ? "FRAGILE" : "BALANCED" };
  }

  function acquisitionDecision(target, drop, budgetRemaining) {
    const projectionDelta = target?.projection !== null && drop?.projection !== null ? finite(target.projection) - finite(drop.projection) : null;
    const valueDelta = finite(target?.marketValue) - finite(drop?.marketValue);
    const trend = finite(target?.trend30);
    const score = (projectionDelta === null ? 0 : projectionDelta * 12) + valueDelta / 100 + clamp(trend / 20, -8, 8);
    const urgency = score >= 18 ? "HIGH" : score >= 7 ? "MEDIUM" : "LOW";
    const pct = urgency === "HIGH" ? [0.22, 0.38] : urgency === "MEDIUM" ? [0.08, 0.18] : [0.01, 0.06];
    const remaining = budgetRemaining === null || budgetRemaining === undefined ? null : Math.max(0, finite(budgetRemaining));
    const bidRange = remaining === null ? null : [Math.max(1, Math.round(remaining * pct[0])), Math.max(1, Math.round(remaining * pct[1]))];
    const confidence = clamp(Math.min(finite(target?.confidence, 0.4), finite(drop?.confidence, 0.4)) + (projectionDelta !== null ? 0.1 : 0), 0.2, 0.95);
    return { target, drop, projectionDelta, valueDelta, score, urgency, bidRange, confidence, action: score > 3 ? "ADD" : "WATCH" };
  }

  function tradeDecision(give, receive, rosterAssessmentBefore) {
    const total = items => (items || []).reduce((sum, item) => sum + finite(item.marketValue ?? item.value), 0);
    const projections = items => (items || []).reduce((sum, item) => sum + finite(item.projection), 0);
    const giveValue = total(give);
    const receiveValue = total(receive);
    const valueDelta = receiveValue - giveValue;
    const projectionDelta = projections(receive) - projections(give);
    const scarcity = (receive || []).reduce((score, item) => score + (rosterAssessmentBefore?.gaps || []).some(gap => gap.position === item.position) * 4, 0);
    const score = valueDelta / Math.max(100, Math.max(giveValue, receiveValue)) * 100 + projectionDelta * 2 + scarcity;
    const confidence = clamp(((give || []).length + (receive || []).length) ? 0.55 + ((give || []).concat(receive || []).filter(item => item.projection !== null && item.projection !== undefined).length * 0.06) : 0, 0, 0.92);
    return {
      giveValue, receiveValue, valueDelta, projectionDelta, scarcity, score, confidence,
      fairness: Math.abs(valueDelta) / Math.max(1, Math.max(giveValue, receiveValue)) <= 0.1 ? "FAIR" : "UNEQUAL",
      action: score >= 8 ? "ACCEPT" : score <= -8 ? "DECLINE" : "NEGOTIATE",
    };
  }

  function rankActions(actions) {
    const normalized = (actions || []).map((action, index) => ({
      id: action.id || `action-${index + 1}`,
      confidence: clamp(action.confidence ?? 0.5, 0, 1),
      impact: finite(action.impact),
      urgency: clamp(action.urgency ?? 0.5, 0, 1),
      reversible: action.reversible !== false,
      ...action,
    }));
    normalized.forEach(action => {
      action.priorityScore = action.impact * action.confidence * (0.65 + action.urgency * 0.35) + (action.reversible ? 0.5 : 0);
    });
    return normalized.sort((a, b) => b.priorityScore - a.priorityScore);
  }

  function confidenceLabel(value) {
    const score = finite(value);
    return score >= 0.8 ? "HIGH" : score >= 0.55 ? "MEDIUM" : "LOW";
  }

  return {
    VERSION, POSITION_DEPTH, finite, clamp, ageHours, freshness, sourceManifest, leagueProfile,
    normalizedPlayer, eligible, optimizeLineup, lineupMoves, rosterAssessment, acquisitionDecision,
    tradeDecision, rankActions, confidenceLabel,
  };
});
