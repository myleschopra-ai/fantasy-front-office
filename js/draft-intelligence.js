(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FFODraftIntelligence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const POSITIONS = ["QB", "RB", "WR", "TE"];
  const STRATEGIES = {
    adaptive: {
      label: "Adaptive VBD",
      description:
        "Follow value over replacement and live tier cliffs, then adapt to league settings and the room.",
      weights: {
        market: 0.25,
        vbd: 0.19,
        tier: 0.17,
        need: 0.17,
        availability: 0.08,
        scheme: 0.07,
        strategy: 0.07,
      },
    },
    balanced: {
      label: "Balanced BPA",
      description:
        "Use league-adjusted best player available without creating avoidable starter gaps.",
      weights: {
        market: 0.27,
        vbd: 0.18,
        tier: 0.16,
        need: 0.17,
        availability: 0.08,
        scheme: 0.07,
        strategy: 0.07,
      },
    },
    "hero-rb": {
      label: "Hero RB",
      description:
        "Secure one premium back early, build WR/FLEX strength, then return to RB depth.",
      weights: {
        market: 0.23,
        vbd: 0.17,
        tier: 0.15,
        need: 0.16,
        availability: 0.08,
        scheme: 0.07,
        strategy: 0.14,
      },
    },
    "zero-rb": {
      label: "Zero RB",
      description:
        "Build WR/FLEX leverage early and attack high-upside RB volume after the early rounds.",
      weights: {
        market: 0.22,
        vbd: 0.16,
        tier: 0.15,
        need: 0.14,
        availability: 0.08,
        scheme: 0.07,
        strategy: 0.18,
      },
    },
    "robust-rb": {
      label: "Robust RB",
      description:
        "Build early RB volume only when backs remain within the same value tier as alternatives.",
      weights: {
        market: 0.22,
        vbd: 0.17,
        tier: 0.17,
        need: 0.14,
        availability: 0.08,
        scheme: 0.07,
        strategy: 0.15,
      },
    },
    "late-qb": {
      label: "Late-Round QB",
      description:
        "In one-QB leagues, wait through flat QB tiers unless an elite value falls.",
      weights: {
        market: 0.24,
        vbd: 0.19,
        tier: 0.16,
        need: 0.14,
        availability: 0.08,
        scheme: 0.07,
        strategy: 0.12,
      },
    },
    "early-qb": {
      label: "Early QB / Superflex",
      description:
        "Prioritize scarce starting quarterbacks in Superflex; in one-QB, require an elite tier value.",
      weights: {
        market: 0.22,
        vbd: 0.19,
        tier: 0.16,
        need: 0.15,
        availability: 0.08,
        scheme: 0.07,
        strategy: 0.13,
      },
    },
    "elite-te": {
      label: "Elite TE",
      description:
        "Pay for a true difference-maker at tight end, not a name from a flat middle tier.",
      weights: {
        market: 0.22,
        vbd: 0.19,
        tier: 0.18,
        need: 0.14,
        availability: 0.08,
        scheme: 0.07,
        strategy: 0.12,
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
    const counts = { QB: 0, RB: 0, WR: 0, TE: 0 };
    (picks || []).forEach((pick) => {
      if (counts[pick.position] != null) counts[pick.position] += 1;
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

  function vbdScore(player, context) {
    const replacement = replacementRank(player.position, context);
    const advantage = replacement - numeric(player.posRank, replacement);
    return clamp(45 + (advantage / Math.max(6, replacement)) * 55);
  }

  function needScore(player, context) {
    const counts = context.counts || rosterCounts(context.picks);
    const targets = context.targets || starterTargets(context.league);
    const have = numeric(counts[player.position], 0);
    const target = numeric(targets[player.position], 1);
    if (have < target) return clamp(72 + (target - have) * 12);
    if (player.position === "QB" && target === 1 && have >= 1)
      return numeric(player.posRank, 99) <= 3 ? 22 : 4;
    if (
      player.position === "TE" &&
      target === 1 &&
      have >= 1 &&
      numeric(player.posRank, 99) <= 5
    )
      return 14;
    return clamp(48 - Math.max(0, have - target) * 13);
  }

  function tierScore(player) {
    let score = 72 - Math.max(0, numeric(player.tier, 4) - 1) * 7;
    if (player.tierEnd)
      score += Math.min(25, numeric(player.tierGapAfter, 0) * 4);
    if (numeric(player.tier, 99) === 1) score += 10;
    return clamp(score);
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
    };
    const raw = Object.entries(model.weights).reduce(
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
    return {
      score: Math.round(raw),
      confidence: Math.round(confidence),
      components,
      weights: model.weights,
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
    enrichPlayers,
    normalizeName,
    playerKey,
    rosterCounts,
    scorePlayer,
    selectProfile,
    sourceSummary,
    starterTargets,
    strategyCompatibility,
    strategyDirective,
    teamScheme,
  };
});
