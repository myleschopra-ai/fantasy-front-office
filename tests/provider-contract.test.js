const assert=require('assert'),P=require('../js/provider-contract.js');
const result=P.normalizeImport({provider:'espn',league:{id:42,name:'Home',size:10,roster:{QB:1}},picks:[{overall_pick:1,team_id:4,athlete_id:'99',name:'Player',position:'RB'}]});
assert.equal(result.readOnly,true);assert.equal(result.league.teams,10);assert.equal(result.picks[0].playerId,'99');
assert.throws(()=>P.normalizeImport({provider:'espn',espn_s2:'secret'}),/Sensitive field/);
assert.throws(()=>P.normalizeImport({provider:'other'}),/Unsupported provider/);
console.log('provider contract tests passed');
