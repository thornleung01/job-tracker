"""Turning one email into stored data: classify it, find or make its application, and keep what is worth keeping.

Both `sync` (new mail from a provider) and `recheck` (mail already stored) need this, so it sits below them: it depends
only on `db`, `learn`, `classify`, `extract`, `match` and the job-alert reader.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone

from . import db, learn
from .classify import Classification, classify
from .extract import UNKNOWN_COMPANY, company_key, extract_company_role, role_key
from .jobs import alerts
from .jobs import store as jobstore
from .match import find_application
from .models import BODY_LIMIT, Message

# What `process_message` returns, and the two extras `sync.process_messages` adds when it can't finish a message.
DUPLICATE, JOB_ALERT, IGNORED, APPLIED, REVIEW = "duplicate", "job-alert", "ignored", "applied-to-application", "review"
RETRY, ERROR = "retry", "error"

IGNORED_KEEP_DAYS = 30


def remember_unrelated(conn: sqlite3.Connection, account_id: int, msg_id: str, when: str) -> None:
    """Keep only the ID and date so the email isn't fetched or reprocessed."""
    conn.execute(
        "INSERT INTO emails (account_id, provider_msg_id, received_at, related) VALUES (?, ?, ?, 0)",
        (account_id, msg_id, when),
    )


def remember_ignored(conn: sqlite3.Connection, account_id: int, msg: Message, when: str, reason: str) -> None:
    """Mail a learned rule ignored stays restorable for a while: you can say "this was a real job"."""
    conn.execute(
        "INSERT OR IGNORE INTO ignored_mail (account_id, provider_msg_id, thread_id, received_at, sender, subject, body, web_link, reason, created_at, bulk) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (account_id, msg.id, msg.thread_id, when, f"{msg.sender_name} <{msg.sender_email}>", msg.subject, msg.body[:BODY_LIMIT],
         msg.web_link, reason, db.now_iso(), int(msg.bulk)),
    )
    cutoff = db.iso(datetime.now(timezone.utc) - timedelta(days=IGNORED_KEEP_DAYS))
    conn.execute("DELETE FROM ignored_mail WHERE created_at < ?", (cutoff,))


def fill_role(conn: sqlite3.Connection, app_id: int, role: str, rkey: str) -> None:
    """If an application was created without a role, adopt one once an email names it."""
    if not rkey:
        return
    conn.execute(
        "UPDATE applications SET role = ?, role_key = ? WHERE id = ? AND role_key = ''",
        (role, rkey, app_id),
    )


def decide(conn: sqlite3.Connection, account_id: int, msg: Message, cls: Classification, when: str) -> tuple[int | None, bool]:
    """Find or make the application a job email belongs to. Returns (application id or None, needs a human look)."""
    company, role = extract_company_role(msg)
    ckey, rkey = company_key(company), role_key(role)

    match = find_application(conn, account_id, msg.thread_id, ckey, rkey, event=cls.event, role=role)
    needs_review = cls.confidence == "low" or match.kind == "ambiguous"
    # Weak wording is fine when the mail clearly belongs to a conversation already being followed (same thread, or the
    # one open application at that company): a "heard back" can only add to what is known, never invent anything.
    if cls.confidence == "low" and match.kind == "matched" and cls.event == "heard_back":
        needs_review = False
    if needs_review:
        return None, True

    if match.kind == "matched":
        app_id = match.application_id
        fill_role(conn, app_id, role, rkey)
    elif company == UNKNOWN_COMPANY or (cls.event != "applied" and cls.confidence != "high"):
        # "Interview" or "offer" somewhere in the text, with no application to attach it to: you decide.
        return None, True
    else:
        app_id = db.create_application(conn, company, ckey, role, rkey, db.STAGE_FOR_EVENT[cls.event], when)
    db.apply_event(conn, app_id, cls.event, when)
    return app_id, False


def process_message(conn: sqlite3.Connection, account_id: int, msg: Message, learned: learn.Learned | None = None) -> str:
    """Classify one email and update applications. Safe to re-run on the same email.

    Returns: duplicate | job-alert | ignored | applied-to-application | review
    """
    if db.email_seen(conn, account_id, msg.id):
        return DUPLICATE

    when = db.iso(msg.received_at)
    if alerts.alert_site(msg):
        # A LinkedIn/Indeed job alert: its postings go to the Jobs tab, and it never becomes an application.
        jobstore.add_postings(conn, alerts.parse(msg))
        with conn:
            remember_unrelated(conn, account_id, msg.id, when)
        return JOB_ALERT
    cls = classify(msg, learned if learned is not None else learn.load(conn))

    with conn:
        if not cls.related:
            remember_unrelated(conn, account_id, msg.id, when)
            if cls.reason.startswith("learned:"):
                remember_ignored(conn, account_id, msg, when, cls.reason)
            return IGNORED

        app_id, needs_review = decide(conn, account_id, msg, cls, when)

        conn.execute(
            "INSERT INTO emails (account_id, provider_msg_id, thread_id, received_at, sender, "
            "subject, body, related, event, confidence, application_id, needs_review, web_link, reason, bulk) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)",
            (
                account_id, msg.id, msg.thread_id, when,
                f"{msg.sender_name} <{msg.sender_email}>", msg.subject, msg.body[:BODY_LIMIT],
                cls.event, cls.confidence, app_id, int(needs_review), msg.web_link, cls.reason, int(msg.bulk),
            ),
        )
    return REVIEW if needs_review else APPLIED
