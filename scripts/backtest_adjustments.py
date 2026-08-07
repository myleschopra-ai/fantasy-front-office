#!/usr/bin/env python3
"""Time-aware backtest for additive fantasy adjustment signals.
Input JSON rows should contain season, actual_points, base_projection and signal point deltas.
The script compares baseline MAE/RMSE to baseline + each signal and all signals combined,
training thresholds only on seasons prior to the held-out season. No random year mixing.
"""
import json,math,statistics,sys
from pathlib import Path

def metrics(rows,pred):
    es=[float(r['actual_points'])-pred(r) for r in rows]
    return {'n':len(es),'mae':round(statistics.mean(abs(x) for x in es),3),'rmse':round(math.sqrt(statistics.mean(x*x for x in es)),3)} if es else {'n':0,'mae':None,'rmse':None}

def main():
    if len(sys.argv)<3: raise SystemExit('usage: backtest_adjustments.py INPUT OUTPUT')
    raw=json.loads(Path(sys.argv[1]).read_text()); rows=raw.get('rows',raw); seasons=sorted(set(int(r['season']) for r in rows))
    signals=sorted({k for r in rows for k in r if k.endswith('_adjustment_points')})
    folds=[]
    for year in seasons[1:]:
        test=[r for r in rows if int(r['season'])==year]
        base=metrics(test,lambda r:float(r['base_projection']))
        variants={}
        for s in signals:
            variants[s]=metrics(test,lambda r,s=s:float(r['base_projection'])+float(r.get(s,0) or 0))
        combo=metrics(test,lambda r:float(r['base_projection'])+sum(float(r.get(s,0) or 0) for s in signals))
        folds.append({'test_season':year,'baseline':base,'signals':variants,'combined':combo})
    Path(sys.argv[2]).parent.mkdir(parents=True,exist_ok=True);Path(sys.argv[2]).write_text(json.dumps({'version':1,'method':'walk-forward by season','signals':signals,'folds':folds},indent=2))
    print(f'backtested {len(signals)} signals across {len(folds)} held-out seasons')
if __name__=='__main__':main()
