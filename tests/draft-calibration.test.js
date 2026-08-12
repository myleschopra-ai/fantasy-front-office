const assert=require('assert'),C=require('../js/draft-calibration.js');
const drafts=[1,2,3,4].map((n)=>({picks:[{key:'p1',pick:10+n},{key:'thin',pick:20}]}));
const model=C.snakeModel({drafts});assert.equal(model.p1.n,4);assert.equal(model.thin.eligible,true);
const applied=C.calibratedAdp({key:'p1',adp:8},model);assert.equal(applied.applied,true);assert.ok(applied.shift<=8&&applied.shift>0);
assert.equal(C.calibratedAdp({key:'missing',adp:30},model).applied,false);
const managers=C.auctionTendencies({seasons:[{purchases:[{manager:'A',price:55,generic_aav:50},{manager:'A',price:45,generic_aav:50}]}]});assert.equal(managers.A.n,2);assert.equal(managers.A.premium,0);
console.log('draft calibration tests passed');
