"""Regression tests for the second code review, plus the share control on the Flow page."""
import re
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from jobtracker import db
from jobtracker.match import find_application
from jobtracker.providers import outlook
from jobtracker.providers.base import NotConnected
from jobtracker.sync import process_messages
from jobtracker.web import create_app
from tests.test_pipeline import mk


@pytest.fixture
def conn():
    c = db.connect(":memory:")
    yield c
    c.close()


def make_app(conn, company="Acme", role="Analyst", stage="Applied", locked=0):
    when = db.iso(datetime.now(timezone.utc) - timedelta(days=5))
    app_id = db.create_application(conn, company, company.lower(), role, role.lower().replace(" ", ""), stage, when)
    conn.execute("UPDATE applications SET locked = ? WHERE id = ?", (locked, app_id))
    conn.commit()
    return app_id


# --- a temporary database error must not lose a real email --------------------------

def test_a_database_error_leaves_the_email_to_be_retried(conn, monkeypatch):
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    conn.commit()                       # a real account exists on disk before any sync runs
    monkeypatch.setattr(db, "create_application", lambda *a, **k: (_ for _ in ()).throw(sqlite3.OperationalError("database is locked")))
    counts = process_messages(conn, acct, [mk("1", "Thank you for applying to Acme")])
    assert counts == {"retry": 1}
    assert not db.email_seen(conn, acct, "1")            # not marked as "not job mail"
    monkeypatch.undo()
    assert process_messages(conn, acct, [mk("1", "Thank you for applying to Acme")]) == {"applied-to-application": 1}


def test_an_unreadable_message_is_still_marked_seen(conn):
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    bad = mk("bad", "Thank you for applying to Acme")
    object.__setattr__(bad, "body", None)                # classification itself raises, every time
    assert process_messages(conn, acct, [bad]) == {"error": 1}
    assert db.email_seen(conn, acct, "bad")


# --- a new role at a company with several open applications -------------------------

def test_applied_email_for_a_new_role_is_a_new_application_even_with_two_open(conn):
    make_app(conn, role="Data Analyst")
    make_app(conn, role="Backend Engineer")
    assert find_application(conn, 1, "t", "acme", "productmanager", event="applied").kind == "new"
    # An update that names a role none of them have is still genuinely ambiguous.
    assert find_application(conn, 1, "t", "acme", "productmanager", event="interview").kind == "ambiguous"
    assert find_application(conn, 1, "t", "acme", "", event="applied").kind == "ambiguous"   # no role named at all
    # And a role they do have still matches it.
    assert find_application(conn, 1, "t", "acme", "backendengineer", event="applied").kind == "matched"


# --- outlook sign-in without an address ---------------------------------------------

def test_outlook_connect_without_an_address_is_a_clear_error(monkeypatch):
    provider = outlook.OutlookProvider()

    class FakeApp:
        def acquire_token_interactive(self, *a, **k):
            return {"access_token": "t", "id_token_claims": {}}
    monkeypatch.setattr(provider, "_app", lambda: FakeApp())
    with pytest.raises(NotConnected, match="email address"):
        provider.connect()


# --- web: same-origin check, merge, search ------------------------------------------

@pytest.fixture
def web(tmp_path):
    path = tmp_path / "t.db"
    c = db.connect(path)
    client = TestClient(create_app(path), base_url="http://127.0.0.1:8765", follow_redirects=False)
    yield c, client
    c.close()


def test_origin_must_match_this_server_including_the_port(web):
    _, client = web
    ok = {"origin": "http://127.0.0.1:8765"}
    assert client.post("/sync", headers=ok).status_code == 303
    for bad in ("http://127.0.0.1:9999", "http://localhost:8765", "https://evil.example.com", "null"):
        assert client.post("/sync", headers={"origin": bad}).status_code == 403, bad


def test_browser_saying_cross_site_is_refused_but_direct_requests_work(web):
    _, client = web
    assert client.post("/sync", headers={"sec-fetch-site": "cross-site"}).status_code == 403
    assert client.post("/sync", headers={"sec-fetch-site": "same-site"}).status_code == 403
    assert client.post("/sync", headers={"sec-fetch-site": "same-origin"}).status_code == 303
    assert client.post("/sync").status_code == 303                    # curl and tests send neither header


def test_merging_a_stage_you_set_by_hand_keeps_it_locked(web):
    conn, client = web
    when = db.iso(datetime.now(timezone.utc) - timedelta(days=3))
    a = make_app(conn, "Acme", stage="Offer", locked=1)
    b = make_app(conn, "Acme Inc", stage="Applied", locked=0)
    conn.execute("UPDATE applications SET stage_at = ? WHERE id = ?", (when, a))
    conn.execute("UPDATE applications SET stage_at = ? WHERE id = ?", (db.iso(datetime.now(timezone.utc)), b))  # newer, but not chosen by you
    conn.commit()
    client.post(f"/app/{a}/merge", data={"into": b})
    row = conn.execute("SELECT stage, locked FROM applications").fetchone()
    assert (row["stage"], row["locked"]) == ("Offer", 1)


def test_merging_unlocked_applications_still_takes_the_later_stage(web):
    conn, client = web
    a = make_app(conn, "Acme", stage="Interview")
    b = make_app(conn, "Acme Inc", stage="Applied")
    conn.execute("UPDATE applications SET stage_at = '2026-10-10T00:00:00Z' WHERE id = ?", (a,))
    conn.execute("UPDATE applications SET stage_at = '2026-10-01T00:00:00Z' WHERE id = ?", (b,))
    conn.commit()
    client.post(f"/app/{a}/merge", data={"into": b})
    row = conn.execute("SELECT stage, locked FROM applications").fetchone()
    assert (row["stage"], row["locked"]) == ("Interview", 0)


def test_search_treats_percent_and_underscore_literally(web):
    conn, client = web
    for company in ("Acme", "100% Remote Co", "snake_case Ltd", "Zed"):
        make_app(conn, company)
    listed = lambda page: re.findall(r'<strong>([^<]+)</strong></a>', page)  # noqa: E731
    assert listed(client.get("/?q=_").text) == ["snake_case Ltd"]                 # not "match everything"
    assert listed(client.get("/?q=100%25").text) == ["100% Remote Co"]
    assert sorted(listed(client.get("/?q=%25").text)) == ["100% Remote Co"]
    assert len(listed(client.get("/?q=a").text)) >= 2                              # ordinary searches unchanged


# --- the share control ---------------------------------------------------------------

def test_flow_page_offers_save_copy_and_share(web):
    conn, client = web
    make_app(conn, "Acme")
    html = client.get("/flow").text
    for ident in ('id="share-save"', 'id="share-copy"', 'id="share-native"', 'id="share-status"'):
        assert ident in html
    assert 'role="group" aria-label="Share this chart"' in html and 'role="status"' in html
    assert "totals only: no company names or email addresses" in html
    assert 'id="share-native" hidden' in html                   # only shown where the device can share files


def test_share_image_is_built_in_the_page_and_leaks_nothing(web):
    conn, client = web
    make_app(conn, "Acme")
    html = client.get("/flow").text
    script = html.split("// --- Share.")[1]
    assert "fontAsDataUrl('/static/fonts/Figtree-latin-wght.woff2')" in script   # the only request: a font from this app
    assert script.count("fetch(") == 1 and "XMLHttpRequest" not in script and "sendBeacon" not in script and "http" not in script.split("renderPng")[1].replace("http://www.w3.org", "")
    assert "select[name=\"days\"]" in script and "select[name=\"account\"]" not in script   # the period, never an account address
    assert "canvas.toBlob" in script and "navigator.clipboard.write" in script and "navigator.share" in script
    assert "d.getFullYear()" in script and "toISOString" not in script        # local date, so the name matches the footer


def test_share_controls_absent_without_data(web):
    _, client = web
    html = client.get("/flow").text
    assert 'id="share-save"' not in html and "No applications to chart" in html


def test_cleanups_dead_constants_and_imports(web):
    import jobtracker.config as config
    assert not hasattr(config, "DEFAULT_DAYS")
    src = open("jobtracker/providers/gmail.py", encoding="utf-8").read()
    assert "__import__" not in src and "import json" in src
