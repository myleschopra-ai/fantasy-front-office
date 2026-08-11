#!/usr/bin/env python3
"""Apply the real-data calibration corrections discovered by CI.

This is intentionally a one-shot deterministic patch helper for the validation
branch. It refuses to run if the expected source blocks have drifted, so it
cannot silently mutate an unrelated engine version.
"""

from __future__ import annotations

from pathlib import Path


ENGINE = Path("js/draft-intelligence.js")
TESTS = Path("tests/draft-intelligence.test.js")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count == 0 and new in text:
        print(f"{label}: already applied")
        return text
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one source block, found {count}")
    print(f"{label}: applying")
    return text.replace(old, new, 1)


def main() -> None:
    engine = ENGINE.read_text(encoding="utf-8")
    tests = TESTS.read_text(encoding="utf-8")

    old_replacement = '''  function computeReplacementPoints(players, context) {
    const byPosition = {};
    (players || []).forEach((player) => {
      if (player.projectedPoints == null || !player.position) return;
      byPosition[player.position] = byPosition[player.position] || [];
      byPosition[player.position].push(player.projectedPoints);
    });
    const replacementPoints = {};
    Object.entries(byPosition).forEach(([position, points]) => {
      points.sort((a, b) => b - a);
      const rank = replacementRank(position, context);
      const index = Math.min(points.length - 1, Math.max(0, rank - 1));
      replacementPoints[position] = points.length ? points[index] : null;
    });
    return replacementPoints;
  }
'''
    new_replacement = '''  function computeReplacementPoints(players, context) {
    const byPosition = {};
    (players || []).forEach((player) => {
      if (player.projectedPoints == null || !player.position) return;
      byPosition[player.position] = byPosition[player.position] || [];
      byPosition[player.position].push(player.projectedPoints);
    });
    const replacementPoints = {};
    Object.entries(byPosition).forEach(([position, points]) => {
      points.sort((a, b) => b - a);
      const rank = replacementRank(position, context);
      // Fail closed on partial projection feeds. Clamping a 10-player sample
      // to its last row pretends that QB10/RB10/etc. is replacement level and
      // creates enormous fake VORP. No replacement point is better than a
      // fabricated one; vbdScore() has a league-aware rank fallback.
      if (points.length < rank) {
        replacementPoints[position] = null;
        return;
      }
      replacementPoints[position] = points[rank - 1];
    });
    return replacementPoints;
  }
'''
    engine = replace_once(engine, old_replacement, new_replacement, "replacement coverage")

    old_percentiles = '''  // Computes a 0-100 VORP percentile per player, relative to other players
  // at the SAME position (so a QB's raw point total, which runs much
  // higher than a TE's, is never compared on the same absolute scale).
  // Returns a Map from player key to percentile — attach the result to
  // each player as `.vbdPercentileScore` before scoring.
  function computeVBDPercentiles(players, context) {
    const replacementPoints = computeReplacementPoints(players, context);
    const byPosition = {};
    (players || []).forEach((player) => {
      if (player.projectedPoints == null || !player.position) return;
      const replacement = replacementPoints[player.position];
      if (replacement == null) return;
      const vorp = player.projectedPoints - replacement;
      byPosition[player.position] = byPosition[player.position] || [];
      byPosition[player.position].push({ key: player.key, vorp });
    });
    const result = {};
    Object.values(byPosition).forEach((list) => {
      const vorps = list.map((entry) => entry.vorp);
      const min = Math.min(...vorps);
      const max = Math.max(...vorps);
      const range = Math.max(1, max - min);
      list.forEach((entry) => {
        result[entry.key] = clamp(((entry.vorp - min) / range) * 100);
      });
    });
    return result;
  }
'''
    new_percentiles = '''  // Computes a 0-100 VORP percentile across the eligible SKILL-PLAYER pool.
  // VORP is already "points above replacement," so it is specifically the
  // cross-position quantity we want to compare. Normalizing independently
  // inside each position incorrectly makes QB1, TE1, K1 and DST1 all look
  // like 100-value assets even when their actual advantage over replacement
  // is radically different.
  //
  // This function also fails closed when the projection feed does not reach
  // replacement level for all four offensive skill positions. Mixing a few
  // true projected-point VORPs with rank-proxy VBD for the rest of the board
  // creates incompatible scales and was observed with the 10-row API sample.
  function computeVBDPercentiles(players, context) {
    const replacementPoints = computeReplacementPoints(players, context);
    const corePositions = ["QB", "RB", "WR", "TE"];
    if (corePositions.some((position) => replacementPoints[position] == null)) {
      return {};
    }

    const entries = [];
    (players || []).forEach((player) => {
      if (!corePositions.includes(player.position) || player.projectedPoints == null) return;
      const replacement = replacementPoints[player.position];
      if (replacement == null) return;
      entries.push({
        key: player.key,
        vorp: player.projectedPoints - replacement,
      });
    });
    if (!entries.length) return {};

    const vorps = entries.map((entry) => entry.vorp);
    const min = Math.min(...vorps);
    const max = Math.max(...vorps);
    const range = Math.max(1, max - min);
    const result = {};
    entries.forEach((entry) => {
      result[entry.key] = clamp(((entry.vorp - min) / range) * 100);
    });
    return result;
  }
'''
    engine = replace_once(engine, old_percentiles, new_percentiles, "cross-position VORP")

    old_vbd = '''  function vbdScore(player, context) {
    // Prefer real points-based VORP (precomputed pool-wide and attached to
    // the player) when available. Falls back to the previous rank-based
    // proxy when projection data hasn't loaded yet — same defensive
    // pattern used for pedigree/ageCurve, missing data never crashes.
    if (player.vbdPercentileScore != null) {
      return clamp(numeric(player.vbdPercentileScore, 50));
    }
    const replacement = replacementRank(player.position, context);
    const advantage = replacement - numeric(player.posRank, replacement);
    return clamp(45 + (advantage / Math.max(6, replacement)) * 55);
  }
'''
    new_vbd = '''  function vbdScore(player, context) {
    // Prefer real, pool-wide projected-point VORP when complete projection
    // coverage exists. Otherwise use the FORMAT-SPECIFIC overall board as
    // the fallback anchor; a positional rank proxy made every position's
    // No. 1 option look elite across positions and materially inflated TE,
    // K, DST, and 1QB quarterbacks.
    if (player.vbdPercentileScore != null) {
      return clamp(numeric(player.vbdPercentileScore, 50));
    }

    const poolSize = numeric(context.poolSize, 250);
    let score = percentileRank(
      numeric(player.overallRank || player.rank, poolSize),
      poolSize,
    );
    const roster = context.league?.roster || {};
    const superflex =
      numeric(roster.SUPER_FLEX, 0) > 0 || numeric(roster.QB, 1) > 1;
    if (player.position === "QB") score += superflex ? 10 : -4;
    if (player.position === "WR") {
      score += Math.max(0, numeric(roster.WR, 2) - 2) * 3;
      score += Math.max(0, numeric(roster.FLEX, 0)) * 0.75;
    }
    if (player.position === "RB") {
      score += Math.max(0, numeric(roster.FLEX, 0)) * 0.5;
    }
    // K/DST advantages over replacement are narrow and volatile. Without
    // full projections, never infer first-round-like value from K1/DST1.
    if (player.position === "K" || player.position === "DST") {
      score = Math.min(score, 18);
    }
    return clamp(score);
  }
'''
    engine = replace_once(engine, old_vbd, new_vbd, "league-aware VBD fallback")

    old_league = '''  function leagueValueScore(player, context = {}) {
    const grade = playerGrade(player);
    const vbd = vbdScore(player, context);
    return clamp(grade * 0.55 + vbd * 0.45);
  }
'''
    new_league = '''  function leagueValueScore(player, context = {}) {
    const grade = playerGrade(player);
    const vbd = vbdScore(player, context);
    // Consensus is the calibration anchor until proprietary signals prove
    // incremental value in backtests. Player Grade and league-aware VBD may
    // move a player, but neither may casually overwhelm a broad public board.
    const consensus = clamp(
      numeric(
        player.consensusScore,
        percentileRank(
          numeric(player.overallRank || player.rank, numeric(context.poolSize, 250)),
          numeric(context.poolSize, 250),
        ),
      ),
    );
    let value = consensus * 0.60 + grade * 0.20 + vbd * 0.20;
    // K/DST remain draftable and ranked within their positions, but their
    // high replacement availability means they should not enter early-round
    // cross-position Model territory in standard formats.
    if (player.position === "K" || player.position === "DST") {
      value = Math.min(value, 44);
    }
    return clamp(value);
  }
'''
    engine = replace_once(engine, old_league, new_league, "consensus-anchored league value")

    old_driver = '''          const evaluation = scorePlayer(entry.player, context);
          const c = evaluation.components;
          // Attribute the deviation to whichever component is furthest
          // from a neutral 50 — a real, inspectable driver, not a guess.
          const componentEntries = Object.entries(c).sort(
            (a, b) => Math.abs(b[1] - 50) - Math.abs(a[1] - 50),
          );
          flags.push({
            name: entry.player.name,
            position: entry.player.position,
            consensusRank,
            modelRank: modelEntry.rank,
            deviation,
            likelyDriver: componentEntries[0] ? componentEntries[0][0] : null,
            group: label,
          });
'''
    new_driver = '''          const evaluation = scorePlayer(entry.player, context);
          // Model/League Value is roster-independent, so attribution must
          // only inspect inputs that can actually move League Value. The old
          // diagnostic looked at Pick Utility components such as `need` and
          // incorrectly blamed roster state for Model-board deviations.
          const leagueDrivers = {
            consensus: clamp(numeric(entry.player.consensusScore, 50)),
            playerGrade: evaluation.playerGrade,
            vbd: vbdScore(entry.player, context),
          };
          const driverEntries = Object.entries(leagueDrivers).sort(
            (a, b) => Math.abs(b[1] - leagueDrivers.consensus) -
              Math.abs(a[1] - leagueDrivers.consensus),
          );
          flags.push({
            name: entry.player.name,
            position: entry.player.position,
            consensusRank,
            modelRank: modelEntry.rank,
            deviation,
            likelyDriver: driverEntries[0] ? driverEntries[0][0] : null,
            leagueDrivers,
            group: label,
          });
'''
    engine = replace_once(engine, old_driver, new_driver, "model deviation attribution")

    old_vbd_test = '''const vbdPercentiles = D.computeVBDPercentiles(vorpPool, smallLeague);
assert.ok(
  vbdPercentiles.qb1 > vbdPercentiles.qb35,
  'the highest-projected QB must have a higher VBD percentile than the lowest',
);
assert.ok(
  vbdPercentiles.qb1 >= 0 && vbdPercentiles.qb1 <= 100,
  'VBD percentile must be normalized to 0-100',
);
'''
    new_vbd_test = '''const vbdPercentilesIncomplete = D.computeVBDPercentiles(vorpPool, smallLeague);
assert.deepEqual(
  vbdPercentilesIncomplete,
  {},
  'partial projections that do not reach replacement level across QB/RB/WR/TE must fail closed instead of mixing true VORP with rank proxies',
);

// Complete projection fixture: raw points-over-replacement must be comparable
// ACROSS positions, not re-normalized so every positional No. 1 equals 100.
const completeVorpPool = [];
for (const [position, top, step, count] of [
  ['QB', 360, 4, 24],
  ['RB', 300, 5, 30],
  ['WR', 285, 4, 30],
  ['TE', 230, 4, 20],
]) {
  for (let i = 0; i < count; i += 1) {
    completeVorpPool.push({
      key: `${position.toLowerCase()}-complete-${i + 1}`,
      position,
      projectedPoints: top - i * step,
    });
  }
}
const completeLeague = {
  teams: 8,
  league: { roster: { QB: 1, RB: 1, WR: 1, TE: 1 } },
  targets: D.starterTargets({ roster: { QB: 1, RB: 1, WR: 1, TE: 1 } }),
};
const completeVbd = D.computeVBDPercentiles(completeVorpPool, completeLeague);
assert.ok(
  Object.keys(completeVbd).length > 0,
  'complete replacement-level projection coverage must activate real projected-point VORP',
);
assert.ok(
  completeVbd['qb-complete-1'] !== completeVbd['te-complete-1'],
  'cross-position VORP must not force QB1 and TE1 to the same 100 score merely because each is first at his position',
);
assert.ok(
  completeVbd['qb-complete-1'] >= 0 && completeVbd['qb-complete-1'] <= 100,
  'global VORP percentile must remain normalized to 0-100',
);

// K/DST fallback VBD must never inherit a near-100 positional-rank score.
const earlyK = { key: 'early-k', name: 'Early K', position: 'K', overallRank: 70, posRank: 1, consensusScore: 72, tier: 1 };
const earlyKLeagueValue = D.leagueValueScore(earlyK, {
  league: kdstLeague, teams: 12, poolSize: 250, targets: kdstTargets,
});
assert.ok(
  earlyKLeagueValue <= 44,
  `K/DST league value must be capped below early-round skill-player territory; got ${earlyKLeagueValue}`,
);
'''
    tests = replace_once(tests, old_vbd_test, new_vbd_test, "VORP/KDST regression tests")

    ENGINE.write_text(engine, encoding="utf-8")
    TESTS.write_text(tests, encoding="utf-8")
    print("Draft calibration patch complete")


if __name__ == "__main__":
    main()
