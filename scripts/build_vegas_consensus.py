#!/usr/bin/env python3
"""Normalize season-long sportsbook player lines into fantasy-point consensus.

Input JSON is provider-neutral:
{"quotes":[{"player_key":"...","player_name":"...","position":"WR","book":"...","market":"receiving_yards","line":1100.5,"updated_at":"..."}, ...]}
"""
import json, sys, statistics
from collections import defaultdict
from pathlib import Path

def median(xs): return statistics.median(xs) if xs else None

def implied(lines,ppr):
    pts=0.0
    pts += (lines.get('passing_yards') or 0)/25
    pts += (lines.get('passing_touchdowns') or 0)*4
    pts -= (lines.get('interceptions') or 0)*2
    pts += (lines.get('rushing_yards') or 0)/10
    pts += (lines.get('rushing_touchdowns') or 0)*6
    pts += (lines.get('receiving_yards') or 0)/10
    pts += (lines.get('receiving_touchdowns') or 0)*6
    pts += (lines.get('receptions') or 0)*ppr
    return round(pts,2)

def main():
    if len(sys.argv)<3: raise SystemExit('usage: build_vegas_consensus.py INPUT OUTPUT')
    raw=json.loads(Path(sys.argv[1]).read_text())
    grouped=defaultdict(lambda: {'name':None,'position':None,'markets':defaultdict(list),'books':set()})
    for q in raw.get('quotes',[]):
        key=str(q.get('player_key') or q.get('player_name'))
        g=grouped[key]; g['name']=q.get('player_name'); g['position']=q.get('position'); g['books'].add(q.get('book'))
        if q.get('market') and q.get('line') is not None:g['markets'][q['market']].append(float(q['line']))
    out=[]
    for key,g in grouped.items():
        lines={m:median(v) for m,v in g['markets'].items()}
        out.append({'player_key':key,'player_name':g['name'],'position':g['position'],'books':len([b for b in g['books'] if b]),'lines':lines,
                    'implied_fantasy_points':{'ppr_0':implied(lines,0),'ppr_0_5':implied(lines,.5),'ppr_1':implied(lines,1)}})
    Path(sys.argv[2]).parent.mkdir(parents=True,exist_ok=True)
    Path(sys.argv[2]).write_text(json.dumps({'version':1,'markets':out},indent=2))
    print(f'built consensus for {len(out)} players')
if __name__=='__main__': main()
