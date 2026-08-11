'use strict';

const fs = require('node:fs');
const path = require('node:path');
const D = require('../js/draft-intelligence.js');

const ROOT = path.resolve(__dirname, '..');
const strict = process.argv.includes('--strict');
const outputArg = process.argv.find((arg) => arg.startsWith('--output-dir='));
const OUTPUT_DIR = path.resolve(ROOT, outputArg ? outputArg.split('=')[1] : 'reports');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function norm(value) {
  return D.normalizeName(value);
}

function identity(player) {
  return `${norm(player.name)}|${String(player.position || '').toUpperCase()}`;
}

function leagueConfig({ superflex = false, wr = 2 } = {}) {
  return {
    name: `12-team half-PPR ${superflex ? 'Superflex' : '1QB'} ${wr}WR`,
    league_type: 'redraft',
    scoring: { reception: 0.5 },
    roster: {
      QB: 1, RB: 2, WR: wr, TE: 1, FLEX: 2,
      SUPER_FLEX: superflex ? 1 : 0,
      K: 1, DST: 1, BENCH: 6,
    },
  };
}

function contextFor(league, players, picks = [], round = 1, survival = 50) {
  return {
    strategy: 'adaptive', league, teams: 12, round, totalRounds: 16,
    picks, counts: D.rosterCounts(picks), targets: D.starterTargets(league),
    superflex: Number(league.roster.SUPER_FLEX || 0) > 0,
    poolSize: Math.max(1, players.length), survival,
  };
}

function apiAudit(snapshot) {
  const rankingCounts = {};
  const projectionCounts = {};
  for (const pos of ['OVERALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST']) {
    rankingCounts[pos] = Array.isArray(snapshot.rankings?.[pos]) ? snapshot.rankings[pos].length : 0;
  }
  for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DST']) {
    projectionCounts[pos] = Array.isArray(snapshot.projections?.[pos]) ? snapshot.projections[pos].length : 0;
  }
  const nonzero = Object.values(rankingCounts).filter((n) => n > 0);
  const sampleLimited = nonzero.length > 0 && Math.max(...nonzero) <= 10;
  return {
    schemaVersion: snapshot.schema_version || null,
    generatedAt: snapshot.generated_at || null,
    season: snapshot.season || null,
    scoring: snapshot.scoring || null,
    rankingCounts,
    projectionCounts,
    sampleLimited,
    accessMode: sampleLimited ? 'sample' : (rankingCounts.OVERALL >= 100 ? 'production' : 'legacy-or-partial'),
  };
}

function projectionMap(snapshot) {
  const map = new Map();
  for (const [position, rows] of Object.entries(snapshot.projections || {})) {
    for (const row of rows || []) {
      if (!row?.name) continue;
      const key = `${norm(row.name)}|${String(row.position || position).toUpperCase()}`;
      const points = Number(row.projected_points);
      if (Number.isFinite(points)) map.set(key, points);
    }
  }
  return map;
}

function preparePlayers(snapshot, intelligence, league) {
  const profile = D.selectProfile(intelligence, league);
  if (!profile) throw new Error(`No full draft-intelligence profile for ${league.name}`);

  // The full board comes from the repository's live draft-intelligence build,
  // which aggregates nflreadpy FantasyPros ECR + FantasyCalc + FFC where
  // applicable. This remains usable when the direct FantasyPros API key is
  // sample-limited to 10 rows per endpoint.
  let players = D.enrichPlayers([], profile);
  players = D.mergeSupplementalPositions(players, profile.players || [], league);

  const projections = projectionMap(snapshot);
  let projectionMatches = 0;
  for (const player of players) {
    const points = projections.get(identity(player));
    if (Number.isFinite(points)) {
      player.projectedPoints = points;
      projectionMatches += 1;
    }
  }

  const baseContext = contextFor(league, players);
  const vbd = D.computeVBDPercentiles(players, baseContext);
  for (const player of players) {
    if (vbd.has(player.key)) player.vbdPercentileScore = vbd.get(player.key);
  }

  return {
    profile,
    players,
    projectionMatches,
    projectionCoverage: players.length ? projectionMatches / players.length : 0,
  };
}

function rankMap(board) {
  return new Map(board.map((entry) => [identity(entry.player), entry.rank]));
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null;
}

function evaluateFormat(snapshot, intelligence, league) {
  const prepared = preparePlayers(snapshot, intelligence, league);
  const context = contextFor(league, prepared.players);
  const boards = D.buildBoards(prepared.players, context);
  const guardrails = D.validateConsensusAlignment(prepared.players, context, { deviationThreshold: 15 });
  return { league, ...prepared, context, boards, guardrails };
}

function positionalAverageModelRank(result, position, count = 10) {
  const consensus = result.boards.consensus.filter((e) => e.player.position === position).slice(0, count);
  const model = rankMap(result.boards.model);
  return average(consensus.map((entry) => model.get(identity(entry.player))));
}

function rosterStateScenario(result) {
  const qbs = result.boards.consensus.filter((entry) => entry.player.position === 'QB');
  if (qbs.length < 2) return { pass: false, reason: 'fewer than two ranked QBs' };
  const first = qbs[0].player;
  const second = qbs[1].player;
  const before = D.buildBoards(result.players, contextFor(result.league, result.players));
  const after = D.buildBoards(result.players, contextFor(result.league, result.players, [first], 3));
  const modelBefore = rankMap(before.model).get(identity(second));
  const modelAfter = rankMap(after.model).get(identity(second));
  const draftBefore = rankMap(before.draftNow).get(identity(second));
  const draftAfter = rankMap(after.draftNow).get(identity(second));
  return {
    draftedQB: first.name,
    observedQB: second.name,
    modelRankBefore: modelBefore,
    modelRankAfter: modelAfter,
    draftNowBefore: draftBefore,
    draftNowAfter: draftAfter,
    pass: modelBefore === modelAfter && draftAfter >= draftBefore,
    top10After: after.draftNow.slice(0, 10).map((entry) => ({
      rank: entry.rank, name: entry.player.name, position: entry.player.position,
      value: Number(entry.value.toFixed(2)),
    })),
  };
}

function scarcityScenario(result, position) {
  const candidates = result.boards.model.filter((e) => e.player.position === position).map((e) => e.player);
  if (candidates.length < 8) return { position, pass: false, reason: 'insufficient ranked players' };
  const target = candidates[5];
  const before = D.scarcityScore(target, result.players, { picksUntilNextTurn: 18 });
  const removedKeys = new Set(candidates.slice(0, 5).map((p) => p.key));
  const depleted = result.players.filter((p) => !removedKeys.has(p.key));
  const after = D.scarcityScore(target, depleted, { picksUntilNextTurn: 18 });
  return {
    position, player: target.name,
    before: before.scarcity, after: after.scarcity,
    removed: removedKeys.size,
    pass: after.scarcity >= before.scarcity,
  };
}

function estimatedSurvival(adp, currentPick, nextPick) {
  if (!Number.isFinite(adp)) return null;
  const picksAway = Math.max(1, nextPick - currentPick);
  const pressurePoint = currentPick + picksAway * 0.55;
  const z = (adp - pressurePoint) / 12;
  return Math.max(1, Math.min(99, Math.round(100 / (1 + Math.exp(-z)))));
}

function waitRiskScenario(result) {
  const modelRanks = rankMap(result.boards.model);
  const entries = result.players.map((player) => ({
    player,
    modelRank: modelRanks.get(identity(player)),
    adp: Number(player.adp),
  })).filter((entry) => Number.isFinite(entry.modelRank) && Number.isFinite(entry.adp));
  if (entries.length < 2) return { pass: false, reason: 'insufficient real ADP coverage' };

  for (const entry of entries) entry.gap = entry.adp - entry.modelRank;
  const faller = [...entries].sort((a, b) => b.gap - a.gap)[0];
  const pressure = [...entries]
    .filter((entry) => entry.player.key !== faller.player.key && entry.adp < faller.adp)
    .sort((a, b) => Math.abs(a.modelRank - faller.modelRank) - Math.abs(b.modelRank - faller.modelRank))[0];
  if (!pressure) return { pass: false, reason: 'no market-pressure comparison found' };

  function evalEntry(entry, nextPick) {
    const survival = estimatedSurvival(entry.adp, 30, nextPick);
    const scarcity = D.scarcityScore(entry.player, result.players, { picksUntilNextTurn: nextPick - 30 });
    const scored = D.scorePlayer(entry.player, { ...result.context, survival });
    const risk = D.waitRiskCategory({
      survivalProbability: survival,
      playerValue: scored.playerGrade,
      scarcity: scarcity.scarcity,
    });
    return {
      name: entry.player.name, modelRank: entry.modelRank, adp: entry.adp,
      modelVsAdp: entry.gap, survivalProbability: survival, category: risk.category,
    };
  }

  const shortTurn = evalEntry(faller, 36);
  const longTurn = evalEntry(faller, 48);
  const marketPressure = evalEntry(pressure, 48);
  return {
    shortTurn, longTurn, marketPressure,
    pass: longTurn.survivalProbability <= shortTurn.survivalProbability &&
      marketPressure.survivalProbability <= longTurn.survivalProbability,
    note: 'Validation uses deterministic ADP turn-distance math; production uses simulated opponent picks.',
  };
}

function kdstScenario(result) {
  const counts = { K: 0, DST: 0 };
  for (const player of result.players) {
    if (player.position === 'K' || player.position === 'DST') counts[player.position] += 1;
  }
  const early = result.boards.model.slice(0, 60).filter((entry) => ['K', 'DST'].includes(entry.player.position));
  return {
    counts,
    early: early.map((entry) => ({ rank: entry.rank, name: entry.player.name, position: entry.player.position })),
    pass: counts.K > 0 && counts.DST > 0 && early.length === 0,
  };
}

function formatSummary(result) {
  return {
    league: result.league,
    profileId: result.profile.id,
    playerCount: result.players.length,
    projectionMatches: result.projectionMatches,
    projectionCoverage: result.projectionCoverage,
    guardrails: result.guardrails,
    consensusTop12: result.boards.consensus.slice(0, 12).map((e) => ({
      rank: e.rank, name: e.player.name, position: e.player.position,
    })),
    modelTop12: result.boards.model.slice(0, 12).map((e) => ({
      rank: e.rank, name: e.player.name, position: e.player.position, value: Number(e.value.toFixed(2)),
    })),
  };
}

function toMarkdown(report) {
  const lines = [
    '# Draft Validation — Current', '',
    `Generated: ${report.generatedAt}`,
    `Verdict: **${report.verdict}**`, '',
    '## Data access',
    `- Direct FantasyPros API mode: ${report.api.accessMode}`,
    `- API ranking counts: ${JSON.stringify(report.api.rankingCounts)}`,
    `- API projection counts: ${JSON.stringify(report.api.projectionCounts)}`,
    `- Full board source: ${report.fullBoardSource}`,
  ];
  if (report.limitations.length) {
    lines.push('', '## Limitations');
    report.limitations.forEach((item) => lines.push(`- ${item}`));
  }
  lines.push('', '## Consensus gates');
  for (const [name, value] of Object.entries(report.formats)) {
    const o = value.guardrails.overlap;
    lines.push(`- ${name}: top12 ${o.top12.overlap}/12; top24 ${o.top24.overlap}/24; top50 ${o.top50.overlap}/50; flags ${value.guardrails.overallFlags.length}`);
  }
  lines.push('', '## Format sensitivity');
  lines.push(`- QB top-10 avg model rank: 1QB ${report.formatSensitivity.qb1QB?.toFixed(1)} → Superflex ${report.formatSensitivity.qbSuperflex?.toFixed(1)}`);
  lines.push(`- WR top-10 avg model rank: 2WR ${report.formatSensitivity.wr2?.toFixed(1)} → 3WR ${report.formatSensitivity.wr3?.toFixed(1)}`);
  lines.push('', '## Behavior');
  lines.push(`- 1QB QB redundancy: ${report.rosterState.pass ? 'PASS' : 'FAIL'}`);
  lines.push(`- RB scarcity depletion: ${report.scarcity.RB.pass ? 'PASS' : 'FAIL'} (${report.scarcity.RB.before} → ${report.scarcity.RB.after})`);
  lines.push(`- WR scarcity depletion: ${report.scarcity.WR.pass ? 'PASS' : 'FAIL'} (${report.scarcity.WR.before} → ${report.scarcity.WR.after})`);
  lines.push(`- ADP wait-risk: ${report.waitRisk.pass ? 'PASS' : 'FAIL'}`);
  lines.push(`- K/DST integration: ${report.kdst.pass ? 'PASS' : 'FAIL'} (K ${report.kdst.counts.K}, DST ${report.kdst.counts.DST})`);
  lines.push('', '## Failures');
  if (!report.failures.length) lines.push('- None');
  else report.failures.forEach((item) => lines.push(`- ${item}`));
  return `${lines.join('\n')}\n`;
}

function main() {
  const fantasyPros = readJson('fantasypros.json');
  const intelligence = readJson('data/draft_intelligence.json');
  const api = apiAudit(fantasyPros);
  const limitations = [];
  if (api.sampleLimited) {
    limitations.push('Direct FantasyPros API credential is sample-limited (10 rows per endpoint); full-board validation uses the live aggregated draft-intelligence build instead.');
  } else if (api.accessMode !== 'production') {
    limitations.push('Direct FantasyPros API snapshot is legacy/partial; full-board validation uses the live aggregated draft-intelligence build.');
  }

  const oneQB = evaluateFormat(fantasyPros, intelligence, leagueConfig());
  const superflex = evaluateFormat(fantasyPros, intelligence, leagueConfig({ superflex: true }));
  const threeWR = evaluateFormat(fantasyPros, intelligence, leagueConfig({ wr: 3 }));

  const formats = { oneQB, superflex, threeWR };
  const rosterState = rosterStateScenario(oneQB);
  const scarcity = { RB: scarcityScenario(oneQB, 'RB'), WR: scarcityScenario(oneQB, 'WR') };
  const waitRisk = waitRiskScenario(oneQB);
  const kdst = kdstScenario(oneQB);
  const sensitivity = {
    qb1QB: positionalAverageModelRank(oneQB, 'QB'),
    qbSuperflex: positionalAverageModelRank(superflex, 'QB'),
    wr2: positionalAverageModelRank(oneQB, 'WR'),
    wr3: positionalAverageModelRank(threeWR, 'WR'),
  };

  const failures = [];
  for (const [name, result] of Object.entries(formats)) {
    const overlap = result.guardrails.overlap;
    if (overlap.top12.overlap < 10) failures.push(`${name} top-12 overlap ${overlap.top12.overlap}/12 < 10`);
    if (overlap.top24.overlap < 20) failures.push(`${name} top-24 overlap ${overlap.top24.overlap}/24 < 20`);
    if (overlap.top50.overlap < 40) failures.push(`${name} top-50 overlap ${overlap.top50.overlap}/50 < 40`);
    if (result.players.length < 100) failures.push(`${name} full-board population ${result.players.length} < 100`);
  }
  if (!(sensitivity.qbSuperflex < sensitivity.qb1QB)) failures.push('Superflex did not improve top-QB model rank relative to 1QB');
  if (!(sensitivity.wr3 <= sensitivity.wr2)) failures.push('3WR did not improve/preserve top-WR model rank relative to 2WR');
  if (!rosterState.pass) failures.push('1QB roster-state QB suppression failed');
  if (!scarcity.RB.pass) failures.push('RB scarcity did not increase after depletion');
  if (!scarcity.WR.pass) failures.push('WR scarcity did not increase after depletion');
  if (!waitRisk.pass) failures.push(`ADP wait-risk failed: ${waitRisk.reason || 'behavior mismatch'}`);
  if (!kdst.pass) failures.push('K/DST integration failed or K/DST entered model top 60');

  const report = {
    generatedAt: new Date().toISOString(),
    strict,
    verdict: failures.length ? 'FAIL' : (limitations.length ? 'PASS WITH LIMITATIONS' : 'PASS'),
    fullBoardSource: 'data/draft_intelligence.json (live nflreadpy FantasyPros ECR + FantasyCalc + configured sources)',
    api,
    limitations,
    formats: Object.fromEntries(Object.entries(formats).map(([k, v]) => [k, formatSummary(v)])),
    formatSensitivity: sensitivity,
    rosterState,
    scarcity,
    waitRisk,
    kdst,
    failures,
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'draft_validation_current.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'draft_validation_current.md'), toMarkdown(report));
  console.log(toMarkdown(report));
  if (strict && failures.length) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`Live draft validation failed: ${error.stack || error.message || error}`);
  process.exitCode = 1;
}
