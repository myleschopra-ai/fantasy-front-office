(function(){
  'use strict';
  function ready(fn){ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',fn,{once:true}); else fn(); }
  ready(function(){
    document.documentElement.classList.add('ios-draft-v5');
    var meta=document.querySelector('meta[name="apple-mobile-web-app-capable"]');
    if(!meta){meta=document.createElement('meta');meta.name='apple-mobile-web-app-capable';meta.content='yes';document.head.appendChild(meta);}
    var status=document.querySelector('.turn .label');
    if(status && !status.textContent.trim()) status.textContent='DRAFT ROOM';
    var labelByNav={players:'Players',queue:'Queue',team:'My Team',board:'Board',picks:'Picks'};
    document.querySelectorAll('.nav-btn').forEach(function(btn){
      var key=btn.getAttribute('data-nav')||'';
      var label=labelByNav[key]||btn.textContent.trim()||'Draft tab';
      btn.textContent=label;
      btn.setAttribute('role','tab');
      btn.setAttribute('aria-label',label);
    });
    var search=document.getElementById('search');
    if(search){search.setAttribute('inputmode','search');search.setAttribute('enterkeyhint','search');search.setAttribute('autocomplete','off');}
    var board=document.querySelector('.draft-grid-wrap');
    if(board){board.setAttribute('aria-label','Draft board');board.setAttribute('tabindex','0');}
    var top=document.querySelector('.topbar');
    if(top){top.setAttribute('role','banner');}
    document.querySelectorAll('button').forEach(function(btn){btn.style.webkitTapHighlightColor='transparent';});
  });
})();
