from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

# JOBTRACKER_DB lets you point the app at another database, e.g. the demo one.
DEFAULT_PATH = Path(os.environ.get("JOBTRACKER_DB") or Path(__file__).resolve().parent.parent / "data" / "tracker.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY,
    provider TEXT NOT NULL,
    address TEXT NOT NULL,
    last_sync TEXT,
    last_error TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    can_reply INTEGER NOT NULL DEFAULT 0,
    UNIQUE (provider, address)
);
CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY,
    company TEXT NOT NULL,
    company_key TEXT NOT NULL,
    role TEXT NOT NULL,
    role_key TEXT NOT NULL,
    stage TEXT NOT NULL,
    stage_at TEXT,
    applied_at TEXT,
    last_activity TEXT,
    locked INTEGER NOT NULL DEFAULT 0,
    manual INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_app_company ON applications (company_key);
CREATE TABLE IF NOT EXISTS emails (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts (id),
    provider_msg_id TEXT NOT NULL,
    thread_id TEXT,
    received_at TEXT NOT NULL,
    sender TEXT,
    subject TEXT,
    body TEXT,
    related INTEGER NOT NULL DEFAULT 0,
    event TEXT,
    confidence TEXT,
    application_id INTEGER REFERENCES applications (id),
    needs_review INTEGER NOT NULL DEFAULT 0,
    web_link TEXT,
    UNIQUE (account_id, provider_msg_id)
);
CREATE INDEX IF NOT EXISTS idx_email_thread ON emails (account_id, thread_id);
CREATE INDEX IF NOT EXISTS idx_email_app ON emails (application_id);
-- Your own notes and logged steps. occurred_at is when it happened, created_at when you typed it.
CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY,
    application_id INTEGER NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('note', 'step')),
    label TEXT,
    body TEXT NOT NULL DEFAULT '',
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_app ON activity (application_id);

-- Job discovery. A posting can arrive from an alert email, a company feed, or a job search.
CREATE TABLE IF NOT EXISTS job_postings (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    source_key TEXT NOT NULL,
    dedupe_key TEXT NOT NULL,
    title TEXT NOT NULL,
    company TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    remote INTEGER NOT NULL DEFAULT 0,
    url TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    posted_at TEXT,
    found_at TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    reasons TEXT NOT NULL DEFAULT '',
    partial INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'saved', 'dismissed', 'applied')),
    notified INTEGER NOT NULL DEFAULT 0,
    application_id INTEGER REFERENCES applications (id) ON DELETE SET NULL,
    UNIQUE (source, source_key)
);
CREATE INDEX IF NOT EXISTS idx_posting_dedupe ON job_postings (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_posting_status ON job_postings (status, score);
CREATE TABLE IF NOT EXISTS job_sources (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('feed', 'adzuna')),
    name TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    last_checked TEXT,
    last_error TEXT,
    UNIQUE (kind, name)
);
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    text TEXT NOT NULL,
    posting_ids TEXT NOT NULL DEFAULT '',
    read INTEGER NOT NULL DEFAULT 0
);
-- What you told it about an email (kept after the email's own content is erased), and the rules learned from that.
CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    verdict TEXT NOT NULL CHECK (verdict IN ('not_job', 'job')),
    sender_email TEXT NOT NULL DEFAULT '',
    sender_domain TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    application_id INTEGER
);
-- Mail a learned rule ignored, kept for 30 days (sender, subject and the start of the text) so it can be restored.
CREATE TABLE IF NOT EXISTS ignored_mail (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts (id),
    provider_msg_id TEXT NOT NULL,
    thread_id TEXT,
    received_at TEXT NOT NULL,
    sender TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    web_link TEXT,
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE (account_id, provider_msg_id)
);
-- Replies sent from the app. Sent mail is never synced back, so this is also the record that shows them in the timeline.
CREATE TABLE IF NOT EXISTS sent_replies (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    account_id INTEGER NOT NULL REFERENCES accounts (id),
    application_id INTEGER REFERENCES applications (id) ON DELETE SET NULL,
    reply_to_email_id INTEGER,
    to_addr TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE
);
-- Your corrections to the people list (which is otherwise worked out from the emails each time).
CREATE TABLE IF NOT EXISTS contact_edits (
    key TEXT PRIMARY KEY,
    name TEXT,
    title TEXT,
    hidden INTEGER NOT NULL DEFAULT 0
);
-- Ids can be reused after the newest application is deleted, so what is keyed to an application goes with it.
CREATE TRIGGER IF NOT EXISTS applications_gone AFTER DELETE ON applications
BEGIN
    DELETE FROM contact_edits WHERE key LIKE OLD.id || '|%';
    UPDATE feedback SET application_id = NULL WHERE application_id = OLD.id;
END;
CREATE TABLE IF NOT EXISTS learned_rules (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('block_sender', 'block_domain', 'allow_sender', 'distrust_pattern')),
    value TEXT NOT NULL,
    evidence INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE (kind, value)
);
"""

# Progression events only move an application forward. Terminal events can land
# from any stage, but only if the email is newer than the current stage.
STAGE_FOR_EVENT = {
    "applied": "Applied",
    "heard_back": "Heard back",
    "assessment": "Assessment",
    "interview": "Interview",
    "offer": "Offer",
    "rejected": "Rejected",
}
STAGES = list(STAGE_FOR_EVENT.values())
PROGRESSION = ["Applied", "Heard back", "Assessment", "Interview"]
TERMINAL = {"Offer", "Rejected"}


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


_READY: set[str] = set()      # databases whose schema is already in place in this process


def connect(path: Path | str = DEFAULT_PATH) -> sqlite3.Connection:
    memory = str(path) == ":memory:"
    if not memory:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    # A database file that is new (or was deleted and made again) always gets its schema; one seen before is not rebuilt on every request.
    setup = memory or not Path(path).exists() or str(path) not in _READY
    # FastAPI runs sync handlers in a threadpool, so a connection can hop threads.
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    if not setup:
        return conn
    if not memory:
        conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(SCHEMA)
    # CREATE TABLE IF NOT EXISTS won't add columns to a table that already exists.
    if "web_link" not in {r["name"] for r in conn.execute("PRAGMA table_info(emails)")}:
        conn.execute("ALTER TABLE emails ADD COLUMN web_link TEXT")
    if "bulk" not in {r["name"] for r in conn.execute("PRAGMA table_info(emails)")}:
        conn.execute("ALTER TABLE emails ADD COLUMN bulk INTEGER NOT NULL DEFAULT 0")
    if "bulk" not in {r["name"] for r in conn.execute("PRAGMA table_info(ignored_mail)")}:
        conn.execute("ALTER TABLE ignored_mail ADD COLUMN bulk INTEGER NOT NULL DEFAULT 0")
    if "hold" not in {r["name"] for r in conn.execute("PRAGMA table_info(emails)")}:
        conn.execute("ALTER TABLE emails ADD COLUMN hold INTEGER NOT NULL DEFAULT 0")
    if "reason" not in {r["name"] for r in conn.execute("PRAGMA table_info(emails)")}:
        conn.execute("ALTER TABLE emails ADD COLUMN reason TEXT")
    if "active" not in {r["name"] for r in conn.execute("PRAGMA table_info(accounts)")}:
        conn.execute("ALTER TABLE accounts ADD COLUMN active INTEGER NOT NULL DEFAULT 1")
    if "can_reply" not in {r["name"] for r in conn.execute("PRAGMA table_info(accounts)")}:
        conn.execute("ALTER TABLE accounts ADD COLUMN can_reply INTEGER NOT NULL DEFAULT 0")
    if not memory:
        _READY.add(str(path))
    return conn


def upsert_account(conn: sqlite3.Connection, provider: str, address: str) -> int:
    conn.execute(
        "INSERT INTO accounts (provider, address) VALUES (?, ?) ON CONFLICT (provider, address) DO UPDATE SET active = 1, last_error = NULL, can_reply = 0",
        (provider, address),
    )
    row = conn.execute(
        "SELECT id FROM accounts WHERE provider = ? AND address = ?", (provider, address)
    ).fetchone()
    return row["id"]


def email_seen(conn: sqlite3.Connection, account_id: int, msg_id: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM emails WHERE account_id = ? AND provider_msg_id = ?",
            (account_id, msg_id),
        ).fetchone()
        is not None
    )


def thread_application(conn: sqlite3.Connection, account_id: int, thread_id: str) -> int | None:
    if not thread_id:
        return None
    row = conn.execute(
        "SELECT application_id FROM emails WHERE account_id = ? AND thread_id = ? "
        "AND application_id IS NOT NULL ORDER BY received_at DESC LIMIT 1",
        (account_id, thread_id),
    ).fetchone()
    return row["application_id"] if row else None


def create_application(
    conn: sqlite3.Connection, company: str, ckey: str, role: str, rkey: str,
    stage: str, when: str, manual: bool = False,
) -> int:
    cur = conn.execute(
        "INSERT INTO applications (company, company_key, role, role_key, stage, stage_at, "
        "applied_at, last_activity, manual) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (company, ckey, role, rkey, stage, when, when if stage == "Applied" else None, when, int(manual)),
    )
    return cur.lastrowid


def apply_event(conn: sqlite3.Connection, app_id: int, event: str, when: str) -> bool:
    """Move an application to the stage for `event`. Returns True if the stage changed."""
    app = conn.execute("SELECT * FROM applications WHERE id = ?", (app_id,)).fetchone()
    new = STAGE_FOR_EVENT[event]
    cur = app["stage"]

    fields = {"last_activity": max(when, app["last_activity"] or "")}
    if new == "Applied" and not app["applied_at"]:
        fields["applied_at"] = when
    elif new == "Applied" and when < app["applied_at"]:
        fields["applied_at"] = when

    change = False
    if not app["locked"]:
        if new in TERMINAL:
            change = new != cur and when >= (app["stage_at"] or "")
        elif cur in PROGRESSION and PROGRESSION.index(new) > PROGRESSION.index(cur):
            change = True
    if change:
        fields["stage"] = new
        fields["stage_at"] = when

    sets = ", ".join(f"{k} = ?" for k in fields)
    conn.execute(f"UPDATE applications SET {sets} WHERE id = ?", (*fields.values(), app_id))
    return change


def open_applications(conn: sqlite3.Connection, ckey: str) -> list[sqlite3.Row]:
    """Applications at a company that haven't ended in a rejection."""
    return conn.execute(
        "SELECT * FROM applications WHERE company_key = ? AND stage != 'Rejected' ORDER BY id",
        (ckey,),
    ).fetchall()


def all_applications_for(conn: sqlite3.Connection, ckey: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM applications WHERE company_key = ? ORDER BY id", (ckey,)
    ).fetchall()
