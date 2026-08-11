(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FFODraftSession = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 4;
  const STATES = Object.freeze({
    BOOTING: 'BOOTING',
    LOADING_DATA: 'LOADING_DATA',
    READY: 'READY',
    RUNNING: 'RUNNING',
    PAUSED: 'PAUSED',
    RECOVERING: 'RECOVERING',
    COMPLETE: 'COMPLETE',
    ERROR: 'ERROR',
  });

  const SENSITIVE_KEYS = new Set([
    'access_token', 'refresh_token', 'api_key', 'apikey', 'authorization',
    'client_secret', 'secret', 'password', 'token',
  ]);

  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== 'object') return value;
    const out = {};
    Object.keys(value).sort().forEach((key) => { out[key] = stable(value[key]); });
    return out;
  }

  function stableStringify(value) {
    return JSON.stringify(stable(value));
  }

  function checksum(value) {
    const text = typeof value === 'string' ? value : stableStringify(value);
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  function playerIdentity(pick) {
    return String(pick?.key || pick?.playerId || pick?.player_id || '').trim();
  }

  function pickNumber(pick, fallback) {
    const n = Number(pick?.pick ?? pick?.pickNo ?? fallback);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  function validatePickHistory(picks) {
    const issues = [];
    const list = Array.isArray(picks) ? picks : [];
    const numbers = new Set();
    const players = new Set();

    list.forEach((pick, index) => {
      const number = pickNumber(pick, index + 1);
      const identity = playerIdentity(pick);
      if (number == null) issues.push(`Pick at index ${index} has no valid pick number`);
      else if (numbers.has(number)) issues.push(`Duplicate pick number ${number}`);
      else numbers.add(number);

      if (!identity) issues.push(`Pick ${number || index + 1} has no canonical player ID`);
      else if (players.has(identity)) issues.push(`Player ${identity} appears more than once`);
      else players.add(identity);
    });

    if (numbers.size) {
      const sorted = [...numbers].sort((a, b) => a - b);
      sorted.forEach((number, index) => {
        const expected = index + 1;
        if (number !== expected) issues.push(`Pick history gap: expected ${expected}, found ${number}`);
      });
    }

    return { valid: issues.length === 0, issues, pickCount: list.length };
  }

  function normalizeSnakePayload(payload = {}) {
    return {
      version: SCHEMA_VERSION,
      mode: payload.mode || 'sim',
      leagueId: payload.leagueId || payload.league_id || null,
      profileId: payload.profileId || payload.profile_id || null,
      teams: Number(payload.teams || 12),
      slot: Number(payload.slot || 1),
      rounds: Number(payload.rounds || 16),
      strategy: payload.strategy || 'adaptive',
      variance: payload.variance || 'medium',
      picks: Array.isArray(payload.picks) ? payload.picks : [],
      queue: Array.isArray(payload.queue) ? payload.queue : [],
      profiles: payload.profiles && typeof payload.profiles === 'object' ? payload.profiles : {},
      selectedTeam: payload.selectedTeam || payload.selected_team || null,
      activeDraftTab: payload.activeDraftTab || payload.active_draft_tab || 'board',
      sourceSnapshot: payload.sourceSnapshot || payload.source_snapshot || null,
      savedStatus: payload.savedStatus || payload.saved_status || null,
    };
  }

  function validateSnakeSession(payload) {
    const issues = [];
    const p = normalizeSnakePayload(payload);
    if (!Number.isInteger(p.teams) || p.teams < 2 || p.teams > 32) issues.push('Invalid team count');
    if (!Number.isInteger(p.slot) || p.slot < 1 || p.slot > p.teams) issues.push('Invalid draft slot');
    if (!Number.isInteger(p.rounds) || p.rounds < 1 || p.rounds > 40) issues.push('Invalid round count');
    const history = validatePickHistory(p.picks);
    issues.push(...history.issues);
    if (p.picks.length > p.teams * p.rounds) issues.push('Pick history exceeds configured draft length');
    const queued = new Set();
    p.queue.forEach((key) => {
      const id = String(key || '').trim();
      if (!id) issues.push('Queue contains an empty player ID');
      else if (queued.has(id)) issues.push(`Queue contains duplicate player ${id}`);
      else queued.add(id);
    });
    return { valid: issues.length === 0, issues, payload: p };
  }

  function normalizeAuctionPayload(payload = {}) {
    return {
      version: SCHEMA_VERSION,
      leagueId: payload.leagueId || payload.league_id || null,
      initialBudget: Number(payload.initialBudget ?? payload.budget ?? 200),
      remainingBudget: Number(payload.remainingBudget ?? payload.remaining ?? 200),
      slotsLeft: Number(payload.slotsLeft ?? payload.slots ?? 16),
      leagueRemaining: Number(payload.leagueRemaining ?? 0),
      leagueSlotsLeft: Number(payload.leagueSlotsLeft ?? payload.leagueSlots ?? 0),
      minBid: Number(payload.minBid ?? payload.minbid ?? 1),
      myRoster: Array.isArray(payload.myRoster) ? payload.myRoster : [],
      sold: Array.isArray(payload.sold) ? payload.sold : [],
      selectedKey: payload.selectedKey || null,
      nomination: payload.nomination || null,
      sourceSnapshot: payload.sourceSnapshot || null,
    };
  }

  function validateAuctionSession(payload) {
    const p = normalizeAuctionPayload(payload);
    const issues = [];
    if (!(p.initialBudget > 0)) issues.push('Invalid initial auction budget');
    if (p.remainingBudget < 0 || p.remainingBudget > p.initialBudget) issues.push('Invalid remaining auction budget');
    if (!Number.isInteger(p.slotsLeft) || p.slotsLeft < 0) issues.push('Invalid remaining roster slots');
    if (!(p.minBid > 0)) issues.push('Invalid minimum bid');

    const soldKeys = new Set();
    p.sold.forEach((sale, index) => {
      const id = playerIdentity(sale);
      if (!id) issues.push(`Sale ${index + 1} has no canonical player ID`);
      else if (soldKeys.has(id)) issues.push(`Player ${id} sold more than once`);
      else soldKeys.add(id);
      if (!(Number(sale.price) >= p.minBid)) issues.push(`Sale ${index + 1} has invalid price`);
    });

    const rosterKeys = new Set();
    let mySpend = 0;
    p.myRoster.forEach((player, index) => {
      const id = playerIdentity(player);
      if (!id) issues.push(`Roster purchase ${index + 1} has no canonical player ID`);
      else if (rosterKeys.has(id)) issues.push(`My roster contains duplicate player ${id}`);
      else rosterKeys.add(id);
      mySpend += Number(player.price) || 0;
    });
    if (mySpend > p.initialBudget) issues.push(`Auction spend ${mySpend} exceeds budget ${p.initialBudget}`);
    if (Math.abs((p.initialBudget - mySpend) - p.remainingBudget) > 0.001) {
      issues.push('Remaining budget does not reconcile with recorded purchases');
    }
    p.myRoster.forEach((player) => {
      const id = playerIdentity(player);
      if (id && !soldKeys.has(id)) issues.push(`Roster player ${id} is missing from canonical sold history`);
    });
    return { valid: issues.length === 0, issues, payload: p };
  }

  function migrate(kind, raw) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'Saved session is not an object' };
    if (raw.schemaVersion === SCHEMA_VERSION && raw.payload) return { ok: true, envelope: raw, migrated: false };

    if (kind === 'snake') {
      // v3 was the live mock's previous raw localStorage object.
      if (Number(raw.version) === 3 || Array.isArray(raw.picks)) {
        const payload = normalizeSnakePayload(raw);
        return { ok: true, envelope: createEnvelope('snake', payload, { migratedFrom: Number(raw.version) || 'legacy' }), migrated: true };
      }
    }
    if (kind === 'auction' && (Array.isArray(raw.sold) || Array.isArray(raw.myRoster))) {
      const payload = normalizeAuctionPayload(raw);
      return { ok: true, envelope: createEnvelope('auction', payload, { migratedFrom: Number(raw.version) || 'legacy' }), migrated: true };
    }
    return { ok: false, error: `Unsupported ${kind} session schema` };
  }

  function createEnvelope(kind, payload, meta = {}) {
    const normalized = kind === 'auction' ? normalizeAuctionPayload(payload) : normalizeSnakePayload(payload);
    const body = {
      schemaVersion: SCHEMA_VERSION,
      kind,
      savedAt: meta.savedAt || new Date().toISOString(),
      meta: { ...meta },
      payload: normalized,
    };
    return { ...body, checksum: checksum(body) };
  }

  function verifyEnvelope(envelope, expectedKind) {
    const issues = [];
    if (!envelope || typeof envelope !== 'object') return { valid: false, issues: ['Session envelope missing'] };
    if (envelope.schemaVersion !== SCHEMA_VERSION) issues.push(`Unsupported session schema ${envelope.schemaVersion}`);
    if (expectedKind && envelope.kind !== expectedKind) issues.push(`Expected ${expectedKind} session, found ${envelope.kind}`);
    const { checksum: stored, ...body } = envelope;
    const computed = checksum(body);
    if (!stored || stored !== computed) issues.push('Session checksum mismatch');
    const validation = envelope.kind === 'auction'
      ? validateAuctionSession(envelope.payload)
      : validateSnakeSession(envelope.payload);
    issues.push(...validation.issues);
    return { valid: issues.length === 0, issues, payload: validation.payload, computedChecksum: computed };
  }

  function safeSave(storage, key, kind, payload, meta = {}) {
    try {
      const validation = kind === 'auction' ? validateAuctionSession(payload) : validateSnakeSession(payload);
      if (!validation.valid) return { ok: false, status: STATES.ERROR, issues: validation.issues };
      const envelope = createEnvelope(kind, validation.payload, meta);
      storage.setItem(key, JSON.stringify(envelope));
      return { ok: true, status: STATES.RUNNING, envelope };
    } catch (error) {
      return { ok: false, status: STATES.ERROR, issues: [String(error?.message || error)] };
    }
  }

  function safeLoad(storage, key, kind) {
    let rawText;
    try {
      rawText = storage.getItem(key);
    } catch (error) {
      return { ok: false, status: STATES.ERROR, issues: [`Storage unavailable: ${error?.message || error}`] };
    }
    if (!rawText) return { ok: true, status: STATES.READY, payload: null, empty: true };

    let raw;
    try { raw = JSON.parse(rawText); }
    catch (error) { return { ok: false, status: STATES.ERROR, issues: ['Saved session JSON is corrupted'] }; }

    const migrated = migrate(kind, raw);
    if (!migrated.ok) return { ok: false, status: STATES.ERROR, issues: [migrated.error] };
    const verified = verifyEnvelope(migrated.envelope, kind);
    if (!verified.valid) return { ok: false, status: STATES.ERROR, issues: verified.issues, envelope: migrated.envelope };
    return {
      ok: true,
      status: verified.payload?.picks?.length || verified.payload?.sold?.length ? STATES.RECOVERING : STATES.READY,
      payload: verified.payload,
      envelope: migrated.envelope,
      migrated: migrated.migrated,
    };
  }

  function sanitize(value) {
    if (Array.isArray(value)) return value.map(sanitize);
    if (!value || typeof value !== 'object') return value;
    const out = {};
    Object.entries(value).forEach(([key, val]) => {
      if (SENSITIVE_KEYS.has(String(key).toLowerCase())) out[key] = '[REDACTED]';
      else out[key] = sanitize(val);
    });
    return out;
  }

  function diagnosticExport(kind, payload, extra = {}) {
    const validation = kind === 'auction' ? validateAuctionSession(payload) : validateSnakeSession(payload);
    return sanitize({
      schemaVersion: SCHEMA_VERSION,
      kind,
      generatedAt: new Date().toISOString(),
      valid: validation.valid,
      issues: validation.issues,
      payload: validation.payload,
      ...extra,
    });
  }

  return {
    SCHEMA_VERSION,
    STATES,
    checksum,
    createEnvelope,
    diagnosticExport,
    migrate,
    normalizeAuctionPayload,
    normalizeSnakePayload,
    safeLoad,
    safeSave,
    sanitize,
    validateAuctionSession,
    validatePickHistory,
    validateSnakeSession,
    verifyEnvelope,
  };
});
