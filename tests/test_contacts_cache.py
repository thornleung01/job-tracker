"""Listing the people reads each stored email once per run of the app, and the answer does not change."""
from jobtracker import contacts, db
from tests.helpers import mk
from jobtracker.sync import process_message

SIGNATURE = "Thanks!\nSofia Hart\nSales Sourcer\nDoorDash\nsofia.hart@doordash.com\n"


def build():
    conn = db.connect(":memory:")
    db.upsert_account(conn, "gmail", "me@gmail.com")
    for i in range(5):
        process_message(conn, 1, mk(f"m{i}", f"Re: your application {i}", f"We would like to talk about the analyst role {i}.\n{SIGNATURE}",
                                    sender="Sofia Hart <sofia.hart@doordash.com>", thread="t"))
    conn.execute("INSERT INTO applications (company, company_key, role, role_key, stage) VALUES ('DoorDash', 'doordash', 'Analyst', 'analyst', 'Interview')")
    conn.execute("UPDATE emails SET application_id = 1, needs_review = 0 WHERE related = 1")
    conn.commit()
    return conn


def test_a_second_listing_reads_no_email_again_and_returns_the_same_people(monkeypatch):
    contacts._read.cache_clear()
    conn = build()
    reads = []
    real = contacts.parts
    monkeypatch.setattr(contacts, "parts", lambda body: reads.append(1) or real(body))
    first = contacts.derive(conn)
    cold = len(reads)
    second = contacts.derive(conn)
    assert first and first == second
    assert cold == 5 and len(reads) == cold             # five distinct bodies, each read once
    assert first[0]["title"] == "Sales Sourcer" and first[0]["emails"] == 5


def test_a_changed_body_is_read_again(monkeypatch):
    contacts._read.cache_clear()
    conn = build()
    assert contacts.derive(conn)[0]["title"] == "Sales Sourcer"
    conn.execute("UPDATE emails SET body = 'Hello.\nSofia Hart\nSenior Recruiter\nDoorDash\n' WHERE related = 1")
    conn.commit()
    assert contacts.derive(conn)[0]["title"] == "Senior Recruiter"        # a stale cache would still say Sales Sourcer
