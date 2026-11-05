"""What every route can reach: the app's shared state, this request's database connection and the page chrome."""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from typing import Callable, Iterator

import requests
from fastapi import Depends, Request
from fastapi.templating import Jinja2Templates

from .. import db, settings
from ..jobs import store as jobstore
from ..profiles import Profiles
from ..providers.base import Provider
from .runs import SignIns, SyncRuns

GetProvider = Callable[[str, str | None], Provider]     # (provider name, address) -> a signed-in or signing-in account
HttpGet = Callable[..., requests.Response]              # what `requests.get` is
Toast = Callable[..., None]                             # shows a desktop pop-up


@dataclass
class AppState:
    """Built once by `create_app` and kept on `app.state.ctx`. The three seams (`get_provider`, `http_get`, `toast`)
    are how tests stand in for Gmail and Outlook, the internet and Windows pop-ups."""

    profiles: Profiles
    templates: Jinja2Templates
    get_provider: GetProvider | None = None
    http_get: HttpGet | None = None
    toast: Toast | None = None
    sign_ins: SignIns = field(default_factory=SignIns)
    syncs: SyncRuns = field(default_factory=SyncRuns)

    def provider_for(self, profile_id: str) -> GetProvider:
        """The function that opens an account of this profile: `(provider name, address) -> provider`."""
        if self.get_provider:
            return self.get_provider
        from ..providers import get_provider as default_get_provider

        return lambda name, address: default_get_provider(name, address, profile=profile_id)

    def who(self, profile_id: str) -> str:
        """Which profile a pop-up is about, only when there is more than one to tell apart."""
        return self.profiles.name(profile_id) if len(self.profiles.ids()) > 1 else ""


def get_state(request: Request) -> AppState:
    return request.app.state.ctx


def get_conn(request: Request, state: AppState = Depends(get_state)) -> Iterator[sqlite3.Connection]:
    """This request's connection to the chosen profile's database. The page chrome reuses it."""
    conn = db.connect(state.profiles.db_path(request.state.profile))
    request.state.conn = conn
    try:
        yield conn
    finally:
        conn.close()


def ui_context(request: Request) -> dict:
    """Added to every page: appearance settings, the Jobs tab count, the profile picker and the CSP nonce for inline scripts."""
    state = get_state(request)
    conn = getattr(request.state, "conn", None)
    own = conn is None                  # a route without get_conn still gets its chrome
    if own:
        conn = db.connect(state.profiles.db_path(request.state.profile))
    try:
        ui = dict(settings.load(conn)["appearance"])
        jobs_new = jobstore.unseen_matches(conn)      # the number on the Jobs tab
    finally:
        if own:
            conn.close()
    light, dark = settings.ACCENTS[ui["accent"]]
    return {"ui": {**ui, "accent_light": light, "accent_dark": dark}, "jobs_new": jobs_new,
            "profiles": state.profiles.list(), "profile_id": request.state.profile,
            "csp_nonce": getattr(request.state, "csp_nonce", "")}
