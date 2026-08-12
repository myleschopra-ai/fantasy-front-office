(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FFODraftSourceHealth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LEVELS = Object.freeze({
    FRESH: 'FRESH',
    DEGRADED: 'DEGRADED',
    STALE: 'STALE',
    EXPIRED: 'EXPIRED',
    UNAVAILABLE: 'UNAVAILABLE',
  });

  const DEFAULT_THRESHOLDS = Object.freeze({ freshHours: 12, expiredHours: 72 });

  function timestampMs(value) {
    const ms = Date.parse(value || '');
    return Number.isFinite(ms) ? ms : null;
  }

  function ageHours(value, now = Date.now()) {
    const ms = timestampMs(value);
    if (ms == null) return null;
    return Math.max(0, (Number(now) - ms) / 36e5);
  }

  function freshnessFor(value, now = Date.now(), thresholds = DEFAULT_THRESHOLDS) {
    const age = ageHours(value, now);
    if (age == null) return { level: LEVELS.UNAVAILABLE, ageHours: null };
    if (age > thresholds.expiredHours) return { level: LEVELS.EXPIRED, ageHours: age };
    if (age > thresholds.freshHours) return { level: LEVELS.STALE, ageHours: age };
    return { level: LEVELS.FRESH, ageHours: age };
  }

  function sourceTimestamp(source) {
    return source?.retrieved_at || source?.retrievedAt || source?.generated_at || source?.generatedAt || null;
  }

  function assessIntelligence(data, options = {}) {
    const now = options.now ?? Date.now();
    const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) };
    if (!data || typeof data !== 'object') {
      return { level: LEVELS.UNAVAILABLE, usable: false, ageHours: null, issues: ['Consensus dataset unavailable'], sources: [] };
    }

    const generatedAt = data.generated_at || data.generatedAt || null;
    const rootFreshness = freshnessFor(generatedAt, now, thresholds);
    const rawSources = Array.isArray(data.sources) ? data.sources : [];
    const sources = rawSources.map((source) => {
      const freshness = freshnessFor(sourceTimestamp(source), now, thresholds);
      const status = String(source?.status || 'unknown').toLowerCase();
      const ok = status === 'ok' || status === 'ready' || status === 'success';
      return {
        id: source?.id || source?.label || 'unknown',
        label: source?.label || source?.id || 'Unknown source',
        status,
        ok,
        level: freshness.level,
        ageHours: freshness.ageHours,
        recordCount: Number(source?.record_count ?? source?.recordCount ?? 0) || 0,
      };
    });

    const issues = [];
    const failed = sources.filter((source) => !source.ok);
    const expired = sources.filter((source) => source.level === LEVELS.EXPIRED);
    const stale = sources.filter((source) => source.level === LEVELS.STALE);
    if (failed.length) issues.push(`${failed.length} ranking source${failed.length === 1 ? '' : 's'} reporting failure`);
    if (expired.length) issues.push(`${expired.length} ranking source${expired.length === 1 ? '' : 's'} expired`);
    else if (stale.length) issues.push(`${stale.length} ranking source${stale.length === 1 ? '' : 's'} stale`);

    const hasProfiles = data.profiles && typeof data.profiles === 'object' && Object.keys(data.profiles).length > 0;
    let level = rootFreshness.level;
    if (!hasProfiles) {
      level = LEVELS.UNAVAILABLE;
      issues.push('Consensus dataset contains no usable profiles');
    } else if (level === LEVELS.FRESH && (failed.length || stale.length || expired.length)) {
      level = LEVELS.DEGRADED;
    }

    return {
      level,
      usable: hasProfiles,
      generatedAt,
      ageHours: rootFreshness.ageHours,
      issues,
      sources,
      healthySources: sources.filter((source) => source.ok && source.level === LEVELS.FRESH).length,
      totalSources: sources.length,
    };
  }

  function assessRuntime(input = {}, options = {}) {
    const intelligence = assessIntelligence(input.intelligence, options);
    const issues = [...intelligence.issues];
    const supplemental = [
      ['Live market', input.marketOk],
      ['Scouting signals', input.scoutingOk],
      ['News/projections', input.newsOk],
    ];
    const failedSupplemental = supplemental.filter(([, ok]) => ok === false).map(([name]) => name);
    if (failedSupplemental.length) issues.push(`Supplemental feed unavailable: ${failedSupplemental.join(', ')}`);

    let level = intelligence.level;
    if (intelligence.usable && level === LEVELS.FRESH && failedSupplemental.length) level = LEVELS.DEGRADED;

    return {
      ...intelligence,
      level,
      issues,
      supplemental: {
        market: input.marketOk !== false,
        scouting: input.scoutingOk !== false,
        news: input.newsOk !== false,
      },
    };
  }

  function confidencePenalty(report) {
    switch (report?.level) {
      case LEVELS.DEGRADED: return 5;
      case LEVELS.STALE: return 12;
      case LEVELS.EXPIRED: return 25;
      case LEVELS.UNAVAILABLE: return 40;
      default: return 0;
    }
  }

  function label(report) {
    if (!report) return 'SOURCE UNKNOWN';
    const age = Number.isFinite(report.ageHours) ? ` · ${report.ageHours.toFixed(1)}h old` : '';
    const coverage = report.totalSources ? ` · ${report.healthySources}/${report.totalSources} fresh sources` : '';
    return `${report.level}${age}${coverage}`;
  }

  return {
    DEFAULT_THRESHOLDS,
    LEVELS,
    ageHours,
    assessIntelligence,
    assessRuntime,
    confidencePenalty,
    freshnessFor,
    label,
    timestampMs,
  };
});
