import re

import pytest
from fastapi.testclient import TestClient

from jobtracker import db
from jobtracker.sync import process_message, process_messages
from jobtracker.web import create_app
from tests.test_pipeline import mk


@pytest.fixture
def env(tmp_path):
    path = tmp_path / "t.db"
    conn = db.connect(path)
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    conn.commit()
    client = TestClient(create_app(path), base_url="http://127.0.0.1:8765", follow_redirects=False)
    yield conn, acct, client
    conn.close()


def test_dashboard_lists_applications_and_counts(env):
    conn, acct, client = env
    process_messages(conn, acct, [
        mk("1", "Thank you for applying to Acme", thread="A", day=1),
        mk("2", "Thank you for applying to Initech", sender="Initech <no-reply@lever.co>", thread="B", day=2),
        mk("3", "Update", "Unfortunately we will not be moving forward with your application.",
           sender="Initech <no-reply@lever.co>", thread="B", day=5),
    ])
    html = client.get("/").text
    assert "Acme" in html and "Initech" in html
    filtered = client.get("/?stage=Rejected").text
    listed = lambda page: re.findall(r'<strong>([^<]+)</strong></a>', page)  # noqa: E731  (the table rows, not the search suggestions)
    assert listed(filtered) == ["Initech"]
    assert listed(client.get("/?q=acm").text) == ["Acme"]


def test_empty_state(env):
    _, _, client = env
    html = client.get("/").text
    assert "No applications yet" in html and "Sync your mail in Settings" in html
    assert "No applications match these filters" in client.get("/?q=zzz").text


def test_email_content_is_escaped(env):
    conn, acct, client = env
    process_message(conn, acct, mk("1", "Thank you for applying to Acme", "<script>alert(1)</script>", thread="A"))
    html = client.get("/app/1").text
    assert "<script>alert(1)</script>" not in html and "&lt;script&gt;" in html


def test_manual_stage_change_locks_and_survives_sync(env):
    conn, acct, client = env
    process_message(conn, acct, mk("1", "Thank you for applying to Acme", thread="A", day=1))
    assert client.post("/app/1/stage", data={"stage": "Interview"}).status_code == 303
    process_message(conn, acct, mk("2", "Offer", "We are pleased to offer you the role.", thread="A", day=9))
    row = conn.execute("SELECT stage, locked FROM applications").fetchone()
    assert (row["stage"], row["locked"]) == ("Interview", 1)
    client.post("/app/1/unlock")
    assert conn.execute("SELECT locked FROM applications").fetchone()[0] == 0


def test_manual_add_and_merge(env):
    conn, acct, client = env
    process_message(conn, acct, mk("1", "Thank you for applying to Acme", thread="A", day=3))
    client.post("/app/add", data={"company": "Acme Inc", "role": "Analyst", "stage": "Interview"})
    assert conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0] == 2
    client.post("/app/1/merge", data={"into": 2})
    rows = conn.execute("SELECT * FROM applications").fetchall()
    assert len(rows) == 1 and rows[0]["id"] == 2
    assert conn.execute("SELECT application_id FROM emails").fetchone()[0] == 2


def test_review_queue_assign_new_and_dismiss(env):
    conn, acct, client = env
    process_message(conn, acct, mk("1", "Thank you for applying to Acme", thread="A", day=1))
    process_message(conn, acct, mk("r1", "Re: your application", "Quick question about your CV.", sender="Sam <sam@zzz.com>", day=3))
    process_message(conn, acct, mk("r2", "Re: your application", "Another question about the role.", sender="Pat <pat@qqq.com>", day=4))
    process_message(conn, acct, mk("r3", "Re: your application", "Hello about your interview.", sender="Lee <lee@www.com>", day=5))
    assert "Quick question" in client.get("/review").text
    review_ids = [r["id"] for r in conn.execute("SELECT id FROM emails WHERE needs_review = 1 ORDER BY id")]
    assert len(review_ids) == 3

    client.post(f"/review/{review_ids[0]}", data={"action": "assign", "app_id": 1, "stage": "Heard back"})
    assert conn.execute("SELECT stage FROM applications WHERE id = 1").fetchone()[0] == "Heard back"

    client.post(f"/review/{review_ids[1]}", data={"action": "new", "company": "Qqq", "role": "Dev", "stage": "Interview"})
    assert conn.execute("SELECT stage FROM applications WHERE company = 'Qqq'").fetchone()[0] == "Interview"

    client.post(f"/review/{review_ids[2]}", data={"action": "dismiss", "stage": "Applied"})
    gone = conn.execute("SELECT * FROM emails WHERE id = ?", (review_ids[2],)).fetchone()
    assert gone["needs_review"] == 0 and gone["body"] is None and gone["related"] == 0
    assert "Nothing to review" in client.get("/review").text


def test_rejects_non_local_host_and_foreign_origin(env):
    _, _, client = env
    assert client.get("/", headers={"host": "evil.example.com"}).status_code == 403
    assert client.post("/sync", headers={"origin": "https://evil.example.com"}).status_code == 403
    assert client.post("/sync", headers={"origin": "http://127.0.0.1:8765"}).status_code == 303


def test_bad_input_is_rejected(env):
    _, _, client = env
    assert client.post("/app/add", data={"company": "X", "stage": "Bogus"}).status_code == 400
    assert client.get("/app/999").status_code == 404
