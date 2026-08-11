from pathlib import Path

intel_path = Path('js/draft-intelligence.js')
ui_path = Path('js/mock-draft-v4.js')
test_path = Path('tests/draft-intelligence.test.js')

intel = intel_path.read_text()
ui = ui_path.read_text()
tests = test_path.read_text()

if 'function rosterNeedState(' not in intel:
    marker = '  function tierScore(player) {'
    block = r'''  function rosterNeedState(player, context = {}) {
    const league = context.league || {};
    const picks = context.picks || [];
    const roster = league.roster || {};
    const currentLineup = optimalLineup(picks, league);
    const eligibleSlots = currentLineup.starters.filter((slot) => {
      const eligible = SLOT_ELIGIBILITY[slot.slot] || [slot.slot];
      return eligible.includes(player.position);
    });
    const unfilledEligible = eligibleSlots.find((slot) => !slot.player);
    const withCandidate = optimalLineup([...picks, player], league);
    const candidateSlot = withCandidate.starters.find((slot) => slot.player === player);

    if (unfilledEligible && candidateSlot) {
      const flexLike = /FLEX/.test(unfilledEligible.slot);
      return {
        state: flexLike ? 'flex_need' : 'starter_need',
        label: flexLike ? 'FLEX NEED' : 'STARTER NEED',
        slot: unfilledEligible.slot,
        starts: true,
        urgency: flexLike ? 86 : 94,
      };
    }

    if (candidateSlot) {
      return {
        state: 'starter_upgrade',
        label: 'STARTER UPGRADE',
        slot: candidateSlot.slot,
        starts: true,
        urgency: 74,
      };
    }

    const counts = context.counts || rosterCounts(picks);
    const have = numeric(counts[player.position], 0);
    const target = numeric(starterTargets(league)[player.position], 0);
    const superflex = numeric(roster.SUPER_FLEX || roster.SF, 0) > 0 || numeric(roster.QB, 1) > 1;

    if ((player.position === 'K' || player.position === 'DST') && target > 0 && have >= target) {
      return { state: 'saturated', label: 'SATURATED', slot: null, starts: false, urgency: 4 };
    }
    if (player.position === 'QB' && !superflex && have >= 1) {
      return { state: 'luxury', label: 'LUXURY', slot: null, starts: false, urgency: 10 };
    }
    if (player.position === 'TE' && have >= Math.max(1, target)) {
      return { state: 'depth', label: 'DEPTH', slot: null, starts: false, urgency: 24 };
    }
    if (player.position === 'RB' || player.position === 'WR') {
      return { state: 'depth_upside', label: 'DEPTH UPSIDE', slot: null, starts: false, urgency: 42 };
    }
    return { state: 'depth', label: 'DEPTH', slot: null, starts: false, urgency: 30 };
  }

'''
    if marker not in intel:
        raise SystemExit('tierScore marker not found')
    intel = intel.replace(marker, block + marker, 1)

if '    rosterNeedState,' not in intel:
    marker = '    rosterCounts,\n'
    if marker not in intel:
        raise SystemExit('export marker not found')
    intel = intel.replace(marker, marker + '    rosterNeedState,\n', 1)

if 'function advisorNeedState(' not in ui:
    marker = '  function playerRowHTML(player, evaluation, queued) {'
    block = r'''  function advisorNeedState(player) {
    return D.rosterNeedState(player, scoreContext(player, state.slot, state.picks, 50));
  }

  function needStateClass(needState) {
    if (!needState) return 'target';
    if (needState.state === 'starter_need' || needState.state === 'flex_need') return 'urgent';
    if (needState.state === 'starter_upgrade') return 'closing';
    if (needState.state === 'luxury' || needState.state === 'saturated') return 'avoid';
    return 'target';
  }

'''
    if marker not in ui:
        raise SystemExit('playerRowHTML marker not found')
    ui = ui.replace(marker, block + marker, 1)

if 'const needState = advisorNeedState(player);' not in ui:
    old = '  function playerRowHTML(player, evaluation, queued) {\n    const action = actionFor(player, evaluation);'
    new = '  function playerRowHTML(player, evaluation, queued) {\n    const action = actionFor(player, evaluation);\n    const needState = advisorNeedState(player);'
    if old not in ui:
        raise SystemExit('playerRowHTML body marker not found')
    ui = ui.replace(old, new, 1)

# Add a deterministic need badge next to the existing action badges.
needle = '${esc(action)}'
if 'needState.label' not in ui:
    # Insert after the action badge text in the first player row template occurrence.
    idx = ui.find(needle)
    if idx == -1:
        raise SystemExit('action template marker not found')
    end = idx + len(needle)
    ui = ui[:end] + '${` · ${esc(needState.label)}`}' + ui[end:]

# Replace the count-only roster card with optimal starters + bench, preserving IDs.
if 'function rosterLineupHTML(' not in ui:
    marker = '  function renderRoster() {'
    helper = r'''  function rosterLineupHTML(team = state.slot) {
    const drafted = teamPicks(team);
    const lineup = D.optimalLineup(drafted, state.activeLeague || DEFAULT_LEAGUE);
    const starters = lineup.starters.map((entry, index) => {
      const label = `${entry.slot}${lineup.starters.filter((s) => s.slot === entry.slot).length > 1 ? index + 1 : ''}`;
      const player = entry.player;
      return `<div class="slot lineup-slot ${player ? `pos-${String(player.position).toLowerCase()}` : 'empty'}"><span>${esc(label)}</span><strong>${player ? esc(player.name) : 'Empty'}</strong><span>${player ? `${esc(player.position)} · ${esc(player.nflTeam || '')}` : 'starter need'}</span></div>`;
    }).join('');
    const bench = lineup.bench.length
      ? `<div class="bench-label">BENCH · ${lineup.bench.length}</div><div class="bench-list">${lineup.bench.map((player) => `<span class="bench-chip pos-${String(player.position).toLowerCase()}">${esc(player.position)} ${esc(player.name)}</span>`).join('')}</div>`
      : '<div class="bench-label">BENCH · Empty</div>';
    return starters + bench;
  }

'''
    if marker not in ui:
        raise SystemExit('renderRoster marker not found')
    ui = ui.replace(marker, helper + marker, 1)

start = ui.find('  function renderRoster() {')
if start == -1:
    raise SystemExit('renderRoster not found')
end = ui.find('\n  function ', start + 10)
if end == -1:
    raise SystemExit('renderRoster end not found')
old_block = ui[start:end]
if 'rosterLineupHTML' not in old_block:
    new_block = r'''  function renderRoster() {
    const equity = rosterEquity();
    $("roster").innerHTML = rosterLineupHTML(state.slot);
    $("roster-equity").textContent = `${equity}% roster equity`;
    const equityFill = $("roster-equity-fill");
    if (equityFill) equityFill.style.width = `${equity}%`;
  }
'''
    ui = ui[:start] + new_block + ui[end:]

# Add core unit assertions once.
if 'rosterNeedState identifies FLEX need' not in tests:
    tests += r'''

// Advisor roster-state taxonomy regression tests.
(() => {
  const league = { roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 }, scoring: { reception: 0.5 } };
  const p = (name, position, overallRank, posRank) => ({ key: `${name}|${position}`, name, position, overallRank, rank: overallRank, posRank, consensusScore: Math.max(1, 101 - overallRank) });
  const roster = [
    p('QB One', 'QB', 12, 1),
    p('RB One', 'RB', 8, 1), p('RB Two', 'RB', 22, 8),
    p('WR One', 'WR', 10, 2), p('WR Two', 'WR', 28, 12),
    p('TE One', 'TE', 45, 6),
  ];
  const flexCandidate = p('WR Three', 'WR', 32, 14);
  const flexState = D.rosterNeedState(flexCandidate, { league, picks: roster, counts: D.rosterCounts(roster), superflex: false });
  assert.ok(['flex_need', 'starter_upgrade'].includes(flexState.state), 'rosterNeedState identifies FLEX need or lineup upgrade');

  const qbLuxury = p('QB Two', 'QB', 30, 4);
  const qbState = D.rosterNeedState(qbLuxury, { league, picks: roster, counts: D.rosterCounts(roster), superflex: false });
  assert.strictEqual(qbState.state, 'luxury', 'second 1QB is labeled luxury when it does not start');

  const withK = [...roster, p('K One', 'K', 180, 1)];
  const kState = D.rosterNeedState(p('K Two', 'K', 190, 2), { league, picks: withK, counts: D.rosterCounts(withK), superflex: false });
  assert.strictEqual(kState.state, 'saturated', 'second kicker is saturated after K slot filled');

  const completed = D.validateCompletedRoster([...withK, p('DST One', 'DST', 181, 1), p('RB Three', 'RB', 35, 15)], league);
  assert.ok(completed.lineup.starters.some((slot) => slot.slot === 'K' && slot.player), 'completed lineup seats kicker');
  assert.ok(completed.lineup.starters.some((slot) => slot.slot === 'DST' && slot.player), 'completed lineup seats defense');
})();
'''

intel_path.write_text(intel)
ui_path.write_text(ui)
test_path.write_text(tests)
print('advisor need-state + lineup presentation patch applied')
