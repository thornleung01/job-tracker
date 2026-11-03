"""Newsletters and marketing mail are not applications. Fixtures are modelled on mail that really did get through."""
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from jobtracker import db
from jobtracker.classify import classify
from jobtracker.models import Message
from jobtracker.providers import gmail, outlook
from jobtracker.recheck import recheck
from jobtracker.sync import process_message
from jobtracker.web import create_app


def mail(subject, body="", sender="Someone <someone@example.com>", id="m1", day=1, bulk=False, thread="t1"):
    name, _, addr = sender.partition("<")
    return Message(id=id, thread_id=thread, sender_name=name.strip(), sender_email=(addr.rstrip(">") if addr else name).strip(),
                   subject=subject, received_at=datetime(2026, 10, day, 12, 0, tzinfo=timezone.utc), body=body, bulk=bulk)


STRATA_BODY = ("Inside: Tesla SQL challenge, ML vs. AI vs. LLM roles, and AI's hype-vs-numbers problem "
               "( https://platform.stratascratch.com/coding?code_type=1&utm_source=newsletter&utm_medium=email&utm_campaign=102026 ) "
               "Build confidence in your interview prep. Practice assessment questions. Unsubscribe")


@pytest.fixture
def conn():
    c = db.connect(":memory:")
    yield c
    c.close()


# --- the four emails that fooled it -----------------------------------------------------------

@pytest.mark.parametrize("subject,sender,body", [
    ("How Ready Are You? StrataScratch Now Scores It", "StrataScratch Team <hello@stratascratch.com>", STRATA_BODY),
    ("Interview Loops for Popular Companies and Industries", "StrataScratch Team <hello@stratascratch.com>", STRATA_BODY),
    ("New Salary Form, SWEs to Manager Ratio, and AI Token Budgets", "Levels.fyi <hello@levels.fyi>",
     "Levels.fyi Product Update Having trouble viewing? View this email online. See what an offer looks like at top companies."),
    ("Just in at Wealthsimple: This week's employee reviews and more", "Glassdoor <noreply@glassdoor.com>",
     "Check out recent updates and stay on top of your work game. Apply to open roles. Interview reviews."),
    ("5 Claude Tricks That Give You an Unfair Advantage", "Medium Daily Digest <noreply@medium.com>",
     "Stories for you. Become a member. Hiring managers love this. Unsubscribe"),
])
def test_the_newsletters_that_became_applications_are_ignored(subject, sender, body, conn):
    assert not classify(mail(subject, body, sender)).related
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    assert process_message(conn, acct, mail(subject, body, sender)) == "ignored"
    assert conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0] == 0


# --- the general lesson: bulk mail only counts if its subject says so -----------------------------

def test_a_sender_we_have_never_heard_of_is_still_recognised_as_marketing_by_its_footer():
    body = "We would like to schedule an interview prep session! Read more: https://x.io/?utm_medium=email Unsubscribe"
    assert not classify(mail("Your weekly career boost", body, "Career Co <hello@careerco.io>")).related


def test_the_mailing_list_header_alone_is_enough():
    body = "We would like to schedule an interview with you. Please reply with your availability."
    assert classify(mail("Next steps", body, "Pat <pat@acme.com>")).related
    assert not classify(mail("Next steps", body, "Pat <pat@acme.com>", bulk=True)).related


def test_bulk_mail_whose_subject_is_about_your_application_still_counts():
    body = "Thanks for your interest. Manage your preferences or unsubscribe at any time."
    cls = classify(mail("Your application was sent to Acme Corp", body, "LinkedIn <jobs-noreply@linkedin.com>"))
    assert cls.related and cls.event == "applied"


def test_hiring_system_mail_with_an_unsubscribe_footer_is_still_job_mail():
    body = "We'd like to invite you to an interview for the Data Analyst role. Unsubscribe from these emails."
    cls = classify(mail("Interview invitation", body, "Acme Recruiting <no-reply@greenhouse.io>"))
    assert cls.related and cls.event == "interview" and cls.confidence == "high"


def test_a_real_reply_from_a_person_is_untouched():
    cls = classify(mail("Re: your application", "We would like to schedule an interview next week.", "Pat <pat@acme.com>"))
    assert cls.related and cls.event == "interview"


# --- mentioning a stage must not invent an application ------------------------------------------

def test_a_medium_confidence_stage_mention_with_nothing_to_attach_it_to_goes_to_review(conn):
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    msg = mail("Next steps", "We would like to schedule an interview with you for the analyst role.", "Pat Lee <pat@acme.com>")
    assert classify(msg).confidence == "medium"
    assert process_message(conn, acct, msg) == "review"
    assert conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0] == 0
    assert conn.execute("SELECT needs_review FROM emails").fetchone()[0] == 1


def test_an_application_confirmation_still_creates_an_application(conn):
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    msg = mail("Thank you for applying to Acme", "We received your application for the Data Analyst role.",
               "Acme Careers <jobs@acme.com>")
    assert process_message(conn, acct, msg) == "applied-to-application"
    assert conn.execute("SELECT company FROM applications").fetchone()[0] == "Acme"


def test_a_confident_interview_invite_from_a_hiring_system_still_creates_one(conn):
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    msg = mail("Interview invitation", "We'd like to invite you to an interview for the Data Analyst role at Acme.",
               "Acme Recruiting <no-reply@greenhouse.io>")
    assert process_message(conn, acct, msg) == "applied-to-application"


# --- providers report the mailing-list headers ---------------------------------------------------

def test_gmail_marks_mailing_list_mail():
    def raw(headers):
        return {"id": "1", "threadId": "t", "internalDate": "1790000000000",
                "payload": {"headers": [{"name": "From", "value": "A <a@b.com>"}, {"name": "Subject", "value": "Hi"}, *headers],
                            "mimeType": "text/plain", "body": {"data": "SGk="}}}
    assert gmail.parse_message(raw([{"name": "List-Unsubscribe", "value": "<mailto:x@y.com>"}])).bulk
    assert gmail.parse_message(raw([{"name": "Precedence", "value": "bulk"}])).bulk
    assert gmail.parse_message(raw([{"name": "List-Id", "value": "<news.example.com>"}])).bulk
    assert not gmail.parse_message(raw([])).bulk


def test_outlook_marks_mailing_list_mail():
    base = {"id": "1", "conversationId": "c", "subject": "Hi", "from": {"emailAddress": {"name": "A", "address": "a@b.com"}},
            "receivedDateTime": "2026-10-01T12:00:00Z", "body": {"contentType": "text", "content": "Hi"}}
    assert outlook.parse_message({**base, "internetMessageHeaders": [{"name": "List-Unsubscribe", "value": "<mailto:x@y.com>"}]}).bulk
    assert not outlook.parse_message({**base, "internetMessageHeaders": [{"name": "Received", "value": "x"}]}).bulk
    assert not outlook.parse_message(base).bulk


# --- re-checking mail that is already stored --------------------------------------------------------

def store_old(conn, acct, msg, event, confidence="medium"):
    """What an older version of the rules would have stored for this message."""
    app = db.create_application(conn, "StrataScratch", "stratascratch", "Unknown role", "", db.STAGE_FOR_EVENT[event], db.iso(msg.received_at))
    conn.execute("INSERT INTO emails (account_id, provider_msg_id, thread_id, received_at, sender, subject, body, related, event, confidence, application_id) "
                 "VALUES (?, ?, 't', ?, ?, ?, ?, 1, ?, ?, ?)",
                 (acct, msg.id, db.iso(msg.received_at), f"{msg.sender_name} <{msg.sender_email}>", msg.subject, msg.body, event, confidence, app))
    conn.commit()
    return app


def test_recheck_removes_applications_made_from_newsletters(conn):
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    store_old(conn, acct, mail("Interview Loops for Popular Companies", STRATA_BODY, "StrataScratch Team <hello@stratascratch.com>"), "interview")
    assert recheck(conn) == {"checked": 1, "cleared": 1, "removed": 1, "settled": 0, "roles": 0}
    assert conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0] == 0
    row = conn.execute("SELECT * FROM emails").fetchone()      # only the id and date are kept, like a dismissed email
    assert row["related"] == 0 and row["subject"] is None and row["body"] is None and row["application_id"] is None
    assert recheck(conn) == {"checked": 0, "cleared": 0, "removed": 0, "settled": 0, "roles": 0}


def test_recheck_never_touches_applications_you_made_or_edited(conn):
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    bogus = mail("Interview Loops", STRATA_BODY, "StrataScratch Team <hello@stratascratch.com>", id="a")
    locked = store_old(conn, acct, bogus, "interview")
    conn.execute("UPDATE applications SET locked = 1 WHERE id = ?", (locked,))
    noted = store_old(conn, acct, mail("Interview Loops", STRATA_BODY, "StrataScratch Team <hello@stratascratch.com>", id="b"), "interview")
    conn.execute("INSERT INTO activity (application_id, kind, label, body, occurred_at, created_at) VALUES (?, 'note', NULL, 'mine', '2026-10-02T00:00:00Z', '2026-10-02T00:00:00Z')", (noted,))
    manual = store_old(conn, acct, mail("Interview Loops", STRATA_BODY, "StrataScratch Team <hello@stratascratch.com>", id="c"), "interview")
    conn.execute("UPDATE applications SET manual = 1 WHERE id = ?", (manual,))
    conn.commit()
    assert recheck(conn)["cleared"] == 0
    assert conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0] == 3


def test_recheck_rebuilds_the_stage_when_real_mail_remains(conn):
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    real = mail("Thank you for applying to Acme", "We received your application for the Data Analyst role.", "Acme Careers <jobs@acme.com>", id="real", day=1)
    app = db.create_application(conn, "Acme", "acme", "Data Analyst", "dataanalyst", "Applied", db.iso(real.received_at))
    conn.execute("INSERT INTO emails (account_id, provider_msg_id, thread_id, received_at, sender, subject, body, related, event, confidence, application_id) "
                 "VALUES (?, 'real', 't', ?, 'Acme Careers <jobs@acme.com>', ?, ?, 1, 'applied', 'medium', ?)", (acct, db.iso(real.received_at), real.subject, real.body, app))
    junk = mail("Interview Loops", STRATA_BODY, "StrataScratch Team <hello@stratascratch.com>", id="junk", day=5)
    conn.execute("INSERT INTO emails (account_id, provider_msg_id, thread_id, received_at, sender, subject, body, related, event, confidence, application_id) "
                 "VALUES (?, 'junk', 't', ?, 'StrataScratch Team <hello@stratascratch.com>', ?, ?, 1, 'interview', 'medium', ?)", (acct, db.iso(junk.received_at), junk.subject, junk.body, app))
    conn.execute("UPDATE applications SET stage = 'Interview', stage_at = ? WHERE id = ?", (db.iso(junk.received_at), app))
    conn.commit()
    assert recheck(conn) == {"checked": 2, "cleared": 1, "removed": 0, "settled": 0, "roles": 0}
    row = conn.execute("SELECT stage, applied_at FROM applications").fetchone()
    assert row["stage"] == "Applied" and row["applied_at"].startswith("2026-10-01")


def test_recheck_from_settings(tmp_path):
    path = tmp_path / "t.db"
    conn = db.connect(path)
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    store_old(conn, acct, mail("Interview Loops", STRATA_BODY, "StrataScratch Team <hello@stratascratch.com>"), "interview")
    c = TestClient(create_app(path), base_url="http://127.0.0.1:8765", follow_redirects=False)
    assert "Re-check saved emails" in c.get("/settings").text
    r = c.post("/settings/recheck")
    page = c.get(r.headers["location"]).text
    assert "Checked 1 saved job emails" in page and "1 application made from them was removed" in page
    again = c.get(c.post("/settings/recheck").headers["location"]).text
    assert "Nothing needed to change" in again
