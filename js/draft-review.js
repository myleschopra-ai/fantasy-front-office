(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FFODraftReview = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ARCHIVE_KEY = "ffo_draft_archive_v1";
  const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const round1 = (value) => Math.round(numeric(value) * 10) / 10;

  function marketDelta(pick) {
    const market = numeric(pick.adp, numeric(pick.overallRank || pick.rank, pick.pick));
    return round1(numeric(pick.pick || pick.pickNo) - market);
  }

  function strategyShape(picks) {
    const early = (picks || []).slice(0, 6);
    const counts = early.reduce((out, pick) => {
      const position = String(pick.position || "?").toUpperCase();
      out[position] = (out[position] || 0) + 1;
      return out;
    }, {});
    let observed = "balanced";
    if ((counts.WR || 0) >= 4 && (counts.RB || 0) <= 1) observed = "zero-rb";
    else if ((counts.RB || 0) >= 3) observed = "robust-rb";
    else if ((counts.RB || 0) === 1 && (counts.WR || 0) >= 3) observed = "hero-rb";
    else if ((counts.QB || 0) >= 2) observed = "early-qb";
    else if ((counts.TE || 0) >= 1 && String(early.find((p) => p.position === "TE")?.round || 99) <= "3") observed = "elite-te";
    return { observed, counts };
  }

  function decisionReview(picks) {
    return (picks || []).filter((pick) => pick.decision).map((pick) => {
      const d = pick.decision;
      const gap = round1(numeric(d.recommendedUtility) - numeric(d.selectedUtility));
      return {
        pick: pick.pick,
        selected: pick.name,
        recommendation: d.recommendedName || pick.name,
        utilityGap: Math.max(0, gap),
        followedRecommendation: String(d.recommendedKey || "") === String(pick.key || ""),
        context: d.context || null,
      };
    });
  }

  function analyze(payload, intelligence) {
    const picks = Array.isArray(payload?.picks) ? payload.picks : [];
    const slot = numeric(payload?.slot, 1);
    const mine = picks.filter((pick) => numeric(pick.team) === slot || pick.mine);
    const league = payload?.leagueSnapshot || {};
    const validation = intelligence?.validateCompletedRoster
      ? intelligence.validateCompletedRoster(mine, league)
      : { valid: true, issues: [], lineup: { starters: [], bench: mine } };
    const starters = new Set((validation.lineup?.starters || []).filter((entry) => entry.player).map((entry) => String(entry.player.key)));
    const values = mine.map((pick) => ({ ...pick, marketDelta: marketDelta(pick), starter: starters.has(String(pick.key)) }));
    const starterValues = values.filter((pick) => pick.starter);
    const benchValues = values.filter((pick) => !pick.starter);
    const average = (items) => items.length ? round1(items.reduce((sum, pick) => sum + pick.marketDelta, 0) / items.length) : 0;
    const decisions = decisionReview(mine);
    const missed = decisions.filter((entry) => !entry.followedRecommendation && entry.utilityGap >= 4).sort((a, b) => b.utilityGap - a.utilityGap);
    const shape = strategyShape(mine);
    const value = average(values);
    const completeness = validation.valid ? 100 : Math.max(0, 100 - validation.issues.length * 15);
    const gradeScore = Math.max(0, Math.min(100, Math.round(72 + value * 1.3 - missed.reduce((sum, item) => sum + item.utilityGap, 0) * 0.35 + (completeness - 80) * 0.2)));
    const grade = gradeScore >= 90 ? "A" : gradeScore >= 80 ? "B" : gradeScore >= 70 ? "C" : gradeScore >= 60 ? "D" : "F";
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      grade,
      gradeScore,
      rosterValid: validation.valid,
      issues: validation.issues || [],
      lineup: validation.lineup,
      starterValue: average(starterValues),
      benchValue: average(benchValues),
      totalValue: value,
      steals: values.filter((pick) => pick.marketDelta >= 8).sort((a, b) => b.marketDelta - a.marketDelta),
      reaches: values.filter((pick) => pick.marketDelta <= -8).sort((a, b) => a.marketDelta - b.marketDelta),
      strategy: { selected: payload?.strategy || "adaptive", ...shape },
      decisions,
      counterfactuals: missed.slice(0, 5),
      pickCount: mine.length,
      teamSlot: slot,
      format: `${numeric(payload?.teams, 12)}-team ${league?.roster?.SUPER_FLEX || league?.roster?.SF ? "superflex" : "1QB"}`,
      disclaimer: "Draft Fit grades describe process and roster construction. They are not projected points, win probability, or a guarantee of results.",
    };
  }

  function artifact(payload, review) {
    return {
      schemaVersion: 1,
      kind: "draft-review",
      generatedAt: review.generatedAt,
      configuration: {
        teams: payload.teams,
        slot: payload.slot,
        rounds: payload.rounds,
        strategy: payload.strategy,
        mode: payload.mode,
        league: payload.leagueSnapshot || null,
      },
      picks: payload.picks || [],
      review,
    };
  }

  function archive(storage, payload, review) {
    let current = [];
    try {
      const parsed = JSON.parse(storage.getItem(ARCHIVE_KEY) || "[]");
      if (Array.isArray(parsed)) current = parsed;
    } catch (_error) {
      current = [];
    }
    const id = `${payload.providerDraftId || "mock"}:${payload.teams}:${payload.slot}:${payload.picks?.length || 0}:${payload.picks?.map((p) => p.key).join(",")}`;
    const entry = { id, savedAt: new Date().toISOString(), artifact: artifact(payload, review) };
    const next = [entry, ...current.filter((item) => item.id !== id)].slice(0, 25);
    storage.setItem(ARCHIVE_KEY, JSON.stringify(next));
    return entry;
  }

  return { ARCHIVE_KEY, analyze, archive, artifact, decisionReview, marketDelta, strategyShape };
});
