#!/usr/bin/env python3
"""Minimal server-side Yahoo Fantasy OAuth adapter.

This is intentionally separate from GitHub Pages so client secrets and refresh
tokens are never exposed to the browser. Deploy behind HTTPS with persistent
session storage before production use.
"""
from __future__ import annotations

import os
import secrets
from urllib.parse import urlencode

import requests
from flask import Flask, jsonify, redirect, request, session
from flask_cors import CORS

AUTH_URL = "https://api.login.yahoo.com/oauth2/request_auth"
TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token"
FANTASY_URL = "https://fantasysports.yahooapis.com/fantasy/v2"

app = Flask(__name__)
app.secret_key = os.environ["YAHOO_SESSION_SECRET"]
CORS(app, supports_credentials=True, origins=os.getenv("DASHBOARD_ORIGIN", "https://myleschopra-ai.github.io"))

CLIENT_ID = os.environ["YAHOO_CLIENT_ID"]
CLIENT_SECRET = os.environ["YAHOO_CLIENT_SECRET"]
REDIRECT_URI = os.environ["YAHOO_REDIRECT_URI"]


def _token_request(data: dict) -> dict:
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
        return token
    refresh = session.get("yahoo_refresh_token")
    if not refresh:
        raise PermissionError("Yahoo authorization required")
    payload = _token_request({"grant_type": "refresh_token", "refresh_token": refresh})
    session["yahoo_access_token"] = payload["access_token"]
    if payload.get("refresh_token"):
        session["yahoo_refresh_token"] = payload["refresh_token"]
    return session["yahoo_access_token"]


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "yahoo-fantasy-oauth"})


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


@app.get("/yahoo/league/<league_key>")
def yahoo_league(league_key: str):
    try:
        token = _access_token()
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 401
    response = requests.get(
        f"{FANTASY_URL}/league/{league_key};out=settings,standings,teams",
        params={"format": "json"},
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    response.raise_for_status()
    return jsonify(response.json())


@app.post("/yahoo/logout")
def yahoo_logout():
    for key in ["yahoo_access_token", "yahoo_refresh_token", "oauth_state", "league_id", "return_to"]:
        session.pop(key, None)
    return jsonify({"status": "disconnected"})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "8787")), debug=False)
