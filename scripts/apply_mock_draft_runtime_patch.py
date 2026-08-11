from pathlib import Path

path = Path('js/mock-draft-v4.js')
text = path.read_text(encoding='utf-8')
original = text

replacements = []

replacements.append((
'''  function cpuChoice(team, picks = state.picks) {
    const baseAmplitude =
      state.variance === "low" ? 2 : state.variance === "high" ? 9 : 5;
    const candidates = available(picks)
      .slice(0, 70)
      .map((player) => {
''',
'''  function cpuChoice(team, picks = state.picks) {
    const baseAmplitude =
      state.variance === "low" ? 2 : state.variance === "high" ? 9 : 5;
    const pool = available(picks);
    const candidates = pool
      .slice(0, 50)
      .map((player) => {
'''))

replacements.append((
'''        const scarcity = D.scarcityScore(player, available(picks), {
          picksUntilNextTurn: 1, // opponent's own immediate pick, not the user's turn distance
        });
''',
'''        const scarcity = D.scarcityScore(player, pool, {
          picksUntilNextTurn: 1, // opponent's own immediate pick, not the user's turn distance
        });
'''))

replacements.append((
'''  function survival(player, runs = 18) {
''',
'''  function survival(player, runs = 5) {
'''))

old_equity = '''  function equityFor(player) {
    const survives = survival(player);
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
    const scarcity = D.scarcityScore(player, available(state.picks), {
      picksUntilNextTurn,
    });
    const waitRisk = D.waitRiskCategory({
      survivalProbability: survives,
      playerValue: model.playerGrade,
      scarcity: scarcity.scarcity,
    });
    const oppCostContext = scoreContext(player, state.slot, state.picks, survives);
    const opportunityCost = D.opportunityCost(player, available(state.picks), {
      ...oppCostContext,
      picksUntilNextTurn,
    });
    return { ...model, eq: rosterEquity(projected), sv: survives, scarcity, waitRisk, opportunityCost };
  }
'''
new_equity = '''  function approximateSurvival(player) {
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
    return { ...model, eq: rosterEquity(projected), sv: survives, scarcity, waitRisk, opportunityCost };
  }
'''
replacements.append((old_equity, new_equity))

old_recs = '''  function recommendations() {
    return available()
      .slice(0, 75)
      .map((player) => ({ ...player, ...equityFor(player) }))
      .sort((a, b) => b.score - a.score || a.overallRank - b.overallRank)
      .slice(0, 4);
  }
'''
new_recs = '''  function recommendations() {
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
'''
replacements.append((old_recs, new_recs))

replacements.append((
'''      .slice(0, 100)
      .map((player) => playerRowHTML(player, equityFor(player), state.queue.includes(player.key)))
''',
'''      .slice(0, 60)
      .map((player) => playerRowHTML(player, equityFor(player, false), state.queue.includes(player.key)))
'''))

replacements.append((
'''      .map((player) => ({ player, evaluation: equityFor(player) }))
''',
'''      .map((player) => ({ player, evaluation: equityFor(player, false) }))
'''))

replacements.append((
'''    let html = `<div class="draft-grid" style="grid-template-columns:54px repeat(${state.teams},150px)"><div class="draft-cell header round">RD</div>`;
''',
'''    let html = `<div class="draft-grid" style="grid-template-columns:40px repeat(${state.teams},var(--pickw,108px))"><div class="draft-cell header round">RD</div>`;
'''))

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one match, found {count}: {old[:100]!r}')
    text = text.replace(old, new)

if text == original:
    raise SystemExit('No changes applied')

path.write_text(text, encoding='utf-8')
print('Applied mock-draft runtime performance patch')
