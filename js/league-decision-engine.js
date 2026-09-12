/* Pure, format-aware decisions. Embedded unchanged into league-decisions.html. */
(function (root) {
  'use strict';
  const number = x => x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x);
  const sum = xs => xs.every(x => number(x) !== null) ? xs.reduce((a, b) => a + Number(b), 0) : null;
  const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const normalize = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z0-9]/g, '');
  const IDP = ['DL', 'DE', 'DT', 'LB', 'DB', 'CB', 'SS', 'FS', 'S', 'IDP_FLEX'];
  const eligibility = { FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], WRRB_FLEX: ['WR', 'RB'], REC_FLEX: ['WR', 'TE'], IDP_FLEX: IDP.filter(p => p !== 'IDP_FLEX'), DL: ['DL', 'DE', 'DT'], DB: ['DB', 'CB', 'SS', 'FS', 'S'] };
  function format(league) {
    const s = league.settings || {}, scoring = { ...(league.scoring_settings || {}) };
    const positions = [...(league.roster_positions || [])], slots = positions.filter(p => !['BN', 'IR', 'TAXI'].includes(p));
    const count = p => positions.filter(x => x === p).length;
    const type = number(s.type), ppr = number(scoring.rec) ?? 0, superFlex = count('SUPER_FLEX');
    const numQbs = count('QB') + superFlex > 1 ? 2 : 1;
    const marketPpr = [0, 0.5, 1].reduce((best, p) => Math.abs(p - ppr) < Math.abs(best - ppr) ? p : best, 0);
    const teams = number(league.total_rosters) ?? number(s.num_teams), playoffTeams = number(s.playoff_teams), playoffStart = number(s.playoff_week_start);
    const warnings = [];
    if (ppr !== marketPpr) warnings.push(`Custom ${ppr} PPR: market uses ${marketPpr} PPR base.`);
    if (number(scoring.bonus_rec_te)) warnings.push('TE premium is detected but the market provider does not price it separately.');
    if (number(s.best_ball)) warnings.push('Best ball: market values do not price automatic lineup selection or spike-week upside.');
    if (slots.some(p => IDP.includes(p))) warnings.push('IDP slots are supported; missing IDP market coverage remains unavailable.');
    if (type === 1) warnings.push('Keeper uses redraft base values; keeper cost and contract benefits are not supplied.');
    if (count('QB') + superFlex > 2) warnings.push('Market provider supports at most a two-quarterback base.');
    return Object.freeze({ type, label: ['Redraft', 'Keeper', 'Dynasty'][type] || 'Unknown format', dynasty: type === 2,
      bestBall: !!number(s.best_ball), superFlex, numQbs, ppr, marketPpr, tePremium: number(scoring.bonus_rec_te) ?? 0,
      idpSlots: slots.filter(p => IDP.includes(p)), slots: Object.freeze(slots), positions: Object.freeze(positions), rosterSize: positions.length,
      taxi: number(s.taxi_slots), ir: number(s.reserve_slots), teams, playoffTeams, playoffStart,
      playoffWeeks: playoffStart > 0 && playoffTeams > 1 && !number(s.playoff_round_type) ? Array.from({ length: Math.ceil(Math.log2(playoffTeams)) }, (_, i) => playoffStart + i) : [],
      startWeek: number(s.start_week) ?? 1, medianGame: !!number(s.league_average_match), divisions: number(s.divisions) || 0,
      seedType: number(s.playoff_seed_type) || 0, playoffType: number(s.playoff_type) || 0,
      budget: number(s.waiver_budget), minBid: number(s.waiver_bid_min) ?? 0, waiverType: number(s.waiver_type),
      disableAdds: !!number(s.disable_adds), disableTrades: !!number(s.disable_trades), tradeDeadline: number(s.trade_deadline),
      draftRounds: number(s.draft_rounds), season: String(league.season), scoring: Object.freeze(scoring), warnings: Object.freeze(warnings) });
  }
  function marketUrl(f) {
    if (![0, 1, 2].includes(f.type) || !Number.isInteger(f.teams) || f.teams < 2) throw new Error('League type or team count unavailable');
    return `https://api.fantasycalc.com/values/current?isDynasty=${f.dynasty}&numQbs=${f.numQbs}&numTeams=${f.teams}&ppr=${f.marketPpr}`;
  }
  function csv(text) {
    const rows = []; let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
      else if (c === ',' && !quoted) { row.push(field); field = ''; }
      else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = ''; }
      else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    const header = rows.shift() || [];
    return rows.map(r => Object.fromEntries(header.map((k, i) => [k, r[i]])));
  }
  function joinValues(players, rows, source, fetchedAt, f) {
    const byName = new Map(), values = {}, picks = [], unmatched = [], fuzzy = [];
    Object.entries(players).forEach(([id, p]) => {
      const key = `${normalize(p.full_name || `${p.first_name || ''} ${p.last_name || ''}`)}|${p.position}`;
      byName.set(key, [...(byName.get(key) || []), id]);
    });
    for (const row of rows) {
      const p = row.player && typeof row.player === 'object' ? row.player : { name: row.player, position: row.pos, sleeperId: row.sleeper_id };
      const value = number(source === 'DynastyProcess' ? row[f.numQbs === 2 ? 'value_2qb' : 'value_1qb'] : row.value);
      if (value === null || value < 0 || !p.name || !p.position) continue;
      const item = { name: p.name, position: p.position, value, source, fetchedAt, sourceDate: row.scrape_date || null, fuzzy: false };
      if (p.position === 'PICK') { picks.push(item); continue; }
      const explicit = p.sleeperId ?? p.sleeper_id, id = explicit === null || explicit === undefined || explicit === '' ? null : String(explicit);
      let resolved = id;
      if (id && (!players[id] || !(players[id].fantasy_positions || [players[id].position]).includes(p.position))) { unmatched.push({ name: p.name, reason: 'Conflicting or absent supplied ID' }); continue; }
      if (!id) {
        const matches = byName.get(`${normalize(p.name)}|${p.position}`) || [];
        if (matches.length !== 1) { unmatched.push({ name: p.name, reason: matches.length ? 'Ambiguous name and position' : 'No name and position match' }); continue; }
        resolved = matches[0]; item.fuzzy = true;
      }
      if (values[resolved]) { unmatched.push({ name: p.name, reason: 'Duplicate market identity' }); continue; }
      values[resolved] = { ...item, id: resolved };
      if (item.fuzzy) fuzzy.push({ id: resolved, name: p.name });
    }
    return { values, picks, unmatched, fuzzy, source, fetchedAt };
  }
  function player(ctx, id) {
    id = String(id); const p = ctx.players[id] || {}, v = ctx.market.values[id];
    return { id, name: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || `Unresolved Sleeper ID ${id}`, position: p.position || 'Unknown',
      positions: p.fantasy_positions || [p.position], team: p.team, age: number(p.age), injury: p.injury_status,
      value: v ? v.value : null, evidence: v || null };
  }
  function activePlayers(ctx, roster) {
    const reserve = new Set([...(roster.reserve || []), ...(roster.taxi || [])].map(String));
    return [...new Set((roster.players || []).map(String))].filter(id => !reserve.has(id)).map(id => player(ctx, id));
  }
  function eligible(p, slot) { return (eligibility[slot] || [slot]).some(pos => p.positions.includes(pos)); }
  // Rectangular Hungarian assignment: exact maximum, flexible and multi-position slots included.
  function optimize(pool, slots, metric = 'value') {
    const n = slots.length, m = pool.length + n, u = Array(n + 1).fill(0), v = Array(m + 1).fill(0), p = Array(m + 1).fill(0), way = Array(m + 1).fill(0);
    const cost = (i, j) => j >= pool.length ? 1e8 : !eligible(pool[j], slots[i]) || number(pool[j][metric]) === null ? 1e9 : -pool[j][metric];
    for (let i = 1; i <= n; i++) {
      p[0] = i; let j0 = 0; const minv = Array(m + 1).fill(Infinity), used = Array(m + 1).fill(false);
      do {
        used[j0] = true; const i0 = p[j0]; let delta = Infinity, j1 = 0;
        for (let j = 1; j <= m; j++) if (!used[j]) { const cur = cost(i0 - 1, j - 1) - u[i0] - v[j]; if (cur < minv[j]) { minv[j] = cur; way[j] = j0; } if (minv[j] < delta) { delta = minv[j]; j1 = j; } }
        for (let j = 0; j <= m; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
        j0 = j1;
      } while (p[j0]);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const rows = slots.map(slot => ({ slot, player: null }));
    for (let j = 1; j <= m; j++) if (p[j] && j <= pool.length && cost(p[j] - 1, j - 1) < 1e8) rows[p[j] - 1].player = pool[j - 1];
    return { rows, total: rows.every(r => r.player) ? sum(rows.map(r => r.player[metric])) : null, complete: rows.every(r => r.player) };
  }
  function power(ctx) {
    return ctx.rosters.map(r => {
      const all = (r.players || []).map(id => player(ctx, id)), line = optimize(activePlayers(ctx, r), ctx.format.slots), ids = new Set(line.rows.flatMap(x => x.player ? [x.player.id] : []));
      const positional = Object.fromEntries([...new Set(all.map(p => p.position))].map(pos => [pos, sum(all.filter(p => p.position === pos).map(p => p.value))]));
      const completed = [number(r.settings?.wins), number(r.settings?.losses), number(r.settings?.ties)], games = sum(completed);
      const points = number(r.settings?.fpts) === null ? null : Number(r.settings.fpts) + (number(r.settings.fpts_decimal) ?? 0) / 100;
      const total = sum(all.map(p => p.value)), age = total > 0 && all.every(p => p.age !== null) ? all.reduce((a, p) => a + p.value * p.age, 0) / total : null;
      return { id: r.roster_id, total, starter: line.total, bench: line.complete ? sum(all.filter(p => !ids.has(p.id)).map(p => p.value)) : null,
        positional, matched: all.filter(p => p.value !== null).length, count: all.length, age,
        window: ctx.format.dynasty && age !== null ? Math.max(0, Math.min(100, (35 - age) / 15 * 100)) : null,
        pointsPerGame: games > 0 && points !== null ? points / (games / (ctx.format.medianGame ? 2 : 1)) : null,
        winRate: games > 0 ? (completed[0] + completed[2] / 2) / games : null };
    }).sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
  }
  function fairness(give, receive) {
    const a = sum(give.map(p => p.value)), b = sum(receive.map(p => p.value));
    if (a === null || b === null || a <= 0 || b <= 0) return { available: false, flagged: true, give: a, receive: b };
    const lossA = Math.max(0, (a - b) / a), lossB = Math.max(0, (b - a) / b);
    return { available: true, give: a, receive: b, lossA, lossB, flagged: lossA > 0.15 || lossB > 0.15 };
  }
  function combinations(xs, n, offset = 0, prefix = [], result = []) {
    if (!n) { result.push(prefix); return result; }
    for (let i = offset; i <= xs.length - n; i++) combinations(xs, n - 1, i + 1, [...prefix, xs[i]], result);
    return result;
  }
  function tradeFindPartner(ctx, myId, targetId = null) {
    const f = ctx.format, my = ctx.rosters.find(r => String(r.roster_id) === String(myId));
    if (!my || f.disableTrades || (f.tradeDeadline > 0 && ctx.week > f.tradeDeadline)) return [];
    const mine = activePlayers(ctx, my), myBefore = optimize(mine, f.slots);
    if (!myBefore.complete || mine.some(p => p.value === null)) return [];
    const packages = [1, 2, 3].flatMap(n => combinations([...mine].sort((a, b) => b.value - a.value).slice(0, 18), n));
    const offers = [];
    for (const other of ctx.rosters.filter(r => r !== my)) {
      const theirs = activePlayers(ctx, other), before = optimize(theirs, f.slots);
      if (!before.complete || theirs.some(p => p.value === null)) continue;
      for (const target of theirs.filter(p => !targetId || p.id === String(targetId))) {
        let best = null;
        for (const give of packages) {
          const fair = fairness(give, [target]); if (!fair.available || fair.flagged) continue;
          const giveIds = new Set(give.map(p => p.id)), afterMine = optimize([...mine.filter(p => !giveIds.has(p.id)), target], f.slots);
          if (!afterMine.complete || afterMine.total <= myBefore.total) continue;
          const expanded = [...theirs.filter(p => p.id !== target.id), ...give], theirsAfter = optimize(expanded, f.slots);
          if (!theirsAfter.complete || theirsAfter.total < before.total) continue;
          // Explicitly retain every starter; any roster-limit drops are named and included in asset cost.
          const keep = new Set(theirsAfter.rows.map(r => r.player.id)), dropCount = Math.max(0, expanded.length - f.rosterSize);
          const drops = expanded.filter(p => !keep.has(p.id) && !giveIds.has(p.id)).sort((a, b) => a.value - b.value).slice(0, dropCount);
          if (drops.length !== dropCount) continue;
          const afterDropFair = fairness([target, ...drops], give); if (!afterDropFair.available || afterDropFair.flagged) continue;
          const theirGain = theirsAfter.total - before.total;
          const offer = { owner: other.roster_id, give, receive: [target], drops, fair, counterpartyFair: afterDropFair, myGain: afterMine.total - myBefore.total, theirGain,
            reason: `Adds starter value at ${target.position}; ${theirGain > 0 ? 'the other roster also improves its starter allocation' : 'their starter value is unchanged; their incentive is additional depth'}.`, bestBall: f.bestBall };
          if (!best || offer.myGain > best.myGain || (offer.myGain === best.myGain && fair.give < best.fair.give)) best = offer;
        }
        if (best) offers.push(best);
      }
    }
    return offers.sort((a, b) => b.myGain - a.myGain).slice(0, 36);
  }
  function tendencies(ctx) {
    if (!ctx.transactions) return null;
    const profiles = Object.fromEntries(ctx.rosters.map(r => [r.roster_id, { trades: 0, rbSales: 0, earlyRbSales: 0, waiverMoves: 0, picksAcquired: 0, pickOverpay: null }]));
    for (const t of ctx.transactions) {
      if (t.status !== 'complete') continue;
      if (t.type === 'trade') {
        for (const id of t.roster_ids || []) if (profiles[id]) profiles[id].trades++;
        for (const [pid, owner] of Object.entries(t.drops || {})) if (profiles[owner] && ctx.players[pid]?.position === 'RB') { profiles[owner].rbSales++; if (t.week <= 4) profiles[owner].earlyRbSales++; }
        for (const pick of t.draft_picks || []) if (profiles[pick.owner_id]) profiles[pick.owner_id].picksAcquired++;
      } else if (['waiver', 'free_agent'].includes(t.type)) for (const id of new Set(Object.values(t.adds || {}))) if (profiles[id]) profiles[id].waiverMoves++;
    }
    return profiles;
  }
  function waivers(ctx, myId) {
    const f = ctx.format, my = ctx.rosters.find(r => String(r.roster_id) === String(myId));
    if (!my) return { rows: [], remaining: null, bids: [], disabled: false };
    const used = number(my.settings?.waiver_budget_used), remaining = f.budget !== null && used !== null ? Math.max(0, f.budget - used) : null;
    const bids = (ctx.transactions || []).filter(t => t.type === 'waiver' && t.status === 'complete' && number(t.settings?.waiver_bid) !== null).map(t => Number(t.settings.waiver_bid)).sort((a, b) => a - b);
    const median = bids.length ? bids[Math.floor(bids.length / 2)] : null;
    const owned = new Set(ctx.rosters.flatMap(r => (r.players || []).map(String)));
    const adds = new Map((ctx.trendingAdd || []).map(p => [String(p.player_id), number(p.count)])), drops = new Map((ctx.trendingDrop || []).map(p => [String(p.player_id), number(p.count)]));
    const ids = new Set([...Object.keys(ctx.market.values), ...adds.keys(), ...drops.keys()]);
    const rows = [...ids].filter(id => !owned.has(id) && ctx.players[id]).map(id => {
      const p = player(ctx, id); if (!f.slots.some(slot => eligible(p, slot))) return null;
      const add = adds.get(id) ?? null, drop = drops.get(id) ?? null;
      const base = median !== null && f.budget > 0 && remaining !== null && f.waiverType === 2 ? Math.round(median / f.budget * remaining) : null;
      return { ...p, add, drop, bid: base !== null && remaining >= f.minBid ? Math.min(remaining, Math.max(f.minBid, base)) : null };
    }).filter(Boolean).sort((a, b) => (b.add ?? -1) - (a.add ?? -1) || (b.value ?? -1) - (a.value ?? -1));
    return { rows, remaining, bids, median, disabled: f.disableAdds };
  }
  const supportedStats = new Set(['pass_yd', 'pass_td', 'pass_int', 'pass_2pt', 'rush_yd', 'rush_td', 'rush_2pt', 'rec', 'rec_yd', 'rec_td', 'rec_2pt', 'fum', 'fum_lost', 'fum_rec_td', 'bonus_rec_te']);
  function projectionScores(raw, f, players) {
    const unknown = Object.entries(f.scoring).filter(([k, v]) => Number(v) !== 0 && !supportedStats.has(k) && !/^(fg|xp|pts_allow|def_|st_|sack$|int$|ff$|fum_rec$|safe$|blk_kick$)/.test(k)).map(([k]) => k);
    if (unknown.length || f.slots.some(s => ['K', 'DEF', ...IDP].includes(s))) return { scores: {}, reason: `Unsupported projection scoring: ${unknown.join(', ') || 'kicker or defense/IDP'}` };
    const rows = Array.isArray(raw) ? raw : [], scores = {};
    for (const r of rows) {
      const id = String(r.player_id), p = players[id]; if (!p || !r.stats || r.week === undefined) continue;
      let total = 0, valid = true;
      const applicable = p.position === 'QB' ? ['pass_', 'rush_', 'fum'] : ['rush_', 'rec', 'fum'];
      for (const [stat, weight] of Object.entries(f.scoring)) {
        if (!Number(weight) || !supportedStats.has(stat)) continue;
        if (stat === 'bonus_rec_te') { if (p.position === 'TE') { if (number(r.stats.rec) === null) valid = false; else total += r.stats.rec * weight; } continue; }
        if (!applicable.some(prefix => stat.startsWith(prefix))) continue;
        if (number(r.stats[stat]) === null) { valid = false; break; }
        total += Number(r.stats[stat]) * Number(weight);
      }
      if (valid) scores[id] = total;
    }
    return { scores, reason: Object.keys(scores).length ? null : 'No complete supported weekly projection statistics returned' };
  }
  function lineup(ctx, myId) {
    const my = ctx.rosters.find(r => String(r.roster_id) === String(myId)); if (!my) return null;
    const pool = activePlayers(ctx, my), scores = ctx.projections?.scores || {}, complete = pool.length > 0 && pool.every(p => number(scores[p.id]) !== null);
    const metric = complete ? 'projection' : 'value', candidates = pool.map(p => ({ ...p, projection: number(scores[p.id]) }));
    return { ...optimize(candidates, ctx.format.slots, metric), metric, pool: candidates, bestBall: ctx.format.bestBall,
      reason: complete ? 'Weekly projection statistics scored with this league’s supported rules.' : ctx.projections?.reason || 'No projections available. Value-ranked reference only; market value is not a weekly forecast.' };
  }
  function pickValue(pick, market) {
    const ordinal = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th' }[pick.round];
    const exact = market.picks.filter(p => p.name === `${pick.season} ${ordinal}` || p.name === `${pick.season} Round ${pick.round}` || p.name === `${pick.season} ${ordinal} Round`);
    return exact.length === 1 ? exact[0] : null;
  }
  function capital(ctx) {
    if (!ctx.tradedPicks || !ctx.drafts) return null;
    const f = ctx.format, years = new Set(ctx.tradedPicks.filter(p => Number(p.season) >= Number(f.season)).map(p => String(p.season)));
    for (const d of ctx.drafts) if (d.status !== 'complete') years.add(String(d.season));
    if (f.dynasty && f.draftRounds > 0) years.add(String(Number(f.season) + 1));
    const picks = new Map();
    for (const season of [...years].sort()) {
      const draft = ctx.drafts.find(d => String(d.season) === season && d.status !== 'complete');
      const rounds = number(draft?.settings?.rounds) ?? (f.dynasty && Number(season) > Number(f.season) ? f.draftRounds : null);
      if (!Number.isInteger(rounds) || rounds < 1) continue;
      for (const r of ctx.rosters) for (let round = 1; round <= rounds; round++) { const p = { season, round, roster_id: r.roster_id, owner_id: r.roster_id, entitlement: !draft }; picks.set(`${season}:${round}:${r.roster_id}`, p); }
    }
    for (const p of ctx.tradedPicks) {
      if (Number(p.season) < Number(f.season) || ctx.drafts.some(d => String(d.season) === String(p.season) && d.status === 'complete')) continue;
      picks.set(`${p.season}:${p.round}:${p.roster_id}`, { ...p, season: String(p.season), entitlement: false });
    }
    const rows = [...picks.values()].map(p => ({ ...p, market: pickValue(p, ctx.market) }));
    return { picks: rows, teams: ctx.rosters.map(r => {
      const owned = rows.filter(p => String(p.owner_id) === String(r.roster_id)), baseline = rows.filter(p => String(p.roster_id) === String(r.roster_id));
      const value = sum(owned.map(p => p.market?.value ?? null)), original = sum(baseline.map(p => p.market?.value ?? null));
      return { id: r.roster_id, count: owned.length, value, net: value !== null && original !== null ? value - original : null };
    }) };
  }
  function playoffs(ctx, myId, sims = 5000, seed = 20260908) {
    const f = ctx.format, fail = reason => ({ available: false, reason });
    if (!Number.isInteger(f.playoffStart) || f.playoffStart <= ctx.week || !Number.isInteger(f.playoffTeams) || f.playoffTeams < 2 || f.playoffTeams > ctx.rosters.length) return fail('An upcoming playoff field and regular-season schedule are required.');
    if (f.divisions || f.seedType || f.playoffType) return fail('This league’s custom/division playoff seeding is not supported by the simulation.');
    const ids = ctx.rosters.map(r => String(r.roster_id)), current = ids.indexOf(String(myId)), games = [];
    for (let week = ctx.week; week < f.playoffStart; week++) {
      const rows = ctx.matchups?.[week], seen = new Set(), groups = new Map();
      if (!Array.isArray(rows) || rows.length !== ids.length) return fail(`Actual schedule unavailable for week ${week}.`);
      for (const r of rows) { const id = String(r.roster_id); if (!ids.includes(id) || seen.has(id) || r.matchup_id === null || r.matchup_id === undefined) return fail(`Incomplete schedule for week ${week}.`); seen.add(id); groups.set(r.matchup_id, [...(groups.get(r.matchup_id) || []), ids.indexOf(id)]); }
      if ([...groups.values()].some(g => g.length !== 2)) return fail(`Non-head-to-head schedule in week ${week}.`);
      games.push({ week, pairs: [...groups.values()] });
    }
    const histories = ids.map(id => Object.entries(ctx.matchups || {}).filter(([w]) => Number(w) >= f.startWeek && Number(w) < ctx.week).map(([, rows]) => rows?.find(r => String(r.roster_id) === id)).filter(Boolean).map(r => number(r.custom_points) ?? number(r.points)));
    if (histories.some(h => h.length < 3 || h.length !== ctx.week - f.startWeek || h.some(x => x === null))) return fail('At least three completed scoring weeks per team, with no missing completed weeks, are required to estimate results-based strength and variation.');
    const records = ctx.rosters.map(r => [number(r.settings?.wins), number(r.settings?.losses), number(r.settings?.ties)]);
    if (records.some(r => r.includes(null) || sum(r) !== (ctx.week - f.startWeek) * (f.medianGame ? 2 : 1))) return fail('Standings do not align with completed weeks; refresh after the current week settles.');
    if (records.reduce((a, r) => a + r[0] - r[1], 0) !== 0) return fail('League wins and losses do not reconcile; refresh settled standings.');
    const points = ctx.rosters.map(r => number(r.settings?.fpts) === null ? null : Number(r.settings.fpts) + (number(r.settings.fpts_decimal) ?? 0) / 100);
    if (points.includes(null)) return fail('Standings points are unavailable.');
    const leagueMean = mean(histories.flat()), strengths = histories.map(h => (h.reduce((a, b) => a + b, 0) + 2 * leagueMean) / (h.length + 2));
    const residuals = histories.flatMap(h => h.map(x => x - mean(h)));
    if (!residuals.some(x => Math.abs(x) > 0.01)) return fail('Completed scores do not contain enough variation to estimate outcomes.');
    sims = Math.max(5000, Math.floor(sims));
    const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
    const seeds = ids.map(() => Array(ids.length).fill(0)), leverage = games.map(g => ({ week: g.week, wins: 0, losses: 0, qualifiedWin: 0, qualifiedLoss: 0 }));
    for (let sim = 0; sim < sims; sim++) {
      const wins = records.map(r => r[0] + r[2] / 2), pf = [...points], outcomes = [];
      for (let w = 0; w < games.length; w++) {
        const scores = strengths.map(mu => Math.max(0, mu + residuals[Math.floor(random() * residuals.length)]));
        scores.forEach((s, i) => { pf[i] += s; });
        for (const [a, b] of games[w].pairs) { const winner = scores[a] > scores[b] ? a : scores[a] < scores[b] ? b : random() < 0.5 ? a : b; wins[winner]++; if (a === current || b === current) outcomes[w] = winner === current; }
        if (f.medianGame) { const sorted = [...scores].sort((a, b) => a - b), median = (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2; scores.forEach((s, i) => { wins[i] += s > median ? 1 : s === median ? 0.5 : 0; }); }
      }
      const tie = ids.map(() => random()), order = ids.map((_, i) => i).sort((a, b) => wins[b] - wins[a] || pf[b] - pf[a] || tie[b] - tie[a]);
      order.forEach((id, i) => seeds[id][i]++);
      if (current >= 0) leverage.forEach((l, i) => { if (outcomes[i]) { l.wins++; if (order.indexOf(current) < f.playoffTeams) l.qualifiedWin++; } else { l.losses++; if (order.indexOf(current) < f.playoffTeams) l.qualifiedLoss++; } });
    }
    return { available: true, sims, teams: ids.map((id, i) => ({ id, odds: seeds[i].slice(0, f.playoffTeams).reduce((a, b) => a + b, 0) / sims, seeds: seeds[i].map(n => n / sims), strength: strengths[i] })),
      leverage: leverage.map(l => ({ week: l.week, win: l.wins ? l.qualifiedWin / l.wins : null, loss: l.losses ? l.qualifiedLoss / l.losses : null })).sort((a, b) => ((b.win ?? 0) - (b.loss ?? 0)) - ((a.win ?? 0) - (a.loss ?? 0))) };
  }
  const api = { number, sum, mean, normalize, format, marketUrl, csv, joinValues, player, activePlayers, eligible, optimize, power, fairness, tradeFindPartner, tendencies, waivers, projectionScores, lineup, pickValue, capital, playoffs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FFOLeagueDecision = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
