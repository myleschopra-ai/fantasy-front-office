"""
Watches a Sleeper league and pushes only material news via ntfy.sh.

Immediate pushes (time-sensitive):
  1. Any newly completed trade (league-wide)
  2. A new injury designation on one of your current starters

Daily digest (one push per day, everything else):
  3. Your roster crossing a value-relative SELL HIGH / RISK trend threshold,
     with hysteresis and a cooldown so one player cannot flip-flop
  4. Free agents rising fast enough to matter
  5. FAAB spent by other managers
  6. Free agents whose FantasyPros projection beats your weakest rostered player

Thresholds live in config/decision_policy.json ("alerts"). State persists in
watcher_state.json so a run only reports what is new.
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

LEAGUE_ID = "1337549680476721152"
MY_ROSTER_ID = 9
STATE_FILE = "watcher_state.json"
POLICY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "config", "decision_policy.json")
DEFAULT_ALERT_POLICY = {
    "min_value": 500,
    "trend_share": 0.08,
    "rearm_share": 0.5,
    "cooldown_days": 7,
    "digest_hour_utc": 13,
    "riser_min_trend": 150,
}
INJURY_PUSH_STATUSES = {"OUT", "DOUBTFUL", "IR", "PUP", "SUS", "NA", "QUESTIONABLE"}
PLAYERS_REFRESH_HOURS = 3

NTFY_TOPIC = ""
_history_buffer = []


def load_policy(path=POLICY_FILE):
    try:
        with open(path) as handle:
            return {**DEFAULT_ALERT_POLICY, **(json.load(handle).get("alerts") or {})}
    except (OSError, ValueError):
        return dict(DEFAULT_ALERT_POLICY)


def utcnow():
    return datetime.now(timezone.utc)


def parse_time(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def iso(moment):
    return moment.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=30) as r:
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
    _history_buffer.append({
        "timestamp": iso(utcnow()),
        "title": title,
        "message": message,
        "priority": priority,
    })


# ---------------------------------------------------------------------------
# Pure decision rules (tested in tests/test_league_watcher.py)
# ---------------------------------------------------------------------------

def trend_threshold(value, policy):
    return max(1.0, float(policy["trend_share"]) * float(value or 0))


def trend_decision(value, trend, previous, now, policy):
    """Decide whether a roster player's 30-day trend deserves an alert.

    Returns (alert_flag_or_None, new_record_or_None). A player is material
    only when worth at least `min_value` and moving at least `trend_share`
    of that value. After an alert the player is disarmed until the trend falls
    back under `rearm_share` of the threshold, and no player alerts twice
    within `cooldown_days` in either direction.
    """
    if value is None or trend is None:
        return None, previous
    if isinstance(previous, str):  # legacy state: {"pid": "RISK"}
        previous = {"flag": previous, "at": None, "armed": False}
    threshold = trend_threshold(value, policy)
    material = float(value) >= float(policy["min_value"]) and abs(float(trend)) >= threshold
    record = dict(previous) if previous else None
    if record and not record.get("armed", True) and abs(float(trend)) < threshold * float(policy["rearm_share"]):
        record["armed"] = True
    if not material:
        return None, record
    flag = "SELL HIGH" if trend > 0 else "RISK"
    if record:
        last = parse_time(record.get("at"))
        cooling = last is not None and now - last < timedelta(days=float(policy["cooldown_days"]))
        if not record.get("armed", True) or cooling:
            return None, record
    return flag, {"flag": flag, "at": iso(now), "armed": False, "value": value, "trend": trend}


def riser_decision(value, trend, previous, now, policy):
    """Free-agent riser: big absolute move on a player with real value, once per cooldown."""
    if value is None or trend is None:
        return False, previous
    if float(value) < float(policy["min_value"]) / 2 or float(trend) < float(policy["riser_min_trend"]):
        return False, previous
    if isinstance(previous, dict):
        last = parse_time(previous.get("at"))
        if last is not None and now - last < timedelta(days=float(policy["cooldown_days"])):
            return False, previous
    return True, {"at": iso(now), "trend": trend, "value": value}


def digest_due(state, now, policy):
    if not state.get("digest_queue"):
        return False
    if now.hour < int(policy["digest_hour_utc"]):
        return False
    return state.get("last_digest_date") != now.date().isoformat()


def digest_message(queue, limit=12):
    lines = [f"• {item['title']}: {item['message']}" for item in queue[:limit]]
    if len(queue) > limit:
        lines.append(f"…and {len(queue) - limit} more on the dashboard.")
    return "\n".join(lines)


# ---------------------------------------------------------------------------


def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            state = json.load(f)
    else:
        state = {"seen_trade_ids": [], "flagged_players": {}}
    state.setdefault("history", [])
    state.setdefault("faab_used", {})
    state.setdefault("flagged_targets", {})
    state.setdefault("digest_queue", [])
    state.setdefault("starter_injuries", {})
    return state


def save_state(state):
    # Append this run's pushes to history, capped to the most recent 200 entries
    state["history"] = (state.get("history", []) + _history_buffer)[-200:]
    state["last_run"] = iso(utcnow())
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)


def queue(state, title, message):
    state["digest_queue"].append({"title": title, "message": message, "queued_at": iso(utcnow())})


def main():
    global NTFY_TOPIC
    NTFY_TOPIC = os.environ.get("NTFY_TOPIC", "").strip()
    if not NTFY_TOPIC:
        print("ERROR: NTFY_TOPIC not set.", file=sys.stderr)
        sys.exit(1)
    policy = load_policy()
    state = load_state()
    now = utcnow()

    users = get(f"https://api.sleeper.app/v1/league/{LEAGUE_ID}/users")
    rosters = get(f"https://api.sleeper.app/v1/league/{LEAGUE_ID}/rosters")
    user_by_id = {u["user_id"]: u["display_name"] for u in users}
    owner_by_roster = {r["roster_id"]: user_by_id.get(r["owner_id"], "Unknown") for r in rosters}
    counts = {"trade": 0, "injury": 0, "queued": 0}

    # ---- 1. New completed trades, league-wide (immediate) ----
    for week in range(0, 19):
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
            completed = t.get("status_updated") or t.get("created")
            if completed and now - datetime.fromtimestamp(completed / 1000, tz=timezone.utc) > timedelta(hours=72):
                continue  # older trades are recorded silently, never pushed late
            teams = [owner_by_roster.get(rid, "?") for rid in t.get("roster_ids", [])]
            notify(
                "Trade completed",
                f"{' <-> '.join(teams)} completed a trade in The League of Shadows. Check the dashboard.",
            )
            counts["trade"] += 1

    my_roster = next((r for r in rosters if r["roster_id"] == MY_ROSTER_ID), None)
    my_player_ids = set(my_roster.get("players") or []) if my_roster else set()
    my_starters = [pid for pid in (my_roster.get("starters") or []) if pid and pid != "0"] if my_roster else []

    # ---- 2. New injury designation on a current starter (immediate) ----
    last_players = parse_time(state.get("players_checked_at"))
    if my_starters and (last_players is None or now - last_players >= timedelta(hours=PLAYERS_REFRESH_HOURS)):
        try:
            directory = get("https://api.sleeper.app/v1/players/nfl")
            state["players_checked_at"] = iso(now)
            seen = state["starter_injuries"]
            current = {}
            for pid in my_starters:
                player = directory.get(pid) or {}
                status = str(player.get("injury_status") or "").upper()
                current[pid] = status
                name = f"{player.get('first_name', '')} {player.get('last_name', '')}".strip() or pid
                if status in INJURY_PUSH_STATUSES and seen.get(pid) != status:
                    notify(f"Starter injury: {name}", f"{name} is now listed {player.get('injury_status')}. Check your lineup before kickoff.", priority="high")
                    counts["injury"] += 1
            state["starter_injuries"] = current
        except Exception as error:  # the hourly watcher must not fail on one directory fetch
            print(f"Player directory unavailable: {error}")

    # ---- 3. Own-roster trend crossings (digest) ----
    fc_data = get("https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=0.5")
    fc_by_sid = {str(e["player"]["sleeperId"]): e for e in fc_data if e["player"].get("sleeperId")}
    flagged = state.setdefault("flagged_players", {})
    for pid in sorted(my_player_ids):
        fc = fc_by_sid.get(pid)
        if not fc:
            continue
        flag, record = trend_decision(fc.get("value"), fc.get("trend30Day"), flagged.get(pid), now, policy)
        if record is None:
            flagged.pop(pid, None)
        else:
            flagged[pid] = record
        if flag:
            name = fc["player"]["name"]
            share = abs(fc["trend30Day"]) / max(1, fc["value"]) * 100
            queue(state, f"{flag}: {name}", f"30-day trend {fc['trend30Day']:+d} on value {fc['value']} ({share:.0f}%).")
            counts["queued"] += 1

    # ---- 4. Free-agent risers (digest) ----
    all_rostered_ids = {pid for r in rosters for pid in (r.get("players") or [])}
    targets = state["flagged_targets"]
    for e in fc_data:
        sid = e["player"].get("sleeperId")
        pos = e["player"].get("position")
        if not sid or pos in (None, "PICK") or str(sid) in all_rostered_ids:
            continue
        sid = str(sid)
        previous = targets.get(sid)
        alert, record = riser_decision(e.get("value"), e.get("trend30Day"), previous if isinstance(previous, dict) else None, now, policy)
        if record is not None:
            targets[sid] = record
        if alert:
            queue(state, f"Riser available: {e['player']['name']}", f"{pos}, {e['player'].get('maybeTeam', 'FA')}: trending {e['trend30Day']:+d} over 30 days (value {e['value']}).")
            counts["queued"] += 1

    # ---- 5. FAAB spent by other managers (digest) ----
    try:
        league_total_budget = get(f"https://api.sleeper.app/v1/league/{LEAGUE_ID}")["settings"].get("waiver_budget")
    except Exception:
        league_total_budget = None
    if league_total_budget is not None:
        for r in rosters:
            rid = str(r["roster_id"])
            used = (r.get("settings") or {}).get("waiver_budget_used", 0)
            prev_used = state["faab_used"].get(rid, 0)
            if used > prev_used and r["roster_id"] != MY_ROSTER_ID:
                owner_name = owner_by_roster.get(r["roster_id"], "Unknown")
                queue(state, f"FAAB spent: {owner_name}", f"${used - prev_used} on waivers (${league_total_budget - used} remaining).")
                counts["queued"] += 1
            state["faab_used"][rid] = used

    # ---- 6. FantasyPros projection upgrades over your weakest rostered player (digest) ----
    fp_data = None
    if os.path.exists("fantasypros.json"):
        with open("fantasypros.json") as f:
            fp_data = json.load(f)
    state.setdefault("flagged_upgrades", [])
    if fp_data and fp_data.get("projections") and my_roster:
        def fp_proj_for(name, position):
            for p in fp_data["projections"].get(position, []):
                if p["name"] == name:
                    return p["points_half"]
            return None
        my_proj_by_position = {}
        for pid in my_player_ids:
            fc = fc_by_sid.get(pid)
            pos = fc["player"].get("position") if fc else None
            proj = fp_proj_for(fc["player"]["name"], pos) if pos else None
            if proj is not None:
                my_proj_by_position.setdefault(pos, []).append(proj)
        for e in fc_data:
            sid = e["player"].get("sleeperId")
            pos = e["player"].get("position")
            if not sid or pos in (None, "PICK") or str(sid) in all_rostered_ids:
                continue
            target_proj = fp_proj_for(e["player"]["name"], pos)
            weakest = min(my_proj_by_position.get(pos) or [float("inf")])
            key = f"{sid}|{pos}"
            if target_proj is not None and target_proj > weakest and key not in state["flagged_upgrades"]:
                queue(state, f"Upgrade available: {e['player']['name']}", f"{pos} projects {target_proj} pts vs your weakest rostered {pos} at {weakest} pts.")
                state["flagged_upgrades"].append(key)
                counts["queued"] += 1

    # ---- Daily digest ----
    if digest_due(state, now, policy):
        items = state["digest_queue"]
        notify(f"Front office digest: {len(items)} update{'s' if len(items) != 1 else ''}", digest_message(items))
        state["digest_queue"] = []
        state["last_digest_date"] = now.date().isoformat()

    save_state(state)
    print(f"Done. {counts['trade']} trade and {counts['injury']} starter-injury push(es); {counts['queued']} item(s) queued for the daily digest.")


if __name__ == "__main__":
    main()
