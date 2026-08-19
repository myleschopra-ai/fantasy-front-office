(function (root) {
  "use strict";
  const KEY = "ffo_quality_observability_v1";
  const state = { startedAt: new Date().toISOString(), errors: [], longTasks: [], vitals: {} };

  function persist() {
    try { root.localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) { /* local-first telemetry is best effort */ }
  }

  root.addEventListener("error", event => {
    state.errors.push({ at: new Date().toISOString(), message: String(event.message || "Unknown error"), file: event.filename || null, line: event.lineno || null });
    state.errors = state.errors.slice(-25);
    persist();
  });

  root.addEventListener("unhandledrejection", event => {
    state.errors.push({ at: new Date().toISOString(), message: String(event.reason?.message || event.reason || "Unhandled rejection") });
    state.errors = state.errors.slice(-25);
    persist();
  });

  if (root.PerformanceObserver) {
    try {
      new PerformanceObserver(list => {
        const entries = list.getEntries();
        if (entries.length) state.vitals.lcp = Math.round(entries.at(-1).startTime);
        persist();
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch (_) { /* unsupported metric */ }
    try {
      let cls = 0;
      new PerformanceObserver(list => {
        list.getEntries().forEach(entry => { if (!entry.hadRecentInput) cls += entry.value; });
        state.vitals.cls = Number(cls.toFixed(4));
        persist();
      }).observe({ type: "layout-shift", buffered: true });
    } catch (_) { /* unsupported metric */ }
    try {
      new PerformanceObserver(list => {
        list.getEntries().forEach(entry => state.longTasks.push({ at: new Date().toISOString(), duration: Math.round(entry.duration) }));
        state.longTasks = state.longTasks.slice(-25);
        persist();
      }).observe({ type: "longtask", buffered: true });
    } catch (_) { /* unsupported metric */ }
  }

  root.FFODashboardObservability = {
    snapshot() { return JSON.parse(JSON.stringify(state)); },
    clear() { state.errors = []; state.longTasks = []; state.vitals = {}; persist(); },
  };
  persist();
})(typeof globalThis !== "undefined" ? globalThis : window);
