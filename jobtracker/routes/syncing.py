"""The sync button: starting a sync on a background thread, and the progress the page polls."""
from __future__ import annotations

import logging
import threading

import requests
from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import JSONResponse

from .. import db
from ..jobs import notify as jobnotify
from ..jobs.run import run_discovery
from ..sync import sync_all
from .common import SCAN_CHOICES, back, plural, short
from .state import AppState, get_state

log = logging.getLogger(__name__)
router = APIRouter()
MESSAGE_LIMIT = 300


def _summary(results: dict, jobs: dict) -> tuple[str, bool]:
    """The sentence a finished sync leaves behind, and whether any account failed."""
    if not results:
        return "No accounts are connected yet. Connect Gmail or Outlook first.", True
    lines = []
    for label, outcome in results.items():
        address = label.split(":", 1)[-1]
        if isinstance(outcome, str):
            lines.append(f"Sync failed for {address} ({outcome.removeprefix('error: ')}).")
        else:
            lines.append(f"Checked {plural(sum(v for k, v in outcome.items() if k != 'duplicate'), 'new email')} for {address}.")
    found = jobs["feeds"] + jobs["adzuna"]
    if found:
        lines.append(f"Found {plural(found, 'new job')} to look at.")
    return short(" ".join(lines)), any(isinstance(v, str) for v in results.values())


def _run_sync(state: AppState, pid: str, scan: int) -> None:
    """Runs on its own thread so the page can show a progress bar while it works."""
    def report(**fields):
        state.syncs.report(pid, **fields)

    message, failed = "", False
    conn = db.connect(state.profiles.db_path(pid))
    try:
        results = sync_all(conn, scan or None, get_provider=state.provider_for(pid), progress=report)
        report(phase="jobs", done=0, total=None, note="")
        jobs = run_discovery(conn, get=state.http_get or requests.get, toast=state.toast or jobnotify.show_toast,   # company feeds, Adzuna, pop-up
                             owner=pid, who=state.who(pid))
        message, failed = _summary(results, jobs)
    except Exception as exc:  # whatever goes wrong is shown, not lost with the thread
        log.exception("Sync for profile %s failed", pid)
        message, failed = short(f"Sync failed. {exc}", MESSAGE_LIMIT), True
    finally:
        conn.close()
        state.syncs.finish(pid, message, failed)


@router.post("/sync")
def sync(request: Request, scan: int = Form(0), state: AppState = Depends(get_state)):
    if scan not in {v for v, _ in SCAN_CHOICES}:
        raise HTTPException(400)
    pid = request.state.profile
    if state.syncs.start(pid):          # already syncing: nothing to start, the page shows its progress
        thread = threading.Thread(target=_run_sync, args=(state, pid, scan), daemon=True, name=f"sync-{pid}")
        request.app.state.sync_thread = thread       # tests join it
        thread.start()
    return back("/settings#sync")


@router.get("/sync/status")
def sync_status(request: Request, state: AppState = Depends(get_state)):
    return JSONResponse(state.syncs.view(request.state.profile), headers={"Cache-Control": "no-store"})
