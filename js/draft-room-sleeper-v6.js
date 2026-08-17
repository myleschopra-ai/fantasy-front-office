(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  ready(function () {
    document.documentElement.classList.add('draft-room-v6');
    var icons = { players: '⌕', queue: '★', team: '♟', board: '▦', picks: '☷' };
    var labels = { players: 'Players', queue: 'Queue', team: 'My Team', board: 'Board', picks: 'Picks' };
    document.querySelectorAll('.nav-btn').forEach(function (button) {
      var key = button.getAttribute('data-nav') || 'players';
      button.innerHTML = '<span class="nav-icon" aria-hidden="true">' + (icons[key] || '•') + '</span>' + (labels[key] || key);
    });

    var initialViewportHeight = window.innerHeight;
    function syncViewport() {
      var viewport = window.visualViewport;
      var height = viewport ? viewport.height : window.innerHeight;
      document.documentElement.style.setProperty('--visual-viewport-height', Math.round(height) + 'px');
      var keyboardOpen = height < initialViewportHeight - 140 && document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      document.documentElement.classList.toggle('keyboard-open', Boolean(keyboardOpen));
    }

    function centerActivePick() {
      var active = document.querySelector('#draft-grid .draft-cell.active');
      if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }

    syncViewport();
    window.addEventListener('resize', syncViewport, { passive: true });
    window.addEventListener('orientationchange', function () {
      initialViewportHeight = window.innerHeight;
      window.setTimeout(syncViewport, 120);
    }, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncViewport, { passive: true });
      window.visualViewport.addEventListener('scroll', syncViewport, { passive: true });
    }
    document.addEventListener('focusin', syncViewport);
    document.addEventListener('focusout', function () { window.setTimeout(syncViewport, 80); });
    document.addEventListener('click', function (event) {
      if (event.target.closest('[data-k],#start,#advance,#undo')) window.setTimeout(centerActivePick, 180);
    }, true);
  });
}());
