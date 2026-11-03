import base64
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from jobtracker import db
from jobtracker.classify import classify
from jobtracker.extract import UNKNOWN_COMPANY, UNKNOWN_ROLE, company_key, extract_company_role, role_key
from jobtracker.match import Match, find_application
from jobtracker.providers import gmail, outlook
from jobtracker.web import create_app
from tests.test_classify import mk


# --- 1. SQLite connections can be used across threads -------------------------

def test_concurrent_requests_do_not_hit_sqlite_thread_errors(tmp_path):
    path = tmp_path / "t.db"
    db.connect(path).close()
    client = TestClient(create_app(path), base_url="http://127.0.0.1:8765")
    with ThreadPoolExecutor(max_workers=8) as pool:
        codes = list(pool.map(lambda _: client.get("/").status_code, range(30)))
    assert codes == [200] * 30


def test_connection_is_usable_from_another_thread(tmp_path):
    conn = db.connect(tmp_path / "t.db")
    with ThreadPoolExecutor(max_workers=1) as pool:
        assert pool.submit(lambda: conn.execute("SELECT 1").fetchone()[0]).result() == 1
    conn.close()


# --- 2. Negated offers are rejections ------------------------------------------

@pytest.mark.parametrize(
    "body",
    [
        "We regret to inform you that we are not able to extend an offer.",
        "After careful review we are unable to extend you an offer for the Data Analyst position.",
        "Unfortunately, we cannot offer you the role at this time.",
        "We will not be extending an offer to you for this position.",
        "Unfortunately we are not in a position to offer you the job.",
    ],
)
def test_negated_offer_is_a_rejection(body):
    r = classify(mk("Your application", body))
    assert r.related and r.event == "rejected", r.reason


def test_negated_offer_without_other_job_words_is_still_related():
    r = classify(mk("Update", "We regret to inform you that we are not able to extend an offer."))
    assert r.related and r.event == "rejected"


@pytest.mark.parametrize(
    "subject,body",
    [
        ("Offer of employment", "We are pleased to offer you the Data Analyst position at Acme."),
        ("Your offer letter", "Attached is your offer letter for the role."),
        ("Congratulations", "We are delighted to extend an offer for the role. If you do not accept this offer by Friday it lapses."),
    ],
)
def test_real_offers_still_offers(subject, body):
    assert classify(mk(subject, body)).event == "offer"


# --- 3. Role extraction needs an introducing phrase ----------------------------

def test_role_from_subject_with_leading_words():
    m = mk("Your interview for the Backend Engineer role at Acme")
    assert extract_company_role(m) == ("Acme", "Backend Engineer")


def test_role_from_body_sentence_without_fragment():
    m = mk("Update", "Unfortunately we are unable to extend an offer for the Backend Engineer position at Acme.")
    assert extract_company_role(m) == ("Acme", "Backend Engineer")


def test_implausible_role_is_unknown_not_truncated():
    long_role = "Senior Principal Staff Distinguished Lead Associate Vice President of Engineering Operations"
    m = mk("Hello", f"Thanks for applying for the {long_role} position at Acme.")
    assert extract_company_role(m)[1] == UNKNOWN_ROLE
    m = mk("Hello", "Thank you, we loved meeting you for the sake of this you position at Acme.")
    assert extract_company_role(m)[1] == UNKNOWN_ROLE


@pytest.mark.parametrize("intro", ["for the", "for a", "for an", "as a", "as an", "to the"])
def test_role_introducers(intro):
    m = mk("Hello", f"Our notes {intro} Data Engineer role at Acme are attached.")
    assert extract_company_role(m)[1] == "Data Engineer"


# --- 4. Sender company: domain beats a person's display name -------------------

@pytest.mark.parametrize(
    "sender,expected",
    [
        ("Jane Smith <jane@acme.com>", "Acme"),
        ("Jane Smith <jane@jobs.acme.co.uk>", "Acme"),
        ("Acme Careers <jobs@acme.com>", "Acme"),
        ("Stark Industries Recruiting <hr@stark.com>", "Stark Industries"),
        ("Acme Careers <no-reply@greenhouse.io>", "Acme"),
        ("Jane Smith <jane@lever.co>", "Jane Smith"),
        ("Jane Smith <jane@gmail.com>", UNKNOWN_COMPANY),
        ("Globex Recruiting <jobs@gmail.com>", "Globex"),
        ("<someone@gmail.com>", UNKNOWN_COMPANY),
    ],
)
def test_sender_company(sender, expected):
    assert extract_company_role(mk("Hello", sender=sender))[0] == expected


# --- 5. Re-applications start a new application --------------------------------

@pytest.fixture
def conn():
    c = db.connect(":memory:")
    yield c
    c.close()


def _app(conn, stage, company="Acme", role="Data Analyst", when="2026-10-01T00:00:00Z"):
    return db.create_application(conn, company, company_key(company), role, role_key(role), stage, when)


@pytest.mark.parametrize("stage", ["Rejected", "Offer"])
def test_applied_after_closed_same_role_is_new(conn, stage):
    _app(conn, stage)
    ck, rk = company_key("Acme"), role_key("Data Analyst")
    assert find_application(conn, 1, "t", ck, rk, event="applied") == Match("new")
    # Other events keep matching the old application.
    assert find_application(conn, 1, "t", ck, rk, event="interview").kind == "matched"
    assert find_application(conn, 1, "t", ck, rk).kind == "matched"


def test_applied_still_matches_open_same_role(conn):
    _app(conn, "Rejected")
    live = _app(conn, "Applied", when="2026-10-09T00:00:00Z")
    m = find_application(conn, 1, "t", company_key("Acme"), role_key("Data Analyst"), event="applied")
    assert m == Match("matched", live)


def test_thread_match_wins_over_reapplication(conn):
    app_id = _app(conn, "Rejected")
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    conn.execute(
        "INSERT INTO emails (account_id, provider_msg_id, thread_id, received_at, application_id) "
        "VALUES (?, 'm1', 'T1', '2026-10-01T00:00:00Z', ?)", (acct, app_id),
    )
    m = find_application(conn, acct, "T1", company_key("Acme"), role_key("Data Analyst"), event="applied")
    assert m == Match("matched", app_id)


# --- 6. Unicode-aware keys -----------------------------------------------------

def test_cjk_company_key_is_not_empty():
    assert company_key("京东") == "京东"
    assert role_key("软件工程师") != ""


def test_accented_names_do_not_collide_and_fold():
    assert company_key("Société Générale") == "societegenerale"
    assert company_key("Société Générale") != company_key("Socit Gnrale")
    assert company_key("Societe Generale SA") != ""
    assert company_key("Acme, Inc.") == company_key("ACME LLC") == "acme"
    assert role_key("Développeur Back-End") == "developpeurbackend"


# --- 7/8. Provider robustness --------------------------------------------------

def test_outlook_parse_tolerates_missing_or_null_sender():
    base = {"id": "o1", "receivedDateTime": "2026-10-05T14:30:00Z", "subject": "Hi", "body": {"contentType": "text", "content": "x"}}
    for raw in (base, {**base, "from": None}, {**base, "from": {"emailAddress": None}}):
        m = outlook.parse_message(raw)
        assert (m.sender_email, m.sender_name) == ("", "")


class _Resp:
    ok = True

    def __init__(self, data):
        self._data = data

    def json(self):
        return self._data

    def raise_for_status(self):
        pass


def test_outlook_fetch_sends_immutable_id_header_and_skips_bad_messages(monkeypatch, caplog):
    calls = []

    def fake_get(url, headers=None, timeout=None):
        calls.append((url, headers))
        if "mailFolders" in url:
            return _Resp({"id": "folder"})
        return _Resp({"value": [
            {"id": "bad", "receivedDateTime": "not a date"},
            {"id": "good", "receivedDateTime": "2026-10-05T14:30:00Z", "from": None,
             "body": {"contentType": "text", "content": "hello"}},
        ]})

    monkeypatch.setattr(outlook.requests, "get", fake_get)
    monkeypatch.setattr(outlook.OutlookProvider, "_token", lambda self: "tok")
    with caplog.at_level(logging.WARNING):
        got = list(outlook.OutlookProvider("a@outlook.com").fetch(datetime(2026, 10, 1, tzinfo=timezone.utc), lambda _id: False))
    assert [m.id for m in got] == ["good"]
    assert "bad" in caplog.text
    prefer = calls[-1][1]["Prefer"]
    # Ids stay stable across folder moves, and bodies come back as HTML so alert emails keep their links.
    assert [p.strip() for p in prefer.split(",")] == ['IdType="ImmutableId"']


def _gmail_raw(**extra):
    raw = {
        "id": "g1",
        "payload": {
            "mimeType": "text/plain",
            "headers": [
                {"name": "From", "value": "Acme <jobs@acme.com>"},
                {"name": "Date", "value": "Tue, 06 Oct 2026 10:00:00 -0400"},
            ],
            "body": {"data": base64.urlsafe_b64encode(b"hi").decode()},
        },
    }
    raw.update(extra)
    return raw


def test_gmail_missing_internal_date_falls_back_to_date_header():
    m = gmail.parse_message(_gmail_raw())
    assert m.received_at == datetime(2026, 10, 6, 14, 0, tzinfo=timezone.utc)
    assert m.received_at.utcoffset().total_seconds() == 0


def test_gmail_internal_date_still_preferred():
    m = gmail.parse_message(_gmail_raw(internalDate="1790000000000"))
    assert m.received_at == datetime.fromtimestamp(1790000000, tz=timezone.utc)


def test_gmail_no_date_at_all_raises_value_error():
    raw = _gmail_raw()
    raw["payload"]["headers"] = [h for h in raw["payload"]["headers"] if h["name"] != "Date"]
    with pytest.raises(ValueError):
        gmail.parse_message(raw)
    raw["payload"]["headers"].append({"name": "Date", "value": "garbage"})
    with pytest.raises(ValueError):
        gmail.parse_message(raw)


def test_gmail_fetch_skips_malformed_message(monkeypatch, caplog):
    good = _gmail_raw(id="good", internalDate="1790000000000")
    bad = _gmail_raw(id="bad")
    bad["payload"]["headers"] = []
    store = {"good": good, "bad": bad}

    class Exec:
        def __init__(self, value):
            self.value = value

        def execute(self):
            return self.value

    class Messages:
        def list(self, **kw):
            return Exec({"messages": [{"id": "bad"}, {"id": "good"}]})

        def get(self, userId, id, format):
            return Exec(store[id])

    class Users:
        def messages(self):
            return Messages()

    class Service:
        def users(self):
            return Users()

    monkeypatch.setattr(gmail.GmailProvider, "_credentials", lambda self: None)
    monkeypatch.setattr(gmail.GmailProvider, "_service", staticmethod(lambda creds: Service()))
    with caplog.at_level(logging.WARNING):
        got = list(gmail.GmailProvider("a@gmail.com").fetch(datetime(2026, 10, 1, tzinfo=timezone.utc), lambda _id: False))
    assert [m.id for m in got] == ["good"]
    assert "bad" in caplog.text


# --- 9. Scheduled task settings -------------------------------------------------

def test_install_task_runs_on_battery():
    from pathlib import Path

    text = (Path(__file__).resolve().parent.parent / "scripts" / "install-task.ps1").read_text(encoding="utf-8")
    assert "-AllowStartIfOnBatteries" in text and "-DontStopIfGoingOnBatteries" in text
