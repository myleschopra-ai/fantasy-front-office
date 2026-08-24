(function(root,factory){
'use strict';
const api=factory();
if(typeof module==='object'&&module.exports)module.exports=api;
if(root)root.FFODecisionConfidence=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const numeric=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,numeric(value,min)));
function validationComponent(validation,component='wwpa'){
 return validation?.components?.[component]||{status:'estimated',calibration_status:'pending',sample_size:0};
}
function confidence(input={}){
 const sourceLevel=String(input.sourceHealth?.level||'UNAVAILABLE').toUpperCase();
 const sourceBase={FRESH:92,DEGRADED:76,STALE:62,EXPIRED:42,UNAVAILABLE:32}[sourceLevel]||50;
 const evidence=clamp(input.evaluation?.confidence??input.evidenceConfidence??50);
 const explicitCoverage=input.projectionCoverage?.eligible_rate??input.projectionCoverage?.eligibleRate;
 const runtimeCoverage=numeric(input.projectionCoverage?.poolPlayers,0)>0?numeric(input.projectionCoverage?.eligiblePlayers,0)/numeric(input.projectionCoverage?.poolPlayers,1):input.projectionCoverage?.complete?1:0;
 const coverage=clamp(numeric(explicitCoverage,runtimeCoverage)*100);
 const direct=numeric(input.projectionCoverage?.directPlayers??input.projectionCoverage?.direct_players,0),modeled=numeric(input.projectionCoverage?.openModelPlayers??input.projectionCoverage?.open_model_players,0),labeledTotal=direct+modeled;
 const directShare=labeledTotal>0?direct/labeledTotal:null;
 const projectionEvidence=directShare==null?coverage:Math.min(coverage,60+directShare*40);
 const validation=validationComponent(input.validation,input.component);
 const calibrated=validation.status==='validated'&&validation.calibration_status==='calibrated';
 const validationScore=calibrated?92:validation.status==='historically_backtested'?76:55;
 const score=Math.round(sourceBase*.32+evidence*.28+projectionEvidence*.25+validationScore*.15);
 const label=score>=82?'HIGH':score>=66?'MEDIUM':score>=48?'LOW':'VERY LOW';
 const reasons=[];
 if(sourceLevel!=='FRESH')reasons.push(`source health ${sourceLevel.toLowerCase()}`);
 if(coverage<95)reasons.push(`${Math.round(coverage)}% projection coverage`);
 if(directShare!=null&&directShare<.5)reasons.push(`${Math.round((1-directShare)*100)}% open-model projection depth`);
 if(!calibrated)reasons.push('WWPA historical calibration pending');
 if(evidence<65)reasons.push('player evidence is thin');
 return{score,label,reasons,calibrated,validationStatus:validation.status||'estimated',sampleSize:numeric(validation.sample_size,0),projectionCoverage:coverage,directShare};
}
function winRateRange(winRate,confidenceResult,validation={}){
 const center=clamp(winRate,0,100),ece=clamp(numeric(validation.expected_calibration_error,0)*100,0,15);
 const width=1.25+(100-clamp(confidenceResult?.score,0,100))*.055+ece;
 return{center,low:Math.max(0,center-width),high:Math.min(100,center+width),width};
}
function snakeCard(input={}){
 const wwpa=input.evaluation?.wwpa||{},trust=confidence({...input,component:'wwpa'}),validation=validationComponent(input.validation,'wwpa'),range=winRateRange(wwpa.winRateAfter??input.winRateAfter??50,trust,validation),comparable=input.comparable||null,scenario=input.scenario||{};
 return{trust,range,headline:scenario.decision||`Draft ${input.player?.name||'best fit'} now`,whyNow:scenario.whyNow||'Best combination of weekly lineup value, roster fit and tier pressure.',waitCost:numeric(scenario.expectedWaitLoss,comparable?.valueDrop||0),comparable,proof:trust.calibrated?`Calibrated on ${trust.sampleSize} held-out decisions`:'Estimated probability · promotion gate pending'};
}
function auctionCard(input={}){
 const wwpa=input.evaluation?.draft?.wwpa||input.evaluation?.wwpa||{},trust=confidence({...input,evaluation:input.evaluation?.draft||input.evaluation,component:'auction'}),validation=validationComponent(input.validation,'auction'),range=winRateRange(wwpa.winRateAfter??50,trust,validation),current=numeric(input.evaluation?.current),max=Math.max(current,numeric(input.evaluation?.maxBid,current)),comparable=input.evaluation?.nextComparable||null;
 return{trust,range,bidThrough:max,walkAway:max+numeric(input.minBid,1),comparable,savings:comparable?Math.max(0,current-numeric(comparable.price)):0,proof:trust.calibrated?`Calibrated on ${trust.sampleSize} held-out sales`:'Roster-aware ceiling · league calibration limited'};
}
return{confidence,winRateRange,snakeCard,auctionCard,validationComponent};
});
