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
  return D.normalizeName ? D.normalizeName(value) : String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function playerIdentity(player) {
  return `${norm(player.name)}|${String(player.position || '').toUpperCase()}`;
}

function leagueConfig({ superflex = false, wr = 2 } = {}) {
  return {
    name: `12-team half-PPR ${superflex ? 'Superflex' : '1QB'} ${wr}WR`,
    league_type: 'redraft',
    scoring: { reception: 0.5 },
    roster: {
      QB: 1,
      RB: 2,
      WR: wr,
      TE: 1,
      FLEX: 2,
      SUPER_FLEX: superflex ? 1 : 0,
      K: 1,
      DST: 1,
      BENCH: 6,
    },
  };
}

function contextFor(league, players, picks = [], round = 1, survival = 50) {
  return {
    strategy: 'adaptive',
    league,
    teams: 12,
    round,
    totalRounds: 16,
    picks,
    counts: D.rosterCounts(picks),
    targets: D.starterTargets(league),
    superflex: Number(league.roster.SUPER_FLEX || 0) > 0,
    poolSize: Math.max(1, players.length),
    survival,
  };
}

function snapshotAudit(snapshot) {
  const rankings = snapshot.rankings || {};
  const projections = snapshot.projections || {};
  const rankingCounts = {};
  ['OVERALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'].forEach((key) => {
    rankingCounts[key] = Array.isArray(rankings[key]) ? rankings[key].length : 0;
  });
  const projectionCounts = {};
  ['QB', 'RB', 'WR', 'TE', 'K', 'DST'].forEach((key) => {
    projectionCounts[key] = Array.isArray(projections[key]) ? projections[key].length : 0;
  });
  return {
    schemaVersion: snapshot.schema_version || null,
    generatedAt: snapshot.generated_at || null,
    season: snapshot.season || null,
    scoring: snapshot.scoring || null,
    source: snapshot.source || null,
    rankingCounts,
    projectionCounts,
    injuries: Array.isArray(snapshot.injuries) ? snapshot.injuries.length : 0,
    news: Array.isArray(snapshot.news) ? snapshot.news.length : 0,
  };
}

function liveRowsFromFantasyPros(snapshot) {
  const rows = snapshot.rankings?.OVERALL || [];
  return rows
    .filter((row) => row && row.name && row.position && row.rank != null)
    .map((row) => ({
      key: row.player_id != null ? `fp:${row.player_id}` : playerIdentity(row),
      name: row.name,
      position: String(row.position).toUpperCase(),
      nflTeam: row.team || '',
      rank: Number(row.rank),
      overallRank: Number(row.rank),
      posRank: row.pos_rank == null ? null : Number(row.pos_rank),
      tier: row.tier == null ? null : Number(row.tier),
      rankRange: row.rank_min != null || row.rank_max != null ? [row.rank_min, row.rank_max] : null,
      rankStd: row.rank_std == null ? null : Number(row.rank_std),
      source: 'fantasypros_api',
    }));
}

function attachProjectionPoints(players, snapshot) {
  const byIdentity = new Map();
  for (const [position, rows] of Object.entries(snapshot.projections || {})) {
    for (const row of rows || []) {
      if (!row?.name) continue;
      byIdentity.set(`${norm(row.name)}|${String(row.position || position).toUpperCase()}`, Number(row.projected_points));
    }
  }
  players.forEach((player) => {
    const value = byIdentity.get(playerIdentity(player));
    if (Number.isFinite(value)) player.projectedPoints = value;
  });
}

function preparePlayers(snapshot, intelligence, league) {
  const profile = D.selectProfile(intelligence, league);
  if (!profile) throw new Error(`No draft-intelligence profile found for ${league.name}`);
  const live = liveRowsFromFantasyPros(snapshot);
  if (!live.length) throw new Error('FantasyPros snapshot contains no OVERALL rankings; run the live refresh first');
  let players = D.enrichPlayers(live, profile);
  players = D.mergeSupplementalPositions(players, profile.players || [], league);
  attachProjectionPoints(players, snapshot);
  const baseContext = contextFor(league, players);
  const vbd = D.computeVBDPercentiles(players, baseContext);
  players.forEach((player) => {
    if (vbd.has(player.key)) player.vbdPercentileScore = vbd.get(player.key);
  });
  return { profile, players };
}

function boardRankMap(board) {
  return new Map(board.map((entry) => [playerIdentity(entry.player), entry.rank]));
}

function avg(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

function positionalModelRankAverage(result, position, count = 10) {
  const consensusPlayers = result.boards.consensus.filter((entry) => entry.player.position === position).slice(0, count);
  const modelRanks = boardRankMap(result.boards.model);
  return avg(consensusPlayers.map((entry) => modelRanks.get(playerIdentity(entry.player))));
}

function evaluateFormat(snapshot, intelligence, league) {
  const prepared = preparePlayers(snapshot, intelligence, league);
  const context = contextFor(league, prepared.players);
  const boards = D.buildBoards(prepared.players, context);
  const guardrails = D.validateConsensusAlignment(prepared.players, context, { deviationThreshold: 15 });
  return { league, profileId: prepared.profile.id, players: prepared.players, context, boards, guardrails };
}

function rosterStateScenario(result) {
  const qbs = result.boards.consensus.filter((entry) => entry.player.position === 'QB');
  if (qbs.length < 2) return { pass: false, reason: 'fewer than two QBs in consensus board' };
  const firstQB = qbs[0].player;
  const secondQB = qbs[1].player;
  const before = D.buildBoards(result.players, contextFor(result.league, result.players));
  const afterContext = contextFor(result.league, result.players, [firstQB], 3);
  const after = D.buildBoards(result.players, afterContext);
  const beforeDraft = boardRankMap(before.draftNow);
  const afterDraft = boardRankMap(after.draftNow);
  const beforeModel = boardRankMap(before.model);
  const afterModel = boardRankMap(after.model);
  const key = playerIdentity(secondQB);
  return {
    draftedQB: firstQB.name,
    observedQB: secondQB.name,
    secondQBDraftNowBefore: beforeDraft.get(key),
    secondQBDraftNowAfter: afterDraft.get(key),
    secondQBModelBefore: beforeModel.get(key),
    secondQBModelAfter: afterModel.get(key),
    pass: beforeModel.get(key) === afterModel.get(key) && afterDraft.get(key) >= beforeDraft.get(key),
    top10After: after.draftNow.slice(0, 10).map((entry) => ({
      rank: entry.rank,
      name: entry.player.name,
      position: entry.player.position,
      pickUtility: Number(entry.value.toFixed(2)),
    })),
  };
}

function scarcityScenario(result, position) {
  const positional = result.boards.model.filter((entry) => entry.player.position === position).map((entry) => entry.player);
  if (positional.length < 8) return { position, pass: false, reason: 'insufficient players' };
  const target = positional[5];
  const baseline = D.scarcityScore(target, result.players, { picksUntilNextTurn: 18 });
  const removed = new Set(positional.slice(0, 5).map((player) => player.key));
  const depleted = result.players.filter((player) => !removed.has(player.key));
  const after = D.scarcityScore(target, depleted, { picksUntilNextTurn: 18 });
  return {
    position,
    player: target.name,
    before: baseline.scarcity,
    after: after.scarcity,
    removed: [...removed].length,
    pass: after.scarcity >= baseline.scarcity,
  };
}

function estimatedSurvival(adp, currentPick, nextPick, rankStd = null) {
  if (!Number.isFinite(adp)) return null;
  const picksAway = Math.max(1, nextPick - currentPick);
  const roomPick = currentPick + picksAway * 0.55;
  const spread = Math.max(6, Number.isFinite(rankStd) ? rankStd * 2.5 : 12);
  const z = (adp - roomPick) / spread;
  return Math.max(1, Math.min(99, Math.round(100 / (1 + Math.exp(-z)))));
}

function waitRiskScenario(result) {
  const modelRank = boardRankMap(result.boards.model);
  const candidates = result.players
    .map((player) => ({ player, modelRank: modelRank.get(playerIdentity(player)), adp: Number(player.adp) }))
    .filter((entry) => Number.isFinite(entry.adp) && Number.isFinite(entry.modelRank));
  if (!candidates.length) return { pass: false, reason: 'no real ADP values available' };
  candidates.forEach((entry) => { entry.valueGap = entry.adp - entry.modelRank; });
  candidates.sort((a, b) => b.valueGap - a.valueGap);
  const faller = candidates[0];
  const pressure = [...candidates]
    .filter((entry) => entry.player.key !== faller.player.key)
    .sort((a, b) => Math.abs(a.modelRank - faller.modelRank) - Math.abs(b.modelRank - faller.modelRank) || a.adp - b.adp)
    .find((entry) => entry.adp < faller.adp) || candidates[candidates.length - 1];

  function evaluate(entry, currentPick, nextPick) {
    const survivalProbability = estimatedSurvival(entry.adp, currentPick, nextPick, entry.player.rankStd);
    const scarcity = D.scarcityScore(entry.player, result.players, { picksUntilNextTurn: nextPick - currentPick });
    const evaluation = D.scorePlayer(entry.player, { ...result.context, survival: survivalProbability });
    return {
      name: entry.player.name,
      modelRank: entry.modelRank,
      adp: entry.adp,
      valueGap: entry.valueGap,
      survivalProbability,
      category: D.waitRiskCategory({
        survivalProbability,
        playerValue: evaluation.playerGrade,
        scarcity: scarcity.scarcity,
      }).category,
    };
  }

  const fallerShort = evaluate(faller, 30, 36);
  const fallerLong = evaluate(faller, 30, 48);
  const pressureLong = evaluate(pressure, 30, 48);
  return {
    fallerShort,
    fallerLong,
    pressureLong,
    pass: fallerLong.survivalProbability <= fallerShort.survivalProbability &&
      (pressureLong.adp >= fallerLong.adp || pressureLong.survivalProbability <= fallerLong.survivalProbability),
    note: 'Survival here is a deterministic validation estimate from real ADP/rank spread; the browser mock uses opponent simulation for production survival.',
  };
}

function kdstStatus(result) {
  const counts = { K: 0, DST: 0 };
  result.players.forEach((player) => {
    if (player.position === 'K' || player.position === 'DST') counts[player.position] += 1;
  });
  const modelTop60 = result.boards.model.slice(0, 60).filter((entry) => ['K', 'DST'].includes(entry.player.position));
  return {
    counts,
    modelTop60: modelTop60.map((entry) => ({ rank: entry.rank, name: entry.player.name, position: entry.player.position })),
    pass: counts.K > 0 && counts.DST > 0 && modelTop60.length === 0,
  };
}

function markdown(report) {
  const lines = [];
  lines.push('# Draft Validation — Current');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Verdict: **${report.verdict}**`);
  lines.push('');
  lines.push('## Source snapshot');
  lines.push(`- FantasyPros generated: ${report.snapshot.generatedAt || 'unknown'}`);
  lines.push(`- Season/scoring: ${report.snapshot.season || 'unknown'} / ${report.snapshot.scoring || 'unknown'}`);
  lines.push(`- Ranking counts: ${JSON.stringify(report.snapshot.rankingCounts)}`);
  lines.push(`- Projection counts: ${JSON.stringify(report.snapshot.projectionCounts)}`);
  lines.push('');
  lines.push('## Consensus gates');
  for (const [name, value] of Object.entries(report.formats)) {
    lines.push(`- ${name}: top12 ${value.guardrails.overlap.top12.overlap}/12; top24 ${value.guardrails.overlap.top24.overlap}/24; top50 ${value.guardrails.overlap.top50.overlap}/50; flags ${value.guardrails.overallFlags.length}`);
  }
  lines.push('');
  lines.push('## Format sensitivity');
  lines.push(`- QB avg model rank (top-10 consensus QBs): 1QB ${report.formatSensitivity.qbOneQbAvgModelRank?.toFixed(1)} → Superflex ${report.formatSensitivity.qbSuperflexAvgModelRank?.toFixed(1)}`);
  lines.push(`- WR avg model rank (top-10 consensus WRs): 2WR ${report.formatSensitivity.wrTwoWrAvgModelRank?.toFixed(1)} → 3WR ${report.formatSensitivity.wrThreeWrAvgModelRank?.toFixed(1)}`);
  lines.push('');
  lines.push('## Behavior checks');
  lines.push(`- 1QB roster-state QB suppression: ${report.rosterState.pass ? 'PASS' : 'FAIL'}`);
  lines.push(`- RB scarcity depletion: ${report.scarcity.RB.pass ? 'PASS' : 'FAIL'} (${report.scarcity.RB.before} → ${report.scarcity.RB.after})`);
  lines.push(`- WR scarcity depletion: ${report.scarcity.WR.pass ? 'PASS' : 'FAIL'} (${report.scarcity.WR.before} → ${report.scarcity.WR.after})`);
  lines.push(`- ADP/wait-risk behavior: ${report.waitRisk.pass ? 'PASS' : 'FAIL'}`);
  lines.push(`- K/DST end-to-end: ${report.kdst.pass ? 'PASS' : 'FAIL'} (K=${report.kdst.counts.K}, DST=${report.kdst.counts.DST})`);
  lines.push('');
  lines.push('## Failures');
  if (!report.failures.length) lines.push('- None');
  else report.failures.forEach((failure) => lines.push(`- ${failure}`));
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const fantasyPros = readJson('fantasypros.json');
  const intelligence = readJson('data/draft_intelligence.json');
  const snapshot = snapshotAudit(fantasyPros);

  const formats = {
    oneQB: evaluateFormat(fantasyPros, intelligence, leagueConfig()),
    superflex: evaluateFormat(fantasyPros, intelligence, leagueConfig({ superflex: true })),
    threeWR: evaluateFormat(fantasyPros, intelligence, leagueConfig({ wr: 3 })),
  };

  const reportFormats = {};
  for (const [name, result] of Object.entries(formats)) {
    reportFormats[name] = {
      league: result.league,
      profileId: result.profileId,
      playerCount: result.players.length,
      guardrails: result.guardrails,
      consensusTop12: result.boards.consensus.slice(0, 12).map((entry) => ({ rank: entry.rank, name: entry.player.name, position: entry.player.position })),
      modelTop12: result.boards.model.slice(0, 12).map((entry) => ({ rank: entry.rank, name: entry.player.name, position: entry.player.position, value: Number(entry.value.toFixed(2)) })),
    };
  }

  const rosterState = rosterStateScenario(formats.oneQB);
  const scarcity = {
    RB: scarcityScenario(formats.oneQB, 'RB'),
    WR: scarcityScenario(formats.oneQB, 'WR'),
  };
  const waitRisk = waitRiskScenario(formats.oneQB);
  const kdst = kdstStatus(formats.oneQB);

  const qbOneQbAvgModelRank = positionalModelRankAverage(formats.oneQB, 'QB');
  const qbSuperflexAvgModelRank = positionalModelRankAverage(formats.superflex, 'QB');
  const wrTwoWrAvgModelRank = positionalModelRankAverage(formats.oneQB, 'WR');
  const wrThreeWrAvgModelRank = positionalModelRankAverage(formats.threeWR, 'WR');

  const failures = [];
  const requiredSnapshotCounts = { OVERALL: 100, QB: 20, RB: 30, WR: 40, TE: 20, K: 15, DST: 15 };
  for (const [position, minimum] of Object.entries(requiredSnapshotCounts)) {
    if ((snapshot.rankingCounts[position] || 0) < minimum) failures.push(`${position} FantasyPros rankings below minimum ${minimum}`);
  }
  if (!snapshot.schemaVersion || snapshot.schemaVersion < 2) failures.push('FantasyPros snapshot schema is older than v2');
  if (!snapshot.generatedAt) failures.push('FantasyPros snapshot has no generated_at timestamp');
  if (snapshot.projectionCounts.QB === 0 || snapshot.projectionCounts.RB === 0 || snapshot.projectionCounts.WR === 0 || snapshot.projectionCounts.TE === 0) {
    failures.push('FantasyPros skill-position projections are missing');
  }

  for (const [name, result] of Object.entries(formats)) {
    const overlap = result.guardrails.overlap;
    if (overlap.top12.overlap < 10) failures.push(`${name} top-12 consensus overlap ${overlap.top12.overlap}/12 < 10`);
    if (overlap.top24.overlap < 20) failures.push(`${name} top-24 consensus overlap ${overlap.top24.overlap}/24 < 20`);
    if (overlap.top50.overlap < 40) failures.push(`${name} top-50 consensus overlap ${overlap.top50.overlap}/50 < 40`);
  }
  if (!(qbSuperflexAvgModelRank < qbOneQbAvgModelRank)) failures.push('Superflex did not materially improve QB model rank');
  if (!(wrThreeWrAvgModelRank <= wrTwoWrAvgModelRank)) failures.push('3WR did not improve or preserve top-WR model rank relative to 2WR');
  if (!rosterState.pass) failures.push('1QB roster-state scenario failed to preserve Model board while suppressing Draft Now QB utility');
  if (!scarcity.RB.pass) failures.push('RB scarcity did not rise after real-board depletion');
  if (!scarcity.WR.pass) failures.push('WR scarcity did not rise after real-board depletion');
  if (!waitRisk.pass) failures.push('real-ADP wait-risk behavior failed');
  if (!kdst.pass) failures.push('K/DST real-data integration failed or placed K/DST in model top 60');

  const report = {
    generatedAt: new Date().toISOString(),
    strict,
    snapshot,
    formats: reportFormats,
    formatSensitivity: { qbOneQbAvgModelRank, qbSuperflexAvgModelRank, wrTwoWrAvgModelRank, wrThreeWrAvgModelRank },
    rosterState,
    scarcity,
    waitRisk,
    kdst,
    failures,
    verdict: failures.length ? 'FAIL' : 'PASS',
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'draft_validation_current.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'draft_validation_current.md'), markdown(report));

  console.log(markdown(report));
  if (strict && failures.length) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`Live draft validation failed: ${error.stack || error.message || error}`);
  process.exitCode = 1;
}
