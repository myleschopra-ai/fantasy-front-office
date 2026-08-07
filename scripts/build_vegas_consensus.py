#!/usr/bin/env python3
"""Build season-long sportsbook consensus, disagreement and line-movement signals.

Input JSON is provider-neutral:
{"quotes":[{"player_key":"...","player_name":"...","position":"WR","book":"DraftKings","market":"receiving_yards","line":1100.5,"updated_at":"..."}, ...]}

Optional third argument is a previous consensus snapshot. When supplied, market-level and
fantasy-point movement are calculated against that snapshot.
"""
import json, sys, statistics
from collections import defaultdict
from datetime import datetime, timezone
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

def parse_time(v):
    if not v: return None
    try: return datetime.fromisoformat(str(v).replace('Z','+00:00'))
    except Exception: return None

def freshness_hours(values):
    ts=[parse_time(v) for v in values]
    ts=[x for x in ts if x]
    if not ts:return None
    newest=max(ts)
    now=datetime.now(timezone.utc)
    if newest.tzinfo is None:newest=newest.replace(tzinfo=timezone.utc)
    return round(max(0,(now-newest).total_seconds()/3600),1)

def agreement(lines):
    """Return 0-1 agreement score from relative cross-book dispersion."""
    if len(lines)<2:return 0.45
    med=median(lines)
    if not med:return 0.45
    spread=max(lines)-min(lines)
    rel=abs(spread/med)
    return round(max(0,min(1,1-rel*8)),3)

def previous_index(raw):
    out={}
    for p in (raw or {}).get('markets',[]):out[str(p.get('player_key'))]=p
    return out

def main():
    if len(sys.argv)<3: raise SystemExit('usage: build_vegas_consensus.py INPUT OUTPUT [PREVIOUS_CONSENSUS]')
    raw=json.loads(Path(sys.argv[1]).read_text())
    prev=json.loads(Path(sys.argv[3]).read_text()) if len(sys.argv)>3 and Path(sys.argv[3]).exists() else None
    pidx=previous_index(prev)
    grouped=defaultdict(lambda: {'name':None,'position':None,'markets':defaultdict(list),'books':set(),'times':[]})
    for q in raw.get('quotes',[]):
        key=str(q.get('player_key') or q.get('player_name'))
        g=grouped[key]; g['name']=q.get('player_name') or g['name']; g['position']=q.get('position') or g['position']
        if q.get('book'):g['books'].add(q.get('book'))
        if q.get('updated_at'):g['times'].append(q.get('updated_at'))
        if q.get('market') and q.get('line') is not None:
            g['markets'][q['market']].append({'line':float(q['line']),'book':q.get('book'),'updated_at':q.get('updated_at')})
    out=[]
    for key,g in grouped.items():
        lines={}; market_detail={}; agreements=[]
        old=pidx.get(key,{})
        old_lines=old.get('lines') or {}
        for m,quotes in g['markets'].items():
            vals=[x['line'] for x in quotes]
            med=median(vals); lines[m]=med
            agr=agreement(vals); agreements.append(agr)
            market_detail[m]={
                'consensus':med,
                'books':len(set(x.get('book') for x in quotes if x.get('book'))),
                'min':min(vals),'max':max(vals),'spread':round(max(vals)-min(vals),2),
                'agreement':agr,
                'book_lines':{str(x.get('book') or 'unknown'):x['line'] for x in quotes}
            }
            if m in old_lines and old_lines[m] is not None:
                market_detail[m]['movement']=round(med-float(old_lines[m]),2)
        fantasy={'ppr_0':implied(lines,0),'ppr_0_5':implied(lines,.5),'ppr_1':implied(lines,1)}
        old_fp=old.get('implied_fantasy_points') or {}
        movement={k:round(v-float(old_fp[k]),2) for k,v in fantasy.items() if k in old_fp and old_fp[k] is not None}
        overall_agreement=round(sum(agreements)/len(agreements),3) if agreements else 0
        out.append({
            'player_key':key,'player_name':g['name'],'position':g['position'],
            'books':len(g['books']),'freshness_hours':freshness_hours(g['times']),
            'lines':lines,'market_detail':market_detail,'agreement':overall_agreement,
            'implied_fantasy_points':fantasy,'fantasy_point_movement':movement
        })
    payload={'version':2,'generated_at':datetime.now(timezone.utc).isoformat(),'markets':out}
    Path(sys.argv[2]).parent.mkdir(parents=True,exist_ok=True)
    Path(sys.argv[2]).write_text(json.dumps(payload,indent=2))
    print(f'built consensus for {len(out)} players; previous snapshot={bool(prev)}')
if __name__=='__main__': main()
