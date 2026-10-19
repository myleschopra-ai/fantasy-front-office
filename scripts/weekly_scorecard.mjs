#!/usr/bin/env node
// Weekly scorecard and in-season decision ledger.
//
// For every completed week it replays the lineup the dashboard would have set
// from that week's own projection snapshot (data/weekly_projections/<season>-wNN.json)
// against what each manager started and what scored, then writes
//   data/scorecards/<season>-wNN.json   per-week detail
//   data/scorecards/<season>-summary.json
//   data/ledger/<season>-wNN.jsonl      one lineup recommendation per team
// The upcoming week's recommendations are logged as PENDING and resolved on
// the next run after its results post. Runs in GitHub Actions, where the
// Sleeper API is reachable; --fixture-dir replays a captured copy instead.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Scorecard = require("../js/weekly-scorecard.js");

function args(argv) {
  const out = { season: new Date().getUTCFullYear(), league: "1337549680476721152", roster: "9", out: "data/scorecards", ledger: "data/ledger", snapshots: "data/weekly_projections", snapshot: null, fixtureDir: null, benchmark: true, label: null };
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const next = () => argv[++index];
    if (key === "--season") out.season = Number(next());
    else if (key === "--league") out.league = String(next());
    else if (key === "--roster") out.roster = String(next());
    else if (key === "--out") out.out = next();
    else if (key === "--ledger") out.ledger = next();
    else if (key === "--snapshots") out.snapshots = next();
    else if (key === "--snapshot") out.snapshot = next();
    else if (key === "--fixture-dir") out.fixtureDir = next();
    else if (key === "--label") out.label = next();
    else if (key === "--no-benchmark") out.benchmark = false;
    else throw new Error(`Unknown argument ${key}`);
  }
  return out;
}

async function getJson(url, attempts = 3) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "user-agent": "fantasy-front-office-scorecard" } });
      if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      last = error;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw last;
}

function source(options) {
  if (options.fixtureDir) {
    const read = name => JSON.parse(fs.readFileSync(path.join(options.fixtureDir, name), "utf8"));
    return {
      league: async () => read("league.json"),
      rosters: async () => read("rosters.json"),
      players: async () => read("players.json"),
      matchups: async week => { try { return read(`matchups-${week}.json`); } catch { return []; } },
      benchmark: async week => { try { return read(`benchmark-${week}.json`); } catch { return null; } },
    };
  }
  const base = "https://api.sleeper.app/v1";
  return {
    league: () => getJson(`${base}/league/${options.league}`),
    rosters: () => getJson(`${base}/league/${options.league}/rosters`),
    players: () => getJson(`${base}/players/nfl`),
    matchups: week => getJson(`${base}/league/${options.league}/matchups/${week}`),
    benchmark: async week => {
      if (!options.benchmark) return null;
      try {
        const rows = await getJson(`https://api.sleeper.com/projections/nfl/${options.season}/${week}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE`);
        return Object.fromEntries(rows.filter(row => row?.player_id).map(row => [String(row.player_id), row?.stats?.pts_half_ppr ?? null]));
      } catch (error) {
        console.warn(`Benchmark projections unavailable for week ${week}: ${error.message}`);
        return null;
      }
    },
  };
}

const pad = week => String(week).padStart(2, "0");
const stable = value => JSON.stringify(value, null, 2) + "\n";

// Writes only when the content (ignoring the volatile scored_at stamp) changed,
// so a rerun with nothing new does not create a commit.
function writeIfChanged(file, payload) {
  const strip = value => { const copy = { ...value }; delete copy.scored_at; return JSON.stringify(copy); };
  if (fs.existsSync(file)) {
    try { if (strip(JSON.parse(fs.readFileSync(file, "utf8"))) === strip(payload)) return false; } catch { /* rewrite */ }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stable(payload));
  return true;
}

function writeLines(file, rows) {
  const text = rows.map(row => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return true;
}

function readSnapshot(file) {
  if (!file || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function main() {
  const options = args(process.argv);
  const api = source(options);
  const [league, rosters, directory] = await Promise.all([api.league(), api.rosters(), api.players()]);
  const players = Object.fromEntries(Object.entries(directory).map(([id, player]) => [id, { position: player?.position || null }]));
  const positions = league.roster_positions || [];
  const played = rosters.reduce((most, roster) => Math.max(most, Number(roster.settings?.wins || 0) + Number(roster.settings?.losses || 0) + Number(roster.settings?.ties || 0)), 0);
  const label = options.label ? `-${options.label}` : "";
  const history = {};
  const summary = [];
  let changed = 0;

  for (let week = 1; week <= played; week += 1) {
    const entries = await api.matchups(week);
    const snapshotPath = options.snapshot || path.join(options.snapshots, `${options.season}-w${pad(week)}.json`);
    const snapshot = readSnapshot(snapshotPath);
    if (snapshot && entries.length) {
      const benchmarkPoints = await api.benchmark(week);
      const benchmark = benchmarkPoints ? new Map(Object.entries(benchmarkPoints).map(([id, points]) => [id, { points }])) : null;
      const scored = Scorecard.scoreWeek({ week, entries, players, projections: Scorecard.snapshotIndex(snapshot), benchmark, rosterPositions: positions, history });
      const meta = { path: snapshotPath, generated_at: snapshot.generated_at || null, evidence_cutoff: snapshot.evidence_cutoff || null, model_version: snapshot.model_version || null };
      const payload = { schema_version: 1, season: options.season, week, league_id: options.league, my_roster_id: Number(options.roster), snapshot: meta, scored_at: new Date().toISOString(), ...scored };
      if (writeIfChanged(path.join(options.out, `${options.season}-w${pad(week)}${label}.json`), payload)) changed += 1;
      if (!label && writeLines(path.join(options.ledger, `${options.season}-w${pad(week)}.jsonl`), Scorecard.ledgerRecords({ season: options.season, week, leagueId: options.league, scored, snapshotMeta: meta }))) changed += 1;
      const mine = scored.teams.find(team => String(team.roster_id) === String(options.roster)) || null;
      summary.push({ week, snapshot_generated_at: meta.generated_at, model_version: meta.model_version, league: scored.league, projection_error: scored.projection_error, mine });
    } else {
      summary.push({ week, skipped: snapshot ? "NO_MATCHUPS" : "NO_SNAPSHOT", snapshot: snapshotPath });
    }
    entries.forEach(entry => Object.entries(entry.players_points || {}).forEach(([id, points]) => {
      if (!(entry.starters || []).includes(id) && !(Number(points) > 0)) return;
      (history[id] ||= []).push(Number(points) || 0);
    }));
  }

  // Log the upcoming week's recommendations before its games are played.
  const upcoming = played + 1;
  const upcomingSnapshotPath = path.join(options.snapshots, `${options.season}-w${pad(upcoming)}.json`);
  const upcomingSnapshot = !label && readSnapshot(upcomingSnapshotPath);
  if (upcomingSnapshot) {
    const projections = Scorecard.snapshotIndex(upcomingSnapshot);
    const pending = rosters.map(roster => {
      const lineup = Scorecard.lineupFor({ playerIds: (roster.players || []).map(String), players, projections, rosterPositions: positions });
      return { roster_id: roster.roster_id, dashboard_starters: lineup.starters, dashboard_projected: lineup.projected, dashboard_unprojected_starters: lineup.starters.filter(id => !projections.has(id)).length };
    });
    const meta = { path: upcomingSnapshotPath, generated_at: upcomingSnapshot.generated_at || null, evidence_cutoff: upcomingSnapshot.evidence_cutoff || null, model_version: upcomingSnapshot.model_version || null };
    if (writeLines(path.join(options.ledger, `${options.season}-w${pad(upcoming)}.jsonl`), Scorecard.ledgerRecords({ season: options.season, week: upcoming, leagueId: options.league, pending, snapshotMeta: meta }))) changed += 1;
  }

  const scoredWeeks = summary.filter(row => row.league);
  const totals = key => scoredWeeks.length ? Math.round(scoredWeeks.reduce((sum, row) => sum + Number(row.league[key] || 0), 0) / scoredWeeks.length * 100) / 100 : null;
  const summaryPayload = {
    schema_version: 1, season: options.season, league_id: options.league, my_roster_id: Number(options.roster), weeks_scored: scoredWeeks.length,
    scored_at: new Date().toISOString(),
    season_to_date: {
      actual: totals("actual"), dashboard: totals("dashboard"), optimal: totals("optimal"), benchmark: totals("benchmark"),
      dashboard_minus_actual: totals("dashboard_minus_actual"),
      wins_flipped_to_losses: scoredWeeks.reduce((sum, row) => sum + row.league.wins_flipped_to_losses, 0),
      losses_flipped_to_wins: scoredWeeks.reduce((sum, row) => sum + row.league.losses_flipped_to_wins, 0),
    },
    weeks: summary,
  };
  if (writeIfChanged(path.join(options.out, `${options.season}-summary${label}.json`), summaryPayload)) changed += 1;
  console.log(JSON.stringify({ weeks_played: played, weeks_scored: scoredWeeks.length, files_changed: changed, season_to_date: summaryPayload.season_to_date }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
