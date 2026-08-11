const assert = require('assert');
const Client = require('../js/sleeper-draft-client.js');

{
  const drafts = [
    { draft_id:'old', season:'2025', status:'complete', type:'snake', created:1 },
    { draft_id:'current-pre', season:'2026', status:'pre_draft', type:'snake', created:2 },
    { draft_id:'current-live', season:'2026', status:'drafting', type:'snake', created:3 },
    { draft_id:'auction', season:'2026', status:'drafting', type:'auction', created:4 },
  ];
  assert.equal(Client.chooseDraft(drafts,{season:2026,type:'snake'}).draft_id,'current-live');
  assert.equal(Client.chooseDraft(drafts,{season:2026,type:'auction'}).draft_id,'auction');
}

{
  const calls=[];
  const fetchFn=async url=>{
    calls.push(url);
    if(url.endsWith('/league/L1/drafts')) return {ok:true,json:async()=>[{draft_id:'D1',season:'2026',status:'drafting',type:'snake'}]};
    if(url.endsWith('/draft/D1')) return {ok:true,json:async()=>({draft_id:'D1',season:'2026',status:'drafting',type:'snake',slot_to_roster_id:{1:1}})};
    if(url.endsWith('/draft/D1/picks')) return {ok:true,json:async()=>[{draft_id:'D1',pick_no:1,player_id:'P1'}]};
    return {ok:false,status:404,json:async()=>({})};
  };
  Client.snapshotForLeague('L1',{season:2026,type:'snake',fetchFn,baseUrl:'https://test',now:0}).then(snapshot=>{
    assert.equal(snapshot.draft.draft_id,'D1');
    assert.equal(snapshot.picks.length,1);
    assert.equal(calls.length,3);
  });
}

(async()=>{
  let calls=0;
  let visible=true;
  const poller=Client.createPoller(async()=>{calls+=1;},{intervalMs:5000,isVisible:()=>visible});
  await poller.tick();
  assert.equal(calls,0,'tick before start should do nothing');
  poller.start();
  await new Promise(r=>setTimeout(r,10));
  assert.equal(calls,1,'start should sync immediately');
  visible=false;
  await poller.tick();
  assert.equal(calls,1,'hidden page should not sync');
  visible=true;
  await poller.tick();
  assert.equal(calls,2,'visible manual tick should sync');
  poller.stop();
  assert.equal(poller.status().running,false);
  console.log('sleeper draft client tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
