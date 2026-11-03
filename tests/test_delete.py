"""Deleting an application must stick: nothing may rebuild it from its own emails."""
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from jobtracker import db
from jobtracker.models import Message
from jobtracker.recheck import recheck, settle_review
from jobtracker.sync import process_message, process_messages
from jobtracker.web import create_app


def mail(mid, subject, body, sender="Pat Lee <pat@acme.com>", day=1, thread="t1"):
    name, _, addr = sender.partition("<")
    return Message(id=mid, thread_id=thread, sender_name=name.strip(), sender_email=addr.rstrip(">"), subject=subject,
                   received_at=datetime(2026, 10, day, 12, tzinfo=timezone.utc), body=body)


@pytest.fixture
def env(tmp_path):
    path = tmp_path / "t.db"
    conn = db.connect(path)
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    conn.commit()
    process_messages(conn, acct, [
        mail("a", "Thank you for applying to Acme", "We received your application for the Analyst role.", "Acme <jobs@acme.com>", day=1),
        mail("b", "Interview times", "We would like to schedule an interview with you for the Analyst role at Acme.", day=3),
    ])
    conn.commit()
    client = TestClient(create_app(path), base_url="http://127.0.0.1:8765", follow_redirects=False)
    return conn, acct, client


def apps(conn):
    return conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0]


def test_a_deleted_application_stays_deleted_through_rechecks_and_syncs(env):
    conn, acct, client = env
    assert apps(conn) == 1
    assert client.post("/app/1/delete").status_code == 303                 # the default: clear its emails too
    assert apps(conn) == 0
    assert conn.execute("SELECT COUNT(*) FROM emails WHERE related = 1").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM emails WHERE needs_review = 1").fetchone()[0] == 0
    assert settle_review(conn) == 0 and recheck(conn)["settled"] == 0 and apps(conn) == 0
    # the emails are remembered as seen, so a later sync does not read them again either
    assert process_message(conn, acct, mail("a", "Thank you for applying to Acme", "We received your application.", "Acme <jobs@acme.com>")) == "duplicate"
    assert apps(conn) == 0


def test_emails_sent_back_to_review_are_held_and_not_re_attached_by_a_sync(env):
    conn, acct, client = env
    client.post("/app/1/delete", data={"emails": "review"})
    assert apps(conn) == 0 and conn.execute("SELECT COUNT(*) FROM emails WHERE needs_review = 1 AND hold = 1").fetchone()[0] == 2
    assert settle_review(conn) == 0 and recheck(conn)["settled"] == 0
    assert apps(conn) == 0 and conn.execute("SELECT COUNT(*) FROM emails WHERE needs_review = 1").fetchone()[0] == 2     # still waiting for you


def test_placing_a_held_email_yourself_releases_it(env):
    conn, acct, client = env
    client.post("/app/1/delete", data={"emails": "review"})
    first = conn.execute("SELECT id FROM emails ORDER BY received_at").fetchone()[0]
    client.post(f"/review/{first}", data={"action": "new", "company": "Acme", "role": "Analyst", "stage": "Applied"})
    row = conn.execute("SELECT needs_review, hold, application_id FROM emails WHERE id = ?", (first,)).fetchone()
    assert (row["needs_review"], row["hold"]) == (0, 0) and row["application_id"] is not None


def test_deleting_unlinks_jobs_you_marked_as_applied(env):
    conn, acct, client = env
    conn.execute("INSERT INTO job_postings (source, source_key, dedupe_key, title, company, status, application_id, found_at) VALUES ('t', 'k', 'd', 'Analyst', 'Acme', 'applied', 1, '2026-10-01T00:00:00Z')")
    conn.commit()
    client.post("/app/1/delete")
    row = conn.execute("SELECT status, application_id FROM job_postings").fetchone()
    assert (row["status"], row["application_id"]) == ("seen", None)


def test_a_hand_made_application_with_notes_is_deleted_too(env):
    conn, acct, client = env
    app = db.create_application(conn, "Mine", "mine", "R", "r", "Applied", "2026-10-01T00:00:00Z", manual=True)
    conn.execute("INSERT INTO activity (application_id, kind, body, occurred_at, created_at) VALUES (?, 'note', 'x', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')", (app,))
    conn.commit()
    assert client.post(f"/app/{app}/delete").status_code == 303
    assert conn.execute("SELECT COUNT(*) FROM applications WHERE id = ?", (app,)).fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM activity").fetchone()[0] == 0


def test_the_delete_buttons_are_on_both_the_page_and_the_expanded_row(env):
    conn, acct, client = env
    page = client.get("/app/1").text
    assert page.count('action="/app/1/delete"') == 2 and "Delete, keep emails for review" in page
    assert 'action="/app/1/delete"' in client.get("/app/1/panel").text


def test_bad_delete_modes_and_cross_site_posts_are_refused(env):
    conn, acct, client = env
    assert client.post("/app/1/delete", data={"emails": "everything"}).status_code == 400
    assert client.post("/app/1/delete", headers={"origin": "https://evil.example.com"}).status_code == 403
    assert apps(conn) == 1
