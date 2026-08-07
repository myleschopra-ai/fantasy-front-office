#!/usr/bin/env python3
"""Replay the 2025 fantasy season using only information available at each decision point.

Tests the Front Office workflow from a 12-team half-PPR snake draft through Week 17.
Weekly decisions use that week's published projection plus prior-week actuals for waiver
trend only. Future actuals are never used. Vegas player props and referee signals remain
gated because timestamped 2025 snapshots are not yet retained in the repo.
"""
from __future__ import annotations
import csv, io, json, math, random, statistics, sys, urllib.request
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

SEASON=2025; TEAMS=12; ROUNDS=15; REG_WEEKS=14; POSITIONS=("QB","RB","WR","TE"); SEED=20250807
ADP_URL="https://fantasyfootballcalculator.com/api/v1/adp/half-ppr?teams=12&year=2025"
RAW="https://raw.githubusercontent.com/hvpkod/NFL-Data/refs/heads/main/NFL-data-Players/2025"

def get(url):
    req=urllib.request.Request(url,headers={"User-Agent":"FantasyFrontOfficeBacktest/1.0"})
    with urllib.request.urlopen(req,timeout=45) as r:return r.read()
def norm(name):return "".join(c.lower() for c in (name or "") if c.isalnum())
def f(v,default=0.0):
    try:return float(v)
    except (TypeError,ValueError):return default

@dataclass
class Player:
    name:str; pos:str; team:str; adp:float; pid:str=""
@dataclass
class Team:
    name:str; roster:list[str]=field(default_factory=list); wins:int=0; losses:int=0; weekly_points:list[float]=field(default_factory=list)

def load_adp():
    payload=json.loads(get(ADP_URL).decode()); rows=payload.get("players",payload); out=[]
    for r in rows:
        pos=str(r.get("position") or r.get("pos") or "").upper(); name=r.get("name") or r.get("player_name"); adp=f(r.get("adp"),999)
        if pos in POSITIONS and name and adp<999:out.append(Player(name,pos,r.get("team") or "",adp))
    out.sort(key=lambda x:x.adp)
    if len(out)<100:raise RuntimeError(f"ADP endpoint returned only {len(out)} usable players")
    return out

def load_week(week):
    projected,actual,by_position={}, {}, defaultdict(list)
    for pos in POSITIONS:
        ptxt=get(f"{RAW}/{week}/projected/{pos}_projected.csv").decode("utf-8-sig",errors="replace")
        atxt=get(f"{RAW}/{week}/{pos}.csv").decode("utf-8-sig",errors="replace")
        for r in csv.DictReader(io.StringIO(ptxt)):
            k=norm(r.get("PlayerName"))
            if k: projected[k]=f(r.get("PlayerWeekProjectedPts")); by_position[pos].append(k)
        for r in csv.DictReader(io.StringIO(atxt)):
            k=norm(r.get("PlayerName"))
            if k:actual[k]=f(r.get("TotalPoints"))
    return projected,actual,by_position

def load_all_weeks():
    weeks={}
    for w in range(1,18): print(f"loading week {w}",flush=True); weeks[w]=load_week(w)
    return weeks

def roster_counts(roster,pm):
    c=defaultdict(int)
    for k in roster:
        if k in pm:c[pm[k].pos]+=1
    return c

def legal_add(roster,p,pm):
    caps={"QB":2,"RB":6,"WR":7,"TE":3}; return roster_counts(roster,pm)[p.pos]<caps[p.pos]
def need_bonus(roster,p,pm):
    c=roster_counts(roster,pm); starters={"QB":1,"RB":2,"WR":2,"TE":1}; bench={"QB":1,"RB":4,"WR":5,"TE":2}
    if c[p.pos]<starters[p.pos]:return 18.0
    if c[p.pos]<bench[p.pos]:return 5.0
    return -4.0

def cpu_pick(available,roster,pm,rng):
    if not available:return None
    pool=[p for p in available[:18] if legal_add(roster,p,pm)] or available[:18]
    if not pool:return None
    weights=[]
    for p in pool:
        rank_pressure=max(.4,20-min(19,p.adp/8)); need=max(.2,1+need_bonus(roster,p,pm)/18); weights.append(rank_pressure*need)
    return rng.choices(pool,weights=weights,k=1)[0]
def framework_pick(available,roster,pm,overall):
    if not available:return None
    pool=[p for p in available[:32] if legal_add(roster,p,pm)] or available[:32]; best=None
    for p in pool:
        score=(110-p.adp*.72)+need_bonus(roster,p,pm)+{"RB":5,"WR":3,"TE":4,"QB":1}[p.pos]+max(-20,overall-p.adp)*.45
        if best is None or score>best[0]:best=(score,p)
    return best[1] if best else None
def baseline_pick(available,roster,pm):
    for p in available:
        if legal_add(roster,p,pm):return p
    return available[0] if available else None

def draft(adp,slot,seed,strategy="framework"):
    rng=random.Random(seed); pm={norm(p.name):p for p in adp}; teams=[Team(f"Team {i+1}") for i in range(TEAMS)]; available=list(adp); picks=[]
    exhausted=False
    for rd in range(1,ROUNDS+1):
        order=list(range(TEAMS)) if rd%2 else list(reversed(range(TEAMS)))
        for t in order:
            if not available:exhausted=True;break
            overall=len(picks)+1
            if t==slot-1:p=framework_pick(available,teams[t].roster,pm,overall) if strategy=="framework" else baseline_pick(available,teams[t].roster,pm)
            else:p=cpu_pick(available,teams[t].roster,pm,rng)
            if p is None:continue
            k=norm(p.name); teams[t].roster.append(k); picks.append({"pick":overall,"team":t+1,"player":p.name,"pos":p.pos,"adp":p.adp}); available.remove(p)
        if exhausted:break
    return teams,pm,picks,{norm(p.name) for p in available}

def choose_lineup(roster,pm,proj):
    players=[k for k in roster if k in pm]; used=set(); lineup=[]
    def take(pos,n):
        cand=sorted([k for k in players if pm[k].pos==pos and k not in used],key=lambda k:proj.get(k,0),reverse=True)
        for k in cand[:n]:used.add(k);lineup.append(k)
    take("QB",1);take("RB",2);take("WR",2);take("TE",1)
    flex=sorted([k for k in players if k not in used and pm[k].pos in ("RB","WR","TE")],key=lambda k:proj.get(k,0),reverse=True)
    for k in flex[:2]:used.add(k);lineup.append(k)
    return lineup
def lineup_points(lineup,actual):return round(sum(actual.get(k,0) for k in lineup),2)
def best_actual_lineup(roster,pm,actual):return lineup_points(choose_lineup(roster,pm,actual),actual)

def waiver_move(team,free_agents,pm,proj,past):
    def score(k):
        hist=past.get(k,[])[-2:]; trend=statistics.mean(hist) if hist else 0; return proj.get(k,0)*.75+trend*.25
    candidates=[k for k in free_agents if k in pm and proj.get(k,0)>0]
    if not candidates:return None
    add=max(candidates,key=score); starters=set(choose_lineup(team.roster,pm,proj)); drops=[k for k in team.roster if k not in starters]
    if not drops:return None
    drop=min(drops,key=score)
    if score(add)<score(drop)+2:return None
    team.roster.remove(drop);team.roster.append(add);free_agents.remove(add);free_agents.add(drop)
    return {"add":pm[add].name,"drop":pm[drop].name,"edge":round(score(add)-score(drop),2)}

def regular_schedule(seed):
    rng=random.Random(seed);ids=list(range(TEAMS));rng.shuffle(ids);rounds=[];arr=ids[:]
    for _ in range(11):rounds.append([(arr[i],arr[-1-i]) for i in range(TEAMS//2)]);arr=[arr[0]]+[arr[-1]]+arr[1:-1]
    return (rounds+rounds[:3])[:REG_WEEKS]

def play_season(adp,weeks,slot,seed,strategy):
    teams,pm,picks,free_agents=draft(adp,slot,seed,strategy); me=teams[slot-1]; schedule=regular_schedule(seed+77);past=defaultdict(list);weekly=[];waivers=[];errors=[];capture=[]
    for w in range(1,18):
        proj,actual,_=weeks[w]
        if strategy=="framework" and w>=2:
            mv=waiver_move(me,free_agents,pm,proj,past)
            if mv:mv["week"]=w;waivers.append(mv)
        lineups=[];scores=[]
        for team in teams:
            lu=choose_lineup(team.roster,pm,proj);sc=lineup_points(lu,actual);lineups.append(lu);scores.append(sc);team.weekly_points.append(sc)
        my_lineup=lineups[slot-1];my_score=scores[slot-1];best=best_actual_lineup(me.roster,pm,actual);cap=my_score/best if best>0 else 1;capture.append(cap)
        errors.extend(actual.get(k,0)-proj.get(k,0) for k in my_lineup)
        if w<=REG_WEEKS:
            for a,b in schedule[w-1]:
                if scores[a]>=scores[b]:teams[a].wins+=1;teams[b].losses+=1
                else:teams[b].wins+=1;teams[a].losses+=1
        weekly.append({"week":w,"points":my_score,"best_roster_points":best,"capture":round(cap,3),"projected":round(sum(proj.get(k,0) for k in my_lineup),2),"actual_minus_projection":round(my_score-sum(proj.get(k,0) for k in my_lineup),2)})
        for k,v in actual.items():past[k].append(v)
    reg=[(i,sum(t.weekly_points[:REG_WEEKS]),t.wins) for i,t in enumerate(teams)];reg.sort(key=lambda x:(x[2],x[1]),reverse=True);seed_rank=next(i+1 for i,x in enumerate(reg) if x[0]==slot-1);made=seed_rank<=6
    champion=False;finish=None
    if made:
        seeds=[x[0] for x in reg[:6]];w15={i:teams[i].weekly_points[14] for i in seeds};q1=seeds[2] if w15[seeds[2]]>=w15[seeds[5]] else seeds[5];q2=seeds[3] if w15[seeds[3]]>=w15[seeds[4]] else seeds[4]
        remaining=sorted([q1,q2],key=lambda i:seeds.index(i),reverse=True);low,high=remaining[0],remaining[1];w16={i:teams[i].weekly_points[15] for i in (seeds[0],seeds[1],low,high)};s1=seeds[0] if w16[seeds[0]]>=w16[low] else low;s2=seeds[1] if w16[seeds[1]]>=w16[high] else high;w17={i:teams[i].weekly_points[16] for i in (s1,s2)};champ=s1 if w17[s1]>=w17[s2] else s2;champion=champ==slot-1
        finish=1 if champion else 2 if slot-1 in (s1,s2) else 4 if slot-1 in (seeds[0],seeds[1],low,high) else 6
    mae=statistics.mean(abs(e) for e in errors) if errors else 0;rmse=math.sqrt(statistics.mean(e*e for e in errors)) if errors else 0;regpts=sum(me.weekly_points[:REG_WEEKS])
    return {"slot":slot,"strategy":strategy,"record":f"{me.wins}-{me.losses}","wins":me.wins,"regular_points":round(regpts,2),"regular_points_rank":1+sum(1 for t in teams if sum(t.weekly_points[:REG_WEEKS])>regpts),"playoff_seed":seed_rank,"made_playoffs":made,"champion":champion,"playoff_finish":finish,"avg_lineup_capture":round(statistics.mean(capture),3),"starter_projection_mae":round(mae,3),"starter_projection_rmse":round(rmse,3),"waivers":waivers,"weekly":weekly,"draft":picks}

def summarize(rows):
    n=len(rows);return {"n":n,"avg_regular_points":round(statistics.mean(r["regular_points"] for r in rows),2),"avg_wins":round(statistics.mean(r["wins"] for r in rows),2),"playoff_rate":round(sum(r["made_playoffs"] for r in rows)/n,3),"title_rate":round(sum(r["champion"] for r in rows)/n,3),"avg_lineup_capture":round(statistics.mean(r["avg_lineup_capture"] for r in rows),3),"starter_projection_mae":round(statistics.mean(r["starter_projection_mae"] for r in rows),3)}

def main():
    outdir=Path(sys.argv[1] if len(sys.argv)>1 else "data/backtests/2025");outdir.mkdir(parents=True,exist_ok=True);adp=load_adp();weeks=load_all_weeks();primary_slot=random.Random(SEED).randint(1,TEAMS);primary=play_season(adp,weeks,primary_slot,SEED,"framework");primary_base=play_season(adp,weeks,primary_slot,SEED,"baseline");framework=[];baseline=[]
    for i in range(120):
        slot=i%TEAMS+1;seed=SEED+i*101;framework.append(play_season(adp,weeks,slot,seed,"framework"));baseline.append(play_season(adp,weeks,slot,seed,"baseline"))
    fs,bs=summarize(framework),summarize(baseline);delta={"regular_points":round(fs["avg_regular_points"]-bs["avg_regular_points"],2),"wins":round(fs["avg_wins"]-bs["avg_wins"],2),"playoff_rate":round(fs["playoff_rate"]-bs["playoff_rate"],3),"title_rate":round(fs["title_rate"]-bs["title_rate"],3),"lineup_capture":round(fs["avg_lineup_capture"]-bs["avg_lineup_capture"],3)}
    report={"version":2,"season":SEASON,"league":{"teams":TEAMS,"scoring":"half-PPR","rounds":ROUNDS,"regular_season_weeks":REG_WEEKS,"playoffs":"6 teams, Weeks 15-17"},"leakage_policy":"No future actuals. Current-week published projections allowed. Waivers use current-week projection plus prior actuals only.","gated_signals":[{"signal":"Vegas season/player props","status":"not backtested","reason":"No timestamped 2025 historical player-prop snapshots retained; reconstructed closing lines risk hindsight leakage."},{"signal":"referee/crew adjustment","status":"not given production weight","reason":"Needs dated weekly assignments plus pre-2025 fitted residual model and controlled held-out validation."}],"primary_seed":SEED,"primary_random_slot":primary_slot,"primary_framework":primary,"primary_baseline":primary_base,"cohort":{"framework":fs,"baseline":bs,"delta":delta},"interpretation_rules":["Do not call one lucky championship premium.","Prefer cohort playoff/title uplift and points over one seed.","Projection MAE and lineup capture expose bad recommendations even when record is lucky."]};(outdir/"report.json").write_text(json.dumps(report,indent=2))
    md=["# 2025 Front Office Manager Replay",f"\nPrimary seeded random draft slot: **{primary_slot} of {TEAMS}** (seed `{SEED}`).","\n## Primary season"]
    for label,r in [("Framework",primary),("Pure-ADP baseline",primary_base)]:md.append(f"- **{label}:** {r['record']}, {r['regular_points']:.1f} regular-season points, seed {r['playoff_seed']}, playoffs {'yes' if r['made_playoffs'] else 'no'}, title {'yes' if r['champion'] else 'no'}, lineup capture {r['avg_lineup_capture']:.1%}.")
    md += ["\n## 120-draft cohort",f"- Framework: {fs['avg_regular_points']:.1f} pts, {fs['avg_wins']:.2f} wins, {fs['playoff_rate']:.1%} playoffs, {fs['title_rate']:.1%} titles, {fs['avg_lineup_capture']:.1%} lineup capture.",f"- Baseline: {bs['avg_regular_points']:.1f} pts, {bs['avg_wins']:.2f} wins, {bs['playoff_rate']:.1%} playoffs, {bs['title_rate']:.1%} titles, {bs['avg_lineup_capture']:.1%} lineup capture.",f"- Uplift: {delta['regular_points']:+.1f} regular-season pts, {delta['playoff_rate']:+.1%} playoff rate, {delta['title_rate']:+.1%} title rate.","\n## Signal gates","Vegas player props and referee/crew effects are intentionally **not credited** until timestamped historical inputs support a no-lookahead reconstruction.","\n## Weekly primary replay","|Week|Projected|Actual|Best from roster|Capture|Actual - projection|","|---:|---:|---:|---:|---:|---:|"]
    for w in primary["weekly"]:md.append(f"|{w['week']}|{w['projected']:.1f}|{w['points']:.1f}|{w['best_roster_points']:.1f}|{w['capture']:.1%}|{w['actual_minus_projection']:+.1f}|")
    (outdir/"report.md").write_text("\n".join(md)+"\n");print(json.dumps({"primary_slot":primary_slot,"framework":fs,"baseline":bs,"delta":delta},indent=2))
if __name__=="__main__":main()
