#!/usr/bin/env python3
"""Collect normalized championship rows from public Sleeper leagues.

Usage:
  python scripts/collect_sleeper_champions.py config/sleeper_verified_leagues.json data/championship_warehouse.json
"""
import json, sys, time
from pathlib import Path
import requests

BASE='https://api.sleeper.app/v1'

def get(path):
    r=requests.get(BASE+path,timeout=20)
    r.raise_for_status()
    return r.json()

def final_winner(bracket):
    completed=[m for m in bracket if m.get('w') is not None]
    if not completed:return None
    last=max(completed,key=lambda m:(m.get('r',0),m.get('m',0)))
    return last.get('w')

def collect(league_id):
    league=get(f'/league/{league_id}')
    rosters=get(f'/league/{league_id}/rosters')
    bracket=get(f'/league/{league_id}/winners_bracket')
    drafts=get(f'/league/{league_id}/drafts')
    champion_id=final_winner(bracket)
    champ=next((r for r in rosters if r.get('roster_id')==champion_id),None)
    draft_picks=[]
    if drafts:
        draft_id=drafts[0].get('draft_id')
        if draft_id:
            draft_picks=get(f'/draft/{draft_id}/picks')
    champ_draft=[p for p in draft_picks if p.get('roster_id')==champion_id]
    return {
      'source':'sleeper_verified','league_id':str(league_id),'season':league.get('season'),
      'name':league.get('name'),'total_rosters':league.get('total_rosters'),
      'scoring_settings':league.get('scoring_settings',{}),'roster_positions':league.get('roster_positions',[]),
      'champion_roster_id':champion_id,'champion_players':(champ or {}).get('players',[]),
      'champion_starters':(champ or {}).get('starters',[]),'champion_draft':champ_draft,
      'previous_league_id':league.get('previous_league_id'),'status':league.get('status')
    }

def main():
    if len(sys.argv)<3: raise SystemExit('usage: collect_sleeper_champions.py INPUT OUTPUT')
    src=json.loads(Path(sys.argv[1]).read_text())
    rows=[]; errors=[]
    for lid in src.get('league_ids',[]):
        try: rows.append(collect(lid))
        except Exception as e: errors.append({'league_id':str(lid),'error':str(e)})
        time.sleep(.15)
    Path(sys.argv[2]).parent.mkdir(parents=True,exist_ok=True)
    Path(sys.argv[2]).write_text(json.dumps({'version':1,'rows':rows,'errors':errors},indent=2))
    print(f'collected {len(rows)} leagues; {len(errors)} errors')
if __name__=='__main__': main()
