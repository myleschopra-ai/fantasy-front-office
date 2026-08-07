#!/usr/bin/env python3
from __future__ import annotations
import importlib.util, json, random, statistics, sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('base_validator',HERE/'validate_redraft_mock_formats.py')
v=importlib.util.module_from_spec(spec); spec.loader.exec_module(v)

def mean(xs): return statistics.mean(xs) if xs else 0.0

def market_score(p,roster,pick):
    cost=p.adp or p.rank
    need=v.pos_need(p,roster)*.34
    slide=max(-15,min(20,pick-cost))*.35
    return 125-cost*.88+need+slide

def snake_draft(players,slot,seed,framework):
    rng=random.Random(seed); teams=[[] for _ in range(v.TEAMS)]; avail=list(players)
    for pick in range(1,v.TEAMS*v.ROUNDS+1):
        rd=(pick-1)//v.TEAMS+1; x=(pick-1)%v.TEAMS; tm=x if rd%2 else v.TEAMS-1-x; roster=teams[tm]
        pool=[p for p in avail[:80] if v.legal(roster,p)] or avail[:80]
        if not pool: break
        if tm==slot-1:
            chosen=max(pool,key=lambda p:v.user_score(p,roster,avail,pick)) if framework else max(pool,key=lambda p:market_score(p,roster,pick))
        else:
            chosen=max(pool,key=lambda p:v.cpu_score(p,roster,pick,rng))
        roster.append(chosen);avail.remove(chosen)
    return teams[slot-1]

def baseline_bid(p,team):
    slots_left=max(1,v.ROUNDS-len(team.roster)); spendable=max(v.MIN_BID,team.budget-(slots_left-1)*v.MIN_BID)
    c=v.counts(team.roster); gap=max(0,v.targets()[p.pos]-c[p.pos])
    # Competent market manager: knows roster need and is willing to pay a modest premium for an unfilled starter.
    max_price=round(max(v.MIN_BID,p.price*(1+gap*.06)))
    return max(v.MIN_BID,min(spendable,max_price))

def auction_draft(players,target_idx,seed,framework):
    rng=random.Random(seed);teams=[v.Team() for _ in range(v.TEAMS)];avail=list(players);order=[]
    for i in range(0,len(avail),12):
        block=avail[i:i+12];rng.shuffle(block);order.extend(block)
    sold=set()
    for p in order:
        bids=[]
        for i,t in enumerate(teams):
            if len(t.roster)>=v.ROUNDS or not v.legal(t.roster,p):continue
            if i==target_idx:b=v.auction_max_bid(p,t,True) if framework else baseline_bid(p,t)
            else:b=v.cpu_bid(p,t,rng)
            bids.append((b,rng.random(),i))
        if not bids:continue
        bids.sort(reverse=True);win=bids[0];second=bids[1][0] if len(bids)>1 else 0;price=min(win[0],max(v.MIN_BID,second+1));t=teams[win[2]]
        if price<=t.budget-max(0,v.ROUNDS-len(t.roster)-1)*v.MIN_BID:
            t.roster.append(p);t.budget-=price;sold.add(p.key)
        if all(len(t.roster)>=v.ROUNDS for t in teams):break
    remain=[p for p in avail if p.key not in sold]
    for t in teams:
        for p in list(remain):
            if len(t.roster)>=v.ROUNDS:break
            if v.legal(t.roster,p) and t.budget>=v.MIN_BID:
                t.roster.append(p);t.budget-=v.MIN_BID;remain.remove(p)
    return teams[target_idx].roster

def paired(diffs):
    m=mean(diffs);sd=statistics.stdev(diffs) if len(diffs)>1 else 0;se=sd/(len(diffs)**.5)
    return {'n':len(diffs),'mean_delta':round(m,2),'win_rate':round(sum(d>0 for d in diffs)/len(diffs),3),'ci95':[round(m-1.96*se,2),round(m+1.96*se,2)]}

def main():
    out=Path(sys.argv[1] if len(sys.argv)>1 else 'data/backtests/redraft-mock-validation-strong');out.mkdir(parents=True,exist_ok=True)
    data={y:v.load_year(y) for y in v.YEARS};report={'method':'paired 2024-2025 redraft replay against competent need-aware market baselines','years':{}}
    all_s=[];all_a=[]
    for y,(adp,auction,weeks) in data.items():
        sd=[];ad=[];ss=[];aa=[]
        for i in range(v.RUNS):
            slot=i%v.TEAMS+1;seed=v.SEED+y*1009+i*101
            fr=snake_draft(adp,slot,seed,True);bl=snake_draft(adp,slot,seed,False)
            fp=v.season_points(fr,weeks);bp=v.season_points(bl,weeks);sd.append(fp-bp);ss.append((fp,bp))
            ar=auction_draft(auction,slot-1,seed+17,True);ab=auction_draft(auction,slot-1,seed+17,False)
            ap=v.season_points(ar,weeks);bb=v.season_points(ab,weeks);ad.append(ap-bb);aa.append((ap,bb))
        report['years'][str(y)]={
          'snake':{**paired(sd),'framework_points':round(mean([x for x,_ in ss]),2),'strong_baseline_points':round(mean([x for _,x in ss]),2)},
          'auction':{**paired(ad),'framework_points':round(mean([x for x,_ in aa]),2),'strong_baseline_points':round(mean([x for _,x in aa]),2)}}
        all_s+=sd;all_a+=ad
    report['combined']={'snake':paired(all_s),'auction':paired(all_a)}
    report['rules']={
      'snake_baseline':'Need-aware ADP/market manager using the same roster constraints and no random handicap.',
      'auction_baseline':'Need-aware generic-AAV manager with the same budget reserve logic; only the framework receives intrinsic/ceiling/scarcity max-bid adjustments.',
      'lineups':'Pregame weekly projections choose starters; realized points score Weeks 1-14; no waivers.',
      'validation_threshold':'Positive mean with 95% interval fully above zero.',
      'auction_limitation':'League-specific historical-price calibration is not tested until actual league auction records are available.'}
    (out/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
if __name__=='__main__':main()
