"""Re-run today's rules over the job mail already stored, and undo what the rules no longer believe.

Emails the rules once took for application updates (a newsletter that said "interview") are turned back into
ordinary mail and removed from Needs review. An application is only removed when nothing you did is attached to it:
it was made by a sync, you never locked or edited its stage, and you added no notes or steps. Applications you made
or touched are never changed.
"""
from __future__ import annotations

import re
import sqlite3
from datetime import datetime, timezone

from . import db
from . import learn
from . import sync as sync_module
from .classify import classify
from .models import Message


def _message(row: sqlite3.Row) -> Message:
    name, _, address = (row["sender"] or "").partition("<")
    return Message(
        id=row["provider_msg_id"], thread_id=row["thread_id"] or "", sender_name=name.strip(),
        sender_email=(address.rstrip(">") if address else name).strip(), subject=row["subject"] or "",
        received_at=datetime.strptime(row["received_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc),
        body=row["body"] or "",
    )


def _untouched(conn: sqlite3.Connection, app_id: int | None) -> bool:
    """True when no one has edited this application: a sync made it and only a sync has moved it."""
    if app_id is None:
        return True
    app = conn.execute("SELECT manual, locked FROM applications WHERE id = ?", (app_id,)).fetchone()
    if app is None:
        return True
    notes = conn.execute("SELECT COUNT(*) FROM activity WHERE application_id = ?", (app_id,)).fetchone()[0]
    return not app["manual"] and not app["locked"] and not notes


def clear_email(conn: sqlite3.Connection, email_id: int) -> None:
    """Turn a stored job email back into ordinary mail: only its id and date are kept, as when you dismiss it."""
    conn.execute("UPDATE emails SET related = 0, needs_review = 0, event = NULL, confidence = NULL, subject = NULL, "
                 "body = NULL, sender = NULL, web_link = NULL, reason = NULL, application_id = NULL, hold = 0 WHERE id = ?", (email_id,))


def recheck(conn: sqlite3.Connection) -> dict[str, int]:
    """Returns {"checked": n, "cleared": emails turned back into ordinary mail, "removed": applications deleted}."""
    rows = conn.execute("SELECT * FROM emails WHERE related = 1").fetchall()
    learned = learn.load(conn)
    cleared, touched = [], set()
    why: dict[int, str] = {}
    for row in rows:
        cls = classify(_message(row), learned)
        if cls.related or not _untouched(conn, row["application_id"]):
            continue
        cleared.append(row["id"])
        if cls.reason.startswith("learned:"):
            why[row["id"]] = cls.reason
        if row["application_id"]:
            touched.add(row["application_id"])

    removed = 0
    with conn:
        for row in rows:
            if row["id"] in why:                       # a learned rule did this: keep it restorable for a while
                msg = _message(row)
                sync_module._remember_ignored(conn, row["account_id"], msg, row["received_at"], why[row["id"]])
                conn.execute("UPDATE ignored_mail SET thread_id = ?, web_link = ? WHERE account_id = ? AND provider_msg_id = ?",
                             (row["thread_id"], row["web_link"], row["account_id"], row["provider_msg_id"]))
        for email_id in cleared:      # the same as dismissing it in Needs review
            clear_email(conn, email_id)
        for app_id in touched:
            left = conn.execute("SELECT event, received_at FROM emails WHERE application_id = ? AND related = 1 "
                                "ORDER BY received_at", (app_id,)).fetchall()
            if not left:
                conn.execute("DELETE FROM applications WHERE id = ?", (app_id,))
                removed += 1
                continue
            # Some real mail remains: rebuild the stage from it, so a stage a newsletter pushed it to is undone.
            conn.execute("UPDATE applications SET stage = 'Applied', stage_at = NULL, applied_at = NULL, last_activity = ? WHERE id = ?",
                         (left[0]["received_at"], app_id))
            for e in left:
                if e["event"]:
                    db.apply_event(conn, app_id, e["event"], e["received_at"])
    return {"checked": len(rows), "cleared": len(cleared), "removed": removed, "settled": settle_review(conn),
            "roles": fill_missing_roles(conn)}


def settle_review(conn: sqlite3.Connection) -> int:
    """Re-judge the emails waiting in Needs review with today's rules and today's applications.

    Many were unsure when they arrived (there was no application for them yet) but belong to one now. Returns how many
    were settled; the rest stay for you.
    """
    learned = learn.load(conn)
    settled = 0
    with conn:
        for row in conn.execute("SELECT * FROM emails WHERE needs_review = 1 AND related = 1 AND hold = 0 ORDER BY received_at").fetchall():
            msg = _message(row)
            cls = classify(msg, learned)
            if not cls.related:
                continue
            app_id, needs_review = sync_module.decide(conn, row["account_id"], msg, cls, row["received_at"])
            conn.execute("UPDATE emails SET event = ?, confidence = ?, reason = ?, application_id = ?, needs_review = ? WHERE id = ?",
                         (cls.event, cls.confidence, cls.reason, app_id, int(needs_review), row["id"]))
            settled += 0 if needs_review else 1
    return settled


def fill_missing_roles(conn: sqlite3.Connection) -> int:
    """Give applications that have no role the one their saved emails name, now that the reader is better at finding it."""
    from .extract import UNKNOWN_ROLE, extract_company_role, role_key

    filled = 0
    with conn:
        for app in conn.execute("SELECT id FROM applications WHERE role_key = '' AND manual = 0").fetchall():
            for row in conn.execute("SELECT * FROM emails WHERE application_id = ? AND related = 1 ORDER BY received_at", (app["id"],)):
                _, role = extract_company_role(_message(row))
                if role != UNKNOWN_ROLE:
                    conn.execute("UPDATE applications SET role = ?, role_key = ? WHERE id = ?", (role, role_key(role), app["id"]))
                    filled += 1
                    break
    return filled
