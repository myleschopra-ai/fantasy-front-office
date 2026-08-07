#!/usr/bin/env python3
"""Merge provider-neutral sportsbook quote files before consensus building."""
import argparse, json
from pathlib import Path


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('inputs', nargs='+')
    ap.add_argument('--output', required=True)
    args=ap.parse_args()
    quotes=[]; providers=[]
    for name in args.inputs:
        data=json.loads(Path(name).read_text())
        providers.append(data.get('provider'))
        quotes.extend(data.get('quotes') or [])
    out={'version':1,'providers':[p for p in providers if p],'quotes':quotes}
    path=Path(args.output); path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(out,indent=2))
    print(f"merged {len(quotes)} quotes from {len(args.inputs)} files")

if __name__=='__main__': main()
