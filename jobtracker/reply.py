"""Replying to an email from inside the app.

Sending is the one thing here that leaves your PC, so every step is deliberate:
- it only works for an account you turned replying on for (a separate permission, asked for in Settings);
- the recipient is the sender of the email you are replying to, taken from the stored email, never from the form;
- senders that say they don't take replies are refused;
- a reply is only recorded after the provider accepted it, and the same form can't send twice;
- there is a cap per hour and per day, so a mistake or a stray script can't send a flood.
"""
from __future__ import annotations

import logging
import re
import sqlite3
from datetime import datetime, timedelta, timezone

from . import activity, db
from .links import _ADDRESS, _NO_REPLY
from .mailtext import split_sender
from .providers.base import NotAllowed

log = logging.getLogger(__name__)
MAX_BODY = 5000
MAX_PER_HOUR = 10
MAX_PER_DAY = 40
_TOKEN = re.compile(r"[0-9a-f]{8,64}")


class ReplyError(ValueError):
    """A message that is safe to show: what went wrong and what to do about it."""


def recipient(sender: str) -> str | None:
    """Where a reply to this sender would go, or None when they don't take replies."""
    to = split_sender(sender)[1]
    return to if _ADDRESS.fullmatch(to or "") and not _NO_REPLY.search(to.split("@")[0]) else None


def subject_for(subject: str | None) -> str:
    subject = " ".join((subject or "").split())
    return subject if re.match(r"re:", subject, re.I) else f"Re: {subject}".strip()


def target_for(conn: sqlite3.Connection, email_id: int) -> str:
    """The page a reply form was on."""
    row = conn.execute("SELECT application_id, needs_review FROM emails WHERE id = ?", (email_id,)).fetchone()
    if row and row["application_id"] and not row["needs_review"]:
        return f"/app/{row['application_id']}"
    return "/review"


def send(conn: sqlite3.Connection, get_provider, email_id: int, body: str, token: str, now: datetime | None = None) -> dict:
    """Send a reply to a stored email. Returns {"to", "duplicate"}; raises ReplyError with something to show."""
    now = now or datetime.now(timezone.utc)
    row = conn.execute(
        "SELECT e.*, a.provider, a.address, a.active, a.can_reply FROM emails e JOIN accounts a ON a.id = e.account_id "
        "WHERE e.id = ? AND e.related = 1", (email_id,)).fetchone()
    if not row:
        raise ReplyError("That email can't be found, so there is nothing to reply to.")
    if not (row["active"] and row["can_reply"]):
        raise ReplyError(f"Replying isn't turned on for {row['address']}. Turn it on in Settings, under Email accounts.")
    to = recipient(row["sender"] or "")
    if not to:
        raise ReplyError("This sender doesn't take replies.")
    body = (body or "").replace("\r\n", "\n").strip()
    if not body:
        raise ReplyError("Write something first.")
    if len(body) > MAX_BODY:
        raise ReplyError(f"Keep a reply to {MAX_BODY} characters or fewer. For a long message, use Reply in {row['provider'].capitalize()}.")
    if not _TOKEN.fullmatch(token or ""):
        raise ReplyError("That form has expired. Reload the page and try again.")
    if conn.execute("SELECT 1 FROM sent_replies WHERE token = ?", (token,)).fetchone():
        return {"to": to, "duplicate": True}                       # the same form pressed twice: it was already sent
    for window, cap, words in ((timedelta(hours=1), MAX_PER_HOUR, "hour"), (timedelta(days=1), MAX_PER_DAY, "day")):
        n = conn.execute("SELECT COUNT(*) FROM sent_replies WHERE created_at >= ?", (db.iso(now - window),)).fetchone()[0]
        if n >= cap:
            raise ReplyError(f"You've already sent {n} replies in the last {words}. This limit protects your mailbox. Try again later.")

    subject = subject_for(row["subject"])
    created = db.iso(now)
    try:        # recorded first, so a second press of the same form cannot send it again; undone if sending fails
        with conn:
            conn.execute("INSERT INTO sent_replies (created_at, account_id, application_id, reply_to_email_id, to_addr, subject, body, token) "
                         "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (created, row["account_id"], row["application_id"], email_id, to, subject, body, token))
    except sqlite3.IntegrityError:
        return {"to": to, "duplicate": True}
    try:
        get_provider(row["provider"], row["address"]).send_reply(
            thread_id=row["thread_id"] or "", message_id=row["provider_msg_id"], to=to, subject=subject, body=body)
    except NotAllowed as exc:
        _forget(conn, token)
        raise ReplyError(str(exc)) from None
    except Exception as exc:
        log.warning("Sending a reply failed: %s", exc)
        _forget(conn, token)
        raise ReplyError(f"The reply wasn't sent: {exc}") from None
    if row["application_id"]:
        with conn:
            activity._touch(conn, row["application_id"], created)
    return {"to": to, "duplicate": False}


def _forget(conn: sqlite3.Connection, token: str) -> None:
    with conn:
        conn.execute("DELETE FROM sent_replies WHERE token = ?", (token,))
