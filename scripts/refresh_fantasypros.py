"""
Refreshes fantasypros.json from the live FantasyPros API.
Runs inside GitHub Actions (see .github/workflows/refresh-data.yml) —
never runs on-device, never touches the browser, key stays in GitHub Secrets.
"""
import json
import os
import sys
import time
import urllib.request

API_KEY = os.environ.get("FANTASYPROS_API_KEY")
if not API_KEY:
    print("ERROR: FANTASYPROS_API_KEY not set in environment.", file=sys.stderr)
    sys.exit(1)

POSITIONS = ["QB", "RB", "WR", "TE"]


def get(url):
    req = urllib.request.Request(url, headers={"x-api-key": API_KEY})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def main():
    rankings = {}
    for pos in POSITIONS:
        url = f"https://api.fantasypros.com/public/v2/json/nfl/2026/consensus-rankings?position={pos}&scoring=PPR"
        data = get(url)
        players = data.get("players", [])
        rankings[pos] = [
            {"name": p["player_name"], "rank": p["rank_ecr"], "tier": p["tier"]}
            for p in players[:50]
        ]
        print(f"{pos}: {len(rankings[pos])} players")
        time.sleep(1)  # space out calls — free-tier behavior has shown flakiness under rapid sequential requests

    news_data = get("https://api.fantasypros.com/public/v2/json/nfl/news?category=injury")
    injuries = [
        {"name": item.get("player_name", item.get("title")), "team": item.get("team_id", "")}
        for item in news_data.get("items", [])[:30]
    ]
    print(f"injuries: {len(injuries)} items")

    # Real point projections (week=0 = preseason/full-season outlook per FantasyPros' own docs).
    # points_half matches this league's actual Half-PPR scoring exactly.
    projections = {}
    for pos in POSITIONS:
        proj_list = []
        raw_count = 0
        for attempt in range(2):  # one retry if the API returns an empty/flaky response
            try:
                url = f"https://api.fantasypros.com/public/v2/json/nfl/2026/projections?position={pos}&week=0"
                data = get(url)
                players = data.get("players", [])
                raw_count = len(players)
                proj_list = []
                for p in players:
                    stats_raw = p.get("stats", {})
                    if isinstance(stats_raw, list):
                        stats = stats_raw[0] if stats_raw else {}
                    else:
                        stats = stats_raw or {}
                    pts = stats.get("points_half")
                    if pts is not None:
                        proj_list.append({"name": p["name"], "points_half": round(pts, 1)})
                if raw_count > 0:
                    break  # got real data, no need to retry
                print(f"  {pos} attempt {attempt + 1}: API returned 0 raw players, retrying...")
                time.sleep(2)
            except Exception as e:
                print(f"WARNING: projections fetch failed for {pos} (attempt {attempt + 1}): {e}", file=sys.stderr)
                time.sleep(2)
        projections[pos] = proj_list
        print(f"{pos} projections: {raw_count} raw players from API, {len(proj_list)} had usable points_half")
        time.sleep(1)

    from datetime import date
    snapshot = {
        "generated_at": date.today().isoformat(),
        "rankings": rankings,
        "injuries": injuries,
        "projections": projections,
    }

    with open("fantasypros.json", "w") as f:
        json.dump(snapshot, f)

    print("Wrote fantasypros.json")


if __name__ == "__main__":
    main()
