const assert = require('assert');
const H = require('../js/draft-source-health.js');

const now = Date.parse('2026-08-11T23:10:00Z');
const base = {
  generated_at: '2026-08-11T18:21:13Z',
  profiles: { redraft_1qb_half: { players: [], projection_coverage: { status: 'complete', eligible_rate: 1, direct_players: 40, open_model_players: 200 } } },
  sources: [
    { id: 'fp', label: 'FantasyPros', status: 'ok', retrieved_at: '2026-08-11T18:21:16Z', record_count: 100 },
    { id: 'fc', label: 'FantasyCalc', status: 'ok', retrieved_at: '2026-08-11T18:21:36Z', record_count: 100 },
  ],
};

{
  const r = H.assessIntelligence(base, { now });
  assert.equal(r.level, H.LEVELS.FRESH);
  assert.equal(r.usable, true);
  assert.equal(r.healthySources, 2);
  assert.ok(r.ageHours > 4 && r.ageHours < 6);
  assert.equal(H.confidencePenalty(r), 0);
  assert.equal(r.completeProjectionProfiles, 1);
  assert.equal(r.minimumProjectionCoverage, 1);
  assert.ok(H.label(r).includes('1/1 projection profiles'));
}

{
  const incomplete = { ...base, profiles: { redraft_1qb_half: { players: [], projection_coverage: { status: 'incomplete', eligible_rate: .71 } } } };
  const r = H.assessIntelligence(incomplete, { now });
  assert.equal(r.level, H.LEVELS.DEGRADED);
  assert.ok(r.issues.some(x => x.includes('projection profile')));
}

{
  const stale = { ...base, generated_at: '2026-08-10T23:00:00Z', sources: base.sources.map(s => ({ ...s, retrieved_at: '2026-08-10T23:00:00Z' })) };
  const r = H.assessIntelligence(stale, { now });
  assert.equal(r.level, H.LEVELS.STALE);
  assert.equal(r.usable, true);
  assert.equal(H.confidencePenalty(r), 12);
}

{
  const expired = { ...base, generated_at: '2026-08-07T20:00:00Z', sources: base.sources.map(s => ({ ...s, retrieved_at: '2026-08-07T20:00:00Z' })) };
  const r = H.assessIntelligence(expired, { now });
  assert.equal(r.level, H.LEVELS.EXPIRED);
  assert.equal(r.usable, true);
  assert.equal(H.confidencePenalty(r), 25);
}

{
  const degraded = { ...base, sources: [{ ...base.sources[0] }, { ...base.sources[1], status: 'error' }] };
  const r = H.assessIntelligence(degraded, { now });
  assert.equal(r.level, H.LEVELS.DEGRADED);
  assert.ok(r.issues.some(x => x.includes('reporting failure')));
}

{
  const r = H.assessRuntime({ intelligence: base, marketOk: false, scoutingOk: true, newsOk: false }, { now });
  assert.equal(r.level, H.LEVELS.DEGRADED);
  assert.ok(r.issues.some(x => x.includes('Live market')));
  assert.ok(r.issues.some(x => x.includes('News/projections')));
}

{
  const r = H.assessIntelligence(null, { now });
  assert.equal(r.level, H.LEVELS.UNAVAILABLE);
  assert.equal(r.usable, false);
}

{
  const noProfiles = H.assessIntelligence({ ...base, profiles: {} }, { now });
  assert.equal(noProfiles.level, H.LEVELS.UNAVAILABLE);
  assert.equal(noProfiles.usable, false);
}

console.log('draft source health tests passed');
