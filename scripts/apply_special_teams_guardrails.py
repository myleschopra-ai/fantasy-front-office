from pathlib import Path

path = Path('js/draft-intelligence.js')
text = path.read_text(encoding='utf-8')
old = '''  function needScore(player, context) {\n    const league = context.league || {};\n    const picks = context.picks || [];\n    const startsIfAdded = wouldStart(player, picks, league);\n\n    if (startsIfAdded) {\n'''
new = '''  function needScore(player, context) {\n    const league = context.league || {};\n    const picks = context.picks || [];\n    const counts = context.counts || rosterCounts(picks);\n    const have = numeric(counts[player.position], 0);\n    const configuredTargets = context.targets || starterTargets(league);\n    const starterTarget = numeric(configuredTargets[player.position], 0);\n    const round = numeric(context.round, 1);\n    const totalRounds = Math.max(1, numeric(context.totalRounds, 16));\n\n    // K/DST are roster-completion positions in conventional redraft formats:\n    // do not let an empty special-teams slot outrank meaningful RB/WR/QB/TE\n    // value early, and never recommend a redundant second K/DST once filled.\n    if (player.position === "K" || player.position === "DST") {\n      if (starterTarget <= 0 || have >= starterTarget) return 1;\n      if (round < Math.max(1, totalRounds - 2)) return 5;\n    }\n\n    const startsIfAdded = wouldStart(player, picks, league);\n\n    if (startsIfAdded) {\n'''
if text.count(old) != 1:
    raise SystemExit(f'needScore header match count={text.count(old)}')
text = text.replace(old, new)
old2 = '''    const counts = context.counts || rosterCounts(picks);\n    const have = numeric(counts[player.position], 0);\n    if (player.position === "QB" && !context.superflex && have >= 1) {\n'''
new2 = '''    if (player.position === "QB" && !context.superflex && have >= 1) {\n'''
if text.count(old2) != 1:
    raise SystemExit(f'needScore duplicate-count block match count={text.count(old2)}')
text = text.replace(old2, new2)
path.write_text(text, encoding='utf-8')
print('Applied K/DST late-round and redundancy guardrails')
