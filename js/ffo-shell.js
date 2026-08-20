(function () {
  'use strict';

  const path = location.pathname.split('/').pop() || 'index.html';
  const isImmersive = /^draft-room-v\d+\.html$/.test(path) || /^mock-draft-v\d+\.html$/.test(path);
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  const icons = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 10.8 12 3l9 7.8v9.1a1.1 1.1 0 0 1-1.1 1.1H4.1A1.1 1.1 0 0 1 3 19.9z"/><path d="M9 21v-7h6v7"/></svg>',
    team: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="9" cy="8" r="3"/><path d="M3.5 20v-2.2A4.8 4.8 0 0 1 8.3 13h1.4a4.8 4.8 0 0 1 4.8 4.8V20"/><path d="M15 5.5a3 3 0 0 1 0 5.5M17 13.2a4.8 4.8 0 0 1 3.5 4.6V20"/></svg>',
    matchup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m7 3 10 18M17 3 7 21"/><path d="M5 7h4M15 7h4M5 17h4M15 17h4"/></svg>',
    players: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="7" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg>',
    trade: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 7h13M14 4l3 3-3 3M20 17H7M10 14l-3 3 3 3"/></svg>',
    draft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 2v4M16 2v4M3 9h18M8 13h2M14 13h2M8 17h2"/></svg>',
    league: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v2a4 4 0 0 0 4 4M17 6h3v2a4 4 0 0 1-4 4"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></svg>',
    health: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 14h3l2-7 4 12 2-5h5"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>'
  };

  const routes = [
    { key: 'home', label: 'Home', href: 'index.html', icon: 'home', matches: ['index.html', 'hub.html'] },
    { key: 'team', label: 'My Team', href: 'index.html#roster', icon: 'team', matches: [] },
    { key: 'matchup', label: 'Matchup', href: 'index.html#lineup', icon: 'matchup', matches: [] },
    { key: 'players', label: 'Players', href: 'vegas-intelligence.html', icon: 'players', matches: ['vegas-intelligence.html'] },
    { key: 'trade', label: 'Trade', href: 'trade-intelligence.html', icon: 'trade', matches: ['trade-intelligence.html', 'trade.html'] },
    { key: 'draft', label: 'Draft', href: 'draft.html', icon: 'draft', matches: ['draft.html', 'draft-room-v5.html', 'mock-draft-v4.html', 'draft-review.html', 'draft-slot-blueprints.html', 'auction.html', 'auction-review.html'] },
    { key: 'league', label: 'League', href: 'league-config.html', icon: 'league', matches: ['league-config.html', 'yahoo-connect.html'] }
  ];

  function currentRoute() {
    if (['index.html', 'hub.html'].includes(path)) {
      if (location.hash === '#roster') return routes.find((route) => route.key === 'team');
      if (location.hash === '#lineup' || location.hash === '#matchup') return routes.find((route) => route.key === 'matchup');
      if (location.hash === '#targets') return routes.find((route) => route.key === 'players');
      if (location.hash === '#trade') return routes.find((route) => route.key === 'trade');
    }
    return routes.find((route) => route.matches.includes(path)) || routes[0];
  }

  function applyDashboardHash() {
    if (path !== 'index.html') return;
    const tab = ({ '#matchup': 'lineup', '#lineup': 'lineup', '#roster': 'roster', '#targets': 'targets', '#trade': 'trade', '#validation': 'validation', '#draft': 'draft' })[location.hash];
    if (!tab) return;
    const activate = () => document.querySelector(`#tabs [data-tab="${tab}"]`)?.click();
    window.setTimeout(activate, 0);
    window.setTimeout(activate, 350);
  }

  function activeLeague() {
    const rawName = window.FFO_ACTIVE_LEAGUE?.name || localStorage.getItem('ffo_active_league_name');
    return {
      name: rawName || 'Fantasy Front Office',
      detail: window.FFO_ACTIVE_LEAGUE ? `${window.FFO_ACTIVE_LEAGUE.provider || 'Manual'} · ${window.FFO_ACTIVE_LEAGUE.league_type || window.FFO_ACTIVE_LEAGUE.type || 'League'}` : 'Local intelligence workspace'
    };
  }

  function addStyles() {
    if ($('link[data-ffo2]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/ffo-2.css';
    link.dataset.ffo2 = 'true';
    document.head.appendChild(link);
  }

  function navLink(route) {
    const current = currentRoute().key === route.key ? ' aria-current="page"' : '';
    return `<a href="${route.href}"${current}>${icons[route.icon]}<span>${route.label}</span></a>`;
  }

  function sidebar() {
    const primary = routes.slice(0, 7).map(navLink).join('');
    return `<aside class="ffo2-sidebar" aria-label="Primary navigation">
      <a class="ffo2-brand" href="index.html"><span class="ffo2-mark">FFO</span><span class="ffo2-brand-copy"><strong>Fantasy Front Office</strong><span>Decision intelligence</span></span></a>
      <div class="ffo2-nav-label">League</div><nav class="ffo2-nav">${primary}</nav>
      <div class="ffo2-nav-label">Tools</div><nav class="ffo2-nav">
        <a href="draft-slot-blueprints.html">${icons.draft}<span>Draft Blueprints</span></a>
        <a href="decision-intelligence.html">${icons.health}<span>Intelligence Lab</span></a>
        <a href="league-config.html">${icons.settings}<span>Settings</span></a>
      </nav>
      <div class="ffo2-sidebar-foot"><a href="docs/FANTASY_FRONT_OFFICE_2_0_DESIGN_SPEC.md">${icons.settings}<span>2.0 product contract</span></a><div class="ffo2-readonly">Provider actions remain read-only</div></div>
    </aside>`;
  }

  function topbar() {
    const league = activeLeague();
    return `<header class="ffo2-topbar">
      <div class="ffo2-context"><span class="ffo2-league-logo">FF</span><span class="ffo2-context-copy"><strong data-ffo2-league>${esc(league.name)}</strong><span data-ffo2-league-detail>${esc(league.detail)}</span></span><button class="ffo2-context-switch" type="button" aria-label="Open league settings" data-ffo2-league-switch>⌄</button></div>
      <div class="ffo2-top-actions"><button class="ffo2-search" type="button" data-ffo2-search>${icons.search}<span>Search tools</span><kbd>⌘K</kbd></button><a class="ffo2-health" href="league-config.html" aria-label="Data health: local sources ready"><span class="ffo2-health-dot"></span><span>Data ready</span></a></div>
    </header>`;
  }

  function mobileBars() {
    const league = activeLeague();
    const route = currentRoute();
    const core = routes.filter((item) => ['home', 'team', 'players', 'draft'].includes(item.key));
    return `<header class="ffo2-mobilebar"><a class="ffo2-mark" href="index.html">FFO</a><span class="ffo2-mobile-title"><strong>${esc(route.label)}</strong><span data-ffo2-mobile-league>${esc(league.name)}</span></span><a class="ffo2-mobile-health" href="league-config.html" aria-label="Open league and data settings"><span class="ffo2-health-dot"></span></a></header>
      <nav class="ffo2-bottom-nav" aria-label="Mobile navigation">${core.map(navLink).join('')}<button type="button" data-ffo2-more>${icons.more}<span>More</span></button></nav>`;
  }

  function moreSheet() {
    const extra = [
      routes.find((item) => item.key === 'matchup'), routes.find((item) => item.key === 'trade'), routes.find((item) => item.key === 'league'),
      { label: 'Auction Room', href: 'auction.html', icon: 'draft' }, { label: 'Draft Reviews', href: 'draft-review.html', icon: 'health' },
      { label: 'Data & Evidence', href: 'decision-intelligence.html', icon: 'health' }, { label: 'Yahoo Connection', href: 'yahoo-connect.html', icon: 'settings' },
      { label: 'Draft Blueprints', href: 'draft-slot-blueprints.html', icon: 'draft' }
    ];
    return `<div class="ffo2-menu-sheet" aria-hidden="true" data-ffo2-sheet><section class="ffo2-menu-card" role="dialog" aria-modal="true" aria-labelledby="ffo2-menu-title"><div class="ffo2-menu-head"><strong id="ffo2-menu-title">More tools</strong><button class="ffo2-menu-close" type="button" aria-label="Close menu" data-ffo2-menu-close>×</button></div><div class="ffo2-menu-grid">${extra.map((item) => `<a href="${item.href}">${icons[item.icon]}<span>${item.label}</span></a>`).join('')}</div></section></div>`;
  }

  function searchDialog() {
    return `<dialog class="ffo2-search-dialog" data-ffo2-search-dialog><div class="ffo2-search-head"><input type="search" aria-label="Search tools" placeholder="Search pages and tools…" data-ffo2-search-input><button type="button" class="ffo2-search-close" aria-label="Close search" data-ffo2-search-close>×</button></div><div class="ffo2-search-results" data-ffo2-search-results></div></dialog>`;
  }

  function searchItems() {
    return [
      ...routes, { label: 'Auction Room', href: 'auction.html', detail: 'Live auction simulation and pricing' },
      { label: 'Draft Blueprints', href: 'draft-slot-blueprints.html', detail: 'Simulate every draft slot' },
      { label: 'Draft Review', href: 'draft-review.html', detail: 'Audit a completed draft' },
      { label: 'Intelligence Lab', href: 'decision-intelligence.html', detail: 'Bounded evidence adjustments' },
      { label: 'Yahoo Connection', href: 'yahoo-connect.html', detail: 'Secure read-only adapter setup' }
    ].map((item) => ({ label: item.label, href: item.href, detail: item.detail || 'Fantasy Front Office' }));
  }

  function bind() {
    const sheet = $('[data-ffo2-sheet]');
    const more = $('[data-ffo2-more]');
    const close = $('[data-ffo2-menu-close]');
    const openSheet = () => { sheet.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; close.focus(); };
    const closeSheet = () => { sheet.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; more?.focus(); };
    more?.addEventListener('click', openSheet);
    close?.addEventListener('click', closeSheet);
    sheet?.addEventListener('click', (event) => { if (event.target === sheet) closeSheet(); });

    const dialog = $('[data-ffo2-search-dialog]');
    const input = $('[data-ffo2-search-input]');
    const results = $('[data-ffo2-search-results]');
    const renderResults = () => {
      const query = input.value.trim().toLowerCase();
      const items = searchItems().filter((item) => !query || `${item.label} ${item.detail}`.toLowerCase().includes(query));
      results.innerHTML = items.map((item) => `<a href="${item.href}"><span>${esc(item.label)}</span><small>${esc(item.detail)}</small></a>`).join('') || '<small>No matching tools.</small>';
    };
    const openSearch = () => { renderResults(); dialog.showModal(); requestAnimationFrame(() => input.focus()); };
    $('[data-ffo2-search]')?.addEventListener('click', openSearch);
    $('[data-ffo2-search-close]')?.addEventListener('click', () => dialog.close());
    input?.addEventListener('input', renderResults);
    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); }
      if (event.key === 'Escape' && sheet?.getAttribute('aria-hidden') === 'false') closeSheet();
    });

    $('[data-ffo2-league-switch]')?.addEventListener('click', () => { location.href = 'league-config.html'; });
    document.addEventListener('ffo:league-changed', (event) => {
      const league = event.detail?.league || event.detail || window.FFO_ACTIVE_LEAGUE || {};
      const name = league.name || 'Fantasy Front Office';
      document.querySelectorAll('[data-ffo2-league],[data-ffo2-mobile-league]').forEach((node) => { node.textContent = name; });
      const detail = $('[data-ffo2-league-detail]');
      if (detail) detail.textContent = `${league.provider || 'Manual'} · ${league.league_type || league.type || 'League'}`;
    });
    window.addEventListener('hashchange', applyDashboardHash);
    applyDashboardHash();
  }

  function mount() {
    addStyles();
    document.body.classList.add('ffo2-page');
    if (isImmersive) document.body.classList.add('ffo2-immersive');
    const skip = document.createElement('a');
    skip.className = 'ffo2-skip'; skip.href = '#main-content'; skip.textContent = 'Skip to content';
    document.body.prepend(skip);
    const main = $('main') || $('.main') || $('.app');
    if (main && !main.id) main.id = 'main-content';
    if (!isImmersive) document.body.insertAdjacentHTML('afterbegin', sidebar() + topbar());
    document.body.insertAdjacentHTML('beforeend', mobileBars() + moreSheet() + searchDialog());
    bind();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
