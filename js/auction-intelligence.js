(()=>{'use strict';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const mean=a=>a&&a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const median=a=>{if(!a||!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2};
function tier(rank){return rank<=12?1:rank<=36?2:rank<=72?3:rank<=120?4:5}
function normalizeHistory(history,budget=200){const out=[];(history?.seasons||[]).forEach(s=>(s.purchases||[]).forEach(p=>{const b=Number(s.budget||history.budget||budget)||budget,price=Number(p.price)||0,aav=Number(p.generic_aav)||0;out.push({...p,season:s.season,budget:b,price_pct:b?price/b:0,aav_pct:b&&aav?aav/b:0,tier:tier(Number(p.rank)||999)})}));return out}
function leagueModel(history,{budget=200}={}){const rows=normalizeHistory(history,budget),byPos={},byTier={},byManager={};
 for(const r of rows){if(r.generic_aav>0){const ratio=r.price/r.generic_aav;(byPos[r.position]??=[]).push(ratio);(byTier[`${r.position}:${r.tier}`]??=[]).push(ratio);if(r.manager)(byManager[r.manager]??=[]).push(ratio)}}
 const avg=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,{n:v.length,ratio:mean(v),median_ratio:median(v)}]));
 return {rows:rows.length,position:avg(byPos),tier:avg(byTier),manager:avg(byManager)};
}
function shrink(observed,n,prior=1,k=6){return (observed*n+prior*k)/(n+k)}
function expectedLeaguePrice({genericAav,position,rank,model,budget=200,currentInflation=1}){
 let ratio=1,weight=0;const p=model?.position?.[position],t=model?.tier?.[`${position}:${tier(rank)}`];
 if(p){ratio+=((p.median_ratio||p.ratio)-1)*clamp(p.n/12,0,.45);weight+=p.n}
 if(t){ratio+=((t.median_ratio||t.ratio)-1)*clamp(t.n/10,0,.55);weight+=t.n}
 ratio=shrink(ratio,weight,1,8);return Math.max(1,+((genericAav||1)*ratio*currentInflation).toFixed(1));
}
function roomInflation({remainingDollars,remainingBaselineValue}){if(!remainingDollars||!remainingBaselineValue)return 1;return clamp(remainingDollars/remainingBaselineValue,.72,1.38)}
function maxBid({intrinsicValue,expectedPrice,remainingBudget,slotsLeft,minBid=1,need=0,scarcity=0,ceiling=0}){
 const reserve=Math.max(0,(slotsLeft-1)*minBid),spendable=Math.max(minBid,remainingBudget-reserve);let v=intrinsicValue+need*.07+scarcity*.04+ceiling*.025;v=Math.min(v,spendable);if(expectedPrice>intrinsicValue*1.15)v-=Math.min(4,(expectedPrice-intrinsicValue)*.25);return Math.max(minBid,+v.toFixed(0));
}
function acquisitionSurplus({intrinsicValue,expectedPrice}){return +(intrinsicValue-expectedPrice).toFixed(1)}
function recommendation({surplus,maxBid,expectedPrice}){if(surplus>=8)return'PRIORITY BUY';if(surplus>=3)return'TARGET';if(maxBid>=expectedPrice)return'BUY TO MAX';if(surplus<=-7)return'AVOID OVERPAY';return'PRICE SENSITIVE'}
function nomination({surplus,expectedPrice,maxBid,roomInflation=1}){if(surplus>=5&&expectedPrice<=maxBid&&roomInflation<=1.06)return'NOMINATE TO BUY';if(surplus<=-4&&roomInflation>=.98)return'NOMINATE TO DRAIN';return'HOLD NOMINATION'}
window.FFOAuction={tier,normalizeHistory,leagueModel,expectedLeaguePrice,roomInflation,maxBid,acquisitionSurplus,recommendation,nomination};
})();
