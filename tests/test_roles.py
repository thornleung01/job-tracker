"""Roles named in real application emails (wording copied from mail that came back as "Unknown role")."""
from datetime import datetime, timezone

import pytest

from jobtracker import db
from jobtracker.extract import UNKNOWN_ROLE, extract_company_role
from jobtracker.models import Message
from jobtracker.recheck import fill_missing_roles, recheck


def mail(subject, body, sender="Acme <no-reply@acme.com>"):
    name, _, addr = sender.partition("<")
    return Message(id="1", thread_id="t", sender_name=name.strip(), sender_email=addr.rstrip(">"), subject=subject,
                   received_at=datetime(2026, 10, 5, tzinfo=timezone.utc), body=body)


PAD = "͏ " * 40      # LinkedIn pads its mail with invisible characters


@pytest.mark.parametrize("subject,body,sender,company,role", [
    ("Your application has been received!",
     "Hi Jordan, Thanks for your interest in joining Deel! We’ve received your application for the Operations Manager | NAM position which is now being reviewed.",
     "Deel HQ Hiring Team <no-reply@deel.com>", "Deel", "Operations Manager | NAM"),
    ("Thank you for your interest in Instacart!",
     "Hi Jordan, Thanks! We have received your application for our  Associate Product Operations Manager   role and are working as fast as we can.",
     "no-reply@instacart.com <no-reply@instacart.com>", "Instacart", "Associate Product Operations Manager"),
    ("[Kick] Thanks for your application",
     "Hey Jordan, Appreciate you taking the time to apply for our position of Customer Experience Lead, Business Owner. Choosing a place to work is a massive decision.",
     "Kick <no-reply@ats.rippling.com>", "Kick", "Customer Experience Lead, Business Owner"),
    ("[Availability Request] DoorDash - Next Steps for Senior Associate, New Verticals - Canada Strategy & Operations  | Jordan Lee",
     "Jocelyn Ford has invited you to attend: DoorDash Zoom Interview",
     "Jocelyn Ford <jocelyn.ford@doordash.com>", "Doordash", "Senior Associate, New Verticals - Canada Strategy & Operations"),
    ("Jordan, your application was sent to Empire Life",
     f"Your application was sent to Empire Life {PAD} Your application was sent to Empire Life Process Improvement Leader (new grad) Empire Life · Ontario, Canada (Remote) Applied on October 5, 2026 Now, take these next steps",
     "LinkedIn <jobs-noreply@linkedin.com>", "Empire Life", "Process Improvement Leader (new grad)"),
    ("Jordan, your application was sent to PointClickCare",
     f"Your application was sent to PointClickCare {PAD} Your application was sent to PointClickCare Process Analyst PointClickCare · Greater Montreal Metropolitan Area (Remote) Applied on October 13, 2026 View similar jobs",
     "LinkedIn <jobs-noreply@linkedin.com>", "PointClickCare", "Process Analyst"),
])
def test_roles_are_found_in_real_application_emails(subject, body, sender, company, role):
    got_company, got_role = extract_company_role(mail(subject, body, sender))
    assert (got_company, got_role) == (company, role)


def test_an_email_that_really_has_no_role_stays_unknown():
    body = "Thank you for your application to Clio! Hi Jordan Thank you for your interest in Clio! Your application will be reviewed by our Talent Acquisition Team."
    assert extract_company_role(mail("Thank you for your Application to Clio!", body, "Clio <clio@myworkday.com>"))[1] == UNKNOWN_ROLE


@pytest.mark.parametrize("sentence", [
    "We will be in touch if you are a good match for the next stage of our process.",
    "Thanks for applying, we love people who bring energy to the team and the role of a lifetime.",
])
def test_sentences_are_not_mistaken_for_roles(sentence):
    assert extract_company_role(mail("Update", sentence))[1] == UNKNOWN_ROLE


def test_existing_applications_get_the_role_their_saved_emails_name():
    conn = db.connect(":memory:")
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    app = db.create_application(conn, "Deel", "deel", "Unknown role", "", "Applied", "2026-10-05T00:00:00Z")
    conn.execute("INSERT INTO emails (account_id, provider_msg_id, thread_id, received_at, sender, subject, body, related, event, confidence, application_id) "
                 "VALUES (?, 'x', 't', '2026-10-05T00:00:00Z', 'Deel <no-reply@deel.com>', 'Your application has been received!', "
                 "'We received your application for the Operations Manager | NAM position which is now being reviewed.', 1, 'applied', 'high', ?)", (acct, app))
    done = db.create_application(conn, "Hand", "hand", "Unknown role", "", "Applied", "2026-10-05T00:00:00Z", manual=True)
    conn.commit()
    assert recheck(conn)["roles"] == 1 and fill_missing_roles(conn) == 0      # filled once, then nothing left to fill
    row = conn.execute("SELECT role, role_key FROM applications WHERE id = ?", (app,)).fetchone()
    assert row["role"] == "Operations Manager | NAM" and row["role_key"] == "operationsmanagernam"
    assert conn.execute("SELECT role FROM applications WHERE id = ?", (done,)).fetchone()[0] == "Unknown role"    # yours are never touched


@pytest.mark.parametrize("body,role", [
    ("Appreciate you taking the time to apply for our position of Customer Experience Lead, Business Owner. Choosing a place to work is a massive decision.", "Customer Experience Lead, Business Owner"),
    ("We have received your application for our \nAssociate Product Operations Manager\n \nrole and are working as fast as we can.", "Associate Product Operations Manager"),
])
def test_roles_survive_odd_spaces_and_line_breaks(body, role):
    assert extract_company_role(mail("Thanks for your application", body))[1] == role


def test_editing_the_role_by_hand_sticks_and_protects_the_application(tmp_path):
    from fastapi.testclient import TestClient
    from jobtracker.web import create_app

    path = tmp_path / "t.db"
    conn = db.connect(path)
    app = db.create_application(conn, "Clio", "clio", "Unknown role", "", "Applied", "2026-10-14T00:00:00Z")
    conn.commit()
    c = TestClient(create_app(path), base_url="http://127.0.0.1:8765", follow_redirects=False)
    assert "Edit company or role" in c.get(f"/app/{app}").text
    assert c.post(f"/app/{app}/edit", data={"company": "Clio", "role": "  Operations   Analyst "}).status_code == 303
    row = conn.execute("SELECT role, role_key, manual FROM applications").fetchone()
    assert tuple(row) == ("Operations Analyst", "operationsanalyst", 1)
    assert fill_missing_roles(conn) == 0
    assert "empty" in c.get(c.post(f"/app/{app}/edit", data={"company": " ", "role": "x"}).headers["location"]).text
    assert c.post("/app/999/edit", data={"company": "x"}).status_code == 404
    assert c.post(f"/app/{app}/edit", data={"company": "x"}, headers={"origin": "https://evil.example.com"}).status_code == 403
