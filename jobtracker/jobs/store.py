"""Saving, de-duplicating, scoring and listing job postings."""
from __future__ import annotations

import json
import sqlite3

from .. import activity, db, settings
from ..extract import UNKNOWN_COMPANY, UNKNOWN_ROLE, company_key, role_key
from .score import score_posting
from .text import dedupe_key, looks_remote, clean_title

DESCRIPTION_LIMIT = 4096
STATUSES = ("new", "seen", "saved", "dismissed", "applied")
VIEWS = {"new": ("new",), "saved": ("saved",), "applied": ("applied",), "dismissed": ("dismissed",),
         "all": ("new", "seen", "saved", "applied")}


def load_profile(conn: sqlite3.Connection) -> dict:
    return settings.load(conn)["profile"]


def profile_ready(profile: dict) -> bool:
    """Scoring needs something to compare against: target titles or skills."""
    return bool(profile.get("titles") or profile.get("skills_must") or profile.get("skills_nice"))


def add_postings(conn: sqlite3.Connection, postings: list[dict], profile: dict | None = None) -> int:
    """Save postings, skipping ones already known. Returns how many were new.

    The same job from another site (same company, title and city) is not added twice; if the copy we
    already have is only partial (from an alert email) the fuller one fills it in.
    """
    profile = profile or load_profile(conn)
    added = 0
    with conn:
        for p in postings:
            title = (p.get("title") or "").strip()
            if not title:
                continue
            p = {**p, "title": title, "company": (p.get("company") or "").strip(), "location": (p.get("location") or "").strip(),
                 "description": (p.get("description") or "")[:DESCRIPTION_LIMIT]}
            p["remote"] = bool(p.get("remote")) or looks_remote(p["location"], title)
            if conn.execute("SELECT 1 FROM job_postings WHERE source = ? AND source_key = ?", (p["source"], p["source_key"])).fetchone():
                continue
            key = dedupe_key(p["company"], title, p["location"])
            twin = conn.execute("SELECT id, partial FROM job_postings WHERE dedupe_key = ? AND company != '' ORDER BY id LIMIT 1", (key,)).fetchone() \
                if p["company"] else None
            if twin:
                if twin["partial"] and not p.get("partial"):
                    score, reasons = score_posting(profile, p)
                    conn.execute(
                        "UPDATE job_postings SET description = ?, url = COALESCE(NULLIF(?, ''), url), posted_at = COALESCE(?, posted_at), "
                        "partial = 0, score = ?, reasons = ? WHERE id = ?",
                        (p["description"], p.get("url") or "", p.get("posted_at"), score, json.dumps(reasons), twin["id"]),
                    )
                continue
            score, reasons = score_posting(profile, p)
            conn.execute(
                "INSERT INTO job_postings (source, source_key, dedupe_key, title, company, location, remote, url, description, "
                "posted_at, found_at, score, reasons, partial) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (p["source"], p["source_key"], key, title, p["company"], p["location"], int(p["remote"]), p.get("url") or "",
                 p["description"], p.get("posted_at"), db.now_iso(), score, json.dumps(reasons), int(bool(p.get("partial")))),
            )
            added += 1
    return added


def clean_titles(conn: sqlite3.Connection) -> int:
    """Tidy titles saved before alert links were cleaned ("Job Company · Place 2 connections" becomes "Job"). Returns how many changed."""
    changed = 0
    with conn:
        for r in conn.execute("SELECT id, title, company FROM job_postings WHERE company != ''").fetchall():
            tidy = clean_title(r["title"], r["company"])
            if tidy != r["title"]:
                conn.execute("UPDATE job_postings SET title = ? WHERE id = ?", (tidy, r["id"]))
                changed += 1
    return changed


def rescore_all(conn: sqlite3.Connection) -> int:
    """Recompute every score, after your profile changed."""
    profile = load_profile(conn)
    rows = conn.execute("SELECT * FROM job_postings").fetchall()
    scored = []
    for r in rows:
        score, reasons = score_posting(profile, dict(r))
        scored.append((score, json.dumps(reasons), r["id"]))
    with conn:          # one write transaction for all of them, taken after the scoring is done
        conn.executemany("UPDATE job_postings SET score = ?, reasons = ? WHERE id = ?", scored)
    return len(rows)


def list_postings(conn: sqlite3.Connection, view: str = "new", min_score: int = 0, limit: int = 200) -> list[dict]:
    statuses = VIEWS.get(view, VIEWS["new"])
    marks = ",".join("?" for _ in statuses)
    rows = conn.execute(
        f"SELECT * FROM job_postings WHERE status IN ({marks}) AND score >= ? ORDER BY score DESC, found_at DESC, id DESC LIMIT ?",
        (*statuses, min_score, limit),
    ).fetchall()
    return [dict(r, reasons=json.loads(r["reasons"] or "[]")) for r in rows]


def counts(conn: sqlite3.Connection) -> dict[str, int]:
    floor = load_profile(conn)["min_score"]
    out = {v: 0 for v in VIEWS}
    for r in conn.execute("SELECT status, score >= ? AS good, COUNT(*) n FROM job_postings GROUP BY status, good", (floor,)):
        for view, statuses in VIEWS.items():
            # "New" lists only jobs good enough to notify you about, so its count does the same.
            if r["status"] in statuses and (view != "new" or r["good"]):
                out[view] += r["n"]
    return out


def unseen_matches(conn: sqlite3.Connection) -> int:
    """New postings at or above your notify threshold: the number on the Jobs tab."""
    floor = load_profile(conn)["min_score"]
    return conn.execute("SELECT COUNT(*) FROM job_postings WHERE status = 'new' AND score >= ?", (floor,)).fetchone()[0]


def set_status(conn: sqlite3.Connection, posting_id: int, status: str) -> bool:
    if status not in STATUSES:
        raise ValueError(status)
    with conn:
        cur = conn.execute("UPDATE job_postings SET status = ? WHERE id = ?", (status, posting_id))
    return cur.rowcount > 0


def mark_applied(conn: sqlite3.Connection, posting_id: int) -> int | None:
    """You applied: create the application in the tracker, linked to the posting."""
    p = conn.execute("SELECT * FROM job_postings WHERE id = ?", (posting_id,)).fetchone()
    if not p:
        return None
    if p["application_id"]:
        return p["application_id"]
    company, role = p["company"] or UNKNOWN_COMPANY, p["title"] or UNKNOWN_ROLE
    with conn:
        app_id = db.create_application(conn, company, company_key(company), role, role_key(role), "Applied", db.now_iso(), manual=True)
        conn.execute("UPDATE job_postings SET status = 'applied', application_id = ? WHERE id = ?", (app_id, posting_id))
    if p["url"]:
        activity.add_note(conn, app_id, f"Found as a job posting: {p['url']}")
    return app_id
