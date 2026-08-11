from pathlib import Path

ui_path=Path('js/mock-draft-v4.js')
room_path=Path('draft-room-v5.html')
ui=ui_path.read_text()
room=room_path.read_text()

if 'id="session-recovery"' not in room:
    marker='<main class="main">\n  <div class="workspace">'
    panel='''<main class="main">
  <div class="workspace">
    <section id="session-recovery" class="session-recovery" style="display:none">
      <div><strong>Draft session recovery</strong><div id="session-recovery-message" class="muted">A saved draft session was found.</div></div>
      <div class="session-recovery-actions"><button id="session-resume" class="btn primary">Resume</button><button id="session-retry" class="btn">Retry Data</button><button id="session-export" class="btn">Export Session</button><button id="session-reset" class="btn ghost">Reset</button></div>
    </section>'''
    if marker not in room: raise SystemExit('main/workspace marker not found')
    room=room.replace(marker,panel,1)
    css='''.session-recovery{padding:9px 11px;border:1px solid rgba(255,197,87,.35);border-radius:12px;background:rgba(18,24,38,.98);display:flex;gap:10px;align-items:center;justify-content:space-between}.session-recovery-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.session-recovery .muted{font-size:8px;margin-top:2px}@media(max-width:760px){.session-recovery{align-items:flex-start;flex-direction:column}.session-recovery-actions{width:100%;justify-content:flex-start}.session-recovery-actions .btn{min-height:34px}}'''
    room=room.replace('</style>',css+'</style>',1)

if 'function showSessionRecovery(' not in ui:
    marker='  function sessionPayload() {'
    helper=r'''  function showSessionRecovery(message, force = false) {
    const panel = $("session-recovery");
    const text = $("session-recovery-message");
    if (!panel) return;
    const show = force || state.sessionStatus === Session?.STATES.ERROR || state.sessionStatus === Session?.STATES.RECOVERING || state.recoveredSession;
    panel.style.display = show ? "flex" : "none";
    if (text && message) text.textContent = message;
  }

  function exportSnakeSession() {
    if (!Session) return;
    const payload = Session.diagnosticExport("snake", sessionPayload(), {
      status: state.sessionStatus,
      issues: state.recoveryIssues,
      league: { id: state.activeLeague?.id || state.activeLeague?.league_id || null, name: state.activeLeague?.name || null },
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "fantasy-front-office-draft-session.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function resetSnakeSession() {
    try { localStorage.removeItem(LS); } catch (_error) {}
    window.location.reload();
  }

'''
    if marker not in ui: raise SystemExit('sessionPayload marker not found')
    ui=ui.replace(marker,helper+marker,1)

old='''    if (el) {
      el.textContent = status;
      el.dataset.state = status;
      el.title = state.recoveryIssues.join(" · ");
    }
  }
'''
new='''    if (el) {
      el.textContent = status;
      el.dataset.state = status;
      el.title = state.recoveryIssues.join(" · ");
    }
    if (status === Session?.STATES.ERROR) showSessionRecovery(state.recoveryIssues.join(" · ") || "Saved draft state needs attention.", true);
  }
'''
if old in ui:
    ui=ui.replace(old,new,1)

needle='''    state.recoveredSession = state.picks.length > 0;
    updateSessionStatus(
'''
replacement='''    state.recoveredSession = state.picks.length > 0;
    if (state.recoveredSession) showSessionRecovery(`Recovered ${state.picks.length} selections and ${state.queue.length} queued player${state.queue.length === 1 ? "" : "s"}.`, true);
    updateSessionStatus(
'''
if needle in ui:
    ui=ui.replace(needle,replacement,1)

marker='''  $("start").onclick = start;
'''
handlers='''  if ($("session-resume")) $("session-resume").onclick = () => { state.recoveredSession = false; showSessionRecovery(); render(); };
  if ($("session-retry")) $("session-retry").onclick = () => loadData();
  if ($("session-export")) $("session-export").onclick = exportSnakeSession;
  if ($("session-reset")) $("session-reset").onclick = resetSnakeSession;
  window.addEventListener("pagehide", () => save());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") save(); });
  $("start").onclick = start;
'''
if handlers not in ui:
    if marker not in ui: raise SystemExit('start handler marker not found')
    ui=ui.replace(marker,handlers,1)

ui_path.write_text(ui)
room_path.write_text(room)
print('snake recovery UI and lifecycle persistence applied')
