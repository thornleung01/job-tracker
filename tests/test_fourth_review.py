"""Regression tests for the fourth code review."""
import re
import sqlite3
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from jobtracker import contacts, db, mailtext
from jobtracker.jobs import score
from jobtracker.match import same_role
from jobtracker.models import Message
from jobtracker.recheck import recheck, settle_review
from jobtracker.sync import process_message, process_messages
from jobtracker.web import create_app


@pytest.fixture
def env(tmp_path):
    path = tmp_path / "t.db"
    conn = db.connect(path)
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    conn.commit()
    client = TestClient(create_app(path), base_url="http://127.0.0.1:8765", follow_redirects=False)

    class E:
        pass
    e = E()
    e.conn, e.acct, e.client, e.path = conn, acct, client, path
    return e


def mail(mid="m1", subject="Hello", body="", sender="Pat Lee <pat@acme.com>", day=1, bulk=False):
    name, _, addr = sender.partition("<")
    return Message(id=mid, thread_id=mid, sender_name=name.strip(), sender_email=addr.rstrip(">"), subject=subject,
                   received_at=datetime(2026, 10, day, 12, tzinfo=timezone.utc), body=body, bulk=bulk)


# --- a broken link in an email does not break the page ----------------------------------------------------------------

@pytest.mark.parametrize("text", ["Apply at http://[abc now", "see https://[::1 and http://[bad]x/ done", "http://[", "https://exa mple.com/[x"])
def test_malformed_links_render_instead_of_raising(text):
    assert "<script" not in str(mailtext.render(text))
    mailtext.parts(text)


def test_an_application_page_with_a_malformed_link_still_opens(env):
    app = db.create_application(env.conn, "Acme", "acme", "Analyst", "analyst", "Applied", "2026-10-01T00:00:00Z")
    env.conn.execute("INSERT INTO emails (account_id, provider_msg_id, thread_id, received_at, sender, subject, body, related, event, confidence, application_id) "
                     "VALUES (?, 'x', 't', '2026-10-02T00:00:00Z', 'Pat Lee <pat@acme.com>', 'Hi', 'Apply at http://[abc now', 1, 'applied', 'high', ?)", (env.acct, app))
    env.conn.commit()
    assert env.client.get(f"/app/{app}").status_code == 200 and env.client.get(f"/app/{app}/panel").status_code == 200 and env.client.get("/contacts").status_code == 200


# --- merging keeps replies, feedback and contact corrections ----------------------------------------------------------

def test_merging_moves_sent_replies_feedback_and_contact_edits_to_the_target(env):
    a = db.create_application(env.conn, "Acme", "acme", "Analyst", "analyst", "Applied", "2026-10-01T00:00:00Z")
    b = db.create_application(env.conn, "Acme", "acme", "Analyst II", "analystii", "Applied", "2026-10-02T00:00:00Z")
    env.conn.execute("INSERT INTO sent_replies (created_at, account_id, application_id, to_addr, subject, body, token) VALUES ('2026-10-03T00:00:00Z', ?, ?, 'pat@acme.com', 's', 'b', 'aaaaaaaaaaaaaaaa')", (env.acct, a))
    env.conn.execute("INSERT INTO feedback (created_at, verdict, sender_email, application_id) VALUES ('2026-10-03T00:00:00Z', 'job', 'pat@acme.com', ?)", (a,))
    env.conn.execute("INSERT INTO contact_edits (key, name, title, hidden) VALUES (?, 'Pat Lee', 'Hiring Manager', 0)", (f"{a}|pat@acme.com",))
    env.conn.execute("INSERT INTO contact_edits (key, name, title, hidden) VALUES (?, 'Pat Lee', 'Target Title', 0)", (f"{b}|pat@acme.com",))     # the target already has one
    env.conn.execute("INSERT INTO contact_edits (key, name, title, hidden) VALUES (?, NULL, NULL, 1)", (f"{a}|sam@acme.com",))
    env.conn.commit()
    assert env.client.post(f"/app/{a}/merge", data={"into": b}).status_code == 303
    assert env.conn.execute("SELECT application_id FROM sent_replies").fetchone()[0] == b
    assert env.conn.execute("SELECT application_id FROM feedback").fetchone()[0] == b
    edits = {r["key"]: (r["title"], r["hidden"]) for r in env.conn.execute("SELECT * FROM contact_edits")}
    assert edits == {f"{b}|pat@acme.com": ("Target Title", 0), f"{b}|sam@acme.com": (None, 1)}


# --- a reused application id inherits nothing --------------------------------------------------------------------------

def test_deleting_an_application_removes_what_was_keyed_to_it_so_a_reused_id_starts_clean(env):
    app = db.create_application(env.conn, "Acme", "acme", "Analyst", "analyst", "Applied", "2026-10-01T00:00:00Z")
    env.conn.execute("INSERT INTO contact_edits (key, name, title, hidden) VALUES (?, 'Pat', 'Hiring Manager', 1)", (f"{app}|pat@acme.com",))
    env.conn.execute("INSERT INTO feedback (created_at, verdict, sender_email, application_id) VALUES ('2026-10-03T00:00:00Z', 'job', 'pat@acme.com', ?)", (app,))
    env.conn.commit()
    assert env.client.post(f"/app/{app}/delete").status_code == 303
    assert env.conn.execute("SELECT COUNT(*) FROM contact_edits").fetchone()[0] == 0
    assert env.conn.execute("SELECT application_id FROM feedback").fetchone()[0] is None
    again = db.create_application(env.conn, "Globex", "globex", "Analyst", "analyst", "Applied", "2026-10-05T00:00:00Z")
    assert again == app                                            # SQLite reuses the freed id, so the clean-up matters
    env.conn.commit()
    assert env.conn.execute("SELECT COUNT(*) FROM contact_edits WHERE key LIKE ?", (f"{again}|%",)).fetchone()[0] == 0


# --- the newsletter flag survives re-checking ----------------------------------------------------------------------------

NEWSLETTER = "We would like to schedule an interview with you for the analyst role at Acme."


def test_a_newsletter_flagged_by_its_headers_is_not_promoted_by_a_later_recheck(env):
    msg = mail("n1", "Next steps", NEWSLETTER, "Acme News <news@acme.com>", bulk=True)
    assert process_message(env.conn, env.acct, msg) == "ignored"
    env.conn.execute("UPDATE emails SET related = 1, needs_review = 1, event = 'interview', confidence = 'medium', subject = 'Next steps', body = ?, "
                     "sender = 'Acme News <news@acme.com>', bulk = 1", (NEWSLETTER,))
    env.conn.commit()
    assert settle_review(env.conn) == 0                              # still judged as bulk mail, so it stays out of the applications
    assert env.conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0] == 0
    assert recheck(env.conn)["cleared"] == 1                         # and a re-check turns it back into ordinary mail


def test_the_flag_is_stored_with_the_email(env):
    process_message(env.conn, env.acct, mail("b1", "Interview invitation", NEWSLETTER, "Pat Lee <pat@acme.com>", bulk=False))
    assert env.conn.execute("SELECT bulk FROM emails WHERE provider_msg_id = 'b1'").fetchone()[0] == 0


# --- bad input does not become a 500 or a silent penalty --------------------------------------------------------------------

@pytest.mark.parametrize("value", ["²", "٣", "1,²", "-1", "9" * 30, "<script>", ""])
def test_a_bad_open_value_is_ignored(env, value):
    assert env.client.get("/", params={"open": value}).status_code == 200


@pytest.mark.parametrize("word", ["日本語", "++", "!!!", "   ", "…"])
def test_an_exclude_word_with_nothing_to_match_penalises_nothing(word):
    profile = {"titles": ["Data Analyst"], "skills_must": ["SQL"], "skills_nice": [], "cities": ["Toronto"], "remote": True,
               "exclude": [word], "seniority": "", "min_score": 65}
    posting = {"title": "Data Analyst", "company": "Acme", "location": "Toronto", "remote": False, "description": "SQL and Python",
               "posted_at": None, "partial": False}
    baseline = score.score_posting({**profile, "exclude": []}, posting)
    assert score.score_posting(profile, posting) == baseline


# --- roles are compared word by word ----------------------------------------------------------------------------------------

@pytest.mark.parametrize("a,b,same", [
    ("Operations Manager", "Operations Manager | NAM", True),
    ("Senior Associate, New Verticals", "Senior Associate, New Verticals - Canada Strategy & Operations", True),
    ("Senior Engineer", "Senior Engineering Manager", False),
    ("Engineer", "Engineer Manager", False),
    ("Data Analyst", "Data Analyst Lead", False),
    ("Product Manager", "Product", False),
    ("Data Analyst", "Data Analyst", True),
])
def test_roles_match_only_when_one_is_the_other_with_something_added(a, b, same):
    def key(r):
        return re.sub(r"[^a-z]", "", r.casefold())
    assert same_role(key(a), key(b), a, b) is same and same_role(key(b), key(a), b, a) is same


# --- a permanent database error is not retried forever -----------------------------------------------------------------------

def test_only_a_locked_database_is_retried(env, monkeypatch):
    def locked(*a, **k):
        raise sqlite3.OperationalError("database is locked")

    def broken(*a, **k):
        raise sqlite3.IntegrityError("UNIQUE constraint failed")

    from jobtracker import sync as sync_module
    monkeypatch.setattr(sync_module, "process_message", locked)
    assert process_messages(env.conn, env.acct, [mail("l1")]) == {"retry": 1}
    monkeypatch.setattr(sync_module, "process_message", broken)
    assert process_messages(env.conn, env.acct, [mail("p1")]) == {"error": 1}
    assert db.email_seen(env.conn, env.acct, "p1") and not db.email_seen(env.conn, env.acct, "l1")      # the permanent one is not read again


# --- work is not repeated ------------------------------------------------------------------------------------------------------

def test_the_schema_is_built_once_per_database_and_again_for_a_new_file(tmp_path):
    path = tmp_path / "x.db"
    first = db.connect(path)
    first.execute("DROP TABLE contact_edits")
    first.commit()
    second = db.connect(path)
    assert second.execute("SELECT name FROM sqlite_master WHERE name = 'contact_edits'").fetchone() is None       # not rebuilt on every connection
    first.close()
    second.close()
    for suffix in ("", "-wal", "-shm"):
        (tmp_path / f"x.db{suffix}").unlink(missing_ok=True)
    third = db.connect(path)                                                                                        # a recreated file gets its schema
    assert third.execute("SELECT name FROM sqlite_master WHERE name = 'contact_edits'").fetchone() is not None


def test_the_application_page_works_out_its_people_once(env, monkeypatch):
    app = db.create_application(env.conn, "Acme", "acme", "Analyst", "analyst", "Applied", "2026-10-01T00:00:00Z")
    env.conn.commit()
    calls = []
    real = contacts.derive
    monkeypatch.setattr(contacts, "derive", lambda *a, **k: calls.append(a) or real(*a, **k))
    assert env.client.get(f"/app/{app}").status_code == 200
    assert len(calls) == 1
