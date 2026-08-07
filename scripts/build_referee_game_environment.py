#!/usr/bin/env python3
"""Build referee/crew scoring-environment features from normalized NFL game rows.

Required fields per game: game_id, season, referee (or crew_id), home_team, away_team,
closing_total, closing_spread, home_score, away_score. Optional controls may include
venue_type, weather_score, home_offense_rating, away_offense_rating, penalties,
first_downs_by_penalty and penalty_scoring_delta.

This builder is intentionally conservative: it reports descriptive residual tendencies and
confidence. Weight increases belong in time-aware backtests, not in this script.
"""
import csv,json,math,statistics,sys
from collections import defaultdict
from pathlib import Path

def clamp(x,a,b): return max(a,min(b,x))
def mean(xs): return statistics.mean(xs) if xs else 0.0

def load(path):
    p=Path(path)
    if p.suffix.lower()=='.json':
        raw=json.loads(p.read_text()); return raw.get('games',raw) if isinstance(raw,dict) else raw
    with p.open(newline='',encoding='utf-8') as f:return list(csv.DictReader(f))

def f(row,key,default=0):
    try:return float(row.get(key,default) or default)
    except:return float(default)

def main():
    if len(sys.argv)<3: raise SystemExit('usage: build_referee_game_environment.py INPUT OUTPUT')
    games=load(sys.argv[1]); groups=defaultdict(list)
    for g in games:
        key=str(g.get('crew_id') or g.get('referee') or '').strip()
        if not key or g.get('closing_total') in (None,''): continue
        actual=f(g,'home_score')+f(g,'away_score'); close=f(g,'closing_total')
        groups[key].append({**g,'actual_total':actual,'total_residual':actual-close})
    out=[]
    for key,rows in groups.items():
        residuals=[r['total_residual'] for r in rows]; seasons=len(set(str(r.get('season')) for r in rows))
        overs=sum(1 for x in residuals if x>0); pushes=sum(1 for x in residuals if x==0)
        penalty_delta=mean([f(r,'penalty_scoring_delta') for r in rows])
        n=len(rows); sample=clamp(n/48,0,1); stability=clamp(1-(statistics.pstdev(residuals)/18 if len(residuals)>1 else 1),0,1)
        confidence=clamp(sample*.45+clamp(seasons/3,0,1)*.20+stability*.20+.15,0,1)
        out.append({'crew_key':key,'games':n,'seasons':seasons,'mean_total_residual':round(mean(residuals),2),'median_total_residual':round(statistics.median(residuals),2),'over_rate_ex_pushes':round(overs/max(1,n-pushes),3),'penalty_scoring_delta':round(penalty_delta,2),'stability':round(stability,3),'confidence':round(confidence,3),'predictive_eligible':bool(n>=24 and seasons>=2)})
    out.sort(key=lambda x:(x['predictive_eligible'],x['confidence'],abs(x['mean_total_residual'])),reverse=True)
    Path(sys.argv[2]).parent.mkdir(parents=True,exist_ok=True); Path(sys.argv[2]).write_text(json.dumps({'version':1,'crews':out},indent=2))
    print(f'built {len(out)} referee/crew profiles')
if __name__=='__main__':main()
