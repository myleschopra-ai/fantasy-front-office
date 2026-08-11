from pathlib import Path

ui_path = Path('js/mock-draft-v4.js')
room_path = Path('draft-room-v5.html')
ui = ui_path.read_text()
room = room_path.read_text()

if 'const Session = window.FFODraftSession;' not in ui:
    ui = ui.replace('  const D = window.FFODraftIntelligence;\n', '  const D = window.FFODraftIntelligence;\n  const Session = window.FFODraftSession;\n', 1)

if 'sessionStatus:' not in ui:
    ui = ui.replace('    survivalCache: new Map(),\n', '    survivalCache: new Map(),\n    sessionStatus: Session ? Session.STATES.BOOTING : "BOOTING",\n    recoveryIssues: [],\n    recoveredSession: false,\n', 1)

old = '''  function save() {
    localStorage.setItem(
      LS,
      JSON.stringify({
        version: 3,
        picks: state.picks,
        teams: state.teams,
        slot: state.slot,
        rounds: state.rounds,
        strategy: state.strategy,
        mode: state.mode,
        variance: state.variance,
        profiles: state.profiles,
        selectedTeam: state.selectedTeam,
        queue: state.queue,
      }),
    );
  }

  function restore() {
    if (state.restored) return;
    state.restored = true;
    try {
      const saved = JSON.parse(localStorage.getItem(LS) || "{}");
      Object.assign(state, saved);
      if (!D.STRATEGIES[state.strategy]) state.strategy = "adaptive";
      state.picks = (state.picks || []).map((pick, index) =>
        normalizePick(pick, index + 1),
      );
      state.selectedTeam = state.selectedTeam || state.slot;
      state.queue = Array.isArray(state.queue) ? state.queue : [];
    } catch (_error) {
      state.picks = [];
    }
  }
'''
new = '''  function sessionPayload() {
    return {
      version: Session ? Session.SCHEMA_VERSION : 4,
      picks: state.picks,
      teams: state.teams,
      slot: state.slot,
      rounds: state.rounds,
      strategy: state.strategy,
      mode: state.mode,
      variance: state.variance,
      profiles: state.profiles,
      selectedTeam: state.selectedTeam,
      activeDraftTab: state.activeDraftTab,
      queue: state.queue,
      leagueId: state.activeLeague?.id || state.activeLeague?.league_id || null,
      profileId: state.intelProfile?.id || null,
      sourceSnapshot: {
        generated_at: state.intelligence?.generated_at || state.intelligence?.meta?.generated_at || null,
        profile: state.intelProfile?.id || null,
      },
      savedStatus: state.sessionStatus,
    };
  }

  function updateSessionStatus(status, issues = []) {
    state.sessionStatus = status;
    state.recoveryIssues = Array.isArray(issues) ? issues : [];
    const el = $("session-status");
    if (el) {
      el.textContent = status;
      el.dataset.state = status;
      el.title = state.recoveryIssues.join(" · ");
    }
  }

  function save() {
    if (!Session) return;
    const result = Session.safeSave(localStorage, LS, "snake", sessionPayload(), {
      leagueName: state.activeLeague?.name || null,
    });
    if (!result.ok) updateSessionStatus(Session.STATES.ERROR, result.issues);
    else if (state.picks.length >= state.teams * state.rounds) updateSessionStatus(Session.STATES.COMPLETE);
    else if (state.picks.length) updateSessionStatus(Session.STATES.RUNNING);
    else updateSessionStatus(Session.STATES.READY);
  }

  function restore() {
    if (state.restored) return;
    state.restored = true;
    if (!Session) {
      state.picks = [];
      return;
    }
    updateSessionStatus(Session.STATES.RECOVERING);
    const result = Session.safeLoad(localStorage, LS, "snake");
    if (!result.ok) {
      state.picks = [];
      state.recoveredSession = false;
      updateSessionStatus(Session.STATES.ERROR, result.issues);
      return;
    }
    if (!result.payload) {
      updateSessionStatus(Session.STATES.READY);
      return;
    }
    Object.assign(state, result.payload);
    if (!D.STRATEGIES[state.strategy]) state.strategy = "adaptive";
    state.picks = (state.picks || []).map((pick, index) => normalizePick(pick, index + 1));
    state.selectedTeam = state.selectedTeam || state.slot;
    state.queue = Array.isArray(state.queue) ? state.queue : [];
    state.activeDraftTab = state.activeDraftTab || "board";
    state.recoveredSession = state.picks.length > 0;
    updateSessionStatus(
      state.picks.length >= state.teams * state.rounds
        ? Session.STATES.COMPLETE
        : state.picks.length
          ? Session.STATES.RUNNING
          : Session.STATES.READY,
    );
    // Rewrite a migrated v3 save immediately using the checksummed v4 envelope.
    if (result.migrated) save();
  }
'''
if old in ui:
    ui = ui.replace(old, new, 1)
elif 'function sessionPayload()' not in ui:
    raise SystemExit('legacy save/restore block not found')

# Keep status truthful during data loading and successful render.
if 'updateSessionStatus(Session.STATES.LOADING_DATA)' not in ui:
    marker = '  async function loadData() {'
    if marker in ui:
        ui = ui.replace(marker, marker + '\n    if (Session) updateSessionStatus(Session.STATES.LOADING_DATA);', 1)

# Session module must load before the draft runtime.
if 'js/draft-session.js' not in room:
    marker = '<script src="js/draft-intelligence.js"></script>'
    if marker not in room:
        raise SystemExit('draft-intelligence script marker not found')
    room = room.replace(marker, '<script src="js/draft-session.js"></script>\n' + marker, 1)

# Add a compact state indicator without changing the room hierarchy.
if 'id="session-status"' not in room:
    marker = '<div class="controls">'
    if marker not in room:
        raise SystemExit('controls marker not found')
    room = room.replace(marker, '<div id="session-status" class="session-status" data-state="BOOTING">BOOTING</div>\n<div class="controls">', 1)
    room = room.replace('.btn{', '.session-status{font-size:7px;font-weight:950;letter-spacing:.07em;color:var(--muted);border:1px solid var(--line);border-radius:7px;padding:5px 7px;white-space:nowrap}.session-status[data-state="RUNNING"]{color:var(--green)}.session-status[data-state="RECOVERING"],.session-status[data-state="LOADING_DATA"]{color:var(--gold)}.session-status[data-state="ERROR"]{color:var(--red);border-color:rgba(255,102,124,.45)}.session-status[data-state="COMPLETE"]{color:var(--accent)}.btn{', 1)

ui_path.write_text(ui)
room_path.write_text(room)
print('snake session reliability integration applied')
