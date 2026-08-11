from pathlib import Path

snake_path = Path('js/mock-draft-v4.js')
room_path = Path('draft-room-v5.html')
auction_path = Path('auction.html')

snake = snake_path.read_text()
room = room_path.read_text()
auction = auction_path.read_text()

# Load the health module before consumers.
for marker in ['<script src="js/draft-session.js"></script>']:
    replacement = marker + '\n<script src="js/draft-source-health.js"></script>'
    if 'js/draft-source-health.js' not in room:
        if marker not in room: raise SystemExit('draft-room session script marker missing')
        room = room.replace(marker, replacement, 1)
    if 'js/draft-source-health.js' not in auction:
        if marker not in auction: raise SystemExit('auction session script marker missing')
        auction = auction.replace(marker, replacement, 1)

# Snake runtime.
if 'const SourceHealth = window.FFODraftSourceHealth;' not in snake:
    snake = snake.replace('  const Session = window.FFODraftSession;\n', '  const Session = window.FFODraftSession;\n  const SourceHealth = window.FFODraftSourceHealth;\n', 1)

if 'sourceHealth: null,' not in snake:
    snake = snake.replace('    recoveredSession: false,\n', '    recoveredSession: false,\n    sourceHealth: null,\n', 1)

old = '''      sourceSnapshot: {
        generated_at: state.intelligence?.generated_at || state.intelligence?.meta?.generated_at || null,
        profile: state.intelProfile?.id || null,
      },'''
new = '''      sourceSnapshot: {
        generated_at: state.intelligence?.generated_at || state.intelligence?.meta?.generated_at || null,
        profile: state.intelProfile?.id || null,
        health: state.sourceHealth?.level || null,
        ageHours: Number.isFinite(state.sourceHealth?.ageHours) ? Number(state.sourceHealth.ageHours.toFixed(2)) : null,
      },'''
if old in snake:
    snake = snake.replace(old, new, 1)

health_insert_marker = '''    state.intelProfile = D.selectProfile(state.intelligence, league);
    const live ='''
health_insert = '''    state.sourceHealth = SourceHealth
      ? SourceHealth.assessRuntime({
          intelligence: state.intelligence,
          marketOk: marketResult.status === "fulfilled",
          scoutingOk: scoutingResult.status === "fulfilled",
          newsOk: fpResult.status === "fulfilled",
        })
      : null;
    state.intelProfile = D.selectProfile(state.intelligence, league);
    const live ='''
if 'SourceHealth.assessRuntime({' not in snake:
    if health_insert_marker not in snake: raise SystemExit('snake source-health insertion marker missing')
    snake = snake.replace(health_insert_marker, health_insert, 1)

old_return = '    return { ...model, eq: rosterEquity(projected), sv: survives, scarcity, waitRisk, opportunityCost };'
new_return = '''    const sourcePenalty = SourceHealth ? SourceHealth.confidencePenalty(state.sourceHealth) : 0;
    return {
      ...model,
      confidence: Math.max(1, numeric(model.confidence, 50) - sourcePenalty),
      sourcePenalty,
      eq: rosterEquity(projected),
      sv: survives,
      scarcity,
      waitRisk,
      opportunityCost,
    };'''
if old_return in snake:
    snake = snake.replace(old_return, new_return, 1)

render_marker = '''    // Data restoration is complete. Persist refreshed player/source metadata and
    // leave the state machine in the truthful draft lifecycle state.
    save();'''
render_insert = '''    if (SourceHealth && state.sourceHealth) {
      const healthLabel = SourceHealth.label(state.sourceHealth);
      const profileLabel = state.intelProfile?.id || "no compatible profile";
      $("source").textContent = `${healthLabel} · ${profileLabel} · ${state.players.length} players${state.marketLoaded ? " · live market" : " · cached consensus"}`;
      $("source").title = state.sourceHealth.issues.join(" · ");
    }
    // Data restoration is complete. Persist refreshed player/source metadata and
    // leave the state machine in the truthful draft lifecycle state.
    save();'''
if 'const healthLabel = SourceHealth.label(state.sourceHealth);' not in snake:
    if render_marker not in snake: raise SystemExit('snake render source-health marker missing')
    snake = snake.replace(render_marker, render_insert, 1)

# renderIntelligence() can update the source line. Make source health the final
# presentation after the full render cycle so the visible status is authoritative.
old_order = '''    if (SourceHealth && state.sourceHealth) {
      const healthLabel = SourceHealth.label(state.sourceHealth);
      const profileLabel = state.intelProfile?.id || "no compatible profile";
      $("source").textContent = `${healthLabel} · ${profileLabel} · ${state.players.length} players${state.marketLoaded ? " · live market" : " · cached consensus"}`;
      $("source").title = state.sourceHealth.issues.join(" · ");
    }
    // Data restoration is complete. Persist refreshed player/source metadata and
    // leave the state machine in the truthful draft lifecycle state.
    save();
    render();'''
new_order = '''    // Data restoration is complete. Persist refreshed player/source metadata and
    // leave the state machine in the truthful draft lifecycle state.
    save();
    render();
    if (SourceHealth && state.sourceHealth) {
      const healthLabel = SourceHealth.label(state.sourceHealth);
      const profileLabel = state.intelProfile?.id || "no compatible profile";
      $("source").textContent = `${healthLabel} · ${profileLabel} · ${state.players.length} players${state.marketLoaded ? " · live market" : " · cached consensus"}`;
      $("source").title = state.sourceHealth.issues.join(" · ");
    }'''
if old_order in snake:
    snake = snake.replace(old_order, new_order, 1)

# Auction runtime: source health is advisory and never destroys a valid auction session.
if 'SourceHealth=window.FFODraftSourceHealth' not in auction:
    auction = auction.replace("const $=id=>document.getElementById(id), LS='ffo_auction_history_v2', SESSION_LS='ffo_auction_session_v4', Session=window.FFODraftSession;",
                              "const $=id=>document.getElementById(id), LS='ffo_auction_history_v2', SESSION_LS='ffo_auction_session_v4', Session=window.FFODraftSession, SourceHealth=window.FFODraftSourceHealth;", 1)

if 'sourceHealth:null' not in auction:
    auction = auction.replace("sessionStatus:Session?Session.STATES.BOOTING:'BOOTING',recoveryIssues:[]};",
                              "sessionStatus:Session?Session.STATES.BOOTING:'BOOTING',recoveryIssues:[],sourceHealth:null};", 1)

# The auction loader has a single local intelligence snapshot fetch. Assess it after assignment.
auction_marker = "S.intelligence=await fetch('data/draft_intelligence.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(r.status);return r.json()});"
auction_replacement = auction_marker + "S.sourceHealth=SourceHealth?SourceHealth.assessRuntime({intelligence:S.intelligence,marketOk:true,scoutingOk:true,newsOk:true}):null;"
if 'SourceHealth.assessRuntime({intelligence:S.intelligence' not in auction:
    if auction_marker not in auction: raise SystemExit('auction intelligence assignment marker missing')
    auction = auction.replace(auction_marker, auction_replacement, 1)

auction_source = "$('source').textContent=`${profile.id} · ${players.length} calibrated players · ${vals.config.totalBudget} league dollars allocated`;"
auction_source_new = "$('source').textContent=(SourceHealth&&S.sourceHealth?`${SourceHealth.label(S.sourceHealth)} · `:'')+`${profile.id} · ${players.length} calibrated players · ${vals.config.totalBudget} league dollars allocated`;if(SourceHealth&&S.sourceHealth)$('source').title=S.sourceHealth.issues.join(' · ');"
if auction_source in auction:
    auction = auction.replace(auction_source, auction_source_new, 1)

snake_path.write_text(snake)
room_path.write_text(room)
auction_path.write_text(auction)
print('draft source health integrated into snake and auction')
