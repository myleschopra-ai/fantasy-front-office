(function(root,factory){
'use strict';
const api=factory();
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.FFOBacktest=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const numeric=(v,f=null)=>v===null||v===undefined||v===''?f:(Number.isFinite(Number(v))?Number(v):f);
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
return{averageRanks,pearson,spearman,assertUniqueKeys,topNOverlap,runBacktest};
});
