"""Wording and situations from 18 real emails that landed in Needs review."""
from datetime import datetime, timezone

import pytest

from jobtracker import db
from jobtracker.classify import classify
from jobtracker.extract import extract_company_role
from jobtracker.match import same_role
from jobtracker.models import Message
from jobtracker.recheck import recheck, settle_review
from jobtracker.sync import process_message


def mail(subject, body, sender, id="m1", day=1, thread="t"):
    name, _, addr = sender.partition("<")
    return Message(id=id, thread_id=thread, sender_name=name.strip() if addr else "", sender_email=addr.rstrip(">") if addr else sender,
                   subject=subject, received_at=datetime(2026, 10, day, 12, tzinfo=timezone.utc), body=body)


@pytest.fixture
def conn():
    c = db.connect(":memory:")
    db.upsert_account(c, "gmail", "me@gmail.com")
    c.commit()
    yield c
    c.close()


def test_curly_apostrophes_do_not_hide_an_application_confirmation():
    cls = classify(mail("Good move", "Hey Jordan ! This is just a note to confirm that we’ve received your application, and we think it’s pretty awesome.",
                        "Shopify Hiring Team <recruiting@talent.shopify.com>"))
    assert cls.related and cls.event == "applied"


@pytest.mark.parametrize("subject,body", [
    ("Recruiter Screen interview - Jordan Lee - Operations Manager | NAM", "Confirmed Your event has been scheduled"),
    ("Home Task Interview - Jordan Lee - Operations Manager | NAM", "Confirmed Your event has been scheduled"),
    ("Reminder - DoorDash Zoom Interview | JORDAN LEE", "Reminder! Sara has invited you to attend: DoorDash Zoom Interview | JORDAN LEE"),
    ("DoorDash | Senior Associate | Interview Prep", "Following up to share the details for your upcoming interviews."),
    ("DoorDash | Next Steps", "I’m excited to share that the team would love to move you forward to the next stage of the interview process!"),
])
def test_calendar_invites_and_next_steps_are_recognised_as_interviews(subject, body):
    cls = classify(mail(subject, body, "Pat Lee <pat@doordash.com>"))
    assert cls.related and cls.event == "interview"


def test_a_workday_email_from_the_employers_own_address_names_the_company():
    msg = mail("Clio - Thank you for your application",
               "Update On Your Application Hi Jordan Thank you for taking the time to consider the Senior Strategy & Operations Associate position at Clio! regrettably, we have decided not to move forward",
               "clio@myworkday.com")
    assert extract_company_role(msg) == ("Clio", "Senior Strategy & Operations Associate")
    assert classify(msg).event == "rejected"


def test_an_em_dash_ends_the_company_name():
    msg = mail("Welcome to Deel - Next Steps", "Congratulations on accepting your offer for the position of Operations Manager at Deel — we’re excited to have you join the team!",
               "people.team@deel.com")
    assert extract_company_role(msg)[0] == "Deel"
    assert classify(msg).event == "offer"


def test_generic_senders_at_a_hiring_system_do_not_become_the_company():
    msg = mail("Your application", "Thanks for applying.", "no-reply@myworkday.com")
    assert extract_company_role(msg)[0] != "No-reply"


def test_the_same_job_with_a_team_or_place_added_is_still_the_same_job():
    assert same_role("operationsmanager", "operationsmanagernam")
    assert not same_role("dataanalyst", "operationsmanager")
    assert not same_role("", "operationsmanager") and not same_role("analyst", "seniordataanalyst")      # too short to trust


def test_weak_mail_in_a_conversation_you_already_follow_attaches_instead_of_waiting_for_review(conn):
    acct = 1
    assert process_message(conn, acct, mail("Thank you for applying to Deel", "We received your application for the Operations Manager | NAM position.",
                                            "Deel Hiring <no-reply@deel.com>", id="a", day=1)) == "applied-to-application"
    weak = mail("Update From Deel", "Hi Jordan, Thank so much for taking the time to meet with Dan and complete the interview process for the Operations Manager role here at Deel! "
                "I have an exciting update I'd love to share with you, do you have time for a quick video", "Sam Lee <sam@deel.com>", id="b", day=5, thread="other")
    assert classify(weak).confidence == "low"
    assert process_message(conn, acct, weak) == "applied-to-application"
    assert conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0] == 1


def test_weak_mail_about_a_company_you_have_no_application_for_still_waits_for_you(conn):
    weak = mail("Update", "Hi Jordan, I have an update on the interview process for the role. Do you have a few minutes to chat?", "Sam Lee <sam@unknown-co.com>")
    assert process_message(conn, 1, weak) == "review"


def test_early_mail_waiting_in_review_settles_once_its_application_exists(conn):
    early = mail("Next steps", "We would like to schedule an interview with you for the Analyst role at Acme.", "Pat Lee <pat@acme.com>", id="early", day=1)
    assert process_message(conn, 1, early) == "review"                  # no application for Acme yet, and only medium confidence
    later = mail("Thank you for applying to Acme", "We received your application for the Analyst role.", "Acme <jobs@acme.com>", id="later", day=3)
    assert process_message(conn, 1, later) == "applied-to-application"
    assert conn.execute("SELECT COUNT(*) FROM emails WHERE needs_review = 1").fetchone()[0] == 1
    assert settle_review(conn) == 1
    assert conn.execute("SELECT COUNT(*) FROM emails WHERE needs_review = 1").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0] == 1
    assert recheck(conn)["settled"] == 0                                # nothing left to settle


def test_settling_never_touches_mail_that_is_still_unsure(conn):
    junk = mail("Reminder: Survey on student financing", "Hello, you were invited to a survey about your application experience.", "survey@esdc.gc.ca")
    process_message(conn, 1, junk)
    before = conn.execute("SELECT COUNT(*) FROM emails WHERE needs_review = 1").fetchone()[0]
    assert settle_review(conn) == 0 and conn.execute("SELECT COUNT(*) FROM emails WHERE needs_review = 1").fetchone()[0] == before


# --- logging an application by hand ------------------------------------------------------------------

def client(tmp_path):
    from fastapi.testclient import TestClient
    from jobtracker.web import create_app

    path = tmp_path / "t.db"
    return db.connect(path), TestClient(create_app(path), base_url="http://127.0.0.1:8765", follow_redirects=False)


def test_the_add_button_and_form_are_on_the_applications_page(tmp_path):
    _, c = client(tmp_path)
    page = c.get("/").text
    assert "+ Add application" in page and 'id="add-application"' in page and 'name="applied_on"' in page


def test_a_hand_logged_application_uses_the_day_you_applied(tmp_path):
    conn, c = client(tmp_path)
    r = c.post("/app/add", data={"company": "  Acme   Corp ", "role": "Data Analyst", "stage": "Interview", "applied_on": "2026-10-10"})
    assert r.status_code == 303
    row = conn.execute("SELECT * FROM applications").fetchone()
    assert (row["company"], row["role"], row["stage"], row["manual"], row["locked"]) == ("Acme Corp", "Data Analyst", "Interview", 1, 1)
    assert row["stage_at"].startswith("2026-10-10") and row["last_activity"].startswith("2026-10-10")


def test_the_date_is_optional_and_bad_dates_are_refused(tmp_path):
    conn, c = client(tmp_path)
    assert c.post("/app/add", data={"company": "A", "stage": "Applied"}).status_code == 303
    assert c.post("/app/add", data={"company": "B", "stage": "Applied", "applied_on": "next week"}).status_code == 400
    assert c.post("/app/add", data={"company": "C", "stage": "Applied", "applied_on": "2999-01-01"}).status_code == 400
    assert conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0] == 1


# --- the survey that looked like a job email, and the Workday sender you flagged twice -----------------

def test_a_survey_that_says_students_applied_for_assistance_is_not_job_wording():
    survey = mail("Reminder: Survey on student financing of post-secondary education",
                  "You have been selected from a list of students who applied for or received government student financial assistance for the 2024-25 school year.",
                  "Survey <survey@esdc-edsc.gc.ca>")
    assert not classify(survey).related


def test_applied_for_a_position_is_still_job_wording():
    cls = classify(mail("Update", "Hi, I wanted to follow up now that you have applied for the Data Analyst position with us.", "Pat Lee <pat@acme.com>"))
    assert cls.related


def test_one_hiring_system_address_is_blocked_after_two_flags_but_never_its_whole_domain(conn):
    from jobtracker import learn

    def flag(sender):
        conn.execute("INSERT INTO feedback (created_at, verdict, sender_email, sender_domain, subject, reason) VALUES ('2026-10-01T00:00:00Z', 'not_job', ?, ?, 's', '')", (sender, sender.split("@")[1]))
    flag("wealthsimple@myworkday.com")
    conn.commit()
    assert learn.rebuild(conn) == []                                  # one flag is not enough for a hiring-system sender
    flag("wealthsimple@myworkday.com")
    flag("otherco@myworkday.com")
    conn.commit()
    learn.rebuild(conn)
    kinds = {(r["kind"], r["value"]) for r in conn.execute("SELECT kind, value FROM learned_rules WHERE active = 1")}
    assert ("block_sender", "wealthsimple@myworkday.com") in kinds
    assert ("block_sender", "otherco@myworkday.com") not in kinds and not any(k == "block_domain" for k, _ in kinds)
