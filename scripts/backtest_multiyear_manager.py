#!/usr/bin/env python3
from __future__ import annotations
import csv,io,json,math,random,statistics,sys,urllib.request
from collections import defaultdict
from dataclasses import dataclass,field
from pathlib import Path
YEARS=[2021,2022,2023,2024,2025];DEV=YEARS[:-1];HOLDOUT=2025;TEAMS=12;ROUNDS=14;REG=14;POS=("QB","RB","WR","TE");SEED=20250807
REPLAYS_DEV=24;REPLAYS_HOLDOUT=120
RAW="https://raw.githubusercontent.com/hvpkod/NFL-Data/refs/heads/main/NFL-data-Players/{year}"
ADP="https://fantasyfootballcalculator.com/api/v1/adp/half-ppr?teams=12&year={year}"
def get(u):
 r=urllib.request.Request(u,headers={"User-Agent":"FFO-WalkForward/1.0"});return urllib.request.urlopen(r,timeout=45).read()
def norm(s):return ''.join(c.lower() for c in (s or '') if c.isalnum())
def num(v,d=0.):
 try:return float(v)
 except:return d
@dataclass
class P:name:str;pos:str;team:str;adp:float=999.
@dataclass
class T:roster:list[str]=field(default_factory=list);wins:int=0;weekly:list[float]=field(default_factory=list)
def load_adp(y):
 raw=json.loads(get(ADP.format(year=y)).decode());rows=raw.get('players',raw);out=[]
 for r in rows:
  p=str(r.get('position') or r.get('pos') or '').upper();n=r.get('name') or r.get('player_name');a=num(r.get('adp'),999)
  if p in POS and n and a<999:out.append(P(n,p,r.get('team') or '',a))
 return sorted(out,key=lambda x:x.adp)
def load_week(y,w):
 pr,ac,meta={}, {},{}
 for pos in POS:
  base=RAW.format(year=y)
  try:pt=get(f"{base}/{w}/projected/{pos}_projected.csv").decode('utf-8-sig',errors='replace');at=get(f"{base}/{w}/{pos}.csv").decode('utf-8-sig',errors='replace')
  except Exception:continue
  for r in csv.DictReader(io.StringIO(pt)):
   k=norm(r.get('PlayerName'));n=r.get('PlayerName')
   if k and n:pr[k]=num(r.get('PlayerWeekProjectedPts'));meta[k]=P(n,pos,r.get('Team') or '',999)
  for r in csv.DictReader(io.StringIO(at)):
   k=norm(r.get('PlayerName'))
   if k:ac[k]=num(r.get('TotalPoints'))
 return pr,ac,meta
def load_year(y):
 print('loading',y,flush=True);return load_adp(y),{w:load_week(y,w) for w in range(1,18)}
def counts(r,pm):
 d=defaultdict(int)
 for k in r:
  if k in pm:d[pm[k].pos]+=1
 return d
def legal(r,p,pm):return counts(r,pm)[p.pos]<{'QB':2,'RB':6,'WR':7,'TE':3}[p.pos]
def need(r,p,pm):
 c=counts(r,pm);s={'QB':1,'RB':2,'WR':2,'TE':1};d={'QB':1,'RB':4,'WR':5,'TE':2}
 return 12 if c[p.pos]<s[p.pos] else 3 if c[p.pos]<d[p.pos] else -3
def cpu(av,r,pm,rng):
 pool=[p for p in av[:7] if legal(r,p,pm)] or av[:7]
 return max(pool,key=lambda p:-p.adp+need(r,p,pm)*.45+rng.gauss(0,1.8)) if pool else None
def ffo(av,r,pm,o):
 pool=[p for p in av[:24] if legal(r,p,pm)] or av[:24]
 return max(pool,key=lambda p:(120-p.adp*.8)+need(r,p,pm)+{'RB':4,'WR':2.5,'TE':3,'QB':1}[p.pos]+max(-15,o-p.adp)*.35) if pool else None
def adp_pick(av,r,pm):return next((p for p in av if legal(r,p,pm)),av[0] if av else None)
def draft(adp,slot,seed,mode):
 rng=random.Random(seed);pm={norm(p.name):p for p in adp};ts=[T() for _ in range(TEAMS)];av=list(adp)
 for rd in range(1,ROUNDS+1):
  order=range(TEAMS) if rd%2 else range(TEAMS-1,-1,-1)
  for i in order:
   if not av:break
   p=(ffo(av,ts[i].roster,pm,sum(len(t.roster) for t in ts)+1) if mode!='adp' else adp_pick(av,ts[i].roster,pm)) if i==slot-1 else cpu(av,ts[i].roster,pm,rng)
   if p:ts[i].roster.append(norm(p.name));av.remove(p)
 return ts,pm,{norm(p.name) for p in av}
def mean(x):return statistics.mean(x) if x else 0.
def sd(x):return statistics.stdev(x) if len(x)>1 else 0.
def decision_score(k,proj,past,cfg,playoff):
 p=proj.get(k,0);h=past.get(k,[])[-3:];delta=max(-cfg['band'],min(cfg['band'],mean(h)-p))*cfg['prior'];return p+delta+(sd(past.get(k,[])[-5:])*cfg.get('ceil',.08) if playoff else 0)
def lineup(r,pm,proj,past,cfg,w):
 used=set();out=[]
 def take(pos,n):
  c=sorted([k for k in r if k in pm and pm[k].pos==pos and k not in used],key=lambda k:decision_score(k,proj,past,cfg,w>=15),reverse=True)
  for k in c[:n]:used.add(k);out.append(k)
 take('QB',1);take('RB',2);take('WR',2);take('TE',1)
 flex=sorted([k for k in r if k in pm and pm[k].pos in ('RB','WR','TE') and k not in used],key=lambda k:decision_score(k,proj,past,cfg,w>=15),reverse=True);out+=flex[:2];return out
def asset(k,pm,cfg):
 a=pm[k].adp if k in pm else 999
 return max(0,(180-a)/180*8*cfg['asset']) if a<180 else 0
def waiver_value(k,proj,ph,past,pm,cfg,drop=False):return proj.get(k,0)*.65+mean(ph.get(k,[])[-3:])*.25+mean(past.get(k,[])[-3:])*.10+(asset(k,pm,cfg) if drop else 0)
def waiver(ts,free,pm,proj,ph,past,cfg,w):
 for i in sorted(range(TEAMS),key=lambda j:(ts[j].wins,sum(ts[j].weekly))):
  cand=[k for k in free if k in pm and proj.get(k,0)>0]
  if not cand:continue
  starters=set(lineup(ts[i].roster,pm,proj,past,cfg,w));drops=[k for k in ts[i].roster if k not in starters]
  if not drops:continue
  a=max(cand,key=lambda k:waiver_value(k,proj,ph,past,pm,cfg));d=min(drops,key=lambda k:waiver_value(k,proj,ph,past,pm,cfg,True))
  if waiver_value(a,proj,ph,past,pm,cfg)-waiver_value(d,proj,ph,past,pm,cfg,True)>=2.5:ts[i].roster.remove(d);ts[i].roster.append(a);free.remove(a);free.add(d)
def sched(seed):
 rng=random.Random(seed);a=list(range(TEAMS));rng.shuffle(a);rs=[]
 for _ in range(11):rs.append([(a[i],a[-1-i]) for i in range(6)]);a=[a[0]]+[a[-1]]+a[1:-1]
 return (rs+rs[:3])[:REG]
def replay(adp,weeks,slot,seed,mode,cfg):
 ts,pm,free=draft(adp,slot,seed,mode);past=defaultdict(list);ph=defaultdict(list);sc=sched(seed+77)
 for w in range(1,18):
  proj,act,meta=weeks[w];rostered={k for t in ts for k in t.roster}
  for k,p in meta.items():
   if k not in pm:pm[k]=p
   if k not in rostered:free.add(k)
  if w>=2:waiver(ts,free,pm,proj,ph,past,cfg,w)
  scores=[]
  for t in ts:
   lu=lineup(t.roster,pm,proj,past,cfg,w);s=sum(act.get(k,0) for k in lu);scores.append(s);t.weekly.append(s)
  if w<=REG:
   for a,b in sc[w-1]:ts[a if scores[a]>=scores[b] else b].wins+=1
  for k,v in act.items():past[k].append(v)
  for k,v in proj.items():ph[k].append(v)
 me=ts[slot-1];reg=[(i,t.wins,sum(t.weekly[:REG])) for i,t in enumerate(ts)];reg.sort(key=lambda x:(x[1],x[2]),reverse=True);seedrank=next(i+1 for i,x in enumerate(reg) if x[0]==slot-1);made=seedrank<=6;champ=False
 if made:
  seeds=[x[0] for x in reg[:6]];s=lambda i,w:ts[i].weekly[w-1];q1=seeds[2] if s(seeds[2],15)>=s(seeds[5],15) else seeds[5];q2=seeds[3] if s(seeds[3],15)>=s(seeds[4],15) else seeds[4];low,high=sorted([q1,q2],key=lambda i:seeds.index(i),reverse=True);sf1=seeds[0] if s(seeds[0],16)>=s(low,16) else low;sf2=seeds[1] if s(seeds[1],16)>=s(high,16) else high;champ=(sf1 if s(sf1,17)>=s(sf2,17) else sf2)==slot-1
 return {'points':sum(me.weekly[:REG]),'wins':me.wins,'playoffs':made,'title':champ}
def test_cfg(data,cfg,years,replays):
 out=[]
 for y in years:
  adp,weeks=data[y]
  for i in range(replays):
   slot=i%12+1;seed=SEED+y*13+i*101;out.append(replay(adp,weeks,slot,seed,'framework',cfg))
 return out
def summary(rows):return {'n':len(rows),'points':round(mean([r['points'] for r in rows]),2),'wins':round(mean([r['wins'] for r in rows]),2),'playoff_rate':round(mean([r['playoffs'] for r in rows]),3),'title_rate':round(mean([r['title'] for r in rows]),3)}
def main():
 out=Path(sys.argv[1] if len(sys.argv)>1 else 'data/backtests/walkforward');out.mkdir(parents=True,exist_ok=True);data={y:load_year(y) for y in YEARS}
 configs=[{'asset':a,'prior':p,'band':2.0,'ceil':.08} for a in (0,.5,1,1.5) for p in (0,.15)]
 dev=[]
 for c in configs:
  r=test_cfg(data,c,DEV,REPLAYS_DEV);dev.append((summary(r),c))
 dev.sort(key=lambda x:(x[0]['points'],x[0]['playoff_rate']),reverse=True);best=dev[0][1]
 hold=test_cfg(data,best,[HOLDOUT],REPLAYS_HOLDOUT);v1=test_cfg(data,{'asset':0,'prior':0,'band':2,'ceil':0},[HOLDOUT],REPLAYS_HOLDOUT)
 # ADP user gets same optimized weekly manager, isolating draft+management effect.
 adp_rows=[];adp,weeks=data[HOLDOUT]
 for i in range(REPLAYS_HOLDOUT):
  slot=i%12+1;seed=SEED+HOLDOUT*13+i*101;adp_rows.append(replay(adp,weeks,slot,seed,'adp',best))
 rep={'method':'2021-2024 development grid; frozen 2025 holdout','development_ranked':[{'metrics':m,'config':c} for m,c in dev],'selected_config':best,'holdout_2025':{'season_management_v2':summary(hold),'season_management_v1':summary(v1),'adp_baseline_with_v2_management':summary(adp_rows)}}
 rep['holdout_2025']['v2_minus_v1_points']=round(rep['holdout_2025']['season_management_v2']['points']-rep['holdout_2025']['season_management_v1']['points'],2)
 rep['holdout_2025']['v2_minus_adp_points']=round(rep['holdout_2025']['season_management_v2']['points']-rep['holdout_2025']['adp_baseline_with_v2_management']['points'],2)
 (out/'report.json').write_text(json.dumps(rep,indent=2));print(json.dumps(rep,indent=2))
if __name__=='__main__':main()
