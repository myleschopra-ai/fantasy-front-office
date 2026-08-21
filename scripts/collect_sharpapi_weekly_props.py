#!/usr/bin/env python3
"""Collect event-specific SharpAPI NFL player props for weekly projections."""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import collect_sharpapi_season_props as shared


def parse_weekly_rows(rows: list[dict], captured_at: str) -> tuple[list[dict], dict]:
    # Reuse the provider contract but accept only event props here. Season rows
    # are excluded so the two datasets remain impossible to cross-contaminate.
    event_rows = [row for row in rows if not shared.is_season_row(row)]
    quotes, rejected = shared.parse_rows(event_rows, captured_at, include_event_props=True)
    for quote in quotes:
        quote["projection_scope"] = "weekly"
        quote["week_event_id"] = quote.pop("event_id", None)
    rejected["season_long_excluded"] = len(rows) - len(event_rows)
    return quotes, rejected


def collect(api_key: str, base_url: str = shared.DEFAULT_BASE_URL, max_pages: int = 20) -> dict:
    captured_at = datetime.now(timezone.utc).isoformat()
    rows, pages = shared.fetch_all_rows(api_key, base_url, max_pages=max_pages)
    quotes, rejected = parse_weekly_rows(rows, captured_at)
    if not quotes:
        raise RuntimeError("SharpAPI returned no supported current-week NFL player props")
    return {"version": 1, "kind": "weekly_player_props", "provider": "sharpapi",
            "captured_at": captured_at, "records_examined": len(rows), "pages_examined": pages,
            "rejected": rejected, "quotes": quotes}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--base-url", default=shared.DEFAULT_BASE_URL)
    parser.add_argument("--key-env", default="SHARP_API_KEY")
    args = parser.parse_args()
    api_key = os.environ.get(args.key_env)
    if not api_key:
        parser.error(f"set {args.key_env} in the environment; API keys are not accepted as arguments")
    data, output = collect(api_key, args.base_url), Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"wrote {len(data['quotes'])} weekly SharpAPI quotes to {output}")


if __name__ == "__main__":
    try:
        main()
    except shared.SharpRateLimitError as exc:
        print(f"SharpAPI free-tier limit is still active. Wait {exc.retry_after:.0f} seconds, then rerun the same command.", file=sys.stderr)
        raise SystemExit(2)
    except Exception as exc:
        print(f"collection failed: {exc}", file=sys.stderr)
        raise
