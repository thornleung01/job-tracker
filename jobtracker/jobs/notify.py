"""Windows notifications for new matching jobs. One summary per run, never repeats a job."""
from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone

from .. import db
from .store import load_profile


def jobs_url(profile: str | None = None) -> str:
    """The Jobs tab; with several profiles the link also says which profile to open."""
    return f"http://127.0.0.1:{os.environ.get('JOBTRACKER_PORT', '8765')}/jobs" + (f"?profile={profile}" if profile else "")


def show_toast(title: str, body: str, url: str) -> bool:
    """A Windows pop-up; clicking it opens the Jobs tab. False when this machine can't show one."""
    try:
        from windows_toasts import Toast, WindowsToaster

        toast = Toast([title, body])
        toast.launch_action = url
        WindowsToaster("Job Tracker").show_toast(toast)
        return True
    except Exception:
        return False


def summary(rows: list[sqlite3.Row]) -> tuple[str, str]:
    top = rows[0]
    at = f" at {top['company']}" if top["company"] else ""
    n = len(rows)
    title = f"{n} new job{'s' if n != 1 else ''} {'matches' if n == 1 else 'match'} your resume"
    return title, f"Top match: {top['title']}{at} ({top['score']})"


def notify_new(conn: sqlite3.Connection, toast=show_toast, profile: str | None = None, who: str = "") -> int:
    """Notify once about new postings at or above your threshold. Returns how many jobs it covered."""
    floor = load_profile(conn)["min_score"]
    rows = conn.execute(
        "SELECT * FROM job_postings WHERE status = 'new' AND notified = 0 AND score >= ? ORDER BY score DESC, id DESC", (floor,)
    ).fetchall()
    if not rows:
        return 0
    title, body = summary(rows)
    ids = [r["id"] for r in rows]
    with conn:          # recorded first, so a crash after the pop-up can't make it fire again
        conn.execute("INSERT INTO notifications (created_at, text, posting_ids) VALUES (?, ?, ?)",
                     (db.iso(datetime.now(timezone.utc)), f"{title}. {body}", ",".join(map(str, ids))))
        conn.execute(f"UPDATE job_postings SET notified = 1 WHERE id IN ({','.join('?' for _ in ids)})", ids)
    toast(f"{who}: {title}" if who else title, body, jobs_url(profile))
    return len(rows)
