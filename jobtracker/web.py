"""The local web app: `create_app()` builds it and `jobtracker/routes/` holds the pages (see routes/__init__.py).

This module is the composition root and the one guard every request passes through:

- Host and origin checks keep other web pages out. A page you have open in your browser cannot read the app (the Host
  must be 127.0.0.1, localhost or ::1, which stops DNS rebinding) and cannot post to it (a POST must come from this
  app's own origin and not from another site).
- Security headers go on every response: no framing, a Content-Security-Policy, no content sniffing, no referrer.
- The profile cookie says which profile a page is for.

This is browser protection only. The server is for this user on this machine: it listens on 127.0.0.1, has no login,
and a program that sends no Origin or Sec-Fetch-Site header (curl, a script, another user's process on a shared
computer) passes the guard like the browser does. Run it on a computer only you use (see SETUP.md).
"""
from __future__ import annotations

import secrets
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from . import db, joblink, links, mailtext
from .jobs import resume
from .jobs_web import register as register_jobs
from .profiles import DEFAULT_ID, Profiles
from .routes import accounts, applications, flow, people, profiles as profile_routes, reply, review, syncing
from .routes.common import PROFILE_COOKIE, set_profile_cookie
from .routes.state import AppState, get_conn, ui_context

LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
TEMPLATE_DIR = str(Path(__file__).with_name("templates"))
STATIC_DIR = str(Path(__file__).with_name("static"))
# The biggest request the app accepts: the largest upload (a resume) plus room for the rest of the form.
# Checked from Content-Length, before the body is read, so an oversized upload is refused without being stored.
MAX_REQUEST_BYTES = resume.MAX_UPLOAD + 256 * 1024


def content_security_policy(nonce: str) -> str:
    """What a page may load and run. Everything comes from this app. Inline scripts run only with this response's
    nonce (`<script nonce="{{ csp_nonce }}">`), and there are no inline event handlers (`onclick=` and the like are
    blocked). Inline styles are allowed because pages set `style="..."` in many places and CSS cannot run code or
    leave the page: every way out (scripts, images, fonts, fetches, forms) is limited to this app."""
    return "; ".join([
        "default-src 'self'",
        f"script-src 'self' 'nonce-{nonce}'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",             # data: for the page icon and the icons drawn by the stylesheet
        "font-src 'self' data:",            # data: for the chart's saved image, which carries its own font
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ])


def _from_this_app(request: Request) -> bool:
    """False when the browser says the request came from another site. Browsers send Sec-Fetch-Site; other callers don't."""
    return request.headers.get("sec-fetch-site", "same-origin") in ("same-origin", "none")


def _refusal(request: Request) -> Response | None:
    """The response to send instead of handling the request, or None when it may go ahead."""
    if request.url.hostname not in LOCAL_HOSTS:
        return HTMLResponse("Forbidden", status_code=403)
    if request.method == "POST":
        # The page must be this app itself: same host AND port (another local app on a different port
        # is a different origin), and the browser must not say the request came from another site.
        origin = request.headers.get("origin")
        if origin and urlparse(origin).netloc != request.headers.get("host", ""):
            return HTMLResponse("Forbidden", status_code=403)
        if not _from_this_app(request):
            return HTMLResponse("Forbidden", status_code=403)
        length = request.headers.get("content-length", "")
        if length.isdigit() and int(length) > MAX_REQUEST_BYTES:
            return HTMLResponse("That upload is too large.", status_code=413)
    return None


def _harden(response: Response, nonce: str) -> None:
    response.headers["Content-Security-Policy"] = content_security_policy(nonce)
    response.headers["X-Frame-Options"] = "DENY"            # for browsers that predate frame-ancestors
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"


def _build_templates() -> Jinja2Templates:
    templates = Jinja2Templates(directory=TEMPLATE_DIR, context_processors=[ui_context])
    env = templates.env
    env.globals["mailbox_link"] = links.mailbox_link
    env.globals["reply_link"] = links.reply_link
    env.globals["new_token"] = lambda: secrets.token_hex(8)       # one per reply form, so pressing Send twice sends once
    env.filters["posting_url"] = joblink.stored_url     # re-checked at render: only a plain http(s) address becomes a link
    env.filters["mailtext"] = mailtext.render
    env.filters["sender_name"] = lambda s: mailtext.split_sender(s)[0]
    env.filters["sender_addr"] = lambda s: mailtext.split_sender(s)[1]
    return templates


def create_app(db_path=db.DEFAULT_PATH, get_provider=None, http_get=None, toast=None, secrets_dir=None) -> FastAPI:
    """`get_provider`, `http_get` and `toast` let tests stand in for Gmail and Outlook, the internet and Windows pop-ups."""
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    state = AppState(Profiles(Path(db_path).parent, db_path, secrets_dir), _build_templates(), get_provider, http_get, toast)
    profiles = state.profiles
    app.state.ctx = state
    app.state.connect_thread = None       # the latest sign-in and sync threads, for tests to wait on
    app.state.sync_thread = None
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")   # self-hosted fonts

    @app.middleware("http")
    async def local_only(request: Request, call_next):
        request.state.csp_nonce = nonce = secrets.token_urlsafe(16)       # new for every response
        response = _refusal(request)
        if response is None:
            # Which profile this page is for: a link from a pop-up (?profile=), else the one chosen last, else the first.
            # A link on another site cannot switch it: the pop-up's link is opened by you, which reads as "none".
            requested = request.query_params.get("profile") if request.method == "GET" and _from_this_app(request) else None
            cookie = request.cookies.get(PROFILE_COOKIE)
            request.state.profile = next((p for p in (requested, cookie) if profiles.exists(p)), DEFAULT_ID)
            response = await call_next(request)
            if requested and profiles.exists(requested) and cookie != requested:
                set_profile_cookie(response, requested)
        _harden(response, nonce)
        return response

    for module in (applications, review, people, flow, accounts, reply, profile_routes, syncing):
        app.include_router(module.router)
    register_jobs(app, state.templates, get_conn, http_get, toast, state.who)
    return app
