(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FFOWeeklyScorecard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  // Grades the dashboard against what actually happened: for every team and
  // every completed week, the lineup the dashboard would have set from that
  // week's own projection snapshot, the manager's lineup, the best lineup in
  // hindsight, and an optional outside benchmark. Also emits the in-season
  // decision ledger rows those lineups imply.
  const VERSION = "1.0.0";
  const optimizerModule = () => {
    if (typeof require === "function") {
      try { return require("./dashboard-intelligence.js"); } catch (_error) { /* browser */ }
    }
    return root && root.FFODashboardIntel;
  };

  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const round = (value, places = 2) => {
    const power = 10 ** places;
    return Math.round((finite(value) + Number.EPSILON) * power) / power;
  };
  const mean = values => values.length ? values.reduce((sum, value) => sum + finite(value), 0) / values.length : null;

  // Accepts either the published weekly file (player objects) or the compact
  // per-week history file (fields + row arrays).
  function snapshotIndex(snapshot) {
    const index = new Map();
    if (!snapshot) return index;
    if (Array.isArray(snapshot.fields)) {
      const at = name => snapshot.fields.indexOf(name);
      const id = at("sleeper_id"), points = at("projected_points"), p10 = at("p10"), p90 = at("p90"), availability = at("availability_probability"), reason = at("unavailable_reason");
      (snapshot.players || []).forEach(row => {
        if (row[id] === null || row[id] === undefined) return;
        index.set(String(row[id]), { points: row[points], p10: row[p10], p90: row[p90], availability: row[availability], unavailable: reason >= 0 ? row[reason] : null });
      });
      return index;
    }
    (snapshot.players || []).forEach(player => {
      const sleeper = player?.source_ids?.sleeper;
      if (!sleeper) return;
      index.set(String(sleeper), {
        points: player.projected_points ?? player.distribution?.p50 ?? null,
        p10: player.distribution?.p10 ?? null, p90: player.distribution?.p90 ?? null,
        availability: player.availability_probability ?? null, unavailable: player.unavailable_reason ?? null,
      });
    });
    return index;
  }

  function lineupFor({ playerIds = [], players = {}, projections = new Map(), rosterPositions = [], pointsFor = null }) {
    const optimizer = optimizerModule();
    const pool = playerIds.map(id => {
      const position = players[id]?.position || null;
      const projection = pointsFor ? finite(pointsFor[id], 0) : projections.has(String(id)) ? projections.get(String(id)).points : null;
      return { id: String(id), position, projection: projection === undefined ? null : projection, marketValue: 0 };
    }).filter(player => player.position);
    const lineup = optimizer.optimizeLineup(pool, rosterPositions);
    const starters = lineup.assigned.filter(row => row.player).map(row => row.player.id);
    return { starters, projected: round(lineup.projected), filled: starters.length, slots: lineup.assigned.length };
  }

  const scoreOf = (starters, points) => round(starters.reduce((sum, id) => sum + finite(points?.[id]), 0));

  // entries: Sleeper /matchups/{week}; history: { [playerId]: [points in earlier weeks] }
  function scoreWeek({ week, entries = [], players = {}, projections = new Map(), benchmark = null, rosterPositions = [], history = {} }) {
    const byMatchup = new Map();
    entries.forEach(entry => {
      const list = byMatchup.get(entry.matchup_id) || [];
      list.push(entry);
      byMatchup.set(entry.matchup_id, list);
    });
    const teams = entries.map(entry => {
      const points = entry.players_points || {};
      const ids = (entry.players || []).map(String);
      const managerStarters = (entry.starters || []).map(String).filter(id => id !== "0");
      const dashboard = lineupFor({ playerIds: ids, players, projections, rosterPositions });
      const optimal = lineupFor({ playerIds: ids, players, rosterPositions, pointsFor: points });
      const managerProjected = round(managerStarters.reduce((sum, id) => sum + finite(projections.get(id)?.points), 0));
      const bench = benchmark ? lineupFor({ playerIds: ids, players, projections: benchmark, rosterPositions }) : null;
      const opponent = (byMatchup.get(entry.matchup_id) || []).find(other => other.roster_id !== entry.roster_id) || null;
      const actual = round(entry.points);
      const dashboardPoints = scoreOf(dashboard.starters, points);
      const opponentActual = opponent ? round(opponent.points) : null;
      const sameLineup = dashboard.starters.length === managerStarters.length && dashboard.starters.every(id => managerStarters.includes(id));
      return {
        roster_id: entry.roster_id, matchup_id: entry.matchup_id ?? null, opponent_roster_id: opponent ? opponent.roster_id : null,
        actual, dashboard: dashboardPoints, optimal: scoreOf(optimal.starters, points),
        benchmark: bench ? scoreOf(bench.starters, points) : null,
        dashboard_projected: dashboard.projected, manager_projected: managerProjected,
        regret: round(scoreOf(optimal.starters, points) - actual),
        dashboard_starters: dashboard.starters, manager_starters: managerStarters,
        dashboard_zero_starters: dashboard.starters.filter(id => !(finite(points[id]) > 0)).length,
        dashboard_unprojected_starters: dashboard.starters.filter(id => !projections.has(id)).length,
        same_as_manager: sameLineup,
        result_actual: opponentActual === null ? null : actual > opponentActual ? "W" : actual < opponentActual ? "L" : "T",
        result_if_dashboard: opponentActual === null ? null : dashboardPoints > opponentActual ? "W" : dashboardPoints < opponentActual ? "L" : "T",
      };
    });
    const errors = { model: [], rolling: [] };
    entries.forEach(entry => {
      const points = entry.players_points || {};
      (entry.starters || []).map(String).filter(id => id !== "0").forEach(id => {
        if (points[id] === undefined || !projections.has(id)) return;
        const prior = history[id] || [];
        if (!prior.length) return;
        errors.model.push(Math.abs(finite(projections.get(id).points) - finite(points[id])));
        errors.rolling.push(Math.abs(mean(prior) - finite(points[id])));
      });
    });
    const average = key => {
      const values = teams.map(team => team[key]).filter(value => value !== null && value !== undefined);
      return values.length ? round(mean(values)) : null;
    };
    return {
      week, teams,
      league: {
        teams: teams.length, actual: average("actual"), dashboard: average("dashboard"), optimal: average("optimal"),
        benchmark: average("benchmark"), regret: average("regret"),
        dashboard_minus_actual: round(average("dashboard") - average("actual")),
        dashboard_beats_manager: teams.filter(team => team.dashboard > team.actual).length,
        dashboard_matches_manager: teams.filter(team => team.same_as_manager).length,
        wins_flipped_to_losses: teams.filter(team => team.result_actual === "W" && team.result_if_dashboard === "L").length,
        losses_flipped_to_wins: teams.filter(team => team.result_actual === "L" && team.result_if_dashboard === "W").length,
        dashboard_zero_starters: teams.reduce((sum, team) => sum + team.dashboard_zero_starters, 0),
      },
      projection_error: {
        starters: errors.model.length,
        model_mae: errors.model.length ? round(mean(errors.model)) : null,
        rolling_average_mae: errors.rolling.length ? round(mean(errors.rolling)) : null,
      },
    };
  }

  // One row per team-week lineup recommendation, shaped as the brief's ledger:
  // id, league/team, timestamp, action, assets, expected benefit, confidence,
  // evidence, model version, baseline, user decision, outcome.
  function ledgerRecords({ season, week, leagueId, scored = null, pending = null, snapshotMeta = {} }) {
    const rows = scored ? scored.teams : pending || [];
    return rows.map(team => {
      const final = Boolean(scored);
      return {
        id: `${season}-w${String(week).padStart(2, "0")}-lineup-${team.roster_id}`,
        schema_version: 1,
        league_id: String(leagueId), roster_id: team.roster_id, season, week,
        recommended_at: snapshotMeta.generated_at || null,
        action_type: "LINEUP",
        assets: team.dashboard_starters,
        expected_benefit: { metric: "projected_points", value: team.dashboard_projected, versus_manager_lineup: final ? round(team.dashboard_projected - team.manager_projected) : null },
        confidence: team.dashboard_unprojected_starters ? "LOW" : "MEDIUM",
        evidence: { snapshot: snapshotMeta.path || null, generated_at: snapshotMeta.generated_at || null, evidence_cutoff: snapshotMeta.evidence_cutoff || null },
        model_version: snapshotMeta.model_version || null,
        baseline: { name: "manager_lineup", projected_points: final ? team.manager_projected : null },
        user_decision: final ? (team.same_as_manager ? "FOLLOWED" : "DIFFERENT_LINEUP") : null,
        outcome: final ? {
          status: "RESOLVED", recommended_points: team.dashboard, actual_points: team.actual, optimal_points: team.optimal,
          points_vs_actual: round(team.dashboard - team.actual), result_actual: team.result_actual, result_if_followed: team.result_if_dashboard,
        } : { status: "PENDING" },
      };
    });
  }

  return { VERSION, snapshotIndex, lineupFor, scoreWeek, ledgerRecords };
});
