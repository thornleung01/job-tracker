"""One pass of job discovery: company feeds, Adzuna, then a notification for what's new."""
from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timedelta, timezone

import requests

from .. import db
from . import adzuna, feeds, notify, store

log = logging.getLogger(__name__)
FEED_INTERVAL = timedelta(minutes=50)


def _mark(conn: sqlite3.Connection, source_id: int, error: str | None) -> None:
    with conn:
        conn.execute("UPDATE job_sources SET last_checked = ?, last_error = ? WHERE id = ?",
                     (db.now_iso(), error, source_id))


def _recent(last_checked: str | None, now: datetime) -> bool:
    return bool(last_checked) and now - db.parse_iso(last_checked) < FEED_INTERVAL


def run_discovery(conn: sqlite3.Connection, force: bool = False, get=requests.get, toast=notify.show_toast,
                  owner: str = "default", who: str = "", only: int | None = None) -> dict:
    """Never raises: each source reports its own error on the Sources tab.

    `only=<source id>` checks just that company feed (what adding a company needs), and leaves the others and Adzuna alone.
    """
    store.clean_titles(conn)
    profile = store.load_profile(conn)
    result = {"feeds": 0, "adzuna": 0, "notified": 0, "skipped": ""}
    if not store.profile_ready(profile):
        result["skipped"] = "Add your resume or some skills first, so jobs can be matched."
        return result
    now = datetime.now(timezone.utc)

    for src in conn.execute("SELECT * FROM job_sources WHERE kind = 'feed' ORDER BY id").fetchall():
        if only is not None and src["id"] != only:
            continue
        if not force and _recent(src["last_checked"], now):
            continue
        try:
            cfg = json.loads(src["config"])
            found = feeds.fetch(cfg["platform"], cfg["token"], cfg["company"], get)
            result["feeds"] += store.add_postings(conn, found, profile)
            _mark(conn, src["id"], None)
        except feeds.SourceError as exc:
            _mark(conn, src["id"], str(exc))
        except Exception:
            log.exception("Couldn't read the job list of source %s", src["id"])
            _mark(conn, src["id"], "Couldn't read this company's job list. It will be tried again next time.")

    creds = None if only is not None else adzuna.load_credentials(owner)
    row = conn.execute("SELECT * FROM job_sources WHERE kind = 'adzuna'").fetchone()
    if creds and row and (force or adzuna.due(row["last_checked"], now)):
        error = None
        try:
            for what, where, country in adzuna.queries(profile):
                result["adzuna"] += store.add_postings(conn, adzuna.search(creds, what, where, country, get), profile)
        except PermissionError as exc:
            error = str(exc)
        except requests.RequestException:
            error = "Couldn't reach Adzuna. Will try again next time."
        except Exception:
            log.exception("Adzuna answered with something unexpected")
            error = "Adzuna sent something unexpected. Will try again next time."
        _mark(conn, row["id"], error)

    result["notified"] = notify.notify_new(conn, toast, owner if who else None, who)
    return result
