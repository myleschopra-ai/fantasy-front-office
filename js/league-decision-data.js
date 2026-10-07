/* Read-only API service; the same code is embedded in the standalone workspace. */
(function (root) {
  'use strict';
  const E = root.FFOLeagueDecision || require('./league-decision-engine.js');
  const BASE = 'https://api.sleeper.app/v1', DP = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv';
  class DataService {
    constructor({ fetcher = (...args) => fetch(...args), storage = null, interval = 210, now = () => Date.now() } = {}) {
      this.fetcher = fetcher; this.storage = storage; this.interval = interval; this.now = now;
      this.cache = new Map(); this.inflight = new Map(); this.queue = []; this.running = 0; this.lastStart = 0; this.timer = null; this.version = 0;
    }
    pump() {
      if (this.timer || this.running >= 4 || !this.queue.length) return;
      const delay = Math.max(0, this.interval - (this.now() - this.lastStart));
      this.timer = setTimeout(() => {
        this.timer = null; if (!this.queue.length || this.running >= 4) return;
        const { job, resolve, reject } = this.queue.shift(); this.running++; this.lastStart = this.now();
        Promise.resolve().then(job).then(resolve, reject).finally(() => { this.running--; this.pump(); }); this.pump();
      }, delay);
    }
    schedule(job) { return new Promise((resolve, reject) => { this.queue.push({ job, resolve, reject }); this.pump(); }); }
    read(key, ttl) {
      let hit = this.cache.get(key);
      if (!hit) { try { hit = JSON.parse(this.storage?.getItem(`ffo-decision-v1:${key}`) || 'null'); } catch (_) { /* Storage can be disabled on iOS. */ } }
      return hit && this.now() - hit.time >= 0 && this.now() - hit.time < ttl ? hit : null;
    }
    async get(url, { ttl = 300000, text = false, compact = false } = {}) {
      const key = `${text ? 'text:' : ''}${url}`, hit = this.read(key, ttl);
      if (hit) return { ...hit, cached: true };
      if (this.inflight.has(key)) return this.inflight.get(key);
      const request = (async () => {
        let error;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const response = await this.schedule(async () => {
              const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 18000);
              try {
                const r = await this.fetcher(url, { signal: controller.signal, headers: { Accept: text ? 'text/plain' : 'application/json' } });
                if (!r.ok) { const e = new Error(`Source returned HTTP ${r.status}`); e.retryable = r.status === 429 || r.status >= 500; e.retryAfter = Math.min(30, Number(r.headers?.get('retry-after')) || 0) * 1000; throw e; }
                let data = text ? await r.text() : await r.json();
                if (data === null || data === undefined) throw new Error('Source returned no data');
                if (compact) data = Object.fromEntries(Object.entries(data).map(([id, p]) => [id, { full_name: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim(), position: p.position, fantasy_positions: p.fantasy_positions, team: p.team, age: p.age, injury_status: p.injury_status, active: p.active }]));
                return data;
              } finally { clearTimeout(timeout); }
            });
            const record = { data: response, time: this.now(), fetchedAt: new Date(this.now()).toISOString(), url };
            this.cache.set(key, record);
            // Only large, slowly changing public datasets persist; league snapshots remain in memory.
            if (ttl >= 86400000) { try { this.storage?.setItem(`ffo-decision-v1:${key}`, JSON.stringify(record)); } catch (_) { /* Memory cache remains available when quota is exceeded. */ } }
            return record;
          } catch (e) { error = e; if (e.retryable === false || attempt === 2) break; await new Promise(resolve => setTimeout(resolve, Math.max(e.retryAfter || 0, 350 * 2 ** attempt))); }
        }
        throw error;
      })();
      this.inflight.set(key, request);
      try { return await request; } finally { this.inflight.delete(key); }
    }
    async discover(username = 'Partender') {
      const [state, user] = await Promise.all([this.get(`${BASE}/state/nfl`), this.get(`${BASE}/user/${encodeURIComponent(username)}`)]);
      if (!user.data.user_id || !state.data.season || !Number.isInteger(Number(state.data.week))) throw new Error('NFL state or Sleeper user unavailable');
      const leagues = await this.get(`${BASE}/user/${user.data.user_id}/leagues/nfl/${state.data.season}`);
      if (!Array.isArray(leagues.data)) throw new Error('League discovery returned an invalid response');
      return { user: user.data, state: state.data, leagues: leagues.data, fetchedAt: leagues.fetchedAt };
    }
    async load(leagueId, discovery, flags = {}) {
      const version = ++this.version, sources = {};
      const capture = async (name, url, options) => {
        try { const r = await this.get(url, options); sources[name] = { url, fetchedAt: r.fetchedAt, status: r.cached ? 'Cached' : 'Fetched' }; return r.data; }
        catch (error) { sources[name] = { url, fetchedAt: null, status: 'Unavailable', error: error.message }; return null; }
      };
      const league = await capture('league', `${BASE}/league/${encodeURIComponent(leagueId)}`);
      if (!league?.league_id) throw new Error('League unavailable. Retry to reconnect.');
      const f = E.format(league), week = Number(discovery.state.week);
      if (String(league.season) !== String(discovery.state.season)) throw new Error('Selected league does not match the current NFL season.');
      const [rosters, users, players, tradedPicks, drafts, trendingAdd, trendingDrop] = await Promise.all([
        capture('rosters', `${BASE}/league/${leagueId}/rosters`), capture('users', `${BASE}/league/${leagueId}/users`),
        capture('players', `${BASE}/players/nfl`, { ttl: 86400000, compact: true }), capture('tradedPicks', `${BASE}/league/${leagueId}/traded_picks`),
        capture('drafts', `${BASE}/league/${leagueId}/drafts`), capture('trendingAdd', `${BASE}/players/nfl/trending/add?lookback_hours=24&limit=100`), capture('trendingDrop', `${BASE}/players/nfl/trending/drop?lookback_hours=24&limit=100`)
      ]);
      if (!Array.isArray(rosters) || !players || Array.isArray(players)) throw new Error('Rosters or player database unavailable. No stale league data is displayed.');
      if (version !== this.version) return null;
      let market = { values: {}, picks: [], fuzzy: [], unmatched: [], source: 'Unavailable', fetchedAt: null };
      if (flags.market !== false) {
        let rows = null;
        try { rows = await capture('market', E.marketUrl(f), { ttl: 86400000 }); } catch (e) { sources.market = { status: 'Unavailable', error: e.message }; }
        if (Array.isArray(rows) && rows.some(r => E.number(r.value) !== null)) market = E.joinValues(players, rows, 'FantasyCalc', sources.market.fetchedAt, f);
      } else sources.market = { status: 'Disabled', error: 'FantasyCalc public API feature flag is off.' };
      if (!Object.keys(market.values).length && f.dynasty) {
        const csv = await capture('fallbackMarket', DP, { ttl: 86400000, text: true });
        if (csv) market = E.joinValues(players, E.csv(csv), 'DynastyProcess', sources.fallbackMarket.fetchedAt, f);
      }
      if (version !== this.version) return null;
      const end = f.playoffStart > 1 && f.playoffStart <= 19 ? f.playoffStart - 1 : Math.min(18, Math.max(1, week));
      const matchups = {}, transactionParts = [];
      const tasks = [];
      for (let w = f.startWeek; w <= end; w++) tasks.push(capture(`matchups:${w}`, `${BASE}/league/${leagueId}/matchups/${w}`).then(rows => { matchups[w] = Array.isArray(rows) ? rows : null; }));
      for (let w = 1; w <= Math.min(18, Math.max(1, week)); w++) tasks.push(capture(`transactions:${w}`, `${BASE}/league/${leagueId}/transactions/${w}`).then(rows => { transactionParts.push(Array.isArray(rows) ? rows.map(t => ({ ...t, week: w })) : null); }));
      let projections = { scores: {}, reason: 'No projections available. Experimental Sleeper projections are disabled in settings.' };
      if (flags.projections && discovery.state.season_type === 'regular') tasks.push((async () => {
        const url = `https://api.sleeper.com/projections/nfl/${f.season}/${week}?season_type=regular`;
        const raw = await capture('projections', url);
        const filtered = Array.isArray(raw) ? raw.filter(r => Number(r.week) === week && String(r.season) === f.season && r.season_type === 'regular') : [];
        projections = raw ? E.projectionScores(filtered, f, players) : { scores: {}, reason: 'No projections available. Experimental source unavailable.' };
      })());
      await Promise.all(tasks);
      if (version !== this.version) return null;
      const transactions = transactionParts.some(p => p === null) ? null : [...new Map(transactionParts.flat().map(t => [t.transaction_id || JSON.stringify(t), t])).values()];
      return { league, format: f, week, nflState: discovery.state, user: discovery.user, rosters, users: Array.isArray(users) ? users : [], players, market,
        tradedPicks: Array.isArray(tradedPicks) ? tradedPicks : null, drafts: Array.isArray(drafts) ? drafts : null, trendingAdd, trendingDrop, transactions, matchups, projections, sources,
        fetchedAt: new Date(this.now()).toISOString() };
    }
  }
  root.FFOLeagueData = { DataService };
  if (typeof module !== 'undefined' && module.exports) module.exports = { DataService };
})(typeof globalThis !== 'undefined' ? globalThis : window);
