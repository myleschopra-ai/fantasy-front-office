(function () {
  "use strict";

  const D = window.FFODraftIntelligence;
  const Session = window.FFODraftSession;
  const SourceHealth = window.FFODraftSourceHealth;
  const ProviderSync = window.FFOProviderDraftSync;
  const SleeperDraft = window.FFOSleeperDraftClient;
  const Calibration = window.FFODraftCalibration;
  const Championship = window.FFOChampionshipIntel;
  const DecisionConfidence = window.FFODecisionConfidence;
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
    modelValidation: null,
    projectionCoverage: null,
    providerSyncStatus: ProviderSync ? ProviderSync.STATUS.IDLE : "IDLE",
    providerDraftId: null,
    providerDraft: null,
    providerRetrievedAt: null,
    providerIssues: [],
    providerPoller: null,
    providerSyncInFlight: false,
    recommendationCache: null,
    recommendationError: null,
    renderPending: false,
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

  function providerLeagueId() {
    if (String(state.activeLeague?.provider || "").toLowerCase() !== "sleeper") return "";
    return String(state.activeLeague?.provider_league_id || "").trim();
  }

  function providerEligible() {
    return Boolean(ProviderSync && SleeperDraft && providerLeagueId());
  }

  function providerPlayerLookup() {
    const out = {};
    state.players.forEach((player) => {
      const ids = [player.key, player.playerId, player.sleeperId].filter(Boolean).map(String);
      ids.forEach((id) => { out[id] = player; });
    });
    return out;
  }

  function applyLocalCalibration(players) {
    if (!Calibration) return { applied: 0, samples: 0 };
    let archive = [];
    try { archive = JSON.parse(localStorage.getItem("ffo_draft_archive_v1") || "[]"); } catch (_error) { archive = []; }
    const drafts = archive.map((entry) => ({
      ...(entry.artifact?.configuration || {}),
      picks: entry.artifact?.picks || [],
    })).filter((draft) => draft.picks.length);
    const model = Calibration.snakeModel({ drafts });
    let applied = 0;
    players.forEach((player) => {
      const result = Calibration.calibratedAdp(player, model);
      if (result.applied) {
        player.marketAdp = player.adp;
        player.adp = result.adp;
        player.calibration = { samples: result.n, shift: result.shift };
        applied += 1;
      }
    });
    return { applied, samples: drafts.length };
  }

  function updateProviderSyncUi(result = null) {
    const statusEl = $("provider-sync-status");
    const button = $("provider-sync");
    const isSleeper = String(state.activeLeague?.provider || "").toLowerCase() === "sleeper";
    const live = state.mode === "live";
    if (button) button.style.display = live && isSleeper ? "" : "none";
    if (statusEl) statusEl.style.display = live && isSleeper ? "" : "none";
    if (!statusEl) return;
    const label = result && ProviderSync
      ? ProviderSync.syncLabel(result, state.providerDraft || {})
      : `${String(state.providerSyncStatus || "IDLE").replaceAll("_", " ")}`;
    statusEl.textContent = `SLEEPER ${label}`;
    statusEl.dataset.state = state.providerSyncStatus || "IDLE";
    statusEl.title = (state.providerIssues || []).join(" · ");
  }

  function stopProviderPolling() {
    if (state.providerPoller) state.providerPoller.stop();
    state.providerPoller = null;
  }

  function ensureProviderPolling({ immediate = true } = {}) {
    stopProviderPolling();
    if (state.mode !== "live" || !providerEligible()) return;
    state.providerPoller = SleeperDraft.createPoller(
      () => syncSleeperDraft({ manual: false }),
      { intervalMs: 8000, isVisible: () => document.visibilityState !== "hidden" },
    );
    state.providerPoller.start({ immediate });
  }

  function liveDraftType() {
    const format = String(state.activeLeague?.draft?.format || "snake").toLowerCase();
    return format === "auction" ? "auction" : "snake";
  }

  async function syncSleeperDraft({ manual = false } = {}) {
    if (state.mode !== "live") return null;
    if (!providerEligible()) {
      state.providerSyncStatus = ProviderSync?.STATUS.ERROR || "ERROR";
      state.providerIssues = ["Sleeper league ID is required. Use League ID / Connection to save it first."];
      updateProviderSyncUi();
      return null;
    }
    if (state.providerSyncInFlight) return null;
    state.providerSyncInFlight = true;
    state.providerSyncStatus = ProviderSync.STATUS.SYNCING;
    state.providerIssues = [];
    updateProviderSyncUi();
    try {
      const snapshot = await SleeperDraft.snapshotForLeague(providerLeagueId(), {
        season: state.activeLeague?.season,
        type: liveDraftType(),
      });
      if (!snapshot.draft) {
        state.providerSyncStatus = ProviderSync.STATUS.ERROR;
        state.providerIssues = snapshot.issues || ["No Sleeper draft found"];
        updateProviderSyncUi();
        return null;
      }
      const incomingDraftId = String(snapshot.draft.draft_id || "");
      const expectedDraftId = state.providerDraftId || incomingDraftId;
      const result = ProviderSync.reconcile({
        localPicks: state.picks,
        providerPicks: snapshot.picks,
        draft: snapshot.draft,
        expectedDraftId,
        playerLookup: providerPlayerLookup(),
      });
      state.providerDraft = snapshot.draft;
      state.providerRetrievedAt = snapshot.retrievedAt;
      state.providerSyncStatus = result.status;
      state.providerIssues = result.issues || [];
      if (result.safeToApply) {
        state.providerDraftId = incomingDraftId;
        if (result.additions.length) {
          state.picks = ProviderSync.applyReconciliation(state.picks, result).map((pick, index) => normalizePick(pick, index + 1));
          state.selectedTeam = state.picks[state.picks.length - 1]?.team || state.slot;
          state.survivalCache.clear();
          // Confirmed provider picks are canonical; remove them from queue if present.
          const confirmed = new Set(state.picks.map((pick) => String(pick.key)));
          state.queue = state.queue.filter((key) => !confirmed.has(String(key)));
          save();
          render();
        } else {
          // A reconnect may confirm an unchanged pick history. Persist the
          // provider binding and retrieval metadata even when there is no new
          // pick, otherwise a refresh can silently drop the attached draft.
          save();
        }
      }
      updateProviderSyncUi(result);
      return result;
    } catch (error) {
      state.providerSyncStatus = ProviderSync.STATUS.ERROR;
      state.providerIssues = [String(error?.message || error)];
      updateProviderSyncUi();
      if (manual) console.error(error);
      return null;
    } finally {
      state.providerSyncInFlight = false;
    }
  }

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
      providerLeagueId: providerLeagueId() || null,
      providerDraftId: state.providerDraftId || null,
      providerRetrievedAt: state.providerRetrievedAt || null,
      sourceSnapshot: {
        generated_at: state.intelligence?.generated_at || state.intelligence?.meta?.generated_at || null,
        profile: state.intelProfile?.id || null,
        health: state.sourceHealth?.level || null,
        ageHours: Number.isFinite(state.sourceHealth?.ageHours) ? Number(state.sourceHealth.ageHours.toFixed(2)) : null,
      },
      leagueSnapshot: Session ? Session.sanitize(state.activeLeague || DEFAULT_LEAGUE) : (state.activeLeague || DEFAULT_LEAGUE),
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
    updateProviderSyncUi();
  }

  function ownerForPick(pick) {
    const round = Math.floor((pick - 1) / state.teams) + 1;
    const slot = ((pick - 1) % state.teams) + 1;
    const thirdRoundReversal = Boolean(state.activeLeague?.draft?.third_round_reversal);
    const forward = thirdRoundReversal
      ? round === 1 || (round >= 4 && round % 2 === 0)
      : round % 2 === 1;
    return forward ? slot : state.teams - slot + 1;
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
      players: state.players,
      projectionCoverage: state.projectionCoverage,
      picksUntilNextTurn: team === state.slot
        ? Math.max(1, numeric(nextUserPick(picks.length), picks.length + state.teams) - (picks.length + 1))
        : state.teams,
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
    const round = Math.floor(picks.length / state.teams) + 1;
    const candidates = pool
      .slice(0, round >= 7 ? 100 : round >= 5 ? 72 : 50)
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
    // Five bounded room simulations preserve turn-risk signal without making
    // a click wait on dozens of CPU draft branches. Board rows stay analytical.
    const survives = detailed ? survival(player, 5) : approximateSurvival(player);
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
    if (isSuperflex() && player.position === "QB" && needState.state === "starter_need" && numeric(evaluation.adjustment, 0) >= 10) return "DRAFT NOW";
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

  function recommendationCacheKey() {
    const roster = state.activeLeague?.roster || {};
    const scoring = state.activeLeague?.scoring || {};
    return [state.picks.length, state.picks.at(-1)?.key || "none", state.players.length, state.slot, state.strategy, state.variance, JSON.stringify(roster), JSON.stringify(scoring)].join("|");
  }

  function recommendations() {
    const cacheKey = recommendationCacheKey();
    if (state.recommendationCache?.key === cacheKey) return state.recommendationCache.value;
    const pool = available();
    const empty = { recommended: [], bestAvailable: [], runs: [], strategyImpact: "No draftable players remain.", pairPlan: null };
    if (!pool.length) return empty;
    try {
      const shortlist = pool.slice(0, 60).map((player) => ({ ...player, ...equityFor(player, false) })).sort((a, b) => b.score - a.score || a.overallRank - b.overallRank).slice(0, 6);
      const detailed = shortlist.map((player) => ({ ...player, ...equityFor(player, true) })).sort((a, b) => b.score - a.score || a.overallRank - b.overallRank);
      const context = { ...scoreContext(detailed[0], state.slot, state.picks, 50), roomPicks: state.picks };
      const intelligence = D.recommendationBoard(detailed, context);
      const byKey = new Map(detailed.map((player) => [player.key, player]));
      const value = {
        recommended: intelligence.recommended.slice(0, 4).map((entry) => ({ ...byKey.get(entry.player.key), contextualScore: entry.contextualScore, adjustment: entry.adjustment, wwpa: entry.wwpa, run: entry.run, evidence: entry.evidence, breakout: entry.breakout, comparables: entry.comparables, scenario: entry.scenario })),
        bestAvailable: D.recommendationBoard(pool.slice(0, 60), context).bestAvailable.slice(0, 5),
        runs: intelligence.runs,
        strategyImpact: intelligence.strategyImpact,
        pairPlan: intelligence.pairPlan,
      };
      state.recommendationError = null;
      state.recommendationCache = { key: cacheKey, value };
      return value;
    } catch (error) {
      state.recommendationError = String(error?.message || error);
      const fallback = pool.slice(0, 5).map((player) => {
        const score = numeric(player.leagueValue, Math.max(1, 101 - numeric(player.overallRank, 100)));
        return { ...player, score, contextualScore: score, sv: approximateSurvival(player), confidence: numeric(player.agreement, 50), components: { market: score }, weights: { market: 1 }, evidence: { grade: "RECOVERED", score: 0, missing: [] }, comparables: [], scenario: null };
      });
      const value = { ...empty, recommended: fallback, bestAvailable: fallback.map((player) => ({ player })), strategyImpact: "Front Office recovered with a safe market and roster-fit ranking." };
      state.recommendationCache = { key: cacheKey, value };
      return value;
    }
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

  function weightedBreakdown(evaluation) {
    const labels = { market: "Market", vbd: "VBD", tier: "Tier", need: "Roster need", availability: "Urgency", scheme: "Scheme", strategy: "Strategy", pedigree: "Pedigree", ageCurve: "Age curve" };
    return Object.keys(evaluation.weights).map((key) => {
      const raw = numeric(evaluation.components[key], 50);
      const weight = numeric(evaluation.weights[key], 0);
      const points = raw * weight;
      const impact = (raw - 50) * weight;
      return `<div class="factor"><span>${esc(labels[key] || key)} · ${Math.round(weight * 100)}% weight</span><strong>${raw.toFixed(0)} × ${(weight * 100).toFixed(1)}% = ${points.toFixed(1)} pts · ${impact >= 0 ? "+" : ""}${impact.toFixed(1)} vs neutral</strong></div>`;
    }).join("");
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

  function renderModeUi() {
    const complete = state.picks.length >= state.teams * state.rounds;
    const currentTeam = complete ? null : ownerForPick(state.picks.length + 1);
    const companion = state.mode === "companion";
    const guide = $("companion-guide");
    if (guide) guide.hidden = !companion;
    if ($("companion-current")) $("companion-current").textContent = complete ? "Draft complete" : `Team ${currentTeam} on the clock · ${roundPick(state.picks.length + 1)}`;
    const advance = $("advance");
    if (advance) {
      advance.hidden = state.mode !== "sim";
      advance.disabled = state.mode !== "sim" || complete || state.renderPending;
      advance.textContent = complete ? "Draft complete" : "To My Pick";
    }
    if ($("undo")) $("undo").disabled = !state.picks.length || state.renderPending || state.mode === "live";
    document.body.dataset.draftMode = state.mode;
  }

  function scheduleDraftRender(team) {
    if (state.renderPending) return;
    state.renderPending = true;
    document.body.setAttribute("aria-busy", "true");
    if ($("clock")) $("clock").textContent = "UPDATING STRATEGY…";
    renderModeUi();
    window.requestAnimationFrame(() => {
      state.renderPending = false;
      document.body.removeAttribute("aria-busy");
      render();
      if (state.mode === "sim" && team === state.slot) window.setTimeout(simulateToUser, 80);
    });
  }
  function renderRecommendation() {
    const recommendationState = recommendations();
    const ranked = recommendationState.recommended;
    const best = ranked[0];
    const nextPick = state.picks.length + 1;
    const draftComplete = state.picks.length >= state.teams * state.rounds;
    if ($("draft-complete-panel")) $("draft-complete-panel").hidden = !draftComplete;
    if (draftComplete) {
      const completed = D.validateCompletedRoster(teamPicks(state.slot), state.activeLeague || DEFAULT_LEAGUE);
      const filled = completed.lineup.starters.filter((slot) => slot.player).length;
      const total = completed.lineup.starters.length;
      $("pick-label").textContent = "Draft complete";
      $("clock").textContent = "DRAFT COMPLETE";
      $("best").textContent = `Lineup set · ${filled}/${total} starters · ${completed.lineup.bench.length} bench`;
      const review = window.FFODraftReview?.analyze(sessionPayload(), D);
      if (review) window.FFODraftReview.archive(localStorage, sessionPayload(), review);
      if ($("draft-grade")) $("draft-grade").textContent = review?.grade || (completed.valid ? "A" : "—");
      if ($("draft-grade-score")) $("draft-grade-score").textContent = review ? `${review.gradeScore}/100 process score` : `${filled}/${total} starters filled`;
      if ($("draft-complete-title")) $("draft-complete-title").textContent = `Draft complete · ${filled}/${total} starters · ${completed.lineup.bench.length} bench`;
      if ($("draft-complete-copy")) $("draft-complete-copy").textContent = completed.valid ? "Your optimized lineup is valid. Review steals, reaches and every decision." : `Review needed: ${completed.issues.join(" · ") || "check remaining starter gaps"}.`;
      $("why").innerHTML = `${completed.valid
        ? "Optimized starting lineup is ready."
        : `Roster review: ${esc(completed.issues.join(" · ") || "check remaining starter gaps")}.`} <a href="draft-review.html">Open post-draft review &amp; replay</a>`;
      return;
    }
    $("pick-label").textContent =
      `${roundPick(nextPick)} · Team ${ownerForPick(nextPick)}`;
    $("clock").textContent = ownerForPick(nextPick) === state.slot
      ? "YOU ARE ON THE CLOCK"
      : `TEAM ${ownerForPick(nextPick)} ON THE CLOCK`;
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
    const wwpa = best.wwpa;
    const comparable = best.comparables?.[0];
    const decisionCard = DecisionConfidence ? DecisionConfidence.snakeCard({
      player: best,
      evaluation: best,
      sourceHealth: state.sourceHealth,
      projectionCoverage: state.projectionCoverage,
      validation: state.modelValidation,
      comparable,
      scenario: best.scenario,
    }) : null;
    $("equity").textContent = wwpa ? `${wwpa.winRateAfter.toFixed(1)}%` : (best.contextualScore ?? best.score);
    if ($("wwpa")) $("wwpa").textContent = wwpa ? `${wwpa.deltaPercentagePoints >= 0 ? "+" : ""}${wwpa.deltaPercentagePoints.toFixed(1)} pp` : "—";
    if ($("win-range")) $("win-range").textContent = decisionCard ? `${decisionCard.range.low.toFixed(1)}–${decisionCard.range.high.toFixed(1)}%` : "—";
    if ($("team-ppg")) $("team-ppg").textContent = wwpa ? wwpa.after.teamMean.toFixed(1) : "—";
    if ($("weekly-edge")) $("weekly-edge").textContent = wwpa ? `${wwpa.after.weeklyEdge >= 0 ? "+" : ""}${wwpa.after.weeklyEdge.toFixed(1)}` : "—";
    if ($("expected-record")) $("expected-record").textContent = wwpa ? `${wwpa.after.expectedWins.toFixed(1)}–${wwpa.after.expectedLosses.toFixed(1)}` : "—";
    if ($("draft-fit")) $("draft-fit").textContent = best.contextualScore ?? best.score;
    if ($("decision-confidence")) $("decision-confidence").textContent = decisionCard ? `${decisionCard.trust.label} ${decisionCard.trust.score}` : "—";
    $("delta").textContent = formatSigned(marketDelta(best));
    $("ceiling").textContent = `T${numeric(best.tier, 99)}`;
    $("breakout").textContent = `${Math.round(numeric(best.agreement, 50))}%`;
    $("bust").textContent = `${best.confidence}%`;
    $("survive").textContent = `${best.sv}%`;
    if ($("evidence")) $("evidence").textContent = `${best.evidence?.grade || "—"} · ${best.evidence?.score || 0}%`;
    $("why").textContent =
      `${actionFor(best, best)} · ${needLabel(best)} — ${needReason(best)}. ${wwpa ? `${wwpa.explanation} Expected weekly win rate moves from ${wwpa.winRateBefore.toFixed(1)}% to ${wwpa.winRateAfter.toFixed(1)}% (${wwpa.deltaPercentagePoints >= 0 ? "+" : ""}${wwpa.deltaPercentagePoints.toFixed(1)} pp WWPA; ${wwpa.model.toLowerCase()} inputs).` : ""} ${componentSummary(best)}. ${best.vegasComparison?.available ? `${best.vegasComparison.label}: ${best.vegasComparison.delta >= 0 ? "+" : ""}${best.vegasComparison.delta} projected points versus the fantasy model (${best.vegasComparison.books} book${best.vegasComparison.books===1?"":"s"}).` : "No complete, fresh Vegas total is available for this player."} ${best.evidence?.productionReady ? `${best.breakout?.label || "Production profile modeled"}.` : `Evidence ${best.evidence?.grade || "insufficient"}; missing ${best.evidence?.missing?.slice(0,2).join(" + ") || "production inputs"}, so no speculative breakout boost is applied.`} ${directive.directive}`;
    if ($("decision-trust") && decisionCard) {
      const reasons = decisionCard.trust.reasons.length ? decisionCard.trust.reasons.slice(0, 2).join(" · ") : "fresh complete evidence";
      $("decision-trust").innerHTML = `<strong>MODEL CHECK</strong><span class="trust-chip ${decisionCard.trust.label.toLowerCase().replace(/\s+/g, "-")}">${esc(decisionCard.trust.label)} ${decisionCard.trust.score}/100</span><span>${esc(decisionCard.proof)}</span><span>${esc(reasons)}</span>`;
    }
    if ($("room-impact")) $("room-impact").textContent = recommendationState.strategyImpact;
    if ($("decision-now")) $("decision-now").innerHTML = `<strong>${esc(best.scenario?.decision || actionFor(best, best))}</strong><span>${esc(best.scenario?.whyNow || needReason(best))}</span>`;
    if ($("decision-wait")) $("decision-wait").innerHTML = `<strong>${best.scenario?.expectedWaitLoss || 0} value at risk</strong><span>${esc(best.scenario?.whyWait || "No reliable fallback comparison available.")}</span>`;
    if ($("upside-case")) {
      const option = best.scenario?.optionValue;
      $("upside-case").innerHTML = option
        ? `<strong>${esc(option.label)} · ${option.score}/100</strong><span>${esc(option.drivers.map((driver) => `${driver.label} ${driver.value}`).join(" · "))} · ${option.confidence}% evidence confidence</span>`
        : `<strong>Foundation pick</strong><span>Prioritizing bankable value and lineup advantage.</span>`;
    }
    if ($("next-comparable")) $("next-comparable").innerHTML = comparable
      ? `<strong>${esc(comparable.player.name)} · ${comparable.player.position}</strong><span>${comparable.sameTier ? `Same tier · ${comparable.valueDrop}-point format-value drop` : `Next tier · ${comparable.valueDrop}-point format-value drop`} · market window ${comparable.adpGap >= 0 ? "+" : ""}${comparable.adpGap} picks</span>`
      : `<strong>No close positional substitute</strong><span>This is the last comparable option in the visible pool.</span>`;
    if ($("market-best")) $("market-best").innerHTML = recommendationState.bestAvailable
      .slice(0, 4)
      .map((entry, index) => `<div><b>${index + 1}. ${esc(entry.player.name)}</b><span>${entry.player.position} · ADP ${numeric(entry.player.adp ?? entry.player.overallRank ?? entry.player.rank, "—")}</span></div>`)
      .join("");
    $("alts").innerHTML = ranked
      .slice(1)
      .map(
        (player, index) =>
          `<div class="row compact-rec"><div class="player-link" data-player="${esc(player.key)}" tabindex="0"><div class="name">${index === 0 ? "Next" : index === 1 ? "Structural" : "Value"}: ${esc(player.name)} · ${player.position}</div><div class="icons">${rankIcons(player, player)}<span class="icon">⏳ ${player.sv}%</span></div></div><span class="score">${player.wwpa ? `${player.wwpa.winRateAfter.toFixed(1)}%` : player.score}</span></div>`,
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
    const outlook = D.expectedWeeklyTeamOutlook(
      teamPicks(state.slot),
      scoreContext(null, state.slot, state.picks, 50),
    );
    $("profile").innerHTML =
      `Projected team: <strong>${outlook.teamMean.toFixed(1)} PPG · ${outlook.winRate.toFixed(1)}% weekly win rate · ${outlook.expectedWins.toFixed(1)}–${outlook.expectedLosses.toFixed(1)}</strong><br>Starter gaps: <strong>${openSlots.length ? openSlots.join(", ") : "none"}</strong><br>Current plan: <strong>${esc(directive.directive)}</strong>${directive.warning ? `<br><span class="confidence-low">Guardrail: ${esc(directive.warning)}</span>` : ""}`;
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
            ${metric("Win rate after", evaluation.wwpa ? `${evaluation.wwpa.winRateAfter.toFixed(1)}%` : "—")}
            ${metric("WWPA", evaluation.wwpa ? `${evaluation.wwpa.deltaPercentagePoints >= 0 ? "+" : ""}${evaluation.wwpa.deltaPercentagePoints.toFixed(1)} pp` : "—")}
            ${metric("Player Grade", evaluation.playerGrade)}
            ${metric("Pick Utility", evaluation.pickUtility)}
          </div>
          <div class="detail-line" style="margin-top:6px;">Player Grade = stable quality, never changes from your own roster. Pick Utility = should you draft him <em>right now</em>, given your roster and this moment.</div>
          <div class="notice" style="margin-top:8px">Expected weekly H2H win rate is the outcome objective. Draft Fit ${evaluation.pickUtility}/100 combines its bounded WWPA lift with market, VORP, tier, roster, wait-risk and strategy guardrails; “vs neutral” below explains the supporting inputs.</div>
          <div class="metric-grid" style="grid-template-columns:repeat(2,1fr);">${weightedBreakdown(evaluation)}</div>
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
        const owner = displayTeam;
        const firstPick = (round - 1) * state.teams + 1;
        let pickNumber = firstPick;
        for (let candidate = firstPick; candidate < firstPick + state.teams; candidate += 1) {
          if (ownerForPick(candidate) === owner) {
            pickNumber = candidate;
            break;
          }
        }
        const selection = byPick.get(pickNumber);
        const active = pickNumber === state.picks.length + 1;
        html += `<div class="draft-cell ${active ? "active" : ""} ${owner === state.slot ? "mine" : ""}" data-team="${owner}"><div class="pickno">${roundPick(pickNumber)} · Team ${owner}</div>${selection ? `<div class="pickname">${esc(selection.name)}</div><div class="pickmeta">${esc(selection.position)}${selection.nflTeam ? ` · ${esc(selection.nflTeam)}` : ""}</div><div class="sim-badge">MOCK ADDITION</div>` : `<div class="empty-pick">${active ? "ON THE CLOCK" : "Available"}</div>`}</div>`;
      }
    }
    html += "</div>";
    $("draft-grid").innerHTML = html;
    const draftComplete = state.picks.length >= state.teams * state.rounds;
    $("board-summary").textContent = draftComplete
      ? `${state.picks.length} of ${state.teams * state.rounds} selections · Draft complete`
      : `${state.picks.length} of ${state.teams * state.rounds} selections · Team ${ownerForPick(state.picks.length + 1)} on the clock`;
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
    const slotColor = (slot) => ({ QB:"var(--ffo-qb,#ef4444)",RB:"var(--ffo-rb,#22c55e)",WR:"var(--ffo-wr,#3b82f6)",TE:"var(--ffo-te,#f59e0b)",FLEX:"var(--ffo-info,#4ca6ff)",SUPER_FLEX:"var(--ffo-accent,#7c5cfc)",K:"var(--ffo-k,#a855f7)",DEF:"var(--ffo-dst,#64748b)",DST:"var(--ffo-dst,#64748b)" }[String(slot).replace(/\d+$/,"")] || "var(--ffo-border-strong,#3a4962)");
    const slotRow = (slotName, pick) => pick
      ? `<div class="ffo2-lineup-card" style="--slot-color:${slotColor(slotName)}"><span class="ffo2-slot">${esc(slotName)}</span><div class="player-link" data-player="${esc(pick.key)}" tabindex="0" style="cursor:pointer;min-width:0"><div class="ffo2-player-name">${esc(pick.name)}</div><div class="ffo2-player-meta">${esc(pick.position)}${pick.nflTeam ? ` · ${esc(pick.nflTeam)}` : ""} · drafted ${roundPick(pick.pick)}</div></div><span class="sim-badge">MOCK</span></div>`
      : `<div class="ffo2-lineup-card empty" style="--slot-color:${slotColor(slotName)}"><span class="ffo2-slot">${esc(slotName)}</span><div><div class="ffo2-player-name">Open starter slot</div><div class="ffo2-player-meta">No eligible player drafted</div></div></div>`;

    let html = `<div class="toolbar" style="margin-top:10px"><strong>Team ${team}${team === state.slot ? " · YOU" : ""}</strong><select id="team-select" style="width:auto">${Array.from({ length: state.teams }, (_value, index) => `<option value="${index + 1}" ${team === index + 1 ? "selected" : ""}>Team ${index + 1}${state.slot === index + 1 ? " · YOU" : ""}</option>`).join("")}</select></div>`;
    const starterRows = lineup.starters.map((entry) => {
      occurrence[entry.slot] = (occurrence[entry.slot] || 0) + 1;
      const total = lineup.starters.filter((s) => s.slot === entry.slot).length;
      const label = total > 1 ? `${entry.slot}${occurrence[entry.slot]}` : entry.slot;
      return slotRow(label, entry.player);
    }).join("");
    html += `<div class="ffo2-section-head" style="margin-top:14px"><strong>Starting lineup</strong><span>${lineup.starters.filter(entry => entry.player).length}/${lineup.starters.length} filled</span></div><div class="ffo2-lineup-board">${starterRows || '<div class="muted">No starter slots configured.</div>'}</div>`;
    html += `<section class="ffo2-bench-section"><div class="ffo2-section-head"><strong>Bench and reserves <span class="meta">· BENCH</span></strong><span>${lineup.bench.length} drafted · position-aware depth</span></div><div class="ffo2-bench-grid">${lineup.bench.map((pick) => `<div class="ffo2-bench-card player-link" data-player="${esc(pick.key)}" tabindex="0" style="cursor:pointer"><strong>${esc(pick.name)}</strong><span>${esc(pick.position)}${pick.nflTeam ? ` · ${esc(pick.nflTeam)}` : ""} · drafted ${roundPick(pick.pick)}</span></div>`).join("") || '<div class="muted">Bench empty.</div>'}</div></section>`;
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
    renderDesktopQueue();
  }

  function actionClass(actionText) {
    if (actionText === "DRAFT NOW") return "urgent";
    if (actionText === "TIER CLOSING") return "closing";
    if (actionText === "WAIT") return "wait";
    if (actionText === "AVOID AT COST") return "avoid";
    return "target";
  }

  function vegasBadge(player) {
    const signal=player.vegasComparison;
    if(!signal?.available)return "";
    const delta=`${signal.delta>=0?"+":""}${signal.delta}`;
    return `<span class="vegas-badge vegas-${esc(signal.tone)}" title="Vegas implied ${delta} points versus fantasy projection · ${signal.books} book(s) · ${Math.round(signal.agreement*100)}% line agreement · ${Math.round(signal.marketCoverage*100)}% required-market coverage">${esc(signal.label)} · ${delta}</span>`;
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
      const diamond = evaluation.lateRound;
      const evidenceNote = evaluation.evidence ? `<div class="detail-line" style="color:${evaluation.evidence.score>=55?'#67e8f9':'#fbbf24'};">Evidence ${evaluation.evidence.grade} · ${evaluation.evidence.score}%${evaluation.breakout?.reliable?` · ${evaluation.breakout.label}`:` · missing ${evaluation.evidence.missing.slice(0,2).join(' + ')}`}</div>` : "";
      const diamondNote = diamond?.label === "DIAMOND"
        ? `<div class="detail-line" style="color:#fbbf24;">◆ Diamond ${diamond.score}/100 · ${diamond.confidence}% confidence</div>`
        : diamond?.label === "WATCH"
          ? `<div class="detail-line" style="color:#67e8f9;">Late watch ${diamond.score}/100 · ${diamond.confidence}% confidence</div>`
          : "";
      sleeperBlock = evidenceNote + diamondNote + valueNote + newsNote;
    }
    const overallRank = numeric(player.overallRank, player.rank);
    const adp = numeric(player.adp, overallRank).toFixed(1);
    const tier = numeric(player.tier, 99);
    return `<div class="row compact-rec player-row pos-${String(player.position).toLowerCase()}">
      <button class="icon queue-toggle ${queued ? "queued" : ""}" data-queue-k="${esc(player.key)}" title="${queued ? "Remove from" : "Add to"} queue" aria-label="${queued ? "Remove" : "Add"} ${esc(player.name)} ${queued ? "from" : "to"} queue" aria-pressed="${queued}">★</button>
      <div class="player-link player-main" data-player="${esc(player.key)}" tabindex="0">
        <div class="player-primary">
          <span class="pos-pill pos-${String(player.position).toLowerCase()}">${esc(player.position)}</span>
          <span class="name">${esc(player.name)}</span>
          <span class="meta">${player.nflTeam ? esc(player.nflTeam) : "FA"}</span>
        </div>
        <div class="player-signals"><span class="action-badge ${actionClass(action)}">${action}</span><span class="action-badge ${needStateClass(needState)}">${esc(needState.label)}</span>${vegasBadge(player)}${evaluation.wwpa ? `<span class="wwpa-badge" title="Expected weekly matchup win probability added">${evaluation.wwpa.deltaPercentagePoints >= 0 ? "+" : ""}${evaluation.wwpa.deltaPercentagePoints.toFixed(1)} pp WWPA</span>` : ""}<span class="detail-line">${evaluation.wwpa ? `${evaluation.wwpa.winRateAfter.toFixed(1)}% win rate · ` : ""}Score ${evaluation.score} · VBD ${Math.round(evaluation.components.vbd)} · ${scarcity.sameTier} left${cliff}</span></div>
        ${sleeperBlock}
      </div>
      <span class="player-stat"><small>Rank</small>${overallRank}</span>
      <span class="player-stat"><small>ADP</small>${adp}</span>
      <span class="player-stat"><small>Tier</small>${tier}</span>
      <span class="player-stat"><small>Survives</small>${evaluation.sv}%</span>
      <button class="btn secondary draft-player" data-k="${esc(player.key)}">Draft</button>
    </div>`;
  }

  function renderDesktopQueue() {
    const target = $("desktop-queue");
    const count = $("queue-count");
    if (!target) return;
    const entries = state.queue
      .map((key) => state.players.find((player) => player.key === key))
      .filter(Boolean)
      .filter((player) => !state.picks.some((pick) => pick.key === player.key));
    if (count) count.textContent = `${entries.length} player${entries.length === 1 ? "" : "s"}`;
    target.innerHTML = entries.length
      ? entries.map((player, index) => `<div class="queue-rail-row"><span class="queue-rail-rank">${index + 1}</span><div><div class="queue-rail-name player-link" data-player="${esc(player.key)}" tabindex="0">${esc(player.name)}</div><div class="queue-rail-meta">${esc(player.position)}${player.nflTeam ? ` · ${esc(player.nflTeam)}` : ""} · ADP ${numeric(player.adp, player.overallRank).toFixed(1)}</div></div><button class="queue-remove" data-queue-k="${esc(player.key)}" aria-label="Remove ${esc(player.name)} from queue" title="Remove from queue">★</button></div>`).join("")
      : '<div class="queue-empty">Star a player to build your queue.</div>';
    target.querySelectorAll("[data-queue-k]").forEach((button) => { button.onclick = () => toggleQueue(button.dataset.queueK); });
    bindPlayerLinks();
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

  function renderSourceHealth() {
    if (!SourceHealth || !state.sourceHealth || !$("source")) return;
    const healthLabel = SourceHealth.label(state.sourceHealth);
    const profileLabel = state.intelProfile?.id || "no compatible profile";
    const projectionLabel = state.projectionCoverage?.complete
      ? `complete projections (${state.projectionCoverage.directPlayers})`
      : `projection fallback (${state.projectionCoverage?.directPlayers || 0}/${state.projectionCoverage?.poolPlayers || state.players.length})`;
    $("source").textContent = `${healthLabel} · ${profileLabel} · ${state.players.length} players · ${projectionLabel}${state.marketLoaded ? " · live market" : " · cached consensus"}`;
    const projectionIssues = state.projectionCoverage?.complete
      ? []
      : Object.entries(state.projectionCoverage?.byPosition || {})
          .filter(([, row]) => !row.complete)
          .map(([position, row]) => `${position} projections ${row.direct}/${row.required}`);
    $("source").title = [...state.sourceHealth.issues, ...projectionIssues].join(" · ");
  }

  function renderDraftContext() {
    const target = $("draft-context");
    if (!target) return;
    const league = state.activeLeague || DEFAULT_LEAGUE;
    const roster = league.roster || {};
    const validation = D.validateCompletedRoster(teamPicks(state.slot), league);
    const openSlots = validation.lineup.starters.filter((entry) => !entry.player).map((entry) => entry.slot.replace("SUPER_FLEX", "SFLEX"));
    const round = Math.min(state.rounds, Math.floor(state.picks.length / state.teams) + 1);
    const complete = state.picks.length >= state.teams * state.rounds;
    const upcoming = complete ? null : nextUserPick(state.picks.length);
    const picksAway = Math.max(0, numeric(upcoming, state.picks.length + 1) - state.picks.length - 1);
    const format = roster.SUPER_FLEX ? "SUPERFLEX" : numeric(roster.QB, 1) > 1 ? "2QB" : numeric(roster.WR, 2) >= 3 ? "3WR" : "1QB";
    const ppr = numeric(league.scoring?.reception, 0);
    const pprLabel = ppr === 1 ? "FULL PPR" : ppr === 0.5 ? "HALF PPR" : ppr === 0 ? "STANDARD" : `${ppr} PPR`;
    const nextLabel = complete ? "DRAFT COMPLETE" : picksAway === 0 ? "ON THE CLOCK" : `${picksAway} PICK${picksAway === 1 ? "" : "S"} AWAY`;
    target.innerHTML = `<div><span>FORMAT</span><strong>${state.teams}-TEAM · ${format}</strong><small>${pprLabel}${numeric(league.scoring?.te_premium, 0) ? ` · +${numeric(league.scoring.te_premium, 0)} TEP` : ""}</small></div><div><span>DRAFT PHASE</span><strong>ROUND ${round} OF ${state.rounds}</strong><small>${state.picks.length} selections made</small></div><div class="${!complete && picksAway === 0 ? "is-live" : complete ? "is-complete" : ""}"><span>NEXT TURN</span><strong>${nextLabel}</strong><small>${upcoming ? roundPick(upcoming) : "Draft complete"}</small></div><div><span>LINEUP PLAN</span><strong>${openSlots.length ? `${openSlots.length} STARTER${openSlots.length === 1 ? "" : "S"} OPEN` : "STARTERS SET"}</strong><small>${openSlots.length ? openSlots.slice(0, 4).join(" · ") : "Build high-upside depth"}</small></div>`;
    target.classList.toggle("is-recovered", Boolean(state.recommendationError));
    target.title = state.recommendationError ? `Recommendation recovery active: ${state.recommendationError}` : "Live league, turn and roster context";
  }
  function render() {
    if (!state.players.length) {
      renderIntelligence();
      return;
    }
    renderModeUi();
    renderRecommendation();
    renderDraftContext();
    renderBoard();
    renderRoster();
    renderIntelligence();
    renderPicks();
    renderDesktopQueue();
    renderDraftGrid();
    if (state.activeDraftTab === "team") renderTeamRoster();
    if (state.activeDraftTab === "selections") renderSelections();
    if (state.activeDraftTab === "queue") renderQueue();
    if (state.activeDraftTab === "recommended") renderRecommended();
    bindPlayerLinks();
    renderSourceHealth();
  }

  function draft(key) {
    if (state.mode === "live") {
      state.providerSyncStatus = ProviderSync?.STATUS.LOCAL_AHEAD || "LOCAL_AHEAD";
      state.providerIssues = ["Live mode records confirmed Sleeper selections only. Queue the player or wait for provider confirmation."];
      updateProviderSyncUi();
      return;
    }
    if (state.picks.length >= state.teams * state.rounds) return;
    const player = state.players.find((candidate) => candidate.key === key);
    if (!player || state.picks.some((pick) => pick.key === player.key)) return;
    const pick = state.picks.length + 1;
    const team = ownerForPick(pick);
    const selection = createSelection(
        player,
        pick,
        team,
        team === state.slot ? "user" : "manual",
      );
    if (team === state.slot) {
      const ranked = recommendations();
      const selected = equityFor(player, false);
      const recommended = ranked.recommended?.[0] || selected;
      selection.decision = {
        capturedAt: new Date().toISOString(),
        recommendedKey: recommended.key || player.key,
        recommendedName: recommended.name || player.name,
        recommendedUtility: numeric(recommended.pickUtility, recommended.score),
        selectedUtility: numeric(selected.pickUtility, selected.score),
        selectedComponents: selected.components,
        selectedWeights: selected.weights,
        context: { pick, round: selection.round, strategy: state.strategy, rosterBefore: teamPicks(state.slot).map((p) => p.key) },
      };
    }
    state.picks.push(selection);
    state.selectedTeam = team;
    state.survivalCache.clear();
    save();
    scheduleDraftRender(team);
  }

  function syncInputs() {
    ["teams", "slot", "rounds"].forEach((key) => {
      $(key).value = state[key];
    });
    $("strategy").value = state.strategy;
    $("mode").value = state.mode;
    $("variance").value = state.variance;
    syncLeagueInputs();
  }

  const LEAGUE_PRESETS = {
    standard: { QB:1,RB:2,WR:2,TE:1,FLEX:2,SUPER_FLEX:0,WRRB_FLEX:0,REC_FLEX:0,K:1,DST:1,BENCH:6,ppr:.5,tep:0 },
    superflex: { QB:1,RB:2,WR:2,TE:1,FLEX:2,SUPER_FLEX:1,WRRB_FLEX:0,REC_FLEX:0,K:1,DST:1,BENCH:5,ppr:.5,tep:0 },
    twoqb: { QB:2,RB:2,WR:2,TE:1,FLEX:1,SUPER_FLEX:0,WRRB_FLEX:0,REC_FLEX:0,K:1,DST:1,BENCH:5,ppr:.5,tep:0 },
    threewr: { QB:1,RB:2,WR:3,TE:1,FLEX:2,SUPER_FLEX:0,WRRB_FLEX:0,REC_FLEX:0,K:1,DST:1,BENCH:6,ppr:.5,tep:0 },
    tep: { QB:1,RB:2,WR:2,TE:1,FLEX:2,SUPER_FLEX:0,WRRB_FLEX:0,REC_FLEX:0,K:1,DST:1,BENCH:6,ppr:1,tep:.5 },
  };
  const ROSTER_INPUTS = { QB:"setupQB",RB:"setupRB",WR:"setupWR",TE:"setupTE",FLEX:"setupFLEX",SUPER_FLEX:"setupSF",WRRB_FLEX:"setupRBWR",REC_FLEX:"setupWRTE",K:"setupK",DST:"setupDST",BENCH:"setupBENCH" };

  function setupRoster() {
    return Object.fromEntries(Object.entries(ROSTER_INPUTS).map(([position,id]) => [position, Math.max(0, numeric($(id)?.value, 0))]));
  }

  function updateLineupPreview() {
    const roster = setupRoster(), slots = [];
    Object.entries(roster).forEach(([position,count]) => {
      const label = position === "SUPER_FLEX" ? "SFLEX" : position === "WRRB_FLEX" ? "RB/WR" : position === "REC_FLEX" ? "WR/TE" : position;
      for (let index=0; index<count; index+=1) slots.push(label);
    });
    if ($("lineup-preview")) $("lineup-preview").textContent = slots.length ? slots.join(" · ") : "Add at least one roster slot.";
    const rounds = Object.values(roster).reduce((sum,count)=>sum+count,0);
    if ($("rounds")) $("rounds").value = Math.max(1, rounds);
  }

  function syncLeagueInputs() {
    const league = state.activeLeague || DEFAULT_LEAGUE, roster = league.roster || {};
    Object.entries(ROSTER_INPUTS).forEach(([position,id]) => { if ($(id)) $(id).value = Math.max(0, numeric(roster[position], position === "BENCH" ? 6 : 0)); });
    if ($("setupPPR")) $("setupPPR").value = String(numeric(league.scoring?.reception, .5));
    if ($("setupTEP")) $("setupTEP").value = String(numeric(league.scoring?.te_premium ?? league.scoring?.tePremium, 0));
    if ($("setupPassTD")) $("setupPassTD").value = String(numeric(league.scoring?.pass_td ?? league.scoring?.passing_td, 4));
    if ($("setup3RR")) $("setup3RR").value = league.draft?.third_round_reversal ? "1" : "0";
    updateLineupPreview();
  }

  function applyPreset(name) {
    const preset = LEAGUE_PRESETS[name];
    if (!preset) return;
    Object.entries(ROSTER_INPUTS).forEach(([position,id]) => { $(id).value = preset[position]; });
    $("setupPPR").value = String(preset.ppr); $("setupTEP").value = String(preset.tep); $("setupPassTD").value = "4";
    if ((name === "superflex" || name === "twoqb") && $("strategy").value === "adaptive") $("strategy").value = "early-qb";
    document.querySelectorAll("[data-draft-preset]").forEach((button)=>button.classList.toggle("active",button.dataset.draftPreset===name));
    updateLineupPreview();
  }

  function validateLeagueSetup() {
    const teams = numeric($("teams")?.value, 12);
    const slot = numeric($("slot")?.value, 1);
    const roster = setupRoster();
    const starters = Object.entries(roster).filter(([position]) => position !== "BENCH").reduce((sum, [, count]) => sum + count, 0);
    const rounds = Object.values(roster).reduce((sum, count) => sum + count, 0);
    let message = "";
    if (teams < 4 || teams > 20) message = "Choose between 4 and 20 teams.";
    else if (slot < 1 || slot > teams) message = `Your draft slot must be between 1 and ${teams}.`;
    else if (starters < 1) message = "Add at least one starting-lineup slot.";
    else if (rounds < 2 || rounds > 30) message = "Build a roster between 2 and 30 total rounds.";
    else if (state.players.length && teams * rounds > state.players.length) message = `${teams} teams × ${rounds} rounds needs ${teams * rounds} players, but this player pool contains ${state.players.length}. Reduce teams or roster size.`;
    const error = $("setup-error");
    if (error) {
      error.textContent = message;
      error.hidden = !message;
    }
    return !message;
  }
  function applyLeagueSettings() {
    const roster = setupRoster(), previous = state.activeLeague || DEFAULT_LEAGUE;
    state.activeLeague = {
      ...previous,
      name: `Custom ${numeric($("teams").value,12)}-team ${roster.SUPER_FLEX ? "Superflex" : roster.QB > 1 ? "2QB" : "1QB"}`,
      teams: numeric($("teams").value,12),
      roster,
      scoring: { ...(previous.scoring || {}), reception:numeric($("setupPPR").value,.5), pass_td:numeric($("setupPassTD").value,4), te_premium:numeric($("setupTEP").value,0) },
      draft: { ...(previous.draft || {}), format:"snake", third_round_reversal:$("setup3RR").value === "1" },
    };
    state.rounds = Math.max(1,Object.values(roster).reduce((sum,count)=>sum+count,0));
    $("rounds").value = state.rounds;
    $("league-note").textContent = `Custom lineup · ${state.rounds} rounds · ${numeric(state.activeLeague.scoring.reception,0)} PPR · ${numeric(state.activeLeague.scoring.pass_td,4)}-point pass TD${roster.SUPER_FLEX ? " · Superflex" : roster.QB > 1 ? " · 2QB" : ""}${state.activeLeague.draft.third_round_reversal ? " · 3RR" : ""}`;
  }

  function start() {
    if (!validateLeagueSetup()) return;
    applyLeagueSettings();
    if ($("draft-type")?.value === "auction") {
      const handoff = {
        league: state.activeLeague,
        teams: numeric($("teams").value, 12),
        strategy: $("strategy").value,
        createdAt: new Date().toISOString(),
      };
      localStorage.setItem("ffo_mock_draft_handoff_v1", JSON.stringify(handoff));
      window.location.assign("auction.html?from=mock-draft");
      return;
    }
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
    state.providerDraftId = null;
    state.providerDraft = null;
    state.providerRetrievedAt = null;
    state.providerIssues = [];
    state.providerSyncStatus = ProviderSync ? ProviderSync.STATUS.IDLE : "IDLE";
    render();
    loadData().then(() => {
      updateProviderSyncUi();
      if (state.mode === "live") {
        syncSleeperDraft({ manual: true }).then(() => ensureProviderPolling({ immediate: false }));
      }
    });
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

  function attachVegasComparisons(snapshot) {
    if (!Championship || !Array.isArray(snapshot?.markets)) return 0;
    const leaguePpr=numeric(state.activeLeague?.scoring?.reception,.5), key=leaguePpr>=.75?"ppr_1":leaguePpr>=.25?"ppr_0_5":"ppr_0";
    const byName=new Map(snapshot.markets.map((row)=>[D.normalizeName(row.player_name||row.player_key),row]));
    let covered=0;
    state.players.forEach((player)=>{
      const row=byName.get(D.normalizeName(player.name));
      const coverage=row?.market_coverage?.score ?? (row?.total_ready ? 1 : 0);
      const comparison=Championship.vegasComparison({modelPoints:numeric(player.projectedPoints,null),vegasPoints:numeric(row?.implied_fantasy_points?.[key],null),books:numeric(row?.books,0),agreement:numeric(row?.agreement,.45),freshness_hours:numeric(row?.freshness_hours,Infinity),totalReady:Boolean(row?.total_ready||row?.market_coverage?.total_ready),marketCoverage:numeric(coverage,0),movementPoints:numeric(row?.fantasy_point_movement?.[key],0)});
      if(comparison.available){player.vegasComparison=comparison;player.vegasMarket=row;covered+=1}else delete player.vegasComparison;
    });
    return covered;
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
    const [intelligenceResult, marketResult, scoutingResult, fpResult, vegasResult, validationResult] = await Promise.allSettled([
      fetchJson(`data/draft_intelligence.json?ts=${Date.now()}`),
      fetchJson(
        `https://api.fantasycalc.com/values/current?isDynasty=${dynasty}&numQbs=${qbs}&numTeams=${state.teams}&ppr=${ppr}`,
      ),
      fetchJson(`data/scouting_signals.json?ts=${Date.now()}`),
      fetchJson(`fantasypros.json?ts=${Date.now()}`),
      fetchJson(`data/vegas/consensus.json?ts=${Date.now()}`),
      fetchJson(`data/model_validation.json?ts=${Date.now()}`),
    ]);
    if (token !== state.loadToken) return;
    state.intelligence =
      intelligenceResult.status === "fulfilled"
        ? intelligenceResult.value
        : null;
    state.modelValidation = validationResult.status === "fulfilled" ? validationResult.value : null;
    state.sourceHealth = SourceHealth
      ? SourceHealth.assessRuntime({
          intelligence: state.intelligence,
          marketOk: marketResult.status === "fulfilled",
          scoutingOk: scoutingResult.status === "fulfilled" && Object.keys(scoutingResult.value?.players || {}).length > 0,
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
    state.calibration = applyLocalCalibration(state.players);
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
    // Merge direct season projections, then activate projected-point VORP
    // only if the complete draftable-player contract passes. A top-10 sample
    // is useful evidence for those players but is never allowed to masquerade
    // as a complete cross-position valuation feed.
    if (fpResult.status === "fulfilled" && fpResult.value?.projections) {
      const projByName = {};
      Object.entries(fpResult.value.projections).forEach(([position, list]) => {
        if (Array.isArray(list)) {
          list.forEach((row) => {
            if (row.name) projByName[`${D.normalizeName(row.name)}|${String(row.position || position).toUpperCase()}`] = row;
          });
        }
      });
      state.players.forEach((player) => {
        const row = projByName[`${D.normalizeName(player.name)}|${player.position}`];
        const points = row?.projected_points ?? row?.points_half;
        if (points != null) {
          player.projectedPoints = points;
          player.projectionSource = "fantasypros_api";
          player.projectionConfidence = 95;
          player.projectionStats = row.stats || null;
          const snapshotScoring = String(fpResult.value.scoring || "HALF").toUpperCase();
          player.projectionPpr = snapshotScoring === "PPR" ? 1 : snapshotScoring === "HALF" ? 0.5 : 0;
        }
      });
    }
    state.players.forEach((player) => {
      if (numeric(player.projectedPoints, null) == null) return;
      player.rawProjectedPoints = numeric(player.rawProjectedPoints, player.projectedPoints);
      player.projectedPoints = D.leagueAdjustedProjectedPoints(
        player,
        state.activeLeague || DEFAULT_LEAGUE,
      );
    });
    state.vegasCovered = attachVegasComparisons(vegasResult.status === "fulfilled" ? vegasResult.value : null);
    const vbdContext = {
      teams: state.teams,
      league: state.activeLeague || DEFAULT_LEAGUE,
      targets: targets(),
    };
    state.projectionCoverage = D.projectionCoverageContract(state.players, vbdContext);
    if (state.projectionCoverage.complete) {
      const vbdPercentiles = D.computeVBDPercentiles(state.players, vbdContext);
      state.players.forEach((player) => {
        if (vbdPercentiles[player.key] != null) {
          player.vbdPercentileScore = vbdPercentiles[player.key];
        }
      });
    } else {
      state.players.forEach((player) => { delete player.vbdPercentileScore; });
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
    stopProviderPolling();
    // The switcher initializes asynchronously after session restore. During
    // that gap activeLeague can still be the default, so compare against the
    // provider identity persisted in the restored payload as well.
    const previousLeagueId = String(state.providerLeagueId || providerLeagueId());
    const previousProvider = previousLeagueId
      ? "sleeper"
      : String(state.activeLeague?.provider || "").toLowerCase();
    state.activeLeague = event.detail || DEFAULT_LEAGUE;
    syncLeagueInputs();
    const nextProvider = String(state.activeLeague?.provider || "").toLowerCase();
    const nextLeagueId = providerLeagueId();
    const providerChanged = previousProvider !== nextProvider || previousLeagueId !== nextLeagueId;
    if (providerChanged) {
      state.providerDraftId = null;
      state.providerDraft = null;
      state.providerRetrievedAt = null;
      state.providerIssues = [];
      state.providerSyncStatus = ProviderSync ? ProviderSync.STATUS.IDLE : "IDLE";
    }
    $("league-note").textContent =
      `Active league: ${state.activeLeague.name || "custom"} · ${numeric(state.activeLeague.scoring?.reception, 0)} PPR${isSuperflex() ? " · Superflex" : ""}`;
    state.survivalCache.clear();
    loadData().then(() => {
      updateProviderSyncUi();
      if (state.mode === "live") syncSleeperDraft({ manual: true }).then(() => ensureProviderPolling({ immediate: false }));
    });
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
  window.addEventListener("pagehide", () => { stopProviderPolling(); save(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save();
    else if (state.mode === "live" && providerEligible()) ensureProviderPolling();
  });
  $("start").onclick = start;
  if ($("draft-type")) $("draft-type").addEventListener("change", () => {
    const auction = $("draft-type").value === "auction";
    if ($("format-note")) $("format-note").textContent = auction
      ? "Auction selected — Start Mock Draft opens live nominations, timed bidding, budget enforcement and comparable-player price advice."
      : "Snake selected — recommendations model pick survival, positional runs and the cost of waiting until your next turn.";
    if ($("slot")) $("slot").closest("label").style.display = auction ? "none" : "";
    if ($("rounds")) $("rounds").closest("label").style.display = auction ? "none" : "";
  });
  document.querySelectorAll("[data-draft-preset]").forEach((button)=>button.onclick=()=>applyPreset(button.dataset.draftPreset));
  Object.values(ROSTER_INPUTS).forEach((id)=>$(id)?.addEventListener("input",()=>{document.querySelectorAll("[data-draft-preset]").forEach((button)=>button.classList.remove("active"));updateLineupPreview();}));
  ["setupPPR","setupPassTD","setupTEP","setup3RR"].forEach((id)=>$(id)?.addEventListener("change",()=>document.querySelectorAll("[data-draft-preset]").forEach((button)=>button.classList.remove("active"))));
  $("settings-done").addEventListener("click",start);
  $("advance").onclick = () => { if (state.mode === "sim") simulateToUser(); };
  if ($("provider-sync")) $("provider-sync").onclick = () => syncSleeperDraft({ manual: true });
  if ($("companion-current-pick")) $("companion-current-pick").onclick = () => $("board-current")?.click();
  $("undo").onclick = () => {
    if (state.mode === "live") {
      state.providerIssues = ["Confirmed Sleeper picks cannot be undone locally. Correct them in Sleeper and sync again."];
      state.providerSyncStatus = ProviderSync?.STATUS.DIVERGED || "DIVERGED";
      updateProviderSyncUi();
      return;
    }
    state.picks.pop();
    state.survivalCache.clear();
    save();
    render();
  };
  $("mode").onchange = () => {
    state.mode = $("mode").value;
    save();
    updateProviderSyncUi();
    if (state.mode === "live") syncSleeperDraft({ manual: true }).then(() => ensureProviderPolling({ immediate: false }));
    else stopProviderPolling();
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
  updateProviderSyncUi();
  window.setTimeout(() => {
    if (!state.players.length) {
      loadData().then(() => {
        updateProviderSyncUi();
        if (state.mode === "live") syncSleeperDraft({ manual: true }).then(() => ensureProviderPolling({ immediate: false }));
      });
    } else if (state.mode === "live") {
      syncSleeperDraft({ manual: true }).then(() => ensureProviderPolling({ immediate: false }));
    }
  }, 350);
})();
