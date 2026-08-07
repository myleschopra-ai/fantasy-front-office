#!/usr/bin/env python3
from __future__ import annotations
import csv, html, io, json, random, re, statistics, sys, urllib.request
from collections import defaultdict
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path

YEARS=(2024,2025); TEAMS=12; ROUNDS=14; WEEKS=14; BUDGET=200; MIN_BID=1; RUNS=48
POS=('QB','RB','WR','TE'); SEED=20260807
ADP='https://fantasyfootballcalculator.com/api/v1/adp/half-ppr?teams=12&year={year}'
RAW='https://raw.githubusercontent.com/hvpkod/NFL-Data/refs/heads/main/NFL-data-Players/{year}'
AUCT='https://www.fftoday.com/rankings/{yy}_av_half_ppr.html'

def get(url):
    req=urllib.request.Request(url,headers={'User-Agent':'FantasyFrontOffice-Validator/1.0'})
    return urllib.request.urlopen(req,timeout=45).read()
def norm(s): return ''.join(c.lower() for c in (s or '') if c.isalnum())
def num(v,d=0.0):
    try:return float(v)
    except:return d

def mean(xs): return statistics.mean(xs) if xs else 0.0
@dataclass
class Player:
    name:str; pos:str; rank:int; adp:float=999.0; price:float=0.0; key:str=''
    def __post_init__(self):
        if not self.key:self.key=norm(self.name)
@dataclass
class Team:
    roster:list[Player]=field(default_factory=list); budget:int=BUDGET

class TableParser(HTMLParser):
    def __init__(self): super().__init__(); self.rows=[]; self.row=None; self.cell=None
    def handle_starttag(self,tag,attrs):
        if tag=='tr': self.row=[]
        elif tag in ('td','th') and self.row is not None: self.cell=[]
    def handle_data(self,data):
        if self.cell is not None:self.cell.append(data)
    def handle_endtag(self,tag):
        if tag in ('td','th') and self.cell is not None and self.row is not None:
            self.row.append(' '.join(''.join(self.cell).split())); self.cell=None
        elif tag=='tr' and self.row is not None:
            if self.row:self.rows.append(self.row)
            self.row=None

def load_adp(year):
    raw=json.loads(get(ADP.format(year=year)).decode()); rows=raw.get('players',raw); out=[]
    for r in rows:
        p=str(r.get('position') or r.get('pos') or '').upper(); n=r.get('name') or r.get('player_name'); a=num(r.get('adp'),999)
        if p in POS and n and a<999: out.append(Player(n,p,len(out)+1,a))
    out.sort(key=lambda x:x.adp)
    for i,p in enumerate(out,1):p.rank=i
    return out

def load_auction(year):
    parser=TableParser(); parser.feed(get(AUCT.format(yy=str(year)[-2:])).decode('utf-8',errors='replace'))
    out=[]
    for row in parser.rows:
        # Expected FFToday columns: overall, pos, pos rank, player, team, max bid
        if len(row)<6 or not row[0].strip().isdigit(): continue
        pos=row[1].strip().upper(); name=row[3].replace('�','').strip(); price=num(re.sub(r'[^0-9.]','',row[-1]),-1)
        if pos in POS and name and price>=0: out.append(Player(name,pos,int(row[0]),rank_to_adp=int(row[0]) if False else 999,price=price))
    # dataclass compatibility: replace accidental placeholder via clean construction
    clean=[Player(p.name,p.pos,i+1,float(i+1),p.price) for i,p in enumerate(out)]
    if len(clean)<80: raise RuntimeError(f'Only parsed {len(clean)} auction players for {year}')
    return clean

def load_week(year,w):
    proj,act,meta={}, {},{}
    for pos in POS:
        base=RAW.format(year=year)
        try:
            pt=get(f'{base}/{w}/projected/{pos}_projected.csv').decode('utf-8-sig',errors='replace')
            at=get(f'{base}/{w}/{pos}.csv').decode('utf-8-sig',errors='replace')
        except Exception: continue
        for r in csv.DictReader(io.StringIO(pt)):
            n=r.get('PlayerName'); k=norm(n)
            if k and n: proj[k]=num(r.get('PlayerWeekProjectedPts')); meta[k]=pos
        for r in csv.DictReader(io.StringIO(at)):
            k=norm(r.get('PlayerName'))
            if k: act[k]=num(r.get('TotalPoints'))
    return proj,act,meta

def load_year(year):
    print('loading',year,flush=True)
    return load_adp(year),load_auction(year),{w:load_week(year,w) for w in range(1,WEEKS+1)}

def targets(): return {'QB':1,'RB':2,'WR':2,'TE':1}
def counts(roster):
    d=defaultdict(int)
    for p in roster:d[p.pos]+=1
    return d
def legal(roster,p): return counts(roster)[p.pos] < {'QB':2,'RB':6,'WR':7,'TE':3}[p.pos]
def pos_need(p,roster):
    c=counts(roster); gap=max(0,targets()[p.pos]-c[p.pos]); rd=len(roster)+1; v=gap*16
    if rd>8 and gap:v+=10
    if c[p.pos]>={'QB':2,'RB':6,'WR':7,'TE':3}[p.pos]:v-=40
    return v
def tier(rank): return 1 if rank<=12 else 2 if rank<=36 else 3 if rank<=72 else 4 if rank<=120 else 5
def scarcity(p,avail):
    peers=sum(1 for x in avail if x.pos==p.pos and tier(x.rank)==tier(p.rank))
    return max(-8,min(24,28-peers*3))
def user_score(p,roster,avail,pick):
    value=145-p.rank*.84; adpgap=max(-18,min(18,(p.adp or p.rank)-pick))*-.45; need=pos_need(p,roster); scarce=scarcity(p,avail)
    ceiling=max(0,min(26,30-p.rank/12))+(4 if p.pos=='WR' else 3 if p.pos=='RB' else 2 if p.pos=='TE' else 0)
    return value+need+scarce+ceiling*.28+adpgap
def cpu_score(p,roster,pick,rng):
    need=pos_need(p,roster)*.34; cost=p.adp or p.rank; slide=max(-15,min(20,pick-cost))*.35
    return 125-cost*.88+need+slide+rng.uniform(-4,4)

def snake_draft(players,slot,seed,framework):
    rng=random.Random(seed); teams=[[] for _ in range(TEAMS)]; avail=list(players)
    for pick in range(1,TEAMS*ROUNDS+1):
        rd=(pick-1)//TEAMS+1; x=(pick-1)%TEAMS; tm=x if rd%2 else TEAMS-1-x; r=teams[tm]
        pool=[p for p in avail[:80] if legal(r,p)] or avail[:80]
        if not pool:break
        if tm==slot-1:
            chosen=max(pool,key=lambda p:user_score(p,r,avail,pick)) if framework else min(pool,key=lambda p:p.adp)
        else: chosen=max(pool,key=lambda p:cpu_score(p,r,pick,rng))
        r.append(chosen); avail.remove(chosen)
    return teams[slot-1]

def select_lineup(roster,proj):
    used=set(); out=[]
    def take(pos,n):
        cand=sorted([p for p in roster if p.pos==pos and p.key not in used],key=lambda p:proj.get(p.key,0),reverse=True)
        for p in cand[:n]: used.add(p.key); out.append(p)
    take('QB',1);take('RB',2);take('WR',2);take('TE',1)
    flex=sorted([p for p in roster if p.pos in ('RB','WR','TE') and p.key not in used],key=lambda p:proj.get(p.key,0),reverse=True)
    out.extend(flex[:2]); return out

def season_points(roster,weeks):
    total=0.0
    for w in range(1,WEEKS+1):
        proj,act,_=weeks[w]; total+=sum(act.get(p.key,0) for p in select_lineup(roster,proj))
    return total

def intrinsic(p):
    return max(1,p.price+max(0,40-p.rank)*.08+({'RB':2,'WR':2,'QB':0,'TE':1}.get(p.pos,0)))
def auction_max_bid(p,team,avail,framework):
    slots_left=max(1,ROUNDS-len(team.roster)); reserve=(slots_left-1)*MIN_BID; spendable=max(MIN_BID,team.budget-reserve)
    if not framework:return min(spendable,max(MIN_BID,round(p.price)))
    need=max(0,20-p.rank/8); scarce=max(0,25-(p.rank%24)); ceil=max(0,35-p.rank*.15)
    v=intrinsic(p)+need*.07+scarce*.04+ceil*.025
    return max(MIN_BID,min(spendable,round(v)))
def cpu_bid(p,team,rng):
    slots_left=max(1,ROUNDS-len(team.roster)); spendable=max(MIN_BID,team.budget-(slots_left-1)*MIN_BID)
    c=counts(team.roster); gap=max(0,targets()[p.pos]-c[p.pos]); mult=1+gap*.06+rng.uniform(-.07,.07)
    return max(MIN_BID,min(spendable,round(max(1,p.price*mult))))

def auction_draft(players,target_idx,seed,framework):
    rng=random.Random(seed); teams=[Team() for _ in range(TEAMS)]; avail=list(players)
    # Nomination order approximates real rooms: expensive tiers generally surface earlier, but not perfectly.
    order=[]
    for i in range(0,len(avail),12):
        block=avail[i:i+12]; rng.shuffle(block); order.extend(block)
    sold=set()
    for p in order:
        if p.key in sold:continue
        bids=[]
        for i,t in enumerate(teams):
            if len(t.roster)>=ROUNDS or not legal(t.roster,p):continue
            b=auction_max_bid(p,t,avail,framework) if i==target_idx else cpu_bid(p,t,rng)
            if b>=MIN_BID:bids.append((b,rng.random(),i))
        if not bids:continue
        bids.sort(reverse=True); win=bids[0]; second=bids[1][0] if len(bids)>1 else MIN_BID-1; price=min(win[0],max(MIN_BID,second+1)); t=teams[win[2]]
        if price<=t.budget-(max(0,ROUNDS-len(t.roster)-1))*MIN_BID:
            t.roster.append(p);t.budget-=price;sold.add(p.key)
        if all(len(t.roster)>=ROUNDS for t in teams):break
    # Fill incomplete rosters at $1 with remaining legal players.
    remain=[p for p in avail if p.key not in sold]
    for t in teams:
        for p in list(remain):
            if len(t.roster)>=ROUNDS:break
            if legal(t.roster,p) and t.budget>=MIN_BID:
                t.roster.append(p);t.budget-=MIN_BID;remain.remove(p)
    return teams[target_idx].roster,teams[target_idx].budget

def paired_stats(diffs):
    m=mean(diffs); sd=statistics.stdev(diffs) if len(diffs)>1 else 0; se=sd/(len(diffs)**.5) if diffs else 0
    return {'n':len(diffs),'mean_delta':round(m,2),'win_rate':round(sum(d>0 for d in diffs)/len(diffs),3),'ci95':[round(m-1.96*se,2),round(m+1.96*se,2)]}

def main():
    out=Path(sys.argv[1] if len(sys.argv)>1 else 'data/backtests/redraft-mock-validation');out.mkdir(parents=True,exist_ok=True)
    data={y:load_year(y) for y in YEARS}; report={'method':'paired 2024-2025 redraft-only historical replay; pregame projections choose lineups; no waivers; no dynasty','years':{}}
    all_snake=[];all_auc=[]
    for y,(adp,auction,weeks) in data.items():
        sd=[];ad=[];snake_scores=[];auc_scores=[]
        for i in range(RUNS):
            slot=i%TEAMS+1;seed=SEED+y*1009+i*101
            fr=snake_draft(adp,slot,seed,True);bl=snake_draft(adp,slot,seed,False)
            fp=season_points(fr,weeks);bp=season_points(bl,weeks);sd.append(fp-bp);snake_scores.append((fp,bp))
            ar,_=auction_draft(auction,slot-1,seed+17,True);ab,_=auction_draft(auction,slot-1,seed+17,False)
            ap=season_points(ar,weeks);bb=season_points(ab,weeks);ad.append(ap-bb);auc_scores.append((ap,bb))
        report['years'][str(y)]={
            'snake':{**paired_stats(sd),'framework_points':round(mean([x for x,_ in snake_scores]),2),'baseline_points':round(mean([x for _,x in snake_scores]),2)},
            'auction':{**paired_stats(ad),'framework_points':round(mean([x for x,_ in auc_scores]),2),'baseline_points':round(mean([x for _,x in auc_scores]),2)}
        }
        all_snake+=sd;all_auc+=ad
    report['combined']={'snake':paired_stats(all_snake),'auction':paired_stats(all_auc)}
    report['interpretation']={
      'snake_baseline':'ADP-first target team; identical competent ADP-driven opponents and seeds.',
      'auction_baseline':'FFToday half-PPR $200 values; target bids to generic price while opponents use need-adjusted market bids.',
      'auction_scope':'Validates roster-construction/max-bid mechanics against historical market prices, not your league-specific price model because Yahoo historical auction records are not yet available.',
      'lineup_policy':'Weekly starters chosen only from that week pregame projections; scoring uses realized points.',
      'promotion_rule':'Treat format as validated only when combined paired mean is positive and its 95% interval does not cross zero.'
    }
    (out/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
if __name__=='__main__':main()
