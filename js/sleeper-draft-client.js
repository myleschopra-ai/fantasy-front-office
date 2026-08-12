(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FFOSleeperDraftClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BASE = 'https://api.sleeper.app/v1';
  const STATUS_PRIORITY = Object.freeze({ drafting: 5, pre_draft: 4, paused: 3, complete: 2, unknown: 1 });

  function text(value) { return String(value ?? '').trim(); }
  function numeric(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function draftPriority(draft, options = {}) {
    const season = text(options.season);
    const targetType = text(options.type).toLowerCase();
    const status = text(draft?.status || 'unknown').toLowerCase();
    let score = STATUS_PRIORITY[status] || STATUS_PRIORITY.unknown;
    if (season && text(draft?.season) === season) score += 10;
    if (targetType && text(draft?.type).toLowerCase() === targetType) score += 3;
    score += Math.min(1, numeric(draft?.created, 0) / 1e15);
    return score;
  }

  function chooseDraft(drafts, options = {}) {
    const list = Array.isArray(drafts) ? drafts.filter(Boolean) : [];
    if (!list.length) return null;
    return [...list].sort((a, b) => {
      const score = draftPriority(b, options) - draftPriority(a, options);
      if (score) return score;
      return numeric(b.start_time || b.created, 0) - numeric(a.start_time || a.created, 0);
    })[0];
  }

  async function requestJson(path, options = {}) {
    const fetchFn = options.fetchFn || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!fetchFn) throw new Error('Fetch is unavailable');
    const response = await fetchFn(`${options.baseUrl || BASE}${path}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    });
    if (!response.ok) throw new Error(`Sleeper request failed (${response.status})`);
    return response.json();
  }

  async function draftsForLeague(leagueId, options = {}) {
    const id = text(leagueId);
    if (!id) throw new Error('Sleeper league ID is required');
    return requestJson(`/league/${encodeURIComponent(id)}/drafts`, options);
  }

  async function draftDetails(draftId, options = {}) {
    const id = text(draftId);
    if (!id) throw new Error('Sleeper draft ID is required');
    return requestJson(`/draft/${encodeURIComponent(id)}`, options);
  }

  async function draftPicks(draftId, options = {}) {
    const id = text(draftId);
    if (!id) throw new Error('Sleeper draft ID is required');
    return requestJson(`/draft/${encodeURIComponent(id)}/picks`, options);
  }

  async function snapshotForLeague(leagueId, options = {}) {
    const drafts = await draftsForLeague(leagueId, options);
    const selected = chooseDraft(drafts, { season: options.season, type: options.type });
    if (!selected?.draft_id) {
      return {
        provider: 'sleeper', leagueId: text(leagueId), draft: null, picks: [],
        retrievedAt: new Date(options.now || Date.now()).toISOString(), issues: ['No Sleeper draft found for this league'],
      };
    }
    const [detail, picks] = await Promise.all([
      draftDetails(selected.draft_id, options),
      draftPicks(selected.draft_id, options),
    ]);
    return {
      provider: 'sleeper',
      leagueId: text(leagueId),
      draft: detail,
      picks: Array.isArray(picks) ? picks : [],
      retrievedAt: new Date(options.now || Date.now()).toISOString(),
      issues: [],
    };
  }

  function createPoller(syncFn, options = {}) {
    if (typeof syncFn !== 'function') throw new Error('syncFn is required');
    const intervalMs = Math.max(5000, numeric(options.intervalMs, 8000));
    const isVisible = options.isVisible || (() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
    let timer = null;
    let running = false;
    let inFlight = false;

    async function tick() {
      if (!running || inFlight || !isVisible()) return;
      inFlight = true;
      try { await syncFn(); }
      finally { inFlight = false; }
    }

    function start(startOptions = {}) {
      if (running) return;
      running = true;
      if (startOptions.immediate !== false) tick();
      timer = setInterval(tick, intervalMs);
    }
    function stop() {
      running = false;
      if (timer) clearInterval(timer);
      timer = null;
    }
    function status() { return { running, inFlight, intervalMs }; }
    return { start, stop, tick, status };
  }

  return {
    BASE,
    STATUS_PRIORITY,
    chooseDraft,
    createPoller,
    draftDetails,
    draftPicks,
    draftPriority,
    draftsForLeague,
    requestJson,
    snapshotForLeague,
  };
});
