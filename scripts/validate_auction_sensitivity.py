#!/usr/bin/env python3
from __future__ import annotations
import importlib.util, json, random, statistics, sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('base_validator',HERE/'validate_redraft_mock_formats.py')
v=importlib.util.module_from_spec(spec);sys.modules[spec.name]=v;spec.loader.exec_module(v)
PREMIUMS=(0.06,0.10,0.15,0.20);RUNS=24

def mean(xs):return statistics.mean(xs) if xs else 0.0
def baseline_bid(p,team,premium):
    left=max(1,v.ROUNDS-len(team.roster));spendable=max(v.MIN_BID,team.budget-(left-1)*v.MIN_BID)
    c=v.counts(team.roster);gap=max(0,v.targets()[p.pos]-c[p.pos]);mult=1+premium*(1 if gap else .35)
    return max(v.MIN_BID,min(spendable,round(max(v.MIN_BID,p.price*mult))))
def draft(players,target,seed,framework,premium):
    rng=random.Random(seed);teams=[v.Team() for _ in range(v.TEAMS)];order=[]
    for i in range(0,len(players),12):
        b=list(players[i:i+12]);rng.shuffle(b);order+=b
    sold=set()
    for p in order:
        bids=[]
        for i,t in enumerate(teams):
            if len(t.roster)>=v.ROUNDS or not v.legal(t.roster,p):continue
            if i==target:b=v.auction_max_bid(p,t,True) if framework else baseline_bid(p,t,premium)
            else:b=v.cpu_bid(p,t,rng)
            bids.append((b,rng.random(),i))
        if not bids:continue
        bids.sort(reverse=True);win=bids[0];second=bids[1][0] if len(bids)>1 else 0;price=min(win[0],max(v.MIN_BID,second+1));t=teams[win[2]]
        if price<=t.budget-max(0,v.ROUNDS-len(t.roster)-1)*v.MIN_BID:
            t.roster.append(p);t.budget-=price;sold.add(p.key)
    remain=[p for p in players if p.key not in sold]
    for t in teams:
        for p in list(remain):
            if len(t.roster)>=v.ROUNDS:break
            if v.legal(t.roster,p) and t.budget>=v.MIN_BID:t.roster.append(p);t.budget-=v.MIN_BID;remain.remove(p)
    return teams[target].roster
def stats(ds):
    m=mean(ds);sd=statistics.stdev(ds) if len(ds)>1 else 0;se=sd/(len(ds)**.5)
    return {'n':len(ds),'mean_delta':round(m,2),'win_rate':round(sum(x>0 for x in ds)/len(ds),3),'ci95':[round(m-1.96*se,2),round(m+1.96*se,2)]}
def main():
    out=Path(sys.argv[1] if len(sys.argv)>1 else 'data/backtests/auction-sensitivity');out.mkdir(parents=True,exist_ok=True)
    data={y:v.load_year(y) for y in v.YEARS};report={'method':'auction robustness versus progressively more aggressive need-aware generic-market bidders','premiums':{}}
    for prem in PREMIUMS:
        ds=[]
        for y,(_,auction,weeks) in data.items():
            for i in range(RUNS):
                slot=i%v.TEAMS;seed=v.SEED+y*1009+i*113+int(prem*1000)
                fr=draft(auction,slot,seed,True,prem);bl=draft(auction,slot,seed,False,prem)
                ds.append(v.season_points(fr,weeks)-v.season_points(bl,weeks))
        report['premiums'][f'{prem:.2f}']=stats(ds)
    report['interpretation']='Auction max-bid logic is robust only if its edge persists as a competent market baseline becomes willing to exceed published AAV for roster needs.'
    (out/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
if __name__=='__main__':main()
