const assert = require('assert');
const Sync = require('../js/provider-draft-sync.js');

const draft = {
  draft_id: 'draft-1',
  status: 'drafting',
  slot_to_roster_id: { '1': 10, '2': 3, '3': 5 },
};
const provider = [
  { draft_id:'draft-1', pick_no:1, round:1, draft_slot:1, roster_id:'10', player_id:'p1', metadata:{ first_name:'Alpha', last_name:'One', position:'WR', team:'BUF' } },
  { draft_id:'draft-1', pick_no:2, round:1, draft_slot:2, roster_id:'3', player_id:'p2', metadata:{ first_name:'Beta', last_name:'Two', position:'RB', team:'KC' } },
  // A traded destination: the pick occurred in slot 3 but belongs to roster 10, so team must resolve to slot 1.
  { draft_id:'draft-1', pick_no:3, round:1, draft_slot:3, roster_id:'10', player_id:'p3', metadata:{ first_name:'Gamma', last_name:'Three', position:'QB', team:'PHI' } },
];
const lookup = {
  p1:{ key:'p1', name:'Alpha One', position:'WR', overallRank:1 },
  p2:{ key:'p2', name:'Beta Two', position:'RB', overallRank:2 },
  p3:{ key:'p3', name:'Gamma Three', position:'QB', overallRank:3 },
};

{
  const v = Sync.validateProviderPicks(provider);
  assert.equal(v.valid, true);
  assert.equal(v.picks.length, 3);
}

{
  const normalized = Sync.normalizeSleeperPick(provider[2], draft, lookup);
  assert.equal(normalized.pick, 3);
  assert.equal(normalized.rosterId, '10');
  assert.equal(normalized.team, 1, 'destination roster should resolve through slot_to_roster_id');
  assert.equal(normalized.key, 'p3');
  assert.equal(normalized.source, 'provider:sleeper');
}

{
  const r = Sync.reconcile({ localPicks:[], providerPicks:provider, draft, expectedDraftId:'draft-1', playerLookup:lookup });
  assert.equal(r.status, Sync.STATUS.ADVANCED);
  assert.equal(r.safeToApply, true);
  assert.equal(r.additions.length, 3);
  assert.deepEqual(Sync.applyReconciliation([], r).map(p=>p.key), ['p1','p2','p3']);
}

{
  const local = provider.slice(0,2).map(p => Sync.normalizeSleeperPick(p, draft, lookup));
  const r = Sync.reconcile({ localPicks:local, providerPicks:provider, draft, expectedDraftId:'draft-1', playerLookup:lookup });
  assert.equal(r.status, Sync.STATUS.ADVANCED);
  assert.equal(r.additions.length, 1);
  assert.deepEqual(Sync.applyReconciliation(local,r).map(p=>p.key), ['p1','p2','p3']);
}

{
  const local = provider.map(p => Sync.normalizeSleeperPick(p, draft, lookup));
  const r = Sync.reconcile({ localPicks:local, providerPicks:provider, draft, expectedDraftId:'draft-1', playerLookup:lookup });
  assert.equal(r.status, Sync.STATUS.CURRENT);
  assert.equal(r.safeToApply, true);
  assert.equal(r.additions.length, 0);
}

{
  const local = [
    Sync.normalizeSleeperPick(provider[0], draft, lookup),
    { ...Sync.normalizeSleeperPick(provider[1], draft, lookup), key:'different', playerId:'different' },
  ];
  const r = Sync.reconcile({ localPicks:local, providerPicks:provider, draft, expectedDraftId:'draft-1', playerLookup:lookup });
  assert.equal(r.status, Sync.STATUS.DIVERGED);
  assert.equal(r.safeToApply, false);
  assert.equal(r.divergenceAt, 2);
  assert.deepEqual(Sync.applyReconciliation(local,r), local, 'conflict must never mutate local picks');
}

{
  const local = provider.map(p => Sync.normalizeSleeperPick(p, draft, lookup));
  local.push({ pick:4, pickNo:4, key:'local-only', playerId:'local-only', name:'Local Only', position:'TE', team:2 });
  const r = Sync.reconcile({ localPicks:local, providerPicks:provider, draft, expectedDraftId:'draft-1', playerLookup:lookup });
  assert.equal(r.status, Sync.STATUS.LOCAL_AHEAD);
  assert.equal(r.safeToApply, false);
  assert.equal(r.localAhead.length, 1);
}

{
  const gapped = [provider[0], provider[2]];
  const r = Sync.reconcile({ localPicks:[], providerPicks:gapped, draft, expectedDraftId:'draft-1', playerLookup:lookup });
  assert.equal(r.status, Sync.STATUS.INVALID_PROVIDER);
  assert.equal(r.safeToApply, false);
  assert.ok(r.issues.some(x=>x.includes('gap')));
}

{
  const duplicatePlayer = [provider[0], { ...provider[1], player_id:'p1' }];
  const r = Sync.reconcile({ localPicks:[], providerPicks:duplicatePlayer, draft, expectedDraftId:'draft-1', playerLookup:lookup });
  assert.equal(r.status, Sync.STATUS.INVALID_PROVIDER);
  assert.ok(r.issues.some(x=>x.includes('more than once')));
}

{
  const r = Sync.reconcile({ localPicks:[], providerPicks:provider, draft:{...draft,draft_id:'draft-2'}, expectedDraftId:'draft-1', playerLookup:lookup });
  assert.equal(r.status, Sync.STATUS.DIFFERENT_DRAFT);
  assert.equal(r.safeToApply, false);
}

console.log('provider draft sync tests passed');
