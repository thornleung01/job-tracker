from datetime import datetime, timezone

import pytest

from jobtracker.classify import classify
from jobtracker.extract import UNKNOWN_COMPANY, UNKNOWN_ROLE, extract_company_role
from jobtracker.models import Message


def mk(subject, body="", sender="Acme Careers <jobs@acme.com>", id="m1", thread="t1", day=1):
    name, _, addr = sender.partition("<")
    return Message(
        id=id,
        thread_id=thread,
        sender_name=name.strip(),
        sender_email=(addr.rstrip(">") if addr else name).strip(),
        subject=subject,
        received_at=datetime(2026, 10, day, 12, 0, tzinfo=timezone.utc),
        body=body,
    )


@pytest.mark.parametrize(
    "subject,body,event",
    [
        ("Thank you for applying to Acme", "We have received your application.", "applied"),
        ("Your application was sent to Acme", "", "applied"),
        ("Application received", "We've received your application for the Data Analyst role.", "applied"),
        ("Update on your Acme application", "Unfortunately, we will not be moving forward with your application.", "rejected"),
        ("Your application", "We regret to inform you that the position has been filled.", "rejected"),
        ("Re: Data Analyst", "We decided to move forward with other candidates for this role.", "rejected"),
        ("Interview invitation - Data Analyst", "", "interview"),
        ("Next steps", "We'd like to schedule a call to discuss your application. Please select a time.", "interview"),
        ("Quick chat?", "I'm a recruiter at Acme. Are you free for a phone screen on Tuesday?", "interview"),
        ("Complete your assessment", "Please complete the online assessment within 5 days to continue your application.", "assessment"),
        ("Next step: coding challenge", "Your application moved on. Take the take-home coding challenge on HackerRank.", "assessment"),
        ("Offer of employment", "We are pleased to offer you the Data Analyst position at Acme.", "offer"),
        ("Your offer letter", "Attached is your offer letter for the role. Please sign by Friday.", "offer"),
    ],
)
def test_events(subject, body, event):
    result = classify(mk(subject, body))
    assert result.related and result.event == event, result.reason


def test_priority_offer_over_applied():
    r = classify(mk("Congratulations", "Thank you for applying. We are pleased to offer you the role."))
    assert r.event == "offer"


def test_rejection_beats_thanks_for_applying():
    r = classify(mk("Your application", "Thank you for applying. Unfortunately we will not be moving forward."))
    assert r.event == "rejected"


# --- Known traps -----------------------------------------------------------

def test_conditional_interview_is_not_interview():
    r = classify(mk(
        "Thanks for applying to Acme",
        "We received your application. We will contact you if selected for an interview.",
    ))
    assert r.event == "applied"


def test_cant_reply_to_everyone_is_not_rejection():
    r = classify(mk(
        "We received your application",
        "Thank you for applying. Unfortunately we are unable to reply to every applicant, "
        "but we will be in touch if your profile is a good match.",
    ))
    assert r.event == "applied"


def test_special_offer_is_not_a_job_offer():
    r = classify(mk("Special offer: 40% off", "Limited time offer on career coaching. Apply now.", sender="Deals <deals@shop.com>"))
    assert not (r.related and r.event == "offer")


def test_unfortunately_alone_is_not_rejection():
    r = classify(mk("Order update", "Unfortunately your parcel is delayed.", sender="Shop <orders@shop.com>"))
    assert not r.related


@pytest.mark.parametrize(
    "subject,sender",
    [
        ("New jobs for you: Data Analyst", "LinkedIn <jobalerts-noreply@linkedin.com>"),
        ("Jobs you may like this week", "Indeed <alert@indeed.com>"),
        ("Weekly digest: hiring trends", "Medium <digest@medium.com>"),
    ],
)
def test_alerts_and_digests_excluded(subject, sender):
    assert not classify(mk(subject, "Software Engineer at Acme, apply now", sender=sender)).related


def test_unrelated_mail_ignored():
    assert not classify(mk("Your receipt", "Thanks for your purchase", sender="Store <no-reply@store.com>")).related


def test_ats_sender_without_phrase_is_medium_heard_back():
    r = classify(mk("A message from Acme", "Hello there.", sender="Acme <no-reply@us.greenhouse-mail.io>"))
    assert r.related and r.event == "heard_back" and r.confidence == "medium"


def test_personal_reply_without_stage_phrase_is_low_confidence():
    r = classify(mk("Re: your application", "Hi, quick question about your CV.", sender="Sam <sam@acme.com>"))
    assert r.event == "heard_back" and r.confidence == "low"


# --- Company / role extraction ---------------------------------------------

@pytest.mark.parametrize(
    "subject,sender,company,role",
    [
        ("Your application to Data Analyst at Globex", "LinkedIn <jobs-noreply@linkedin.com>", "Globex", "Data Analyst"),
        ("Thank you for applying to Initech", "Initech Careers <no-reply@greenhouse.io>", "Initech", UNKNOWN_ROLE),
        ("Update on your Hooli application", "Hooli <no-reply@hooli.com>", "Hooli", UNKNOWN_ROLE),
    ],
)
def test_extract_subject(subject, sender, company, role):
    assert extract_company_role(mk(subject, sender=sender)) == (company, role)


def test_extract_role_and_company_from_body():
    m = mk("Application received", "Thanks for applying for the Backend Engineer position at Umbrella Corp. We will review it.",
           sender="Recruiting <no-reply@myworkday.com>")
    assert extract_company_role(m) == ("Umbrella Corp", "Backend Engineer")


def test_extract_role_drops_trailing_position_word():
    m = mk("Thank you for applying to Northwind",
           "We have received your application for the Data Engineer position at Northwind.")
    assert extract_company_role(m) == ("Northwind", "Data Engineer")


def test_extract_falls_back_to_sender_name_then_domain():
    assert extract_company_role(mk("Hello", sender="Stark Industries Recruiting <hr@stark.com>"))[0] == "Stark Industries"
    assert extract_company_role(mk("Hello", sender="<hr@wayne.com>"))[0] == "Wayne"
    assert extract_company_role(mk("Hello", sender="<someone@gmail.com>"))[0] == UNKNOWN_COMPANY


# --- auto-acknowledgements are not rejections; "unsuccessful" is -------------------

@pytest.mark.parametrize(
    "body",
    [
        "Thank you for your application. Due to the volume we receive, we are unable to offer individual feedback.",
        "Thank you for your application to the Data Analyst role. We cannot offer feedback on every application.",
        "We have received your application for the Data Analyst role. If you are not selected, we will keep your resume on file for future openings.",
    ],
)
def test_auto_acknowledgement_is_not_a_rejection(body):
    r = classify(mk("Thanks for applying to Acme", body, "Acme Careers <no-reply@greenhouse.io>"))
    assert r.related and r.event == "applied", r.reason


@pytest.mark.parametrize(
    "body",
    [
        "We have decided not to move forward with your application and, due to volume, are unable to provide individual feedback.",
        "We regret that your application was unsuccessful and we cannot give feedback.",
        "Thank you for your interest. Unfortunately, we are unable to offer you the position at this time.",
        "We regret to inform you that you have not been selected. We are unable to offer feedback, but we wish you luck.",
        "Your application was unsuccessful on this occasion.",
    ],
)
def test_real_rejections_still_reject(body):
    r = classify(mk("Update on your application", body, "Acme Careers <no-reply@greenhouse.io>"))
    assert r.related and r.event == "rejected", r.reason


@pytest.mark.parametrize(
    "sender,company",
    [("Careers <careers@jobs.rbc.ca>", "Rbc"), ("Jobs <jobs@mail.bmo.ca>", "Bmo"), ("Pat <pat@acme.com.au>", "Acme"), ("Pat <pat@uhn.on.ca>", "Uhn"),
     ("Pat <pat@acme.ltd.uk>", "Acme"), ("Pat <pat@acme.plc.uk>", "Acme"), ("Pat <pat@acme.sch.uk>", "Acme"), ("Pat <pat@acme.me.uk>", "Acme"),
     ("Pat <pat@acme.ne.jp>", "Acme"), ("Pat <pat@acme.or.jp>", "Acme"), ("Pat <pat@acme.go.jp>", "Acme"), ("Pat <pat@example.gc.ca>", "Example")],
)
def test_company_under_a_country_domain(sender, company):
    assert extract_company_role(mk("Hello", sender=sender))[0] == company
