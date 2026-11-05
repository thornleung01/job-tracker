"""Sending a reply to a stored email. The rules that keep it safe are in `jobtracker/reply.py`."""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, Form, Request

from .. import reply as replymod
from .common import flash, short
from .state import AppState, get_conn, get_state

router = APIRouter()
ERROR_LIMIT = 300


@router.post("/email/{email_id}/reply")
def send_reply(request: Request, email_id: int, body: str = Form(""), token: str = Form(""),
               conn: sqlite3.Connection = Depends(get_conn), state: AppState = Depends(get_state)):
    target = replymod.target_for(conn, email_id)
    try:
        sent = replymod.send(conn, state.provider_for(request.state.profile), email_id, body, token)
    except replymod.ReplyError as exc:
        return flash(target, "reply_error" if target.startswith("/app/") else "error", short(str(exc), ERROR_LIMIT))
    done = f"Already sent to {sent['to']}." if sent["duplicate"] else f"Reply sent to {sent['to']}."
    return flash(target, "notice", done)
