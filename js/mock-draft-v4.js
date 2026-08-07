(function () {
  "use strict";

  const D = window.FFODraftIntelligence;
  const $ = (id) => document.getElementById(id);
  const LS = "ffo_mock_draft_v4";
  const POSITIONS = ["QB", "RB", "WR", "TE"];
  const DEFAULT_LEAGUE = {
    name: "12-team half-PPR",
    league_type: "redraft",
    scoring: { reception: 0.5 },
    roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2 },
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
    restored: false,
    loadToken: 0,
    survivalCache: new Map(),
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

  function save() {
    localStorage.setItem(
      LS,
      JSON.stringify({
        version: 3,
        picks: state.picks,
        teams: state.teams,
        slot: state.slot,
        rounds: state.rounds,
        strategy: state.strategy,
        mode: state.mode,
        variance: state.variance,
        profiles: state.profiles,
        selectedTeam: state.selectedTeam,
      }),
    );
  }

  function restore() {
    if (state.restored) return;
    state.restored = true;
    try {
      const saved = JSON.parse(localStorage.getItem(LS) || "{}");
      Object.assign(state, saved);
      if (!D.STRATEGIES[state.strategy]) state.strategy = "adaptive";
      state.picks = (state.picks || []).map((pick, index) =>
        normalizePick(pick, index + 1),
      );
      state.selectedTeam = state.selectedTeam || state.slot;
    } catch (_error) {
      state.picks = [];
    }
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
    const amplitude =
      state.variance === "low" ? 2 : state.variance === "high" ? 9 : 5;
    return model.score + (Math.random() - 0.5) * amplitude * 2;
  }

  function cpuChoice(team, picks = state.picks) {
    return available(picks)
      .slice(0, 70)
      .map((player) => ({ player, score: cpuScore(player, team, picks) }))
      .sort(
        (a, b) =>
          b.score - a.score || a.player.overallRank - b.player.overallRank,
      )[0]?.player;
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

  function survival(player, runs = 18) {
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

  function equityFor(player) {
    const survives = survival(player);
    const model = D.scorePlayer(
      player,
      scoreContext(player, state.slot, state.picks, survives),
    );
    const projected = [
      ...state.picks,
      createSelection(player, state.picks.length + 1, state.slot, "projection"),
    ];
    return { ...model, eq: rosterEquity(projected), sv: survives };
  }

  function actionFor(player, evaluation) {
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
    return available()
      .slice(0, 75)
      .map((player) => ({ ...player, ...equityFor(player) }))
      .sort((a, b) => b.score - a.score || a.overallRank - b.overallRank)
      .slice(0, 4);
  }

  function needLabel(player) {
    const quality = positionQuality(state.slot, player.position);
    if (quality.count < target(player.position)) return "STARTER NEED";
    if (player.position === "QB" && target("QB") === 1 && quality.count >= 1)
      return "QB DEPTH";
    if (player.position === "TE" && target("TE") === 1 && quality.count >= 1)
      return "TE DEPTH";
    return "VALUE / DEPTH";
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
    $("pick-label").textContent =
      `${roundPick(nextPick)} · Team ${ownerForPick(nextPick)}`;
    $("clock").textContent =
      ownerForPick(nextPick) === state.slot ? "YOU ARE ON THE CLOCK" : "";
    if (!best) {
      $("best").textContent = "Draft complete";
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
      `${actionFor(best, best)} · ${needLabel(best)} · ${componentSummary(best)}. ${directive.directive}`;
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
    $("board").innerHTML = available()
      .filter(
        (player) =>
          (position === "ALL" || player.position === position) &&
          (!query || player.name.toLowerCase().includes(query)),
      )
      .slice(0, 100)
      .map((player) => {
        const evaluation = equityFor(player);
        return `<div class="row compact-rec"><div class="player-link" data-player="${esc(player.key)}" tabindex="0"><div class="name">${esc(player.name)} <span class="meta">${player.position}${player.nflTeam ? ` · ${esc(player.nflTeam)}` : ""}</span></div><div class="icons"><span class="icon">${actionFor(player, evaluation)}</span>${rankIcons(player, evaluation)}<span class="icon">${evaluation.sv <= 35 ? "🔒" : "⏳"} ${evaluation.sv}%</span></div></div><button class="btn secondary" data-k="${esc(player.key)}">Draft</button></div>`;
      })
      .join("");
    document.querySelectorAll("[data-k]").forEach((button) => {
      button.onclick = () => draft(button.dataset.k);
    });
  }

  function renderRoster() {
    const rosterCounts = counts();
    const equity = rosterEquity();
    $("roster").innerHTML = POSITIONS.map(
      (position) =>
        `<div class="slot"><span>${position}</span><strong>${rosterCounts[position] || 0}</strong><span>target ${target(position)}</span></div>`,
    ).join("");
    $("roster-equity").textContent = equity;
    $("equity-bar").style.width = `${equity}%`;
    const gaps = POSITIONS.filter(
      (position) => (rosterCounts[position] || 0) < target(position),
    );
    const directive = D.strategyDirective({
      strategy: state.strategy,
      league: state.activeLeague,
      round: Math.floor(state.picks.length / state.teams) + 1,
      picks: teamPicks(state.slot),
      counts: rosterCounts,
      superflex: isSuperflex(),
    });
    $("profile").innerHTML =
      `Starter gaps: <strong>${gaps.length ? gaps.join(", ") : "none"}</strong><br>Current plan: <strong>${esc(directive.directive)}</strong>${directive.warning ? `<br><span class="confidence-low">Guardrail: ${esc(directive.warning)}</span>` : ""}`;
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
    const peers = available()
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
      `${player.name} · ${player.position}${player.nflTeam ? ` · ${player.nflTeam}` : ""}`;
    $("player-blurb").textContent =
      `${needLabel(player)}. Overall ${numeric(player.overallRank, player.rank)}, ${player.position}${numeric(player.posRank, 999)}, position tier ${numeric(player.tier, 99)}, ADP ${numeric(player.adp, player.overallRank).toFixed(1)}. ${numeric(player.sourceCount, 1)} ranking source${numeric(player.sourceCount, 1) === 1 ? "" : "s"} with ${Math.round(numeric(player.agreement, 50))}% agreement.`;
    $("player-scheme").innerHTML = schemeHtml(player);
    $("player-compare").innerHTML = group
      .map((candidate, index) => {
        const evaluation = equityFor(candidate);
        return `<div class="compare-card ${index === 0 ? "primary" : ""}"><div class="muted">${index === 0 ? "SELECTED" : "POSITION PEER"}</div><div class="name">${esc(candidate.name)}</div><div class="meta">O${numeric(candidate.overallRank, candidate.rank)} · ${candidate.position}${numeric(candidate.posRank, 999)} · T${numeric(candidate.tier, 99)}</div><div class="metricline">Recommendation <strong>${evaluation.score}</strong> · confidence ${evaluation.confidence}</div><div class="metricline">Consensus ${Math.round(consensus(candidate))} · VBD ${Math.round(evaluation.components.vbd)}</div><div class="metricline">Scheme ${Math.round(evaluation.components.scheme)} · strategy ${Math.round(evaluation.components.strategy)}</div><div class="metricline">ADP value ${formatSigned(marketDelta(candidate))} · survives ${evaluation.sv}%</div></div>`;
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
    ["board", "team", "selections"].forEach((name) => {
      const button = $(`tab-${name}`);
      const view = $(name === "board" ? "draft-grid-view" : `${name}-view`);
      if (button) button.classList.toggle("active", name === tab);
      if (view) view.style.display = name === tab ? "block" : "none";
    });
    if (tab === "team") renderTeamRoster();
    if (tab === "selections") renderSelections();
  }

  function renderDraftGrid() {
    const byPick = new Map(state.picks.map((pick) => [pick.pick, pick]));
    let html = `<div class="draft-grid" style="grid-template-columns:54px repeat(${state.teams},150px)"><div class="draft-cell header round">RD</div>`;
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
    $("team-roster-view").innerHTML =
      `<div class="toolbar" style="margin-top:10px"><strong>Team ${team}${team === state.slot ? " · YOU" : ""}</strong><select id="team-select" style="width:auto">${Array.from({ length: state.teams }, (_value, index) => `<option value="${index + 1}" ${team === index + 1 ? "selected" : ""}>Team ${index + 1}${state.slot === index + 1 ? " · YOU" : ""}</option>`).join("")}</select></div><div class="team-roster-list">${roster.map((pick) => `<div class="row"><div><div class="name">${esc(pick.name)}</div><div class="meta">${pick.position} · ${roundPick(pick.pick)}</div></div><span class="sim-badge">MOCK</span></div>`).join("") || '<div class="muted">No simulated additions yet.</div>'}</div><div class="notice" style="margin-top:10px">This simulated class never modifies the real league roster.</div>`;
    $("team-select").onchange = (event) => {
      state.selectedTeam = numeric(event.target.value, state.slot);
      save();
      renderTeamRoster();
    };
  }

  function renderSelections() {
    $("selections-view").innerHTML =
      `<div style="margin-top:10px">${state.picks.map((pick) => `<div class="row"><div><strong>${roundPick(pick.pick)}</strong> · Team ${pick.team}</div><div>${esc(pick.name)} · ${esc(pick.position)} <span class="sim-badge">MOCK</span></div></div>`).join("") || '<div class="muted">No picks yet.</div>'}</div>`;
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
    bindPlayerLinks();
  }

  function draft(key) {
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
    const token = ++state.loadToken;
    const league = state.activeLeague || DEFAULT_LEAGUE;
    const qbs = isSuperflex() ? 2 : 1;
    const ppr = numeric(league.scoring?.reception, 0.5);
    const dynasty =
      String(league.league_type || league.type || "").toLowerCase() ===
      "dynasty";
    $("source").textContent = "Loading consensus rankings and live market…";
    const [intelligenceResult, marketResult] = await Promise.allSettled([
      fetchJson(`data/draft_intelligence.json?ts=${Date.now()}`),
      fetchJson(
        `https://api.fantasycalc.com/values/current?isDynasty=${dynasty}&numQbs=${qbs}&numTeams=${state.teams}&ppr=${ppr}`,
      ),
    ]);
    if (token !== state.loadToken) return;
    state.intelligence =
      intelligenceResult.status === "fulfilled"
        ? intelligenceResult.value
        : null;
    state.intelProfile = D.selectProfile(state.intelligence, league);
    const live =
      marketResult.status === "fulfilled"
        ? liveMarketPlayers(marketResult.value)
        : [];
    state.marketLoaded = live.length > 0;
    state.players = D.enrichPlayers(live, state.intelProfile);
    rehydratePicks();
    state.survivalCache.clear();
    if (!state.players.length) {
      $("source").textContent =
        "Ranking feeds unavailable. Reload to retry; saved picks were preserved.";
      $("best").textContent = "Rankings unavailable";
      renderIntelligence();
      return;
    }
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
