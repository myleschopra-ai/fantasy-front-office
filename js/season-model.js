(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FFOSeasonModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Season model: where the league actually stands, every team's odds over the
  // real remaining schedule, each team's state, and the strategy that state
  // implies. Every constant comes from config/decision_policy.json; the copy
  // below is the fallback when that file cannot be loaded and is checked
  // against it by tests/season-model.test.js.
  const VERSION = "1.0.0";
  const DEFAULT_POLICY = {
    season_model: {
      weekly_sd_fallback: 24.5,
      sd_prior_games: 6,
      min_games_for_empirical_sd: 3,
      season_weight_k: 4,
      strength_shrink: 0.8,
      simulations: 3000,
      sd_floor: 6,
    },
    team_state: {
      contender_playoff: 0.65,
      fringe_playoff: 0.35,
      productive_all_play: 0.5,
      structural_value_tercile: 0.67,
    },
    sell_window: {
      age_cutoff: 28,
      min_market_value: 300,
      contender_playoff: 0.6,
      young_age_max: 25,
      old_age_min: 29,
    },
  };

  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const round = (value, places = 3) => {
    const power = 10 ** places;
    return Math.round((finite(value) + Number.EPSILON) * power) / power;
  };
  const mean = values => values.length ? values.reduce((sum, value) => sum + finite(value), 0) / values.length : 0;

  function policyFrom(policy = {}) {
    return {
      season_model: { ...DEFAULT_POLICY.season_model, ...(policy.season_model || {}) },
      team_state: { ...DEFAULT_POLICY.team_state, ...(policy.team_state || {}) },
      sell_window: { ...DEFAULT_POLICY.sell_window, ...(policy.sell_window || {}) },
    };
  }

  // Games already scored, from the standings rather than the calendar: the
  // week rolls over before its results post, the standings do not.
  function gamesPlayed(rosters = []) {
    return rosters.reduce((most, roster) => {
      const settings = roster?.settings || {};
      return Math.max(most, finite(settings.wins) + finite(settings.losses) + finite(settings.ties));
    }, 0);
  }

  function pairsFrom(entries = []) {
    const byMatchup = new Map();
    entries.forEach(entry => {
      if (entry?.matchup_id === null || entry?.matchup_id === undefined) return;
      const list = byMatchup.get(entry.matchup_id) || [];
      list.push(String(entry.roster_id));
      byMatchup.set(entry.matchup_id, list);
    });
    return [...byMatchup.values()].filter(pair => pair.length === 2);
  }

  // matchupsByWeek: { [week]: Sleeper /matchups/{week} array }
  function splitSeason({ matchupsByWeek = {}, played = 0, playoffWeekStart = 15 } = {}) {
    const lastRegular = Math.max(1, finite(playoffWeekStart, 15) - 1);
    const past = [];
    const schedule = [];
    const scheduleWeeks = [];
    for (let week = 1; week <= lastRegular; week += 1) {
      const entries = matchupsByWeek[week] || matchupsByWeek[String(week)] || [];
      if (week <= played) {
        const scores = {};
        entries.forEach(entry => { scores[String(entry.roster_id)] = finite(entry.points); });
        past.push({ week, scores, pairs: pairsFrom(entries) });
      } else {
        const pairs = pairsFrom(entries);
        if (pairs.length) { schedule.push(pairs); scheduleWeeks.push(week); }
      }
    }
    return { past, schedule, scheduleWeeks, lastRegularWeek: lastRegular };
  }

  function seasonStats(past = [], teamIds = []) {
    const ids = teamIds.map(String);
    const teams = Object.fromEntries(ids.map(id => [id, { scores: [], allPlayWins: 0, allPlayLosses: 0 }]));
    past.forEach(week => {
      const entries = ids.filter(id => week.scores[id] !== undefined).map(id => [id, week.scores[id]]);
      entries.forEach(([id, score]) => {
        teams[id].scores.push(score);
        entries.forEach(([other, otherScore]) => {
          if (other === id) return;
          if (score > otherScore) teams[id].allPlayWins += 1;
          else if (score < otherScore) teams[id].allPlayLosses += 1;
        });
      });
    });
    const all = Object.values(teams).flatMap(team => team.scores);
    const leagueMean = all.length ? mean(all) : null;
    const residuals = Object.values(teams).flatMap(team => {
      const average = mean(team.scores);
      return team.scores.map(score => score - average);
    });
    const dof = residuals.length - Object.values(teams).filter(team => team.scores.length).length;
    const residualSd = dof > 0 ? Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / dof) : null;
    Object.values(teams).forEach(team => {
      team.games = team.scores.length;
      team.ppg = team.games ? round(mean(team.scores), 2) : null;
      const total = team.allPlayWins + team.allPlayLosses;
      team.allPlayPct = total ? round(team.allPlayWins / total, 4) : null;
    });
    return { teams, leagueMean: leagueMean === null ? null : round(leagueMean, 2), residualSd: residualSd === null ? null : round(residualSd, 2) };
  }

  // Pooled weekly SD, shrunk toward the policy prior until enough games exist.
  function weeklySd({ residualSd = null, games = 0, policy = {} } = {}) {
    const model = policyFrom(policy).season_model;
    if (residualSd === null || games < model.min_games_for_empirical_sd) return { sd: model.weekly_sd_fallback, source: "POLICY_PRIOR" };
    const k = model.sd_prior_games;
    const blended = Math.sqrt((games * residualSd ** 2 + k * model.weekly_sd_fallback ** 2) / (games + k));
    return { sd: round(blended, 2), source: "LEAGUE_EMPIRICAL_SHRUNK" };
  }

  // Strength = league mean plus a shrunk blend of this week's projected lineup
  // (relative to the league, rescaled to scored points) and season scoring.
  function teamStrengths({ teams = [], leagueMean = null, policy = {} } = {}) {
    const model = policyFrom(policy).season_model;
    const projected = teams.filter(team => team.projection !== null && team.projection !== undefined && finite(team.projection) > 0);
    const projectionMean = projected.length ? mean(projected.map(team => team.projection)) : null;
    const base = leagueMean !== null && leagueMean !== undefined ? finite(leagueMean)
      : projectionMean !== null ? projectionMean : 0;
    const scale = projectionMean ? base / projectionMean : 1;
    return Object.fromEntries(teams.map(team => {
      const games = finite(team.games);
      const hasSeason = team.ppg !== null && team.ppg !== undefined && games > 0 && leagueMean !== null && leagueMean !== undefined;
      const hasProjection = projectionMean !== null && team.projection !== null && team.projection !== undefined && finite(team.projection) > 0;
      let seasonWeight = hasSeason ? games / (games + model.season_weight_k) : 0;
      if (!hasProjection) seasonWeight = hasSeason ? 1 : 0;
      const projectionWeight = hasProjection ? 1 - seasonWeight : 0;
      const projectionEdge = hasProjection ? (finite(team.projection) - projectionMean) * scale : 0;
      const seasonEdge = hasSeason ? finite(team.ppg) - finite(leagueMean) : 0;
      const strength = base + model.strength_shrink * (projectionWeight * projectionEdge + seasonWeight * seasonEdge);
      return [String(team.id), {
        mean: round(strength, 2), projectionEdge: round(projectionEdge, 2), seasonEdge: round(seasonEdge, 2),
        projectionWeight: round(projectionWeight, 3), seasonWeight: round(seasonWeight, 3),
      }];
    }));
  }

  // Rank of a value among all teams' values (1 = best).
  function valueRank(values = {}, id) {
    const mine = finite(values[String(id)], null);
    if (mine === null) return null;
    return Object.values(values).filter(value => finite(value) > mine).length + 1;
  }

  function classifyTeamState({ playoff = 0, title = 0, allPlayPct = null, valueRank: rank = null, teamCount = 12 } = {}, policy = {}) {
    const rules = policyFrom(policy).team_state;
    const reasons = [];
    const share = rank === null ? null : rank / Math.max(1, teamCount);
    let state;
    if (playoff >= rules.contender_playoff) {
      state = "Contender";
      reasons.push(`playoff odds ${Math.round(playoff * 100)}% ≥ ${Math.round(rules.contender_playoff * 100)}%`);
    } else if (playoff >= rules.fringe_playoff) {
      state = "Fringe contender";
      reasons.push(`playoff odds ${Math.round(playoff * 100)}% between ${Math.round(rules.fringe_playoff * 100)}% and ${Math.round(rules.contender_playoff * 100)}%`);
    } else if (allPlayPct !== null && allPlayPct >= rules.productive_all_play) {
      state = "Productive struggle";
      reasons.push(`playoff odds ${Math.round(playoff * 100)}%, but all-play ${Math.round(allPlayPct * 100)}% says the scoring is there`);
    } else if (share !== null && share > rules.structural_value_tercile) {
      state = "Structurally weak";
      reasons.push(`playoff odds ${Math.round(playoff * 100)}%, all-play ${allPlayPct === null ? "—" : `${Math.round(allPlayPct * 100)}%`}, roster value rank ${rank}/${teamCount}`);
    } else {
      state = "Rebuilder";
      reasons.push(`playoff odds ${Math.round(playoff * 100)}% with below-.500 all-play scoring`);
    }
    const strategy = state === "Contender" || state === "Fringe contender" ? "BUY" : state === "Productive struggle" ? "HOLD" : "SELL";
    return { state, strategy, reasons, policyStatus: "UNCALIBRATED", inputs: { playoff, title, allPlayPct, valueRank: rank, teamCount } };
  }

  const SLOT_POSITIONS = {
    QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], K: ["K"], DEF: ["DEF", "DST"], DST: ["DEF", "DST"],
    FLEX: ["RB", "WR", "TE"], SUPER_FLEX: ["QB", "RB", "WR", "TE"], WRRB_FLEX: ["RB", "WR"], REC_FLEX: ["WR", "TE"],
  };

  // For each team, its starting slots ranked against the same slot on every
  // other team (1 = strongest). lineups: { [teamId]: optimizeLineup(...) }.
  function slotRanks(lineups = {}) {
    const ids = Object.keys(lineups);
    const slotCount = Math.max(0, ...ids.map(id => (lineups[id]?.assigned || []).length));
    const result = Object.fromEntries(ids.map(id => [id, []]));
    for (let index = 0; index < slotCount; index += 1) {
      const values = ids.map(id => {
        const row = lineups[id]?.assigned?.[index];
        const value = row?.player?.projection;
        return { id, slot: row?.slot, value: value === null || value === undefined ? 0 : finite(value) };
      });
      values.forEach(entry => {
        const rank = values.filter(other => other.value > entry.value).length + 1;
        result[entry.id].push({ slot: entry.slot, index, value: round(entry.value, 2), rank, teams: values.length });
      });
    }
    return result;
  }

  // What a weak slot asks a buyer to add. A weak Superflex means a second QB;
  // a weak FLEX can be any of its positions.
  const NEED_POSITIONS = { ...SLOT_POSITIONS, SUPER_FLEX: ["QB"] };

  function contenderDemand({ teams = [], lineups = {}, policy = {} } = {}) {
    const rules = policyFrom(policy).sell_window;
    const ranks = slotRanks(lineups);
    return teams.filter(team => finite(team.playoff) >= rules.contender_playoff).map(team => {
      const slots = (ranks[String(team.id)] || []).slice().sort((a, b) => b.rank - a.rank || a.value - b.value);
      const weakest = slots.slice(0, 2);
      const needs = [...new Set(weakest.flatMap(slot => NEED_POSITIONS[slot.slot] || [slot.slot]))];
      return {
        id: String(team.id), name: team.name, playoff: finite(team.playoff), title: finite(team.title),
        faabRemaining: team.faabRemaining ?? null, picks: team.picks ?? null, weakest, needs,
      };
    }).sort((a, b) => b.title - a.title || b.playoff - a.playoff);
  }

  // Veterans worth selling now, each with the contenders whose weakest starting
  // slots the player would fill.
  function sellWindow({ roster = [], demand = [], weeksToDeadline = null, policy = {} } = {}) {
    const rules = policyFrom(policy).sell_window;
    return roster
      .filter(player => finite(player.age, 0) >= rules.age_cutoff && finite(player.marketValue) >= rules.min_market_value)
      .map(player => {
        const buyers = demand.filter(team => team.needs.includes(String(player.position || "").toUpperCase()))
          .map(team => ({ id: team.id, name: team.name, playoff: team.playoff, title: team.title, slot: team.weakest.find(slot => (NEED_POSITIONS[slot.slot] || []).includes(String(player.position || "").toUpperCase()))?.slot || null }));
        return {
          id: player.id, name: player.name, position: player.position, age: finite(player.age), team: player.team || null,
          marketValue: finite(player.marketValue), projection: player.projection ?? null, buyers,
          weeksToDeadline, reason: `Age ${finite(player.age)} · market ${Math.round(finite(player.marketValue)).toLocaleString("en-US")}`,
        };
      })
      .sort((a, b) => (b.buyers.length > 0) - (a.buyers.length > 0) || b.marketValue - a.marketValue);
  }

  // A selling team never sends youth or picks for veterans.
  function strategyBlocks({ strategy = "HOLD", give = [], receive = [], policy = {} } = {}) {
    if (strategy !== "SELL") return null;
    const rules = policyFrom(policy).sell_window;
    const oldIn = receive.filter(asset => asset.type !== "pick" && finite(asset.age, 0) >= rules.old_age_min);
    const youngOut = give.filter(asset => asset.type === "pick" || asset.position === "PICK" || (finite(asset.age, 99) <= rules.young_age_max));
    if (oldIn.length && youngOut.length) {
      return `Selling team: would send ${youngOut.map(asset => asset.name || "a pick").join(", ")} for age-${oldIn.map(asset => finite(asset.age)).join("/")} ${oldIn.map(asset => asset.name).join(", ")}`;
    }
    return null;
  }

  function weeksUntilDeadline({ played = 0, tradeDeadline = null } = {}) {
    if (!tradeDeadline) return null;
    return Math.max(0, finite(tradeDeadline) - (played + 1));
  }

  return {
    VERSION, DEFAULT_POLICY, policyFrom, gamesPlayed, pairsFrom, splitSeason, seasonStats, weeklySd,
    teamStrengths, valueRank, classifyTeamState, slotRanks, contenderDemand, sellWindow, strategyBlocks,
    weeksUntilDeadline, SLOT_POSITIONS,
  };
});
