from pathlib import Path

room_path = Path('draft-room-v5.html')
runtime_path = Path('js/mock-draft-v4.js')
session_path = Path('js/draft-session.js')

room = room_path.read_text()
runtime = runtime_path.read_text()
session = session_path.read_text()

# Load provider modules before the room runtime.
script_marker = '<script src="js/draft-intelligence.js"></script><script src="js/mock-draft-v4.js"></script>'
script_replacement = '<script src="js/draft-intelligence.js"></script><script src="js/provider-draft-sync.js"></script><script src="js/sleeper-draft-client.js"></script><script src="js/mock-draft-v4.js"></script>'
if 'js/provider-draft-sync.js' not in room:
    if script_marker not in room: raise SystemExit('draft room script marker missing')
    room = room.replace(script_marker, script_replacement, 1)

# Add Live Sleeper mode to draft setup.
mode_marker = '<select id="mode"><option value="sim">Simulator</option><option value="companion">Companion</option></select>'
mode_replacement = '<select id="mode"><option value="sim">Simulator</option><option value="companion">Companion</option><option value="live">Sleeper Live</option></select>'
if '<option value="live">Sleeper Live</option>' not in room:
    if mode_marker not in room: raise SystemExit('mode select marker missing')
    room = room.replace(mode_marker, mode_replacement, 1)

# Put a compact live-provider control beside the session lifecycle badge.
status_marker = '<div id="session-status" class="session-status" data-state="BOOTING">BOOTING</div>'
status_replacement = status_marker + '<div id="provider-sync-status" class="session-status" data-state="IDLE" style="display:none">SLEEPER IDLE</div><button id="provider-sync" class="btn ghost" style="display:none">Sync Sleeper</button>'
if 'id="provider-sync-status"' not in room:
    if status_marker not in room: raise SystemExit('session status marker missing')
    room = room.replace(status_marker, status_replacement, 1)

# Session schema v4 gains optional live-provider binding fields. Backward-compatible.
normalize_marker = "      profileId: payload.profileId || payload.profile_id || null,\n"
normalize_replacement = normalize_marker + "      providerLeagueId: payload.providerLeagueId || payload.provider_league_id || null,\n      providerDraftId: payload.providerDraftId || payload.provider_draft_id || null,\n      providerRetrievedAt: payload.providerRetrievedAt || payload.provider_retrieved_at || null,\n"
if 'providerDraftId: payload.providerDraftId' not in session:
    if normalize_marker not in session: raise SystemExit('snake normalize marker missing')
    session = session.replace(normalize_marker, normalize_replacement, 1)

# Runtime module references and provider state.
const_marker = '  const SourceHealth = window.FFODraftSourceHealth;\n'
const_replacement = const_marker + '  const ProviderSync = window.FFOProviderDraftSync;\n  const SleeperDraft = window.FFOSleeperDraftClient;\n'
if 'const ProviderSync = window.FFOProviderDraftSync;' not in runtime:
    if const_marker not in runtime: raise SystemExit('runtime source health marker missing')
    runtime = runtime.replace(const_marker, const_replacement, 1)

state_marker = '    sourceHealth: null,\n'
state_replacement = state_marker + '''    providerSyncStatus: ProviderSync ? ProviderSync.STATUS.IDLE : "IDLE",
    providerDraftId: null,
    providerDraft: null,
    providerRetrievedAt: null,
    providerIssues: [],
    providerPoller: null,
    providerSyncInFlight: false,
'''
if 'providerSyncStatus:' not in runtime:
    if state_marker not in runtime: raise SystemExit('runtime state marker missing')
    runtime = runtime.replace(state_marker, state_replacement, 1)

# Persist provider binding in session payload.
payload_marker = '      profileId: state.intelProfile?.id || null,\n'
payload_replacement = payload_marker + '''      providerLeagueId: providerLeagueId() || null,
      providerDraftId: state.providerDraftId || null,
      providerRetrievedAt: state.providerRetrievedAt || null,
'''
if 'providerDraftId: state.providerDraftId' not in runtime:
    if payload_marker not in runtime: raise SystemExit('session payload marker missing')
    runtime = runtime.replace(payload_marker, payload_replacement, 1)

# Provider helpers before session UI helpers.
helper_marker = '  function showSessionRecovery(message, force = false) {\n'
helpers = r'''  function providerLeagueId() {
    if (String(state.activeLeague?.provider || "").toLowerCase() !== "sleeper") return "";
    return String(state.activeLeague?.provider_league_id || "").trim();
  }

  function providerEligible() {
    return Boolean(ProviderSync && SleeperDraft && providerLeagueId());
  }

  function providerPlayerLookup() {
    const out = {};
    state.players.forEach((player) => {
      const ids = [player.key, player.playerId, player.sleeperId].filter(Boolean).map(String);
      ids.forEach((id) => { out[id] = player; });
    });
    return out;
  }

  function updateProviderSyncUi(result = null) {
    const statusEl = $("provider-sync-status");
    const button = $("provider-sync");
    const isSleeper = String(state.activeLeague?.provider || "").toLowerCase() === "sleeper";
    const live = state.mode === "live";
    if (button) button.style.display = live && isSleeper ? "" : "none";
    if (statusEl) statusEl.style.display = live && isSleeper ? "" : "none";
    if (!statusEl) return;
    const label = result && ProviderSync
      ? ProviderSync.syncLabel(result, state.providerDraft || {})
      : `${String(state.providerSyncStatus || "IDLE").replaceAll("_", " ")}`;
    statusEl.textContent = `SLEEPER ${label}`;
    statusEl.dataset.state = state.providerSyncStatus || "IDLE";
    statusEl.title = (state.providerIssues || []).join(" · ");
  }

  function stopProviderPolling() {
    if (state.providerPoller) state.providerPoller.stop();
    state.providerPoller = null;
  }

  function ensureProviderPolling() {
    stopProviderPolling();
    if (state.mode !== "live" || !providerEligible()) return;
    state.providerPoller = SleeperDraft.createPoller(
      () => syncSleeperDraft({ manual: false }),
      { intervalMs: 8000, isVisible: () => document.visibilityState !== "hidden" },
    );
    state.providerPoller.start();
  }

  function liveDraftType() {
    const format = String(state.activeLeague?.draft?.format || "snake").toLowerCase();
    return format === "auction" ? "auction" : "snake";
  }

  async function syncSleeperDraft({ manual = false } = {}) {
    if (state.mode !== "live") return null;
    if (!providerEligible()) {
      state.providerSyncStatus = ProviderSync?.STATUS.ERROR || "ERROR";
      state.providerIssues = ["Sleeper league ID is required. Use League ID / Connection to save it first."];
      updateProviderSyncUi();
      return null;
    }
    if (state.providerSyncInFlight) return null;
    state.providerSyncInFlight = true;
    state.providerSyncStatus = ProviderSync.STATUS.SYNCING;
    state.providerIssues = [];
    updateProviderSyncUi();
    try {
      const snapshot = await SleeperDraft.snapshotForLeague(providerLeagueId(), {
        season: state.activeLeague?.season,
        type: liveDraftType(),
      });
      if (!snapshot.draft) {
        state.providerSyncStatus = ProviderSync.STATUS.ERROR;
        state.providerIssues = snapshot.issues || ["No Sleeper draft found"];
        updateProviderSyncUi();
        return null;
      }
      const incomingDraftId = String(snapshot.draft.draft_id || "");
      const expectedDraftId = state.providerDraftId || incomingDraftId;
      const result = ProviderSync.reconcile({
        localPicks: state.picks,
        providerPicks: snapshot.picks,
        draft: snapshot.draft,
        expectedDraftId,
        playerLookup: providerPlayerLookup(),
      });
      state.providerDraft = snapshot.draft;
      state.providerRetrievedAt = snapshot.retrievedAt;
      state.providerSyncStatus = result.status;
      state.providerIssues = result.issues || [];
      if (result.safeToApply) {
        state.providerDraftId = incomingDraftId;
        if (result.additions.length) {
          state.picks = ProviderSync.applyReconciliation(state.picks, result).map((pick, index) => normalizePick(pick, index + 1));
          state.selectedTeam = state.picks[state.picks.length - 1]?.team || state.slot;
          state.survivalCache.clear();
          // Confirmed provider picks are canonical; remove them from queue if present.
          const confirmed = new Set(state.picks.map((pick) => String(pick.key)));
          state.queue = state.queue.filter((key) => !confirmed.has(String(key)));
          save();
          render();
        }
      }
      updateProviderSyncUi(result);
      return result;
    } catch (error) {
      state.providerSyncStatus = ProviderSync.STATUS.ERROR;
      state.providerIssues = [String(error?.message || error)];
      updateProviderSyncUi();
      if (manual) console.error(error);
      return null;
    } finally {
      state.providerSyncInFlight = false;
    }
  }

'''
if 'async function syncSleeperDraft' not in runtime:
    if helper_marker not in runtime: raise SystemExit('helper insertion marker missing')
    runtime = runtime.replace(helper_marker, helpers + helper_marker, 1)

# After restore, provider fields from schema should remain; make sure UI reflects them.
restore_tail = '    if (result.migrated) save();\n  }\n'
restore_replacement = '    if (result.migrated) save();\n    updateProviderSyncUi();\n  }\n'
if 'if (result.migrated) save();\n    updateProviderSyncUi();' not in runtime:
    if restore_tail not in runtime: raise SystemExit('restore tail marker missing')
    runtime = runtime.replace(restore_tail, restore_replacement, 1)

# Live mode never writes speculative local selections.
draft_marker = '  function draft(key) {\n    if (state.picks.length >= state.teams * state.rounds) return;\n'
draft_replacement = '''  function draft(key) {
    if (state.mode === "live") {
      state.providerSyncStatus = ProviderSync?.STATUS.LOCAL_AHEAD || "LOCAL_AHEAD";
      state.providerIssues = ["Live mode records confirmed Sleeper selections only. Queue the player or wait for provider confirmation."];
      updateProviderSyncUi();
      return;
    }
    if (state.picks.length >= state.teams * state.rounds) return;
'''
if 'Live mode records confirmed Sleeper selections only' not in runtime:
    if draft_marker not in runtime: raise SystemExit('draft function marker missing')
    runtime = runtime.replace(draft_marker, draft_replacement, 1)

# Start/reset live mode should clear local draft history, load data, then bind/sync provider.
start_tail = '''    render();
    loadData();
    if (state.mode === "sim") simulateToUser();
  }
'''
start_replacement = '''    state.providerDraftId = null;
    state.providerDraft = null;
    state.providerRetrievedAt = null;
    state.providerIssues = [];
    state.providerSyncStatus = ProviderSync ? ProviderSync.STATUS.IDLE : "IDLE";
    render();
    loadData().then(() => {
      updateProviderSyncUi();
      if (state.mode === "live") {
        syncSleeperDraft({ manual: true }).then(() => ensureProviderPolling());
      }
    });
    if (state.mode === "sim") simulateToUser();
  }
'''
if 'syncSleeperDraft({ manual: true }).then(() => ensureProviderPolling())' not in runtime:
    if start_tail not in runtime: raise SystemExit('start tail marker missing')
    runtime = runtime.replace(start_tail, start_replacement, 1)

# League changes clear the provider binding and polling before loading new league data.
league_marker = '''  document.addEventListener("ffo:league-changed", (event) => {
    state.activeLeague = event.detail || DEFAULT_LEAGUE;
'''
league_replacement = '''  document.addEventListener("ffo:league-changed", (event) => {
    stopProviderPolling();
    state.activeLeague = event.detail || DEFAULT_LEAGUE;
    state.providerDraftId = null;
    state.providerDraft = null;
    state.providerRetrievedAt = null;
    state.providerIssues = [];
    state.providerSyncStatus = ProviderSync ? ProviderSync.STATUS.IDLE : "IDLE";
'''
if 'stopProviderPolling();\n    state.activeLeague = event.detail' not in runtime:
    if league_marker not in runtime: raise SystemExit('league change marker missing')
    runtime = runtime.replace(league_marker, league_replacement, 1)

league_load_marker = '''    state.survivalCache.clear();
    loadData();
  });
'''
league_load_replacement = '''    state.survivalCache.clear();
    loadData().then(() => {
      updateProviderSyncUi();
      if (state.mode === "live") syncSleeperDraft({ manual: true }).then(() => ensureProviderPolling());
    });
  });
'''
if 'if (state.mode === "live") syncSleeperDraft' not in runtime:
    if league_load_marker not in runtime: raise SystemExit('league load marker missing')
    runtime = runtime.replace(league_load_marker, league_load_replacement, 1)

# Provider controls and live-aware advance/undo.
advance_marker = '  $("advance").onclick = simulateToUser;\n'
advance_replacement = '''  $("advance").onclick = () => state.mode === "live" ? syncSleeperDraft({ manual: true }) : simulateToUser();
  if ($("provider-sync")) $("provider-sync").onclick = () => syncSleeperDraft({ manual: true });
'''
if '$("provider-sync").onclick' not in runtime:
    if advance_marker not in runtime: raise SystemExit('advance handler marker missing')
    runtime = runtime.replace(advance_marker, advance_replacement, 1)

undo_marker = '''  $("undo").onclick = () => {
    state.picks.pop();
'''
undo_replacement = '''  $("undo").onclick = () => {
    if (state.mode === "live") {
      state.providerIssues = ["Confirmed Sleeper picks cannot be undone locally. Correct them in Sleeper and sync again."];
      state.providerSyncStatus = ProviderSync?.STATUS.DIVERGED || "DIVERGED";
      updateProviderSyncUi();
      return;
    }
    state.picks.pop();
'''
if 'Confirmed Sleeper picks cannot be undone locally' not in runtime:
    if undo_marker not in runtime: raise SystemExit('undo marker missing')
    runtime = runtime.replace(undo_marker, undo_replacement, 1)

# Mode changes must start/stop provider polling and persist immediately.
mode_handler_marker = '  $("pos").onchange = renderBoard;\n'
mode_handler = '''  $("mode").onchange = () => {
    state.mode = $("mode").value;
    save();
    updateProviderSyncUi();
    if (state.mode === "live") syncSleeperDraft({ manual: true }).then(() => ensureProviderPolling());
    else stopProviderPolling();
  };
  $("pos").onchange = renderBoard;
'''
if '$("mode").onchange' not in runtime:
    if mode_handler_marker not in runtime: raise SystemExit('mode handler marker missing')
    runtime = runtime.replace(mode_handler_marker, mode_handler, 1)

# Visible tab resumes a low-frequency provider check; pagehide stops timer and saves.
visibility_old = '  window.addEventListener("pagehide", () => save());\n  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") save(); });\n'
visibility_new = '''  window.addEventListener("pagehide", () => { stopProviderPolling(); save(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save();
    else if (state.mode === "live" && providerEligible()) ensureProviderPolling();
  });
'''
if 'pagehide", () => { stopProviderPolling(); save(); }' not in runtime:
    if visibility_old not in runtime: raise SystemExit('visibility marker missing')
    runtime = runtime.replace(visibility_old, visibility_new, 1)

# Initial load should surface live controls, and restored live sessions resume sync after rankings load.
initial_marker = '''  window.setTimeout(() => {
    if (!state.players.length) loadData();
  }, 350);
'''
initial_replacement = '''  updateProviderSyncUi();
  window.setTimeout(() => {
    if (!state.players.length) {
      loadData().then(() => {
        updateProviderSyncUi();
        if (state.mode === "live") syncSleeperDraft({ manual: true }).then(() => ensureProviderPolling());
      });
    } else if (state.mode === "live") {
      syncSleeperDraft({ manual: true }).then(() => ensureProviderPolling());
    }
  }, 350);
'''
if 'updateProviderSyncUi();\n  window.setTimeout' not in runtime:
    if initial_marker not in runtime: raise SystemExit('initial load marker missing')
    runtime = runtime.replace(initial_marker, initial_replacement, 1)

room_path.write_text(room)
runtime_path.write_text(runtime)
session_path.write_text(session)
print('Sleeper live draft sync integrated')
