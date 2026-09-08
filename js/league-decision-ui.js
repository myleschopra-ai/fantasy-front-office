(function () {
  'use strict';
  const E = window.FFOLeagueDecision, $ = id => document.getElementById(id);
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let storage; try { storage = window.localStorage; } catch (_) { storage = null; }
  const read = (key, fallback) => { try { return JSON.parse(storage?.getItem(key) || 'null') ?? fallback; } catch (_) { return fallback; } };
  const write = (key, value) => { try { storage?.setItem(key, JSON.stringify(value)); } catch (_) { /* Private browsing remains usable. */ } };
  const service = new window.FFOLeagueData.DataService({ storage }), flags = read('ffo-decision-flags', { market: true, projections: true });
  let discovery = null, ctx = null, myId = null, active = 'power', generation = 0, evidence = [], computed = {};
  const tabs = { power: 'Power rankings', trades: 'Trades', waivers: 'Waivers', lineup: 'Lineup', playoffs: 'Playoffs', capital: 'Draft capital' };
  const source = (key, formula = '') => ({ ...(ctx?.sources[key] || { status: 'Unavailable', fetchedAt: null }), formula });
  const marketSource = formula => ({ source: ctx.market.source, url: ctx.market.source === 'DynastyProcess' ? ctx.sources.fallbackMarket?.url : ctx.sources.market?.url, fetchedAt: ctx.market.fetchedAt, formula, status: ctx.market.fetchedAt ? 'Available' : 'Unavailable' });
  function numeric(value, provenance, { digits = 0, suffix = '', prefix = '', grouping = true } = {}) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '<span class="ld-muted">Unavailable</span>';
    const id = evidence.push(provenance) - 1, label = `${prefix}${Number(value).toLocaleString(undefined, { useGrouping: grouping, maximumFractionDigits: digits, minimumFractionDigits: digits })}${suffix}`;
    const title = `${provenance.source || provenance.url || provenance.status || 'Derived'} · fetched ${provenance.fetchedAt || 'unavailable'}${provenance.formula ? ` · ${provenance.formula}` : ''}`;
    return `<button class="ld-number" data-evidence="${id}" title="${esc(title)}" aria-label="${esc(label)}; show source and calculation">${esc(label)}</button>`;
  }
  const pct = (x, s) => numeric(x === null ? null : x * 100, s, { digits: 1, suffix: '%' });
  function name(id) { const r = ctx.rosters.find(x => String(x.roster_id) === String(id)), u = ctx.users.find(x => x.user_id === r?.owner_id); return u?.metadata?.team_name || u?.display_name || `Roster ${id}`; }
  function pLabel(p) { return `${esc(p.name)} <span class="ld-muted">${esc(p.position)}</span>${p.evidence?.fuzzy ? ' <span class="ld-pill">Fuzzy match</span>' : ''}`; }
  const playerValue = p => numeric(p.value, { ...p.evidence, url: ctx.market.source === 'DynastyProcess' ? ctx.sources.fallbackMarket?.url : ctx.sources.market?.url, formula: p.evidence?.fuzzy ? 'Unique normalized name + position join; manually verify identity.' : 'Exact Sleeper player ID join.' });
  const empty = text => `<div class="ld-card"><p>${esc(text)}</p></div>`;
  function table(headers, rows) { return `<div class="ld-table-wrap"><table class="ld-table"><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(cells => `<tr>${cells.map((cell, i) => `<td data-label="${esc(headers[i])}">${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
  function powerView() {
    const rows = E.power(ctx), src = marketSource('Complete roster sum; no missing values replaced by zero. Starter assignment maximizes value across configured slots; bench includes reserves.');
    const positions = [...new Set(ctx.format.slots.flatMap(s => ({ FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], WRRB_FLEX: ['WR', 'RB'], REC_FLEX: ['WR', 'TE'] })[s] || [s]))];
    return `<h2>Where your roster stands</h2><p>Market strength and actual results are separate measures. Incomplete coverage stays unranked. Tap any underlined number for its source.</p>` + table(['Team', 'Total value', 'Starter value', 'Bench / reserves', 'Coverage', 'Results points / week', ...(ctx.format.dynasty ? ['Age-weighted window'] : [])], rows.map(r => [
      `<strong>${esc(name(r.id))}${String(r.id) === String(myId) ? ' · you' : ''}</strong>`, numeric(r.total, src), numeric(r.starter, src), numeric(r.bench, src),
      `${numeric(r.matched, src)} / ${numeric(r.count, source('rosters'))}`, numeric(r.pointsPerGame, source('rosters', 'Sleeper points for / completed scoring weeks; median games removed from the week denominator.'), { digits: 1 }),
      ...(ctx.format.dynasty ? [numeric(r.window, { ...src, formula: 'Descriptive age proxy: clamp((35 − market-value-weighted age) / 15 × 100). Uses Sleeper ages. Not a forecast of wins or career length.' }, { digits: 1, suffix: ' / 100' })] : [])
    ])) + `<details class="ld-details"><summary>Positional strength grid</summary>${table(['Team', ...positions], rows.map(r => [esc(name(r.id)), ...positions.map(pos => numeric(r.positional[pos] ?? null, src))]))}</details>`;
  }
  function offerCard(o) {
    const src = marketSource('Market value sums. Both sides retain at least 85% of sent value, including any named counterparty drops. Starter-value gains are allocation metrics, not projected points.');
    return `<article class="ld-card" data-offer><span class="ld-kicker">${esc(name(o.owner))}</span><h3>${o.give.length}-for-${o.receive.length} ${o.give.length > 1 ? 'consolidation' : 'exchange'}</h3><p>${esc(o.reason)}</p><p><strong>You give</strong><br>${o.give.map(p => `${pLabel(p)} · ${playerValue(p)}`).join('<br>')}</p><p><strong>You receive</strong><br>${o.receive.map(p => `${pLabel(p)} · ${playerValue(p)}`).join('<br>')}</p><p>Market: ${numeric(o.fair.give, src)} sent / ${numeric(o.fair.receive, src)} received.<br>Your starter-value change: ${numeric(o.myGain, src, { prefix: '+' })}. Their change: ${numeric(o.theirGain, src, { prefix: '+' })}.</p>${o.drops.length ? `<p>They must release: ${o.drops.map(p => `${pLabel(p)} (${playerValue(p)})`).join(', ')}. Included in the fairness check.</p>` : ''}<p class="ld-muted">${o.bestBall ? 'Best-ball depth and volatility can outweigh this market allocation gain. ' : ''}Review injuries, bye weeks and roster rules in Sleeper. Acceptance probability unavailable.</p></article>`;
  }
  function tradesView() {
    const offers = computed.trades ??= E.tradeFindPartner(ctx, myId), profiles = E.tendencies(ctx);
    const players = ctx.rosters.filter(r => String(r.roster_id) !== String(myId)).flatMap(r => E.activePlayers(ctx, r).filter(p => p.value !== null).map(p => ({ ...p, owner: r.roster_id })));
    return `<h2>Find a useful exchange</h2><p>Searches real owners for exchanges that improve your starter market value and preserve theirs. Two- and three-player offers include required counterparty drops. No offer is submitted.</p><label class="ld-muted" for="ld-target">Counteroffer finder: select a player you want</label><select class="ld-search" id="ld-target"><option value="">Choose an owned target</option>${players.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(name(p.owner))}</option>`).join('')}</select><div id="ld-counteroffers"></div><div class="ld-grid">${offers.slice(0, 12).map(offerCard).join('') || empty('No offer clears the coverage, roster-fit and 15% fairness checks. Keeping your roster is a valid choice. Unknown values cannot fund an offer.')}</div><details class="ld-details"><summary>Manager tendencies and evidence limits</summary><p>Current-season completed transactions only. “Early” means weeks one through four. Pick overpayment is unavailable because historical asset prices are not supplied.</p>${profiles ? table(['Manager', 'Trades', 'RBs sold', 'Early RB sales', 'Waiver / free-agent moves', 'Picks acquired'], Object.entries(profiles).map(([id, p]) => [esc(name(id)), ...['trades', 'rbSales', 'earlyRbSales', 'waiverMoves', 'picksAcquired'].map(k => numeric(p[k], { ...source('transactions:1'), fetchedAt: ctx.fetchedAt, formula: 'Count of observed completed current-season transactions; full history source list below.' }))])) : empty('Transaction history unavailable or incomplete. No manager tendencies inferred.')}</details>`;
  }
  function waiverRows(rows) { return table(['Free agent', 'Market value', 'Global adds', 'Global drops', 'FAAB reference bid'], rows.map(p => [pLabel(p), playerValue(p), numeric(p.add, source('trendingAdd', 'Global Sleeper add count in the requested 24-hour top-100 feed. Absence does not imply zero.')), numeric(p.drop, source('trendingDrop', 'Global Sleeper drop count in the requested 24-hour top-100 feed.')), numeric(p.bid, { ...source('rosters'), formula: 'Budget-scaled median successful current-season waiver bid: median bid / league starting budget × remaining budget, rounded and capped at remaining budget. A reference bid, not a player-specific price forecast.' }, { prefix: '$' })])); }
  function waiversView() {
    const w = E.waivers(ctx, myId); computed.waivers = w;
    return `<h2>The actual free-agent pool</h2><p>Cross-checked against every roster. Global add/drop activity measures interest; it is not a projection or an endorsement.</p>${w.disabled ? '<div class="ld-warning">Adds are disabled by this league. These players are for reference only.</div>' : ''}<div class="ld-card">Remaining FAAB: ${numeric(w.remaining, source('rosters', 'League waiver budget minus this roster’s waiver_budget_used; league settings source below.'), { prefix: '$' })}. Observed winning bids: ${ctx.transactions ? numeric(w.bids.length, { ...source('transactions:1'), fetchedAt: ctx.fetchedAt }) : 'Unavailable'}.<p>The bid column uses your budget and the league’s median completed bid. With no bid history, it stays unavailable. Non-FAAB leagues have no dollar suggestion.</p></div><label class="ld-muted" for="ld-waiver-search">Search free agents by name or position</label><input id="ld-waiver-search" class="ld-search" type="search" placeholder="Player or position"><div id="ld-waiver-results">${waiverRows(w.rows.slice(0, 60))}</div>${ctx.trendingAdd === null || ctx.trendingDrop === null ? '<p>Trending source unavailable. Available market players are still checked against league ownership.</p>' : ''}<p>${numeric(w.rows.length, source('players', 'Union of resolved market players and returned trending IDs, minus every rostered ID, restricted to eligible positions.'))} free agents in the available source universe; search includes the entire list.</p>`;
  }
  function lineupView() {
    const l = E.lineup(ctx, myId); if (!l) return empty('Choose your team to view its lineup.');
    const src = l.metric === 'projection' ? source('projections', 'Weekly returned stat projections × this league’s scoring weights. All active candidates must have complete supported scoring statistics.') : marketSource('Exact maximum-value slot assignment; this is not a projected weekly score.');
    const used = new Set(l.rows.flatMap(r => r.player ? [r.player.id] : []));
    return `<h2>${l.bestBall ? 'Best-ball roster reference' : 'Lineup optimizer'}</h2><div class="ld-warning">${esc(l.reason)}${l.bestBall ? ' Sleeper selects best-ball scorers automatically; there is no manual start/sit action.' : ' Read-only reference: game locks and commissioner substitutions must be checked in Sleeper.'}</div><p>Week ${numeric(ctx.week, { source: 'Sleeper NFL state', fetchedAt: discovery.fetchedAt, url: 'https://api.sleeper.app/v1/state/nfl' })} · ${l.metric === 'projection' ? 'Projected points' : 'VALUE ONLY · NO PROJECTIONS'} total: ${numeric(l.total, src, { digits: l.metric === 'projection' ? 1 : 0 })}</p>${table(['Slot', 'Player', l.metric === 'projection' ? 'Projected points' : 'Market value'], l.rows.map(r => [esc(r.slot), r.player ? pLabel(r.player) : 'Unfilled · evidence or eligible player unavailable', r.player ? numeric(r.player[l.metric], r.player.evidence?.fuzzy ? { ...src, formula: `${src.formula} Fuzzy market identity: verify name and position.` } : src, { digits: l.metric === 'projection' ? 1 : 0 }) : 'Unavailable']))}<details class="ld-details"><summary>Active bench candidates</summary>${table(['Player', 'Market value', 'Injury status'], l.pool.filter(p => !used.has(p.id)).map(p => [pLabel(p), playerValue(p), esc(p.injury || 'No injury designation returned')]))}</details><p>IR and taxi players are excluded. Missing values remain unfilled rather than being assigned an invented zero. This view never uses season totals as weekly projections.</p>`;
  }
  function playoffView() {
    const model = computed.playoffs ??= E.playoffs(ctx, myId);
    if (!model.available) return `<h2>Playoff outlook</h2>${empty(model.reason)}<p>The model requires a complete actual remaining schedule, settled standings and observed weekly score variation. No replacement odds are generated.</p>${scheduleView()}`;
    const src = { source: 'Bootstrap Monte Carlo over Sleeper results and actual schedule', fetchedAt: ctx.fetchedAt, formula: `${model.sims} seeded simulations. Team mean shrunk toward league mean with two prior weeks; resample observed league residuals. Record then modeled total points seed teams; exact remaining ties use a random draw. Conditional win/loss odds are descriptive leverage, not mathematical elimination or calibrated forecasts.` };
    return `<h2>Playoff outlook</h2><p>${numeric(model.sims, src)} simulations of the actual remaining schedule. Modeled odds; not a validated forecast.</p><div class="ld-grid">${model.teams.sort((a, b) => b.odds - a.odds).map(t => `<article class="ld-card"><h3>${esc(name(t.id))}</h3><p>Make playoffs: ${pct(t.odds, src)}<br>Results strength: ${numeric(t.strength, src, { digits: 1 })} points / week</p><details><summary>Seed distribution</summary>${t.seeds.map((p, i) => `<p>Seed ${i + 1}: ${pct(p, src)}</p>`).join('')}</details></article>`).join('')}</div><h3 style="margin-top:24px">Your highest-leverage weeks</h3><p>“Must-win” here means the largest conditional odds swing; it does not assert elimination after a loss.</p>${table(['Week', 'Playoffs if win', 'Playoffs if lose', 'Swing'], model.leverage.slice(0, 5).map(w => [numeric(w.week, src), pct(w.win, src), pct(w.loss, src), pct(w.win !== null && w.loss !== null ? w.win - w.loss : null, src)]))}${scheduleView()}`;
  }
  function scheduleView() {
    const rows = Object.entries(ctx.matchups).filter(([w]) => Number(w) >= ctx.week).map(([w, matches]) => {
      const mine = matches?.find(r => String(r.roster_id) === String(myId)), other = mine && matches.find(r => r.matchup_id === mine.matchup_id && String(r.roster_id) !== String(myId));
      return [numeric(Number(w), source(`matchups:${w}`)), other ? esc(name(other.roster_id)) : 'Schedule unavailable'];
    });
    return `<details class="ld-details"><summary>Your actual remaining schedule</summary>${table(['Week', 'Opponent'], rows)}</details>`;
  }
  function capitalView() {
    const c = E.capital(ctx); if (!c) return empty('Drafts or traded-pick ownership unavailable. No pick totals inferred.');
    const src = marketSource('Generic year/round pick price from the same value board. Net = owned value minus original allotment value over the displayed years. Unknown rounds invalidate the total; no invented slots or discounts.');
    return `<h2>Draft capital and net equity</h2><p>Completed drafts are excluded. Future original allotments follow explicit league draft-round settings; they are labeled rule-derived. Transferred ownership uses Sleeper traded picks.</p>${c.picks.length ? table(['Team', 'Owned picks', 'Pick value', 'Net equity'], c.teams.map(t => [esc(name(t.id)), numeric(t.count, source('tradedPicks', 'Count of observed transfers and rule-derived original allotments in displayed years.')), numeric(t.value, src), numeric(t.net, src)])) : empty('No upcoming draft or priced future entitlement is available for this league.')}<details class="ld-details" open><summary>Your pick inventory</summary>${table(['Pick', 'Originally', 'Evidence', 'Value'], c.picks.filter(p => String(p.owner_id) === String(myId)).map(p => [
      `${numeric(Number(p.season), source(p.entitlement ? 'league' : 'tradedPicks'), { grouping: false })} round ${numeric(Number(p.round), source(p.entitlement ? 'league' : 'tradedPicks'))}`, esc(name(p.roster_id)), p.entitlement ? 'Rule-derived allotment' : 'Sleeper draft / transfer', numeric(p.market?.value, { ...src, formula: `${src.formula} ${p.market?.name || 'No matching year/round price.'}` })]))}</details>`;
  }
  function render() {
    evidence = [];
    document.querySelectorAll('[data-ld-tab]').forEach(b => { const selected = b.dataset.ldTab === active; b.setAttribute('aria-selected', String(selected)); b.tabIndex = selected ? 0 : -1; });
    $('ld-panel').setAttribute('aria-labelledby', `ld-tab-${active}`);
    if (!ctx) { $('ld-panel').innerHTML = empty('Choose a discovered league. Its data will appear here when loading completes.'); return; }
    $('ld-panel').innerHTML = ({ power: powerView, trades: tradesView, waivers: waiversView, lineup: lineupView, playoffs: playoffView, capital: capitalView })[active]();
    $('ld-target')?.addEventListener('change', e => { const offers = e.target.value ? E.tradeFindPartner(ctx, myId, e.target.value) : []; $('ld-counteroffers').innerHTML = e.target.value ? `<h3>Fair counteroffers for this target</h3><div class="ld-grid">${offers.slice(0, 3).map(offerCard).join('') || empty('No legal, beneficial counteroffer within the fairness limit. Do not pay more just to complete a deal.')}</div><hr>` : ''; });
    $('ld-waiver-search')?.addEventListener('input', e => { const q = e.target.value.toLowerCase(); $('ld-waiver-results').innerHTML = waiverRows(computed.waivers.rows.filter(p => `${p.name} ${p.position}`.toLowerCase().includes(q)).slice(0, 60)); });
    // Read-only snapshot for reproducible diagnostics and browser verification; never submitted to a provider.
    window.FFO_DECISION_STATE = { context: ctx, myId, active, computed };
  }
  function evidenceView() {
    $('ld-source-list').innerHTML = table(['Source', 'State', 'Fetched'], Object.entries(ctx.sources).map(([key, s]) => [esc(key), esc(s.status), esc(s.fetchedAt || 'Unavailable')])) + `<h3>Identity audit</h3><p>${ctx.market.fuzzy.length} fuzzy joins; ${ctx.market.unmatched.length} unresolved market rows. No ambiguous match is accepted.</p><details><summary>Every fuzzy match</summary>${ctx.market.fuzzy.map(p => `<p>${esc(p.name)} · Sleeper ${esc(p.id)}</p>`).join('') || '<p>None.</p>'}</details><details><summary>Unresolved source rows</summary>${ctx.market.unmatched.map(p => `<p>${esc(p.name)} · ${esc(p.reason)}</p>`).join('') || '<p>None.</p>'}</details>`;
  }
  async function chooseLeague(id) {
    const token = ++generation; ctx = null; computed = {}; window.FFO_DECISION_STATE = null;
    $('ld-status').textContent = 'Loading settings, rosters, values and the actual schedule…'; $('ld-panel').setAttribute('aria-busy', 'true'); $('ld-format').innerHTML = ''; $('ld-warnings').innerHTML = ''; $('ld-source-list').innerHTML = ''; $('ld-team').innerHTML = '<option>Loading teams…</option>'; render();
    try {
      const next = await service.load(id, discovery, flags); if (token !== generation || !next) return;
      ctx = next; const remembered = read('ffo-decision-teams', {}), owned = ctx.rosters.find(r => r.owner_id === ctx.user.user_id || (r.co_owners || []).includes(ctx.user.user_id));
      myId = ctx.rosters.find(r => String(r.roster_id) === String(remembered[id]))?.roster_id ?? owned?.roster_id ?? null;
      $('ld-team').innerHTML = `${myId === null ? '<option value="">Choose your team</option>' : ''}${ctx.rosters.map(r => `<option value="${r.roster_id}">${esc(name(r.roster_id))}</option>`).join('')}`; $('ld-team').value = String(myId ?? '');
      write('ffo-decision-league', id); const f = ctx.format;
      $('ld-format').innerHTML = [f.label, `${f.teams} teams`, `${f.ppr} PPR`, `${f.superFlex} Superflex`, `TE +${f.tePremium}`, `${f.slots.length} starters`, `${f.rosterSize} roster slots`, `${f.ir ?? 'unknown'} IR`, `${f.taxi ?? 'unknown'} taxi`, `${f.idpSlots.length} IDP`, f.bestBall ? 'Best ball' : 'Set lineup', `Playoffs: ${f.playoffTeams ?? 'unknown'} teams · weeks ${f.playoffWeeks.join(', ') || 'unavailable'}`].map(label => `<span class="ld-pill" title="Sleeper league settings · fetched ${esc(ctx.sources.league.fetchedAt)}">${esc(label)}</span>`).join('');
      $('ld-warnings').innerHTML = f.warnings.map(w => `<div class="ld-warning">${esc(w)}</div>`).join('');
      const failures = Object.values(ctx.sources).filter(s => s.status === 'Unavailable').length;
      $('ld-status').textContent = `${ctx.league.name} · ${ctx.market.source} market · ${failures ? `${failures} sources unavailable; inspect source details.` : 'Sources loaded.'} ${myId === null ? 'Choose your roster before using team decisions.' : ''}`;
      window.FFO_ACTIVE_LEAGUE = { name: ctx.league.name, provider: 'Sleeper', league_type: f.label };
      document.dispatchEvent(new CustomEvent('ffo:league-changed', { detail: window.FFO_ACTIVE_LEAGUE }));
      evidenceView(); render();
    } catch (error) { if (token === generation) { $('ld-status').textContent = `${error.message} Use Refresh to retry.`; $('ld-panel').innerHTML = empty('This league could not be loaded. Previous league data has been cleared.'); } }
    finally { if (token === generation) $('ld-panel').setAttribute('aria-busy', 'false'); }
  }
  async function discover() {
    ++generation; ++service.version; ctx = null; computed = {}; window.FFO_DECISION_STATE = null;
    $('ld-format').innerHTML = ''; $('ld-warnings').innerHTML = ''; $('ld-source-list').innerHTML = ''; render();
    $('ld-league').disabled = true; $('ld-refresh').disabled = true; $('ld-status').textContent = 'Discovering Partender’s current NFL leagues…';
    try {
      discovery = await service.discover('Partender'); $('ld-league').innerHTML = discovery.leagues.map(l => `<option value="${esc(l.league_id)}">${esc(l.name)}</option>`).join('');
      if (!discovery.leagues.length) { $('ld-status').textContent = 'No leagues returned for Partender in the current NFL season.'; return; }
      const remembered = read('ffo-decision-league', null), selected = discovery.leagues.find(l => l.league_id === remembered) || discovery.leagues[0]; $('ld-league').value = selected.league_id; await chooseLeague(selected.league_id);
    } catch (error) { $('ld-status').textContent = `Discovery unavailable: ${error.message}. Use Refresh to retry.`; }
    finally { $('ld-refresh').disabled = false; $('ld-league').disabled = false; }
  }
  function mount() {
    $('ld-tabs').innerHTML = Object.entries(tabs).map(([id, label]) => `<button id="ld-tab-${id}" role="tab" aria-controls="ld-panel" aria-selected="${id === active}" tabindex="${id === active ? 0 : -1}" data-ld-tab="${id}">${label}</button>`).join('');
    $('ld-tabs').addEventListener('click', e => { const button = e.target.closest('[data-ld-tab]'); if (button) { active = button.dataset.ldTab; render(); } });
    $('ld-tabs').addEventListener('keydown', e => { const keys = Object.keys(tabs), i = keys.indexOf(active); let next; if (e.key === 'ArrowRight') next = (i + 1) % keys.length; if (e.key === 'ArrowLeft') next = (i + keys.length - 1) % keys.length; if (e.key === 'Home') next = 0; if (e.key === 'End') next = keys.length - 1; if (next !== undefined) { e.preventDefault(); active = keys[next]; render(); $(`ld-tab-${active}`).focus(); } });
    $('ld-league').addEventListener('change', e => chooseLeague(e.target.value));
    $('ld-team').addEventListener('change', e => { myId = e.target.value || null; const map = read('ffo-decision-teams', {}); map[ctx.league.league_id] = myId; write('ffo-decision-teams', map); computed = {}; render(); });
    $('ld-refresh').addEventListener('click', () => { service.cache.clear(); discover(); });
    $('ld-settings-open').addEventListener('click', () => { $('ld-market-flag').checked = flags.market !== false; $('ld-projection-flag').checked = !!flags.projections; $('ld-settings').showModal(); });
    $('ld-settings-save').addEventListener('click', () => { flags.market = $('ld-market-flag').checked; flags.projections = $('ld-projection-flag').checked; write('ffo-decision-flags', flags); $('ld-settings').close(); if (discovery) chooseLeague($('ld-league').value); });
    $('ld-evidence-close').addEventListener('click', () => $('ld-evidence').close());
    document.addEventListener('click', e => { const button = e.target.closest('[data-evidence]'); if (!button) return; const p = evidence[Number(button.dataset.evidence)]; if (!p) return; $('ld-evidence-content').innerHTML = `<p><strong>${esc(p.source || p.status || 'Calculated from source')}</strong></p><p>Fetched: ${esc(p.fetchedAt || 'Unavailable')}</p>${p.sourceDate ? `<p>Source publication date: ${esc(p.sourceDate)}</p>` : ''}<p>${esc(p.formula || 'Direct value returned by the source.')}</p>${p.url && /^https:\/\//.test(p.url) ? `<p><a href="${esc(p.url)}" target="_blank" rel="noopener">Open source response</a></p>` : ''}`; $('ld-evidence').showModal(); });
    render(); discover();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
})();
