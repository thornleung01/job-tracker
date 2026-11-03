from datetime import datetime, timezone

import pytest

from jobtracker import db
from jobtracker.models import Message
from jobtracker.sync import process_message, process_messages


@pytest.fixture
def conn():
    c = db.connect(":memory:")
    yield c
    c.close()


@pytest.fixture
def acct(conn):
    return db.upsert_account(conn, "gmail", "me@gmail.com")


def mk(id, subject, body="", sender="Acme Careers <no-reply@greenhouse.io>", thread=None, day=1):
    name, _, addr = sender.partition("<")
    return Message(
        id=id, thread_id=thread or id, sender_name=name.strip(), sender_email=addr.rstrip(">").strip(),
        subject=subject, received_at=datetime(2026, 10, day, 9, 0, tzinfo=timezone.utc), body=body,
    )


def apps(conn):
    return [dict(r) for r in conn.execute("SELECT * FROM applications ORDER BY id")]


def test_full_lifecycle_in_one_thread(conn, acct):
    process_messages(conn, acct, [
        mk("1", "Thank you for applying to Acme", thread="T", day=1),
        mk("2", "Interview invitation", "We'd like to schedule an interview.", thread="T", day=5),
        mk("3", "Offer of employment", "We are pleased to offer you the role.", thread="T", day=9),
    ])
    (a,) = apps(conn)
    assert (a["company"], a["stage"]) == ("Acme", "Offer")
    assert a["applied_at"] == "2026-10-01T09:00:00Z"
    assert a["last_activity"] == "2026-10-09T09:00:00Z"


def test_processing_order_is_by_date_not_arrival(conn, acct):
    process_messages(conn, acct, [
        mk("3", "Offer", "We are pleased to offer you the role.", thread="T", day=9),
        mk("1", "Thank you for applying to Acme", thread="T", day=1),
    ])
    assert apps(conn)[0]["stage"] == "Offer"


def test_stage_never_moves_backwards(conn, acct):
    process_messages(conn, acct, [
        mk("1", "Thank you for applying to Acme", thread="T", day=1),
        mk("2", "Interview", "Please select a time for your interview.", thread="T", day=3),
    ])
    process_message(conn, acct, mk("3", "Application received", "We received your application.", thread="T", day=4))
    assert apps(conn)[0]["stage"] == "Interview"


def test_rejection_after_interview(conn, acct):
    process_messages(conn, acct, [
        mk("1", "Thank you for applying to Acme", thread="T", day=1),
        mk("2", "Interview", "Please select a time for your interview.", thread="T", day=3),
        mk("3", "Update", "Unfortunately we will not be moving forward with your application.", thread="T", day=8),
    ])
    assert apps(conn)[0]["stage"] == "Rejected"


def test_older_rejection_does_not_overwrite_newer_offer(conn, acct):
    process_messages(conn, acct, [
        mk("1", "Thank you for applying to Acme", thread="T", day=1),
        mk("2", "Update", "We will not be moving forward with your application.", thread="T", day=3),
        mk("3", "Offer", "We are pleased to offer you the role.", thread="T", day=8),
    ])
    assert apps(conn)[0]["stage"] == "Offer"


def test_rerun_is_idempotent(conn, acct):
    batch = [mk("1", "Thank you for applying to Acme"), mk("2", "Your receipt", "thanks", sender="Shop <a@shop.com>")]
    process_messages(conn, acct, batch)
    again = process_messages(conn, acct, batch)
    assert again == {"duplicate": 2}
    assert len(apps(conn)) == 1
    assert conn.execute("SELECT COUNT(*) FROM emails").fetchone()[0] == 2


def test_unrelated_mail_keeps_no_content(conn, acct):
    process_message(conn, acct, mk("9", "Your receipt", "secret order details", sender="Shop <a@shop.com>"))
    row = conn.execute("SELECT * FROM emails").fetchone()
    assert row["related"] == 0 and row["subject"] is None and row["body"] is None and row["sender"] is None


def test_body_is_capped(conn, acct):
    process_message(conn, acct, mk("1", "Thank you for applying to Acme", "x" * 10_000))
    assert len(conn.execute("SELECT body FROM emails").fetchone()[0]) == 4096


def test_locked_application_keeps_manual_stage(conn, acct):
    process_message(conn, acct, mk("1", "Thank you for applying to Acme", thread="T", day=1))
    conn.execute("UPDATE applications SET stage = 'Interview', locked = 1")
    process_message(conn, acct, mk("2", "Offer", "We are pleased to offer you the role.", thread="T", day=9))
    a = apps(conn)[0]
    assert a["stage"] == "Interview"
    assert a["last_activity"] == "2026-10-09T09:00:00Z"


def test_same_company_two_roles_are_separate(conn, acct):
    process_messages(conn, acct, [
        mk("1", "Your application to Data Analyst at Globex", sender="LinkedIn <jobs@linkedin.com>", day=1),
        mk("2", "Your application to Data Engineer at Globex", sender="LinkedIn <jobs@linkedin.com>", day=2),
    ])
    assert sorted(a["role"] for a in apps(conn)) == ["Data Analyst", "Data Engineer"]


def test_reply_matches_by_company_when_one_open(conn, acct):
    process_messages(conn, acct, [
        mk("1", "Thank you for applying to Acme", thread="A", day=1),
        mk("2", "Interview", "Please select a time for your interview.", thread="B", day=4),
    ])
    (a,) = apps(conn)
    assert a["stage"] == "Interview"


def test_ambiguous_reply_goes_to_review_without_changing_stage(conn, acct):
    process_messages(conn, acct, [
        mk("1", "Your application to Data Analyst at Globex", sender="LinkedIn <jobs@linkedin.com>", day=1),
        mk("2", "Your application to Data Engineer at Globex", sender="LinkedIn <jobs@linkedin.com>", day=2),
    ])
    result = process_message(conn, acct, mk("3", "Update from Globex",
                             "Unfortunately we will not be moving forward with your application.",
                             sender="Globex <hr@globex.com>", day=6))
    assert result == "review"
    assert {a["stage"] for a in apps(conn)} == {"Applied"}
    assert conn.execute("SELECT needs_review FROM emails WHERE provider_msg_id = '3'").fetchone()[0] == 1


def test_low_confidence_goes_to_review(conn, acct):
    result = process_message(conn, acct, mk("1", "Re: your application", "Quick question about your CV.",
                             sender="Sam <sam@acme.com>"))
    assert result == "review" and apps(conn) == []


def test_new_application_after_rejection_at_same_company(conn, acct):
    process_messages(conn, acct, [
        mk("1", "Thank you for applying to Acme", day=1),
        mk("2", "Update", "We will not be moving forward with your application.", day=3, thread="2"),
        mk("3", "Thank you for applying to Acme", day=20, thread="3"),
    ])
    assert [a["stage"] for a in apps(conn)] == ["Rejected", "Applied"]


def test_two_accounts_do_not_mix_threads(conn):
    g = db.upsert_account(conn, "gmail", "me@gmail.com")
    o = db.upsert_account(conn, "outlook", "me@outlook.com")
    process_message(conn, g, mk("1", "Thank you for applying to Acme", thread="same"))
    process_message(conn, o, mk("1", "Thank you for applying to Initech", sender="Initech <no-reply@lever.co>", thread="same"))
    assert sorted(a["company"] for a in apps(conn)) == ["Acme", "Initech"]
