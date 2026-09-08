import fs from 'node:fs';
const { chromium, devices } = await import(process.env.CODEX_PLAYWRIGHT_PATH || 'playwright');

const base=process.env.DASHBOARD_E2E_URL||'http://127.0.0.1:4173/';
const browser=await chromium.launch({headless:true});
const weekly={projection_scope:'weekly',week:1,players:[
 {name:'D’Andre Swift',position:'RB',team:'CHI',opponent:'CAR',projected_points:13.7,source_ids:{sleeper:'swift'} ,data_confidence:{label:'HIGH'}},
 {name:'Josh Allen',position:'QB',team:'BUF',opponent:'HOU',projected_points:23.4,source_ids:{sleeper:'p1'}},
 {name:'Jahmyr Gibbs',position:'RB',team:'DET',opponent:'NO',projected_points:18.5,source_ids:{sleeper:'p2'}},
 {name:'Drake Maye',position:'QB',team:'NE',opponent:'SEA',projected_points:20.1,source_ids:{sleeper:'p3'}},
 {name:'Bijan Robinson',position:'RB',team:'ATL',opponent:'PIT',projected_points:20.2,source_ids:{sleeper:'p4'}}
]};
const lines=JSON.parse(fs.readFileSync(new URL('../data/vegas/game-lines.json',import.meta.url)));
const intel=JSON.parse(fs.readFileSync(new URL('../data/draft_intelligence.json',import.meta.url)));
const profile=Object.values(intel.profiles)[0];
const draftMarket=profile.players.filter(p=>['QB','RB','WR','TE','K','DST'].includes(p.position)).map((p,i)=>({player:{sleeperId:String(p.sleeper_id||`d${i}`),name:p.name,position:p.position,maybeTeam:p.team},overallRank:p.overall_rank,rank:p.overall_rank,value:p.market_value||5000}));

async function routeCommon(page){
 await page.route('**://api.fantasycalc.com/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(draftMarket)}));
 await page.route('**/data/weekly_projections.json*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(weekly)}));
 await page.route('**/data/vegas/game-lines.json*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(lines)}));
}

try{
 const trade=await browser.newPage({viewport:{width:1440,height:900}});await routeCommon(trade);
 await trade.goto(`${base}trade-intelligence.html`,{waitUntil:'domcontentloaded'});
 await trade.waitForFunction(()=>document.querySelectorAll('#board [data-player]').length>0);
 await trade.locator('#search').fill('swift');
 if(await trade.locator('#board [data-player]').count()!==1)throw Error('Trade search did not return D’Andre Swift');
 await trade.locator('#board [data-player]').click();await trade.locator('[data-add="get"]').click();
 if(!/Swift/.test(await trade.locator('#get').innerText()))throw Error('Trade target could not be added to the package');
 if(!/13\.7\d* projected Week 1 points/.test(await trade.locator('#detail').innerText()))throw Error('Trade lens omitted production forecast');

 const matchup=await browser.newPage({viewport:{width:1440,height:900}});await routeCommon(matchup);
 await matchup.addInitScript(()=>{localStorage.setItem('ffo_provider_league_ids_v1',JSON.stringify({'sleeper-partender-dynasty':'league-e2e'}));localStorage.setItem('ffo_roster_id_by_league_v1',JSON.stringify({'league-e2e':1}));});
 await matchup.route('**://api.sleeper.app/v1/league/league-e2e?*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({name:'E2E League',settings:{leg:1},roster_positions:['QB','RB']})}));
 await matchup.route('**://api.sleeper.app/v1/league/league-e2e/rosters*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{roster_id:1,owner_id:'u1',players:['p1','p2']},{roster_id:2,owner_id:'u2',players:['p3','p4']}])}));
 await matchup.route('**://api.sleeper.app/v1/league/league-e2e/users*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{user_id:'u1',display_name:'Partender'},{user_id:'u2',display_name:'Opponent FC'}])}));
 await matchup.route('**://api.sleeper.app/v1/league/league-e2e/matchups/1*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{roster_id:1,matchup_id:7},{roster_id:2,matchup_id:7}])}));
 await matchup.route('**://api.sleeper.app/v1/players/nfl*',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 await matchup.goto(`${base}matchup.html`,{waitUntil:'domcontentloaded'});
 await matchup.waitForFunction(()=>/Partender vs Opponent FC/.test(document.querySelector('#title')?.textContent||''));
 if(await matchup.locator('#my-lineup .player').count()!==2)throw Error('Suggested starting lineup did not render');
 if(!/VEGAS/.test(await matchup.locator('#my-lineup').innerText()))throw Error('Matchup lineup omitted Vegas context');

 const draft=await browser.newPage({viewport:{width:1884,height:973}});await routeCommon(draft);
 await draft.goto(`${base}draft.html`,{waitUntil:'domcontentloaded'});await draft.waitForURL(/draft-room-v5\.html/);
 await draft.waitForFunction(()=>document.querySelectorAll('#board [data-k]').length>0,null,{timeout:30000});
 await draft.locator('#start').click();await draft.waitForFunction(()=>/YOU ARE ON THE CLOCK/.test(document.querySelector('#clock')?.textContent||''),null,{timeout:15000});
 const trust=await draft.locator('#decision-trust').innerText(),match=trust.match(/(\d+)\/100 EVIDENCE/);if(!match||Number(match[1])<70)throw Error(`Early-round evidence confidence is not supported (${trust})`);if(/VERY LOW/.test(trust))throw Error(`Early-round confidence still reports VERY LOW (${trust})`);if(!/ACTUAL CORRECTNESS · NOT YET MEASURED/.test(trust))throw Error(`Correctness is not separated from evidence confidence (${trust})`);console.log(`early-round model check: ${match[1]}/100 evidence`);
 await draft.evaluate(()=>document.querySelector('.board-shell').classList.add('expanded'));const boxes=await draft.evaluate(()=>{const d=document.querySelector('.decision').getBoundingClientRect(),p=document.querySelector('.players').getBoundingClientRect(),b=document.querySelector('.draft-grid-wrap').getBoundingClientRect(),q=document.querySelector('.quickmetrics').getBoundingClientRect();return{decisionBottom:d.bottom,playersTop:p.top,boardHeight:b.height,metricsBottom:q.bottom}});if(boxes.decisionBottom>boxes.playersTop+1)throw Error(`Draft advisor overlaps players ${JSON.stringify(boxes)}`);if(boxes.metricsBottom>boxes.decisionBottom+1)throw Error(`Draft metrics escape advisor card ${JSON.stringify(boxes)}`);if(boxes.boardHeight>312)throw Error(`Expanded draft board exceeds layout budget ${JSON.stringify(boxes)}`);

 const phone=await browser.newPage({...devices['iPhone 13']});await routeCommon(phone);await phone.goto(`${base}trade-intelligence.html`,{waitUntil:'domcontentloaded'});await phone.waitForFunction(()=>document.querySelectorAll('#board [data-player]').length>0);const overflow=await phone.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1);if(overflow)throw Error('Trade Intelligence overflows iPhone width');
 console.log('decision pages desktop + iPhone E2E passed');
}finally{await browser.close()}
