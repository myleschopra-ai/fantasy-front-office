from pathlib import Path
p=Path('js/mock-draft-v4.js')
s=p.read_text()
old='''    if (!state.players.length) {
      $("source").textContent =
        "Ranking feeds unavailable. Reload to retry; saved picks were preserved.";
      $("best").textContent = "Rankings unavailable";
      renderIntelligence();
      return;
    }
    render();
'''
new='''    if (!state.players.length) {
      $("source").textContent =
        "Ranking feeds unavailable. Retry data; saved picks were preserved.";
      $("best").textContent = "Rankings unavailable";
      if (Session) updateSessionStatus(Session.STATES.ERROR, [
        intelligenceResult.status === "rejected" ? `Draft intelligence: ${intelligenceResult.reason}` : "Draft intelligence contained no usable players",
        marketResult.status === "rejected" ? `Market feed: ${marketResult.reason}` : "Market feed unavailable or empty",
      ]);
      renderIntelligence();
      return;
    }
    // Data restoration is complete. Persist refreshed player/source metadata and
    // leave the state machine in the truthful draft lifecycle state.
    save();
    render();
'''
if old not in s: raise SystemExit('loadData completion marker not found')
s=s.replace(old,new,1)
p.write_text(s)
print('snake loadData session status fixed')
