(function(){
  'use strict';
  const $=(id)=>document.getElementById(id);
  const setup=$('setup');
  const overlay=$('overlay');
  const boardShell=$('board-shell');
  const posSelect=$('pos');

  function positionFromText(text){
    const match=String(text||'').toUpperCase().match(/\b(QB|RB|WR|TE|DST|K)\b/);
    return match?match[1].toLowerCase():'';
  }

  function polishGrid(){
    const grid=document.querySelector('#draft-grid .draft-grid');
    if(!grid) return;
    const headers=[...grid.querySelectorAll(':scope > .draft-cell.header:not(.round)')];
    const teams=headers.length || Number($('teams')?.value) || 12;
    grid.style.gridTemplateColumns=`40px repeat(${teams}, var(--pickw))`;
    [...grid.children].forEach(cell=>{
      cell.classList.remove('pos-qb','pos-rb','pos-wr','pos-te','pos-k','pos-dst');
      const pos=positionFromText(cell.querySelector('.pickmeta')?.textContent);
      if(pos) cell.classList.add(`pos-${pos}`);
      if(cell.classList.contains('active')) cell.setAttribute('aria-current','true');
      else cell.removeAttribute('aria-current');
    });
  }

  function polishRows(root=document){
    root.querySelectorAll('#board .row, #queue-view .row, #recommended-view .row').forEach(row=>{
      row.classList.add('player-row');
      row.classList.remove('pos-qb','pos-rb','pos-wr','pos-te','pos-k','pos-dst');
      const pos=positionFromText(row.querySelector('.meta')?.textContent || row.textContent);
      if(pos) row.classList.add(`pos-${pos}`);
      const draftBtn=row.querySelector('[data-k]');
      if(draftBtn && draftBtn.textContent!=='Draft') draftBtn.textContent='Draft';
      if(draftBtn) draftBtn.classList.add('primary');
    });
  }

  function syncFilterChips(){
    const value=posSelect?.value || 'ALL';
    document.querySelectorAll('[data-pos]').forEach(btn=>btn.classList.toggle('active',btn.dataset.pos===value));
  }

  function refresh(){
    polishGrid();
    polishRows();
    syncFilterChips();
  }

  function refreshAfterAction(){
    requestAnimationFrame(refresh);
    window.setTimeout(refresh,160);
    window.setTimeout(refresh,420);
  }

  function openOverlay(title,tab){
    $('overlay-title').textContent=title;
    overlay.classList.add('active');
    const map={team:'tab-team',queue:'tab-queue',picks:'tab-selections'};
    if(map[tab]) $(map[tab])?.click();
    document.querySelectorAll('.nav-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.nav===tab));
    refreshAfterAction();
  }

  $('settings-open')?.addEventListener('click',()=>setup.classList.add('open'));
  $('settings-close')?.addEventListener('click',()=>setup.classList.remove('open'));
  $('settings-done')?.addEventListener('click',()=>{setup.classList.remove('open');refreshAfterAction();});
  setup?.addEventListener('click',(e)=>{if(e.target===setup)setup.classList.remove('open')});
  $('overlay-close')?.addEventListener('click',()=>{overlay.classList.remove('active');$('tab-board')?.click();document.querySelectorAll('.nav-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.nav==='players'));refreshAfterAction();});
  $('board-expand')?.addEventListener('click',()=>{
    boardShell.classList.toggle('expanded');
    $('board-expand').textContent=boardShell.classList.contains('expanded')?'Collapse board':'Expand board';
  });

  document.querySelectorAll('[data-pos]').forEach(btn=>btn.addEventListener('click',()=>{
    if(!posSelect) return;
    posSelect.value=btn.dataset.pos;
    posSelect.dispatchEvent(new Event('change',{bubbles:true}));
    syncFilterChips();
    refreshAfterAction();
  }));
  posSelect?.addEventListener('change',refreshAfterAction);

  document.querySelectorAll('.nav-btn').forEach(btn=>btn.addEventListener('click',()=>{
    const nav=btn.dataset.nav;
    if(nav==='players'){
      overlay.classList.remove('active');
      boardShell.classList.remove('expanded');
      $('board-expand').textContent='Expand board';
      $('tab-board')?.click();
      document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b===btn));
    }else if(nav==='board'){
      overlay.classList.remove('active');
      boardShell.classList.add('expanded');
      $('board-expand').textContent='Collapse board';
      document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b===btn));
    }else if(nav==='team') openOverlay('My Team','team');
    else if(nav==='queue') openOverlay('Draft Queue','queue');
    else if(nav==='picks') openOverlay('Draft Picks','picks');
    refreshAfterAction();
  }));

  document.addEventListener('click',(event)=>{
    if(event.target.closest('[data-k],#start,#advance,#undo,#tab-board,#tab-team,#tab-selections,#tab-queue,#tab-recommended,[data-queue-k]')){
      refreshAfterAction();
    }
  },true);

  const params=new URLSearchParams(location.search);
  if(params.get('draftMode')==='manual'){
    const mode=$('mode');
    if(mode){mode.value='companion';mode.dispatchEvent(new Event('change',{bubbles:true}));}
  }

  window.addEventListener('resize',refresh,{passive:true});
  window.addEventListener('pageshow',refreshAfterAction,{passive:true});
  window.setTimeout(refresh,0);
  window.setTimeout(refresh,500);
})();