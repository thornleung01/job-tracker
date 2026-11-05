"""Notes and dated steps you add to an application, shown alongside its emails."""
from __future__ import annotations

import sqlite3
from datetime import date, datetime

from . import db
from .links import mailbox_link, reply_link
from .models import BODY_LIMIT
from .textutil import collapse_spaces

NOTE_MAX = 2000
# What you can log as a step. The six stages move the application; the others are history only.
STEP_PRESETS = [
    "Recruiter call", "Phone screen", "Take-home assignment", "Technical interview", "Final round",
    "Reference check", "Follow-up sent", "Offer negotiation", "Withdrew application",
]
STEP_GROUPS = [("Moves the application to a stage", db.STAGES), ("Other steps", STEP_PRESETS)]
_ALLOWED_STEPS = {s.casefold(): s for s in [*db.STAGES, *STEP_PRESETS]}


class ActivityError(ValueError):
    """A user-facing validation problem, safe to show in the page."""


def _require_application(conn: sqlite3.Connection, app_id: int) -> sqlite3.Row:
    app = conn.execute("SELECT * FROM applications WHERE id = ?", (app_id,)).fetchone()
    if not app:
        raise LookupError(f"No application {app_id}")
    return app


def touch(conn: sqlite3.Connection, app_id: int, when: str) -> None:
    conn.execute(
        "UPDATE applications SET last_activity = MAX(COALESCE(last_activity, ''), ?) WHERE id = ?",
        (when, app_id),
    )


def today() -> date:
    return datetime.now().date()  # the app runs on your PC, so this is your calendar day


def _when_for(day: str | None) -> str:
    """Timestamp for a chosen day. Today means right now; earlier days count as midday UTC."""
    if not day or not day.strip():
        return db.now_iso()
    try:
        chosen = date.fromisoformat(day.strip())
    except ValueError:
        raise ActivityError("Enter the date as year-month-day, for example 2026-10-21.") from None
    if chosen > today():
        raise ActivityError("The date can't be in the future.")
    if chosen == today():
        return db.now_iso()
    return f"{chosen.isoformat()}T12:00:00Z"


def add_note(conn: sqlite3.Connection, app_id: int, body: str) -> None:
    body = (body or "").strip()
    if not body:
        raise ActivityError("Write a note first.")
    if len(body) > NOTE_MAX:
        raise ActivityError(f"Notes can be up to {NOTE_MAX} characters. This one is {len(body)}.")
    with conn:
        _require_application(conn, app_id)
        now = db.now_iso()
        conn.execute(
            "INSERT INTO activity (application_id, kind, body, occurred_at, created_at) VALUES (?, 'note', ?, ?, ?)",
            (app_id, body, now, now),
        )
        touch(conn, app_id, now)


def add_step(conn: sqlite3.Connection, app_id: int, label: str, day: str | None = None, body: str = "") -> bool:
    """Log a step from the preset list. If it is one of the stages, the application moves to it
    (when the date isn't older than the current stage). Returns True if the stage changed."""
    label = collapse_spaces(label)
    body = (body or "").strip()
    step = _ALLOWED_STEPS.get(label.casefold())
    if not step:
        raise ActivityError("Choose a step from the list.")
    if len(body) > NOTE_MAX:
        raise ActivityError(f"Notes can be up to {NOTE_MAX} characters.")
    when = _when_for(day)
    stage = step if step in db.STAGES else None
    created = db.now_iso()

    with conn:
        app = _require_application(conn, app_id)
        conn.execute(
            "INSERT INTO activity (application_id, kind, label, body, occurred_at, created_at) "
            "VALUES (?, 'step', ?, ?, ?, ?)",
            (app_id, step, body, when, created),
        )
        touch(conn, app_id, when)
        if not stage:
            return False
        if stage == "Applied" and (not app["applied_at"] or when < app["applied_at"]):
            conn.execute("UPDATE applications SET applied_at = ? WHERE id = ?", (when, app_id))
        # Your own entry can move a stage in either direction, but an older date is history only.
        # It never locks the application, so later emails can still move it forward.
        if stage != app["stage"] and when >= (app["stage_at"] or ""):
            conn.execute("UPDATE applications SET stage = ?, stage_at = ? WHERE id = ?", (stage, when, app_id))
            return True
    return False


def delete(conn: sqlite3.Connection, app_id: int, activity_id: int) -> bool:
    """Remove a note or step. A stage change it caused is not undone."""
    with conn:
        cur = conn.execute("DELETE FROM activity WHERE id = ? AND application_id = ?", (activity_id, app_id))
    return cur.rowcount > 0


def history(
    conn: sqlite3.Connection, app_id: int, limit: int = 20, include_emails: bool = True
) -> tuple[list[dict], int]:
    """Notes, steps, and (optionally) emails for one application, newest first, plus the total count."""
    items = [
        {"kind": r["kind"], "id": r["id"], "when": r["occurred_at"], "title": r["label"] or "", "body": r["body"], "detail": ""}
        for r in conn.execute("SELECT * FROM activity WHERE application_id = ?", (app_id,))
    ]
    if include_emails:
        items += [
            {"kind": "email", "id": r["id"], "when": r["received_at"], "title": r["subject"] or "(no subject)",
             "body": r["body"] or "", "detail": (r["event"] or "").replace("_", " "), "sender": r["sender"] or "",
             "account": f"{r['provider'].capitalize()} {r['address']}", "truncated": len(r["body"] or "") >= BODY_LIMIT,
             "open": mailbox_link(r["provider"], r["address"], r["thread_id"], r["web_link"]),
             "reply": reply_link(r["provider"], r["address"], r["sender"], r["subject"], r["web_link"]),
             "can_reply": bool(r["can_reply"]), "subject": r["subject"] or ""}
            for r in conn.execute(
                "SELECT e.id, e.received_at, e.subject, e.event, e.body, e.sender, e.thread_id, e.web_link, "
                "a.provider, a.address, a.can_reply FROM emails e JOIN accounts a ON a.id = e.account_id "
                "WHERE e.application_id = ? AND e.needs_review = 0",
                (app_id,),
            )
        ]
    if include_emails:      # what you sent from the app, shown among the emails it answers
        items += [
            {"kind": "sent", "id": r["id"], "when": r["created_at"], "title": r["subject"], "body": r["body"], "to": r["to_addr"], "detail": ""}
            for r in conn.execute("SELECT * FROM sent_replies WHERE application_id = ?", (app_id,))
        ]
    items.sort(key=lambda i: (i["when"], i["kind"] == "sent", i["id"]), reverse=True)
    return items[:limit], len(items)
