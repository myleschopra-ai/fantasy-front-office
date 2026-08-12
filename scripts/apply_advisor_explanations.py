from pathlib import Path

p = Path('js/mock-draft-v4.js')
s = p.read_text()

old_action = '''  function actionFor(player, evaluation) {
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
'''
new_action = '''  function actionFor(player, evaluation) {
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
'''
if old_action in s:
    s = s.replace(old_action, new_action, 1)
elif 'const needState = advisorNeedState(player);\n    // Never let an opaque composite score' not in s:
    raise SystemExit('actionFor block not found')

marker = '''  function componentSummary(evaluation) {'''
if 'function needReason(' not in s:
    block = '''  function needReason(player) {
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

'''
    if marker not in s:
        raise SystemExit('componentSummary marker not found')
    s = s.replace(marker, block + marker, 1)

old_why = '''    $("why").textContent =
      `${actionFor(best, best)} · ${needLabel(best)} · ${componentSummary(best)}. ${directive.directive}`;'''
new_why = '''    $("why").textContent =
      `${actionFor(best, best)} · ${needLabel(best)} — ${needReason(best)}. ${componentSummary(best)}. ${directive.directive}`;'''
if old_why in s:
    s = s.replace(old_why, new_why, 1)
elif '${needReason(best)}' not in s:
    raise SystemExit('recommendation why marker not found')

old_blurb = '''      : `${needLabel(player)}. Overall ${numeric(player.overallRank, player.rank)}, ${player.position}${numeric(player.posRank, 999)}, position tier ${numeric(player.tier, 99)}, ADP ${numeric(player.adp, player.overallRank).toFixed(1)}. ${numeric(player.sourceCount, 1)} ranking source${numeric(player.sourceCount, 1) === 1 ? "" : "s"} with ${Math.round(numeric(player.agreement, 50))}% agreement.`;'''
new_blurb = '''      : `${needLabel(player)} — ${needReason(player)}. Overall ${numeric(player.overallRank, player.rank)}, ${player.position}${numeric(player.posRank, 999)}, position tier ${numeric(player.tier, 99)}, ADP ${numeric(player.adp, player.overallRank).toFixed(1)}. ${numeric(player.sourceCount, 1)} ranking source${numeric(player.sourceCount, 1) === 1 ? "" : "s"} with ${Math.round(numeric(player.agreement, 50))}% agreement.`;'''
if old_blurb in s:
    s = s.replace(old_blurb, new_blurb, 1)
elif '${needReason(player)}' not in s:
    raise SystemExit('player blurb marker not found')

old_complete = '''    if (draftComplete) {
      $("pick-label").textContent = "Draft complete";
      $("clock").textContent = "";
      $("best").textContent = `${state.picks.length} of ${state.teams * state.rounds} selections made.`;
      return;
    }'''
new_complete = '''    if (draftComplete) {
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
    }'''
if old_complete in s:
    s = s.replace(old_complete, new_complete, 1)
elif 'Lineup set · ${filled}/${total} starters' not in s:
    raise SystemExit('draftComplete marker not found')

p.write_text(s)
print('advisor explanations and redundancy instructions applied')
