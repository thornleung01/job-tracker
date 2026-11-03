import dataclasses
import sqlite3

import pytest
from fastapi.testclient import TestClient

from jobtracker import activity, db
from jobtracker.links import mailbox_link
from jobtracker.providers import outlook
from jobtracker.sync import process_message
from jobtracker.web import create_app
from tests.test_pipeline import mk


# --- links -----------------------------------------------------------------------

def test_gmail_link_uses_account_and_thread():
    label, url = mailbox_link("gmail", "me@gmail.com", "18c2f0a1b2c3d4e5", None)
    assert label == "Open in Gmail"
    assert url == "https://mail.google.com/mail/?authuser=me%40gmail.com#all/18c2f0a1b2c3d4e5"


def test_outlook_link_comes_from_the_stored_web_link():
    link = "https://outlook.live.com/owa/?ItemID=AAMk&exvsurl=1&viewmodel=ReadMessageItem"
    assert mailbox_link("outlook", "me@outlook.com", "conv", link) == ("Open in Outlook", link)


@pytest.mark.parametrize("web_link", [None, "", "javascript:alert(1)", "http://insecure.example.com/x", "data:text/html,hi"])
def test_outlook_without_a_safe_link_gives_none(web_link):
    assert mailbox_link("outlook", "me@outlook.com", "conv", web_link) is None


def test_no_link_when_nothing_to_link_to():
    assert mailbox_link("gmail", "me@gmail.com", None, None) is None
    assert mailbox_link("yahoo", "x@y.com", "t", "https://x") is None


# --- providers and storage -------------------------------------------------------

def test_outlook_parse_keeps_web_link():
    raw = {"id": "o1", "conversationId": "c1", "subject": "Interview", "from": {"emailAddress": {"name": "S", "address": "s@a.com"}},
           "receivedDateTime": "2026-10-05T14:30:00Z", "body": {"contentType": "text", "content": "hi"},
           "webLink": "https://outlook.live.com/owa/?ItemID=abc"}
    assert outlook.parse_message(raw).web_link == "https://outlook.live.com/owa/?ItemID=abc"
    del raw["webLink"]
    assert outlook.parse_message(raw).web_link is None


def test_sync_stores_the_web_link():
    conn = db.connect(":memory:")
    acct = db.upsert_account(conn, "outlook", "me@outlook.com")
    msg = dataclasses.replace(mk("1", "Thank you for applying to Acme"), web_link="https://outlook.live.com/owa/?ItemID=1")
    process_message(conn, acct, msg)
    assert conn.execute("SELECT web_link FROM emails").fetchone()[0] == "https://outlook.live.com/owa/?ItemID=1"


def test_existing_emails_table_gets_the_column(tmp_path):
    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript(
        "CREATE TABLE accounts (id INTEGER PRIMARY KEY, provider TEXT NOT NULL, address TEXT NOT NULL, last_sync TEXT, last_error TEXT);"
        "CREATE TABLE emails (id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, provider_msg_id TEXT NOT NULL, thread_id TEXT,"
        " received_at TEXT NOT NULL, sender TEXT, subject TEXT, body TEXT, related INTEGER NOT NULL DEFAULT 0, event TEXT,"
        " confidence TEXT, application_id INTEGER, needs_review INTEGER NOT NULL DEFAULT 0);"
        "INSERT INTO emails (account_id, provider_msg_id, received_at) VALUES (1, 'x', '2026-10-01T00:00:00Z');")
    old.commit(); old.close()
    conn = db.connect(path)
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(emails)")}
    assert "web_link" in cols
    assert conn.execute("SELECT web_link FROM emails").fetchone()[0] is None  # old rows keep working
    db.connect(path).close()  # and connecting again doesn't try to add it twice


# --- pages -----------------------------------------------------------------------

@pytest.fixture
def env(tmp_path):
    path = tmp_path / "t.db"
    conn = db.connect(path)
    g = db.upsert_account(conn, "gmail", "me@gmail.com")
    o = db.upsert_account(conn, "outlook", "me@outlook.com")
    process_message(conn, g, mk("g1", "Thank you for applying to Acme", "We received your application.\n<script>alert(1)</script>",
                                sender="Acme Careers <no-reply@greenhouse.io>", thread="18abc", day=1))
    process_message(conn, o, dataclasses.replace(
        mk("o1", "Thank you for applying to Initech", "Hello from Initech.", sender="Initech <no-reply@lever.co>", thread="conv9", day=2),
        web_link="https://outlook.live.com/owa/?ItemID=o1"))
    conn.commit()
    client = TestClient(create_app(path), base_url="http://127.0.0.1:8765", follow_redirects=False)
    yield conn, client
    conn.close()


def app_id(conn, company):
    return conn.execute("SELECT id FROM applications WHERE company = ?", (company,)).fetchone()[0]


def test_history_email_entries_carry_everything_needed_to_open_them(env):
    conn, _ = env
    entries, _total = activity.history(conn, app_id(conn, "Acme"))
    (email,) = entries
    assert email["kind"] == "email" and email["title"] == "Thank you for applying to Acme"
    assert "We received your application." in email["body"] and email["account"] == "Gmail me@gmail.com"
    assert email["sender"].endswith("<no-reply@greenhouse.io>") and email["open"][0] == "Open in Gmail"


def test_panel_email_expands_in_place_and_is_escaped(env):
    conn, client = env
    html = client.get(f"/app/{app_id(conn, 'Acme')}/panel").text
    assert '<details class="mail">' in html and "We received your application." in html
    assert 'class="who">Acme Careers</span>' in html and "Gmail me@gmail.com" in html
    assert "<script>alert(1)</script>" not in html and "&lt;script&gt;" in html
    assert 'href="https://mail.google.com/mail/?authuser=me%40gmail.com#all/18abc"' in html
    assert 'target="_blank" rel="noopener noreferrer"' in html


def test_outlook_email_links_to_its_stored_web_link(env):
    conn, client = env
    html = client.get(f"/app/{app_id(conn, 'Initech')}/panel").text
    assert "Open in Outlook" in html and 'href="https://outlook.live.com/owa/?ItemID=o1"' in html


def test_old_outlook_email_without_a_link_still_opens_in_app(env):
    conn, client = env
    conn.execute("UPDATE emails SET web_link = NULL WHERE provider_msg_id = 'o1'")
    conn.commit()
    html = client.get(f"/app/{app_id(conn, 'Initech')}/panel").text
    assert "Hello from Initech." in html and "Open in Outlook" not in html


def test_empty_body_and_truncated_hints(env):
    conn, client = env
    a = app_id(conn, "Acme")
    conn.execute("UPDATE emails SET body = '' WHERE provider_msg_id = 'g1'")
    conn.commit()
    assert "No text was stored for this email." in client.get(f"/app/{a}/panel").text
    conn.execute("UPDATE emails SET body = ? WHERE provider_msg_id = 'g1'", ("x" * 4096,))
    conn.commit()
    assert "Only the first part of the email is stored here." in client.get(f"/app/{a}/panel").text


def test_list_page_with_open_row_shows_the_email(env):
    conn, client = env
    html = client.get(f"/?open={app_id(conn, 'Acme')}").text
    assert '<details class="mail">' in html and "Open in Gmail" in html


def test_detail_page_timeline_links_to_the_mailbox(env):
    conn, client = env
    assert "Open in Gmail" in client.get(f"/app/{app_id(conn, 'Acme')}").text
    assert "Open in Outlook" in client.get(f"/app/{app_id(conn, 'Initech')}").text


def test_review_queue_links_to_the_mailbox(env):
    conn, client = env
    o = conn.execute("SELECT id FROM accounts WHERE provider = 'outlook'").fetchone()[0]
    process_message(conn, o, dataclasses.replace(
        mk("r1", "Re: your application", "Quick question about your CV.", sender="Sam <sam@zzz.com>", day=3),
        web_link="https://outlook.live.com/owa/?ItemID=r1"))
    conn.commit()
    page = client.get("/review").text
    assert "Quick question" in page and "Open in Outlook" in page
