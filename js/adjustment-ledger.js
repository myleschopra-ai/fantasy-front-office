(()=>{'use strict';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const DEFAULT_CAPS={vegas:.06,referee_game_environment:.05,matchup:.08,role_change:.10,injury:.20,weather:.08,championship_archetype:.04};
function confidence({sampleSize=0,recency=0.5,sourceQuality=0.5,agreement=0.5,stability=0.5,strongSample=48}){
  const s=clamp(sampleSize/strongSample,0,1);
  return +clamp(s*.25+recency*.20+sourceQuality*.20+agreement*.20+stability*.15,0,1).toFixed(3);
}
function band(c){return c>=.85?'very high':c>=.70?'high':c>=.45?'medium':'low';}
function boundedAdjustment({baseProjection,type,rawPct=0,confidence:conf=0,caps=DEFAULT_CAPS}){
  const cap=Math.abs(Number(caps[type]??0));
  const pct=clamp(Number(rawPct||0)*clamp(conf,0,1),-cap,cap);
  return {type,rawPct:+Number(rawPct||0).toFixed(4),confidence:+clamp(conf,0,1).toFixed(3),confidenceBand:band(conf),capPct:cap,appliedPct:+pct.toFixed(4),points:+(Number(baseProjection||0)*pct).toFixed(2)};
}
function ledger({baseProjection=0,signals=[],caps=DEFAULT_CAPS}){
  const rows=signals.map(s=>boundedAdjustment({baseProjection,type:s.type,rawPct:s.rawPct,confidence:s.confidence,caps}));
  const totalPoints=rows.reduce((n,r)=>n+r.points,0);
  return {baseProjection:+Number(baseProjection||0).toFixed(2),adjustments:rows,netAdjustmentPoints:+totalPoints.toFixed(2),finalProjection:+(Number(baseProjection||0)+totalPoints).toFixed(2)};
}
function refereeEnvironment({games=0,seasons=0,residualTotalDelta=0,overRate=0.5,penaltyScoringDelta=0,recency=.75,sourceQuality=.75,stability=.5,agreement=.5}){
  const conf=confidence({sampleSize:games,recency,sourceQuality,agreement,stability,strongSample:48});
  if(games<24||seasons<2)return {rawPct:0,confidence:conf,confidenceBand:band(conf),reason:'insufficient referee sample'};
  const residualComponent=clamp(residualTotalDelta/8,-1,1)*.03;
  const overComponent=clamp((overRate-.5)/.12,-1,1)*.01;
  const penaltyComponent=clamp(penaltyScoringDelta/3,-1,1)*.01;
  const rawPct=clamp(residualComponent+overComponent+penaltyComponent,-.05,.05);
  return {rawPct:+rawPct.toFixed(4),confidence:conf,confidenceBand:band(conf),reason:'crew-adjusted scoring environment'};
}
function distributeGameEnvironment({playerProjection,position,teamScoringShare=0.5,environmentPct=0,confidence:conf=0}){
  const positionSensitivity={QB:1.0,RB:.8,WR:1.0,TE:.9,K:1.1,DST:-.7}[position]??.85;
  const rawPct=environmentPct*positionSensitivity*clamp(teamScoringShare/.5,.6,1.4);
  return boundedAdjustment({baseProjection:playerProjection,type:'referee_game_environment',rawPct,confidence:conf});
}
window.FFOAdjustmentLedger={confidence,band,boundedAdjustment,ledger,refereeEnvironment,distributeGameEnvironment};
})();
