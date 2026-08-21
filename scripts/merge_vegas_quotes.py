#!/usr/bin/env python3
"""Merge quote files, counting each sportsbook opinion only once per market."""
import argparse, json
from datetime import datetime
from pathlib import Path

SOURCE_PRIORITY = {"licensed_api": 3, "documented_api": 3, "public_undocumented_api": 2, "public_scrape": 1}


def parse_time(value):
    try:
        return datetime.fromisoformat(str(value or "").replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return 0


def quote_key(quote):
    return (
        str(quote.get("player_key") or quote.get("player_name") or "").lower(),
        str(quote.get("book") or "").lower(),
        str(quote.get("market") or "").lower(),
    )


def rank(quote):
    return (SOURCE_PRIORITY.get(str(quote.get("source_type") or ""), 0), parse_time(quote.get("updated_at")))


def merge_payloads(payloads):
    selected, providers, duplicates = {}, [], []
    for data in payloads:
        provider = data.get("provider")
        if provider:
            providers.append(provider)
        for quote in data.get("quotes") or []:
            key = quote_key(quote)
            previous = selected.get(key)
            if previous is None or rank(quote) > rank(previous):
                if previous is not None:
                    duplicates.append(previous)
                selected[key] = quote
            else:
                duplicates.append(quote)
    return {
        "version": 2,
        "providers": list(dict.fromkeys(providers)),
        "quotes": list(selected.values()),
        "deduplication": {
            "rule": "one quote per player, sportsbook, and market; prefer licensed then newest",
            "discarded": len(duplicates),
        },
    }


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('inputs', nargs='+')
    ap.add_argument('--output', required=True)
    args=ap.parse_args()
    payloads=[json.loads(Path(name).read_text()) for name in args.inputs]
    out=merge_payloads(payloads)
    path=Path(args.output); path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(out,indent=2))
    print(f"merged {len(out['quotes'])} unique sportsbook quotes from {len(args.inputs)} files; discarded {out['deduplication']['discarded']} duplicates")

if __name__=='__main__': main()
