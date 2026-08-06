#!/usr/bin/env python3
"""Server-side Yahoo Fantasy OAuth and roster synchronization adapter.

This service is intentionally separate from GitHub Pages so Yahoo client secrets
and refresh tokens are never exposed to browser code. Deploy behind HTTPS with
persistent, server-side session storage before production use.
"""
from __future__ import annotations

import os
import secrets
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

import requests
from flask import Flask, jsonify, redirect, request, session
from flask_cors import CORS

AUTH_URL = "https://api.login.yahoo.com/oauth2/request_auth"
TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token"
FANTASY_URL = "https://fantasysports.yahooapis.com/fantasy/v2"

app = Flask(__name__)
app.secret_key = os.environ["YAHOO_SESSION_SECRET"]
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=os.getenv("FLASK_ENV") != "development",
    SESSION_COOKIE_SAMESITE="None",
)
CORS(
    app,
    supports_credentials=True,
    origins=[origin.strip() for origin in os.getenv(
        "DASHBOARD_ORIGIN", "https://myleschopra-ai.github.io"
    ).split(",") if origin.strip()],
)

CLIENT_ID = os.environ["YAHOO_CLIENT_ID"]
CLIENT_SECRET = os.environ["YAHOO_CLIENT_SECRET"]
REDIRECT_URI = os.environ["YAHOO_REDIRECT_URI"]


def _token_request(data: dict[str, Any]) -> dict[str, Any]:
    response = requests.post(
        TOKEN_URL,
        data=data,
        auth=(CLIENT_ID, CLIENT_SECRET),
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def _access_token() -> str:
    token = session.get("yahoo_access_token")
    if token:
        return str(token)
    refresh = session.get("yahoo_refresh_token")
    if not refresh:
        raise PermissionError("Yahoo authorization required")
    payload = _token_request({"grant_type": "refresh_token", "refresh_token": refresh})
    session["yahoo_access_token"] = payload["access_token"]
    if payload.get("refresh_token"):
        session["yahoo_refresh_token"] = payload["refresh_token"]
    return str(session["yahoo_access_token"])


def _yahoo_get(path: str) -> dict[str, Any]:
    token = _access_token()
    response = requests.get(
        f"{FANTASY_URL}/{path.lstrip('/')}",
        params={"format": "json"},
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    if response.status_code == 401 and session.get("yahoo_refresh_token"):
        session.pop("yahoo_access_token", None)
        token = _access_token()
        response = requests.get(
            f"{FANTASY_URL}/{path.lstrip('/')}",
            params={"format": "json"},
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
    response.raise_for_status()
    return response.json()


def _merge_fragments(node: Any) -> dict[str, Any]:
    """Merge Yahoo's list-of-dictionary resource fragments into one mapping."""
    merged: dict[str, Any] = {}
    if isinstance(node, dict):
        merged.update(node)
    elif isinstance(node, list):
        for item in node:
            if isinstance(item, dict):
                merged.update(item)
            elif isinstance(item, list):
                merged.update(_merge_fragments(item))
    return merged


def _resource_groups(node: Any, marker: str) -> list[dict[str, Any]]:
    """Find Yahoo resource fragment groups containing a marker such as team_key."""
    groups: list[dict[str, Any]] = []

    def visit(value: Any) -> None:
        if isinstance(value, list):
            merged = _merge_fragments(value)
            if marker in merged:
                groups.append(merged)
            for child in value:
                visit(child)
        elif isinstance(value, dict):
            if marker in value:
                groups.append(value)
            for child in value.values():
                visit(child)

    visit(node)
    deduped: dict[str, dict[str, Any]] = {}
    for group in groups:
        key = str(group.get(marker, ""))
        if key:
            deduped[key] = {**deduped.get(key, {}), **group}
    return list(deduped.values())


def _first_resource(node: Any, marker: str) -> dict[str, Any]:
    groups = _resource_groups(node, marker)
    return groups[0] if groups else {}


def _nested_value(node: Any, key: str) -> Any:
    if isinstance(node, dict):
        if key in node:
            return node[key]
        for value in node.values():
            found = _nested_value(value, key)
            if found is not None:
                return found
    elif isinstance(node, list):
        for value in node:
            found = _nested_value(value, key)
            if found is not None:
                return found
    return None


def _normalize_player(player: dict[str, Any]) -> dict[str, Any]:
    name = player.get("name") or {}
    if not isinstance(name, dict):
        name = {}
    selected_position = _nested_value(player.get("selected_position"), "position")
    eligible = player.get("eligible_positions") or []
    eligible_positions: list[str] = []
    if isinstance(eligible, list):
        for item in eligible:
            value = _nested_value(item, "position")
            if value and value not in eligible_positions:
                eligible_positions.append(str(value))
    return {
        "player_key": player.get("player_key"),
        "player_id": player.get("player_id"),
        "name": name.get("full") or " ".join(
            part for part in [name.get("first"), name.get("last")] if part
        ),
        "editorial_team_abbr": player.get("editorial_team_abbr"),
        "display_position": player.get("display_position"),
        "eligible_positions": eligible_positions,
        "selected_position": selected_position,
        "status": player.get("status"),
        "uniform_number": player.get("uniform_number"),
        "image_url": player.get("image_url"),
    }


def _normalize_team(team: dict[str, Any], roster_payload: dict[str, Any]) -> dict[str, Any]:
    players = [_normalize_player(player) for player in _resource_groups(roster_payload, "player_key")]
    managers = team.get("managers") or []
    manager_names: list[str] = []
    if isinstance(managers, (list, dict)):
        names = []
        for key in ("nickname", "guid"):
            value = _nested_value(managers, key)
            if value:
                names.append(str(value))
        manager_names = names
    logo_url = _nested_value(team.get("team_logos"), "url")
    return {
        "team_key": team.get("team_key"),
        "team_id": team.get("team_id"),
        "name": team.get("name"),
        "is_owned_by_current_login": bool(team.get("is_owned_by_current_login")),
        "managers": manager_names,
        "logo_url": logo_url,
        "waiver_priority": team.get("waiver_priority"),
        "faab_balance": team.get("faab_balance"),
        "number_of_moves": team.get("number_of_moves"),
        "number_of_trades": team.get("number_of_trades"),
        "roster": players,
    }


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "yahoo-fantasy-oauth"})


@app.get("/yahoo/status")
def yahoo_status():
    return jsonify({"authorized": bool(session.get("yahoo_refresh_token") or session.get("yahoo_access_token"))})


@app.get("/yahoo/login")
def yahoo_login():
    state = secrets.token_urlsafe(24)
    session["oauth_state"] = state
    session["league_id"] = request.args.get("league_id", "")
    session["return_to"] = request.args.get("return_to", "")
    query = urlencode(
        {
            "client_id": CLIENT_ID,
            "redirect_uri": REDIRECT_URI,
            "response_type": "code",
            "state": state,
        }
    )
    return redirect(f"{AUTH_URL}?{query}")


@app.get("/yahoo/callback")
def yahoo_callback():
    if not secrets.compare_digest(request.args.get("state", ""), session.get("oauth_state", "")):
        return jsonify({"error": "invalid OAuth state"}), 400
    code = request.args.get("code")
    if not code:
        return jsonify({"error": "missing authorization code"}), 400
    payload = _token_request(
        {
            "grant_type": "authorization_code",
            "redirect_uri": REDIRECT_URI,
            "code": code,
        }
    )
    session["yahoo_access_token"] = payload["access_token"]
    session["yahoo_refresh_token"] = payload.get("refresh_token")
    return_to = session.get("return_to")
    return redirect(return_to or "/health")


@app.get("/yahoo/league/<path:league_key>")
def yahoo_league(league_key: str):
    try:
        payload = _yahoo_get(f"league/{league_key};out=settings,standings,teams")
    except PermissionError as exc:
        return jsonify({"error": str(exc), "authorization_required": True}), 401
    return jsonify(payload)


@app.get("/yahoo/league/<path:league_key>/snapshot")
def yahoo_snapshot(league_key: str):
    """Return a browser-friendly league, teams, and roster snapshot."""
    try:
        league_payload = _yahoo_get(f"league/{league_key};out=settings,standings,teams")
    except PermissionError as exc:
        return jsonify({"error": str(exc), "authorization_required": True}), 401

    league = _first_resource(league_payload, "league_key")
    team_resources = _resource_groups(league_payload, "team_key")
    teams: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    for team in team_resources:
        team_key = str(team.get("team_key", ""))
        if not team_key:
            continue
        try:
            roster_payload = _yahoo_get(f"team/{team_key}/roster/players")
            teams.append(_normalize_team(team, roster_payload))
        except requests.RequestException as exc:
            failures.append({"team_key": team_key, "error": str(exc)})
            teams.append(_normalize_team(team, {}))

    snapshot: dict[str, Any] = {
        "provider": "yahoo",
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "league": {
            "league_key": league.get("league_key") or league_key,
            "league_id": league.get("league_id"),
            "name": league.get("name"),
            "season": league.get("season"),
            "draft_status": league.get("draft_status"),
            "scoring_type": league.get("scoring_type"),
            "num_teams": league.get("num_teams") or len(teams),
            "current_week": league.get("current_week"),
            "start_week": league.get("start_week"),
            "end_week": league.get("end_week"),
        },
        "teams": teams,
        "failures": failures,
    }
    if request.args.get("include_raw") == "1":
        snapshot["raw_league"] = league_payload
    return jsonify(snapshot)


@app.post("/yahoo/logout")
def yahoo_logout():
    for key in ["yahoo_access_token", "yahoo_refresh_token", "oauth_state", "league_id", "return_to"]:
        session.pop(key, None)
    return jsonify({"status": "disconnected"})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "8787")), debug=False)
