#!/usr/bin/env python3
"""Normalize snake or auction CSV/JSON into the local calibration contract."""
import argparse,csv,json
from pathlib import Path

def number(value,integer=False):
    try:return int(float(value)) if integer else float(value)
    except (TypeError,ValueError):return None

def load(path):
    text=path.read_text(encoding='utf-8-sig')
    if path.suffix.lower()=='.csv' or (not text.lstrip().startswith(('{','[')) and ',' in text.partition('\n')[0]):
        with path.open(encoding='utf-8-sig',newline='') as handle:return list(csv.DictReader(handle))
    return json.loads(text)

def normalize(rows,kind):
    if isinstance(rows,dict) and rows.get('version')==1 and rows.get('kind')==kind:return rows
    if isinstance(rows,dict):rows=rows.get('picks' if kind=='snake' else 'purchases',[])
    if not isinstance(rows,list):raise ValueError('Input must contain a list of rows')
    if kind=='snake':
        picks=[]
        for i,row in enumerate(rows):
            pick=number(row.get('pick') or row.get('pick_no') or row.get('overall_pick') or i+1,True)
            if not pick or not row.get('position'):raise ValueError(f'Row {i+1} needs pick and position')
            picks.append({'pick':pick,'player_id':str(row.get('player_id') or row.get('key') or ''),'name':row.get('name') or row.get('player_name') or '', 'position':str(row['position']).upper(),'team':number(row.get('team') or row.get('draft_slot'),True)})
        return {'version':1,'kind':'snake','drafts':[{'picks':picks}]}
    purchases=[]
    for i,row in enumerate(rows):
        price=number(row.get('price'));name=row.get('name') or row.get('player_name');position=row.get('position')
        if price is None or not name or not position:raise ValueError(f'Row {i+1} needs name, position, and price')
        purchases.append({'name':name,'position':str(position).upper(),'price':price,'generic_aav':number(row.get('generic_aav') or row.get('baseline_price')) or 0,'manager':row.get('manager') or ''})
    return {'version':1,'kind':'auction','seasons':[{'purchases':purchases}]}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('input',type=Path);parser.add_argument('--kind',choices=['snake','auction'],required=True);parser.add_argument('--output',type=Path);args=parser.parse_args()
    result=normalize(load(args.input),args.kind);body=json.dumps(result,indent=2)+'\n'
    if args.output:args.output.write_text(body,encoding='utf-8')
    else:print(body,end='')
if __name__=='__main__':main()
