"""Settings: the page, appearance and sync choices, Google and Microsoft credentials, and each mail account's
connection (connecting, replying on or off, disconnecting)."""
from __future__ import annotations

import logging
import sqlite3
import threading

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse

from .. import db, settings
from ..profiles import DEFAULT_ID
from ..providers import clients
from ..recheck import recheck
from .common import PERIODS, PROVIDERS, SAVED_MESSAGES, SCAN_CHOICES, back, flash, plural, short
from .state import AppState, get_conn, get_state

log = logging.getLogger(__name__)
router = APIRouter()
PROVIDER_NAMES = {"gmail": "Gmail", "outlook": "Outlook"}
ERROR_LIMIT = 300


def _providers_view(conn: sqlite3.Connection) -> dict[str, dict]:
    """One line per provider for the Accounts section: connected, needs attention, or not connected."""
    view = {}
    for name, pretty in PROVIDER_NAMES.items():
        live = conn.execute("SELECT * FROM accounts WHERE provider = ? AND active = 1 ORDER BY id", (name,)).fetchall()
        broken = [a for a in live if a["last_error"] and not a["last_error"].startswith("Skipped")]
        if broken:
            view[name] = {"title": f"{pretty} needs attention", "detail": broken[0]["last_error"], "state": "warn"}
        elif live:
            view[name] = {"title": f"{pretty} is connected", "detail": ", ".join(a["address"] for a in live), "state": "ok"}
        else:
            view[name] = {"title": f"{pretty} isn't connected", "detail": "", "state": "none"}
    return view


@router.get("/settings", response_class=HTMLResponse)
def settings_page(request: Request, conn: sqlite3.Connection = Depends(get_conn), state: AppState = Depends(get_state)):
    params = request.query_params
    pid = request.state.profile
    notice, error = params.get("notice"), params.get("error")
    # A finished sign-in or sync is reported once, on the first page that loads after it.
    waiting, sign_in_notice, sign_in_error = state.sign_ins.take_results(pid, PROVIDERS)
    notice, error = sign_in_notice or notice, sign_in_error or error
    sync_progress, sync_notice, sync_error = state.syncs.progress_or_result(pid, flash_shown=bool(notice or error))
    notice, error = sync_notice or notice, sync_error or error
    email_counts = {r["account_id"]: r["n"] for r in conn.execute("SELECT account_id, COUNT(*) n FROM emails GROUP BY account_id")}
    return state.templates.TemplateResponse(request, "settings.html", {
        "s": settings.load(conn), "waiting": waiting, "sync_progress": sync_progress, "providers_view": _providers_view(conn),
        "pid": pid, "profile_name": state.profiles.name(pid),
        "gmail_ready": clients.gmail_ready(), "outlook_ready": clients.outlook_client_id() is not None,
        "email_counts": email_counts, "default_id": DEFAULT_ID,
        "accounts": conn.execute("SELECT * FROM accounts ORDER BY id").fetchall(),
        "themes": settings.THEMES, "accents": settings.ACCENTS, "densities": settings.DENSITIES,
        "corners": settings.CORNERS, "columns": settings.COLUMNS, "lookbacks": settings.LOOKBACKS,
        "flow_periods": PERIODS, "scan_choices": SCAN_CHOICES,
        "notice": notice, "error": error,
        "saved_msg": SAVED_MESSAGES.get(params.get("saved", "")),
    })


# -- preferences -----------------------------------------------------------------------
@router.post("/settings/appearance")
async def save_appearance(request: Request, conn: sqlite3.Connection = Depends(get_conn)):
    form = await request.form()
    values = {
        "theme": form.get("theme"), "accent": form.get("accent"), "density": form.get("density"),
        "corners": form.get("corners"), "columns": form.getlist("columns"), "flow_days": form.get("flow_days"),
    }
    await run_in_threadpool(settings.save, conn, "appearance", values)        # a database write: not on the event loop
    return back("/settings?saved=appearance")


@router.post("/settings/sync")
def save_sync(lookback_days: int = Form(30), conn: sqlite3.Connection = Depends(get_conn)):
    settings.save(conn, "sync", {"lookback_days": lookback_days})
    return back("/settings?saved=sync")


@router.post("/settings/recheck")
def recheck_saved(conn: sqlite3.Connection = Depends(get_conn)):
    # Plain `def`: re-reading every saved email runs in the thread pool, so the rest of the app stays responsive.
    r = recheck(conn)
    sentences = [f"Checked {r['checked']} saved job emails against the current rules."]
    if r["cleared"]:
        sentences.append(f"{r['cleared']} turned out to be ordinary mail, such as newsletters, and {plural(r['removed'], 'application')} "
                         f"made from them {'was' if r['removed'] == 1 else 'were'} removed.")
    else:
        sentences.append("Nothing needed to change.")
    if r["settled"]:
        sentences.append(f"Settled {plural(r['settled'], 'email')} that were waiting for review.")
    if r["roles"]:
        sentences.append(f"Filled in {plural(r['roles'], 'missing role')}.")
    return flash("/settings", "notice", " ".join(sentences), "sync")


# -- credentials -------------------------------------------------------------------------
@router.post("/settings/credentials/gmail")
async def save_gmail_credentials(request: Request):
    upload = (await request.form()).get("file")
    if not hasattr(upload, "read"):
        return flash("/settings", "error", "Choose the Google credentials file first.", "accounts")
    try:
        data = await upload.read(clients.MAX_FILE + 1)
        await run_in_threadpool(clients.save_gmail, data)
    except clients.ClientError as exc:
        return flash("/settings", "error", str(exc), "accounts")
    return flash("/settings", "notice", "Google credentials saved. You can connect Gmail now.", "accounts")


@router.post("/settings/credentials/outlook")
def save_outlook_credentials(client_id: str = Form("")):
    try:
        clients.save_outlook(client_id)
    except clients.ClientError as exc:
        return flash("/settings", "error", str(exc), "accounts")
    return flash("/settings", "notice", "Microsoft application ID saved. You can connect Outlook now.", "accounts")


# -- connecting an account ------------------------------------------------------------------
def _sign_in(state: AppState, pid: str, provider: str, send: bool) -> None:
    """The background half of connecting: the login window, then recording the account."""
    try:
        account = state.provider_for(pid)(provider, None)
        address = account.connect(send=True) if send else account.connect()
        conn = db.connect(state.profiles.db_path(pid))
        try:
            with conn:
                db.upsert_account(conn, provider, address)
                if send:       # a sign-in that included the send permission turns replying on for that account
                    conn.execute("UPDATE accounts SET can_reply = 1 WHERE provider = ? AND address = ?", (provider, address))
        finally:
            conn.close()
        tail = " Replying is on." if send else " Choose Sync now to read its mail."
        state.sign_ins.finish(pid, provider, True, f"Connected {provider.capitalize()}: {address}.{tail}")
    except Exception as exc:  # sign-in can fail in many ways; show it instead of losing it with the thread
        log.exception("Connecting %s for profile %s failed", provider, pid)
        state.sign_ins.finish(pid, provider, False, short(f"Couldn't connect {provider.capitalize()}. {exc}", ERROR_LIMIT))


def start_sign_in(request: Request, state: AppState, provider: str, send: bool = False):
    """Open the provider's login window on a background thread. `send` also asks for permission to send replies."""
    pid = request.state.profile
    ready = clients.gmail_ready() if provider == "gmail" else clients.outlook_client_id() is not None
    if not ready and not state.get_provider:
        what = "the Google credentials file" if provider == "gmail" else "the Microsoft application ID"
        return flash("/settings", "error", f"Add {what} first, then connect.", "accounts")
    if state.sign_ins.start(pid, provider):         # False: that window is already open, so don't open another
        thread = threading.Thread(target=_sign_in, args=(state, pid, provider, send), daemon=True, name=f"sign-in-{pid}-{provider}")
        request.app.state.connect_thread = thread       # tests join it
        thread.start()
    return back("/settings#accounts")


@router.post("/settings/connect/{provider}")
def connect_account(request: Request, provider: str, state: AppState = Depends(get_state)):
    if provider not in PROVIDERS:
        raise HTTPException(404)
    return start_sign_in(request, state, provider)


@router.post("/settings/reply-access/{account_id}")
def reply_access(request: Request, account_id: int, mode: str = Form(...), conn: sqlite3.Connection = Depends(get_conn),
                 state: AppState = Depends(get_state)):
    """Turn replying on (a new sign-in that also asks for permission to send) or off for an account."""
    acct = conn.execute("SELECT * FROM accounts WHERE id = ? AND active = 1", (account_id,)).fetchone()
    if not acct or mode not in ("on", "off"):
        raise HTTPException(404)
    if mode == "on":
        return start_sign_in(request, state, acct["provider"], send=True)
    with conn:
        conn.execute("UPDATE accounts SET can_reply = 0 WHERE id = ?", (account_id,))
    done = (f"Replying is off for {acct['address']}. The app won't send anything. {acct['provider'].capitalize()} still lists the "
            f"permission until you disconnect and connect again, or remove it in your account's security settings.")
    return flash("/settings", "notice", done, "accounts")


@router.post("/settings/disconnect/{account_id}")
def disconnect_account(request: Request, account_id: int, conn: sqlite3.Connection = Depends(get_conn),
                       state: AppState = Depends(get_state)):
    acct = conn.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()
    if not acct:
        raise HTTPException(404)
    address = acct["address"]
    try:
        provider = state.provider_for(request.state.profile)(acct["provider"], address)
        if hasattr(provider, "disconnect"):
            provider.disconnect()
    except Exception as exc:
        log.exception("Removing the saved login for %s failed", address)
        return flash("/settings", "error", short(f"Couldn't remove the saved login for {address}. {exc}", ERROR_LIMIT), "accounts")
    with conn:
        conn.execute("UPDATE accounts SET active = 0 WHERE id = ?", (account_id,))
    return flash("/settings", "notice", f"Disconnected {address}. Its saved emails and applications are kept.", "accounts")
