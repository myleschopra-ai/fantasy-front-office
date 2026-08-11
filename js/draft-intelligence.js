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
    return targets;
  }

  function strategyCompatibility(strategy, league = {}) {
    const roster = league.roster || {};
    const ppr = numeric(league.scoring?.reception, 0.5);
    const superflex =
      numeric(roster.SUPER_FLEX, 0) > 0 || numeric(roster.QB, 1) > 1;
    const flexReceivers = numeric(roster.WR, 2) + numeric(roster.FLEX, 0);
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
    WRRB_FLEX: ["RB", "WR"],
    REC_FLEX: ["WR", "TE"],
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

  function needScore(player, context) {
    const league = context.league || {};
    const picks = context.picks || [];
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
    const counts = context.counts || rosterCounts(picks);
    const have = numeric(counts[player.position], 0);
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
    const pickUtility = Math.round(raw);
    return {
      score: pickUtility,
      pickUtility,
      playerGrade: Math.round(grade),
      marketValue: Math.round(market_value),
      leagueValue: Math.round(league_value),
      confidence: Math.round(confidence),
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
    marketValueScore,
    mergeSupplementalPositions,
    normalizeName,
    optimalLineup,
    opportunityCost,
    playerGrade,
    playerKey,
    roundAdjustedWeights,
    rosterCounts,
    runBacktest,
    scarcityScore,
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
