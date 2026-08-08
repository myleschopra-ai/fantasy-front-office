// Playoff schedule intelligence — additive module, separate from championship-intelligence.js
// by design. It has no dependency on that module and that module has no dependency on this one;
// consuming pages opt in explicitly. This keeps the existing tested weighting logic untouched.
//
// Input contract:
//   scheduleData — the parsed contents of data/schedule_signals.json
//   playoffWeekStart — league.settings.playoff_week_start from the real Sleeper league object
//   regularSeasonWeeks — typically 18 for the current NFL season; passed in, not assumed
(() => {
  'use strict';

  function playoffWeeks(playoffWeekStart, regularSeasonWeeks) {
    if (!playoffWeekStart || !regularSeasonWeeks) return [];
    const weeks = [];
    for (let w = playoffWeekStart; w <= regularSeasonWeeks; w++) weeks.push(w);
    return weeks;
  }

  // Returns the list of opponents a given NFL team faces during the league's real playoff weeks.
  // Does not rank opponent strength — that needs weekly_stats/seasonal_stats already collected
  // by scripts/collectors/nflverse.py, cross-referenced in a later, separate pass. This function
  // only answers "who do you play," which is already a real, useful signal on its own.
  function playoffOpponents(team, scheduleData, playoffWeekStart, regularSeasonWeeks) {
    if (!scheduleData || !scheduleData.teams || !scheduleData.teams[team]) return [];
    const weeks = playoffWeeks(playoffWeekStart, regularSeasonWeeks);
    const teamSchedule = scheduleData.teams[team].schedule || {};
    return weeks.map(w => ({
      week: w,
      opponent: teamSchedule[String(w)] ? teamSchedule[String(w)].opponent : null,
      home: teamSchedule[String(w)] ? teamSchedule[String(w)].home : null,
    })).filter(entry => entry.opponent !== null);
  }

  // Checks whether a team's bye week falls inside the real playoff window — a genuinely bad
  // sign for a roster leaning on that team, distinct from a bye colliding with another bye.
  function byeFallsInPlayoffs(team, scheduleData, playoffWeekStart, regularSeasonWeeks) {
    if (!scheduleData || !scheduleData.teams || !scheduleData.teams[team]) return false;
    const bye = scheduleData.teams[team].bye_week;
    if (bye === null || bye === undefined) return false;
    return playoffWeeks(playoffWeekStart, regularSeasonWeeks).includes(bye);
  }

  window.FFOPlayoffIntel = { playoffWeeks, playoffOpponents, byeFallsInPlayoffs };
})();
