from __future__ import annotations

import re

import sqlite3
from dataclasses import dataclass

from . import db


@dataclass(frozen=True)
class Match:
    kind: str  # matched | new | ambiguous
    application_id: int | None = None


_LEVEL_WORDS = {"manager", "director", "head", "vp", "lead", "senior", "junior", "principal", "staff", "chief", "intern", "associate", "assistant"}


def _words(role: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", (role or "").casefold())


def same_role(a_key: str, b_key: str, a_role: str = "", b_role: str = "") -> bool:
    """Do these name the same job? Equal keys do. Otherwise one title must be the other, word for word, with something added on the end
    that is not a level ("Operations Manager | NAM" is "Operations Manager"; "Senior Engineering Manager" is not "Senior Engineer")."""
    if not a_key or not b_key:
        return False
    if a_key == b_key:
        return True
    a, b = _words(a_role), _words(b_role)
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    return len(short) >= 2 and long_[:len(short)] == short and not (set(long_[len(short):]) & _LEVEL_WORDS)


def find_application(
    conn: sqlite3.Connection, account_id: int, thread_id: str, ckey: str, rkey: str,
    event: str | None = None, role: str = "",
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
        same_role_apps = [a for a in apps if same_role(a["role_key"], rkey, a["role"], role)]
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
        if not rkey or not only["role_key"] or same_role(only["role_key"], rkey, only["role"], role):
            return Match("matched", only["id"])
        return Match("new")
    if len(open_apps) > 1:
        # A confirmation that names a role none of them have is a new application, not a puzzle.
        # (Same-role matches were already handled above.)
        return Match("new") if (event == "applied" and rkey) else Match("ambiguous")

    # 4. Nothing open at this company.
    return Match("new")
