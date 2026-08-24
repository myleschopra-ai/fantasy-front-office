'use strict';
const assert=require('node:assert/strict');
const B=require('../js/backtest-intelligence.js');

assert.deepEqual(B.averageRanks([1,2,2,4]),[1,2.5,2.5,4]);
assert.ok(Math.abs(B.spearman([{p:1,a:1},{p:2,a:2},{p:3,a:3}],'p','a')-1)<1e-9);
assert.ok(Math.abs(B.spearman([{p:1,a:3},{p:2,a:2},{p:3,a:1}],'p','a')+1)<1e-9);
const rows=[
 {key:'a',modelRank:1,consensusRank:3,adpRank:2,actualOutcomeRank:1},
 {key:'b',modelRank:2,consensusRank:1,adpRank:1,actualOutcomeRank:2},
 {key:'c',modelRank:2,consensusRank:2,adpRank:3,actualOutcomeRank:3},
 {key:'d',modelRank:4,consensusRank:4,adpRank:4,actualOutcomeRank:4,injuryDistorted:true},
 {key:'e',modelRank:5,consensusRank:5,adpRank:5,actualOutcomeRank:null},
];
const report=B.runBacktest(rows);
assert.equal(report.sampleSize,3);
assert.equal(report.excludedInjuryDistorted,1);
assert.equal(report.missingOutcome,1);
assert.ok(report.modelRankCorrelation>0.85);
const overlap=B.topNOverlap([{key:'a',p:1,a:3},{key:'b',p:2,a:1},{key:'c',p:3,a:2}],'p','a',2);
assert.equal(overlap.hits,1,'top-N overlap must compare player identities, not numeric rank values');
assert.throws(()=>B.runBacktest([{key:'x',modelRank:1,actualOutcomeRank:1},{key:'x',modelRank:2,actualOutcomeRank:2}]),/Duplicate key/);
const probabilityRows=[
 {predictedWinRate:80,won:1,modelPoints:120,baselinePoints:110,asOf:'2025-08-20T00:00:00Z',outcomeAt:'2025-09-10T00:00:00Z',inputTimestamps:['2025-08-19T00:00:00Z']},
 {predictedWinRate:.2,won:0,modelPoints:115,baselinePoints:108,asOf:'2025-08-20T00:00:00Z',outcomeAt:'2025-09-10T00:00:00Z',inputTimestamps:['2025-08-18T00:00:00Z']},
];
assert.equal(B.brierScore(probabilityRows).n,2);
assert.ok(B.brierScore(probabilityRows).score<.05);
assert.equal(B.expectedCalibrationError(probabilityRows,{bins:5}).bins.length,2);
assert.equal(B.pairedComparison(probabilityRows).meanDelta,8.5);
assert.equal(B.timeLockAudit(probabilityRows).passed,true);
assert.equal(B.timeLockAudit([{...probabilityRows[0],inputTimestamps:['2025-08-21T00:00:00Z']}]).passed,false);
assert.equal(B.runDecisionValidation(probabilityRows).promotionReady,false,'small samples remain research-only');
console.log('backtest-intelligence.js tests passed');
