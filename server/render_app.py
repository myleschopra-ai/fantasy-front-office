#!/usr/bin/env python3
"""Production entrypoint for the Yahoo adapter on Render.

Keeps OAuth tokens in Redis-backed server-side sessions instead of Flask's
client-side signed cookie session.
"""
from __future__ import annotations

import os

from flask_session import Session
from redis import Redis

from server.yahoo_oauth import app

redis_url = os.environ.get("REDIS_URL")
if not redis_url:
    raise RuntimeError("REDIS_URL is required for production Yahoo OAuth sessions")

app.config.update(
    SESSION_TYPE="redis",
    SESSION_REDIS=Redis.from_url(redis_url),
    SESSION_PERMANENT=True,
    SESSION_USE_SIGNER=True,
    SESSION_KEY_PREFIX="ffo:yahoo:",
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="None",
    PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * 30,
)
Session(app)
