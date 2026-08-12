(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FFOProviderDraftSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STATUS = Object.freeze({
    IDLE: 'IDLE',
    SYNCING: 'SYNCING',
    CURRENT: 'CURRENT',
    ADVANCED: 'ADVANCED',
    LOCAL_AHEAD: 'LOCAL_AHEAD',
    DIVERGED: 'DIVERGED',
    INVALID_PROVIDER: 'INVALID_PROVIDER',
    DIFFERENT_DRAFT: 'DIFFERENT_DRAFT',
    ERROR: 'ERROR',
  });

  function text(value) {
    return String(value ?? '').trim();
  }

  function positiveInt(value) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  function playerId(value) {
    return text(value?.playerId || value?.player_id || value?.key);
  }

  function pickNo(value, fallback) {
    return positiveInt(value?.pick ?? value?.pickNo ?? value?.pick_no ?? fallback);
  }

  function providerPickIdentity(pick) {
    return text(pick?.player_id || pick?.metadata?.player_id);
  }

  function validateProviderPicks(picks) {
    const list = Array.isArray(picks) ? [...picks] : [];
    const issues = [];
    const byPick = new Set();
    const byPlayer = new Set();
    const normalized = list
      .map((pick, index) => ({ ...pick, __pickNo: pickNo(pick, index + 1) }))
      .sort((a, b) => (a.__pickNo || 0) - (b.__pickNo || 0));

    normalized.forEach((pick, index) => {
      const number = pick.__pickNo;
      const id = providerPickIdentity(pick);
      if (!number) issues.push(`Provider pick at index ${index} has no valid pick number`);
      else if (byPick.has(number)) issues.push(`Provider returned duplicate pick number ${number}`);
      else byPick.add(number);

      if (!id) issues.push(`Provider pick ${number || index + 1} has no player ID`);
      else if (byPlayer.has(id)) issues.push(`Provider returned player ${id} more than once`);
      else byPlayer.add(id);
    });

    normalized.forEach((pick, index) => {
      if (pick.__pickNo && pick.__pickNo !== index + 1) {
        issues.push(`Provider pick history gap: expected ${index + 1}, found ${pick.__pickNo}`);
      }
    });

    return { valid: issues.length === 0, issues, picks: normalized };
  }

  function rosterToTeamMap(draft = {}) {
    const result = {};
    Object.entries(draft.slot_to_roster_id || draft.slotToRosterId || {}).forEach(([slot, rosterId]) => {
      const team = positiveInt(slot);
      if (team && rosterId != null) result[text(rosterId)] = team;
    });
    return result;
  }

  function sleeperName(pick) {
    const metadata = pick?.metadata || {};
    const first = text(metadata.first_name);
    const last = text(metadata.last_name);
    return `${first} ${last}`.trim() || text(metadata.name) || `Sleeper ${providerPickIdentity(pick) || 'player'}`;
  }

  function normalizeSleeperPick(pick, draft = {}, playerLookup = {}) {
    const number = pickNo(pick);
    const sleeperId = providerPickIdentity(pick);
    const lookup = playerLookup[sleeperId] || {};
    const rosterId = text(pick?.roster_id);
    const teamByRoster = rosterToTeamMap(draft);
    const team = teamByRoster[rosterId] || positiveInt(pick?.draft_slot) || positiveInt(rosterId) || 1;
    const position = text(lookup.position || pick?.metadata?.position || '?').toUpperCase();
    const nflTeam = text(lookup.nflTeam || lookup.team || pick?.metadata?.team);
    const name = text(lookup.name) || sleeperName(pick);

    return {
      ...lookup,
      pick: number,
      pickNo: number,
      round: positiveInt(pick?.round) || null,
      roundSlot: positiveInt(pick?.draft_slot) || null,
      team,
      rosterId: rosterId || String(team),
      playerId: sleeperId,
      key: sleeperId,
      name,
      position,
      nflTeam,
      source: 'provider:sleeper',
      provider: 'sleeper',
      providerDraftId: text(pick?.draft_id || draft?.draft_id),
      providerPickedBy: text(pick?.picked_by),
      isKeeper: Boolean(pick?.is_keeper),
    };
  }

  function sameCanonicalPick(local, provider) {
    const localNumber = pickNo(local);
    const providerNumber = pickNo(provider);
    const localPlayer = playerId(local);
    const providerPlayer = playerId(provider);
    return localNumber === providerNumber && Boolean(localPlayer) && localPlayer === providerPlayer;
  }

  function localHistoryIssues(localPicks) {
    const issues = [];
    const list = Array.isArray(localPicks) ? localPicks : [];
    const pickNumbers = new Set();
    const players = new Set();
    list.forEach((pick, index) => {
      const number = pickNo(pick, index + 1);
      const id = playerId(pick);
      if (!number) issues.push(`Local pick at index ${index} has no valid pick number`);
      else if (pickNumbers.has(number)) issues.push(`Local duplicate pick number ${number}`);
      else pickNumbers.add(number);
      if (!id) issues.push(`Local pick ${number || index + 1} has no canonical player ID`);
      else if (players.has(id)) issues.push(`Local player ${id} appears more than once`);
      else players.add(id);
    });
    return issues;
  }

  function reconcile(options = {}) {
    const local = Array.isArray(options.localPicks) ? options.localPicks : [];
    const draft = options.draft || {};
    const expectedDraftId = text(options.expectedDraftId);
    const actualDraftId = text(draft.draft_id || options.providerDraftId);
    if (expectedDraftId && actualDraftId && expectedDraftId !== actualDraftId) {
      return {
        status: STATUS.DIFFERENT_DRAFT,
        safeToApply: false,
        issues: [`Expected draft ${expectedDraftId}, provider returned ${actualDraftId}`],
        confirmedPicks: [],
        additions: [],
        localAhead: [],
      };
    }

    const providerValidation = validateProviderPicks(options.providerPicks);
    if (!providerValidation.valid) {
      return {
        status: STATUS.INVALID_PROVIDER,
        safeToApply: false,
        issues: providerValidation.issues,
        confirmedPicks: [],
        additions: [],
        localAhead: [],
      };
    }

    const localIssues = localHistoryIssues(local);
    if (localIssues.length) {
      return {
        status: STATUS.DIVERGED,
        safeToApply: false,
        issues: localIssues,
        confirmedPicks: [],
        additions: [],
        localAhead: [],
      };
    }

    const provider = providerValidation.picks.map((pick) =>
      normalizeSleeperPick(pick, draft, options.playerLookup || {}),
    );
    const sharedLength = Math.min(local.length, provider.length);
    for (let index = 0; index < sharedLength; index += 1) {
      if (!sameCanonicalPick(local[index], provider[index])) {
        return {
          status: STATUS.DIVERGED,
          safeToApply: false,
          divergenceAt: index + 1,
          issues: [
            `Pick ${index + 1} differs: local ${playerId(local[index]) || 'unknown'} vs provider ${playerId(provider[index]) || 'unknown'}`,
          ],
          confirmedPicks: provider,
          additions: [],
          localAhead: local.slice(index),
        };
      }
    }

    if (local.length > provider.length) {
      return {
        status: STATUS.LOCAL_AHEAD,
        safeToApply: false,
        issues: [`Local session has ${local.length - provider.length} pick${local.length - provider.length === 1 ? '' : 's'} not yet confirmed by Sleeper`],
        confirmedPicks: provider,
        additions: [],
        localAhead: local.slice(provider.length),
      };
    }

    const additions = provider.slice(local.length);
    return {
      status: additions.length ? STATUS.ADVANCED : STATUS.CURRENT,
      safeToApply: true,
      issues: [],
      confirmedPicks: provider,
      additions,
      localAhead: [],
      providerPickCount: provider.length,
    };
  }

  function applyReconciliation(localPicks, result) {
    if (!result?.safeToApply) return Array.isArray(localPicks) ? [...localPicks] : [];
    return [...(Array.isArray(localPicks) ? localPicks : []), ...(result.additions || [])];
  }

  function syncLabel(result, draft = {}) {
    const status = result?.status || STATUS.IDLE;
    const count = Number(result?.providerPickCount ?? result?.confirmedPicks?.length ?? 0);
    const draftStatus = text(draft?.status).toUpperCase();
    if (status === STATUS.ADVANCED) return `SYNCED · ${count} confirmed picks${draftStatus ? ` · ${draftStatus}` : ''}`;
    if (status === STATUS.CURRENT) return `CURRENT · ${count} confirmed picks${draftStatus ? ` · ${draftStatus}` : ''}`;
    if (status === STATUS.LOCAL_AHEAD) return 'LOCAL AHEAD · provider confirmation required';
    if (status === STATUS.DIVERGED) return `CONFLICT · pick ${result?.divergenceAt || '?'}`;
    if (status === STATUS.INVALID_PROVIDER) return 'PROVIDER DATA INVALID';
    if (status === STATUS.DIFFERENT_DRAFT) return 'WRONG DRAFT';
    return status;
  }

  return {
    STATUS,
    applyReconciliation,
    normalizeSleeperPick,
    reconcile,
    rosterToTeamMap,
    sameCanonicalPick,
    syncLabel,
    validateProviderPicks,
  };
});
