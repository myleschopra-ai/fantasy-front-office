#!/usr/bin/env python3
"""Replay the 2025 fantasy season using only information available at each decision point.

Purpose
-------
Test the current Front Office process as a fantasy-manager workflow, not just a player
projection model. The replay starts with a 12-team half-PPR snake draft from a seeded
random slot, then makes weekly lineup and waiver decisions through Week 17.

Data sources
------------
* Historical 2025 ADP: Fantasy Football Calculator public ADP REST API.
* Weekly projected + actual player results: hvpkod/NFL-Data (MIT), extracted from NFL.com.

Important leakage rule
----------------------
The manager never uses future actual results. Weekly lineup decisions use that week's
published projection. Waiver decisions may additionally use actual results from prior
weeks only. The current Vegas player-prop and referee layers are NOT assigned a positive
weight in this replay because the repository does not yet retain timestamped 2025
pre-game/player-prop snapshots needed to reconstruct those signals without hindsight.
They remain gated until historical snapshots are available.
"""
from __future__ import annotations

import csv
import io
import json
import math
import random
import statistics
import sys
import urllib.request
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

SEASON = 2025
TEAMS = 12
ROUNDS = 15
REG_WEEKS = 14
PLAYOFF_WEEKS = (15, 16, 17)
POSITIONS = ("QB", "RB", "WR", "TE")
SEED = 20250807
ADP_URL = "https://fantasyfootballcalculator.com/api/v1/adp/half-ppr?teams=12&year=2025"
RAW = "https://raw.githubusercontent.com/hvpkod/NFL-Data/refs/heads/main/NFL-data-Players/2025"


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "FantasyFrontOfficeBacktest/1.0"})
    with urllib.request.urlopen(req, timeout=45) as r:
        return r.read()


def norm(name: str) -> str:
    return "".join(c.lower() for c in (name or "") if c.isalnum())


def f(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


@dataclass
class Player:
    name: str
    pos: str
    team: str
    adp: float
    pid: str = ""


@dataclass
class Team:
    name: str
    roster: list[str] = field(default_factory=list)
    wins: int = 0
    losses: int = 0
    weekly_points: list[float] = field(default_factory=list)


def load_adp() -> list[Player]:
    payload = json.loads(get(ADP_URL).decode("utf-8"))
    rows = payload.get("players", payload)
    out = []
    for r in rows:
        pos = str(r.get("position") or r.get("pos") or "").upper()
        if pos not in POSITIONS:
            continue
        name = r.get("name") or r.get("player_name")
        adp = f(r.get("adp"), 999)
        if name and adp < 999:
            out.append(Player(name=name, pos=pos, team=r.get("team") or "", adp=adp))
    out.sort(key=lambda x: x.adp)
    if len(out) < 100:
        raise RuntimeError(f"ADP endpoint returned only {len(out)} usable players")
    return out


def load_week(week: int):
    projected, actual = {}, {}
    by_position = defaultdict(list)
    for pos in POSITIONS:
        purl = f"{RAW}/{week}/projected/{pos}_projected.csv"
        aurl = f"{RAW}/{week}/{pos}.csv"
        ptxt = get(purl).decode("utf-8-sig", errors="replace")
        atxt = get(aurl).decode("utf-8-sig", errors="replace")
        for r in csv.DictReader(io.StringIO(ptxt)):
            key = norm(r.get("PlayerName"))
            if not key:
                continue
            projected[key] = f(r.get("PlayerWeekProjectedPts"))
            by_position[pos].append(key)
        for r in csv.DictReader(io.StringIO(atxt)):
            key = norm(r.get("PlayerName"))
            if key:
                actual[key] = f(r.get("TotalPoints"))
    return projected, actual, by_position


def load_all_weeks():
    weeks = {}
    for w in range(1, 18):
        print(f"loading week {w}", flush=True)
        weeks[w] = load_week(w)
    return weeks


def roster_counts(roster, player_map):
    c = defaultdict(int)
    for k in roster:
        p = player_map.get(k)
        if p:
            c[p.pos] += 1
    return c


def legal_add(roster, p, player_map):
    c = roster_counts(roster, player_map)
    caps = {"QB": 2, "RB": 6, "WR": 7, "TE": 3}
    return c[p.pos] < caps[p.pos]


def need_bonus(roster, p, player_map):
    c = roster_counts(roster, player_map)
    starter_target = {"QB": 1, "RB": 2, "WR": 2, "TE": 1}
    if c[p.pos] < starter_target[p.pos]:
        return 18.0
    bench_target = {"QB": 1, "RB": 4, "WR": 5, "TE": 2}
    if c[p.pos] < bench_target[p.pos]:
        return 5.0
    return -4.0


def cpu_pick(available, roster, player_map, rng):
    pool = [p for p in available[:18] if legal_add(roster, p, player_map)] or available[:18]
    weights = []
    for p in pool:
        rank_pressure = max(0.4, 20 - min(19, p.adp / 8))
        need = max(0.2, 1 + need_bonus(roster, p, player_map) / 18)
        weights.append(rank_pressure * need)
    return rng.choices(pool, weights=weights, k=1)[0]


def framework_pick(available, roster, player_map, overall_pick):
    # Mirrors the present draft engine's market-heavy structure: acquisition cost is the
    # anchor, then roster need and scarcity modify the choice. No future results used.
    pool = [p for p in available[:32] if legal_add(roster, p, player_map)]
    best = None
    for p in pool:
        market = 110 - p.adp * 0.72
        fit = need_bonus(roster, p, player_map)
        scarcity = {"RB": 5.0, "WR": 3.0, "TE": 4.0, "QB": 1.0}[p.pos]
        value = max(-20, overall_pick - p.adp) * 0.45
        score = market + fit + scarcity + value
        if best is None or score > best[0]:
            best = (score, p)
    return best[1] if best else available[0]


def baseline_pick(available, roster, player_map):
    for p in available:
        if legal_add(roster, p, player_map):
            return p
    return available[0]


def draft(adp, slot, seed, strategy="framework"):
    rng = random.Random(seed)
    player_map = {norm(p.name): p for p in adp}
    teams = [Team(f"Team {i+1}") for i in range(TEAMS)]
    available = list(adp)
    picks = []
    for rd in range(1, ROUNDS + 1):
        order = list(range(TEAMS)) if rd % 2 else list(reversed(range(TEAMS)))
        for t in order:
            overall = len(picks) + 1
            if t == slot - 1:
                if strategy == "framework":
                    p = framework_pick(available, teams[t].roster, player_map, overall)
                else:
                    p = baseline_pick(available, teams[t].roster, player_map)
            else:
                p = cpu_pick(available, teams[t].roster, player_map, rng)
            k = norm(p.name)
            teams[t].roster.append(k)
            picks.append({"pick": overall, "team": t + 1, "player": p.name, "pos": p.pos, "adp": p.adp})
            available.remove(p)
    return teams, player_map, picks, {norm(p.name) for p in available}


def choose_lineup(roster, player_map, proj):
    players = [k for k in roster if k in player_map]
    used = set()
    lineup = []
    def take(pos, n):
        cand = [k for k in players if player_map[k].pos == pos and k not in used]
        cand.sort(key=lambda k: proj.get(k, 0), reverse=True)
        for k in cand[:n]:
            used.add(k); lineup.append(k)
    take("QB", 1); take("RB", 2); take("WR", 2); take("TE", 1)
    flex = [k for k in players if k not in used and player_map[k].pos in ("RB", "WR", "TE")]
    flex.sort(key=lambda k: proj.get(k, 0), reverse=True)
    for k in flex[:2]:
        used.add(k); lineup.append(k)
    return lineup


def lineup_points(lineup, actual):
    return round(sum(actual.get(k, 0) for k in lineup), 2)


def best_actual_lineup(roster, player_map, actual):
    return lineup_points(choose_lineup(roster, player_map, actual), actual)


def waiver_move(team, free_agents, player_map, proj, past_actual):
    # Uses current-week published projection plus only PRIOR actual performance.
    def score(k):
        hist = past_actual.get(k, [])[-2:]
        trend = statistics.mean(hist) if hist else 0
        return proj.get(k, 0) * 0.75 + trend * 0.25
    candidates = [k for k in free_agents if k in player_map and proj.get(k, 0) > 0]
    if not candidates:
        return None
    add = max(candidates, key=score)
    starters = set(choose_lineup(team.roster, player_map, proj))
    drops = [k for k in team.roster if k not in starters]
    if not drops:
        return None
    drop = min(drops, key=score)
    if score(add) < score(drop) + 2.0:
        return None
    team.roster.remove(drop); team.roster.append(add)
    free_agents.remove(add); free_agents.add(drop)
    return {"add": player_map[add].name, "drop": player_map[drop].name, "edge": round(score(add)-score(drop), 2)}


def regular_schedule(seed):
    # Rotating 12-team round robin; weeks 12-14 repeat first three pairings.
    rng = random.Random(seed)
    ids = list(range(TEAMS)); rng.shuffle(ids)
    rounds = []
    arr = ids[:]
    for _ in range(11):
        rounds.append([(arr[i], arr[-1-i]) for i in range(TEAMS//2)])
        arr = [arr[0]] + [arr[-1]] + arr[1:-1]
    return (rounds + rounds[:3])[:REG_WEEKS]


def play_season(adp, weeks, slot, seed, strategy):
    teams, player_map, picks, free_agents = draft(adp, slot, seed, strategy)
    me = teams[slot-1]
    schedule = regular_schedule(seed + 77)
    past_actual = defaultdict(list)
    weekly = []
    waiver_log = []
    projection_errors = []
    capture = []

    for w in range(1, 18):
        proj, actual, _ = weeks[w]
        if strategy == "framework" and w >= 2:
            mv = waiver_move(me, free_agents, player_map, proj, past_actual)
            if mv:
                mv["week"] = w; waiver_log.append(mv)
        lineups = []
        scores = []
        for team in teams:
            lu = choose_lineup(team.roster, player_map, proj)
            sc = lineup_points(lu, actual)
            lineups.append(lu); scores.append(sc)
            team.weekly_points.append(sc)
        my_lineup = lineups[slot-1]
        my_score = scores[slot-1]
        best = best_actual_lineup(me.roster, player_map, actual)
        cap = my_score / best if best > 0 else 1.0
        capture.append(cap)
        for k in my_lineup:
            projection_errors.append(actual.get(k, 0) - proj.get(k, 0))

        if w <= REG_WEEKS:
            pair = next(p for p in schedule[w-1] if slot-1 in p)
            opp = pair[1] if pair[0] == slot-1 else pair[0]
            if my_score >= scores[opp]:
                me.wins += 1
            else:
                me.losses += 1
        weekly.append({"week":w,"points":my_score,"best_roster_points":best,"capture":round(cap,3),
                       "projected":round(sum(proj.get(k,0) for k in my_lineup),2),
                       "actual_minus_projection":round(my_score-sum(proj.get(k,0) for k in my_lineup),2)})
        for k, v in actual.items():
            past_actual[k].append(v)

    # Rank regular season by actual points with record as tiebreaker. Other teams use
    # projection-based lineups from their drafted rosters; no hindsight lineups.
    reg_totals = [(i, sum(t.weekly_points[:REG_WEEKS]), t.wins) for i,t in enumerate(teams)]
    reg_totals.sort(key=lambda x:(x[2],x[1]), reverse=True)
    seed_rank = next(i+1 for i,x in enumerate(reg_totals) if x[0] == slot-1)
    made_playoffs = seed_rank <= 6

    # Approximate six-team playoff bracket using actual Week 15-17 lineup points.
    champion = False
    playoff_finish = None
    if made_playoffs:
        seeds = [x[0] for x in reg_totals[:6]]
        alive = seeds[:]
        # W15: 3v6 and 4v5, top two byes.
        w15 = {i: teams[i].weekly_points[14] for i in alive}
        q1 = seeds[2] if w15[seeds[2]] >= w15[seeds[5]] else seeds[5]
        q2 = seeds[3] if w15[seeds[3]] >= w15[seeds[4]] else seeds[4]
        # W16: seed1 gets lower remaining seed; seed2 gets the other.
        remaining = sorted([q1,q2], key=lambda i: seeds.index(i), reverse=True)
        low, high = remaining[0], remaining[1]
        w16 = {i: teams[i].weekly_points[15] for i in (seeds[0],seeds[1],low,high)}
        s1 = seeds[0] if w16[seeds[0]] >= w16[low] else low
        s2 = seeds[1] if w16[seeds[1]] >= w16[high] else high
        w17 = {i: teams[i].weekly_points[16] for i in (s1,s2)}
        champ = s1 if w17[s1] >= w17[s2] else s2
        champion = champ == slot-1
        if champion: playoff_finish = 1
        elif slot-1 in (s1,s2): playoff_finish = 2
        elif slot-1 in (seeds[0],seeds[1],low,high): playoff_finish = 4
        else: playoff_finish = 6

    mae = statistics.mean(abs(e) for e in projection_errors) if projection_errors else 0
    rmse = math.sqrt(statistics.mean(e*e for e in projection_errors)) if projection_errors else 0
    return {
        "slot":slot,"strategy":strategy,"record":f"{me.wins}-{me.losses}","wins":me.wins,
        "regular_points":round(sum(me.weekly_points[:REG_WEEKS]),2),"regular_points_rank":1+sum(1 for t in teams if sum(t.weekly_points[:REG_WEEKS])>sum(me.weekly_points[:REG_WEEKS])),
        "playoff_seed":seed_rank,"made_playoffs":made_playoffs,"champion":champion,"playoff_finish":playoff_finish,
        "avg_lineup_capture":round(statistics.mean(capture),3),"starter_projection_mae":round(mae,3),"starter_projection_rmse":round(rmse,3),
        "waivers":waiver_log,"weekly":weekly,"draft":picks,
    }


def summarize(results):
    n=len(results)
    return {
        "n":n,
        "avg_regular_points":round(statistics.mean(r["regular_points"] for r in results),2),
        "avg_wins":round(statistics.mean(r["wins"] for r in results),2),
        "playoff_rate":round(sum(r["made_playoffs"] for r in results)/n,3),
        "title_rate":round(sum(r["champion"] for r in results)/n,3),
        "avg_lineup_capture":round(statistics.mean(r["avg_lineup_capture"] for r in results),3),
        "starter_projection_mae":round(statistics.mean(r["starter_projection_mae"] for r in results),3),
    }


def main():
    outdir = Path(sys.argv[1] if len(sys.argv)>1 else "data/backtests/2025")
    outdir.mkdir(parents=True, exist_ok=True)
    adp = load_adp(); weeks = load_all_weeks()
    rng = random.Random(SEED); primary_slot = rng.randint(1, TEAMS)
    primary = play_season(adp,weeks,primary_slot,SEED,"framework")
    primary_base = play_season(adp,weeks,primary_slot,SEED,"baseline")

    # Repeated seeded replays across all draft slots to reduce one-draft luck.
    framework=[]; baseline=[]
    for i in range(120):
        slot=(i%TEAMS)+1; seed=SEED+i*101
        framework.append(play_season(adp,weeks,slot,seed,"framework"))
        baseline.append(play_season(adp,weeks,slot,seed,"baseline"))
    fs, bs = summarize(framework), summarize(baseline)
    report={
      "version":1,"season":SEASON,"league":{"teams":TEAMS,"scoring":"half-PPR","rounds":ROUNDS,"regular_season_weeks":REG_WEEKS,"playoffs":"6 teams, Weeks 15-17"},
      "leakage_policy":"No future actuals. Current-week published projections allowed. Waivers use current-week projection plus prior actuals only.",
      "gated_signals":[
        {"signal":"Vegas season/player props","status":"not backtested","reason":"No timestamped 2025 historical player-prop snapshots retained; using reconstructed closing lines would risk hindsight leakage."},
        {"signal":"referee/crew adjustment","status":"not given production weight","reason":"Needs dated weekly official assignments plus pre-2025 fitted residual model and controlled out-of-sample validation before affecting fantasy points."}
      ],
      "primary_seed":SEED,"primary_random_slot":primary_slot,"primary_framework":primary,"primary_baseline":primary_base,
      "cohort":{"framework":fs,"baseline":bs,"delta":{"regular_points":round(fs['avg_regular_points']-bs['avg_regular_points'],2),"wins":round(fs['avg_wins']-bs['avg_wins'],2),"playoff_rate":round(fs['playoff_rate']-bs['playoff_rate'],3),"title_rate":round(fs['title_rate']-bs['title_rate'],3),"lineup_capture":round(fs['avg_lineup_capture']-bs['avg_lineup_capture'],3)}},
      "interpretation_rules":["A process is not called premium from one championship run.","Prefer cohort playoff/title uplift and weekly points over a single seed.","Projection MAE and lineup-capture identify where recommendations fail even when record is lucky."]
    }
    (outdir/"report.json").write_text(json.dumps(report,indent=2))
    md=[]
    md.append("# 2025 Front Office Manager Replay")
    md.append(f"\nPrimary seeded random draft slot: **{primary_slot} of {TEAMS}** (seed `{SEED}`).")
    md.append("\n## Primary season")
    for label,r in [("Framework",primary),("Pure-ADP baseline",primary_base)]:
        md.append(f"- **{label}:** {r['record']}, {r['regular_points']:.1f} regular-season points, seed {r['playoff_seed']}, playoffs {'yes' if r['made_playoffs'] else 'no'}, title {'yes' if r['champion'] else 'no'}, lineup capture {r['avg_lineup_capture']:.1%}.")
    md.append("\n## 120-draft cohort")
    md.append(f"- Framework: {fs['avg_regular_points']:.1f} pts, {fs['avg_wins']:.2f} wins, {fs['playoff_rate']:.1%} playoffs, {fs['title_rate']:.1%} titles, {fs['avg_lineup_capture']:.1%} lineup capture.")
    md.append(f"- Baseline: {bs['avg_regular_points']:.1f} pts, {bs['avg_wins']:.2f} wins, {bs['playoff_rate']:.1%} playoffs, {bs['title_rate']:.1%} titles, {bs['avg_lineup_capture']:.1%} lineup capture.")
    md.append(f"- Uplift: {fs['avg_regular_points']-bs['avg_regular_points']:+.1f} regular-season pts, {fs['playoff_rate']-bs['playoff_rate']:+.1%} playoff rate, {fs['title_rate']-bs['title_rate']:+.1%} title rate.")
    md.append("\n## Signal gates")
    md.append("Vegas player props and referee/crew effects are intentionally **not credited** in this replay until timestamped historical inputs support a no-lookahead reconstruction. That is a feature, not a missing-data excuse: the confidence policy says unverified signals stay descriptive.")
    md.append("\n## Weekly primary replay")
    md.append("|Week|Projected|Actual|Best from roster|Capture|Actual - projection|")
    md.append("|---:|---:|---:|---:|---:|---:|")
    for w in primary['weekly']:
        md.append(f"|{w['week']}|{w['projected']:.1f}|{w['points']:.1f}|{w['best_roster_points']:.1f}|{w['capture']:.1%}|{w['actual_minus_projection']:+.1f}|")
    (outdir/"report.md").write_text("\n".join(md)+"\n")
    print(json.dumps({"primary_slot":primary_slot,"framework":fs,"baseline":bs,"delta":report['cohort']['delta']},indent=2))

if __name__ == "__main__":
    main()
