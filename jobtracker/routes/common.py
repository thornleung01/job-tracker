"""Constants and small helpers the route modules share."""
from __future__ import annotations

import re
import sqlite3
from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import HTTPException
from fastapi.responses import RedirectResponse, Response

from .. import activity, contacts as contactsmod, db, settings

STAGES = db.STAGES
EVENT_FOR_STAGE = {v: k for k, v in db.STAGE_FOR_EVENT.items()}
PERIODS = [(days, "All time" if days == 0 else f"Last {days} days") for days in settings.FLOW_PERIODS]
SCAN_CHOICES = [(0, "New emails since last sync"), *PERIODS[1:]]
SAVED_MESSAGES = {"appearance": "Appearance settings saved.", "sync": "Sync settings saved."}
PROVIDERS = ("gmail", "outlook")
PROFILE_COOKIE = "jt_profile"
PROFILE_COOKIE_MAX_AGE = 3600 * 24 * 365
PANEL_HISTORY = 20      # entries the list's expanded panel shows before "show more"


def short(text: str, limit: int = 400) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def plural(n: int, noun: str) -> str:
    return f"{n} {noun}" + ("" if n == 1 else "s")


def now_iso() -> str:
    return db.iso(datetime.now(timezone.utc))


def days_since(iso: str | None) -> int | None:
    if not iso:
        return None
    then = datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - then).days


def clean(text: str, limit: int) -> str:
    """Collapse runs of whitespace, trim, and cap the length."""
    return re.sub(r"\s+", " ", text).strip()[:limit]


# -- redirects -------------------------------------------------------------------------
def back(url: str = "/") -> RedirectResponse:
    """Every action answers with a redirect (303), so a refresh never posts the form again."""
    return RedirectResponse(url, status_code=303)


def flash_url(path: str, kind: str, message: str, anchor: str = "") -> str:
    """`path` with a message for the page to show: kind is "notice" or "error"."""
    return f"{path}?{kind}={quote(message)}" + (f"#{anchor}" if anchor else "")


def flash(path: str, kind: str, message: str, anchor: str = "") -> RedirectResponse:
    return back(flash_url(path, kind, message, anchor))


def local_path(url: str, default: str = "/") -> str:
    """`url` if it is a path on this app, else `default`: never another site (not `//host`, not a backslash trick)."""
    ok = url.startswith("/") and not url.startswith("//") and "\\" not in url and url.isprintable()
    return url if ok else default


def set_profile_cookie(response: Response, profile_id: str) -> None:
    response.set_cookie(PROFILE_COOKIE, profile_id, httponly=True, samesite="lax", max_age=PROFILE_COOKIE_MAX_AGE)


# -- list and panel data -------------------------------------------------------------------
def stage_counts(conn: sqlite3.Connection) -> dict[str, int]:
    counts = {s: 0 for s in STAGES}
    for r in conn.execute("SELECT stage, COUNT(*) n FROM applications GROUP BY stage"):
        counts[r["stage"]] = r["n"]
    return counts


def panel_ctx(conn: sqlite3.Connection, app_id: int, *, error: str | None = None, form: dict | None = None, swaps: bool = False,
              include_emails: bool = True, status: str | None = None, titles: dict | None = None) -> dict:
    """Everything _panel.html needs. `swaps` adds the hidden elements that refresh the list row in place."""
    a = conn.execute("SELECT * FROM applications WHERE id = ?", (app_id,)).fetchone()
    if not a:
        raise HTTPException(404)
    items, total = activity.history(conn, app_id, PANEL_HISTORY, include_emails)
    n_emails = conn.execute("SELECT COUNT(*) FROM emails WHERE application_id = ?", (app_id,)).fetchone()[0]
    return {
        "a": a,
        "r": dict(a, idle_days=days_since(a["last_activity"]), n_emails=n_emails),
        "entries": items,
        "total": total,
        "error": error,
        "form": form or {},
        "today": activity.today().isoformat(),
        "swaps": swaps,
        "counts": stage_counts(conn) if swaps else None,
        "include_emails": include_emails,
        "status": status,
        "step_groups": activity.STEP_GROUPS,
        "latest_email": next((i["id"] for i in items if i["kind"] == "email"), None),
        "titles": contactsmod.titles(conn, app_id) if titles is None else titles,
    }
