(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FFODecisionLedger = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "ffo_decision_ledger_v1";
  const MAX_RECORDS = 750;
  const numeric = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const iso = (value) => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  };
  const defaultStorage = () => {
    try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (_error) { return null; }
  };
  const read = (storage = defaultStorage()) => {
    if (!storage) return [];
    try {
      const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) { return []; }
  };
  const write = (records, storage = defaultStorage()) => {
    const kept = (Array.isArray(records) ? records : []).slice(-MAX_RECORDS);
    if (storage) {
      try { storage.setItem(STORAGE_KEY, JSON.stringify(kept)); } catch (_error) {}
    }
    return kept;
  };
  const newSessionId = (prefix = "snake", now = Date.now()) => {
    const random = Math.random().toString(36).slice(2, 9);
    return `${prefix}-${Number(now).toString(36)}-${random}`;
  };
  const timeLock = (sourceGeneratedAt, capturedAt) => {
    const source = iso(sourceGeneratedAt);
    const captured = iso(capturedAt);
    if (!source || !captured) return { status: "UNVERIFIED", valid: false, sourceGeneratedAt: source, capturedAt: captured };
    return { status: new Date(source) <= new Date(captured) ? "LOCKED" : "FAILED", valid: new Date(source) <= new Date(captured), sourceGeneratedAt: source, capturedAt: captured };
  };
  const normalize = (input, previous = {}) => {
    const capturedAt = previous.capturedAt || iso(input.capturedAt) || new Date().toISOString();
    const sourceGeneratedAt = iso(input.sourceGeneratedAt) || previous.sourceGeneratedAt || null;
    const sessionId = String(input.sessionId || previous.sessionId || "unassigned");
    const kind = String(input.kind || previous.kind || "snake");
    const decisionNumber = Math.max(1, numeric(input.decisionNumber, previous.decisionNumber || 1));
    return {
      ...previous,
      id: input.id || previous.id || `${sessionId}:${kind}:${decisionNumber}`,
      schemaVersion: 1,
      sessionId,
      kind,
      decisionNumber,
      capturedAt,
      updatedAt: new Date().toISOString(),
      sourceGeneratedAt,
      sourceProfile: input.sourceProfile ?? previous.sourceProfile ?? null,
      sourceHealth: input.sourceHealth ?? previous.sourceHealth ?? null,
      timeLock: timeLock(sourceGeneratedAt, capturedAt),
      league: input.league ?? previous.league ?? null,
      context: input.context ?? previous.context ?? null,
      recommendation: input.recommendation ?? previous.recommendation ?? null,
      predictedWinRate: numeric(input.predictedWinRate, previous.predictedWinRate ?? null),
      predictedRange: input.predictedRange ?? previous.predictedRange ?? null,
      wwpa: numeric(input.wwpa, previous.wwpa ?? null),
      confidence: input.confidence ?? previous.confidence ?? null,
      comparable: input.comparable ?? previous.comparable ?? null,
      selectedKey: previous.selectedKey ?? null,
      selectedAt: previous.selectedAt ?? null,
      outcome: previous.outcome ?? null,
    };
  };
  function capture(input, storage = defaultStorage()) {
    const rows = read(storage);
    const id = input.id || `${input.sessionId}:${input.kind || "snake"}:${input.decisionNumber}`;
    const index = rows.findIndex((record) => record.id === id);
    const record = normalize({ ...input, id }, index >= 0 ? rows[index] : {});
    if (index >= 0) rows[index] = record;
    else rows.push(record);
    write(rows, storage);
    return record;
  }
  function markSelection(id, selectedKey, storage = defaultStorage(), selectedAt = new Date().toISOString()) {
    const rows = read(storage);
    const index = rows.findIndex((record) => record.id === id);
    if (index < 0) return null;
    rows[index] = { ...rows[index], selectedKey: selectedKey || null, selectedAt: iso(selectedAt), updatedAt: new Date().toISOString() };
    write(rows, storage);
    return rows[index];
  }
  function resolve(id, outcome, storage = defaultStorage()) {
    const rows = read(storage);
    const index = rows.findIndex((record) => record.id === id);
    if (index < 0) return null;
    const won = outcome?.won === true || outcome?.won === 1 ? 1 : outcome?.won === false || outcome?.won === 0 ? 0 : null;
    rows[index] = {
      ...rows[index],
      outcome: {
        won,
        outcomeAt: iso(outcome?.outcomeAt) || new Date().toISOString(),
        modelPoints: numeric(outcome?.modelPoints),
        baselinePoints: numeric(outcome?.baselinePoints),
        notes: outcome?.notes || null,
      },
      updatedAt: new Date().toISOString(),
    };
    write(rows, storage);
    return rows[index];
  }
  const forSession = (sessionId, storage = defaultStorage()) => read(storage).filter((record) => record.sessionId === sessionId);
  function summary(records) {
    const rows = Array.isArray(records) ? records : [];
    const resolved = rows.filter((record) => record.outcome?.won === 0 || record.outcome?.won === 1);
    const selected = rows.filter((record) => record.selectedKey);
    const followed = selected.filter((record) => record.selectedKey === record.recommendation?.key);
    const locked = rows.filter((record) => record.timeLock?.valid);
    return {
      captured: rows.length,
      selected: selected.length,
      followed: followed.length,
      resolved: resolved.length,
      timeLocked: locked.length,
      promotionEligible: resolved.length >= 100 && resolved.every((record) => record.timeLock?.valid),
    };
  }
  const sessionSnapshot = (sessionId, storage = defaultStorage()) => {
    const records = forSession(sessionId, storage);
    return { schemaVersion: 1, sessionId, summary: summary(records), records };
  };

  return { STORAGE_KEY, MAX_RECORDS, newSessionId, timeLock, read, write, capture, markSelection, resolve, forSession, summary, sessionSnapshot };
});
