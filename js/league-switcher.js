(() => {
  'use strict';
  const REGISTRY_URL = 'config/leagues.json';
  const IDS_KEY = 'ffo_provider_league_ids_v1';
  const ACTIVE_KEY = 'ffo_active_league_id_v1';
  const OVERRIDES_KEY = 'ffo_league_overrides';

  const read = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
    catch { return fallback; }
  };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));

  async function loadRegistry() {
    const response = await fetch(REGISTRY_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`League registry unavailable (${response.status})`);
    const registry = await response.json();
    const overrides = read(OVERRIDES_KEY, {});
    const ids = read(IDS_KEY, {});
    registry.leagues = registry.leagues.map(l => ({
      ...l,
      ...(overrides[l.league_id] || {}),
      provider_league_id: ids[l.league_id] ?? overrides[l.league_id]?.provider_league_id ?? l.provider_league_id ?? ''
    }));
    return registry;
  }

  function styles() {
    const style = document.createElement('style');
    style.textContent = `
      .ffo-league-switcher{max-width:960px;margin:10px auto 0;padding:0 20px;display:grid;grid-template-columns:1fr auto;gap:8px}
      .ffo-league-switcher select,.ffo-league-switcher button{background:#0f172a;color:#f1f5f9;border:1px solid #334155;border-radius:8px;padding:10px 12px;font:inherit}
      .ffo-league-switcher button{color:#fbbf24;font-weight:750;cursor:pointer}
      .ffo-league-modal{position:fixed;inset:0;background:rgba(2,6,23,.78);display:grid;place-items:center;z-index:9999;padding:16px}
      .ffo-league-card{width:min(520px,100%);background:#0f172a;color:#f1f5f9;border:1px solid #334155;border-radius:12px;padding:16px}
      .ffo-league-card label{display:grid;gap:6px;color:#94a3b8;font-size:12px;margin:12px 0}
      .ffo-league-card input{background:#020617;color:#f1f5f9;border:1px solid #334155;border-radius:8px;padding:10px}
      .ffo-league-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
      .ffo-league-actions button{border:0;border-radius:8px;padding:9px 12px;font-weight:750;cursor:pointer}
      .ffo-primary{background:#f59e0b;color:#020617}.ffo-secondary{background:#1e293b;color:#f1f5f9}.ffo-danger{background:rgba(248,113,113,.15);color:#f87171}
      .ffo-note{font-size:12px;color:#94a3b8;line-height:1.45}
      @media(max-width:560px){.ffo-league-switcher{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function emitLeagueChange(league) {
    window.FFO_ACTIVE_LEAGUE = league;
    document.dispatchEvent(new CustomEvent('ffo:league-changed', { detail: league }));
  }

  function showSetup(league, registry, select) {
    const modal = document.createElement('div');
    modal.className = 'ffo-league-modal';
    const providerLabel = league.provider === 'yahoo' ? 'Yahoo league ID or league key' : 'Sleeper league ID';
    modal.innerHTML = `<div class="ffo-league-card">
      <h2 style="margin:0 0 6px">${league.name}</h2>
      <div class="ffo-note">The identifier is stored in this browser with no automatic expiration. It remains available across sessions until you remove it or clear browser storage.</div>
      <label>${providerLabel}<input id="ffo-provider-id" autocomplete="off" value="${league.provider_league_id || ''}" placeholder="Enter league ID"></label>
      ${league.provider === 'yahoo' ? '<div class="ffo-note">Private Yahoo league data requires Yahoo OAuth authorization through the repository server adapter. Saving the ID still enables persistent league selection and configuration.</div>' : ''}
      <div class="ffo-league-actions">
        <button class="ffo-danger" id="ffo-remove">Remove ID</button>
        <button class="ffo-secondary" id="ffo-cancel">Cancel</button>
        ${league.provider === 'yahoo' ? '<button class="ffo-secondary" id="ffo-yahoo">Connect Yahoo</button>' : ''}
        <button class="ffo-primary" id="ffo-save">Save</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    const input = modal.querySelector('#ffo-provider-id');
    modal.querySelector('#ffo-cancel').onclick = () => modal.remove();
    modal.querySelector('#ffo-remove').onclick = () => {
      const ids = read(IDS_KEY, {});
      delete ids[league.league_id];
      write(IDS_KEY, ids);
      league.provider_league_id = '';
      modal.remove();
      emitLeagueChange(league);
    };
    modal.querySelector('#ffo-save').onclick = () => {
      const ids = read(IDS_KEY, {});
      ids[league.league_id] = input.value.trim();
      write(IDS_KEY, ids);
      league.provider_league_id = ids[league.league_id];
      modal.remove();
      emitLeagueChange(league);
    };
    const yahoo = modal.querySelector('#ffo-yahoo');
    if (yahoo) yahoo.onclick = () => {
      const backend = localStorage.getItem('ffo_yahoo_backend_url') || '';
      if (!backend) {
        location.href = 'yahoo-connect.html';
        return;
      }
      const target = `${backend.replace(/\/$/, '')}/yahoo/login?league_id=${encodeURIComponent(input.value.trim())}&return_to=${encodeURIComponent(location.href)}`;
      location.href = target;
    };
  }

  async function init() {
    styles();
    let registry;
    try { registry = await loadRegistry(); }
    catch (error) { console.warn(error); return; }

    const activeId = localStorage.getItem(ACTIVE_KEY) || registry.active_league_id || registry.leagues[0]?.league_id;
    const wrapper = document.createElement('div');
    wrapper.className = 'ffo-league-switcher';
    wrapper.innerHTML = '<select aria-label="Active fantasy league"></select><button type="button">League ID / Connection</button>';
    const select = wrapper.querySelector('select');
    select.innerHTML = registry.leagues.map(l => `<option value="${l.league_id}">${l.name} · ${l.provider} · ${l.draft.format}</option>`).join('');
    select.value = registry.leagues.some(l => l.league_id === activeId) ? activeId : registry.leagues[0].league_id;

    const header = document.querySelector('header');
    if (header?.nextSibling) header.parentNode.insertBefore(wrapper, header.nextSibling);
    else document.body.prepend(wrapper);

    const current = () => registry.leagues.find(l => l.league_id === select.value);
    select.onchange = () => {
      localStorage.setItem(ACTIVE_KEY, select.value);
      emitLeagueChange(current());
    };
    wrapper.querySelector('button').onclick = () => showSetup(current(), registry, select);

    const league = current();
    localStorage.setItem(ACTIVE_KEY, league.league_id);
    emitLeagueChange(league);
    if (!league.provider_league_id) showSetup(league, registry, select);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
