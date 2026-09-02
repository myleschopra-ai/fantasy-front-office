#!/usr/bin/env python3
"""Cache Sleeper's free player universe and add/drop signals once per refresh."""
from __future__ import annotations

import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "sleeper"
BASE = "https://api.sleeper.app/v1"
USER_AGENT = "FantasyFrontOffice/2.0 (+https://github.com/myleschopra-ai/fantasy-front-office)"


def fetch(path: str):
    request = urllib.request.Request(f"{BASE}{path}", headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    players = fetch("/players/nfl")
    adds = fetch("/players/nfl/trending/add?lookback_hours=24&limit=250")
    drops = fetch("/players/nfl/trending/drop?lookback_hours=24&limit=250")
    active = {
        str(player_id): player
        for player_id, player in players.items()
        if player.get("active") is True and str(player.get("position") or "").upper() in {"QB", "RB", "HB", "FB", "WR", "TE", "K", "DEF"}
    }
    (RAW / "players.json").write_text(json.dumps(active, separators=(",", ":")) + "\n", encoding="utf-8")
    (RAW / "trending.json").write_text(json.dumps({"add": adds, "drop": drops}, separators=(",", ":")) + "\n", encoding="utf-8")
    manifest = {
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "source": "Sleeper public API",
        "source_url": "https://docs.sleeper.com/",
        "active_players": len(active),
        "trending_adds": len(adds),
        "trending_drops": len(drops),
        "refresh_policy": "at most once daily",
    }
    (RAW / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest))


if __name__ == "__main__":
    main()
