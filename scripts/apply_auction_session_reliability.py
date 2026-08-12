from pathlib import Path

p = Path('auction.html')
s = p.read_text()

if 'js/draft-session.js' not in s:
    marker = '<script src="js/draft-intelligence.js"></script>'
    if marker not in s:
        raise SystemExit('draft intelligence script marker not found')
    s = s.replace(marker, '<script src="js/draft-session.js"></script>\n' + marker, 1)

# Add recovery UI directly below the configuration panel.
if 'id="auction-recovery"' not in s:
    marker = '</section>\n<div class="grid" style="margin-top:14px">'
    recovery = '''</section>
<section id="auction-recovery" class="panel" style="display:none;margin-top:10px;border-color:rgba(248,113,113,.45)">
  <div class="toolbar"><div><strong>Draft session recovery</strong><div id="auction-recovery-message" class="muted">Saved auction state needs attention.</div></div><span id="auction-session-status" class="status">BOOTING</span></div>
  <div class="toolbar" style="margin-top:8px;justify-content:flex-start"><button id="retryData" class="btn secondary">Retry Data</button><button id="resetSession" class="btn danger">Reset Session</button><button id="exportSession" class="btn secondary">Export Session JSON</button></div>
</section>
<div class="grid" style="margin-top:14px">'''
    if marker not in s:
        raise SystemExit('auction configuration panel marker not found')
    s = s.replace(marker, recovery, 1)

old_start = "const $=id=>document.getElementById(id), LS='ffo_auction_history_v2';\nconst S={intelligence:null,league:null,players:[],available:[],priceRows:new Map(),history:null,model:null,selected:null,myRoster:[],sold:[]};"
new_start = "const $=id=>document.getElementById(id), LS='ffo_auction_history_v2', SESSION_LS='ffo_auction_session_v4', Session=window.FFODraftSession;\nconst S={intelligence:null,league:window.FFO_ACTIVE_LEAGUE||null,players:[],available:[],priceRows:new Map(),history:null,model:null,selected:null,myRoster:[],sold:[],sessionStatus:Session?Session.STATES.BOOTING:'BOOTING',recoveryIssues:[]};"
if old_start in s:
    s = s.replace(old_start, new_start, 1)
elif "SESSION_LS='ffo_auction_session_v4'" not in s:
    raise SystemExit('auction state header marker not found')

if 'function auctionSessionPayload()' not in s:
    marker = "function context(){"
    block = r'''function setAuctionSessionStatus(status,issues=[]){S.sessionStatus=status;S.recoveryIssues=Array.isArray(issues)?issues:[];const badge=$('auction-session-status');if(badge)badge.textContent=status;const card=$('auction-recovery');const msg=$('auction-recovery-message');if(card){const show=status==='ERROR';card.style.display=show?'block':'none';if(msg&&show)msg.textContent=S.recoveryIssues.join(' · ')||'Saved auction state needs attention.';}}
function auctionSessionPayload(){const l=league();return{version:Session?Session.SCHEMA_VERSION:4,leagueId:l?.id||l?.league_id||null,initialBudget:budget(),remainingBudget:remaining(),slotsLeft:Math.max(0,+$('slots').value||0),leagueRemaining:+$('leagueRemaining').value||0,leagueSlotsLeft:Math.max(0,+$('leagueSlots').value||0),minBid:minbid(),myRoster:S.myRoster,sold:S.sold,selectedKey:S.selected?.key||null,nomination:null,sourceSnapshot:{generated_at:S.intelligence?.generated_at||S.intelligence?.meta?.generated_at||null}};}
function saveAuctionSession(){if(!Session)return;const result=Session.safeSave(localStorage,SESSION_LS,'auction',auctionSessionPayload(),{leagueName:league()?.name||null});if(!result.ok)setAuctionSessionStatus(Session.STATES.ERROR,result.issues);else setAuctionSessionStatus(S.sold.length?Session.STATES.RUNNING:Session.STATES.READY);}
function restoreAuctionSession(){if(!Session)return;setAuctionSessionStatus(Session.STATES.RECOVERING);const result=Session.safeLoad(localStorage,SESSION_LS,'auction');if(!result.ok){setAuctionSessionStatus(Session.STATES.ERROR,result.issues);return}if(!result.payload){setAuctionSessionStatus(Session.STATES.READY);return}const p=result.payload;const currentId=league()?.id||league()?.league_id||null;if(p.leagueId&&currentId&&String(p.leagueId)!==String(currentId)){setAuctionSessionStatus(Session.STATES.ERROR,[`Saved session belongs to league ${p.leagueId}; current league is ${currentId}`]);return}$('budget').value=p.initialBudget;$('remaining').value=p.remainingBudget;$('slots').value=Math.max(0,p.slotsLeft);$('leagueRemaining').value=p.leagueRemaining;$('leagueSlots').value=Math.max(0,p.leagueSlotsLeft);$('minbid').value=p.minBid;S.myRoster=p.myRoster||[];S.sold=p.sold||[];S.pendingSelectedKey=p.selectedKey||null;setAuctionSessionStatus(S.sold.length?Session.STATES.RUNNING:Session.STATES.READY);if(result.migrated)saveAuctionSession();}
function exportAuctionSession(){if(!Session)return;const payload=Session.diagnosticExport('auction',auctionSessionPayload(),{status:S.sessionStatus,issues:S.recoveryIssues});const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='fantasy-front-office-auction-session.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function resetAuctionSession(){try{localStorage.removeItem(SESSION_LS)}catch{}location.reload();}
'''
    if marker not in s:
        raise SystemExit('auction context marker not found')
    s = s.replace(marker, block + marker, 1)

# Restore selected player after the player pool exists.
old_build_tail = "S.priceRows=new Map(vals.rows.map(r=>[String(r.player.key),r]));$('source').textContent=`${profile.id} · ${players.length} calibrated players · ${vals.config.totalBudget} league dollars allocated`;render();}"
new_build_tail = "S.priceRows=new Map(vals.rows.map(r=>[String(r.player.key),r]));$('source').textContent=`${profile.id} · ${players.length} calibrated players · ${vals.config.totalBudget} league dollars allocated`;render();if(S.pendingSelectedKey){const key=S.pendingSelectedKey;S.pendingSelectedKey=null;select(key);}}"
if old_build_tail in s:
    s = s.replace(old_build_tail, new_build_tail, 1)

# Record sale becomes one atomic canonical mutation followed by one session write.
old_record_end = "S.selected=null;$('selected').textContent='Select a player from the board.';$('currentPrice').dataset.manual='';render();}"
new_record_end = "S.selected=null;$('selected').textContent='Select a player from the board.';$('currentPrice').dataset.manual='';saveAuctionSession();render();}"
if old_record_end in s:
    s = s.replace(old_record_end, new_record_end, 1)
elif 'saveAuctionSession();render();}' not in s:
    raise SystemExit('recordSale end marker not found')

# Input changes that alter budget state are persisted after recalculation.
old_handlers = "['remaining','slots','leagueRemaining','leagueSlots','minbid'].forEach(id=>$(id).oninput=()=>{render();if(S.selected)select(S.selected.key)});$('budget').onchange=()=>buildBoard();"
new_handlers = "['remaining','slots','leagueRemaining','leagueSlots','minbid'].forEach(id=>$(id).oninput=()=>{render();if(S.selected)select(S.selected.key);saveAuctionSession()});$('budget').onchange=()=>{buildBoard();saveAuctionSession()};"
if old_handlers in s:
    s = s.replace(old_handlers, new_handlers, 1)

# Wire recovery controls.
if "$('retryData').onclick" not in s:
    marker = "$('apply').onclick=applyHistory;"
    controls = "$('retryData').onclick=()=>load();$('resetSession').onclick=resetAuctionSession;$('exportSession').onclick=exportAuctionSession;"
    if marker not in s:
        raise SystemExit('auction handler marker not found')
    s = s.replace(marker, controls + marker, 1)

# Restore current auction state after history but before loading the player snapshot.
old_boot = "document.addEventListener('ffo:league-changed',e=>{"
if 'restoreAuctionSession();\ndocument.addEventListener' not in s:
    if old_boot not in s:
        raise SystemExit('auction league listener marker not found')
    s = s.replace(old_boot, "restoreAuctionSession();\n" + old_boot, 1)

# League switches that actually alter auction context save the reconciled new state.
old_event_end = "buildBoard()});\nload();"
new_event_end = "buildBoard();saveAuctionSession()});\nload();"
if old_event_end in s:
    s = s.replace(old_event_end, new_event_end, 1)

p.write_text(s)
print('auction session reliability integration applied')
