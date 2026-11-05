"""Export a profile's SQLite database to JSON that the hosted edition (web/) can import.

    .venv\\Scripts\\python.exe scripts\\export_json.py                      # data\\tracker.db, written to data\\jobtracker-export.json
    .venv\\Scripts\\python.exe scripts\\export_json.py data\\other.db out.json

Then log in to the hosted app and choose Settings, Your data, Import data (it asks you to confirm before it replaces what is there). The file holds your applications,
saved emails, notes, learned rules and appearance settings. It does not hold login tokens, client files, your resume or
job-search profile, or Jobs-tab data (those stay on this PC). The database is opened read-only. The default output is
in data\\, which git ignores, because the file holds your email text and contact details.
"""
from __future__ import annotations

import argparse
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
    uri = Path(path).resolve().as_uri() + "?mode=ro"      # as_uri percent-encodes ? # % in the path
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


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Export a profile's database to JSON for the hosted edition's import.")
    ap.add_argument("source", nargs="?", type=Path, default=ROOT / "data" / "tracker.db", help="the database (default data/tracker.db)")
    ap.add_argument("target", nargs="?", type=Path, default=ROOT / "data" / "jobtracker-export.json", help="the JSON file to write")
    args = ap.parse_args(argv)
    if not args.source.exists():
        print(f"No database at {args.source}", file=sys.stderr)
        return 1
    data = export(args.source)
    args.target.parent.mkdir(parents=True, exist_ok=True)
    args.target.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    counts = ", ".join(f"{len(rows)} {name.replace('_', ' ')}" for name, rows in data["tables"].items() if rows)
    print(f"Wrote {args.target}: {counts or 'nothing'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
