"""
Refreshes fantasypros.json from the live FantasyPros API.
Runs inside GitHub Actions (see .github/workflows/refresh-data.yml) —
never runs on-device, never touches the browser, key stays in GitHub Secrets.
"""
import json
import os
import sys
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
        try:
            url = f"https://api.fantasypros.com/public/v2/json/nfl/2026/projections?position={pos}&week=0"
            data = get(url)
            players = data.get("players", [])
            proj_list = []
            for p in players:
                stats_raw = p.get("stats", {})
                # Defensive: schema shows 'stats' as an array of stat objects, but
                # behavior wasn't verified against a live call. Handle both shapes.
                if isinstance(stats_raw, list):
                    stats = stats_raw[0] if stats_raw else {}
                else:
                    stats = stats_raw or {}
                pts = stats.get("points_half")
                if pts is not None:
                    proj_list.append({"name": p["name"], "points_half": round(pts, 1)})
            projections[pos] = proj_list
            print(f"{pos} projections: {len(proj_list)} players")
        except Exception as e:
            print(f"WARNING: projections fetch failed for {pos}: {e}", file=sys.stderr)
            projections[pos] = []

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
