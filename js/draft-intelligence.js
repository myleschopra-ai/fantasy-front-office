(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FFODraftIntelligence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"];
  const STRATEGIES = {
    adaptive: {
      label: "Adaptive VBD",
      description:
        "Follow value over replacement and live tier cliffs, then adapt to league settings and the room.",
      weights: {
        market: 0.225,
        vbd: 0.171,
        tier: 0.153,
        need: 0.153,
        availability: 0.072,
        scheme: 0.063,
        strategy: 0.063,
        pedigree: 0.05,
        ageCurve: 0.05,
      },
    },
    balanced: {
      label: "Balanced BPA",
      description:
        "Use league-adjusted best player available without creating avoidable starter gaps.",
      weights: {
        market: 0.243,
        vbd: 0.162,
        tier: 0.144,
        need: 0.153,
        availability: 0.072,
        scheme: 0.063,
        strategy: 0.063,
        pedigree: 0.05,
        ageCurve: 0.05,
      },
    },
    "hero-rb": {
      label: "Hero RB",
      description:
        "Secure one premium back early, build WR/FLEX strength, then return to RB depth.",
      weights: {
        market: 0.207,
        vbd: 0.153,
        tier: 0.135,
        need: 0.144,
        availability: 0.072,
        scheme: 0.063,
        strategy: 0.126,
        pedigree: 0.05,
        ageCurve: 0.05,
      },
    },
    "zero-rb": {
      label: "Zero RB",
      description:
        "Build WR/FLEX leverage early and attack high-upside RB volume after the early rounds.",
      weights: {
        market: 0.198,
        vbd: 0.144,
        tier: 0.135,
        need: 0.126,
        availability: 0.072,
        scheme: 0.063,
        strategy: 0.162,
        pedigree: 0.05,
        ageCurve: 0.05,
      },
    },
    "robust-rb": {
      label: "Robust RB",
      description:
        "Build early RB volume only when backs remain within the same value tier as alternatives.",
      weights: {
        market: 0.198,
        vbd: 0.153,
        tier: 0.153,
        need: 0.126,
        availability: 0.072,
        scheme: 0.063,
        strategy: 0.135,
        pedigree: 0.05,
        ageCurve: 0.05,
      },
    },
    "late-qb": {
      label: "Late-Round QB",
      description:
        "In one-QB leagues, wait through flat QB tiers unless an elite value falls.",
      weights: {
        market: 0.216,
        vbd: 0.171,
        tier: 0.144,
        need: 0.126,
        availability: 0.072,
        scheme: 0.063,
        strategy: 0.108,
        pedigree: 0.05,
        ageCurve: 0.05,
      },
    },
    "early-qb": {
      label: "Early QB / Superflex",
      description:
        "Prioritize scarce starting quarterbacks in Superflex; in one-QB, require an elite tier value.",
      weights: {
        market: 0.198,
        vbd: 0.171,
        tier: 0.144,
        need: 0.135,
        availability: 0.072,
        scheme: 0.063,
        strategy: 0.117,
        pedigree: 0.05,
        ageCurve: 0.05,
      },
    },
    "elite-te": {
      label: "Elite TE",
      description:
        "Pay for a true difference-maker at tight end, not a name from a flat middle tier.",
      weights: {
        market: 0.198,
        vbd: 0.171,
        tier: 0.162,
        need: 0.126,
        availability: 0.072,
        scheme: 0.063,
        strategy: 0.108,
        pedigree: 0.05,
        ageCurve: 0.05,
      },
    },
  };

  const clamp = (value, min = 0, max = 100) =>
    Math.max(min, Math.min(max, Number(value) || 0));
  const numeric = (value, fallback = null) =>
    Number.isFinite(Number(value)) ? Number(value) : fallback;
  const normalizeName = (value) =>
    String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const playerKey = (player) =>
    `${normalizeName(player.name || player.player_name)}|${String(player.position || player.pos || "").toUpperCase()}`;

  function percentileRank(rank, size) {
    if (!rank || !size || size <= 1) return 50;
    return clamp(100 - ((rank - 1) / (size - 1)) * 100);
  }

  function median(values) {
    const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!clean.length) return 0;
    const middle = Math.floor(clean.length / 2);
    return clean.length % 2
      ? clean[middle]
      : (clean[middle - 1] + clean[middle]) / 2;
  }

  function assignTiers(
    players,
    scoreField = "consensusScore",
    groupField = "position",
  ) {
    const groups = new Map();
    players.forEach((player) => {
      const group = String(player[groupField] || "ALL");
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(player);
    });
    groups.forEach((group) => {
      group.sort(
        (a, b) => numeric(b[scoreField], 0) - numeric(a[scoreField], 0),
      );
      const gaps = group
        .slice(0, -1)
        .map((player, index) =>
          Math.max(
            0,
            numeric(player[scoreField], 0) -
              numeric(group[index + 1][scoreField], 0),
          ),
        );
      const gapMedian = median(gaps);
      const mad = median(gaps.map((gap) => Math.abs(gap - gapMedian)));
      const threshold = Math.max(1.75, gapMedian + Math.max(1, mad * 1.35));
      let tier = 1;
      group.forEach((player, index) => {
        const gapAfter = gaps[index] || 0;
        player.tier = numeric(player.tier, tier);
        player.tierGapAfter = Math.round(gapAfter * 10) / 10;
        player.tierEnd = index === group.length - 1 || gapAfter >= threshold;
        if (player.tierEnd) tier += 1;
      });
    });
    return players;
  }

  function selectProfile(intelligence, league = {}) {
    const profiles = intelligence?.profiles || {};
    const dynasty =
      String(league.league_type || league.type || "").toLowerCase() ===
      "dynasty";
    const roster = league.roster || {};
    const superflex =
      Number(roster.SUPER_FLEX || roster.SF || 0) > 0 ||
      Number(roster.QB || 1) > 1;
    const ppr = numeric(league.scoring?.reception, 0.5);
    const scoring = ppr >= 0.75 ? "ppr" : ppr <= 0.25 ? "standard" : "half";
    const candidates = dynasty
      ? [
          `dynasty_${superflex ? "superflex" : "1qb"}_${scoring}`,
          `dynasty_${superflex ? "superflex" : "1qb"}_half`,
        ]
      : [
          `redraft_${superflex ? "superflex" : "1qb"}_${scoring}`,
          `redraft_${superflex ? "superflex" : "1qb"}_half`,
          "redraft_1qb_half",
        ];
    const id =
      candidates.find((candidate) => profiles[candidate]) ||
      Object.keys(profiles)[0] ||
      null;
    return id ? { id, ...profiles[id] } : null;
  }

  function enrichPlayers(livePlayers, profile) {
    const intelPlayers = profile?.players || [];
    const byId = new Map();
    const byName = new Map();
    intelPlayers.forEach((player) => {
      if (player.sleeper_id != null)
        byId.set(String(player.sleeper_id), player);
      byName.set(playerKey(player), player);
    });
    const base = livePlayers?.length
      ? livePlayers
      : intelPlayers.map((player) => ({
          key: String(player.sleeper_id || playerKey(player)),
          name: player.name,
          position: player.position,
          nflTeam: player.team || "",
          rank: player.overall_rank,
          value: player.market_value || 0,
        }));
    const merged = base
      .map((player, index) => {
        const found =
          byId.get(String(player.key || player.playerId || "")) ||
          byName.get(playerKey(player)) ||
          {};
        return {
          ...player,
          ...found,
          key: String(
            player.key ||
              player.playerId ||
              found.sleeper_id ||
              playerKey(player),
          ),
          name: player.name || found.name || "Unknown",
          position: String(
            player.position || found.position || "?",
          ).toUpperCase(),
          nflTeam: player.nflTeam || player.team || found.team || "",
          rank: numeric(found.overall_rank, numeric(player.rank, index + 1)),
          overallRank: numeric(
            found.overall_rank,
            numeric(player.rank, index + 1),
          ),
          posRank: numeric(found.position_rank, null),
          tier: numeric(found.position_tier, numeric(player.tier, null)),
          overallTier: numeric(found.overall_tier, null),
          tierGapAfter: numeric(found.tier_gap_after, 0),
          tierEnd: Boolean(found.tier_end),
          consensusScore: numeric(
            found.consensus_score,
            percentileRank(numeric(player.rank, index + 1), base.length),
          ),
          sourceCount: numeric(
            found.source_count,
            found.source_ranks ? Object.keys(found.source_ranks).length : 1,
          ),
          sourceRanks: found.source_ranks || {},
          rankRange: found.rank_range || null,
          agreement: numeric(found.agreement, 50),
          adp: numeric(
            found.adp,
            numeric(
              player.adp,
              numeric(found.overall_rank, numeric(player.rank, index + 1)),
            ),
          ),
          marketValue: numeric(found.market_value, numeric(player.value, 0)),
          schemeFit: found.scheme_fit || null,
          archetype: found.archetype || null,
          evidence: found.evidence || [],
          projectedPoints: numeric(
            found.projected_points ?? found.projectedPoints ?? player.projectedPoints,
            null,
          ),
          projectionSource:
            found.projection_source || player.projectionSource || null,
          projectionMode:
            found.projection_mode || player.projectionMode || null,
          projectionConfidence: numeric(
            found.projection_confidence ?? player.projectionConfidence,
            null,
          ),
          projectionStats:
            found.projection_stats || player.projectionStats || null,
          projectionPpr: numeric(
            found.projection_ppr ?? player.projectionPpr,
            null,
          ),
        };
      })
      .filter((player) => POSITIONS.includes(player.position));
    const positionCounters = {};
    merged
      .sort((a, b) => a.overallRank - b.overallRank)
      .forEach((player) => {
        positionCounters[player.position] =
          (positionCounters[player.position] || 0) + 1;
        if (!player.posRank) player.posRank = positionCounters[player.position];
      });
    assignTiers(
      merged.filter((player) => !player.tier),
      "consensusScore",
      "position",
    );
    return merged.sort((a, b) => a.overallRank - b.overallRank);
  }

  function rosterCounts(picks) {
    const counts = {};
    (picks || []).forEach((pick) => {
      const position = pick.position;
      if (!position) return;
      counts[position] = numeric(counts[position], 0) + 1;
    });
    return counts;
  }

  function starterTargets(league = {}) {
    const roster = league.roster || {};
    const targets = {
      QB: Math.max(
        1,
        numeric(roster.QB, 1) + (numeric(roster.SUPER_FLEX, 0) > 0 ? 1 : 0),
      ),
      RB: Math.max(2, numeric(roster.RB, 2)),
      WR: Math.max(2, numeric(roster.WR, 2)),
      TE: Math.max(1, numeric(roster.TE, 1)),
      K: Math.max(0, numeric(roster.K, 0)),
      DST: Math.max(0, numeric(roster.DST, 0)),
    };
    const flex = numeric(roster.FLEX, 0);
    if (flex > 0) {
      targets.WR += Math.ceil(flex * 0.5);
      targets.RB += Math.floor(flex * 0.35);
      targets.TE += Math.floor(flex * 0.15);
    }
    const wrRbFlex = numeric(roster.WRRB_FLEX ?? roster.RB_WR, 0);
    if (wrRbFlex > 0) {
      targets.WR += Math.ceil(wrRbFlex * 0.55);
      targets.RB += Math.floor(wrRbFlex * 0.45);
    }
    const receiverFlex = numeric(roster.REC_FLEX ?? roster.WR_TE, 0);
    if (receiverFlex > 0) {
      targets.WR += Math.ceil(receiverFlex * 0.7);
      targets.TE += Math.floor(receiverFlex * 0.3);
    }
    const universalFlex = numeric(roster.WR_RB_TE, 0);
    if (universalFlex > 0) {
      targets.WR += Math.ceil(universalFlex * 0.5);
      targets.RB += Math.floor(universalFlex * 0.35);
      targets.TE += Math.floor(universalFlex * 0.15);
    }
    return targets;
  }

  function strategyCompatibility(strategy, league = {}) {
    const roster = league.roster || {};
    const ppr = numeric(league.scoring?.reception, 0.5);
    const superflex =
      numeric(roster.SUPER_FLEX, 0) > 0 || numeric(roster.QB, 1) > 1;
    const flexReceivers = numeric(roster.WR, 2) + numeric(roster.FLEX, 0) +
      numeric(roster.WRRB_FLEX ?? roster.RB_WR, 0) +
      numeric(roster.REC_FLEX ?? roster.WR_TE, 0) +
      numeric(roster.WR_RB_TE, 0);
    if (strategy === "zero-rb" && (ppr < 0.5 || flexReceivers < 3))
      return {
        viable: false,
        warning:
          "Zero RB loses leverage in this scoring/lineup: use it only when WR value falls.",
      };
    if (strategy === "late-qb" && superflex)
      return {
        viable: false,
        warning:
          "Late-Round QB is unsafe in Superflex because viable starters are scarce.",
      };
    if (strategy === "early-qb" && !superflex)
      return {
        viable: true,
        warning:
          "One-QB guardrail: only pay early for the elite tier or a material ADP fall.",
      };
    return { viable: true, warning: "" };
  }

  function strategyBias(player, context) {
    const strategy = context.strategy || "adaptive";
    const round = numeric(context.round, 1);
    const counts = context.counts || rosterCounts(context.picks);
    const superflex = Boolean(context.superflex);
    const pos = player.position;
    let score = 50;
    if (strategy === "adaptive") {
      if (superflex && pos === "QB" && counts.QB < 2) score += 22;
      if (!superflex && pos === "QB" && counts.QB >= 1) score -= 28;
      if (player.tierEnd && player.tierGapAfter >= 3) score += 16;
      if ((context.need || 0) >= 75) score += 12;
    }
    if (strategy === "hero-rb") {
      if (pos === "RB" && counts.RB === 0 && round <= 3) score += 35;
      if (pos === "RB" && counts.RB >= 1 && round <= 6) score -= 24;
      if (pos === "WR" && counts.RB >= 1 && round <= 6) score += 20;
      if (pos === "RB" && round >= 7 && counts.RB < 4) score += 22;
    }
    if (strategy === "zero-rb") {
      if (pos === "RB" && round <= 5) score -= 38;
      if ((pos === "WR" || pos === "TE") && round <= 6) score += 24;
      if (pos === "RB" && round >= 6 && counts.RB === 0) score += 38;
      if (pos === "RB" && round >= 7 && round <= 10 && counts.RB < 4)
        score += 28;
    }
    if (strategy === "robust-rb") {
      if (pos === "RB" && round <= 4 && counts.RB < 3) score += 30;
      if (pos === "RB" && counts.RB >= 3) score -= 28;
    }
    if (strategy === "late-qb") {
      if (
        pos === "QB" &&
        !superflex &&
        round <= 6 &&
        numeric(player.posRank, 99) > 3
      )
        score -= 34;
      if (pos === "QB" && !superflex && round >= 7 && counts.QB === 0)
        score += 30;
    }
    if (strategy === "early-qb") {
      if (pos === "QB" && superflex && counts.QB < 2) score += 36;
      if (
        pos === "QB" &&
        !superflex &&
        counts.QB === 0 &&
        numeric(player.posRank, 99) <= 3
      )
        score += 20;
      if (pos === "QB" && !superflex && counts.QB >= 1) score -= 42;
    }
    if (strategy === "elite-te") {
      if (pos === "TE" && counts.TE === 0 && numeric(player.tier, 99) === 1)
        score += 38;
      if (pos === "TE" && numeric(player.tier, 99) > 1 && round <= 5)
        score -= 24;
      if (pos === "TE" && counts.TE >= 1) score -= 36;
    }
    return clamp(score);
  }

  function replacementRank(position, context) {
    const teams = numeric(context.teams, 12);
    const targets = context.targets || starterTargets(context.league);
    const flexBuffer =
      position === "RB" || position === "WR" ? Math.ceil(teams * 0.35) : 2;
    return Math.max(1, teams * numeric(targets[position], 1) + flexBuffer);
  }

  // ---------------------------------------------------------------------
  // Value Over Replacement (spec Section 5) — real projected fantasy
  // points, not a rank-based proxy, once projection data is available.
  // Replacement level is derived dynamically from THIS league's actual
  // config (team count, starter targets including FLEX/Superflex demand)
  // rather than a universal QB12/RB24/WR24/TE12 assumption — a 12-team
  // Superflex league and a 10-team 1QB league produce different QB
  // replacement levels because starterTargets() already accounts for
  // SUPER_FLEX/FLEX demand.
  // ---------------------------------------------------------------------

  // Computes replacement-level projected points per position from the full
  // player pool. Call once per pool load, not per player — this needs
  // every player's projected points to find the Nth-ranked player's score.
  function computeReplacementPoints(players, context) {
    const byPosition = {};
    (players || []).forEach((player) => {
      if (player.projectedPoints == null || !player.position) return;
      byPosition[player.position] = byPosition[player.position] || [];
      byPosition[player.position].push(player.projectedPoints);
    });
    const replacementPoints = {};
    Object.entries(byPosition).forEach(([position, points]) => {
      points.sort((a, b) => b - a);
      const rank = replacementRank(position, context);
      // Fail closed on partial projection feeds. Clamping a 10-player sample
      // to its last row pretends that QB10/RB10/etc. is replacement level and
      // creates enormous fake VORP. No replacement point is better than a
      // fabricated one; vbdScore() has a league-aware rank fallback.
      if (points.length < rank) {
        replacementPoints[position] = null;
        return;
      }
      replacementPoints[position] = points[rank - 1];
    });
    return replacementPoints;
  }

  // Computes a 0-100 VORP percentile across the eligible SKILL-PLAYER pool.
  // VORP is already "points above replacement," so it is specifically the
  // cross-position quantity we want to compare. Normalizing independently
  // inside each position incorrectly makes QB1, TE1, K1 and DST1 all look
  // like 100-value assets even when their actual advantage over replacement
  // is radically different.
  //
  // This function also fails closed when the projection feed does not reach
  // replacement level for all four offensive skill positions. Mixing a few
  // true projected-point VORPs with rank-proxy VBD for the rest of the board
  // creates incompatible scales and was observed with the 10-row API sample.
  function computeVBDPercentiles(players, context) {
    const replacementPoints = computeReplacementPoints(players, context);
    const corePositions = ["QB", "RB", "WR", "TE"];
    if (corePositions.some((position) => replacementPoints[position] == null)) {
      return {};
    }

    const entries = [];
    (players || []).forEach((player) => {
      if (!corePositions.includes(player.position) || player.projectedPoints == null) return;
      const replacement = replacementPoints[player.position];
      if (replacement == null) return;
      entries.push({
        key: player.key,
        vorp: player.projectedPoints - replacement,
      });
    });
    if (!entries.length) return {};

    const vorps = entries.map((entry) => entry.vorp);
    const min = Math.min(...vorps);
    const max = Math.max(...vorps);
    const range = Math.max(1, max - min);
    const result = {};
    entries.forEach((entry) => {
      result[entry.key] = clamp(((entry.vorp - min) / range) * 100);
    });
    return result;
  }

  function projectionCoverageContract(players, context = {}) {
    const league = context.league || {};
    const roster = league.roster || {};
    const teams = Math.max(4, numeric(context.teams ?? league.teams, 12));
    const enabled = {
      QB: numeric(roster.QB, 1) > 0 || numeric(roster.SUPER_FLEX ?? roster.SF, 0) > 0,
      RB: numeric(roster.RB, 2) > 0 || numeric(roster.FLEX, 0) > 0,
      WR: numeric(roster.WR, 2) > 0 || numeric(roster.FLEX, 0) > 0,
      TE: numeric(roster.TE, 1) > 0 || numeric(roster.FLEX, 0) > 0,
      K: numeric(roster.K, 0) > 0,
      DST: numeric(roster.DST, 0) > 0,
    };
    const baseline = { QB: 32, RB: 72, WR: 84, TE: 32, K: 20, DST: 20 };
    const targets = starterTargets(league);
    const bench = Math.max(0, numeric(roster.BENCH ?? roster.BN, 6));
    const benchShares = { QB: 0.10, RB: 0.32, WR: 0.38, TE: 0.14, K: 0.03, DST: 0.03 };
    const byPosition = {};
    let complete = true;
    POSITIONS.forEach((position) => {
      const dynamic = Math.ceil(
        teams * numeric(targets[position], position === "K" || position === "DST" ? 0 : 1) +
          teams * bench * benchShares[position] +
          Math.max(4, Math.ceil(teams * 0.25)),
      );
      const required = enabled[position] ? Math.max(baseline[position], dynamic) : 0;
      const poolRows = (players || []).filter((player) => player.position === position);
      const eligibleRows = poolRows.filter(
        (player) =>
          numeric(player.projectedPoints ?? player.projected_points, null) != null,
      );
      const openModelRows = eligibleRows.filter(
        (player) => String(player.projectionMode || player.projection_mode || "").toUpperCase() === "OPEN_MODEL_PROJECTION",
      );
      const directRows = eligibleRows.filter((player) => !openModelRows.includes(player));
      const ready = required === 0 || eligibleRows.length >= required;
      if (!ready) complete = false;
      byPosition[position] = {
        pool: poolRows.length,
        direct: directRows.length,
        openModel: openModelRows.length,
        eligible: eligibleRows.length,
        required,
        complete: ready,
      };
    });
    const depthBands = {};
    [
      ["top50", 1, 50],
      ["middle", 51, 120],
      ["late", 121, 200],
      ["deep", 201, Infinity],
    ].forEach(([label, low, high]) => {
      const rows = (players || []).filter((player) => {
        const rank = numeric(player.overallRank ?? player.overall_rank ?? player.rank, Infinity);
        return rank >= low && rank <= high;
      });
      const eligible = rows.filter(
        (player) =>
          numeric(player.projectedPoints ?? player.projected_points, null) != null,
      ).length;
      depthBands[label] = {
        players: rows.length,
        eligible,
        coverage: rows.length ? eligible / rows.length : 0,
      };
    });
    return {
      status: complete ? "COMPLETE" : "INCOMPLETE",
      complete,
      byPosition,
      depthBands,
      directPlayers: Object.values(byPosition).reduce((sum, row) => sum + row.direct, 0),
      openModelPlayers: Object.values(byPosition).reduce((sum, row) => sum + row.openModel, 0),
      eligiblePlayers: Object.values(byPosition).reduce((sum, row) => sum + row.eligible, 0),
      poolPlayers: (players || []).length,
    };
  }

  function leagueAdjustedProjectedPoints(player, league = {}) {
    const base = numeric(
      player.rawProjectedPoints ?? player.projectedPoints ?? player.projected_points,
      null,
    );
    if (base == null) return null;
    const stats = player.projectionStats || player.projection_stats || {};
    const receptions = numeric(
      stats.rec ?? stats.receptions ?? stats.receiving_receptions,
      null,
    );
    const sourcePpr = numeric(player.projectionPpr ?? player.projection_ppr, null);
    const leaguePpr = numeric(league.scoring?.reception, sourcePpr);
    let adjusted = base;
    if (receptions != null && sourcePpr != null && leaguePpr != null) {
      adjusted += receptions * (leaguePpr - sourcePpr);
    }
    if (String(player.position || "").toUpperCase() === "TE" && receptions != null) {
      adjusted += receptions * Math.max(
        0,
        numeric(
          league.scoring?.te_premium ?? league.scoring?.tePremium ?? league.scoring?.bonus_rec_te,
          0,
        ),
      );
    }
    const sourceScoring = player.projectionScoring || player.projection_scoring || {};
    const passingYards = numeric(stats.pass_yd ?? stats.passing_yards, null);
    const passingTouchdowns = numeric(stats.pass_td ?? stats.passing_touchdowns, null);
    const interceptions = numeric(stats.pass_int ?? stats.interceptions, null);
    const passingFirstDowns = numeric(stats.pass_fd ?? stats.passing_first_downs, null);
    const rushingFirstDowns = numeric(stats.rush_fd ?? stats.rushing_first_downs, null);
    const receivingFirstDowns = numeric(stats.rec_fd ?? stats.receiving_first_downs, null);
    const score = league.scoring || {};
    if (passingYards != null) {
      adjusted += passingYards * (
        numeric(score.pass_yd ?? score.passing_yard, numeric(sourceScoring.pass_yd, 0.04)) -
        numeric(sourceScoring.pass_yd, 0.04)
      );
    }
    if (passingTouchdowns != null) {
      adjusted += passingTouchdowns * (
        numeric(score.pass_td ?? score.passing_td, numeric(sourceScoring.pass_td, 4)) -
        numeric(sourceScoring.pass_td, 4)
      );
    }
    if (interceptions != null) {
      adjusted += interceptions * (
        numeric(score.pass_int ?? score.interception, numeric(sourceScoring.pass_int, -2)) -
        numeric(sourceScoring.pass_int, -2)
      );
    }
    if (passingFirstDowns != null) adjusted += passingFirstDowns * numeric(score.pass_fd, 0);
    if (rushingFirstDowns != null) adjusted += rushingFirstDowns * numeric(score.rush_fd, 0);
    if (receivingFirstDowns != null) adjusted += receivingFirstDowns * numeric(score.rec_fd, 0);
    return Math.round(Math.max(0, adjusted) * 10) / 10;
  }

  function lateRoundValueScore(player, context = {}) {
    const rank = numeric(player.overallRank ?? player.overall_rank ?? player.rank, 999);
    const adp = numeric(player.adp, rank);
    const sourceRanks = Object.values(player.sourceRanks || player.source_ranks || {})
      .map((value) => numeric(value, null))
      .filter((value) => value != null);
    const bestSourceRank = sourceRanks.length ? Math.min(...sourceRanks) : rank;
    const marketDiscount = clamp(50 + (adp - rank) * 2.2);
    const evidenceUpside = clamp(50 + (adp - bestSourceRank) * 1.25);
    const scheme = clamp(numeric(player.schemeFit?.score ?? player.scheme_fit?.score, 50));
    const pedigree = clamp(numeric(player.pedigreeScore, 50));
    const ageCurve = clamp(numeric(player.ageCurveScore, 50));
    const projection = player.vbdPercentileScore != null
      ? clamp(numeric(player.vbdPercentileScore, 50))
      : numeric(player.projectedPoints ?? player.projected_points, null) != null
        ? 58
        : 45;
    let score = clamp(
      marketDiscount * 0.28 +
        evidenceUpside * 0.20 +
        projection * 0.22 +
        scheme * 0.12 +
        pedigree * 0.10 +
        ageCurve * 0.08,
    );
    const projectionConfidence = numeric(
      player.projectionConfidence ?? player.projection_confidence,
      numeric(player.projectedPoints ?? player.projected_points, null) != null ? 70 : 25,
    );
    const confidence = clamp(
      numeric(player.agreement, 50) * 0.45 +
        Math.min(100, numeric(player.sourceCount ?? player.source_count, 1) * 20) * 0.25 +
        projectionConfidence * 0.30,
    );
    const directProjection = numeric(player.projectedPoints ?? player.projected_points, null) != null &&
      String(player.projectionMode || player.projection_mode || "").toUpperCase() !== "OPEN_MODEL_PROJECTION" &&
      !String(player.projectionSource || player.projection_source || "").startsWith("modeled");
    if (!directProjection) score = Math.min(score, 78);
    const lateThreshold = Math.max(60, numeric(context.teams, 12) * 5);
    const eligible = rank > lateThreshold || adp > lateThreshold;
    const reasons = [];
    if (adp - rank >= 8) reasons.push(`model ranks player ${Math.round(adp - rank)} picks ahead of ADP`);
    if (bestSourceRank + 10 <= adp) reasons.push("at least one source identifies material market upside");
    if (projection >= 65) reasons.push("projection carries above-replacement upside");
    if (scheme >= 65) reasons.push("team environment supports the player archetype");
    if (!directProjection) reasons.push("open-model estimate is used; confidence remains evidence-weighted");
    return {
      score: Math.round(score),
      confidence: Math.round(confidence),
      eligible,
      directProjection,
      label: !eligible ? "NOT_LATE" : score >= 72 && confidence >= 58 ? "DIAMOND" : score >= 62 ? "WATCH" : "DEPTH",
      reasons: reasons.slice(0, 3),
    };
  }

  function vbdScore(player, context) {
    // Prefer real, pool-wide projected-point VORP when complete projection
    // coverage exists. Otherwise use the FORMAT-SPECIFIC overall board as
    // the fallback anchor; a positional rank proxy made every position's
    // No. 1 option look elite across positions and materially inflated TE,
    // K, DST, and 1QB quarterbacks.
    if (player.vbdPercentileScore != null) {
      return clamp(numeric(player.vbdPercentileScore, 50));
    }

    const poolSize = numeric(context.poolSize, 250);
    let score = percentileRank(
      numeric(player.overallRank || player.rank, poolSize),
      poolSize,
    );
    const roster = context.league?.roster || {};
    const superflex =
      numeric(roster.SUPER_FLEX, 0) > 0 || numeric(roster.QB, 1) > 1;
    if (player.position === "QB") score += superflex ? 10 : -4;
    if (player.position === "WR") {
      score += Math.max(0, numeric(roster.WR, 2) - 2) * 3;
      score += Math.max(0, numeric(roster.FLEX, 0)) * 0.75;
    }
    if (player.position === "RB") {
      score += Math.max(0, numeric(roster.FLEX, 0)) * 0.5;
    }
    // K/DST advantages over replacement are narrow and volatile. Without
    // full projections, never infer first-round-like value from K1/DST1.
    if (player.position === "K" || player.position === "DST") {
      score = Math.min(score, 18);
    }
    return clamp(score);
  }

  // ---------------------------------------------------------------------
  // FLEX / Starting-Lineup Optimizer (spec Section 6). FLEX is treated as
  // slot eligibility, not a position. Given any set of drafted players and
  // a league's roster config, determine the actual optimal legal starting
  // lineup by greedily assigning the highest-Player-Grade player to each
  // slot in eligibility order. This replaces the previous flat
  // "count vs target" heuristic, which could not tell "this slot already
  // has a strong starter" apart from "this slot has a weak starter this
  // new player would actually upgrade."
  // ---------------------------------------------------------------------
  const SLOT_ELIGIBILITY = {
    QB: ["QB"],
    RB: ["RB"],
    WR: ["WR"],
    TE: ["TE"],
    K: ["K"],
    DST: ["DST"],
    FLEX: ["RB", "WR", "TE"],
    SUPER_FLEX: ["QB", "RB", "WR", "TE"],
    SF: ["QB", "RB", "WR", "TE"],
    WRRB_FLEX: ["RB", "WR"],
    REC_FLEX: ["WR", "TE"],
    RB_WR: ["RB", "WR"],
    WR_TE: ["WR", "TE"],
    WR_RB_TE: ["RB", "WR", "TE"],
  };
  const NON_STARTER_SLOTS = new Set(["BENCH", "BN", "TAXI", "IR"]);

  function optimalLineup(picks, league = {}) {
    const roster = league.roster || {};
    const slots = [];
    Object.entries(roster).forEach(([slotName, count]) => {
      if (NON_STARTER_SLOTS.has(slotName)) return;
      for (let i = 0; i < numeric(count, 0); i += 1) slots.push(slotName);
    });
    const pool = (picks || [])
      .filter((player) => player && player.position)
      .map((player) => ({ player, grade: playerGrade(player), used: false }))
      .sort((a, b) => b.grade - a.grade);
    const starters = slots.map((slotName) => {
      const eligible = SLOT_ELIGIBILITY[slotName] || [slotName];
      const match = pool.find(
        (entry) => !entry.used && eligible.includes(entry.player.position),
      );
      if (match) match.used = true;
      return { slot: slotName, player: match ? match.player : null };
    });
    const bench = pool.filter((entry) => !entry.used).map((entry) => entry.player);
    return { starters, bench, slots };
  }

  // Would this specific candidate actually enter the optimal starting
  // lineup if added to the current roster right now? This is the real
  // signal Dynamic Roster Need (spec Section 7) needs — not "have I met
  // a raw count," but "does this exact player improve my starters."
  function wouldStart(candidate, picks, league) {
    const lineup = optimalLineup([...(picks || []), candidate], league);
    return lineup.starters.some((s) => s.player === candidate);
  }

  // ---------------------------------------------------------------------
  // Weekly Win Probability Added (WWPA)
  //
  // This is the objective layer above the existing player/market/league
  // values. It projects the best legal weekly lineup, preserves uncertainty
  // and player covariance, compares that distribution with the league's
  // expected opponent distribution, and measures the percentage-point lift
  // produced by one candidate. Explicit weekly inputs win; transparent,
  // league-aware estimates are used when the source feed is season-only.
  // ---------------------------------------------------------------------
  const POSITION_WEEKLY_CV = { QB: 0.27, RB: 0.43, WR: 0.48, TE: 0.50, K: 0.42, DST: 0.55 };
  const BASELINE_SLOT_MEAN = {
    QB: 18, RB: 10.8, WR: 10.8, TE: 8.4, FLEX: 10.1,
    SUPER_FLEX: 15.5, SF: 15.5, WRRB_FLEX: 10.4, REC_FLEX: 9.6,
    RB_WR: 10.4, WR_TE: 9.6, WR_RB_TE: 10.1, K: 7.5, DST: 7.5,
  };

  function normalCdf(value) {
    const x = Number(value) || 0;
    const sign = x < 0 ? -1 : 1;
    const z = Math.abs(x) / Math.sqrt(2);
    const t = 1 / (1 + 0.3275911 * z);
    const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z));
    return clamp01((1 + erf) / 2);
  }

  function regularSeasonWeeks(context = {}) {
    const league = context.league || {};
    const playoffStart = numeric(
      league.settings?.playoff_week_start ?? league.playoff_week_start,
      null,
    );
    return Math.max(1, Math.round(numeric(
      context.regularSeasonWeeks ?? league.settings?.regular_season_weeks ?? league.regular_season_weeks,
      playoffStart != null && playoffStart > 1 ? playoffStart - 1 : 14,
    )));
  }

  function slotBaseline(slot, context = {}) {
    const league = context.league || {};
    const scoring = league.scoring || {};
    const teams = Math.max(4, numeric(context.teams ?? league.teams ?? league.total_rosters, 12));
    const key = String(slot || "FLEX").toUpperCase();
    let mean = numeric(BASELINE_SLOT_MEAN[key], 9.5);
    const pprDelta = numeric(scoring.reception, 0.5) - 0.5;
    if (["WR", "REC_FLEX", "WR_TE"].includes(key)) mean += pprDelta * 1.5;
    if (["RB", "FLEX", "WRRB_FLEX", "RB_WR", "WR_RB_TE"].includes(key)) mean += pprDelta * 0.9;
    if (key === "TE" || key === "REC_FLEX" || key === "WR_TE") {
      mean += pprDelta * 1.1 + numeric(scoring.te_premium ?? scoring.tePremium ?? scoring.bonus_rec_te, 0) * 1.4;
    }
    if (key === "QB" || key === "SUPER_FLEX" || key === "SF") {
      mean += (numeric(scoring.pass_td ?? scoring.passing_td, 4) - 4) * (key === "QB" ? 1.45 : 1.05);
    }
    mean *= 1 + (12 - teams) * 0.012;
    // Empty slots represent a plausible later starter, not a near-elite one.
    // Keeping the completion baseline below the positional mean prevents the
    // first premium player drafted from appearing to reduce win probability.
    mean *= numeric(context.completionBaselineFactor, 0.88);
    return {
      mean: Math.max(1, mean),
      stdDev: Math.max(2.5, mean * (key === "QB" ? 0.30 : key === "DST" ? 0.58 : 0.46)),
      source: "LEAGUE_COMPLETION_BASELINE",
    };
  }

  function positionReplacementMean(position, context = {}) {
    const slot = position === "QB" ? "QB" : position === "TE" ? "TE" : position === "K" || position === "DST" ? position : "FLEX";
    const configured = context.replacementWeeklyPoints || context.replacement_weekly_points || {};
    return Math.max(1, numeric(configured[position], slotBaseline(slot, context).mean * 0.68));
  }

  function playerAvailability(player) {
    const explicit = numeric(
      player.weeklyAvailability ?? player.availabilityProbability ?? player.availability_probability ?? player.playProbability,
      null,
    );
    if (explicit != null) return clamp01(explicit > 1 ? explicit / 100 : explicit);
    const status = String(player.injuryStatus || player.injury_status || "").toLowerCase();
    if (/out|ir|pup|suspend/.test(status)) return 0.55;
    if (/doubt/.test(status)) return 0.68;
    if (/question|limited/.test(status)) return 0.88;
    return 0.97;
  }

  function playerWeeklyDistribution(player, context = {}) {
    const position = String(player.position || "").toUpperCase();
    const seasonPoints = leagueAdjustedProjectedPoints(player, context.league || {});
    const explicitMean = numeric(player.weeklyProjection ?? player.weekly_projection ?? player.projectedPpg, null);
    const games = Math.max(1, numeric(player.projectedGames ?? player.projected_games, 17));
    const grade = playerGrade(player);
    const estimatedMean = slotBaseline(position, context).mean * (0.65 + grade / 100 * 0.75);
    const activeMean = Math.max(0, explicitMean != null ? explicitMean : seasonPoints != null ? seasonPoints / games : estimatedMean);
    const replacementMean = positionReplacementMean(position, context);
    const availability = playerAvailability(player);
    const weeks = regularSeasonWeeks(context);
    const byeProbability = position === "DST" || position === "K" ? 1 / weeks : 1 / weeks;
    const usableMean = availability * activeMean + (1 - availability) * replacementMean;
    const mean = usableMean * (1 - byeProbability) + replacementMean * byeProbability;
    const explicitStdDev = numeric(player.weeklyStdDev ?? player.weekly_std_dev ?? player.projectionStdDev, null);
    const floor = numeric(player.weeklyFloor ?? player.weekly_floor, null);
    const ceiling = numeric(player.weeklyCeiling ?? player.weekly_ceiling, null);
    let activeStdDev = explicitStdDev != null
      ? explicitStdDev
      : floor != null && ceiling != null && ceiling > floor
        ? (ceiling - floor) / 3.29
        : activeMean * numeric(POSITION_WEEKLY_CV[position], 0.46);
    const projectionConfidence = clamp(numeric(
      player.projectionConfidence ?? player.projection_confidence,
      seasonPoints != null || explicitMean != null ? 70 : 35,
    ));
    activeStdDev *= 1 + (100 - projectionConfidence) / 300;
    const availabilityVariance = availability * (1 - availability) * ((activeMean - replacementMean) ** 2);
    const variance = Math.max(4, availability * activeStdDev ** 2 + availabilityVariance);
    return {
      mean: Math.round(mean * 100) / 100,
      stdDev: Math.round(Math.sqrt(variance) * 100) / 100,
      variance,
      availability,
      replacementMean,
      projectionConfidence,
      source: explicitMean != null
        ? "WEEKLY_PROJECTION"
        : seasonPoints != null
          ? "SEASON_PROJECTION_ESTIMATE"
          : "LEAGUE_VALUE_ESTIMATE",
    };
  }

  function weeklyOptimalLineup(picks = [], context = {}) {
    const league = context.league || {};
    const slots = [];
    Object.entries(league.roster || {}).forEach(([slot, count]) => {
      if (NON_STARTER_SLOTS.has(slot)) return;
      for (let index = 0; index < Math.max(0, numeric(count, 0)); index += 1) {
        slots.push({ slot, order: slots.length, eligibility: SLOT_ELIGIBILITY[slot] || [slot] });
      }
    });
    const orderedSlots = [...slots].sort((a, b) => a.eligibility.length - b.eligibility.length || a.order - b.order);
    const pool = (picks || []).filter((player) => player?.position).map((player) => ({
      player,
      distribution: playerWeeklyDistribution(player, context),
      used: false,
    }));
    const assignments = orderedSlots.map((slot) => {
      const candidates = pool.filter((entry) => !entry.used && slot.eligibility.includes(String(entry.player.position).toUpperCase()));
      candidates.sort((a, b) => b.distribution.mean - a.distribution.mean || playerGrade(b.player) - playerGrade(a.player));
      const selected = candidates[0] || null;
      if (selected) selected.used = true;
      return { ...slot, player: selected?.player || null, distribution: selected?.distribution || slotBaseline(slot.slot, context) };
    });
    return {
      starters: assignments.sort((a, b) => a.order - b.order),
      bench: pool.filter((entry) => !entry.used).map((entry) => entry.player),
    };
  }

  function lineupWeeklyDistribution(picks = [], context = {}) {
    const lineup = weeklyOptimalLineup(picks, context);
    let mean = 0;
    let variance = 0;
    lineup.starters.forEach((entry) => {
      mean += entry.distribution.mean;
      variance += entry.distribution.stdDev ** 2;
    });
    for (let left = 0; left < lineup.starters.length; left += 1) {
      for (let right = left + 1; right < lineup.starters.length; right += 1) {
        const a = lineup.starters[left], b = lineup.starters[right];
        if (!a.player || !b.player) continue;
        const sameTeam = String(a.player.nflTeam || a.player.team || "") &&
          String(a.player.nflTeam || a.player.team || "") === String(b.player.nflTeam || b.player.team || "");
        if (!sameTeam) continue;
        const positions = new Set([a.player.position, b.player.position]);
        let correlation = 0.02;
        if (positions.has("QB") && (positions.has("WR") || positions.has("TE"))) correlation = 0.12;
        else if (positions.has("RB") && positions.has("WR")) correlation = -0.04;
        variance += 2 * correlation * a.distribution.stdDev * b.distribution.stdDev;
      }
    }
    return {
      mean: Math.round(mean * 100) / 100,
      stdDev: Math.round(Math.sqrt(Math.max(1, variance)) * 100) / 100,
      variance: Math.max(1, variance),
      lineup,
    };
  }

  function leagueOpponentDistribution(context = {}) {
    const explicitMean = numeric(context.opponentWeeklyMean ?? context.leagueAverageWeeklyMean, null);
    const explicitStdDev = numeric(context.opponentWeeklyStdDev ?? context.leagueAverageWeeklyStdDev, null);
    if (explicitMean != null) return { mean: explicitMean, stdDev: Math.max(1, numeric(explicitStdDev, 20.9)), source: "LEAGUE_DATA" };
    const baseline = lineupWeeklyDistribution([], context);
    return {
      mean: baseline.mean,
      stdDev: Math.max(10, baseline.stdDev * 1.08),
      source: "LEAGUE_CONFIGURATION_ESTIMATE",
    };
  }

  function expectedWeeklyTeamOutlook(picks = [], context = {}) {
    const team = lineupWeeklyDistribution(picks, context);
    const opponent = leagueOpponentDistribution(context);
    const matchupCovariance = numeric(context.matchupCovariance, 0);
    const denominator = Math.sqrt(Math.max(1, team.variance + opponent.stdDev ** 2 - 2 * matchupCovariance));
    const winProbability = normalCdf((team.mean - opponent.mean) / denominator);
    const weeks = regularSeasonWeeks(context);
    return {
      teamMean: team.mean,
      teamStdDev: team.stdDev,
      opponentMean: Math.round(opponent.mean * 100) / 100,
      opponentStdDev: Math.round(opponent.stdDev * 100) / 100,
      weeklyEdge: Math.round((team.mean - opponent.mean) * 100) / 100,
      winProbability,
      winRate: Math.round(winProbability * 1000) / 10,
      expectedWins: Math.round(winProbability * weeks * 10) / 10,
      expectedLosses: Math.round((1 - winProbability) * weeks * 10) / 10,
      regularSeasonWeeks: weeks,
      lineup: team.lineup,
      opponentSource: opponent.source,
    };
  }

  function weeklyWinProbabilityAdded(player, context = {}) {
    const picks = context.picks || [];
    const duplicate = picks.some((pick) => playerKey(pick) === playerKey(player));
    const before = expectedWeeklyTeamOutlook(picks, context);
    const afterPicks = duplicate ? picks : [...picks, player];
    let after = expectedWeeklyTeamOutlook(afterPicks, context);
    const starter = after.lineup.starters.find((entry) => entry.player === player || (entry.player && playerKey(entry.player) === playerKey(player)));
    let optionalityPoints = 0;
    if (!starter && !duplicate) {
      const option = optionValueProfile(player, context);
      const distribution = playerWeeklyDistribution(player, context);
      const baseProbability = player.position === "RB" || player.position === "WR" ? 0.12 : player.position === "TE" ? 0.08 : 0.05;
      const futureStarterProbability = clamp01(numeric(
        player.probabilityOfBecomingStarter ?? player.starterProbability,
        baseProbability + Math.max(0, option.score - 50) / 500,
      ));
      optionalityPoints = Math.max(0, distribution.mean - distribution.replacementMean) * futureStarterProbability;
      if (optionalityPoints > 0) {
        const adjustedTeam = { ...after, mean: after.teamMean + optionalityPoints };
        const denominator = Math.sqrt(Math.max(1, adjustedTeam.teamStdDev ** 2 + adjustedTeam.opponentStdDev ** 2));
        const winProbability = normalCdf((adjustedTeam.mean - adjustedTeam.opponentMean) / denominator);
        after = {
          ...after,
          teamMean: Math.round(adjustedTeam.mean * 100) / 100,
          weeklyEdge: Math.round((adjustedTeam.mean - adjustedTeam.opponentMean) * 100) / 100,
          winProbability,
          winRate: Math.round(winProbability * 1000) / 10,
          expectedWins: Math.round(winProbability * after.regularSeasonWeeks * 10) / 10,
          expectedLosses: Math.round((1 - winProbability) * after.regularSeasonWeeks * 10) / 10,
        };
      }
    }
    const deltaPercentagePoints = (after.winProbability - before.winProbability) * 100;
    const weeklyStarterPointsAdded = after.teamMean - before.teamMean;
    const distribution = playerWeeklyDistribution(player, context);
    const confidence = Math.round(clamp(distribution.projectionConfidence * 0.75 + numeric(player.agreement, 50) * 0.25));
    const score = Math.round(clamp(50 + deltaPercentagePoints * 8 + weeklyStarterPointsAdded * 1.5));
    return {
      before,
      after,
      winRateBefore: before.winRate,
      winRateAfter: after.winRate,
      deltaPercentagePoints: Math.round(deltaPercentagePoints * 10) / 10,
      expectedWinsAdded: Math.round((after.expectedWins - before.expectedWins) * 100) / 100,
      weeklyStarterPointsAdded: Math.round(weeklyStarterPointsAdded * 10) / 10,
      optionalityPoints: Math.round(optionalityPoints * 10) / 10,
      starts: Boolean(starter),
      starterSlot: starter?.slot || null,
      score,
      confidence,
      // A season total still requires an estimated weekly distribution. Only
      // a supplied weekly projection earns the stronger projected label.
      model: distribution.source === "WEEKLY_PROJECTION" ? "WEEKLY-PROJECTED" : "ESTIMATED",
      projectionSource: distribution.source,
      explanation: starter
        ? `${starter.slot} lineup impact raises expected weekly scoring by ${weeklyStarterPointsAdded.toFixed(1)} points.`
        : optionalityPoints > 0
          ? `Bench insurance and breakout optionality add ${optionalityPoints.toFixed(1)} expected usable points.`
          : "No immediate legal-lineup gain; value must come from scarcity, trade value, or later upside.",
    };
  }

  function needScore(player, context) {
    const league = context.league || {};
    const picks = context.picks || [];
    const counts = context.counts || rosterCounts(picks);
    const have = numeric(counts[player.position], 0);
    const configuredTargets = context.targets || starterTargets(league);
    const starterTarget = numeric(configuredTargets[player.position], 0);
    const round = numeric(context.round, 1);
    const totalRounds = Math.max(1, numeric(context.totalRounds, 16));

    // K/DST are roster-completion positions in conventional redraft formats:
    // do not let an empty special-teams slot outrank meaningful RB/WR/QB/TE
    // value early, and never recommend a redundant second K/DST once filled.
    if (player.position === "K" || player.position === "DST") {
      if (starterTarget <= 0 || have >= starterTarget) return 1;
      if (round < Math.max(1, totalRounds - 2)) return 5;
    }

    const startsIfAdded = wouldStart(player, picks, league);

    if (startsIfAdded) {
      // Distinguish filling a genuinely unfilled starter slot (highest
      // urgency) from upgrading a slot a weaker player currently occupies
      // (still valuable, but not as urgent).
      const currentLineup = optimalLineup(picks, league);
      const eligibleSlots = Object.keys(SLOT_ELIGIBILITY).filter((slot) =>
        (SLOT_ELIGIBILITY[slot] || [slot]).includes(player.position),
      );
      const hasUnfilledEligibleSlot = currentLineup.starters.some(
        (s) => eligibleSlots.includes(s.slot) && !s.player,
      );
      return hasUnfilledEligibleSlot ? 90 : 74;
    }

    // Bench-only. Spec Section 13 explicitly calls for suppressing
    // unnecessary QB depth in 1QB and excessive TE depth, while not
    // penalizing genuine RB/WR bench value — this is bench-VALUE shaping,
    // not the core starter-determination mechanism (which is fully
    // generic above), so light position-awareness here is intentional
    // and spec-sanctioned, not a special case for any named player.
    if (player.position === "QB" && !context.superflex && have >= 1) {
      return numeric(player.posRank, 99) <= 3 ? 22 : 4;
    }
    if (
      player.position === "TE" &&
      have >= 1 &&
      numeric(player.posRank, 99) <= 5
    ) {
      return 14;
    }
    return clamp(40 - have * 4);
  }

  function rosterNeedState(player, context = {}) {
    const league = context.league || {};
    const picks = context.picks || [];
    const roster = league.roster || {};
    const currentLineup = optimalLineup(picks, league);
    const eligibleSlots = currentLineup.starters.filter((slot) => {
      const eligible = SLOT_ELIGIBILITY[slot.slot] || [slot.slot];
      return eligible.includes(player.position);
    });
    const unfilledEligible = eligibleSlots.find((slot) => !slot.player);
    const withCandidate = optimalLineup([...picks, player], league);
    const candidateSlot = withCandidate.starters.find((slot) => slot.player === player);

    if (unfilledEligible && candidateSlot) {
      const flexLike = /FLEX/.test(unfilledEligible.slot);
      return {
        state: flexLike ? 'flex_need' : 'starter_need',
        label: flexLike ? 'FLEX NEED' : 'STARTER NEED',
        slot: unfilledEligible.slot,
        starts: true,
        urgency: flexLike ? 86 : 94,
      };
    }
    if (candidateSlot) {
      return {
        state: 'starter_upgrade',
        label: 'STARTER UPGRADE',
        slot: candidateSlot.slot,
        starts: true,
        urgency: 74,
      };
    }

    const counts = context.counts || rosterCounts(picks);
    const have = numeric(counts[player.position], 0);
    const target = numeric(starterTargets(league)[player.position], 0);
    const superflex = numeric(roster.SUPER_FLEX || roster.SF, 0) > 0 || numeric(roster.QB, 1) > 1;

    if ((player.position === 'K' || player.position === 'DST') && target > 0 && have >= target) {
      return { state: 'saturated', label: 'SATURATED', slot: null, starts: false, urgency: 4 };
    }
    if (player.position === 'QB' && !superflex && have >= 1) {
      return { state: 'luxury', label: 'LUXURY', slot: null, starts: false, urgency: 10 };
    }
    if (player.position === 'TE' && have >= Math.max(1, target)) {
      return { state: 'depth', label: 'DEPTH', slot: null, starts: false, urgency: 24 };
    }
    if (player.position === 'RB' || player.position === 'WR') {
      return { state: 'depth_upside', label: 'DEPTH UPSIDE', slot: null, starts: false, urgency: 42 };
    }
    return { state: 'depth', label: 'DEPTH', slot: null, starts: false, urgency: 30 };
  }

  function tierScore(player) {
    let score = 72 - Math.max(0, numeric(player.tier, 4) - 1) * 7;
    if (player.tierEnd)
      score += Math.min(25, numeric(player.tierGapAfter, 0) * 4);
    if (numeric(player.tier, 99) === 1) score += 10;
    return clamp(score);
  }

  // ---------------------------------------------------------------------
  // Scarcity Engine. Not a static positional multiplier — reacts to the
  // ACTUAL remaining draft pool, so a run on a position genuinely raises
  // scarcity for what's left, and a deep position with many comparable
  // players genuinely stays low. Components are exposed separately per
  // spec, not collapsed into one opaque number.
  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------
  // ADP / Wait-Risk. Deliberately does NOT reimplement the survival
  // simulation here — that already exists (Monte Carlo, using real
  // CPU-pick behavior driven by ADP-influenced scoring and exact
  // snake-turn distance) in the UI layer, where it has access to live
  // draft state. This function takes an ALREADY-COMPUTED survival
  // probability and turns it into the required categorical output,
  // avoiding false precision (a bucketed category plus a bounded
  // wait-cost number, not a claim of exact percentage confidence).
  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------
  // Opponent Simulation — the actual pick-selection decision, extracted
  // as a pure function so it's testable with deterministic (seeded)
  // randomness rather than only ever exercised via true Math.random() in
  // the live UI. Production code passes Math.random; tests pass a fixed
  // sequence to prove bounded-rational behavior reproducibly. Scarcity is
  // now a real input — a team facing a positional run should weight that
  // urgency, not just base need.
  // ---------------------------------------------------------------------
  function chooseBestCandidate(scoredCandidates, options = {}) {
    const amplitude = numeric(options.amplitude, 5);
    const scarcityWeight = numeric(options.scarcityWeight, 0.15);
    const randomFn = typeof options.randomFn === "function" ? options.randomFn : Math.random;
    if (!scoredCandidates || !scoredCandidates.length) return null;
    const jittered = scoredCandidates.map((entry) => {
      const scarcityBoost = numeric(entry.scarcity, 0) * scarcityWeight;
      const baseScore = numeric(entry.score, 0) + scarcityBoost;
      return {
        ...entry,
        jitteredScore: baseScore + (randomFn() - 0.5) * amplitude * 2,
      };
    });
    jittered.sort(
      (a, b) =>
        b.jitteredScore - a.jitteredScore ||
        numeric(a.player.overallRank, 999) - numeric(b.player.overallRank, 999),
    );
    return jittered[0].player;
  }

  // Simple seedable PRNG (mulberry32) for deterministic tests — not
  // cryptographic, just reproducible. Given the same seed, produces the
  // same sequence every time, so opponent behavior can be tested exactly.
  function seededRandom(seed) {
    let state = seed >>> 0;
    return function next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------------
  // Opportunity Cost. For a candidate, finds the best alternative at any
  // OTHER position, and determines the real cost of passing on it —
  // reusing wouldStart (does the alternative actually improve my starting
  // lineup, not just have a good grade) and scarcityScore (is that
  // alternative's position about to dry up). This is what lets the engine
  // explain the spec's own example: a QB with the higher intrinsic grade
  // can still be the wrong pick if he's bench-only right now and the
  // remaining QB tier is deep, while a WR would start immediately and his
  // position is scarce.
  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------
  // Explainability Output. Generates structured reasons entirely from
  // already-computed engine state — no LLM call, nothing invented. An
  // LLM could later turn these structured reasons into prose, but the
  // reasons themselves are deterministic and traceable to real numbers.
  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------
  // Three-Board Data Model. Three genuinely distinct ordered views —
  // they must never reuse the same underlying ranking field under
  // different labels:
  //   CONSENSUS  — the external baseline (raw consensus rank). Stable
  //                regardless of roster or league config.
  //   MODEL      — League Value. Stable across roster changes; DOES
  //                change with league configuration.
  //   DRAFT NOW  — Pick Utility. Changes with both roster and draft state.
  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------
  // Completed Roster Validation. Runs the real optimalLineup engine
  // against a finished roster and checks the actual required conditions —
  // not just "did picks happen," but genuine legality and completeness.
  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------
  // Consensus Guardrails. Compares Consensus Rank against Model League
  // Rank for configurable top-N slices (overall and per position), flags
  // deviations beyond a configurable threshold, and attributes large
  // disagreements to the actual component that drove them. No player is
  // ever special-cased by name — this operates generically on whatever
  // player list is passed in.
  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------
  // Backtest / Benchmark Foundation. A repeatable harness, not a claim of
  // calibrated accuracy — the spec is explicit that the harness itself is
  // the deliverable this phase, not perfect historical prediction. Takes
  // pre-computed rank pairs (model vs. actual outcome) rather than live
  // data, so it can be exercised now with synthetic fixtures and later
  // fed real historical snapshots without changing this function.
  // ---------------------------------------------------------------------
  function spearmanCorrelation(pairs) {
    const n = pairs.length;
    if (n < 2) return null;
    const sumDiffSquared = pairs.reduce(
      (sum, [a, b]) => sum + Math.pow(a - b, 2),
      0,
    );
    return 1 - (6 * sumDiffSquared) / (n * (n * n - 1));
  }

  function runBacktest(records, options = {}) {
    // records: [{ key, modelRank, consensusRank, adpRank, actualOutcomeRank, injuryDistorted }]
    const excludeInjuryDistorted = options.excludeInjuryDistorted !== false;
    const clean = (records || []).filter(
      (record) => !excludeInjuryDistorted || !record.injuryDistorted,
    );
    const withOutcome = clean.filter((record) => record.actualOutcomeRank != null);

    const modelPairs = withOutcome.map((r) => [r.modelRank, r.actualOutcomeRank]);
    const consensusPairs = withOutcome
      .filter((r) => r.consensusRank != null)
      .map((r) => [r.consensusRank, r.actualOutcomeRank]);
    const adpPairs = withOutcome
      .filter((r) => r.adpRank != null)
      .map((r) => [r.adpRank, r.actualOutcomeRank]);

    function topNOverlapVsOutcome(pairs, n) {
      const predictedTopN = new Set(
        pairs.filter(([predicted]) => predicted <= n).map(([predicted]) => predicted),
      );
      const actualTopN = pairs.filter(([, actual]) => actual <= n);
      let hits = 0;
      actualTopN.forEach(([predicted]) => { if (predicted <= n) hits += 1; });
      return { n, hits, total: actualTopN.length };
    }

    return {
      sampleSize: withOutcome.length,
      excludedInjuryDistorted: clean.length !== (records || []).length
        ? (records || []).length - clean.length
        : (records || []).filter((r) => r.injuryDistorted).length,
      modelRankCorrelation: spearmanCorrelation(modelPairs),
      consensusRankCorrelation: spearmanCorrelation(consensusPairs),
      adpRankCorrelation: spearmanCorrelation(adpPairs),
      modelTop24Overlap: topNOverlapVsOutcome(modelPairs, 24),
      consensusTop24Overlap: topNOverlapVsOutcome(consensusPairs, 24),
    };
  }

  function validateConsensusAlignment(players, context = {}, options = {}) {
    const deviationThreshold = numeric(options.deviationThreshold, 15);
    const boards = buildBoards(players, context);

    function topNOverlap(n) {
      const consensusTopN = new Set(boards.consensus.slice(0, n).map((e) => e.player.key));
      const modelTopN = new Set(boards.model.slice(0, n).map((e) => e.player.key));
      let overlap = 0;
      consensusTopN.forEach((key) => { if (modelTopN.has(key)) overlap += 1; });
      return { n, overlap, total: consensusTopN.size };
    }

    function flagDeviations(list, label) {
      const flags = [];
      list.forEach((entry) => {
        const consensusRank = numeric(entry.player.overallRank || entry.player.rank, null);
        const modelEntry = boards.model.find((m) => m.player.key === entry.player.key);
        if (consensusRank == null || !modelEntry) return;
        const deviation = consensusRank - modelEntry.rank; // positive = model ranks him higher than consensus
        if (Math.abs(deviation) >= deviationThreshold) {
          const evaluation = scorePlayer(entry.player, context);
          // Model/League Value is roster-independent, so attribution must
          // only inspect inputs that can actually move League Value. The old
          // diagnostic looked at Pick Utility components such as `need` and
          // incorrectly blamed roster state for Model-board deviations.
          const leagueDrivers = {
            consensus: clamp(numeric(entry.player.consensusScore, 50)),
            playerGrade: evaluation.playerGrade,
            vbd: vbdScore(entry.player, context),
          };
          const driverEntries = Object.entries(leagueDrivers).sort(
            (a, b) => Math.abs(b[1] - leagueDrivers.consensus) -
              Math.abs(a[1] - leagueDrivers.consensus),
          );
          flags.push({
            name: entry.player.name,
            position: entry.player.position,
            consensusRank,
            modelRank: modelEntry.rank,
            deviation,
            likelyDriver: driverEntries[0] ? driverEntries[0][0] : null,
            leagueDrivers,
            group: label,
          });
        }
      });
      return flags;
    }

    const overallFlags = flagDeviations(boards.consensus.slice(0, 50), "overall_top50");
    const byPosition = {};
    ["QB", "RB", "WR", "TE", "K", "DST"].forEach((position) => {
      const positionList = boards.consensus.filter((e) => e.player.position === position).slice(0, 10);
      byPosition[position] = flagDeviations(positionList, `top10_${position}`);
    });

    return {
      deviationThreshold,
      overlap: { top12: topNOverlap(12), top24: topNOverlap(24), top50: topNOverlap(50) },
      overallFlags,
      positionFlags: byPosition,
    };
  }

  function validateCompletedRoster(picks, league = {}) {
    const lineup = optimalLineup(picks, league);
    const issues = [];

    lineup.starters.forEach((slot) => {
      if (!slot.player) {
        const eligiblePool = (picks || []).filter((player) =>
          (SLOT_ELIGIBILITY[slot.slot] || [slot.slot]).includes(player.position),
        );
        // Only a real issue if eligible players existed and still weren't
        // seated — an empty slot with zero eligible players anywhere on
        // the roster isn't a bug, just an incomplete/short draft.
        if (eligiblePool.length > lineup.starters.filter((s) => s.slot === slot.slot).length) {
          issues.push(`${slot.slot} slot unfilled despite eligible players on the roster`);
        }
      }
    });

    // No player may appear twice, anywhere (starters + bench combined).
    const allSeated = [
      ...lineup.starters.filter((s) => s.player).map((s) => s.player.key),
      ...lineup.bench.map((p) => p.key),
    ];
    const uniqueSeated = new Set(allSeated);
    if (uniqueSeated.size !== allSeated.length) {
      issues.push("A player appears more than once in the completed roster — illegal state");
    }

    // No player may be seated in a slot they're not eligible for.
    lineup.starters.forEach((slot) => {
      if (slot.player) {
        const eligible = SLOT_ELIGIBILITY[slot.slot] || [slot.slot];
        if (!eligible.includes(slot.player.position)) {
          issues.push(`${slot.player.name} (${slot.player.position}) illegally seated in ${slot.slot}`);
        }
      }
    });

    // Every drafted player must be accounted for exactly once.
    const totalDrafted = (picks || []).length;
    if (allSeated.length !== totalDrafted) {
      issues.push(`Roster accounting mismatch: ${totalDrafted} drafted, ${allSeated.length} accounted for in lineup+bench`);
    }

    return {
      valid: issues.length === 0,
      issues,
      lineup,
    };
  }

  function buildBoards(players, context = {}) {
    const scored = (players || []).map((player) => ({
      player,
      evaluation: scorePlayer(player, context),
    }));

    const consensus = [...scored].sort(
      (a, b) => numeric(a.player.overallRank || a.player.rank, 999) -
                numeric(b.player.overallRank || b.player.rank, 999),
    );
    const model = [...scored].sort(
      (a, b) => b.evaluation.leagueValue - a.evaluation.leagueValue,
    );
    const draftNow = [...scored].sort(
      (a, b) => b.evaluation.pickUtility - a.evaluation.pickUtility,
    );

    return {
      consensus: consensus.map((entry, index) => ({
        rank: index + 1, player: entry.player, value: numeric(entry.player.overallRank || entry.player.rank, 999),
      })),
      model: model.map((entry, index) => ({
        rank: index + 1, player: entry.player, value: entry.evaluation.leagueValue,
      })),
      draftNow: draftNow.map((entry, index) => ({
        rank: index + 1, player: entry.player, value: entry.evaluation.pickUtility,
      })),
    };
  }

  function explainPick(player, evaluation, alternatives = []) {
    const whyThisPlayer = [];
    if (evaluation.components.need >= 80) {
      whyThisPlayer.push(`Fills a currently unfilled starter slot at ${player.position}`);
    } else if (evaluation.components.need >= 60) {
      whyThisPlayer.push(`Upgrades your current ${player.position} starter`);
    }
    if (player.tierEnd) {
      whyThisPlayer.push(`Final player remaining in Tier ${numeric(player.tier, "?")}`);
    } else if (evaluation.scarcity && evaluation.scarcity.tierDepth <= 2) {
      whyThisPlayer.push(`Only ${evaluation.scarcity.tierDepth} player(s) left in this tier`);
    }
    if (evaluation.sv != null) {
      whyThisPlayer.push(`${evaluation.sv}% projected to survive to your next pick`);
    }
    if (evaluation.marketValue != null && evaluation.leagueValue != null) {
      const gap = evaluation.leagueValue - evaluation.marketValue;
      if (gap >= 10) {
        whyThisPlayer.push(`League Value runs ahead of where the market has him — a real value gap, not just rank`);
      }
    }

    // WHY NOT the highest-Player-Grade alternative that was NOT chosen.
    const notChosen = (alternatives || [])
      .filter((entry) => entry.player.key !== player.key)
      .sort((a, b) => b.evaluation.playerGrade - a.evaluation.playerGrade);
    const whyNotAlternative = [];
    if (notChosen.length && notChosen[0].evaluation.playerGrade > evaluation.playerGrade) {
      const alt = notChosen[0];
      whyNotAlternative.push(`${alt.player.name} (${alt.player.position}) has the higher intrinsic Player Grade`);
      if (alt.evaluation.components.need < evaluation.components.need) {
        whyNotAlternative.push(`but his position shows less starter need right now than ${player.position}`);
      }
      if (alt.evaluation.scarcity && evaluation.scarcity && alt.evaluation.scarcity.scarcity < evaluation.scarcity.scarcity) {
        whyNotAlternative.push(`and the remaining pool at his position is deeper — less urgent to act now`);
      }
    }

    const canIWait = {
      recommendation: evaluation.waitRisk ? evaluation.waitRisk.category : null,
      survivalProbability: evaluation.sv,
      waitCost: evaluation.waitRisk ? evaluation.waitRisk.waitCost : null,
      comparablePlayersInTier: evaluation.scarcity ? Math.max(0, evaluation.scarcity.tierDepth - 1) : null,
    };

    return { whyThisPlayer, whyNotAlternative, canIWait };
  }

  function opportunityCost(candidate, availablePool, context = {}) {
    const picks = context.picks || [];
    const league = context.league || {};
    const pool = availablePool || [];

    const otherPositions = [
      ...new Set(pool.map((player) => player.position)),
    ].filter((position) => position && position !== candidate.position);

    let bestAlternative = null;
    let bestAlternativeValue = -Infinity;
    otherPositions.forEach((position) => {
      pool
        .filter((player) => player.position === position)
        .forEach((player) => {
          const value = leagueValueScore(player, context);
          if (value > bestAlternativeValue) {
            bestAlternativeValue = value;
            bestAlternative = player;
          }
        });
    });

    if (!bestAlternative) {
      return {
        opportunityCost: 0,
        bestAlternative: null,
        bestAlternativeValue: 0,
        lineupImprovementForfeited: false,
        alternativePositionScarcity: 0,
      };
    }

    const candidateStarts = wouldStart(candidate, picks, league);
    const alternativeStarts = wouldStart(bestAlternative, picks, league);
    const alternativeScarcity = scarcityScore(bestAlternative, pool, context);
    const candidateValue = leagueValueScore(candidate, context);

    // Real marginal lineup value forfeited: the alternative would start
    // and the candidate would not — a genuine lineup improvement passed up,
    // not just a grade comparison.
    const lineupImprovementForfeited = alternativeStarts && !candidateStarts;

    const rawCost =
      (bestAlternativeValue - candidateValue) +
      (lineupImprovementForfeited ? 25 : 0) +
      alternativeScarcity.scarcity * 0.2;

    return {
      opportunityCost: Math.round(clamp(rawCost, 0, 100)),
      bestAlternative,
      bestAlternativePosition: bestAlternative.position,
      bestAlternativeValue: Math.round(bestAlternativeValue),
      lineupImprovementForfeited,
      alternativePositionScarcity: Math.round(alternativeScarcity.scarcity),
    };
  }

  function waitRiskCategory(inputs = {}) {
    const survivalProbability = clamp(numeric(inputs.survivalProbability, 50), 0, 100);
    const playerValue = clamp(numeric(inputs.playerValue, 50), 0, 100);
    const scarcity = clamp(numeric(inputs.scarcity, 30), 0, 100);
    const probabilityLost = 100 - survivalProbability;
    // Strategic cost of waiting: value at stake × chance of actually losing it.
    const waitCost = clamp((playerValue * probabilityLost) / 100);

    let category;
    if (survivalProbability < 25) {
      category = "TAKE_NOW";
    } else if (survivalProbability < 50) {
      category = waitCost >= 35 ? "TAKE_NOW" : "HIGH_WAIT_RISK";
    } else if (survivalProbability < 70) {
      category =
        playerValue >= 70 || scarcity >= 60
          ? "MODERATE_WAIT_RISK"
          : "STRONG_WAIT_CANDIDATE";
    } else {
      category = "LIKELY_AVAILABLE";
    }

    return {
      category,
      waitCost: Math.round(waitCost),
      survivalProbability,
      probabilityLost,
    };
  }

  function scarcityScore(player, availablePool, context = {}) {
    const samePosition = (availablePool || []).filter(
      (candidate) => candidate.position === player.position,
    );
    const remainingSupply = samePosition.length;
    const playerTier = numeric(player.tier, 99);
    const tierDepth = samePosition.filter(
      (candidate) => numeric(candidate.tier, 99) === playerTier,
    ).length;

    const nextTier = samePosition.filter(
      (candidate) => numeric(candidate.tier, 99) === playerTier + 1,
    );
    const thisGrade = playerGrade(player);
    // If there's no visible next tier in the pool, assume a real (not
    // zero) drop rather than silently treating scarcity as absent —
    // absence of data is not evidence of depth.
    const nextTierBestGrade = nextTier.length
      ? Math.max(...nextTier.map((candidate) => playerGrade(candidate)))
      : Math.max(0, thisGrade - 25);
    const tierDropoff = clamp(thisGrade - nextTierBestGrade, 0, 100);

    const picksUntilNext = Math.max(1, numeric(context.picksUntilNextTurn, 12));

    // Fewer tier-mates remaining = higher urgency. One left = max.
    const depthUrgency = clamp(100 - Math.max(0, tierDepth - 1) * 20);
    // Bigger value gap to the next tier down = higher urgency to act now.
    const dropoffUrgency = clamp(tierDropoff * 2.5);
    // If remaining tier-mates are fewer than or comparable to picks before
    // my next turn, real risk the tier is gone by then.
    const survivalRatio = tierDepth / picksUntilNext;
    const turnRisk = clamp(100 / (1 + survivalRatio));

    const combined = clamp(
      depthUrgency * 0.4 + dropoffUrgency * 0.35 + turnRisk * 0.25,
    );

    return {
      scarcity: Math.round(combined),
      remainingSupply,
      tierDepth,
      tierDropoff: Math.round(tierDropoff),
      picksUntilNext,
      depthUrgency: Math.round(depthUrgency),
      dropoffUrgency: Math.round(dropoffUrgency),
      turnRisk: Math.round(turnRisk),
    };
  }

  function playerEvidenceProfile(player, context = {}) {
    const present = (value) => value !== null && value !== undefined && value !== "";
    const any = (...values) => values.some(present);
    const stage = numeric(context.round, 1) <= 4 ? "EARLY" : numeric(context.round, 1) <= 10 ? "MIDDLE" : "LATE";
    const coverage = {
      market: any(player.adp, player.overallRank, player.consensusScore) ? 100 : 0,
      projection: any(player.projectedPoints, player.projected_points, player.vbdPercentileScore) ? 100 : 0,
      role: any(player.depthChartOrder, player.depth_chart_order, player.snapShare, player.snap_share, player.routeParticipation, player.route_participation, player.targetShare, player.target_share, player.carryShare, player.carry_share, player.opportunityShare, player.opportunity_share) ? 100 : 0,
      production: any(player.yardsPerRouteRun, player.yards_per_route_run, player.targetsPerRouteRun, player.targets_per_route_run, player.ryoe, player.xyac, player.cpoe, player.explosiveRate, player.explosive_rate) ? 100 : 0,
      availability: any(player.injuryStatus, player.injury_status, player.practiceParticipation, player.practice_participation, player.gamesPlayed, player.games_played) ? 100 : 0,
      upside: any(player.pedigreeScore, player.ageCurveScore, player.draftCapitalScore, player.draft_capital_score, player.athleticScore, player.athletic_score) ? 100 : 0,
      environment: any(player.schemeFit?.score, player.scheme_fit?.score) ? 100 : 0,
    };
    const weights = stage === "EARLY"
      ? { market:.30,projection:.25,role:.15,production:.10,availability:.08,upside:.04,environment:.08 }
      : stage === "MIDDLE"
        ? { market:.15,projection:.25,role:.24,production:.14,availability:.08,upside:.07,environment:.07 }
        : { market:.10,projection:.20,role:.27,production:.17,availability:.08,upside:.12,environment:.06 };
    const score = Math.round(Object.entries(weights).reduce((sum,[key,weight])=>sum+coverage[key]*weight,0));
    const missing = Object.keys(weights).filter((key)=>coverage[key]===0).sort((a,b)=>weights[b]-weights[a]);
    return { stage, score, grade:score>=85?"A":score>=70?"B":score>=55?"C":score>=40?"D":"INSUFFICIENT", coverage, weights, missing, productionReady:coverage.projection===100&&coverage.role===100&&score>=65 };
  }

  function breakoutCandidateScore(player, context = {}) {
    const evidence = playerEvidenceProfile(player, context), signals = [];
    const add = (label,value,weight) => { if (value != null) signals.push({label,value:clamp(value),weight}); };
    const pct = (value) => value == null ? null : numeric(value) <= 1 ? numeric(value)*100 : numeric(value);
    add("age curve", player.ageCurveScore, .22);
    add("pedigree", player.pedigreeScore ?? player.draftCapitalScore ?? player.draft_capital_score, .18);
    add("role", pct(player.opportunityShare ?? player.opportunity_share ?? player.snapShare ?? player.snap_share ?? player.routeParticipation ?? player.route_participation), .26);
    add("efficiency", pct(player.targetsPerRouteRun ?? player.targets_per_route_run ?? player.explosiveRate ?? player.explosive_rate), .16);
    add("environment", player.schemeFit?.score ?? player.scheme_fit?.score, .10);
    const marketGap = numeric(player.adp, null) != null && numeric(player.overallRank ?? player.rank, null) != null ? clamp(50 + (numeric(player.adp)-numeric(player.overallRank ?? player.rank))*2) : null;
    add("market discount", marketGap, .08);
    const totalWeight = signals.reduce((sum,signal)=>sum+signal.weight,0);
    const score = totalWeight ? Math.round(signals.reduce((sum,signal)=>sum+signal.value*signal.weight,0)/totalWeight) : null;
    const reliable = signals.length >= 4 && evidence.score >= 55;
    return { score, reliable, evidence, signals, label:!reliable?"UNMODELED":score>=72?"BREAKOUT TARGET":score>=62?"UPSIDE WATCH":"DEPTH" };
  }

  function positionRunState(roomPicks = [], availablePool = [], context = {}) {
    const teams = Math.max(2, numeric(context.league?.teams || context.teams, 12));
    const windowSize = Math.max(4, Math.min(12, Math.ceil(teams / 2)));
    const recent = (roomPicks || []).slice(-windowSize);
    const targets = starterTargets(context.league || {});
    const positions = ["QB", "RB", "WR", "TE"];
    const totalDemand = positions.reduce((sum, position) => sum + numeric(targets[position], 0), 0) || 1;
    return positions.map((position) => {
      const count = recent.filter((pick) => pick.position === position).length;
      const expected = windowSize * numeric(targets[position], 0) / totalDemand;
      const topGone = (roomPicks || []).filter((pick) => pick.position === position && numeric(pick.posRank, 99) <= Math.max(3, teams / 3)).length;
      const next = (availablePool || []).filter((player) => player.position === position)
        .sort((a, b) => numeric(a.posRank, 999) - numeric(b.posRank, 999))[0];
      const tierDepth = next ? (availablePool || []).filter((player) => player.position === position && numeric(player.tier, 99) === numeric(next.tier, 99)).length : 0;
      const runLift = Math.max(0, count - expected);
      const severity = Math.round(clamp(runLift * 28 + topGone * 7 + (tierDepth === 1 ? 18 : tierDepth === 2 ? 10 : 0)));
      return {
        position, count, expected: Math.round(expected * 10) / 10, windowSize,
        topGone, nextPlayer: next || null, tierDepth, severity,
        active: count >= 2 && severity >= 28,
        label: severity >= 70 ? "POSITION CLIFF" : severity >= 45 ? "ACTIVE RUN" : severity >= 28 ? "RUN FORMING" : "STABLE",
      };
    }).sort((a, b) => b.severity - a.severity);
  }

  function comparablePlayers(player, availablePool = [], context = {}, limit = 3) {
    if (!player) return [];
    const playerValue = leagueValueScore(player, context);
    return (availablePool || [])
      .filter((candidate) => candidate.key !== player.key && candidate.position === player.position)
      .map((candidate) => ({
        player: candidate,
        leagueValue: Math.round(leagueValueScore(candidate, context)),
        valueDrop: Math.max(0, Math.round(playerValue - leagueValueScore(candidate, context))),
        adpGap: Math.round(numeric(candidate.adp ?? candidate.overallRank ?? candidate.rank, 999) - numeric(player.adp ?? player.overallRank ?? player.rank, 999)),
        sameTier: numeric(candidate.tier, 99) === numeric(player.tier, 99),
      }))
      .sort((a, b) => Number(b.sameTier) - Number(a.sameTier) || a.valueDrop - b.valueDrop || a.adpGap - b.adpGap)
      .slice(0, Math.max(1, limit));
  }

  function draftPhase(context = {}) {
    const round = numeric(context.round, 1);
    const total = Math.max(1, numeric(context.totalRounds, 16));
    const progress = round / total;
    if (round <= Math.max(2, Math.floor(total * .2))) return "foundation";
    if (progress < .62) return "starter-build";
    if (progress < .88) return "upside";
    return "final-bets";
  }

  // Bench picks should be judged by asymmetric payoff and how quickly a failed
  // thesis can be replaced, not by a tiny difference in median projection.
  function optionValueProfile(player, context = {}) {
    const phase = draftPhase(context);
    const evidence = playerEvidenceProfile(player, context);
    const breakout = breakoutCandidateScore(player, context);
    const role = clamp(numeric(player.opportunityScore,
      numeric(player.targetShare, 0) * 210 + numeric(player.snapShare, 0) * 38 +
      (numeric(player.depthChartOrder, 4) === 1 ? 20 : numeric(player.depthChartOrder, 4) === 2 ? 10 : 0)));
    const contingent = clamp(numeric(player.contingentValue,
      player.position === "RB" && numeric(player.depthChartOrder, 4) <= 2 ? 72 : 45));
    const ceiling = clamp(numeric(player.ceilingScore,
      breakout.reliable ? breakout.score : numeric(player.ageCurveScore, 50)));
    const replaceability = clamp(numeric(player.earlyRoleClarity,
      numeric(player.depthChartOrder, 4) <= 2 ? 68 : 48));
    const confidence = Math.round((evidence.score * .7) + (numeric(breakout.confidence, evidence.score) * .3));
    const score = Math.round(clamp(role * .29 + contingent * .25 + ceiling * .3 + replaceability * .16));
    return {
      score,
      confidence,
      phase,
      active: phase === "upside" || phase === "final-bets",
      label: score >= 72 ? "ASYMMETRIC UPSIDE" : score >= 60 ? "LIVE UPSIDE" : "DEPTH BET",
      drivers: [
        { label: "role path", value: Math.round(role) },
        { label: "ceiling", value: Math.round(ceiling) },
        { label: "contingent value", value: Math.round(contingent) },
        { label: "early clarity", value: Math.round(replaceability) },
      ].sort((a, b) => b.value - a.value).slice(0, 2),
    };
  }

  function decisionScenario(player, availablePool = [], context = {}) {
    const evaluation = scorePlayer(player, context);
    const comparables = comparablePlayers(player, availablePool, context, 3);
    const fallback = comparables[0] || null;
    const survivalProbability = clamp(numeric(player.sv ?? player.survivalProbability ?? context.survival, 50));
    const scarcity = scarcityScore(player, availablePool, context);
    const atTierCliff = scarcity.tierDepth <= 1 && scarcity.tierDropoff >= 8;
    const fallbackValue = fallback ? fallback.leagueValue : Math.max(0, Math.round(leagueValueScore(player, context) - 18));
    const currentValue = Math.round(leagueValueScore(player, context));
    const fallbackLoss = Math.max(0, currentValue - fallbackValue);
    const expectedWaitLoss = Math.round((1 - survivalProbability / 100) * fallbackLoss * 10) / 10;
    const waitRisk = waitRiskCategory({ survivalProbability, playerValue: evaluation.playerGrade, scarcity: scarcity.scarcity });
    const need = rosterNeedState(player, context);
    const optionValue = optionValueProfile(player, context);
    let decision = "TARGET";
    if (need.state === "saturated") decision = "PASS";
    else if (survivalProbability >= 72 && expectedWaitLoss < 5 && !atTierCliff) decision = "WAIT";
    else if (waitRisk.category === "TAKE_NOW" || expectedWaitLoss >= 8 || atTierCliff) decision = "DRAFT NOW";
    if (optionValue.active && optionValue.score >= 72 && need.state !== "saturated") decision = decision === "WAIT" ? "TARGET" : decision;
    const confidence = Math.round(clamp(evaluation.confidence * .65 + optionValue.confidence * .2 + (100 - Math.abs(50 - survivalProbability)) * .15));
    return {
      decision,
      confidence,
      survivalProbability,
      expectedWaitLoss,
      currentValue,
      fallback,
      fallbackLoss,
      waitRisk,
      scarcity,
      atTierCliff,
      optionValue,
      whyNow: `${need.label}: ${atTierCliff ? "the position is at a tier cliff" : `${survivalProbability}% chance to survive your next turn`}`,
      whyWait: fallback
        ? `${fallback.player.name} is the next ${fallback.sameTier ? "same-tier" : "lower-tier"} fallback; expected value lost by waiting is ${expectedWaitLoss}`
        : `No close positional fallback is visible; expected value lost by waiting is ${expectedWaitLoss}`,
    };
  }

  function pairedTurnPlan(entries = [], context = {}) {
    if (numeric(context.picksUntilNextTurn, 99) > 2 || entries.length < 2) return null;
    const candidates = entries.filter((entry) => entry.scenario?.decision !== "PASS").slice(0, 10);
    let best = null;
    for (let left = 0; left < candidates.length; left += 1) {
      for (let right = left + 1; right < candidates.length; right += 1) {
        const a = candidates[left], b = candidates[right];
        const differentPositions = a.player.position !== b.player.position;
        const openStarters = [a, b].filter((entry) => rosterNeedState(entry.player, context).state === "starter_need").length;
        const complementBonus = differentPositions ? 6 : -2;
        const starterBonus = openStarters * 4;
        const pairScore = a.contextualScore + b.contextualScore + complementBonus + starterBonus;
        if (!best || pairScore > best.pairScore) best = { a, b, pairScore, complementBonus, starterBonus };
      }
    }
    if (!best) return null;
    const urgency = (entry) => numeric(entry.scenario.expectedWaitLoss, 0) + numeric(entry.scenario.scarcity?.scarcity, 0) * .08 + (entry.scenario.atTierCliff ? 8 : 0);
    const first = urgency(best.a) >= urgency(best.b) ? best.a : best.b;
    const second = first === best.a ? best.b : best.a;
    return {
      first,
      second,
      pairScore: Math.round(best.pairScore),
      rationale: `${first.player.name} first protects the greater wait cost; pair with ${second.player.name} to maximize combined lineup value${best.complementBonus > 0 ? " across complementary positions" : ""}.`,
    };
  }

  function recommendationBoard(players = [], context = {}) {
    const roomPicks = context.roomPicks || [];
    const runs = positionRunState(roomPicks, players, context);
    const runMap = Object.fromEntries(runs.map((run) => [run.position, run]));
    const targets = starterTargets(context.league || {});
    const counts = context.counts || rosterCounts(context.picks || []);
    const superflex = numeric(context.league?.roster?.SUPER_FLEX, 0) > 0 || numeric(context.league?.roster?.QB, 1) > 1;
    const qbTarget = Math.max(1, numeric(targets.QB, 1));
    const evaluated = players.map((player) => {
      const evaluation = scorePlayer(player, context);
      const evidence = playerEvidenceProfile(player, context);
      const breakout = breakoutCandidateScore(player, context);
      const run = runMap[player.position] || { severity: 0, active: false };
      let adjustment = run.active ? Math.min(10, run.severity * 0.1) : 0;
      if (superflex && player.position === "QB") {
        if (numeric(counts.QB, 0) < qbTarget) adjustment += 12 + Math.min(10, run.severity * 0.12);
        else adjustment -= 5;
      }
      const need = rosterNeedState(player, context);
      if (need.state === "saturated") adjustment -= 18;
      if (need.state === "starter_need") adjustment += 5;
      if (numeric(context.round, 1) >= 6 && breakout.reliable) adjustment += Math.max(-4, Math.min(7, (breakout.score - 50) * .14));
      if (player.vegasComparison?.available && numeric(player.vegasComparison.confidence,0) >= .35) adjustment += player.vegasComparison.strength * Math.min(1.5, numeric(player.vegasComparison.confidence,0) * 1.5);
      const scenario = decisionScenario(player, players, context);
      const phaseBonus = scenario.optionValue.active ? Math.max(-2, Math.min(6, (scenario.optionValue.score - 50) * .1)) : 0;
      const earlyTierProtection = numeric(context.round, 1) <= 4 && scenario.atTierCliff ? Math.min(5, scenario.fallbackLoss * .25) : 0;
      return { player, evaluation, wwpa: evaluation.wwpa, run, evidence, breakout, scenario, adjustment: Math.round(adjustment + phaseBonus + earlyTierProtection), contextualScore: Math.round(clamp(evaluation.pickUtility + adjustment + phaseBonus + earlyTierProtection)) };
    });
    const recommended = [...evaluated].sort((a, b) => b.contextualScore - a.contextualScore || numeric(a.player.overallRank, 999) - numeric(b.player.overallRank, 999));
    const pairPlan = pairedTurnPlan(recommended, context);
    if (pairPlan && recommended[0] !== pairPlan.first) {
      const index = recommended.indexOf(pairPlan.first);
      recommended.splice(index, 1);
      recommended.unshift(pairPlan.first);
    }
    const bestAvailable = [...evaluated].sort((a, b) => numeric(a.player.adp ?? a.player.overallRank ?? a.player.rank, 999) - numeric(b.player.adp ?? b.player.overallRank ?? b.player.rank, 999));
    recommended.slice(0, 8).forEach((entry) => { entry.comparables = comparablePlayers(entry.player, players, context, 3); });
    const leadRun = runs.find((run) => run.active);
    let strategyImpact = leadRun
      ? `${leadRun.position} run: ${leadRun.count} selected in the last ${leadRun.windowSize}. ${leadRun.tierDepth <= 2 ? "The current tier may not survive your next turn." : "Do not chase the run if an equal-tier player at another position is available."}`
      : "No material position run is forcing a reach; stay value-led and protect open starter slots.";
    if (superflex && numeric(counts.QB, 0) < qbTarget) {
      strategyImpact = `Superflex pressure: you still need ${qbTarget - numeric(counts.QB, 0)} starting QB${qbTarget - numeric(counts.QB, 0) === 1 ? "" : "s"}. Treat viable starting QBs as a scarce lineup requirement, not a one-QB luxury. ${strategyImpact}`;
    }
    if (recommended[0]?.wwpa) {
      const lead = recommended[0].wwpa;
      strategyImpact = `WIN-RATE OBJECTIVE: ${recommended[0].player.name} projects ${lead.winRateAfter.toFixed(1)}% weekly H2H win rate (${lead.deltaPercentagePoints >= 0 ? "+" : ""}${lead.deltaPercentagePoints.toFixed(1)} pp WWPA). ${strategyImpact}`;
    }
    if (pairPlan) strategyImpact = `TURN PLAN: ${pairPlan.rationale} ${strategyImpact}`;
    return { recommended, bestAvailable, runs, strategyImpact, pairPlan };
  }

  // Real draft methodology differs by round: early picks should lean almost
  // entirely on value (roster construction isn't defined yet), later picks
  // should weigh roster need, opportunity, and situational context (pedigree,
  // age curve) more heavily since static consensus rank matters less once
  // you're differentiating between bench-caliber options. This blends each
  // strategy's base weights toward a shared late-round shift as the draft
  // progresses, rather than using one fixed weight set for all 16+ rounds.
  const LATE_ROUND_SHIFT = {
    market: -0.1,
    vbd: -0.06,
    tier: -0.02,
    need: 0.1,
    availability: 0.03,
    pedigree: 0.03,
    ageCurve: 0.02,
  };

  function roundAdjustedWeights(baseWeights, round, totalRounds) {
    const safeTotalRounds = Math.max(1, numeric(totalRounds, 16));
    const t = clamp01((numeric(round, 1) - 1) / Math.max(1, safeTotalRounds - 1));
    const adjusted = {};
    let total = 0;
    Object.entries(baseWeights).forEach(([key, weight]) => {
      const delta = (LATE_ROUND_SHIFT[key] || 0) * t;
      const value = Math.max(0.01, weight + delta);
      adjusted[key] = value;
      total += value;
    });
    Object.keys(adjusted).forEach((key) => {
      adjusted[key] = adjusted[key] / total;
    });
    return adjusted;
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  // ---------------------------------------------------------------------
  // Phase 1 of the four-value architecture split (Player Grade / Market
  // Value / League Value / Pick Utility). Root cause being fixed: every
  // component — including roster-need and round-stage bias — was
  // previously blended into a single "score", meaning a player's
  // evaluation moved based on MY OWN roster construction. Concretely:
  // Joe Burrow's score would change depending on whether I'd already
  // drafted Lamar Jackson. That's architecturally wrong. Player Grade
  // below never does that — it has no dependency on context.picks,
  // context.counts, or context.round at all.
  // ---------------------------------------------------------------------

  // PLAYER GRADE — stable intrinsic quality. Fixed weights, not
  // round-adjusted, not roster-need-adjusted. Only inputs are the
  // player's own consensus standing, tier, scheme fit, and the two
  // non-statistical scouting signals (pedigree, age curve) — nothing
  // here can change because of a pick I made.
  function playerGrade(player) {
    const market = clamp(
      numeric(
        player.consensusScore,
        percentileRank(numeric(player.overallRank || player.rank, 250), 250),
      ),
    );
    const tier = tierScore(player);
    const scheme = clamp(numeric(player.schemeFit?.score, 50));
    const pedigree = clamp(numeric(player.pedigreeScore, 50));
    const ageCurve = clamp(numeric(player.ageCurveScore, 50));
    return clamp(
      market * 0.45 + tier * 0.2 + scheme * 0.15 + pedigree * 0.1 + ageCurve * 0.1,
    );
  }

  // MARKET VALUE — when the market expects this player gone, not whether
  // that's good or bad. Pure ADP-based signal, intentionally separate
  // from Player Grade so the two can be compared (a real value-vs-market
  // gap is a genuine signal; conflating them hides it).
  function marketValueScore(player, context = {}) {
    const poolSize = numeric(context.poolSize, 250);
    const adp = numeric(
      player.adp,
      numeric(player.overallRank || player.rank, poolSize),
    );
    return clamp(percentileRank(adp, poolSize));
  }

  // LEAGUE VALUE — Player Grade run through this specific league's
  // replacement level / positional scarcity (vbdScore already reflects
  // league config: team count, starter targets, Superflex, FLEX demand).
  // Same player scores differently across leagues; Player Grade itself
  // does not change.
  function leagueValueScore(player, context = {}) {
    const grade = playerGrade(player);
    const vbd = vbdScore(player, context);
    // Consensus is the calibration anchor until proprietary signals prove
    // incremental value in backtests. Player Grade and league-aware VBD may
    // move a player, but neither may casually overwhelm a broad public board.
    const consensus = clamp(
      numeric(
        player.consensusScore,
        percentileRank(
          numeric(player.overallRank || player.rank, numeric(context.poolSize, 250)),
          numeric(context.poolSize, 250),
        ),
      ),
    );
    let value = consensus * 0.60 + grade * 0.20 + vbd * 0.20;
    // TE premium is a league rule, not an intrinsic player-grade change.
    // Apply it only in League Value and scale it toward the scarce top of
    // the position so replacement-level tight ends do not receive the same
    // bonus as high-volume starters.
    if (player.position === "TE") {
      const scoring = context.league?.scoring || {};
      const premium = Math.max(
        0,
        numeric(
          scoring.te_premium ?? scoring.tePremium ?? scoring.bonus_rec_te,
          0,
        ),
      );
      const positionRank = numeric(player.posRank, 30);
      const scarcityShare = clamp((30 - positionRank) / 29, 0, 1);
      value += premium * (3 + scarcityShare * 9);
    }
    // K/DST remain draftable and ranked within their positions, but their
    // high replacement availability means they should not enter early-round
    // cross-position Model territory in standard formats.
    if (player.position === "K" || player.position === "DST") {
      value = Math.min(value, 44);
    }
    return clamp(value);
  }

  // ---------------------------------------------------------------------
  // K/DST pool integration (spec: "Close K/DST end-to-end"). The primary
  // player pool (FantasyCalc, a dynasty trade-value market) does not carry
  // K/DST at all — this merges them in from a supplemental intelligence
  // source when the live pool is missing them, so they can actually be
  // searched, filtered, and drafted. Requirements enforced here:
  //   - canonical IDs (sleeper_id when available, else a stable derived
  //     key that cannot collide with an existing live-pool key)
  //   - no duplicates (skips any position already represented in the pool)
  //   - ADP left null when unavailable, never fabricated
  //   - projected points left null when unavailable, never fabricated
  //   - fallback valuation reflects real-world K/DST draft value (low,
  //     late-round) rather than an arbitrary or missing number
  //   - provenance retained (source: 'supplemental')
  //   - only added when the league's roster config actually starts that
  //     position — absent entirely when disabled
  // ---------------------------------------------------------------------
  function mergeSupplementalPositions(livePlayers, intelPlayers, league = {}) {
    const roster = league.roster || {};
    const enabledPositions = new Set();
    if (numeric(roster.K, 0) > 0) enabledPositions.add("K");
    if (numeric(roster.DST, 0) > 0) enabledPositions.add("DST");
    if (!enabledPositions.size) return livePlayers;

    const livePositions = new Set();
    (livePlayers || []).forEach((player) => {
      if (player.position) livePositions.add(player.position);
    });

    const supplemental = [];
    const seenKeys = new Set((livePlayers || []).map((player) => player.key));
    (intelPlayers || []).forEach((candidate, index) => {
      const position = String(candidate.position || "").toUpperCase();
      if (!enabledPositions.has(position)) return;
      // Only merge in a position the live pool is genuinely missing — if
      // FantasyCalc ever does start carrying K/DST, don't create duplicates.
      if (livePositions.has(position)) return;
      const key = String(
        candidate.sleeper_id || `supplemental-${position}-${normalizeName(candidate.name)}-${index}`,
      );
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      // Fallback valuation: K/DST have no dynasty trade-value market, so a
      // low, clearly-marked late-round percentile is the honest default —
      // this matches real K/DST draft behavior (spec: "substantial
      // early-round opportunity-cost penalty"), not an arbitrary number.
      const fallbackValue = candidate.overall_rank != null
        ? percentileRank(numeric(candidate.overall_rank, 200), 200) * 0.3
        : 8;
      supplemental.push({
        key,
        name: candidate.name || "Unknown",
        position,
        nflTeam: candidate.team || "",
        rank: numeric(candidate.overall_rank, null),
        overallRank: numeric(candidate.overall_rank, null),
        posRank: numeric(candidate.position_rank, null),
        tier: numeric(candidate.position_tier, 99),
        consensusScore: fallbackValue,
        value: Math.round(fallbackValue),
        adp: candidate.adp != null ? numeric(candidate.adp, null) : null,
        projectedPoints: null,
        source: "supplemental",
        sourceCount: numeric(candidate.source_count, 1),
        agreement: numeric(candidate.agreement, 50),
      });
    });
    return [...(livePlayers || []), ...supplemental];
  }

  function scorePlayer(player, context = {}) {
    const strategy = STRATEGIES[context.strategy]
      ? context.strategy
      : "adaptive";
    const model = STRATEGIES[strategy];
    const poolSize = numeric(context.poolSize, context.players?.length || 250);
    const market = numeric(
      player.consensusScore,
      percentileRank(
        numeric(player.overallRank || player.rank, poolSize),
        poolSize,
      ),
    );
    const need = needScore(player, context);
    const survival = clamp(numeric(context.survival, 50));
    const components = {
      market: clamp(market),
      vbd: vbdScore(player, context),
      tier: tierScore(player),
      need,
      availability: 100 - survival,
      scheme: clamp(numeric(player.schemeFit?.score, 50)),
      strategy: strategyBias(player, { ...context, strategy, need }),
      // Non-statistical scouting signals — draft capital and position-adjusted age
      // curve. Default to neutral (50) rather than 0 when scouting_signals.json
      // hasn't loaded yet, so missing data never penalizes a player, only informs
      // when actually present.
      pedigree: clamp(numeric(player.pedigreeScore, 50)),
      ageCurve: clamp(numeric(player.ageCurveScore, 50)),
    };
    const effectiveWeights = roundAdjustedWeights(model.weights, context.round, context.totalRounds);
    const raw = Object.entries(effectiveWeights).reduce(
      (sum, [key, weight]) => sum + components[key] * weight,
      0,
    );
    // Confidence should reflect how clear-cut the evaluation is, not just how many
    // sources exist. The source-count term previously saturated at just ~4 sources
    // (100/28), contributing a flat 35 points to nearly every well-covered player
    // regardless of any real distinguishing signal — this was the direct cause of
    // confidence clustering near 100% for most players. Fixed: source count now
    // needs ~7 sources to saturate and carries less weight; genuine cross-source
    // agreement (the real "how clear-cut" signal) now carries more.
    const confidence = clamp(
      numeric(player.agreement, 50) * 0.55 +
        Math.min(100, numeric(player.sourceCount, 1) * 15) * 0.20 +
        numeric(player.schemeFit?.confidence, 45) * 0.25,
    );
    // The four separated values. pickUtility is exactly what "raw" already
    // was — the existing roster/round-aware weighted blend — kept as-is so
    // no existing caller (CPU picks, recommendations, UI) silently changes
    // behavior in this pass. What's new: playerGrade, marketValue, and
    // leagueValue are now independently inspectable and provably stable
    // with respect to my own roster state, closing the architectural gap
    // where a single opaque score conflated intrinsic quality with
    // roster-dependent recommendation.
    const grade = playerGrade(player);
    const market_value = marketValueScore(player, context);
    const league_value = leagueValueScore(player, context);
    const lateRound = lateRoundValueScore(player, context);
    const evidence = playerEvidenceProfile(player, context);
    const breakout = breakoutCandidateScore(player, context);
    const wwpa = weeklyWinProbabilityAdded(player, context);
    const progress = clamp01(
      (numeric(context.round, 1) - 1) / Math.max(1, numeric(context.totalRounds, 16) - 1),
    );
    const diamondBonus = lateRound.eligible
      ? Math.max(-3, Math.min(6, (lateRound.score - 50) * 0.12)) *
        progress *
        (lateRound.confidence / 100)
      : 0;
    // WWPA is the controlling outcome layer, but remains bounded so thin or
    // estimated projections cannot erase the market, VORP, scarcity, wait-risk
    // and roster-construction guardrails that make the recommendation robust.
    const wwpaAdjustment = Math.max(-7, Math.min(9, (wwpa.score - 50) * 0.16));
    const basePickUtility = Math.round(clamp(raw + diamondBonus));
    const pickUtility = Math.round(clamp(basePickUtility + wwpaAdjustment));
    return {
      score: pickUtility,
      pickUtility,
      playerGrade: Math.round(grade),
      marketValue: Math.round(market_value),
      leagueValue: Math.round(league_value),
      confidence: Math.round(confidence),
      lateRound,
      evidence,
      breakout,
      wwpa,
      basePickUtility,
      wwpaAdjustment: Math.round(wwpaAdjustment * 10) / 10,
      diamondBonus: Math.round(diamondBonus * 10) / 10,
      components,
      weights: effectiveWeights,
    };
  }

  function strategyDirective(context = {}) {
    const strategy = STRATEGIES[context.strategy]
      ? context.strategy
      : "adaptive";
    const counts = context.counts || rosterCounts(context.picks);
    const round = numeric(context.round, 1);
    const compatibility = strategyCompatibility(strategy, context.league);
    let directive = STRATEGIES[strategy].description;
    if (strategy === "hero-rb")
      directive =
        counts.RB === 0
          ? "Find one Tier 1/2 RB without leaving the current value tier."
          : round <= 6
            ? "Hero secured: build WR/FLEX strength and avoid an unnecessary early RB2."
            : "Attack contingent-value and receiving RBs for depth.";
    if (strategy === "zero-rb")
      directive =
        round <= 5
          ? "Prioritize WR/FLEX and elite TE value; do not reach merely to fill RB."
          : counts.RB === 0
            ? "The RB window is open now—secure RB1 by Round 7."
            : counts.RB < 4 && round <= 10
              ? "Add RB volume quickly; target receiving work and contingent upside."
              : "Shift back to best upside and structural needs.";
    if (strategy === "robust-rb")
      directive =
        counts.RB < 3 && round <= 4
          ? "RB remains a priority only inside the same tier as the best alternatives."
          : "RB allocation is filled; stop adding early bench points.";
    if (strategy === "late-qb")
      directive = counts.QB
        ? "QB is filled; spend remaining capital on scarce starters and upside."
        : round <= 6
          ? "Wait through the flat QB tier unless an elite option falls materially."
          : "Select the best remaining starting QB before the tier closes.";
    if (strategy === "early-qb")
      directive =
        context.superflex && counts.QB < 2
          ? "Secure two viable starting QBs before the starter tier collapses."
          : counts.QB
            ? "QB starter requirement is satisfied; duplicate QB value must be exceptional."
            : "Only an elite-QB tier value justifies the early cost in one-QB.";
    if (strategy === "elite-te")
      directive = counts.TE
        ? "Elite TE secured; avoid paying twice for the same weekly edge."
        : "Draft TE only when a Tier 1 difference-maker is available at fair value.";
    return {
      strategy,
      label: STRATEGIES[strategy].label,
      directive,
      ...compatibility,
    };
  }

  function sourceSummary(intelligence, profile) {
    const ids = new Set(profile?.source_ids || []);
    const sources = (intelligence?.sources || []).filter(
      (source) => !ids.size || ids.has(source.id),
    );
    const healthy = sources.filter((source) => source.status === "ok");
    return {
      healthy: healthy.length,
      total: sources.length,
      label: healthy.length
        ? healthy.map((source) => source.label || source.id).join(" + ")
        : "Live market fallback",
      generatedAt: profile?.generated_at || intelligence?.generated_at || null,
    };
  }

  function teamScheme(intelligence, player) {
    const team = player.nflTeam || player.team;
    const profile = intelligence?.team_profiles?.[team] || null;
    if (!profile) return null;
    const positionCoach = profile.position_coaches?.[player.position] || null;
    return {
      ...profile,
      team,
      positionCoach,
      playerFit: player.schemeFit || null,
    };
  }

  return {
    POSITIONS,
    STRATEGIES,
    assignTiers,
    buildBoards,
    chooseBestCandidate,
    computeReplacementPoints,
    computeVBDPercentiles,
    enrichPlayers,
    explainPick,
    leagueValueScore,
    lateRoundValueScore,
    leagueAdjustedProjectedPoints,
    normalCdf,
    marketValueScore,
    mergeSupplementalPositions,
    normalizeName,
    optimalLineup,
    weeklyOptimalLineup,
    playerWeeklyDistribution,
    lineupWeeklyDistribution,
    expectedWeeklyTeamOutlook,
    weeklyWinProbabilityAdded,
    opportunityCost,
    pairedTurnPlan,
    comparablePlayers,
    decisionScenario,
    draftPhase,
    breakoutCandidateScore,
    optionValueProfile,
    playerGrade,
    playerEvidenceProfile,
    playerKey,
    projectionCoverageContract,
    roundAdjustedWeights,
    rosterCounts,
    rosterNeedState,
    recommendationBoard,
    runBacktest,
    scarcityScore,
    positionRunState,
    seededRandom,
    waitRiskCategory,
    scorePlayer,
    selectProfile,
    sourceSummary,
    spearmanCorrelation,
    starterTargets,
    strategyCompatibility,
    strategyDirective,
    teamScheme,
    validateCompletedRoster,
    validateConsensusAlignment,
    wouldStart,
  };
});
