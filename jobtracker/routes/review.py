"""The Needs review queue, and what the app learns from the answers you give."""
from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse

from .. import db, learn, sync as syncmod
from ..extract import UNKNOWN_ROLE, company_key, extract_company_role, role_key
from ..models import Message
from ..recheck import recheck
from .common import EVENT_FOR_STAGE, STAGES, back, flash, plural, short
from .state import AppState, get_conn, get_state

log = logging.getLogger(__name__)
router = APIRouter()
NOTICE_LIMIT = 600
IGNORED_SHOWN = 50


def learned_from_feedback(conn: sqlite3.Connection) -> tuple[list[str], int]:
    """Turn the feedback so far into rules, then clear saved mail the new rules no longer believe."""
    rules = learn.rebuild(conn)
    return rules, recheck(conn)["cleared"] if rules else 0


def learned_notice(rules: list[str], cleared: int, prefix: str = "") -> str:
    """The `?notice=` part of the address that tells you what was learned ("" when there is nothing to say)."""
    if not rules:
        return f"?notice={quote(prefix)}" if prefix else ""
    text = (prefix + " " if prefix else "") + "Learned: " + ". ".join(rules) + "."
    if cleared:
        text += f" Also cleared {plural(cleared, 'similar email')}."
    return f"?notice={quote(short(text, NOTICE_LIMIT))}"


@router.get("/review", response_class=HTMLResponse)
def review(request: Request, conn: sqlite3.Connection = Depends(get_conn), state: AppState = Depends(get_state)):
    emails = []
    for e in conn.execute(
        "SELECT e.*, a.provider, a.address, a.can_reply FROM emails e JOIN accounts a ON a.id = e.account_id "
        "WHERE e.needs_review = 1 ORDER BY e.received_at DESC"
    ):
        msg = Message(e["provider_msg_id"], e["thread_id"] or "", "", (e["sender"] or "").split("<")[-1].rstrip(">"),
                      e["subject"] or "", datetime.now(timezone.utc), e["body"] or "")
        company, role = extract_company_role(msg)
        emails.append({**dict(e), "guess_company": company, "guess_role": role,
                       "guess_stage": db.STAGE_FOR_EVENT.get(e["event"], "Applied")})
    return state.templates.TemplateResponse(request, "review.html", {
        "emails": emails, "stages": STAGES, "learned": learn.active_rules(conn),
        "apps": conn.execute("SELECT id, company, role FROM applications ORDER BY company").fetchall(),
        "ignored": conn.execute(f"SELECT * FROM ignored_mail ORDER BY received_at DESC LIMIT {IGNORED_SHOWN}").fetchall(),
        "notice": request.query_params.get("notice"), "error": request.query_params.get("error"),
    })


@router.post("/review/{email_id}")
def resolve(email_id: int, action: str = Form(...), stage: str = Form("Applied"), app_id: int = Form(0),
            company: str = Form(""), role: str = Form(""), conn: sqlite3.Connection = Depends(get_conn)):
    email = conn.execute("SELECT * FROM emails WHERE id = ? AND needs_review = 1", (email_id,)).fetchone()
    if not email:
        raise HTTPException(404)
    if stage not in STAGES:
        raise HTTPException(400)
    with conn:
        if action == "dismiss":
            learn.record(conn, "not_job", email)          # before its content is erased
            conn.execute("UPDATE emails SET needs_review = 0, related = 0, event = NULL, subject = NULL, "
                         "body = NULL, sender = NULL, reason = NULL WHERE id = ?", (email_id,))
        elif action in ("assign", "new"):
            if action == "new":
                company, role = company.strip(), role.strip() or UNKNOWN_ROLE
                if not company:
                    raise HTTPException(400, "Company is required")
                app_id = db.create_application(conn, company, company_key(company), role, role_key(role),
                                               stage, email["received_at"])
            elif not conn.execute("SELECT 1 FROM applications WHERE id = ?", (app_id,)).fetchone():
                raise HTTPException(400)
            # Record the stage you chose, so the funnel reflects your decision.
            conn.execute("UPDATE emails SET application_id = ?, needs_review = 0, hold = 0, event = ? WHERE id = ?",
                         (app_id, EVENT_FOR_STAGE[stage], email_id))
            db.apply_event(conn, app_id, EVENT_FOR_STAGE[stage], email["received_at"])
            learn.record(conn, "job", email, app_id)
        else:
            raise HTTPException(400)
    learned_now, cleared = learned_from_feedback(conn)
    return back("/review" + learned_notice(learned_now, cleared))


@router.post("/ignored/{ignored_id}/real")
def ignored_is_real(ignored_id: int, conn: sqlite3.Connection = Depends(get_conn)):
    """You are telling it a mail it ignored was a real job email: the rule that hid it is undone, and it is read again."""
    row = conn.execute("SELECT * FROM ignored_mail WHERE id = ?", (ignored_id,)).fetchone()
    if not row:
        raise HTTPException(404)
    with conn:
        learn.record(conn, "job", {"sender": row["sender"], "subject": row["subject"], "reason": ""})
        conn.execute("DELETE FROM emails WHERE account_id = ? AND provider_msg_id = ? AND related = 0",
                     (row["account_id"], row["provider_msg_id"]))
        conn.execute("DELETE FROM ignored_mail WHERE id = ?", (ignored_id,))
    learn.rebuild(conn)             # confirming the sender switches off the rules that hid it
    name, _, address = row["sender"].partition("<")
    msg = Message(row["provider_msg_id"], row["thread_id"] or "", name.strip(), address.rstrip(">").strip(), row["subject"],
                  datetime.strptime(row["received_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc), row["body"],
                  web_link=row["web_link"], bulk=bool(row["bulk"]))
    try:
        outcome = syncmod.process_message(conn, row["account_id"], msg)
    except Exception:
        # Put the saved copy back, or the mail would be gone from the app until a sync happened to fetch it again.
        log.exception("Reading the restored email %s failed", row["provider_msg_id"])
        columns = row.keys()
        with conn:
            conn.execute(f"INSERT OR IGNORE INTO ignored_mail ({', '.join(columns)}) VALUES ({', '.join('?' * len(columns))})",
                         tuple(row))
        return flash("/review", "error", "Couldn't read that email again. It's still in the ignored list. Try again later.")
    if outcome == "ignored":
        done = "Rule undone, but this email doesn't read like a job email, so it stays ignored."
    elif outcome == "review":
        done = "Restored. It's in Needs review above. The rule that hid it is gone."
    else:
        done = "Restored and added to your applications. The rule that hid it is gone."
    return flash("/review", "notice", done)


@router.post("/learned/{rule_id}/undo")
def undo_rule(rule_id: int, conn: sqlite3.Connection = Depends(get_conn)):
    if not learn.undo(conn, rule_id):
        raise HTTPException(404)
    done = "Rule removed. New emails are judged without it. Emails it already cleared stay cleared."
    return flash("/review", "notice", done, "learned")
