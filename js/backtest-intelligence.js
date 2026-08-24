(function(root,factory){
'use strict';
const api=factory();
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.FFOBacktest=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const numeric=(v,f=null)=>v===null||v===undefined||v===''?f:(Number.isFinite(Number(v))?Number(v):f);
const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,numeric(value,min)));
const mean=(values)=>values.length?values.reduce((sum,value)=>sum+numeric(value,0),0)/values.length:null;
function averageRanks(values){
 const indexed=values.map((value,index)=>({value:numeric(value),index})).filter(x=>x.value!=null).sort((a,b)=>a.value-b.value);
 const ranks=new Array(values.length).fill(null);
 let i=0;
 while(i<indexed.length){let j=i+1;while(j<indexed.length&&indexed[j].value===indexed[i].value)j++;const avg=((i+1)+j)/2;for(let k=i;k<j;k++)ranks[indexed[k].index]=avg;i=j;}
 return ranks;
}
function pearson(xs,ys){
 if(xs.length!==ys.length||xs.length<2)return null;const mx=xs.reduce((a,b)=>a+b,0)/xs.length,my=ys.reduce((a,b)=>a+b,0)/ys.length;let num=0,dx=0,dy=0;
 for(let i=0;i<xs.length;i++){const a=xs[i]-mx,b=ys[i]-my;num+=a*b;dx+=a*a;dy+=b*b}if(!dx||!dy)return null;return num/Math.sqrt(dx*dy);
}
function spearman(records,predictedField,actualField){
 const rows=records.filter(r=>numeric(r[predictedField])!=null&&numeric(r[actualField])!=null);if(rows.length<2)return null;
 return pearson(averageRanks(rows.map(r=>numeric(r[predictedField]))),averageRanks(rows.map(r=>numeric(r[actualField]))));
}
function assertUniqueKeys(records,keyField='key'){
 const seen=new Set();for(const row of records){const key=String(row[keyField]??'');if(!key)throw new Error(`Missing ${keyField}`);if(seen.has(key))throw new Error(`Duplicate ${keyField}: ${key}`);seen.add(key)}return true;
}
function topNOverlap(records,predictedField,actualField,n){
 const rows=records.filter(r=>numeric(r[predictedField])!=null&&numeric(r[actualField])!=null);const predicted=new Set(rows.filter(r=>numeric(r[predictedField])<=n).map(r=>String(r.key)));const actual=new Set(rows.filter(r=>numeric(r[actualField])<=n).map(r=>String(r.key)));let hits=0;predicted.forEach(k=>{if(actual.has(k))hits++});return{n,hits,predicted:predicted.size,actual:actual.size,precision:predicted.size?hits/predicted.size:null,recall:actual.size?hits/actual.size:null};
}
function runBacktest(records,options={}){
 const exclude=options.excludeInjuryDistorted!==false;const input=records||[];assertUniqueKeys(input,options.keyField||'key');const filtered=input.filter(r=>!exclude||!r.injuryDistorted);const withOutcome=filtered.filter(r=>numeric(r.actualOutcomeRank)!=null);
 return{sampleSize:withOutcome.length,excludedInjuryDistorted:input.length-filtered.length,missingOutcome:filtered.length-withOutcome.length,modelRankCorrelation:spearman(withOutcome,'modelRank','actualOutcomeRank'),consensusRankCorrelation:spearman(withOutcome.filter(r=>numeric(r.consensusRank)!=null),'consensusRank','actualOutcomeRank'),adpRankCorrelation:spearman(withOutcome.filter(r=>numeric(r.adpRank)!=null),'adpRank','actualOutcomeRank'),modelTop24Overlap:topNOverlap(withOutcome,'modelRank','actualOutcomeRank',24),consensusTop24Overlap:topNOverlap(withOutcome.filter(r=>numeric(r.consensusRank)!=null),'consensusRank','actualOutcomeRank',24),adpTop24Overlap:topNOverlap(withOutcome.filter(r=>numeric(r.adpRank)!=null),'adpRank','actualOutcomeRank',24)};
}
function probability(value){const number=numeric(value,null);if(number==null)return null;return clamp(number>1?number/100:number);}
function brierScore(records,predictedField='predictedWinRate',outcomeField='won'){
 const rows=(records||[]).map(row=>({p:probability(row[predictedField]),y:numeric(row[outcomeField],null)})).filter(row=>row.p!=null&&(row.y===0||row.y===1));
 return{n:rows.length,score:rows.length?mean(rows.map(row=>(row.p-row.y)**2)):null};
}
function calibrationCurve(records,{predictedField='predictedWinRate',outcomeField='won',bins=10}={}){
 const count=Math.max(2,Math.min(20,Math.round(numeric(bins,10))));const groups=Array.from({length:count},()=>[]);
 for(const row of records||[]){const p=probability(row[predictedField]),y=numeric(row[outcomeField],null);if(p==null||(y!==0&&y!==1))continue;groups[Math.min(count-1,Math.floor(p*count))].push({p,y});}
 return groups.map((rows,index)=>({bin:index+1,low:index/count,high:(index+1)/count,n:rows.length,predicted:rows.length?mean(rows.map(row=>row.p)):null,observed:rows.length?mean(rows.map(row=>row.y)):null})).filter(row=>row.n);
}
function expectedCalibrationError(records,options={}){
 const curve=calibrationCurve(records,options),n=curve.reduce((sum,row)=>sum+row.n,0);
 return{n,ece:n?curve.reduce((sum,row)=>sum+row.n*Math.abs(row.predicted-row.observed),0)/n:null,bins:curve};
}
function pairedComparison(records,{modelField='modelPoints',baselineField='baselinePoints'}={}){
 const deltas=(records||[]).map(row=>{const model=numeric(row[modelField],null),baseline=numeric(row[baselineField],null);return model==null||baseline==null?null:model-baseline;}).filter(value=>value!=null);
 if(!deltas.length)return{n:0,meanDelta:null,pairedWinRate:null,ci95:[null,null]};
 const avg=mean(deltas),variance=deltas.length>1?deltas.reduce((sum,value)=>sum+(value-avg)**2,0)/(deltas.length-1):0,se=Math.sqrt(variance/deltas.length),margin=1.96*se;
 return{n:deltas.length,meanDelta:avg,pairedWinRate:deltas.filter(value=>value>0).length/deltas.length,ci95:[avg-margin,avg+margin]};
}
function timeLockAudit(records,{asOfField='asOf',outcomeAtField='outcomeAt',inputTimestampsField='inputTimestamps'}={}){
 const violations=[];
 (records||[]).forEach((row,index)=>{const asOf=Date.parse(row[asOfField]||''),outcome=Date.parse(row[outcomeAtField]||'');if(!Number.isFinite(asOf)||!Number.isFinite(outcome)||asOf>=outcome)violations.push({index,reason:'invalid decision/outcome boundary'});for(const stamp of row[inputTimestampsField]||[]){const input=Date.parse(stamp||'');if(!Number.isFinite(input)||input>asOf)violations.push({index,reason:'input timestamp occurs after decision boundary',timestamp:stamp});}});
 return{records:(records||[]).length,passed:violations.length===0,violations};
}
function runDecisionValidation(records,options={}){
 const audit=timeLockAudit(records,options),calibration=expectedCalibrationError(records,options),brier=brierScore(records,options.predictedField||'predictedWinRate',options.outcomeField||'won'),paired=pairedComparison(records,options);
 const promoted=audit.passed&&calibration.n>=100&&calibration.ece!=null&&calibration.ece<=.05&&paired.meanDelta!=null&&paired.ci95[0]>0;
 return{status:promoted?'validated':'research',promotionReady:promoted,timeLock:audit,calibration,brier,paired};
}
return{averageRanks,pearson,spearman,assertUniqueKeys,topNOverlap,runBacktest,probability,brierScore,calibrationCurve,expectedCalibrationError,pairedComparison,timeLockAudit,runDecisionValidation};
});
