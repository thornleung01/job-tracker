"""The numbers behind the Statistics page: how many applications reached each stage, and the paths between stages."""
from __future__ import annotations

import sqlite3
from collections import Counter
from datetime import datetime, timedelta, timezone

from . import db

# Sankey columns, in vertical order within each column.
COLUMN = {
    "Applied": 0,
    "Heard back": 1,
    "No response yet": 1,
    "Assessment": 2,
    "Interview": 3,
    "Offer": 4,
    "Rejected": 4,
    "Still open": 4,
}


def application_path(current_stage: str, event_stages: set[str]) -> list[str]:
    """The stages one application passed through, ending at its outcome.

    Built from every stage an email showed plus the current stage, so a manual
    correction and a review-queue decision both count. Any reply at all implies
    "Heard back"; Assessment and Interview are only included if actually reached.
    """
    reached = set(event_stages) | {current_stage}
    responded = bool(reached - {"Applied"})
    path = ["Applied"]
    if responded:
        path.append("Heard back")
    path += [s for s in ("Assessment", "Interview") if s in reached]
    if current_stage in db.TERMINAL:
        path.append(current_stage)
    else:
        path.append("Still open" if responded else "No response yet")
    return path


def sankey(conn: sqlite3.Connection, account: int = 0, days: int = 0) -> dict:
    where, params = [], []
    if account:
        where.append("EXISTS (SELECT 1 FROM emails e WHERE e.application_id = a.id AND e.account_id = ?)")
        params.append(account)
    if days:
        cutoff = db.iso(datetime.now(timezone.utc) - timedelta(days=days))
        where.append("COALESCE(a.applied_at, a.last_activity) >= ?")
        params.append(cutoff)
    sql = "SELECT a.id, a.stage FROM applications a" + (" WHERE " + " AND ".join(where) if where else "")
    apps = conn.execute(sql, params).fetchall()

    seen: dict[int, set[str]] = {}
    for r in conn.execute(
        "SELECT application_id, event FROM emails "
        "WHERE application_id IS NOT NULL AND needs_review = 0 AND event IS NOT NULL"
    ):
        seen.setdefault(r["application_id"], set()).add(db.STAGE_FOR_EVENT[r["event"]])
    # Steps you logged that name a stage count too. Custom labels (e.g. "Phone screen") don't.
    for r in conn.execute("SELECT application_id, label FROM activity WHERE kind = 'step'"):
        if r["label"] in db.STAGES:
            seen.setdefault(r["application_id"], set()).add(r["label"])

    node_counts: Counter[str] = Counter()
    link_counts: Counter[tuple[str, str]] = Counter()
    for a in apps:
        path = application_path(a["stage"], seen.get(a["id"], set()))
        node_counts.update(path)
        link_counts.update(zip(path, path[1:]))

    total = len(apps)
    pct = (lambda n: round(100 * n / total)) if total else (lambda n: 0)
    nodes = [
        {"id": name, "col": COLUMN[name], "value": node_counts[name], "pct": pct(node_counts[name])}
        for name in COLUMN
        if node_counts[name]
    ]
    order = list(COLUMN)
    links = [
        {"source": s, "target": t, "value": v, "pct": pct(v)}
        for (s, t), v in sorted(link_counts.items(), key=lambda kv: (order.index(kv[0][0]), order.index(kv[0][1])))
    ]
    return {
        "total": total,
        "nodes": nodes,
        "links": links,
        "heard_back": node_counts["Heard back"],
        "interviews": node_counts["Interview"],
        "offers": node_counts["Offer"],
        "rejected": node_counts["Rejected"],
    }
