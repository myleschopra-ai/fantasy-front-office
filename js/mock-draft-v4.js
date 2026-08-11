(function () {
  "use strict";

  const D = window.FFODraftIntelligence;
  const Session = window.FFODraftSession;
  const SourceHealth = window.FFODraftSourceHealth;
  const $ = (id) => document.getElementById(id);
  const LS = "ffo_mock_draft_v4";
  const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"];
  const DEFAULT_LEAGUE = {
    name: "12-team half-PPR",
    league_type: "redraft",
    scoring: { reception: 0.5 },
    roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, K: 1, DST: 1, BENCH: 6 },
  };
  const state = {
    players: [],
    picks: [],
    teams: 12,
    slot: 7,
    rounds: 16,
    strategy: "adaptive",
    mode: "sim",
    variance: "medium",
    activeLeague: window.FFO_ACTIVE_LEAGUE || DEFAULT_LEAGUE,
    intelligence: null,
    intelProfile: null,
    marketLoaded: false,
    profiles: {},
    selectedTeam: null,
    activeDraftTab: "board",
    queue: [],
    restored: false,
    loadToken: 0,
    survivalCache: new Map(),
    sessionStatus: Session ? Session.STATES.BOOTING : "BOOTING",
    recoveryIssues: [],
    recoveredSession: false,
    sourceHealth: null,
  };

  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character],
    );
  const numeric = (value, fallback = 0) =>
    Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min = 0, max = 100) =>
    Math.max(min, Math.min(max, numeric(value)));
  const formatSigned = (value) => `${value > 0 ? "+" : ""}${Math.round(value)}`;

  function showSessionRecovery(message, force = false) {
    const panel = $("session-recovery");
    const text = $("session-recovery-message");
    if (!panel) return;
    const show = force || state.sessionStatus === Session?.STATES.ERROR || state.sessionStatus === Session?.STATES.RECOVERING || state.recoveredSession;
    panel.style.display = show ? "flex" : "none";
    if (text && message) text.textContent = message;
  }

  function exportSnakeSession() {
    if (!Session) return;
    const payload = Session.diagnosticExport("snake", sessionPayload(), {
      status: state.sessionStatus,
      issues: state.recoveryIssues,
      league: { id: state.activeLeague?.id || state.activeLeague?.league_id || null, name: state.activeLeague?.name || null },
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "fantasy-front-office-draft-session.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function resetSnakeSession() {
    try { localStorage.removeItem(LS); } catch (_error) {}
    window.location.reload();
  }

  function sessionPayload() {
    return {
      version: Session ? Session.SCHEMA_VERSION : 4,
      picks: state.picks,
      teams: state.teams,
      slot: state.slot,
      rounds: state.rounds,
      strategy: state.strategy,
      mode: state.mode,
      variance: state.variance,
      profiles: state.profiles,
      selectedTeam: state.selectedTeam,
      activeDraftTab: state.activeDraftTab,
      queue: state.queue,
      leagueId: state.activeLeague?.id || state.activeLeague?.league_id || null,
      profileId: state.intelProfile?.id || null,
      sourceSnapshot: {
        generated_at: state.intelligence?.generated_at || state.intelligence?.meta?.generated_at || null,
        profile: state.intelProfile?.id || null,
        health: state.sourceHealth?.level || null,
        ageHours: Number.isFinite(state.sourceHealth?.ageHours) ? Number(state.sourceHealth.ageHours.toFixed(2)) : null,
      },
      savedStatus: state.sessionStatus,
    };
  }

  function updateSessionStatus(status, issues = []) {
    state.sessionStatus = status;
    state.recoveryIssues = Array.isArray(issues) ? issues : [];
    const el = $("session-status");
    if (el) {
      el.textContent = status;
      el.dataset.state = status;
      el.title = state.recoveryIssues.join(" · ");
    }
    if (status === Session?.STATES.ERROR) showSessionRecovery(state.recoveryIssues.join(" · ") || "Saved draft state needs attention.", true);
  }

  function save() {
    if (!Session) return;
    const result = Session.safeSave(localStorage, LS, "snake", sessionPayload(), {
      leagueName: state.activeLeague?.name || null,
    });
    if (!result.ok) updateSessionStatus(Session.STATES.ERROR, result.issues);
    else if (state.picks.length >= state.teams * state.rounds) updateSessionStatus(Session.STATES.COMPLETE);
    else if (state.picks.length) updateSessionStatus(Session.STATES.RUNNING);
    else updateSessionStatus(Session.STATES.READY);
  }

  function restore() {
    if (state.restored) return;
    state.restored = true;
    if (!Session) {
      state.picks = [];
      return;
    }
    updateSessionStatus(Session.STATES.RECOVERING);
    const result = Session.safeLoad(localStorage, LS, "snake");
    if (!result.ok) {
      state.picks = [];
      state.recoveredSession = false;
      updateSessionStatus(Session.STATES.ERROR, result.issues);
      return;
    }
    if (!result.payload) {
      updateSessionStatus(Session.STATES.READY);
      return;
    }
    Object.assign(state, result.payload);
    if (!D.STRATEGIES[state.strategy]) state.strategy = "adaptive";
    state.picks = (state.picks || []).map((pick, index) => normalizePick(pick, index + 1));
    state.selectedTeam = state.selectedTeam || state.slot;
    state.queue = Array.isArray(state.queue) ? state.queue : [];
    state.activeDraftTab = state.activeDraftTab || "board";
    state.recoveredSession = state.picks.length > 0;
    if (state.recoveredSession) showSessionRecovery(`Recovered ${state.picks.length} selections and ${state.queue.length} queued player${state.queue.length === 1 ? "" : "s"}.`, true);
    updateSessionStatus(
      state.picks.length >= state.teams * state.rounds
        ? Session.STATES.COMPLETE
        : state.picks.length
          ? Session.STATES.RUNNING
          : Session.STATES.READY,
    );
    // Rewrite a migrated v3 save immediately using the checksummed v4 envelope.
    if (result.migrated) save();
  }

  function ownerForPick(pick) {
    const round = Math.floor((pick - 1) / state.teams) + 1;
    const slot = ((pick - 1) % state.teams) + 1;
    return round % 2 ? slot : state.teams - slot + 1;
  }

  function roundPick(pick) {
    const round = Math.floor((pick - 1) / state.teams) + 1;
    const slot = ((pick - 1) % state.teams) + 1;
    return `${round}.${String(slot).padStart(2, "0")}`;
  }

  function normalizePick(value, pickNumber) {
    const pick = numeric(value.pick || value.pickNo, pickNumber);
    const team = numeric(value.team, ownerForPick(pick));
    return {
      ...value,
      pick,
      pickNo: pick,
      round: Math.floor((pick - 1) / state.teams) + 1,
      roundSlot: ((pick - 1) % state.teams) + 1,
      team,
      rosterId: String(value.rosterId || team),
      teamName: value.teamName || `Team ${team}`,
      playerId: String(value.playerId || value.key || ""),
      key: String(
        value.key || value.playerId || `${value.name}|${value.position}`,
      ),
      name: value.name || "Unknown",
      position: String(value.position || "?").toUpperCase(),
      nflTeam: value.nflTeam || value.team_abbr || "",
      rank: numeric(value.overallRank || value.overall_rank || value.rank, 999),
      overallRank: numeric(
        value.overallRank || value.overall_rank || value.rank,
        999,
      ),
      posRank: numeric(value.posRank || value.position_rank, 999),
      mine: team === state.slot,
    };
  }

  function createSelection(player, pick, team, source) {
    return normalizePick(
      {
        ...player,
        pick,
        team,
        source,
        playerId: player.key,
        rosterId: String(team),
        teamName: `Team ${team}`,
      },
      pick,
    );
  }

  function nextUserPick(after) {
    for (let pick = after + 1; pick <= state.teams * state.rounds; pick += 1) {
      if (ownerForPick(pick) === state.slot) return pick;
    }
    return null;
  }

  function available(picks = state.picks) {
    const gone = new Set(picks.map((pick) => pick.key));
    return state.players.filter((player) => !gone.has(player.key));
  }

  function teamPicks(team, picks = state.picks) {
    return picks.filter((pick) => pick.team === team);
  }

  function counts(team = state.slot, picks = state.picks) {
    return D.rosterCounts(teamPicks(team, picks));
  }

  function targets() {
    return D.starterTargets(state.activeLeague || DEFAULT_LEAGUE);
  }

  function target(position) {
    return targets()[position] || 1;
  }

  function isSuperflex() {
    const roster = state.activeLeague?.roster || {};
    return (
      numeric(roster.SUPER_FLEX || roster.SF, 0) > 0 ||
      numeric(roster.QB, 1) > 1
    );
  }

  function positionQuality(team, position, picks = state.picks) {
    const selected = teamPicks(team, picks)
      .filter((pick) => pick.position === position)
      .sort((a, b) => numeric(a.posRank, 999) - numeric(b.posRank, 999));
    return {
      count: selected.length,
      bestPosRank: numeric(selected[0]?.posRank, 999),
      best: selected[0] || null,
    };
  }

  function marketDelta(player, pick = state.picks.length + 1) {
    return (
      pick -
      numeric(player.adp, numeric(player.overallRank || player.rank, pick))
    );
  }

  function tierScarcity(player, picks = state.picks) {
    const sameTier = available(picks).filter(
      (candidate) =>
        candidate.position === player.position &&
        numeric(candidate.tier, 99) === numeric(player.tier, 99),
    ).length;
    return {
      sameTier,
      score: clamp(108 - sameTier * 13 + numeric(player.tierGapAfter, 0) * 5),
    };
  }

  function consensus(player) {
    return clamp(
      numeric(
        player.consensusScore,
        100 - numeric(player.overallRank || player.rank, 100) * 0.35,
      ),
    );
  }

  function rosterEquity(picks = state.picks) {
    const mine = teamPicks(state.slot, picks);
    const need = targets();
    const coverage =
      POSITIONS.reduce((sum, position) => {
        const filled = Math.min(
          numeric(counts(state.slot, picks)[position]),
          need[position],
        );
        return sum + filled / Math.max(1, need[position]);
      }, 0) / POSITIONS.length;
    const quality = mine.length
      ? mine.reduce((sum, pick) => sum + consensus(pick), 0) / mine.length / 100
      : 0;
    const excess = POSITIONS.reduce(
      (sum, position) =>
        sum +
        Math.max(
          0,
          numeric(counts(state.slot, picks)[position]) - need[position] - 2,
        ),
      0,
    );
    return Math.round(clamp(8 + coverage * 48 + quality * 44 - excess * 3));
  }

  function strategyForTeam(team) {
    if (team === state.slot) return state.strategy;
    const profile = state.profiles[team] || "adaptive";
    return profile === "rb-heavy"
      ? "robust-rb"
      : profile === "wr-heavy"
        ? "zero-rb"
        : profile;
  }

  function initProfiles() {
    const profiles = [
      "adaptive",
      "robust-rb",
      "zero-rb",
      "early-qb",
      "elite-te",
      "hero-rb",
      "late-qb",
    ];
    state.profiles = {};
    for (let team = 1; team <= state.teams; team += 1) {
      if (team !== state.slot)
        state.profiles[team] = profiles[(team - 1) % profiles.length];
    }
  }

  function scoreContext(
    player,
    team = state.slot,
    picks = state.picks,
    survival = 50,
  ) {
    const roster = teamPicks(team, picks);
    return {
      strategy: strategyForTeam(team),
      league: state.activeLeague || DEFAULT_LEAGUE,
      teams: state.teams,
      round: Math.floor(picks.length / state.teams) + 1,
      totalRounds: state.rounds,
      picks: roster,
      counts: D.rosterCounts(roster),
      targets: targets(),
      superflex: isSuperflex(),
      poolSize: Math.max(1, state.players.length),
      survival,
    };
  }

  function cpuScore(player, team, picks = state.picks) {
    const model = D.scorePlayer(player, scoreContext(player, team, picks, 50));
    return model.score;
  }

  function clampLocal(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function cpuChoice(team, picks = state.picks) {
    const baseAmplitude =
      state.variance === "low" ? 2 : state.variance === "high" ? 9 : 5;
    const pool = available(picks);
    const candidates = pool
      .slice(0, 50)
      .map((player) => {
        // Scale randomness by real cross-source agreement (already computed
        // from actual rank spread across FantasyPros/FantasyCalc/FFC/etc in
        // build_draft_intelligence.py) rather than a flat constant. Strong
        // public consensus (e.g. 95%+ agreement — the clear, undisputed
        // elites) should rarely get randomized out of order; genuinely
        // contested rankings (common for Superflex QB valuation
        // specifically, which varies a lot site-to-site) keep more natural
        // variance, reflecting real uncertainty rather than manufactured
        // noise.
        const agreementFactor = clampLocal(numeric(player.agreement, 50), 0, 100) / 100;
        const playerAmplitude = baseAmplitude * (1.4 - agreementFactor);
        const scarcity = D.scarcityScore(player, pool, {
          picksUntilNextTurn: 1, // opponent's own immediate pick, not the user's turn distance
        });
        return {
          player,
          score: cpuScore(player, team, picks),
          scarcity: scarcity.scarcity,
          amplitude: playerAmplitude,
        };
      });
    // Real Math.random() in production — mocks are not identical run to
    // run unless a deterministic seed is explicitly requested. The tested
    // chooseBestCandidate function is the same one proven deterministic
    // and bounded-rational in the test suite; production just feeds it
    // true randomness instead of a seed.
    const avgAmplitude =
      candidates.reduce((sum, c) => sum + c.amplitude, 0) / Math.max(1, candidates.length);
    return D.chooseBestCandidate(candidates, {
      amplitude: avgAmplitude,
      scarcityWeight: 0.15,
      randomFn: Math.random,
    });
  }

  function simulateToUser() {
    if (state.mode !== "sim") return;
    let guard = 0;
    while (
      state.picks.length < state.teams * state.rounds &&
      ownerForPick(state.picks.length + 1) !== state.slot &&
      guard < 400
    ) {
      guard += 1;
      const pick = state.picks.length + 1;
      const team = ownerForPick(pick);
      const player = cpuChoice(team);
      if (!player) break;
      state.picks.push(createSelection(player, pick, team, "cpu"));
    }
    state.survivalCache.clear();
    save();
    render();
  }

  function survival(player, runs = 5) {
    const next = nextUserPick(state.picks.length);
    if (!next) return 0;
    const cacheKey = `${state.picks.length}|${state.strategy}|${state.variance}|${player.key}`;
    if (state.survivalCache.has(cacheKey))
      return state.survivalCache.get(cacheKey);
    let survived = 0;
    for (let run = 0; run < runs; run += 1) {
      const simulated = state.picks.map((pick) => ({ ...pick }));
      while (simulated.length < next - 1) {
        const pick = simulated.length + 1;
        const team = ownerForPick(pick);
        const choice = cpuChoice(team, simulated);
        if (!choice) break;
        simulated.push(createSelection(choice, pick, team, "simulation"));
      }
      if (!simulated.some((pick) => pick.key === player.key)) survived += 1;
    }
    const probability = Math.round((survived / runs) * 100);
    state.survivalCache.set(cacheKey, probability);
    return probability;
  }

  function approximateSurvival(player) {
    const currentPick = state.picks.length + 1;
    const nextPick = nextUserPick(state.picks.length);
    if (!nextPick) return 0;
    const adp = numeric(player.adp, numeric(player.overallRank || player.rank, currentPick));
    const marketMargin = adp - nextPick;
    const agreement = clampLocal(numeric(player.agreement, 50), 0, 100);
    const confidenceAdjustment = (agreement - 50) * 0.08;
    return Math.round(clampLocal(50 + marketMargin * 5 + confidenceAdjustment, 4, 96));
  }

  function equityFor(player, detailed = true) {
    const survives = detailed ? survival(player) : approximateSurvival(player);
    const model = D.scorePlayer(
      player,
      scoreContext(player, state.slot, state.picks, survives),
    );
    const projected = [
      ...state.picks,
      createSelection(player, state.picks.length + 1, state.slot, "projection"),
    ];
    const nextPick = nextUserPick(state.picks.length);
    const picksUntilNextTurn = nextPick != null ? nextPick - (state.picks.length + 1) : 12;
    const pool = available(state.picks);
    const scarcity = D.scarcityScore(player, pool, {
      picksUntilNextTurn,
    });
    const waitRisk = D.waitRiskCategory({
      survivalProbability: survives,
      playerValue: model.playerGrade,
      scarcity: scarcity.scarcity,
    });
    const opportunityCost = detailed
      ? D.opportunityCost(player, pool, {
          ...scoreContext(player, state.slot, state.picks, survives),
          picksUntilNextTurn,
        })
      : { opportunityCost: 0, bestAlternative: null, bestAlternativePosition: null, lineupImprovementForfeited: false };
    const sourcePenalty = SourceHealth ? SourceHealth.confidencePenalty(state.sourceHealth) : 0;
    return {
      ...model,
      confidence: Math.max(1, numeric(model.confidence, 50) - sourcePenalty),
      sourcePenalty,
      eq: rosterEquity(projected),
      sv: survives,
      scarcity,
      waitRisk,
      opportunityCost,
    };
  }

  function actionFor(player, evaluation) {
    const needState = advisorNeedState(player);
    // Never let an opaque composite score produce a contradictory live-draft
    // instruction after the roster state says this position is already solved.
    if (needState.state === "saturated") return "AVOID AT COST";
    if (needState.state === "luxury" && evaluation.score < 92) return "WAIT";
    if (evaluation.score >= 76 && evaluation.sv < 50) return "DRAFT NOW";
    if (
      player.tierEnd &&
      numeric(player.tierGapAfter, 0) >= 2.5 &&
      evaluation.score >= 70
    )
      return "TIER CLOSING";
    if (evaluation.sv >= 72) return "WAIT";
    if (marketDelta(player) < -12 && evaluation.score < 72)
      return "AVOID AT COST";
    return "TARGET";
  }

  function recommendations() {
    const shortlist = available()
      .slice(0, 60)
      .map((player) => ({ ...player, ...equityFor(player, false) }))
      .sort((a, b) => b.score - a.score || a.overallRank - b.overallRank)
      .slice(0, 8);
    return shortlist
      .map((player) => ({ ...player, ...equityFor(player, true) }))
      .sort((a, b) => b.score - a.score || a.overallRank - b.overallRank)
      .slice(0, 4);
  }

  function advisorNeedState(player) {
    return D.rosterNeedState(player, scoreContext(player, state.slot, state.picks, 50));
  }

  function needLabel(player) {
    return advisorNeedState(player).label;
  }

  function needStateClass(needState) {
    if (!needState) return "target";
    if (needState.state === "starter_need" || needState.state === "flex_need") return "urgent";
    if (needState.state === "starter_upgrade") return "closing";
    if (needState.state === "luxury" || needState.state === "saturated") return "avoid";
    return "target";
  }

  function needReason(player) {
    const needState = advisorNeedState(player);
    const slot = needState.slot ? needState.slot.replace("SUPER_FLEX", "Superflex") : null;
    switch (needState.state) {
      case "starter_need": return `fills your open ${slot || player.position} starter`;
      case "flex_need": return `fills your open ${slot || "FLEX"} slot`;
      case "starter_upgrade": return `projects into your starting lineup at ${slot || player.position}`;
      case "depth_upside": return "adds RB/WR bench upside after current starter needs";
      case "luxury": return `${player.position} starter is already secured; this is a luxury/depth pick`;
      case "saturated": return `${player.position} slot is already filled; prioritize another position`;
      default: return "adds depth rather than filling an open starter";
    }
  }

  function componentSummary(evaluation) {
    const labels = {
      market: "consensus",
      vbd: "VBD",
      tier: "tier",
      need: "roster need",
      availability: "urgency",
      scheme: "scheme",
      strategy: "strategy",
    };
    return Object.keys(evaluation.weights)
      .map((key) => ({
        key,
        contribution: evaluation.components[key] * evaluation.weights[key],
      }))
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 3)
      .map(
        (item) =>
          `${labels[item.key]} ${Math.round(evaluation.components[item.key])}`,
      )
      .join(" · ");
  }

  function rankIcons(player, evaluation) {
    const scarcity = tierScarcity(player);
    const cliff = player.tierEnd
      ? `<span class="icon tier-cliff">CLIFF +${numeric(player.tierGapAfter, 0).toFixed(1)}</span>`
      : "";
    return (
      `<span class="icon">O${numeric(player.overallRank, player.rank)}</span>` +
      `<span class="icon">P${numeric(player.posRank, 999)}</span>` +
      `<span class="icon">T${numeric(player.tier, 99)}</span>${cliff}` +
      `<span class="icon">VBD ${Math.round(evaluation.components.vbd)}</span>` +
      `<span class="icon">SCHEME ${Math.round(evaluation.components.scheme)}</span>` +
      `<span class="icon">${scarcity.sameTier} left in tier</span>` +
      `<span class="icon">CONF ${evaluation.confidence}</span>`
    );
  }

  function renderRecommendation() {
    const ranked = recommendations();
    const best = ranked[0];
    const nextPick = state.picks.length + 1;
    const draftComplete = state.picks.length >= state.teams * state.rounds;
    if (draftComplete) {
      const completed = D.validateCompletedRoster(teamPicks(state.slot), state.activeLeague || DEFAULT_LEAGUE);
      const filled = completed.lineup.starters.filter((slot) => slot.player).length;
      const total = completed.lineup.starters.length;
      $("pick-label").textContent = "Draft complete";
      $("clock").textContent = "";
      $("best").textContent = `Lineup set · ${filled}/${total} starters · ${completed.lineup.bench.length} bench`;
      $("why").textContent = completed.valid
        ? "Optimized starting lineup is ready in My Team. Review starters, FLEX assignments and bench construction."
        : `Roster review: ${completed.issues.join(" · ") || "check remaining starter gaps"}`;
      return;
    }
    $("pick-label").textContent =
      `${roundPick(nextPick)} · Team ${ownerForPick(nextPick)}`;
    $("clock").textContent =
      ownerForPick(nextPick) === state.slot ? "YOU ARE ON THE CLOCK" : "";
    if (!best) {
      $("best").textContent = "Draft complete — player pool exhausted.";
      return;
    }
    const directive = D.strategyDirective({
      strategy: state.strategy,
      league: state.activeLeague,
      round: Math.floor(state.picks.length / state.teams) + 1,
      picks: teamPicks(state.slot),
      counts: counts(),
      superflex: isSuperflex(),
    });
    $("best").innerHTML =
      `<span class="player-link" data-player="${esc(best.key)}" tabindex="0">${esc(best.name)} · ${best.position}</span>`;
    $("equity").textContent = best.score;
    $("delta").textContent = formatSigned(marketDelta(best));
    $("ceiling").textContent = `T${numeric(best.tier, 99)}`;
    $("breakout").textContent = `${Math.round(numeric(best.agreement, 50))}%`;
    $("bust").textContent = `${best.confidence}%`;
    $("survive").textContent = `${best.sv}%`;
    $("why").textContent =
      `${actionFor(best, best)} · ${needLabel(best)} — ${needReason(best)}. ${componentSummary(best)}. ${directive.directive}`;
    $("alts").innerHTML = ranked
      .slice(1)
      .map(
        (player, index) =>
          `<div class="row compact-rec"><div class="player-link" data-player="${esc(player.key)}" tabindex="0"><div class="name">${index === 0 ? "Next" : index === 1 ? "Structural" : "Value"}: ${esc(player.name)} · ${player.position}</div><div class="icons">${rankIcons(player, player)}<span class="icon">⏳ ${player.sv}%</span></div></div><span class="score">${player.score}</span></div>`,
      )
      .join("");
  }

  function renderBoard() {
    const position = $("pos").value;
    const query = $("search").value.trim().toLowerCase();
    const flexEligible = { FLEX: ["RB", "WR", "TE"], SUPER_FLEX: ["QB", "RB", "WR", "TE"] };
    const positionMatch = (player) => {
      if (position === "ALL") return true;
      if (flexEligible[position]) return flexEligible[position].includes(player.position);
      return player.position === position;
    };
    $("board").innerHTML = available()
      .filter((player) => positionMatch(player) && (!query || player.name.toLowerCase().includes(query)))
      .slice(0, 60)
      .map((player) => playerRowHTML(player, equityFor(player, false), state.queue.includes(player.key)))
      .join("");
    document.querySelectorAll("#board [data-k]").forEach((button) => {
      button.onclick = () => draft(button.dataset.k);
    });
    document.querySelectorAll("#board [data-queue-k]").forEach((button) => {
      button.onclick = () => toggleQueue(button.dataset.queueK);
    });
  }

  function rosterLineupHTML(team = state.slot) {
    const drafted = teamPicks(team);
    const lineup = D.optimalLineup(drafted, state.activeLeague || DEFAULT_LEAGUE);
    const occurrence = {};
    const starters = lineup.starters.map((entry) => {
      occurrence[entry.slot] = (occurrence[entry.slot] || 0) + 1;
      const totalForSlot = lineup.starters.filter((s) => s.slot === entry.slot).length;
      const label = totalForSlot > 1 ? `${entry.slot}${occurrence[entry.slot]}` : entry.slot;
      const player = entry.player;
      return `<div class="slot lineup-slot ${player ? `pos-${String(player.position).toLowerCase()}` : 'empty'}"><span>${esc(label)}</span><strong>${player ? esc(player.name) : 'Empty'}</strong><span>${player ? `${esc(player.position)}${player.nflTeam ? ` · ${esc(player.nflTeam)}` : ''}` : 'starter need'}</span></div>`;
    }).join('');
    const bench = lineup.bench.length
      ? `<div class="bench-label">BENCH · ${lineup.bench.length}</div><div class="bench-list">${lineup.bench.map((player) => `<span class="bench-chip pos-${String(player.position).toLowerCase()}">${esc(player.position)} ${esc(player.name)}</span>`).join('')}</div>`
      : '<div class="bench-label">BENCH · Empty</div>';
    return starters + bench;
  }

  function renderRoster() {
    const rosterCounts = counts();
    const equity = rosterEquity();
    $("roster").innerHTML = rosterLineupHTML(state.slot);
    $("roster-equity").textContent = equity;
    $("equity-bar").style.width = `${equity}%`;
    const validation = D.validateCompletedRoster(teamPicks(state.slot), state.activeLeague || DEFAULT_LEAGUE);
    const openSlots = validation.lineup.starters.filter((slot) => !slot.player).map((slot) => slot.slot);
    const directive = D.strategyDirective({
      strategy: state.strategy,
      league: state.activeLeague,
      round: Math.floor(state.picks.length / state.teams) + 1,
      picks: teamPicks(state.slot),
      counts: rosterCounts,
      superflex: isSuperflex(),
    });
    $("profile").innerHTML =
      `Starter gaps: <strong>${openSlots.length ? openSlots.join(", ") : "none"}</strong><br>Current plan: <strong>${esc(directive.directive)}</strong>${directive.warning ? `<br><span class="confidence-low">Guardrail: ${esc(directive.warning)}</span>` : ""}`;
  }

  function renderIntelligence() {
    const directive = D.strategyDirective({
      strategy: state.strategy,
      league: state.activeLeague,
      round: Math.floor(state.picks.length / state.teams) + 1,
      picks: teamPicks(state.slot),
      counts: counts(),
      superflex: isSuperflex(),
    });
    const source = D.sourceSummary(state.intelligence, state.intelProfile);
    const healthy = Boolean(state.intelProfile && source.healthy);
    const date = source.generatedAt
      ? new Date(source.generatedAt).toLocaleDateString()
      : "";
    $("intelligence-status").innerHTML =
      `<span class="source-dot ${healthy ? "" : "fallback"}"></span>${healthy ? `${source.healthy}/${source.total} ranking feeds · ${esc(state.intelProfile.id)}${date ? ` · ${date}` : ""}` : state.marketLoaded ? "Live FantasyCalc market · single-source fallback" : "Awaiting a verified data refresh"}`;
    $("strategy-playbook").innerHTML =
      `<strong>${esc(directive.label)}</strong><br>${esc(directive.directive)}${directive.warning ? `<br><span class="confidence-low">${esc(directive.warning)}</span>` : ""}`;
    const weights = D.STRATEGIES[directive.strategy].weights;
    const labels = {
      market: "Consensus",
      vbd: "VBD",
      tier: "Tier cliff",
      need: "Roster need",
      availability: "Availability",
      scheme: "Scheme cap",
      strategy: "Strategy",
    };
    $("weight-summary").innerHTML = Object.entries(weights)
      .map(
        ([key, value]) =>
          `<div class="factor">${labels[key]}<strong>${Math.round(value * 100)}%</strong></div>`,
      )
      .join("");
    if (state.intelProfile) {
      $("source").textContent =
        `${source.label} · ${state.players.length} players · ${state.intelProfile.id}`;
    } else if (state.marketLoaded) {
      $("source").textContent =
        `FantasyCalc live market · ${state.players.length} players · refresh snapshot unavailable`;
    }
  }

  function metricValue(key, value) {
    if (key.includes("epa")) return numeric(value).toFixed(3);
    if (key === "plays_per_game") return numeric(value).toFixed(1);
    return `${(numeric(value) * 100).toFixed(1)}%`;
  }

  function schemeHtml(player) {
    const scheme = D.teamScheme(state.intelligence, player);
    if (!scheme) {
      return '<div class="scheme-block"><strong>Scheme context unavailable</strong><br><span class="muted">The player remains ranked from market, VBD, tier and roster signals.</span></div>';
    }
    const metricKeys =
      {
        QB: [
          "neutral_pass_rate",
          "pass_rate_over_expected",
          "pass_epa_per_play",
          "qb_designed_rush_rate",
        ],
        RB: [
          "rb_rush_share",
          "rb_target_share",
          "rush_epa_per_play",
          "red_zone_pass_rate",
        ],
        WR: [
          "wr_target_share",
          "neutral_pass_rate",
          "explosive_pass_rate",
          "pass_epa_per_play",
        ],
        TE: [
          "te_target_share",
          "te_red_zone_target_share",
          "neutral_pass_rate",
          "pass_epa_per_play",
        ],
      }[player.position] || [];
    const metricLabels = {
      neutral_pass_rate: "Neutral pass rate",
      pass_rate_over_expected: "Pass rate over expected",
      pass_epa_per_play: "Pass EPA/play",
      qb_designed_rush_rate: "Designed-QB rush share",
      rb_rush_share: "RB rush share",
      rb_target_share: "RB target share",
      rush_epa_per_play: "Rush EPA/play",
      red_zone_pass_rate: "Red-zone pass rate",
      wr_target_share: "WR target share",
      explosive_pass_rate: "Explosive pass rate",
      te_target_share: "TE target share",
      te_red_zone_target_share: "TE red-zone target share",
    };
    const staff = scheme.staff || {};
    const positionCoach = scheme.positionCoach || "not listed";
    const transition = scheme.staff_transition
      ? "New offensive staff: prior team tendencies are confidence-adjusted."
      : "Returning staff context: prior tendencies receive normal confidence.";
    const metrics = metricKeys
      .filter((key) => scheme.metrics?.[key] != null)
      .map(
        (key) =>
          `<div class="factor">${metricLabels[key]}<strong>${metricValue(key, scheme.metrics[key])}</strong></div>`,
      )
      .join("");
    const officialLink = /^https:\/\//.test(staff.source_url || "")
      ? ` · <a href="${esc(staff.source_url)}" target="_blank" rel="noopener">official staff page</a>`
      : "";
    return `<div class="scheme-block"><strong>${esc(scheme.team)} offensive context · ${player.position} fit ${numeric(player.schemeFit?.score, 50)} / 100</strong><br>Head coach: ${esc(staff.head_coach || "unverified")} · OC: ${esc(staff.offensive_coordinator || "unverified")} · ${player.position} coach: ${esc(positionCoach)}${officialLink}<br><span class="muted">${esc(transition)}</span><div class="intel-strip">${metrics}</div><div style="margin-top:8px"><strong>Player tendencies</strong><br>${esc((player.archetype || ["not enough usage evidence"]).join(", "))}</div><div style="margin-top:6px"><strong>Fit evidence</strong><br>${esc((player.schemeFit?.reasons || []).join(" · ") || "Near-average position environment")}</div><div style="margin-top:6px"><strong>Unit strengths</strong><br>${esc((scheme.strengths || ["none above threshold"]).join(", "))}</div><div class="muted" style="margin-top:7px">${esc(scheme.attribution_note || "Team context is not proof of individual coach causation.")}</div></div>`;
  }

  function openPlayer(key) {
    const player = state.players.find((candidate) => candidate.key === key);
    if (!player) return;
    const draftedPick = state.picks.find((pick) => pick.key === player.key);
    // Peers only make sense for players still on the board — an already-drafted
    // player is shown alone with a real score breakdown instead.
    const peers = draftedPick
      ? []
      : available()
          .filter(
            (candidate) =>
              candidate.position === player.position &&
              candidate.key !== player.key,
          )
          .sort(
            (a, b) =>
              Math.abs(a.posRank - player.posRank) -
              Math.abs(b.posRank - player.posRank),
          )
          .slice(0, 2);
    const group = [player, ...peers];
    $("player-modal-title").textContent =
      `${player.name} · ${player.position}${player.nflTeam ? ` · ${player.nflTeam}` : ""}${draftedPick ? ` · Drafted ${roundPick(draftedPick.pick)} (Team ${draftedPick.team})` : ""}`;
    $("player-blurb").textContent = draftedPick
      ? `Already drafted. Score shown below is recomputed now, using current context — not necessarily identical to the value at the moment this pick was made.`
      : `${needLabel(player)} — ${needReason(player)}. Overall ${numeric(player.overallRank, player.rank)}, ${player.position}${numeric(player.posRank, 999)}, position tier ${numeric(player.tier, 99)}, ADP ${numeric(player.adp, player.overallRank).toFixed(1)}. ${numeric(player.sourceCount, 1)} ranking source${numeric(player.sourceCount, 1) === 1 ? "" : "s"} with ${Math.round(numeric(player.agreement, 50))}% agreement.`;
    $("player-scheme").innerHTML = schemeHtml(player);
    $("player-compare").innerHTML = group
      .map((candidate, index) => {
        const evaluation = equityFor(candidate);
        const c = evaluation.components;
        const metric = (label, value) => `<div class="metric-box"><span class="metric-label">${label}</span><span class="metric-value">${value}</span></div>`;
        const waitLabels = {
          TAKE_NOW: "TAKE NOW",
          HIGH_WAIT_RISK: "HIGH WAIT RISK",
          MODERATE_WAIT_RISK: "MODERATE WAIT RISK",
          STRONG_WAIT_CANDIDATE: "STRONG WAIT CANDIDATE",
          LIKELY_AVAILABLE: "LIKELY AVAILABLE",
        };
        const waitColors = {
          TAKE_NOW: "#f87171",
          HIGH_WAIT_RISK: "#f5b942",
          MODERATE_WAIT_RISK: "#f5b942",
          STRONG_WAIT_CANDIDATE: "#2dd4bf",
          LIKELY_AVAILABLE: "#2dd4bf",
        };
        const waitLabel = waitLabels[evaluation.waitRisk.category] || evaluation.waitRisk.category;
        const waitColor = waitColors[evaluation.waitRisk.category] || "#94a3b8";
        return `<div class="compare-card ${index === 0 ? "primary" : ""}">
          <div class="muted">${index === 0 ? (draftedPick ? "DRAFTED" : "SELECTED") : "POSITION PEER"}</div>
          <div class="name">${esc(candidate.name)}</div>
          <div class="meta">O${numeric(candidate.overallRank, candidate.rank)} · ${candidate.position}${numeric(candidate.posRank, 999)} · T${numeric(candidate.tier, 99)}</div>
          <div style="margin-top:6px;"><span class="action-badge" style="background:${waitColor}22; color:${waitColor};">${waitLabel}</span> <span class="detail-line" style="display:inline;">— ${evaluation.sv}% survives to your next pick, wait cost ${evaluation.waitRisk.waitCost}</span></div>
          <div class="metric-grid" style="grid-template-columns: repeat(4, 1fr); margin-top:6px;">
            ${metric("Player Grade", evaluation.playerGrade)}
            ${metric("Market Value", evaluation.marketValue)}
            ${metric("League Value", evaluation.leagueValue)}
            ${metric("Pick Utility", evaluation.pickUtility)}
          </div>
          <div class="detail-line" style="margin-top:6px;">Player Grade = stable quality, never changes from your own roster. Pick Utility = should you draft him <em>right now</em>, given your roster and this moment.</div>
          <div class="metricline" style="margin-top:8px;">confidence ${evaluation.confidence}%</div>
          <div class="metric-grid">
            ${metric("Market", Math.round(c.market))}
            ${metric("VBD", Math.round(c.vbd))}
            ${metric("Tier", Math.round(c.tier))}
            ${metric("Need", Math.round(c.need))}
            ${metric("Scheme", Math.round(c.scheme))}
            ${metric("Strategy", Math.round(c.strategy))}
            ${metric("Pedigree", Math.round(c.pedigree))}
            ${metric("Age Curve", Math.round(c.ageCurve))}
            ${metric("Survives", `${evaluation.sv}%`)}
            ${metric("Scarcity", evaluation.scarcity.scarcity)}
            ${metric("Tier Depth", evaluation.scarcity.tierDepth)}
            ${metric("Tier Dropoff", evaluation.scarcity.tierDropoff)}
            ${metric("Opp. Cost", evaluation.opportunityCost.opportunityCost)}
          </div>
          ${evaluation.opportunityCost.bestAlternative ? `<div class="detail-line" style="margin-top:6px;">Best alternative: ${esc(evaluation.opportunityCost.bestAlternative.name)} (${evaluation.opportunityCost.bestAlternativePosition})${evaluation.opportunityCost.lineupImprovementForfeited ? " — would start immediately, this pick would not" : ""}</div>` : ""}
        </div>`;
      })
      .join("");
    $("player-modal-backdrop").classList.add("open");
  }

  function closePlayer() {
    $("player-modal-backdrop").classList.remove("open");
  }

  function bindPlayerLinks() {
    document.querySelectorAll("[data-player]").forEach((element) => {
      element.onclick = (event) => {
        if (event.target.closest("[data-k]")) return;
        openPlayer(element.dataset.player);
      };
      element.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPlayer(element.dataset.player);
        }
      };
    });
  }

  function showDraftTab(tab) {
    state.activeDraftTab = tab;
    const viewIds = {
      board: "draft-grid-view", team: "team-roster-view", selections: "selections-view",
      queue: "queue-view", recommended: "recommended-view",
    };
    ["board", "team", "selections", "queue", "recommended"].forEach((name) => {
      const button = $(`tab-${name}`);
      const view = $(viewIds[name]);
      if (button) button.classList.toggle("active", name === tab);
      if (view) view.style.display = name === tab ? "block" : "none";
    });
    if (tab === "team") renderTeamRoster();
    if (tab === "selections") renderSelections();
    if (tab === "queue") renderQueue();
    if (tab === "recommended") renderRecommended();
  }

  function renderDraftGrid() {
    const byPick = new Map(state.picks.map((pick) => [pick.pick, pick]));
    let html = `<div class="draft-grid" style="grid-template-columns:40px repeat(${state.teams},var(--pickw,108px))"><div class="draft-cell header round">RD</div>`;
    for (let team = 1; team <= state.teams; team += 1) {
      html += `<div class="draft-cell header ${team === state.slot ? "mine" : ""}" data-team="${team}">Team ${team}${team === state.slot ? " · YOU" : ""}<div class="pickmeta">${teamPicks(team).length} selected</div></div>`;
    }
    for (let round = 1; round <= state.rounds; round += 1) {
      html += `<div class="draft-cell round">R${round}</div>`;
      for (let displayTeam = 1; displayTeam <= state.teams; displayTeam += 1) {
        const owner = round % 2 ? displayTeam : state.teams - displayTeam + 1;
        const pickNumber =
          (round - 1) * state.teams +
          (round % 2 ? displayTeam : state.teams - displayTeam + 1);
        const selection = byPick.get(pickNumber);
        const active = pickNumber === state.picks.length + 1;
        html += `<div class="draft-cell ${active ? "active" : ""} ${owner === state.slot ? "mine" : ""}" data-team="${owner}"><div class="pickno">${roundPick(pickNumber)} · Team ${owner}</div>${selection ? `<div class="pickname">${esc(selection.name)}</div><div class="pickmeta">${esc(selection.position)}${selection.nflTeam ? ` · ${esc(selection.nflTeam)}` : ""}</div><div class="sim-badge">MOCK ADDITION</div>` : `<div class="empty-pick">${active ? "ON THE CLOCK" : "Available"}</div>`}</div>`;
      }
    }
    html += "</div>";
    $("draft-grid").innerHTML = html;
    $("board-summary").textContent =
      `${state.picks.length} of ${state.teams * state.rounds} selections · Team ${ownerForPick(Math.min(state.picks.length + 1, state.teams * state.rounds))} on the clock`;
    document.querySelectorAll("#draft-grid [data-team]").forEach((element) => {
      element.onclick = () => {
        state.selectedTeam = numeric(element.dataset.team, state.slot);
        save();
        showDraftTab("team");
      };
    });
  }

  function renderTeamRoster() {
    const team = state.selectedTeam || state.slot;
    const roster = teamPicks(team);
    const league = state.activeLeague || DEFAULT_LEAGUE;
    const lineup = D.optimalLineup(roster, league);
    const occurrence = {};
    const slotRow = (slotName, pick) => pick
      ? `<div class="row"><div class="player-link" data-player="${esc(pick.key)}" tabindex="0" style="cursor:pointer;"><div class="name">${esc(pick.name)}</div><div class="meta">${esc(slotName)} · ${esc(pick.position)} · ${roundPick(pick.pick)}</div></div><span class="sim-badge">MOCK</span></div>`
      : `<div class="row"><div class="muted">${esc(slotName)} — Empty</div></div>`;

    let html = `<div class="toolbar" style="margin-top:10px"><strong>Team ${team}${team === state.slot ? " · YOU" : ""}</strong><select id="team-select" style="width:auto">${Array.from({ length: state.teams }, (_value, index) => `<option value="${index + 1}" ${team === index + 1 ? "selected" : ""}>Team ${index + 1}${state.slot === index + 1 ? " · YOU" : ""}</option>`).join("")}</select></div>`;
    const starterRows = lineup.starters.map((entry) => {
      occurrence[entry.slot] = (occurrence[entry.slot] || 0) + 1;
      const total = lineup.starters.filter((s) => s.slot === entry.slot).length;
      const label = total > 1 ? `${entry.slot}${occurrence[entry.slot]}` : entry.slot;
      return slotRow(label, entry.player);
    }).join("");
    html += `<div class="team-roster-list">${starterRows || '<div class="muted">No starter slots configured.</div>'}</div>`;
    html += `<div class="muted" style="margin-top:10px">BENCH · ${lineup.bench.length}</div><div class="team-roster-list">${lineup.bench.map((pick) => slotRow("BENCH", pick)).join("") || '<div class="muted">Bench empty.</div>'}</div>`;
    html += `<div class="notice" style="margin-top:10px">This simulated class never modifies the real league roster.</div>`;
    $("team-roster-view").innerHTML = html;
    $("team-select").onchange = (event) => {
      state.selectedTeam = numeric(event.target.value, state.slot);
      save();
      renderTeamRoster();
    };
    bindPlayerLinks();
  }

  function renderSelections() {
    $("selections-view").innerHTML =
      `<div style="margin-top:10px">${state.picks.map((pick) => `<div class="row"><div><strong>${roundPick(pick.pick)}</strong> · Team ${pick.team}</div><div>${esc(pick.name)} · ${esc(pick.position)} <span class="sim-badge">MOCK</span></div></div>`).join("") || '<div class="muted">No picks yet.</div>'}</div>`;
  }

  function toggleQueue(key) {
    const i = state.queue.indexOf(key);
    if (i === -1) state.queue.push(key); else state.queue.splice(i, 1);
    save();
    if (state.activeDraftTab === "board") renderBoard();
    if (state.activeDraftTab === "queue") renderQueue();
    if (state.activeDraftTab === "recommended") renderRecommended();
  }

  function actionClass(actionText) {
    if (actionText === "DRAFT NOW") return "urgent";
    if (actionText === "TIER CLOSING") return "closing";
    if (actionText === "WAIT") return "wait";
    if (actionText === "AVOID AT COST") return "avoid";
    return "target";
  }

  function playerRowHTML(player, evaluation, queued) {
    const action = actionFor(player, evaluation);
    const needState = advisorNeedState(player);
    const scarcity = tierScarcity(player);
    const cliff = player.tierEnd
      ? ` · cliff +${numeric(player.tierGapAfter, 0).toFixed(1)}`
      : "";
    // Consensus top picks (roughly top 5 rounds worth) don't need extra detail —
    // they're well-known. Later-round players are where real current signal
    // (news/sentiment, ADP-vs-value gaps) actually changes a decision, so that's
    // where expanded detail gets shown.
    const isLateRound = numeric(player.overallRank, 999) > 60;
    let sleeperBlock = "";
    if (isLateRound) {
      const delta = marketDelta(player);
      const news = state.newsByName ? state.newsByName[player.name] : null;
      const valueNote = delta >= 8
        ? `<div class="detail-line" style="color:#2dd4bf;">Falling relative to ADP by ${Math.round(delta)} picks — possible value.</div>`
        : delta <= -8
          ? `<div class="detail-line" style="color:#f87171;">Going well ahead of ADP by ${Math.round(-delta)} picks — reach territory.</div>`
          : "";
      const newsNote = news && news.headline
        ? `<div class="detail-line" style="color:#94a3b8; margin-top:2px;">📰 ${esc(news.headline)}</div>`
        : "";
      sleeperBlock = valueNote + newsNote;
    }
    return `<div class="row compact-rec">
      <button class="icon" data-queue-k="${esc(player.key)}" style="background:none;border:none;cursor:pointer;font-size:15px;color:${queued ? "#f5b942" : "#64748b"};" title="Toggle queue">★</button>
      <div class="player-link" data-player="${esc(player.key)}" tabindex="0">
        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
          <span class="action-badge ${actionClass(action)}">${action}</span>
          <span class="action-badge ${needStateClass(needState)}">${esc(needState.label)}</span>
          <span class="name">${esc(player.name)}</span>
          <span class="meta">${player.position}${player.nflTeam ? ` · ${esc(player.nflTeam)}` : ""}</span>
        </div>
        <div class="identity-line">Overall #${numeric(player.overallRank, player.rank)} · Pos #${numeric(player.posRank, 999)} · Tier ${numeric(player.tier, 99)} · ${evaluation.sv <= 35 ? "🔒 locked" : "⏳"} ${evaluation.sv}% survives</div>
        <div class="detail-line">Score ${evaluation.score} · VBD ${Math.round(evaluation.components.vbd)} · Scheme ${Math.round(evaluation.components.scheme)} · Confidence ${evaluation.confidence}% · ${scarcity.sameTier} left in tier${cliff}</div>
        ${sleeperBlock}
      </div>
      <button class="btn secondary" data-k="${esc(player.key)}">Draft</button>
    </div>`;
  }

  function renderQueue() {
    const entries = state.queue
      .map((key) => state.players.find((player) => player.key === key))
      .filter(Boolean)
      .filter((player) => !state.picks.some((pick) => pick.key === player.key));
    $("queue-view").innerHTML = entries.length
      ? entries.map((player) => playerRowHTML(player, equityFor(player), true)).join("")
      : '<div class="muted" style="margin-top:10px">No players queued yet — tap the ★ on any player in Board or Recommended to add them here.</div>';
    document.querySelectorAll("#queue-view [data-k]").forEach((button) => { button.onclick = () => draft(button.dataset.k); });
    document.querySelectorAll("#queue-view [data-queue-k]").forEach((button) => { button.onclick = () => toggleQueue(button.dataset.queueK); });
  }

  // Recommended tab — reuses the exact same scoring engine (equityFor -> scoreContext ->
  // D.scorePlayer) that already powers the "Championship decision" panel. Not a new or
  // separate model; this tab just surfaces it sorted and ranked instead of one pick at a time.
  function renderRecommended() {
    const ranked = available()
      .slice(0, 60)
      .map((player) => ({ player, evaluation: equityFor(player, false) }))
      .sort((a, b) => b.evaluation.score - a.evaluation.score)
      .slice(0, 15);
    $("recommended-view").innerHTML =
      `<div class="notice" style="margin:10px 0">Ranked by the same engine as the Championship decision panel: market consensus, value over replacement, live tier cliffs, roster need, and simulated availability.</div>` +
      (ranked.length
        ? ranked.map(({ player, evaluation }) => playerRowHTML(player, evaluation, state.queue.includes(player.key))).join("")
        : '<div class="muted">No recommendations available.</div>');
    document.querySelectorAll("#recommended-view [data-k]").forEach((button) => { button.onclick = () => draft(button.dataset.k); });
    document.querySelectorAll("#recommended-view [data-queue-k]").forEach((button) => { button.onclick = () => toggleQueue(button.dataset.queueK); });
  }

  function renderPicks() {
    $("room-status").textContent =
      `${state.teams}-team snake · slot ${state.slot}`;
    $("picks").innerHTML =
      state.picks
        .slice()
        .reverse()
        .map(
          (pick) =>
            `<div class="row"><div>${roundPick(pick.pick)} · Team ${pick.team}</div><div>${esc(pick.name)} · ${pick.position}${pick.mine ? " · YOU" : ""}</div></div>`,
        )
        .join("") || '<div class="muted">No picks yet.</div>';
  }

  function render() {
    if (!state.players.length) {
      renderIntelligence();
      return;
    }
    renderRecommendation();
    renderBoard();
    renderRoster();
    renderIntelligence();
    renderPicks();
    renderDraftGrid();
    if (state.activeDraftTab === "team") renderTeamRoster();
    if (state.activeDraftTab === "selections") renderSelections();
    if (state.activeDraftTab === "queue") renderQueue();
    if (state.activeDraftTab === "recommended") renderRecommended();
    bindPlayerLinks();
  }

  function draft(key) {
    if (state.picks.length >= state.teams * state.rounds) return;
    const player = state.players.find((candidate) => candidate.key === key);
    if (!player || state.picks.some((pick) => pick.key === player.key)) return;
    const pick = state.picks.length + 1;
    const team = ownerForPick(pick);
    state.picks.push(
      createSelection(
        player,
        pick,
        team,
        team === state.slot ? "user" : "manual",
      ),
    );
    state.selectedTeam = team;
    state.survivalCache.clear();
    save();
    render();
    if (state.mode === "sim" && team === state.slot)
      window.setTimeout(simulateToUser, 120);
  }

  function syncInputs() {
    ["teams", "slot", "rounds"].forEach((key) => {
      $(key).value = state[key];
    });
    $("strategy").value = state.strategy;
    $("mode").value = state.mode;
    $("variance").value = state.variance;
  }

  function start() {
    state.teams = numeric($("teams").value, 12);
    state.slot = Math.min(state.teams, numeric($("slot").value, 1));
    state.rounds = numeric($("rounds").value, 16);
    state.strategy = $("strategy").value;
    state.mode = $("mode").value;
    state.variance = $("variance").value;
    state.picks = [];
    state.survivalCache.clear();
    state.selectedTeam = state.slot;
    initProfiles();
    save();
    render();
    loadData();
    if (state.mode === "sim") simulateToUser();
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok)
      throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  }

  function liveMarketPlayers(data) {
    if (!Array.isArray(data)) return [];
    return data
      .map((value, index) => ({
        key: String(
          value.player?.sleeperId ||
            value.player?.id ||
            `${value.player?.name || "player"}-${index}`,
        ),
        name: value.player?.name || "Unknown",
        position: String(value.player?.position || "?").toUpperCase(),
        nflTeam:
          value.player?.maybeTeam ||
          value.player?.team ||
          value.player?.teamAbbreviation ||
          "",
        rank: numeric(value.overallRank || value.rank, index + 1),
        overallRank: numeric(value.overallRank || value.rank, index + 1),
        adp: numeric(value.overallRank || value.rank, index + 1),
        value: numeric(value.value, 0),
      }))
      .filter((player) => POSITIONS.includes(player.position));
  }

  function rehydratePicks() {
    const byKey = new Map(state.players.map((player) => [player.key, player]));
    const byName = new Map(
      state.players.map((player) => [D.playerKey(player), player]),
    );
    state.picks = state.picks.map((oldPick, index) => {
      const current =
        byKey.get(oldPick.key) || byName.get(D.playerKey(oldPick));
      if (!current) return normalizePick(oldPick, index + 1);
      return normalizePick(
        {
          ...current,
          pick: oldPick.pick,
          team: oldPick.team,
          source: oldPick.source,
          teamName: oldPick.teamName,
          rosterId: oldPick.rosterId,
        },
        index + 1,
      );
    });
  }

  async function loadData() {
    if (Session) updateSessionStatus(Session.STATES.LOADING_DATA);
    const token = ++state.loadToken;
    const league = state.activeLeague || DEFAULT_LEAGUE;
    const qbs = isSuperflex() ? 2 : 1;
    const ppr = numeric(league.scoring?.reception, 0.5);
    const dynasty =
      String(league.league_type || league.type || "").toLowerCase() ===
      "dynasty";
    $("source").textContent = "Loading consensus rankings and live market…";
    const [intelligenceResult, marketResult, scoutingResult, fpResult] = await Promise.allSettled([
      fetchJson(`data/draft_intelligence.json?ts=${Date.now()}`),
      fetchJson(
        `https://api.fantasycalc.com/values/current?isDynasty=${dynasty}&numQbs=${qbs}&numTeams=${state.teams}&ppr=${ppr}`,
      ),
      fetchJson(`data/scouting_signals.json?ts=${Date.now()}`),
      fetchJson(`fantasypros.json?ts=${Date.now()}`),
    ]);
    if (token !== state.loadToken) return;
    state.intelligence =
      intelligenceResult.status === "fulfilled"
        ? intelligenceResult.value
        : null;
    state.sourceHealth = SourceHealth
      ? SourceHealth.assessRuntime({
          intelligence: state.intelligence,
          marketOk: marketResult.status === "fulfilled",
          scoutingOk: scoutingResult.status === "fulfilled",
          newsOk: fpResult.status === "fulfilled",
        })
      : null;
    state.intelProfile = D.selectProfile(state.intelligence, league);
    const live =
      marketResult.status === "fulfilled"
        ? liveMarketPlayers(marketResult.value)
        : [];
    state.marketLoaded = live.length > 0;
    state.players = D.enrichPlayers(live, state.intelProfile);
    // K/DST pool integration — FantasyCalc (the primary market source)
    // does not carry K/DST at all. Merge them in from the intelligence
    // profile when the league's roster config actually starts them.
    state.players = D.mergeSupplementalPositions(
      state.players,
      state.intelProfile?.players || [],
      state.activeLeague || DEFAULT_LEAGUE,
    );
    // Merge in draft-capital and age-curve scouting signals, matched by name.
    // Fails gracefully — if scouting_signals.json hasn't been generated yet,
    // scorePlayer's neutral (50) defaults apply and nothing breaks.
    if (scoutingResult.status === "fulfilled" && scoutingResult.value?.players) {
      const scouting = scoutingResult.value.players;
      state.players.forEach((player) => {
        const match = scouting[player.name];
        if (match) {
          player.pedigreeScore = match.pedigreeScore;
          player.ageCurveScore = match.ageCurveScore;
        }
      });
    }
    // Real current news/sentiment, matched by name. Consensus top picks don't
    // need this — it's specifically for late-round evaluation, where public
    // rankings alone miss recent buzz. Fails gracefully if unavailable.
    state.newsByName = {};
    if (fpResult.status === "fulfilled" && Array.isArray(fpResult.value?.news)) {
      fpResult.value.news.forEach((item) => {
        if (item.name && !state.newsByName[item.name]) state.newsByName[item.name] = item;
      });
    }
    // Merge real projected points (fantasypros.json's projections, already
    // fetched above) into player objects, then compute pool-wide VORP once.
    // Falls back gracefully to the rank-based proxy in vbdScore() for any
    // player without a matched projection — never crashes, never blocks.
    if (fpResult.status === "fulfilled" && fpResult.value?.projections) {
      const projByName = {};
      Object.values(fpResult.value.projections).forEach((list) => {
        if (Array.isArray(list)) {
          list.forEach((row) => {
            if (row.name) projByName[row.name] = row.projected_points ?? row.points_half;
          });
        }
      });
      state.players.forEach((player) => {
        const points = projByName[player.name];
        if (points != null) player.projectedPoints = points;
      });
      const vbdContext = {
        teams: state.teams,
        league: state.activeLeague || DEFAULT_LEAGUE,
        targets: targets(),
      };
      const vbdPercentiles = D.computeVBDPercentiles(state.players, vbdContext);
      state.players.forEach((player) => {
        if (vbdPercentiles[player.key] != null) {
          player.vbdPercentileScore = vbdPercentiles[player.key];
        }
      });
    }
    rehydratePicks();
    state.survivalCache.clear();
    if (!state.players.length) {
      $("source").textContent =
        "Ranking feeds unavailable. Retry data; saved picks were preserved.";
      $("best").textContent = "Rankings unavailable";
      if (Session) updateSessionStatus(Session.STATES.ERROR, [
        intelligenceResult.status === "rejected" ? `Draft intelligence: ${intelligenceResult.reason}` : "Draft intelligence contained no usable players",
        marketResult.status === "rejected" ? `Market feed: ${marketResult.reason}` : "Market feed unavailable or empty",
      ]);
      renderIntelligence();
      return;
    }
    if (SourceHealth && state.sourceHealth) {
      const healthLabel = SourceHealth.label(state.sourceHealth);
      const profileLabel = state.intelProfile?.id || "no compatible profile";
      $("source").textContent = `${healthLabel} · ${profileLabel} · ${state.players.length} players${state.marketLoaded ? " · live market" : " · cached consensus"}`;
      $("source").title = state.sourceHealth.issues.join(" · ");
    }
    // Data restoration is complete. Persist refreshed player/source metadata and
    // leave the state machine in the truthful draft lifecycle state.
    save();
    render();
  }

  if (!D) {
    $("source").textContent = "Draft intelligence module failed to load.";
    return;
  }

  restore();
  if (!Object.keys(state.profiles || {}).length) initProfiles();
  syncInputs();
  $("league-note").textContent =
    `Active league: ${state.activeLeague.name || "custom"} · ${numeric(state.activeLeague.scoring?.reception, 0)} PPR${isSuperflex() ? " · Superflex" : ""}`;

  document.addEventListener("ffo:league-changed", (event) => {
    state.activeLeague = event.detail || DEFAULT_LEAGUE;
    $("league-note").textContent =
      `Active league: ${state.activeLeague.name || "custom"} · ${numeric(state.activeLeague.scoring?.reception, 0)} PPR${isSuperflex() ? " · Superflex" : ""}`;
    state.survivalCache.clear();
    loadData();
  });
  $("close-player-modal").onclick = closePlayer;
  $("player-modal-backdrop").onclick = (event) => {
    if (event.target === $("player-modal-backdrop")) closePlayer();
  };
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePlayer();
  });
  if ($("session-resume")) $("session-resume").onclick = () => { state.recoveredSession = false; showSessionRecovery(); render(); };
  if ($("session-retry")) $("session-retry").onclick = () => loadData();
  if ($("session-export")) $("session-export").onclick = exportSnakeSession;
  if ($("session-reset")) $("session-reset").onclick = resetSnakeSession;
  window.addEventListener("pagehide", () => save());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") save(); });
  $("start").onclick = start;
  $("advance").onclick = simulateToUser;
  $("undo").onclick = () => {
    state.picks.pop();
    state.survivalCache.clear();
    save();
    render();
  };
  $("pos").onchange = renderBoard;
  $("search").oninput = renderBoard;
  $("tab-board").onclick = () => showDraftTab("board");
  $("tab-team").onclick = () => showDraftTab("team");
  $("tab-selections").onclick = () => showDraftTab("selections");
  $("tab-queue").onclick = () => showDraftTab("queue");
  $("tab-recommended").onclick = () => showDraftTab("recommended");
  $("strategy").onchange = () => {
    state.strategy = $("strategy").value;
    state.survivalCache.clear();
    save();
    render();
  };
  $("variance").onchange = () => {
    state.variance = $("variance").value;
    state.survivalCache.clear();
    save();
    render();
  };
  window.setTimeout(() => {
    if (!state.players.length) loadData();
  }, 350);
})();
