from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from . import db


@dataclass(frozen=True)
class Match:
    kind: str  # matched | new | ambiguous
    application_id: int | None = None


def same_role(a: str, b: str) -> bool:
    """Role keys that name the same job: equal, or one is the other with a team or place added on."""
    return bool(a and b) and (a == b or (min(len(a), len(b)) >= 8 and (a in b or b in a)))


def find_application(
    conn: sqlite3.Connection, account_id: int, thread_id: str, ckey: str, rkey: str,
    event: str | None = None,
) -> Match:
    # 1. Same email thread.
    app_id = db.thread_application(conn, account_id, thread_id)
    if app_id:
        return Match("matched", app_id)

    if not ckey:
        return Match("ambiguous")

    # 2. Same company and role.
    apps = db.all_applications_for(conn, ckey)
    # A fresh "applied" mail after a rejection or offer is a re-application.
    closed = ("Rejected", "Offer") if event == "applied" else ("Rejected",)
    if rkey:
        same_role_apps = [a for a in apps if same_role(a["role_key"], rkey)]
        if event == "applied":
            live = [a for a in same_role_apps if a["stage"] not in closed]
            if same_role_apps and not live:
                return Match("new")
            same_role_apps = live
        if same_role_apps:
            return Match("matched", same_role_apps[-1]["id"])

    # 3. Same company, exactly one open application.
    open_apps = [a for a in apps if a["stage"] not in closed]
    if len(open_apps) == 1:
        only = open_apps[0]
        # A named role that differs from the open application's role is a different job.
        if not rkey or not only["role_key"] or same_role(only["role_key"], rkey):
            return Match("matched", only["id"])
        return Match("new")
    if len(open_apps) > 1:
        # A confirmation that names a role none of them have is a new application, not a puzzle.
        # (Same-role matches were already handled above.)
        return Match("new") if (event == "applied" and rkey) else Match("ambiguous")

    # 4. Nothing open at this company.
    return Match("new")
