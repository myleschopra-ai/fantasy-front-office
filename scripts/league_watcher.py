"""
Watches a Sleeper league for:
  1. Any newly completed trade (league-wide)
  2. Your own roster crossing a SELL HIGH / RISK trend threshold

Sends push notifications via ntfy.sh (free, no account).
Persists state in watcher_state.json so it only alerts on NEW events,
not the same thing every run.
"""
import json
import os
import sys
import urllib.request

LEAGUE_ID = "1337549680476721152"
MY_ROSTER_ID = 9
NTFY_TOPIC = os.environ.get("NTFY_TOPIC", "").strip()
STATE_FILE = "watcher_state.json"
TREND_THRESHOLD = 50

if not NTFY_TOPIC:
    print("ERROR: NTFY_TOPIC not set.", file=sys.stderr)
    sys.exit(1)


def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def notify(title, message, priority="default"):
    req = urllib.request.Request(
        f"https://ntfy.sh/{NTFY_TOPIC}",
        data=message.encode("utf-8"),
        headers={"Title": title, "Priority": priority},
        method="POST",
    )
    urllib.request.urlopen(req, timeout=10)
    print(f"Notified: {title} — {message}")


def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"seen_trade_ids": [], "flagged_players": {}}


def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)


def main():
    state = load_state()

    users = get(f"https://api.sleeper.app/v1/league/{LEAGUE_ID}/users")
    rosters = get(f"https://api.sleeper.app/v1/league/{LEAGUE_ID}/rosters")
    user_by_id = {u["user_id"]: u["display_name"] for u in users}
    owner_by_roster = {r["roster_id"]: user_by_id.get(r["owner_id"], "Unknown") for r in rosters}

    # ---- 1. Check for new completed trades, league-wide ----
    new_trade_alerts = 0
    for week in range(0, 4):
        try:
            txns = get(f"https://api.sleeper.app/v1/league/{LEAGUE_ID}/transactions/{week}")
        except Exception:
            continue
        for t in txns:
            if t.get("type") != "trade" or t.get("status") != "complete":
                continue
            tid = t["transaction_id"]
            if tid in state["seen_trade_ids"]:
                continue
            state["seen_trade_ids"].append(tid)
            teams = [owner_by_roster.get(rid, "?") for rid in t.get("roster_ids", [])]
            notify(
                "Trade completed",
                f"{' <-> '.join(teams)} completed a trade in The League of Shadows. Check the dashboard.",
            )
            new_trade_alerts += 1

    # ---- 2. Check own roster for new trend threshold crossings ----
    fc_data = get("https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5")
    fc_by_sid = {str(e["player"]["sleeperId"]): e for e in fc_data if e["player"].get("sleeperId")}

    my_roster = next((r for r in rosters if r["roster_id"] == MY_ROSTER_ID), None)
    my_player_ids = set(my_roster.get("players") or []) if my_roster else set()
    new_flag_alerts = 0
    if my_roster:
        for pid in my_player_ids:
            fc = fc_by_sid.get(pid)
            if not fc:
                continue
            trend = fc.get("trend30Day")
            name = fc["player"]["name"]
            if trend is None:
                continue

            current_flag = None
            if trend >= TREND_THRESHOLD:
                current_flag = "SELL HIGH"
            elif trend <= -TREND_THRESHOLD:
                current_flag = "RISK"

            prev_flag = state["flagged_players"].get(pid)
            if current_flag and current_flag != prev_flag:
                notify(
                    f"{current_flag}: {name}",
                    f"{name} is now trending {trend:+d} over 30 days (value {fc['value']}).",
                    priority="high" if current_flag == "SELL HIGH" else "default",
                )
                new_flag_alerts += 1

            if current_flag:
                state["flagged_players"][pid] = current_flag
            elif pid in state["flagged_players"]:
                del state["flagged_players"][pid]

    # ---- 3. Check free agents for big upward moves (acquisition targets) ----
    all_rostered_ids = set()
    for r in rosters:
        for pid in (r.get("players") or []):
            all_rostered_ids.add(pid)

    new_target_alerts = 0
    state.setdefault("flagged_targets", {})
    for e in fc_data:
        sid = e["player"].get("sleeperId")
        pos = e["player"].get("position")
        if not sid or pos in (None, "PICK") or str(sid) in all_rostered_ids:
            continue
        trend = e.get("trend30Day")
        if trend is None or trend < TREND_THRESHOLD:
            continue
        sid = str(sid)
        if sid not in state["flagged_targets"]:
            notify(
                f"Riser available: {e['player']['name']}",
                f"{e['player']['name']} ({pos}, {e['player'].get('maybeTeam','FA')}) is a free agent trending {trend:+d} over 30 days.",
            )
            new_target_alerts += 1
        state["flagged_targets"][sid] = trend

    # ---- 4. Cross-check own roster against committed FantasyPros injury snapshot ----
    new_injury_alerts = 0
    state.setdefault("seen_injuries", [])
    if os.path.exists("fantasypros.json") and my_roster:
        with open("fantasypros.json") as f:
            fp_data = json.load(f)
        my_names = set()
        for pid in my_player_ids:
            p = fc_by_sid.get(pid)
            if p:
                my_names.add(p["player"]["name"])
        for item in fp_data.get("injuries", []):
            key = f"{item.get('name')}|{item.get('team')}"
            if item.get("name") in my_names and key not in state["seen_injuries"]:
                notify(
                    f"Injury news: {item.get('name')}",
                    f"{item.get('name')} ({item.get('team')}): new report in the FantasyPros injury feed.",
                    priority="high",
                )
                new_injury_alerts += 1
                state["seen_injuries"].append(key)

    save_state(state)
    print(f"Done. {new_trade_alerts} trade, {new_flag_alerts} roster-flag, "
          f"{new_target_alerts} target, {new_injury_alerts} injury alert(s).")


if __name__ == "__main__":
    main()
