"""Export a profile's SQLite database to JSON that the hosted edition (web/) can import.

    .venv\\Scripts\\python.exe scripts\\export_json.py                      # data\\tracker.db, written to jobtracker-export.json
    .venv\\Scripts\\python.exe scripts\\export_json.py data\\other.db out.json

Then sign in to the hosted app and choose Settings > Import from the local edition. The file holds your applications,
saved emails, notes, learned rules and appearance settings. It does not hold sign-in tokens, client files, your resume or
job-search profile, or Jobs-tab data (those stay on this PC). The database is opened read-only.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FORMAT = "jobtracker-python-export"
VERSION = 1

# Tables the hosted edition keeps, in the order they are loaded (parents first).
TABLES = ["accounts", "applications", "emails", "activity", "feedback", "ignored_mail", "learned_rules", "contact_edits"]
# Local-only data that is deliberately left out.
SKIPPED = ["job_postings", "job_sources", "notifications", "sent_replies"]
# Settings sections that are copied. The "profile" section holds the resume and job-search details, so it never leaves.
SETTINGS_SECTIONS = ["appearance", "sync"]


def _exists(conn: sqlite3.Connection, table: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)).fetchone() is not None


def export(path: Path | str) -> dict:
    uri = f"file:{Path(path).resolve().as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    try:
        tables = {}
        for name in TABLES:
            tables[name] = [dict(r) for r in conn.execute(f"SELECT * FROM {name} ORDER BY 1")] if _exists(conn, name) else []
        settings = {}
        if _exists(conn, "settings"):
            for row in conn.execute("SELECT key, value FROM settings"):
                if row["key"] in SETTINGS_SECTIONS:
                    try:
                        settings[row["key"]] = json.loads(row["value"])
                    except ValueError:
                        pass
        skipped = {
            name: conn.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0] if _exists(conn, name) else 0 for name in SKIPPED
        }
    finally:
        conn.close()
    return {
        "format": FORMAT,
        "version": VERSION,
        "exportedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tables": tables,
        "settings": settings,
        "skipped": skipped,
    }


def main(argv: list[str]) -> int:
    source = Path(argv[1]) if len(argv) > 1 else ROOT / "data" / "tracker.db"
    target = Path(argv[2]) if len(argv) > 2 else Path("jobtracker-export.json")
    if not source.exists():
        print(f"No database at {source}", file=sys.stderr)
        return 1
    data = export(source)
    target.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    counts = ", ".join(f"{len(rows)} {name.replace('_', ' ')}" for name, rows in data["tables"].items() if rows)
    print(f"Wrote {target}: {counts or 'nothing'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
