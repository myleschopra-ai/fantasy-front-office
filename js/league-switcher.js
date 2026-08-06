(() => {
  'use strict';
  const REGISTRY_URL = 'config/leagues.json';
  const IDS_KEY = 'ffo_provider_league_ids_v1';
  const ACTIVE_KEY = 'ffo_active_league_id_v1';
  const OVERRIDES_KEY = 'ffo_league_overrides';
  const SNAPSHOTS_KEY = 'ffo_provider_snapshots_v1';
  const TEAM_KEYS_KEY = 'ffo_provider_team_keys_v1';

  const read = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
    catch { return fallback; }
  };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  async function loadRegistry() {
    const response = await fetch(REGISTRY_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`League registry unavailable (${response.status})`);
    const registry = await response.json();
    const overrides = read(OVERRIDES_KEY, {});
    const ids = read(IDS_KEY, {});
    registry.leagues = registry.leagues.map(league => ({
      ...league,
      ...(overrides[league.league_id] || {}),
      provider_league_id: ids[league.league_id]
        ?? overrides[league.league_id]?.provider_league_id
        ?? league.provider_league_id
        ?? ''
    }));
    return registry;
  }

  function styles() {
    const style = document.createElement('style');
    style.textContent = `
      .ffo-league-switcher{max-width:960px;margin:10px auto 0;padding:0 20px;display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px}
      .ffo-league-switcher select,.ffo-league-switcher button{background:#0f172a;color:#f1f5f9;border:1px solid #334155;border-radius:8px;padding:10px 12px;font:inherit}
      .ffo-league-switcher button{color:#fbbf24;font-weight:750;cursor:pointer}.ffo-league-switcher button:disabled{opacity:.55;cursor:not-allowed}
      .ffo-provider-strip{max-width:920px;margin:8px auto 0;padding:9px 12px;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#94a3b8;font-size:12px;display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}
      .ffo-provider-strip strong{color:#f1f5f9}.ffo-provider-strip button{background:#1e293b;color:#fbbf24;border:0;border-radius:7px;padding:7px 9px;font-weight:700;cursor:pointer}
      .ffo-league-modal{position:fixed;inset:0;background:rgba(2,6,23,.78);display:grid;place-items:center;z-index:9999;padding:16px}
      .ffo-league-card{width:min(680px,100%);max-height:90vh;overflow:auto;background:#0f172a;color:#f1f5f9;border:1px solid #334155;border-radius:12px;padding:16px}
      .ffo-league-card label{display:grid;gap:6px;color:#94a3b8;font-size:12px;margin:12px 0}
      .ffo-league-card input,.ffo-league-card select{background:#020617;color:#f1f5f9;border:1px solid #334155;border-radius:8px;padding:10px}
      .ffo-league-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
      .ffo-league-actions button{border:0;border-radius:8px;padding:9px 12px;font-weight:750;cursor:pointer}
      .ffo-primary{background:#f59e0b;color:#020617}.ffo-secondary{background:#1e293b;color:#f1f5f9}.ffo-danger{background:rgba(248,113,113,.15);color:#f87171}
      .ffo-note{font-size:12px;color:#94a3b8;line-height:1.45}.ffo-roster{display:grid;gap:6px;margin-top:12px}.ffo-player{display:flex;justify-content:space-between;gap:10px;background:#020617;border-radius:7px;padding:8px 10px;font-size:12px}.ffo-player span{color:#94a3b8}
      @media(max-width:660px){.ffo-league-switcher{grid-template-columns:1fr}.ffo-provider-strip{margin-left:20px;margin-right:20px}}
    `;
    document.head.appendChild(style);
  }

  function backendUrl() {
    return (localStorage.getItem('ffo_yahoo_backend_url') || '').replace(/\/$/, '');
  }

  function snapshotFor(league) {
    if (!league?.provider_league_id) return null;
    return read(SNAPSHOTS_KEY, {})[league.provider_league_id] || null;
  }

  function selectedTeam(snapshot) {
    if (!snapshot?.teams?.length) return null;
    const selected = read(TEAM_KEYS_KEY, {})[snapshot.league?.league_key];
    return snapshot.teams.find(team => team.team_key === selected)
      || snapshot.teams.find(team => team.is_owned_by_current_login)
      || snapshot.teams[0];
  }

  function emitLeagueChange(league) {
    const snapshot = snapshotFor(league);
    window.FFO_ACTIVE_LEAGUE = league;
    window.FFO_PROVIDER_SNAPSHOT = snapshot;
    window.FFO_ACTIVE_TEAM = selectedTeam(snapshot);
    document.dispatchEvent(new CustomEvent('ffo:league-changed', { detail: league }));
    if (snapshot) {
      document.dispatchEvent(new CustomEvent('ffo:provider-data', {
        detail: { league, snapshot, team: window.FFO_ACTIVE_TEAM }
      }));
    }
  }

  function authorizeYahoo(league, returnTo = location.href) {
    const backend = backendUrl();
    if (!backend) {
      location.href = 'yahoo-connect.html';
      return;
    }
    location.href = `${backend}/yahoo/login?league_id=${encodeURIComponent(league.provider_league_id || '')}&return_to=${encodeURIComponent(returnTo)}`;
  }

  async function syncYahoo(league, syncButton, status, options = {}) {
    const backend = backendUrl();
    if (!backend) {
      status.textContent = 'Yahoo adapter URL is not configured.';
      location.href = 'yahoo-connect.html';
      return null;
    }
    if (!league.provider_league_id) {
      status.textContent = 'Enter the Yahoo league key first.';
      return null;
    }
    syncButton.disabled = true;
    const previous = syncButton.textContent;
    syncButton.textContent = 'Syncing…';
    status.textContent = 'Loading Yahoo league, teams, and rosters…';
    try {
      const response = await fetch(`${backend}/yahoo/league/${encodeURIComponent(league.provider_league_id)}/snapshot`, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (response.status === 401) {
        status.textContent = 'Yahoo authorization required.';
        if (options.authorizeOn401 !== false) authorizeYahoo(league);
        return null;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Yahoo sync failed (${response.status})`);
      const snapshots = read(SNAPSHOTS_KEY, {});
      snapshots[league.provider_league_id] = payload;
      write(SNAPSHOTS_KEY, snapshots);
      const teamKeys = read(TEAM_KEYS_KEY, {});
      const owned = payload.teams?.find(team => team.is_owned_by_current_login);
      if (!teamKeys[payload.league.league_key] && owned) {
        teamKeys[payload.league.league_key] = owned.team_key;
        write(TEAM_KEYS_KEY, teamKeys);
      }
      status.textContent = `Synced ${payload.teams?.length || 0} teams at ${new Date(payload.retrieved_at).toLocaleString()}.`;
      emitLeagueChange(league);
      return payload;
    } catch (error) {
      console.error(error);
      status.textContent = error.message || 'Yahoo sync failed.';
      return null;
    } finally {
      syncButton.disabled = false;
      syncButton.textContent = previous;
    }
  }

  function showRoster(league, snapshot, status) {
    const modal = document.createElement('div');
    modal.className = 'ffo-league-modal';
    const team = selectedTeam(snapshot);
    modal.innerHTML = `<div class="ffo-league-card">
      <h2 style="margin:0 0 4px">${esc(snapshot.league?.name || league.name)}</h2>
      <div class="ffo-note">Yahoo roster snapshot from ${esc(new Date(snapshot.retrieved_at).toLocaleString())}</div>
      <label>Your team<select id="ffo-team-select">${(snapshot.teams || []).map(item => `<option value="${esc(item.team_key)}" ${item.team_key === team?.team_key ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>
      <div id="ffo-roster-content"></div>
      <div class="ffo-league-actions"><button class="ffo-secondary" id="ffo-close-roster">Close</button></div>
    </div>`;
    document.body.appendChild(modal);
    const selector = modal.querySelector('#ffo-team-select');
    const content = modal.querySelector('#ffo-roster-content');
    const render = () => {
      const current = snapshot.teams.find(item => item.team_key === selector.value);
      const roster = current?.roster || [];
      content.innerHTML = `<div class="ffo-note"><strong>${esc(current?.name || 'Team')}</strong> · ${roster.length} rostered players</div><div class="ffo-roster">${roster.map(player => `<div class="ffo-player"><strong>${esc(player.name || player.player_key)}</strong><span>${esc(player.selected_position || player.display_position || '')}${player.editorial_team_abbr ? ` · ${esc(player.editorial_team_abbr)}` : ''}</span></div>`).join('') || '<div class="ffo-note">No roster players returned.</div>'}</div>`;
    };
    selector.onchange = () => {
      const teamKeys = read(TEAM_KEYS_KEY, {});
      teamKeys[snapshot.league.league_key] = selector.value;
      write(TEAM_KEYS_KEY, teamKeys);
      render();
      emitLeagueChange(league);
      status.textContent = `Active Yahoo team: ${snapshot.teams.find(item => item.team_key === selector.value)?.name || selector.value}`;
    };
    modal.querySelector('#ffo-close-roster').onclick = () => modal.remove();
    render();
  }

  function showSetup(league, status, syncButton) {
    const modal = document.createElement('div');
    modal.className = 'ffo-league-modal';
    const providerLabel = league.provider === 'yahoo' ? 'Yahoo league key' : 'Sleeper league ID';
    modal.innerHTML = `<div class="ffo-league-card">
      <h2 style="margin:0 0 6px">${esc(league.name)}</h2>
      <div class="ffo-note">This identifier is stored in this browser without automatic expiration. It remains across sessions until you remove it or clear site storage.</div>
      <label>${providerLabel}<input id="ffo-provider-id" autocomplete="off" value="${esc(league.provider_league_id || '')}" placeholder="Enter league ID"></label>
      ${league.provider === 'yahoo' ? '<div class="ffo-note">Yahoo private league data also requires OAuth. Saving the league key will immediately attempt roster synchronization and open authorization when needed.</div>' : ''}
      <div class="ffo-league-actions">
        <button class="ffo-danger" id="ffo-remove">Remove ID</button>
        <button class="ffo-secondary" id="ffo-cancel">Cancel</button>
        ${league.provider === 'yahoo' ? '<button class="ffo-secondary" id="ffo-yahoo">Authorize Yahoo</button>' : ''}
        <button class="ffo-primary" id="ffo-save">Save & Sync</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    const input = modal.querySelector('#ffo-provider-id');
    modal.querySelector('#ffo-cancel').onclick = () => modal.remove();
    modal.querySelector('#ffo-remove').onclick = () => {
      const ids = read(IDS_KEY, {});
      const snapshots = read(SNAPSHOTS_KEY, {});
      delete ids[league.league_id];
      if (league.provider_league_id) delete snapshots[league.provider_league_id];
      write(IDS_KEY, ids);
      write(SNAPSHOTS_KEY, snapshots);
      league.provider_league_id = '';
      modal.remove();
      status.textContent = `${league.name} ID removed.`;
      emitLeagueChange(league);
    };
    modal.querySelector('#ffo-save').onclick = async () => {
      const value = input.value.trim();
      const ids = read(IDS_KEY, {});
      ids[league.league_id] = value;
      write(IDS_KEY, ids);
      league.provider_league_id = value;
      modal.remove();
      emitLeagueChange(league);
      if (league.provider === 'yahoo' && value) await syncYahoo(league, syncButton, status);
    };
    const yahoo = modal.querySelector('#ffo-yahoo');
    if (yahoo) yahoo.onclick = () => {
      const value = input.value.trim();
      if (value) {
        const ids = read(IDS_KEY, {});
        ids[league.league_id] = value;
        write(IDS_KEY, ids);
        league.provider_league_id = value;
      }
      authorizeYahoo(league);
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
    wrapper.innerHTML = '<select aria-label="Active fantasy league"></select><button type="button" id="ffo-connection">League ID / Connection</button><button type="button" id="ffo-sync">Sync Provider</button>';
    const select = wrapper.querySelector('select');
    const connectionButton = wrapper.querySelector('#ffo-connection');
    const syncButton = wrapper.querySelector('#ffo-sync');
    select.innerHTML = registry.leagues.map(league => `<option value="${esc(league.league_id)}">${esc(league.name)} · ${esc(league.provider)} · ${esc(league.draft.format)}</option>`).join('');
    select.value = registry.leagues.some(league => league.league_id === activeId) ? activeId : registry.leagues[0].league_id;

    const status = document.createElement('div');
    status.className = 'ffo-provider-strip';
    status.innerHTML = '<span id="ffo-provider-status">Provider not synchronized.</span><button type="button" id="ffo-view-roster" style="display:none">View Roster</button>';
    const statusText = status.querySelector('#ffo-provider-status');
    const rosterButton = status.querySelector('#ffo-view-roster');

    const header = document.querySelector('header');
    if (header?.nextSibling) {
      header.parentNode.insertBefore(wrapper, header.nextSibling);
      header.parentNode.insertBefore(status, wrapper.nextSibling);
    } else {
      document.body.prepend(status);
      document.body.prepend(wrapper);
    }

    const current = () => registry.leagues.find(league => league.league_id === select.value);
    const refreshUi = () => {
      const league = current();
      const snapshot = snapshotFor(league);
      syncButton.style.display = league.provider === 'yahoo' ? '' : 'none';
      syncButton.textContent = league.provider === 'yahoo' ? 'Sync Yahoo' : 'Sync Provider';
      rosterButton.style.display = snapshot?.teams?.length ? '' : 'none';
      if (!league.provider_league_id) statusText.textContent = `${league.name}: league ID required.`;
      else if (snapshot) {
        const team = selectedTeam(snapshot);
        statusText.innerHTML = `<strong>${esc(snapshot.league?.name || league.name)}</strong> · ${esc(team?.name || snapshot.teams?.length + ' teams')} · synced ${esc(new Date(snapshot.retrieved_at).toLocaleString())}`;
      } else if (league.provider === 'yahoo') statusText.textContent = `${league.name}: Yahoo league key saved; authorization and sync required.`;
      else statusText.textContent = `${league.name}: ID saved.`;
      rosterButton.onclick = () => showRoster(league, snapshotFor(league), statusText);
      emitLeagueChange(league);
    };

    select.onchange = () => {
      localStorage.setItem(ACTIVE_KEY, select.value);
      refreshUi();
    };
    connectionButton.onclick = () => showSetup(current(), statusText, syncButton);
    syncButton.onclick = async () => {
      await syncYahoo(current(), syncButton, statusText);
      refreshUi();
    };

    const league = current();
    localStorage.setItem(ACTIVE_KEY, league.league_id);
    refreshUi();
    if (!league.provider_league_id) showSetup(league, statusText, syncButton);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
