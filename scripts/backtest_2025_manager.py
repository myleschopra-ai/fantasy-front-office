#!/usr/bin/env python3
"""No-lookahead 2025 fantasy-manager replay.

Replays a 12-team half-PPR snake draft, weekly waivers, start/sit decisions, and a
six-team Week 15-17 playoff. Every team gets the same projection-based weekly
management. The Front Office draft heuristic is tested against a pure-ADP user in
paired leagues with identical draft slot, opponent process, schedule and random seed.

Historical Vegas player props and referee/crew effects remain at zero production weight
until timestamped 2025 snapshots can be reconstructed without hindsight leakage.
"""
from __future__ import annotations
import csv, io, json, math, random, statistics, sys, urllib.request
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

SEASON=2025; TEAMS=12; ROUNDS=14; REG_WEEKS=14; REPLAYS=240
POSITIONS=("QB","RB","WR","TE"); SEED=20250807
ADP_URL="https://fantasyfootballcalculator.com/api/v1/adp/half-ppr?teams=12&year=2025"
RAW="https://raw.githubusercontent.com/hvpkod/NFL-Data/refs/heads/main/NFL-data-Players/2025"

def get(url):
    req=urllib.request.Request(url,headers={"User-Agent":"FantasyFrontOfficeBacktest/1.1"})
    with urllib.request.urlopen(req,timeout=45) as r:return r.read()
def norm(s):return "".join(c.lower() for c in (s or "") if c.isalnum())
def num(v,d=0.0):
    try:return float(v)
    except (TypeError,ValueError):return d
@dataclass
class Player:
    name:str; pos:str; team:str; adp:float=999.0
@dataclass
class Team:
    roster:list[str]=field(default_factory=list); wins:int=0; losses:int=0; weekly:list[float]=field(default_factory=list)

def load_adp():
    raw=json.loads(get(ADP_URL).decode()); rows=raw.get("players",raw); out=[]
    for r in rows:
        pos=str(r.get("position") or r.get("pos") or "").upper(); name=r.get("name") or r.get("player_name"); adp=num(r.get("adp"),999)
        if pos in POSITIONS and name and adp<999:out.append(Player(name,pos,r.get("team") or "",adp))
    out.sort(key=lambda p:p.adp)
    if len(out)<100:raise RuntimeError(f"only {len(out)} historical ADP players")
    return out

def load_week(w):
    proj,act,meta={}, {}, {}
    for pos in POSITIONS:
        pt=get(f"{RAW}/{w}/projected/{pos}_projected.csv").decode("utf-8-sig",errors="replace")
        at=get(f"{RAW}/{w}/{pos}.csv").decode("utf-8-sig",errors="replace")
        for r in csv.DictReader(io.StringIO(pt)):
            k=norm(r.get("PlayerName")); name=r.get("PlayerName")
            if k and name:
                proj[k]=num(r.get("PlayerWeekProjectedPts")); meta[k]=Player(name,pos,r.get("Team") or "",999)
        for r in csv.DictReader(io.StringIO(at)):
            k=norm(r.get("PlayerName"))
            if k:act[k]=num(r.get("TotalPoints"))
    return proj,act,meta

def load_weeks():
    out={}
    for w in range(1,18):print(f"loading week {w}",flush=True);out[w]=load_week(w)
    return out

def counts(roster,pm):
    c=defaultdict(int)
    for k in roster:
        if k in pm:c[pm[k].pos]+=1
    return c

def legal(roster,p,pm):
    return counts(roster,pm)[p.pos] < {"QB":2,"RB":6,"WR":7,"TE":3}[p.pos]
def need(roster,p,pm):
    c=counts(roster,pm); starters={"QB":1,"RB":2,"WR":2,"TE":1}; depth={"QB":1,"RB":4,"WR":5,"TE":2}
    if c[p.pos]<starters[p.pos]:return 12
    if c[p.pos]<depth[p.pos]:return 3
    return -3

def cpu_pick(avail,roster,pm,rng):
    pool=[p for p in avail[:7] if legal(roster,p,pm)] or avail[:7]
    if not pool:return None
    # Strong ADP anchor with modest need/randomness; opponents should be competent.
    return max(pool,key=lambda p: -p.adp + need(roster,p,pm)*.45 + rng.gauss(0,1.8))
def ffo_pick(avail,roster,pm,overall):
    pool=[p for p in avail[:24] if legal(roster,p,pm)] or avail[:24]
    if not pool:return None
    # Approximation of current market/fit/scarcity/value draft logic using only draft-time data.
    def score(p):
        return (120-p.adp*.80)+need(roster,p,pm)+{"RB":4.0,"WR":2.5,"TE":3.0,"QB":1.0}[p.pos]+max(-15,overall-p.adp)*.35
    return max(pool,key=score)
def adp_pick(avail,roster,pm):
    return next((p for p in avail if legal(roster,p,pm)),avail[0] if avail else None)

def draft(adp,slot,seed,user_mode):
    rng=random.Random(seed);pm={norm(p.name):p for p in adp};teams=[Team() for _ in range(TEAMS)];avail=list(adp);picks=[]
    for rd in range(1,ROUNDS+1):
        order=range(TEAMS) if rd%2 else range(TEAMS-1,-1,-1)
        for t in order:
            if not avail:break
            overall=len(picks)+1
            p=(ffo_pick(avail,teams[t].roster,pm,overall) if user_mode=="framework" else adp_pick(avail,teams[t].roster,pm)) if t==slot-1 else cpu_pick(avail,teams[t].roster,pm,rng)
            if not p:continue
            k=norm(p.name);teams[t].roster.append(k);picks.append({"pick":overall,"team":t+1,"player":p.name,"pos":p.pos,"adp":p.adp});avail.remove(p)
    return teams,pm,picks,{norm(p.name) for p in avail}

def lineup(roster,pm,proj):
    used=set();out=[]
    def take(pos,n):
        c=sorted([k for k in roster if k in pm and pm[k].pos==pos and k not in used],key=lambda k:proj.get(k,0),reverse=True)
        for k in c[:n]:used.add(k);out.append(k)
    take("QB",1);take("RB",2);take("WR",2);take("TE",1)
    flex=sorted([k for k in roster if k in pm and pm[k].pos in ("RB","WR","TE") and k not in used],key=lambda k:proj.get(k,0),reverse=True)
    out.extend(flex[:2]);return out
def pts(lu,actual):return round(sum(actual.get(k,0) for k in lu),2)
def best_pts(roster,pm,actual):return pts(lineup(roster,pm,actual),actual)

def waiver_score(k,proj,past):
    h=past.get(k,[])[-3:]; trend=statistics.mean(h) if h else 0
    return proj.get(k,0)*.80+trend*.20

def waiver_round(teams,free,pm,proj,past):
    # All managers get one competent add/drop attempt. Priority: worst record, then points.
    order=sorted(range(TEAMS),key=lambda i:(teams[i].wins,sum(teams[i].weekly)))
    moves=[]
    for i in order:
        team=teams[i]; candidates=[k for k in free if k in pm and proj.get(k,0)>0]
        if not candidates:continue
        starters=set(lineup(team.roster,pm,proj));drops=[k for k in team.roster if k not in starters]
        if not drops:continue
        add=max(candidates,key=lambda k:waiver_score(k,proj,past));drop=min(drops,key=lambda k:waiver_score(k,proj,past))
        edge=waiver_score(add,proj,past)-waiver_score(drop,proj,past)
        if edge<2.0:continue
        team.roster.remove(drop);team.roster.append(add);free.remove(add);free.add(drop);moves.append((i,add,drop,edge))
    return moves

def schedule(seed):
    rng=random.Random(seed);a=list(range(TEAMS));rng.shuffle(a);rounds=[]
    for _ in range(11):rounds.append([(a[i],a[-1-i]) for i in range(TEAMS//2)]);a=[a[0]]+[a[-1]]+a[1:-1]
    return (rounds+rounds[:3])[:REG_WEEKS]

def replay(adp,weeks,slot,seed,mode):
    teams,pm,picks,free=draft(adp,slot,seed,mode);me=teams[slot-1];sched=schedule(seed+77);past=defaultdict(list);weekly=[];waivers=[];pos_errors=defaultdict(list)
    for w in range(1,18):
        proj,actual,meta=weeks[w]
        rostered={k for t in teams for k in t.roster}
        for k,p in meta.items():
            if k not in pm:pm[k]=p
            if k not in rostered:free.add(k)
        if w>=2:
            for i,a,d,e in waiver_round(teams,free,pm,proj,past):
                if i==slot-1:waivers.append({"week":w,"add":pm[a].name,"drop":pm[d].name,"edge":round(e,2)})
        lineups=[];scores=[]
        for t in teams:
            lu=lineup(t.roster,pm,proj);sc=pts(lu,actual);lineups.append(lu);scores.append(sc);t.weekly.append(sc)
        if w<=REG_WEEKS:
            for a,b in sched[w-1]:
                win,lose=(a,b) if scores[a]>=scores[b] else (b,a);teams[win].wins+=1;teams[lose].losses+=1
        lu=lineups[slot-1];actual_score=scores[slot-1];best=best_pts(me.roster,pm,actual);projected=sum(proj.get(k,0) for k in lu)
        for k in lu:
            if k in pm:pos_errors[pm[k].pos].append(actual.get(k,0)-proj.get(k,0))
        weekly.append({"week":w,"projected":round(projected,2),"points":actual_score,"best_roster_points":best,"capture":round(actual_score/best,3) if best>0 else 1.0,"actual_minus_projection":round(actual_score-projected,2),"regret":round(best-actual_score,2)})
        for k,v in actual.items():past[k].append(v)
    reg=[(i,t.wins,sum(t.weekly[:REG_WEEKS])) for i,t in enumerate(teams)];reg.sort(key=lambda x:(x[1],x[2]),reverse=True);seed_rank=next(i+1 for i,x in enumerate(reg) if x[0]==slot-1);made=seed_rank<=6;champ=False;finish=None
    if made:
        seeds=[x[0] for x in reg[:6]];s=lambda i,w:teams[i].weekly[w-1]
        q1=seeds[2] if s(seeds[2],15)>=s(seeds[5],15) else seeds[5];q2=seeds[3] if s(seeds[3],15)>=s(seeds[4],15) else seeds[4]
        low,high=sorted([q1,q2],key=lambda i:seeds.index(i),reverse=True);sf1=seeds[0] if s(seeds[0],16)>=s(low,16) else low;sf2=seeds[1] if s(seeds[1],16)>=s(high,16) else high;winner=sf1 if s(sf1,17)>=s(sf2,17) else sf2;champ=winner==slot-1;finish=1 if champ else 2 if slot-1 in (sf1,sf2) else 4 if slot-1 in (seeds[0],seeds[1],low,high) else 6
    regpts=sum(me.weekly[:REG_WEEKS]);errs=[e for es in pos_errors.values() for e in es]
    return {"slot":slot,"record":f"{me.wins}-{me.losses}","wins":me.wins,"regular_points":round(regpts,2),"playoff_seed":seed_rank,"made_playoffs":made,"champion":champ,"playoff_finish":finish,"avg_lineup_capture":round(statistics.mean(w["capture"] for w in weekly),3),"starter_projection_mae":round(statistics.mean(abs(e) for e in errs),3),"starter_projection_rmse":round(math.sqrt(statistics.mean(e*e for e in errs)),3),"position_mae":{p:round(statistics.mean(abs(e) for e in es),3) for p,es in pos_errors.items() if es},"waivers":waivers,"weekly":weekly,"draft":picks}

def avg(rows,key):return statistics.mean(r[key] for r in rows)
def cohort(rows):
    return {"n":len(rows),"avg_regular_points":round(avg(rows,"regular_points"),2),"avg_wins":round(avg(rows,"wins"),2),"playoff_rate":round(avg(rows,"made_playoffs"),3),"title_rate":round(avg(rows,"champion"),3),"avg_lineup_capture":round(avg(rows,"avg_lineup_capture"),3),"starter_projection_mae":round(avg(rows,"starter_projection_mae"),3)}
def ci95(values):
    if len(values)<2:return [0,0]
    m=statistics.mean(values);se=statistics.stdev(values)/math.sqrt(len(values));return [round(m-1.96*se,3),round(m+1.96*se,3)]

def main():
    outdir=Path(sys.argv[1] if len(sys.argv)>1 else "data/backtests/2025");outdir.mkdir(parents=True,exist_ok=True);adp=load_adp();weeks=load_weeks();primary_slot=random.Random(SEED).randint(1,TEAMS);primary=replay(adp,weeks,primary_slot,SEED,"framework");primary_b=replay(adp,weeks,primary_slot,SEED,"baseline");fr=[];ba=[];pairs=[]
    for i in range(REPLAYS):
        slot=i%TEAMS+1;seed=SEED+i*101;f=replay(adp,weeks,slot,seed,"framework");b=replay(adp,weeks,slot,seed,"baseline");fr.append(f);ba.append(b);pairs.append((f,b))
    fs,bs=cohort(fr),cohort(ba);pd=[f["regular_points"]-b["regular_points"] for f,b in pairs];wd=[f["wins"]-b["wins"] for f,b in pairs];playd=[int(f["made_playoffs"])-int(b["made_playoffs"]) for f,b in pairs];titled=[int(f["champion"])-int(b["champion"]) for f,b in pairs]
    weekly_edges=[f["weekly"][w]["points"]-b["weekly"][w]["points"] for f,b in pairs for w in range(17)]
    delta={"regular_points":round(statistics.mean(pd),2),"regular_points_ci95":ci95(pd),"wins":round(statistics.mean(wd),2),"playoff_rate":round(statistics.mean(playd),3),"title_rate":round(statistics.mean(titled),3),"paired_points_win_rate":round(sum(x>0 for x in pd)/len(pd),3),"weekly_scorecard_hit_rate":round(sum(x>0 for x in weekly_edges)/len(weekly_edges),3),"weekly_scorecard_avg_edge":round(statistics.mean(weekly_edges),2)}
    report={"version":3,"season":SEASON,"league":{"teams":TEAMS,"scoring":"half-PPR","rounds":ROUNDS,"regular_season_weeks":REG_WEEKS,"playoffs":"6 teams, Weeks 15-17"},"method":"paired no-lookahead replay; all teams receive same projection-based weekly management","primary_seed":SEED,"primary_random_slot":primary_slot,"primary_framework":primary,"primary_baseline":primary_b,"cohort":{"framework":fs,"baseline":bs,"paired_delta":delta},"gated_signals":[{"signal":"Vegas player props","status":"zero weight","reason":"No timestamped 2025 historical snapshots retained."},{"signal":"referee/crew","status":"zero weight","reason":"No pre-2025 fitted, controlled weekly assignment model yet."}],"interpretation":"Premium requires a plausible baseline environment plus stable paired uplift; one championship or one random slot is insufficient."}
    (outdir/"report.json").write_text(json.dumps(report,indent=2))
    md=["# 2025 Front Office Manager Replay — Fairness Pass",f"\nPrimary random slot: **{primary_slot}/12**.","\n## Primary run",f"- Framework: {primary['record']}, {primary['regular_points']:.1f} points, seed {primary['playoff_seed']}, playoffs {'yes' if primary['made_playoffs'] else 'no'}, title {'yes' if primary['champion'] else 'no'}.",f"- ADP baseline: {primary_b['record']}, {primary_b['regular_points']:.1f} points, seed {primary_b['playoff_seed']}, playoffs {'yes' if primary_b['made_playoffs'] else 'no'}, title {'yes' if primary_b['champion'] else 'no'}.",f"\n## {REPLAYS} paired leagues",f"- Framework: {fs['avg_regular_points']:.1f} pts, {fs['avg_wins']:.2f} wins, {fs['playoff_rate']:.1%} playoffs, {fs['title_rate']:.1%} titles.",f"- ADP baseline: {bs['avg_regular_points']:.1f} pts, {bs['avg_wins']:.2f} wins, {bs['playoff_rate']:.1%} playoffs, {bs['title_rate']:.1%} titles.",f"- Paired point edge: {delta['regular_points']:+.1f} (95% CI {delta['regular_points_ci95'][0]:+.1f} to {delta['regular_points_ci95'][1]:+.1f}); framework wins paired points {delta['paired_points_win_rate']:.1%} of leagues.",f"- Playoff uplift: {delta['playoff_rate']:+.1%}; title uplift: {delta['title_rate']:+.1%}.",f"- Weekly scorecard: framework outscored paired ADP roster {delta['weekly_scorecard_hit_rate']:.1%} of weeks, average edge {delta['weekly_scorecard_avg_edge']:+.2f} pts/week.","\n## Projection accuracy",f"- Framework starter MAE: {fs['starter_projection_mae']:.2f} fantasy points/player.","- Vegas/referee effects remain gated at zero weight because historical timestamped inputs are not yet sufficient for a clean no-lookahead test.","\n## Primary week-by-week","|Wk|Proj|Actual|Best roster|Capture|Regret|","|---:|---:|---:|---:|---:|---:|"]
    for w in primary['weekly']:md.append(f"|{w['week']}|{w['projected']:.1f}|{w['points']:.1f}|{w['best_roster_points']:.1f}|{w['capture']:.1%}|{w['regret']:.1f}|")
    (outdir/"report.md").write_text("\n".join(md)+"\n");print(json.dumps({"primary_slot":primary_slot,"framework":fs,"baseline":bs,"paired_delta":delta,"position_mae":primary['position_mae']},indent=2))
if __name__=="__main__":main()
