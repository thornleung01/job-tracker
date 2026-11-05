"""Fill a separate demo database with mock applications, run through the real pipeline.

    .venv\\Scripts\\python.exe scripts\\seed_demo.py            # writes data\\demo.db, replacing it if it exists
    .venv\\Scripts\\python.exe scripts\\seed_demo.py other.db  # or another file
    $env:JOBTRACKER_DB = "data\\demo.db"; .venv\\Scripts\\python.exe -m jobtracker serve

Your real data\\tracker.db is never touched: the script refuses to write to it.
"""
import argparse
import random
import sys
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from jobtracker import activity, db  # noqa: E402
from jobtracker.models import Message  # noqa: E402
from jobtracker.sync import process_messages  # noqa: E402

COMPANIES = [
    "Northwind", "Globex", "Initech", "Umbrella", "Hooli", "Stark Industries", "Wayne Enterprises", "Acme",
    "Soylent", "Cyberdyne", "Tyrell", "Wonka", "Vandelay", "Pied Piper", "Aperture", "Black Mesa",
    "Oscorp", "Massive Dynamic", "Gringotts", "Dunder Mifflin", "Sterling Cooper", "Prestige Worldwide",
    "Bluth Company", "Monsters Inc", "Los Pollos", "Nakatomi", "Weyland", "Rekall", "Duff", "Krusty Krab",
    "Planet Express", "Spacely Sprockets", "Cogswell Cogs", "Zorg Industries", "Gekko & Co", "Oceanic",
    "Buy n Large", "Virtucon", "Momcorp", "Paper Street",
]
ROLES = ["Data Analyst", "Software Engineer", "Product Analyst", "Backend Engineer", "Data Engineer", "Business Analyst"]

# Each tuple is the sequence of emails one application received, after the confirmation.
OUTCOMES = (
    [()] * 14
    + [("rejected",)] * 6
    + [("assessment", "rejected")] * 4
    + [("assessment", "interview", "rejected")] * 3
    + [("interview", "rejected")] * 2
    + [("assessment", "interview")] * 2
    + [("interview",)] * 3
    + [("heard_back",)] * 2
    + [("assessment", "interview", "offer")] * 1
    + [("interview", "offer")] * 1
)

TEXT = {
    "applied": ("Thank you for applying to {c}", "We have received your application for the {r} position at {c}."),
    "heard_back": ("A message from {c}", "Hello, thanks for your patience. We are still reviewing candidates."),
    "assessment": ("Next step: online assessment", "Please complete the online assessment within 5 days."),
    "interview": ("Interview invitation", "We'd like to schedule a call to talk with you. Please select a time that suits you."),
    "rejected": ("Update on your {c} application", "Unfortunately, we will not be moving forward with your application."),
    "offer": ("Offer of employment", "We are pleased to offer you the {r} position at {c}."),
}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Fill a demo database with mock applications.")
    ap.add_argument("output", nargs="?", type=Path, default=ROOT / "data" / "demo.db", help="the database file to (re)create")
    path = ap.parse_args(argv).output.resolve()
    if path == (ROOT / "data" / "tracker.db").resolve():
        print(f"{path} is your real database, so it will not be replaced. Choose another file.", file=sys.stderr)
        return 1
    for suffix in ("", "-wal", "-shm"):
        Path(str(path) + suffix).unlink(missing_ok=True)
    with closing(db.connect(path)) as conn:
        seed(conn)
        print(f"Wrote {path}")
        for row in conn.execute("SELECT stage, COUNT(*) n FROM applications GROUP BY stage ORDER BY n DESC"):
            print(f"  {row['stage']}: {row['n']}")
        review = conn.execute("SELECT COUNT(*) FROM emails WHERE needs_review = 1").fetchone()[0]
        print(f"  (needs review: {review})")
        roles = [r[0] for r in conn.execute("SELECT DISTINCT role FROM applications")]
        print("  roles extracted:", roles)
    return 0


def seed(conn) -> None:
    accounts = [db.upsert_account(conn, "gmail", "demo@gmail.com"), db.upsert_account(conn, "outlook", "demo@outlook.com")]

    rng = random.Random(7)
    now = datetime.now(timezone.utc)
    outcomes = OUTCOMES[: len(COMPANIES)]
    rng.shuffle(outcomes)
    batches: dict[int, list[Message]] = {a: [] for a in accounts}

    for i, (company, steps) in enumerate(zip(COMPANIES, outcomes)):
        account = accounts[i % 2]
        role = rng.choice(ROLES)
        when = now - timedelta(days=rng.randint(18, 80), hours=rng.randint(0, 20))
        for n, event in enumerate(("applied", *steps)):
            if n:
                when += timedelta(days=rng.randint(2, 10))
            if when > now - timedelta(hours=3):
                break
            subject, body = (t.format(c=company, r=role) for t in TEXT[event])
            sender = f"{company} Careers <no-reply@{'greenhouse.io' if i % 2 else 'lever.co'}>"
            name, _, addr = sender.partition("<")
            batches[account].append(Message(
                id=f"{i}-{n}", thread_id=f"thread-{i}", sender_name=name.strip(), sender_email=addr.rstrip(">"),
                subject=subject, received_at=when, body=body,
            ))
    for account, messages in batches.items():
        process_messages(conn, account, messages)

    # A few of your own notes and steps, so the expandable rows have something in them.
    ids = [r[0] for r in conn.execute("SELECT id FROM applications ORDER BY last_activity DESC LIMIT 8")]
    samples = [
        (ids[0], "Phone screen", 6, "30 min with the hiring manager. Asked about SQL and stakeholder work."),
        (ids[0], None, 0, "Send a thank-you email and the portfolio link by Friday."),
        (ids[1], "Take-home assignment", 9, "Due in 5 days. Dataset on churn, write up in a notebook."),
        (ids[1], None, 0, "Recruiter is Sam, prefers email over calls."),
        (ids[2], "Phone screen", 12, ""),
        (ids[3], None, 0, "Referral from a former colleague, mention it when following up."),
    ]
    for app_id, label, days_back, text in samples:
        if label:
            activity.add_step(conn, app_id, label, (date.today() - timedelta(days=days_back)).isoformat(), text)
        else:
            activity.add_note(conn, app_id, text)


if __name__ == "__main__":
    sys.exit(main())
