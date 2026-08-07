(()=>{'use strict';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function mean(xs){return xs?.length?xs.reduce((a,b)=>a+b,0)/xs.length:0}
function stdev(xs){if(!xs||xs.length<2)return 0;const m=mean(xs);return Math.sqrt(mean(xs.map(x=>(x-m)*(x-m))))}
function assetProtection({adp=999,weight=.5}){
  if(!Number.isFinite(adp)||adp>=180)return 0;
  return clamp((180-adp)/180*8*weight,0,12);
}
function lineupScore({projection=0,recentActual=[],priorWeight=.15,closeBand=2,playoff=false,ceilingWeight=.08}){
  const prior=mean(recentActual.slice(-3));
  const priorDelta=clamp(prior-projection,-closeBand,closeBand)*priorWeight;
  const ceiling=playoff?stdev(recentActual.slice(-5))*ceilingWeight:0;
  return +(projection+priorDelta+ceiling).toFixed(3);
}
function waiverValue({currentProjection=0,projectionHistory=[],recentActual=[],adp=999,assetWeight=.5,isDrop=false}){
  const rolling=mean(projectionHistory.slice(-3));
  const recent=mean(recentActual.slice(-3));
  let score=currentProjection*.65+rolling*.25+recent*.10;
  if(isDrop)score+=assetProtection({adp,weight:assetWeight});
  return +score.toFixed(3);
}
function evaluateWaiver({add,drop,minEdge=2.5,assetWeight=.5}){
  const addValue=waiverValue({...add,assetWeight,isDrop:false});
  const dropValue=waiverValue({...drop,assetWeight,isDrop:true});
  const edge=addValue-dropValue;
  return {addValue,dropValue,edge:+edge.toFixed(3),recommend:edge>=minEdge?'ADD / DROP':'HOLD ASSET'};
}
window.FFOSeasonManagement={assetProtection,lineupScore,waiverValue,evaluateWaiver};
})();