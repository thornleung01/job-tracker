"""Golden fixtures for the TypeScript pipeline port.

    python scripts/export_fixtures.py            # rewrites web/tests/fixtures/pipeline-golden.json and python-export.golden.json
    python scripts/export_fixtures.py --check    # exit 1 if either committed file is out of date

web/tests/fixtures/python-export.json is the one input this script does not make: it is a snapshot of `scripts/seed_demo.py` run
through `scripts/export_json.py`, which stamps today's dates, so it cannot be rebuilt byte for byte. python-export.golden.json
(the Flow numbers and counts the local edition computes from that snapshot) is rebuilt from it here, at the moment recorded in
its "now" field, so a change to jobtracker/stats.py or contacts.py shows up as a drifted golden instead of going unnoticed.

The file records the Python and Unicode versions that made it. --check ignores the Python patch number (3.14.4 vs 3.14.5)
but not the minor version or the Unicode version: those can change what the functions return. Regenerate with the same
Python minor version the committed file names, and commit rules.json, unicodeTables.ts and the fixtures together.

Runs the real Python functions (jobtracker.classify / extract / mailtext / links / match) over a deterministic corpus and
stores {input, expected} per function. The corpus is built from (a) the subjects, bodies and senders the Python tests use,
(b) one sample sentence for every pattern in rules.yaml, (c) hand-written edge cases (non-ASCII, empty, very long, HTML-only,
forwarded chains, newsletters, malformed URLs) and (d) seeded random compositions of the above. Vitest asserts the TS port
returns exactly `expected` for every case (web/tests/pipeline/parity.test.ts).

Messages are stored in the TypeScript shape (camelCase, ISO receivedAt) from web/src/types.ts.
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
import unicodedata
import urllib.parse
import warnings
from datetime import datetime, timezone
from itertools import product
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from jobtracker import classify as C  # noqa: E402
from jobtracker import extract as E  # noqa: E402
from jobtracker import links as L  # noqa: E402
from jobtracker import mailtext as M  # noqa: E402
from jobtracker import match as MA  # noqa: E402
from jobtracker.learn import Learned  # noqa: E402
from jobtracker.models import Message  # noqa: E402

OUT = ROOT / "web" / "tests" / "fixtures" / "pipeline-golden.json"
PY_EXPORT = ROOT / "web" / "tests" / "fixtures" / "python-export.json"
PY_EXPORT_GOLDEN = ROOT / "web" / "tests" / "fixtures" / "python-export.golden.json"

NBSP, NNBSP, ZWSP, SHY, BOM, CGJ = "\xa0", "\U0000202F", "\U0000200B", "\xad", "\U0000FEFF", "\U0000034F"
EMDASH, ENDASH, MIDDOT = "\U00002014", "\U00002013", "\xb7"
COPY = "\xa9"


# --------------------------------------------------------------------------------------------------------------------
# helpers

def mk(subject="", body="", sender="Acme Careers <jobs@acme.com>", id="m1", thread="t1", day=1, bulk=False, html="", web_link=None):
    """Same shape as the helper the Python tests use: 'Name <addr>' or a bare address."""
    name, _, addr = sender.partition("<")
    return Message(
        id=id, thread_id=thread, sender_name=name.strip(),
        sender_email=(addr.rstrip(">") if addr else name).strip(),
        subject=subject, received_at=datetime(2026, 10, day, 12, 0, tzinfo=timezone.utc),
        body=body, html=html, bulk=bulk, web_link=web_link,
    )


def msg_json(m: Message) -> dict:
    return {
        "id": m.id, "threadId": m.thread_id, "senderName": m.sender_name, "senderEmail": m.sender_email,
        "subject": m.subject, "receivedAt": m.received_at.strftime("%Y-%m-%dT%H:%M:%S.000Z"), "body": m.body,
        "webLink": m.web_link, "html": m.html, "bulk": m.bulk,
    }


def learned_json(l: Learned | None):
    if l is None:
        return None
    return {"blockSenders": sorted(l.block_senders), "blockDomains": sorted(l.block_domains),
            "allowSenders": sorted(l.allow_senders), "distrust": sorted(l.distrust)}


def cls_json(c) -> dict:
    return {"related": c.related, "event": c.event, "confidence": c.confidence, "reason": c.reason}


def params(fn):
    """The argument tuples of a pytest.mark.parametrize on a test function in tests/."""
    for mark in getattr(fn, "pytestmark", []):
        if mark.name == "parametrize":
            return list(mark.args[1])
    raise LookupError(fn)


CASES: dict[str, list[dict]] = {}
MESSAGES: list[dict] = []          # every message once; cases refer to it by index
_MSG_INDEX: dict[str, int] = {}


def ref(m: Message) -> int:
    j = msg_json(m)
    key = json.dumps(j, sort_keys=True)
    if key not in _MSG_INDEX:
        _MSG_INDEX[key] = len(MESSAGES)
        MESSAGES.append(j)
    return _MSG_INDEX[key]


def add(fn: str, input_, expected) -> None:
    CASES.setdefault(fn, []).append({"input": input_, "expected": expected})


# --------------------------------------------------------------------------------------------------------------------
# message corpus

SENDERS = [
    "Acme Careers <jobs@acme.com>",
    "Acme <no-reply@us.greenhouse-mail.io>",
    "Initech Careers <no-reply@greenhouse.io>",
    "Initech <no-reply@lever.co>",
    "<acme@myworkday.com>",
    "<no-reply@ashbyhq.com>",
    "Hooli <no-reply@hooli.com>",
    "Pat Lee <pat@acme.com>",
    "Samantha Jones <sam@gmail.com>",
    "Stark Industries Recruiting <hr@stark.com>",
    "<hr@wayne.com>",
    "<someone@gmail.com>",
    "Globex Group <people@globex.co.uk>",
    "LinkedIn <jobs-noreply@linkedin.com>",
    "LinkedIn <jobalerts-noreply@linkedin.com>",
    "Indeed <alert@indeed.com>",
    "Medium Daily Digest <noreply@medium.com>",
    "StrataScratch Team <hello@stratascratch.com>",
    "Levels.fyi <hello@levels.fyi>",
    "Glassdoor <noreply@glassdoor.com>",
    "Deal Shop <deals@shop.com>",
    "Kick <no-reply@ats.rippling.com>",
    "Deel HQ Hiring Team <no-reply@deel.com>",
    "no-reply@instacart.com <no-reply@instacart.com>",
    "Jocelyn Ford <jocelyn.ford@doordash.com>",
    "\"Lee, Pat\" <pat@acme.co.jp>",
    "Caf\xe9 Cr\xe8me Careers <jobs@cafe-creme.fr>",
    "\U00004f1a\U0000793e\U0000306e\U00004eba\U00004e8b <hr@kaisha.jp>",
    "Mu\xe9ller & S\xf6hne GmbH <karriere@mueller-soehne.de>",
    "Acme Inc. Recruiting <recruiting@acme-inc.io>",
    "Team Ross Ltd <team@ross.ltd>",
    "TALENT TEAM <talent@bigco.com>",
    "<john.smith@initech.workable.com>",
    "<Jobs@Lever.co>",
    "Calendly <noreply@calendly.com>",
    "Weekly Newsletter <newsletter@careerco.io>",
    "Marketing Bot <marketing@x.io>",
    "Career Co <hello@careerco.io>",
    "Someone <someone@example.com>",
    "Quora Digest <hello@quora.com>", "Substack <writer@mail.substack.com>", "Recs <recommendations@jobs.example.com>",
    "<a@b>",
    "<@broken>",
    "No Address",
]

SUBJECTS = [
    "", "Thank you for applying to Acme", "Your application was sent to Acme", "Application received", "Update on your Acme application",
    "Your application", "Re: Data Analyst", "Interview invitation - Data Analyst", "Next steps", "Quick chat?", "Complete your assessment",
    "Next step: coding challenge", "Offer of employment", "Your offer letter", "Congratulations", "Special offer: 40% off",
    "Order update", "New jobs for you: Data Analyst", "Jobs you may like this week", "Weekly digest: hiring trends",
    "Your receipt", "A message from Acme", "Re: your application", "Hello", "Your application to Data Analyst at Globex",
    "Thank you for applying to Initech", "Update on your Hooli application", "Clio - Thank you for your application",
    "Application for the Senior Engineer position at Umbrella Corp!", "Your application for Product Manager | Toronto at Wayne Enterprises",
    "Jordan, your application was sent to Empire Life", "[Kick] Thanks for your application",
    "[Availability Request] DoorDash - Next Steps for Senior Associate, New Verticals - Canada Strategy & Operations  | Jordan Lee",
    "Thanks for applying to Caf\xe9 Cr\xe8me", "We\u2019ve received your application", "Your offer\u2019s attached",
    "Interview availability", "Invitation to interview", "Phone screen with Acme", "Schedule a call with our recruiter",
    "Unfortunately, we won\u2019t be moving forward", "RE: RE: Fwd: Your application status", "FW: Offer", "Application status: \U0001F389",
    "Product update", "Weekly roundup", "People are viewing your profile", "Hiring now: 12 openings", "daily digest of jobs",
    "Your Acme application \u2013 next steps", "Acme \u2014 thank you for your application", "Interview \u2192 Acme Corp",
    "Re: Application for Software Engineer role at Globex Corp.", "Your candidacy for the Account Executive role at Hooli",
    "Status regarding your Initech application", "Thank you for your interest in joining Deel!",
    "Next Steps for Senior Associate | Jordan Lee", "Confirmation: application submitted", "Take-home challenge from Acme",
    "HackerRank test invitation", "Your offer of employment with Acme", "Final interview details",
    "Job alert: 5 new roles", "Your recommended jobs", "Jobs similar to Data Analyst", "You appeared in 12 searches", "A" * 300, "Re: " * 40 + "hello",
]

SENTENCES = [
    "We have received your application.", "Thank you for applying to Acme.", "Thanks for your interest in the Data Analyst role at Acme.",
    "We will contact you if selected for an interview.", "Only candidates shortlisted will be contacted.",
    "We are unable to reply to every applicant.", "We regret to inform you that we will not be moving forward with your application.",
    "Unfortunately, we have decided to pursue other candidates.", "Unfortunately your parcel is delayed.",
    "We are pleased to offer you the position of Data Analyst at Acme.", "We are unable to extend an offer at this time.",
    "Please select a time that works for you: https://calendly.com/acme/30min", "We\u2019d like to schedule an interview with you.",
    "Are you free for a phone screen on Tuesday?", "Please complete the online assessment within 5 days.",
    "Take the take-home coding challenge on HackerRank.", "Your offer letter is attached; please sign by Friday.",
    "If you are selected, a recruiter will reach out.", "Should your profile match, we will be in touch for an interview.",
    "This is a newsletter about hiring trends and interview prep.", "Unsubscribe from these emails at any time.",
    "View this email in your browser.", "Manage your preferences or unsubscribe.", "Visit https://acme.com/?utm_source=mail&utm_medium=email",
    "You are receiving this email because you signed up.", "Special offer: 40% off career coaching.",
    "Best regards,", "Hi Jordan,", "Thanks,", "The Acme Talent Acquisition Team", "We appreciate your patience.",
    "Application for the Backend Engineer position at Umbrella Corp.", "Your application for our Associate Product Operations Manager role is under review.",
    "We have decided to move forward with other candidates for this role.", "The position has been filled.",
    "You are no longer being considered.", "We will not be proceeding forward with your candidacy.", "Your availability next week?",
    "Please speak with our hiring manager.", "Your offer\u2019s details are below.", "Congratulations on your offer of employment!",
    "We would love to hear from you.", "Caf\xe9 \u2014 r\xe9sum\xe9 re\xe7u.", "\U00004f1a\U0000793e\U0000306e\U00009762\U00006a5f\U0000306e\U00006848\U00005185",
    "Sent from my iPhone", "On Fri, Oct 23, 2026 at 4:49 PM Jordan Lee <jordan.lee@outlook.com> wrote:", "> Thanks for sending this over.",
    "-----Original Message-----", "From: Jordan Lee", "Sent: Thursday, October 22, 2026 6:43 PM", "Subject: Update",
    "EXT SENDER - be cautious", "\xa9 2026 LinkedIn Corporation", "This email was intended for Jordan Lee.", "Apply now to open roles.",
    "Interview reviews and salary data.", "Stories for you. Become a member.", "Hiring managers love this.",
    "- First point", "- Second point", "1. Step one", "2) Step two", "\u2022 A bullet",
    "Hello" + NBSP + "there" + NBSP, "Padding " + CGJ + " " + CGJ + " " + ZWSP + SHY + "text", "Fully" + BOM + "joined",
    "The role of a lifetime.", "Position of Data Scientist at Globex.", "Candidate for the Staff Engineer position at Initech, Inc.",
    "For the Senior Associate, New Verticals role at DoorDash!", "Applying to Acme Corp.",
    "ok", "", " ",
]

FRAGMENTS_SEPARATORS = [" ", "\n", "\n\n", "\r\n", " \n ", NBSP + "\n", "\n" + NBSP, "\t", "  ", "\n\n\n"]


def corpus_messages() -> list[Message]:
    """Messages for classify / extract / mailtext. Deterministic."""
    out: list[Message] = []

    # (a) the Python tests' own cases
    from tests import test_classify as tc, test_newsletters as tn, test_roles as tr, test_mailtext as tm
    for subject, body, _event in params(tc.test_events):
        out.append(mk(subject, body))
    out.append(mk("Congratulations", "Thank you for applying. We are pleased to offer you the role."))
    out.append(mk("Your application", "Thank you for applying. Unfortunately we will not be moving forward."))
    out.append(mk("Thanks for applying to Acme", "We received your application. We will contact you if selected for an interview."))
    out.append(mk("We received your application", "Thank you for applying. Unfortunately we are unable to reply to every applicant, "
                  "but we will be in touch if your profile is a good match."))
    # auto-acknowledgements that mention feedback or "not selected" (not rejections), and "unsuccessful" (a rejection)
    out.append(mk("Thanks for applying to Acme", "Thank you for your application. Due to the volume we receive, we are unable to offer individual feedback.",
                  sender="Acme Careers <no-reply@greenhouse.io>"))
    out.append(mk("Thanks for applying to Acme", "Thank you for your application. We cannot offer feedback on every application.",
                  sender="Acme Careers <no-reply@greenhouse.io>"))
    out.append(mk("Thanks for applying to Acme", "We have received your application. If you are not selected, we will keep your resume on file.",
                  sender="Acme Careers <no-reply@greenhouse.io>"))
    out.append(mk("Your application to Acme", "Your application was unsuccessful on this occasion.", sender="HR <hr@acme.com>"))
    for s in ("Careers <careers@jobs.rbc.ca>", "Jobs <jobs@mail.bmo.ca>", "Pat <pat@acme.com.au>", "Pat <pat@uhn.on.ca>"):
        out.append(mk("Hello", sender=s))
    out.append(mk("Special offer: 40% off", "Limited time offer on career coaching. Apply now.", sender="Deals <deals@shop.com>"))
    out.append(mk("Order update", "Unfortunately your parcel is delayed.", sender="Shop <orders@shop.com>"))
    for subject, sender in params(tc.test_alerts_and_digests_excluded):
        out.append(mk(subject, "Software Engineer at Acme, apply now", sender=sender))
    out.append(mk("Your receipt", "Thanks for your purchase", sender="Store <no-reply@store.com>"))
    out.append(mk("A message from Acme", "Hello there.", sender="Acme <no-reply@us.greenhouse-mail.io>"))
    out.append(mk("Re: your application", "Hi, quick question about your CV.", sender="Sam <sam@acme.com>"))
    for subject, sender, _c, _r in params(tc.test_extract_subject):
        out.append(mk(subject, sender=sender))
    out.append(mk("Application received", "Thanks for applying for the Backend Engineer position at Umbrella Corp. We will review it.",
                  sender="Recruiting <no-reply@myworkday.com>"))
    out.append(mk("Thank you for applying to Northwind", "We have received your application for the Data Engineer position at Northwind."))
    for s in ("Stark Industries Recruiting <hr@stark.com>", "<hr@wayne.com>", "<someone@gmail.com>"):
        out.append(mk("Hello", sender=s))
    for subject, body, sender, _c, _r in params(tr.test_roles_are_found_in_real_application_emails):
        out.append(mk(subject, body, sender))
    out.append(mk("Thank you for your Application to Clio!",
                  "Thank you for your application to Clio! Hi Jordan Thank you for your interest in Clio! Your application will be reviewed by our Talent Acquisition Team.",
                  "Clio <clio@myworkday.com>"))
    for sentence in params(tr.test_sentences_are_not_mistaken_for_roles):
        out.append(mk("Update", sentence[0] if isinstance(sentence, tuple) else sentence, sender="Acme <no-reply@acme.com>"))
    for body, _role in params(tr.test_roles_survive_odd_spaces_and_line_breaks):
        out.append(mk("Thanks for your application", body, sender="Acme <no-reply@acme.com>"))
    for subject, sender, body in params(tn.test_the_newsletters_that_became_applications_are_ignored):
        out.append(mk(subject, body, sender))
    out.append(mk("Your weekly career boost", "We would like to schedule an interview prep session! Read more: https://x.io/?utm_medium=email Unsubscribe",
                  "Career Co <hello@careerco.io>"))
    nl = "We would like to schedule an interview with you. Please reply with your availability."
    out.append(mk("Next steps", nl, "Pat <pat@acme.com>"))
    out.append(mk("Next steps", nl, "Pat <pat@acme.com>", bulk=True))
    out.append(mk("Your application was sent to Acme Corp", "Thanks for your interest. Manage your preferences or unsubscribe at any time.",
                  "LinkedIn <jobs-noreply@linkedin.com>"))
    out.append(mk("Interview invitation", "We'd like to invite you to an interview for the Data Analyst role. Unsubscribe from these emails.",
                  "Acme Recruiting <no-reply@greenhouse.io>"))
    out.append(mk("Re: your application", "We would like to schedule an interview next week.", "Pat <pat@acme.com>"))
    out.append(mk("Next steps", "We would like to schedule an interview with you for the analyst role.", "Pat Lee <pat@acme.com>"))
    out.append(mk("Thank you for applying to Acme", "We received your application for the Data Analyst role.", "Acme Careers <jobs@acme.com>"))
    out.append(mk("Interview invitation", "We'd like to invite you to an interview for the Data Analyst role at Acme.", "Acme Recruiting <no-reply@greenhouse.io>"))
    # the bodies the mailtext tests use, as mail
    out.append(mk("Reply", tm.DEEL, "Sam <sam@deel.com>"))
    out.append(mk("Newsletter", tm.NEWSLETTER, "LinkedIn <jobs-noreply@linkedin.com>"))
    out.append(mk("Update From Deel", tm.OUTLOOK_HEADER, "Sam <sam@deel.com>"))

    # (b) one sentence per rule pattern, with an ATS sender, a company sender, and the sentence in subject vs body
    for phrase in PHRASES:
        for sender in ("Acme <no-reply@greenhouse.io>", "Pat Lee <pat@acme.com>", "Samantha <sam@gmail.com>"):
            out.append(mk(phrase, "", sender))
            out.append(mk("Update on your application", phrase, sender))
    for phrase in PHRASES[::3]:
        out.append(mk("Your application to Data Analyst at Globex", phrase + " Unsubscribe.", "Pat Lee <pat@acme.com>"))
        out.append(mk("Weekly roundup", phrase, "Pat Lee <pat@acme.com>", bulk=True))

    # (c) edge cases
    long_body = ("We have received your application. " * 600) + "Thank you for applying to Acme."
    out += [
        mk("", ""), mk(" ", " "), mk("\n", "\n"), mk("Thank you for applying to Acme", ""),
        mk("", "Thank you for applying to Acme. We received your application for the Data Engineer role at Acme."),
        mk("Hi", "x" * 20000), mk("Thank you for applying to Acme", long_body, "Acme <no-reply@greenhouse.io>"),
        mk("Interview", "We would like to schedule an interview. " + "pad " * 5000),
        mk("Application", "<html><body><p>Thank you for applying to <b>Acme</b>.</p></body></html>", html="<html><body><p>Thank you for applying</p></body></html>"),
        mk("Thank you for applying", "", html="<p>We received your application for the Data Analyst role at Acme.</p>"),
        mk("Fwd: Your application", "---------- Forwarded message ---------\nFrom: Acme Careers <jobs@acme.com>\nDate: Mon, Oct 5, 2026\nSubject: Interview invitation\n\nWe would like to schedule an interview."),
        mk("Re: Interview", "Sounds great, see you then.\n\nOn Mon, Oct 5, 2026 at 9:00 AM Acme Careers <jobs@acme.com> wrote:\n> We would like to schedule an interview.\n> Please select a time."),
        mk("Re: Offer", "Thanks!\n\n-----Original Message-----\nFrom: HR\nSent: Monday\nSubject: Offer\n\nWe are pleased to offer you the role."),
        mk("R\xe9ponse", "Merci.\n\nLe lun. 5 oct. 2026 \xe0 09:00, Acme <jobs@acme.com> a \xe9crit :\n> Nous souhaitons planifier un entretien."),
        mk("Application " + EMDASH + " Acme", "Thanks for applying to Acme " + ENDASH + " we\u2019ll be in touch."),
        mk("Thank you for applying to Caf\xe9 Cr\xe8me", "We\u2019ve received your application for the \u00c9quipe Lead role at Caf\xe9 Cr\xe8me."),
        mk("Thank you for applying to \u0130stanbul Tech", "We have received your application.", "<hr@istanbul.com.tr>"),
        mk("Thanks for applying to \u00dftra\u00dfe GmbH", "We have received your application for the Ingenieur role at \u00dftra\u00dfe GmbH.", "<jobs@strasse.de>"),
        mk("Thank you for applying to \U0001F680 Rocket Co", "We received your application for the \U0001F9D1\u200d\U0001F4BB Developer role at \U0001F680 Rocket Co."),
        mk("Thank you for applying", "We have received your application for the Data Analyst position at " + "Very Long Company Name " * 10 + "."),
        mk("Thank you for applying to " + "X" * 100, "We received your application."),
        mk("Thank you for applying to Acme", "We have received your application for " + "Senior " * 15 + "Engineer role."),
        mk("Application", "Your application was sent to Acme Corp " + "\U0000034F " * 40 + "Your application was sent to Acme Corp Process Analyst Acme Corp " + MIDDOT + " Ontario Applied on October 5",
           "LinkedIn <jobs-noreply@linkedin.com>"),
        mk("Application", "Your application was sent to Acme Corp. Your application was sent to Acme Corp Process Analyst Acme Corp " + MIDDOT + " Remote",
           "LinkedIn <jobs-noreply@mail.linkedin.com>"),
        mk("Application", "Your application was sent to A.C.M.E (Canada) Inc. Your application was sent to A.C.M.E (Canada) Inc. Senior Analyst A.C.M.E (Canada) Inc. " + MIDDOT + " Remote",
           "LinkedIn <jobs-noreply@linkedin.com>"),
        mk("Your application was sent to Foo & Bar #1 ~ Co", "Your application was sent to Foo & Bar #1 ~ Co Analyst Foo & Bar #1 ~ Co " + MIDDOT + " x", "LinkedIn <jobs-noreply@linkedin.com>"),
        mk("Thank you for applying to Acme", "Hello" + NBSP + "there. We" + NBSP + "received" + NBSP + "your" + NBSP + "application."),
        mk("Thank you for applying to Acme", "We\u2009received\u2003your\u3000application."),
        mk("Thank\u200b you for applying to Acme", "We\ufeffreceived your application for the Data\u00adAnalyst role."),
        mk("THANK YOU FOR APPLYING TO ACME", "WE HAVE RECEIVED YOUR APPLICATION FOR THE DATA ANALYST POSITION AT ACME."),
        mk("\u0422\u0430\u043a \u0441\u043a\u0430\u0437\u0430\u0442\u044c", "\u041c\u044b \u043f\u043e\u043b\u0443\u0447\u0438\u043b\u0438 \u0432\u0430\u0448\u0443 \u0437\u0430\u044f\u0432\u043a\u0443 application."),
        mk("applic\u00e1tion", "\u00e9unsubscribe\u00e9 interview"),
        mk("Newsletter", "interview \u00e9unsubscribe", "<x@y.com>"),
        mk("Interview invitation", "x\u00e9unsubscribe", "<x@y.com>"),
        mk("Thank you for applying to Acme", "We have received your application.", "Acme <no-reply@greenhouse.io>", bulk=True),
        mk("Weekly Update", "This email was sent via utm_source=x. Interview.", "Pat <pat@acme.com>"),
        mk("We regret to inform you", "", "<a@b.com>"), mk("Offer", "We are unable to extend an offer. We cannot offer you the role.", "<a@b.com>"),
        mk("Your application", "We are not able to offer you a position. Unfortunately, we won\u2019t be extending an offer.", "Pat <pat@acme.com>"),
        mk("Your application", "We aren't currently in a position to extend an offer, but your application is valued.", "Pat <pat@acme.com>"),
        mk("Offer", "If you do not accept this offer by Friday the job offer expires. We are pleased to offer you the role.", "Pat <pat@acme.com>"),
        mk("Your application", "Not unfortunately you are not not moving forward.\nUnfortunately, regarding your application, we will not proceed.", "Pat <pat@acme.com>"),
        mk("Your application", "Unfortunately " + "x" * 250 + " your application", "Pat <pat@acme.com>"),
        mk("Interview", "invited you to attend: Zoom interview", "Pat <pat@acme.com>"),
        mk("Interview", "invited you to attend:\n" + "x" * 50 + " interview", "Pat <pat@acme.com>"),
        mk("Your recruiter", "Hi,\nI'm a recruiter at Acme.\nCan we talk?", "Rec <rec@acme.com>"),
        mk("Your application", "Hi, quick question.", "Sam <sam@acme.com>"),
        mk("Hello", "Interview?", "Sam <sam@acme.com>"),
        mk("App", "Applied for the job position", "Sam <sam@acme.com>"),
        mk("App", "I applied to the position of analyst at Acme, as a candidate.", "Sam <sam@acme.com>"),
        mk("App", "Students who applied for financial assistance. Hiring.", "Sam <sam@acme.com>"),
    ]
    out += [mk(s, "", SENDERS[i % len(SENDERS)]) for i, s in enumerate(SUBJECTS)]
    out += [mk(SUBJECTS[(i * 7) % len(SUBJECTS)], SENTENCES[i % len(SENTENCES)], SENDERS[(i * 5) % len(SENDERS)]) for i in range(len(SENDERS) * 4)]

    # (c2) extraction: templates x company/role names (punctuation, accents, emoji, length) x senders
    out += extraction_messages()

    # (d) seeded random compositions
    rng = random.Random(20261103)
    for n in range(420):
        subject = rng.choice(SUBJECTS)
        parts_ = [rng.choice(SENTENCES) for _ in range(rng.randint(0, 5))]
        body = ""
        for p in parts_:
            body += (rng.choice(FRAGMENTS_SEPARATORS) if body else "") + p
        sender = rng.choice(SENDERS)
        out.append(mk(subject, body, sender, id=f"r{n}", thread=f"th{n % 17}", day=1 + n % 28, bulk=rng.random() < 0.08))
    return out


COMPANIES = ["Acme", "Globex Corp", "Umbrella Corp.", "Caf\xe9 Cr\xe8me", "Stra\xdfe GmbH", "O'Reilly & Sons", "Foo-Bar Inc", "A.C.M.E (Canada)", "Initech, Inc.", "\U0001F680 Rocket",
             "\u30c1\u30e3\u30c3\u30c8 K.K.", "Wayne Enterprises Ltd", "X" * 70, "Hooli | Labs", "Data Co", "Big Bank of Canada", "Zo\xeb's Studio", "Nike", "3M", "AT&T"]
ROLES = ["Data Analyst", "Senior Software Engineer", "Operations Manager | NAM", "Customer Experience Lead, Business Owner", "Product Manager (Growth)", "Ing\xe9nieur Logiciel",
         "Associate Product Operations Manager", "VP of Sales", "Staff Engineer - Platform", "Intern", "Barista", "Senior Associate, New Verticals - Canada Strategy & Operations",
         "Account Executive (EMEA)", "x " * 12 + "Lead", "Data Scientist II", "Customer Support Specialist", "\U0001F9D1\u200d\U0001F4BB Developer"]
TEMPLATES = [
    ("Thank you for applying to {c}", ""), ("Your application to {r} at {c}", ""), ("Your application for the {r} position at {c}!", ""),
    ("Application received", "We have received your application for the {r} position at {c}. We will review it."),
    ("Thanks for applying", "Thanks for applying for the role of {r} at {c}."), ("Update", "Applied for the {r} role with {c}, thanks."),
    ("Re: your application", "Thank you for your interest in {c}. Your application for our {r} role is being reviewed."),
    ("Update on your {c} application", ""), ("{c} - Thank you for your application", ""), ("{c}: next steps for the {r} | Jordan", ""),
    ("Interview", "We would like to consider the {r} position at {c} further. Please select a time."),
    ("Hello", "Regarding your candidacy for the {r} role. We are the {c} team."), ("Hi", "Your status regarding your {c} application."),
    ("Thanks", "Thank you for applying to {c}! We received your application. As an {r} position holder you will..."),
    ("Thank you for your application", "We have received your application to {c}.\nThe {r} role\nremains open."),
    ("Next Steps for {r} | Jordan Lee", "invited you to attend: Zoom Interview"),
]
EXTRACT_SENDERS = ["{c} Careers <no-reply@greenhouse.io>", "Recruiting <no-reply@lever.co>", "{c} <hr@acme.com>", "Pat Lee <pat@gmail.com>", "<jobs@globex.co.uk>", "LinkedIn <jobs-noreply@linkedin.com>"]


def extraction_messages() -> list[Message]:
    rng = random.Random(31337)
    out = []
    for i, (c, r) in enumerate(product(COMPANIES, ROLES)):
        if i % 3 and i % 7:
            continue
        subj, body = TEMPLATES[(i * 5) % len(TEMPLATES)]
        sender = EXTRACT_SENDERS[i % len(EXTRACT_SENDERS)].format(c=c)
        out.append(mk(subj.format(c=c, r=r), body.format(c=c, r=r), sender))
    for c, r in product(COMPANIES[:10], ROLES[:6]):
        for subj, body in TEMPLATES:
            if rng.random() < 0.25:
                out.append(mk(subj.format(c=c, r=r), body.format(c=c, r=r), rng.choice(EXTRACT_SENDERS).format(c=c)))
    for r in ROLES:  # LinkedIn "your application was sent" shapes
        for c in COMPANIES[:8]:
            body = f"Your application was sent to {c} {CGJ} " * 3 + f"Your application was sent to {c} {r} {c} {MIDDOT} Ontario, Canada (Remote) Applied on October 5, 2026"
            out.append(mk(f"Jordan, your application was sent to {c}", body, "LinkedIn <jobs-noreply@linkedin.com>"))
    return out


# one sentence for every pattern in rules.yaml, so each can be shown to fire (coverage reported below)
PHRASES = [
    "We are pleased to offer you the role.", "We are delighted to extend this opportunity.", "Happy to offer a place on the team.",
    "We would like to extend you a formal offer.", "We would like to extend an offer.", "We would like to extend you a verbal offer.",
    "Attached is the offer of employment.", "Your employment offer is attached.", "Please find your offer letter below.",
    "Please review the employment agreement.", "Thank you for accepting your offer.", "This is a formal offer.", "We sent the job offer.",
    "We would like to offer you the position.", "Regarding your offer, please reply.",
    "We regret to inform you that we are moving on.", "We regret to tell you about our decision.", "We will not be moving forward.",
    "We are unable to proceed forward.", "We cannot move forward with you.", "We have decided to move forward with other candidates.",
    "We have decided to go with another applicant.", "We chose other candidates.", "We will pursue other candidates.",
    "We are moving forward with other applicants.", "There were other candidates whose experience was closer.",
    "Other candidates who more closely match the requirements.", "Your profile does not more closely align.", "You were not selected.",
    "You have not been selected.", "The position has been filled.", "The position was filled.", "You are no longer being considered.",
    "You are no longer under consideration.", "We are unable to offer you the role.", "We are unable to extend the role.",
    "We are unable to advance your application.", "We cannot extend an offer.", "We cannot offering.", "We won't be able to offer a role.",
    "We've decided not to continue.", "We have decided not to proceed.", "We are declining your application.", "We decline your application.",
    "You are not a good match for this role.", "This is not a fit for this role.", "Not a match at this time.",
    "Unfortunately, after review of your application we will stop.", "Your application, unfortunately, was not successful.",
    "The role was, unfortunately, closed.", "Unfortunately the position is no longer available.",
    "We would like to schedule a call.", "Please schedule an interview.", "Let's schedule your chat.", "Can we schedule the quick conversation?",
    "We want to invite you to a call.", "We would like to invite you to an interview.", "We invite you to speak with the team.",
    "Your interview invitation is attached.", "Interview scheduled for Monday.", "Interview confirmation below.", "Interview availability needed.",
    "We'd love to interview you.", "We want to speak with you.", "We'd like to chat with you.", "We want to talk with you.",
    "We would like to invite you to meet the team.", "There is a phone screen on Tuesday.", "Join the video interview.", "A virtual interview awaits.",
    "The onsite interview is booked.", "Your technical interview is Monday.", "Panel interview details.", "Final interview details.", "The zoom interview link.",
    "Phone interview.", "A recruiter screen interview.", "A home task interview.", "A hiring manager interview.", "A case interview.",
    "Interview prep materials below.", "Jocelyn has invited you to attend: DoorDash Zoom Interview", "Jocelyn invited you to attend: Round 1 interview",
    "We are moving you forward.", "We are move you forward to the next step.", "Next stage of the interview process.", "Next stage of our process.",
    "Welcome to the next round.", "Please select a time.", "Please select a slot.", "Book at calendly.com/acme", "Please send your availability.",
    "We would like to speak with you.", "You will speak with our team.",
    "Please take the online assessment.", "A coding challenge awaits.", "A coding assessment awaits.", "A coding test awaits.", "A coding exercise awaits.",
    "Complete the take-home.", "A take home task.", "Please use HackerRank.", "Codility link inside.", "A CodeSignal test.", "TestGorilla invite.",
    "Pymetrics games.", "Criteria Corp test.", "Complete the assessment.", "Take this test.", "Start your assessment.", "Start the short coding challenge.",
    "Complete the skill test.", "Complete the skills assessment.", "A skill test.", "A case study is attached.",
    "Thank you for applying.", "Thanks for applying.", "Thanks for your application.", "Thank you for your interest.", "We received your application.",
    "We've received your application.", "We have got your application.", "We got your application.", "Application received.", "Application submitted.",
    "Application confirmation.", "Application complete.", "Your application to Acme.", "Your application for the role.", "Your application was sent.",
    "Your application has been received.", "Your application has been submitted.", "Your application was received.", "Successfully submitted.",
    "Successfully applied.", "Application was sent to Acme.",
    "If you're selected for an interview we will reach out.", "If you are a good match we will contact you.", "If selected, we will call.",
    "We can't reply to everyone.", "We cannot respond individually.", "We are unable to contact all applicants.", "We will only contact you if there is interest.",
    "Only those selected will be contacted.", "Only candidates shortlisted will hear from us.", "Should your application be selected for interview, we will tell you.",
    "Should we decide to interview you, expect an email.", "If your profile is a strong fit we will reply.",
    "We are not able to extend an offer.", "We never extend offers by email.", "We won't be in a position to extend this.", "Unfortunately, we cannot offer this.",
    "We recruit through our hiring team: talent acquisition and human resources.", "Opening: vacancy for a role. Candidacy review.",
    "Applying for the job at Acme.", "I applied to this position at Acme, Inc.", "Our recruiter will contact you.", "The hiring manager will review.",
    "Hiring team here.", "Talent acquisition reviewed it.",
]


# --------------------------------------------------------------------------------------------------------------------
# the cases

def build_classify(msgs: list[Message]) -> None:
    for m in msgs:
        add("classify", {"msg": ref(m), "learned": None}, cls_json(C.classify(m)))
    # learned variants
    rng = random.Random(7)
    variants = [
        Learned(block_senders=frozenset({"pat@acme.com", "jobs@acme.com", "sam@gmail.com"})),
        Learned(block_domains=frozenset({"acme.com", "greenhouse.io", "linkedin.com"})),
        Learned(allow_senders=frozenset({"pat@acme.com", "hello@careerco.io", "someone@example.com", "deals@shop.com"})),
        Learned(block_domains=frozenset({"acme.com"}), allow_senders=frozenset({"pat@acme.com"})),
        Learned(),
    ]
    for m in msgs[:300]:
        v = rng.choice(variants)
        add("classify", {"msg": ref(m), "learned": learned_json(v)}, cls_json(C.classify(m, v)))
    # distrust: whatever reason each message got is distrusted
    for m in msgs[::6]:
        r = C.classify(m)
        v = Learned(distrust=frozenset({r.reason}))
        add("classify", {"msg": ref(m), "learned": learned_json(v)}, cls_json(C.classify(m, v)))
        v2 = Learned(distrust=frozenset({r.reason}), allow_senders=frozenset({C.Message.sender_domain.fget(m) and m.sender_email.lower()}))
        add("classify", {"msg": ref(m), "learned": learned_json(v2)}, cls_json(C.classify(m, v2)))


def build_text_cases(msgs: list[Message]) -> None:
    for text in sorted({m.subject for m in msgs} | {m.body for m in msgs if len(m.body) < 3000})[::3]:
        add("stripConditionals", text, C.strip_conditionals(text))
        add("stripNegatedOffers", text, C.strip_negated_offers(text))
    for d in ["greenhouse.io", "us.greenhouse-mail.io", "GREENHOUSE.IO", "evilgreenhouse.io", "greenhouse.io.evil.com", "lever.co", "x.lever.co", "acme.com",
              "", "myworkday.com", "wd5.myworkday.com", "ats.rippling.com", "rippling.com.", "successfactors.eu", "gmail.com", "Workable.COM", "a.b.c.workday.com"]:
        add("isAtsDomain", d, C.is_ats_domain(d))


def build_extract(msgs: list[Message]) -> None:
    for m in msgs:
        c, r = E.extract_company_role(m)
        add("extractCompanyRole", ref(m), [c, r])
        add("senderCompany", ref(m), E._sender_company(m))
    for text in sorted({m.subject for m in msgs} | {m.body for m in msgs if len(m.body) < 600})[::3]:
        add("tidy", text, E._tidy(text))
    values = [None, "", " ", "  Acme   Corp  ", "\"Acme\"", "-Acme-", "..Acme!!", "Acme" + ENDASH, ENDASH + "Acme", "a" * 100, "Acme " + "b" * 70,
              "\U0001F680" * 70, "x\U0001F680" * 40, "Caf\xe9\n Cr\xe8me", "  :;,.!  ", "Data\tAnalyst", "Acme" + NBSP + "Corp", "\u3000Acme\u3000", " \x1c Acme \x1f "]
    for v in values:
        for limit in (60, None, 10, 1):
            add("cleanValue", {"value": v, "limit": limit}, E._clean(v, limit) if limit is not None else E._clean(v, None))
    roles = ["Data Analyst", "Data Analyst position", "Data Analyst role", "Data Analyst Opening", "senior   engineer  VACANCY", "Engineer job", "the Data Analyst",
             "A Lifetime", "an engineer", "my role", "your job", "our team", "Theatre Manager", "Another Manager", "Analyst, Ops", "Analyst. Ops", "Analyst? Ops",
             "Analyst: Ops", "Analyst; Ops", "Analyst! Ops", "I am an analyst", "We hire", "Manager of us", "Business Owner", "Operations Manager | NAM", "x " * 11,
             "x " * 10, "y" * 81, "y" * 80, "\U0001F680 Rocket Engineer", "Fr\xe9d\xe9ric Lead", "", None, "Position", "role", "Associate Product Operations Manager",
             "Customer Experience Lead, Business Owner", "Senior Associate, New Verticals - Canada Strategy & Operations", "Youth Counsellor", "Me", "Our", "ours"]
    for r in roles:
        add("cleanRole", r, E._clean_role(r))
    for company in ["Acme", "Acme Corp", "Empire Life", "A.C.M.E (Canada) Inc.", "Foo & Bar #1 ~ Co", "Foo-Bar", "Caf\xe9 Cr\xe8me", "", "x" * 40]:
        for body in ["", f"sent to {company} Process Analyst {company} {MIDDOT} Ontario",
                     f"Your application was sent to {company} Your application was sent to {company} Senior Dev {company} {MIDDOT} Remote",
                     f"sent to {company} Analyst sent to {company} Engineer {company}{MIDDOT} x", f"SENT TO {company.upper()} Analyst {company.upper()} {MIDDOT}"]:
            for sender in ("LinkedIn <jobs-noreply@linkedin.com>", "LinkedIn <j@mail.linkedin.com>", "X <j@notlinkedin.com>", "X <j@linkedin.com.evil.io>"):
                m = mk("s", body, sender)
                add("linkedinRole", {"sender": sender, "body": body, "company": company}, E._linkedin_role(m, body, company))
    names = ["Acme", "Acme, Inc.", "Acme Inc", "Acme Incorporated", "ACME LLC", "Acme Limited.", "Globex Corporation", "Hooli Co.", "Co", "Company", "Initech GmbH",
             "Plc", "Umbrella Corp", "Unknown company", "", "Caf\xe9 Cr\xe8me", "Stra\xdfe GmbH", "\u0130stanbul", "Fa\u00e7ade Corp", "\u0391\u0392\u03a3", "\u03a3\u03af\u03c3\u03c5\u03c6\u03bf\u03c2",
             "\uff21\uff23\uff2d\uff25", "\u30c1\u30e3\u30c3\u30c8", "\u30ac\u30ea\u30d0\u30fc", "\ud55c\uae00 Inc", "Acme" + ZWSP + "Co", "A.C.M.E.", "Foo & Bar", "e\u0301clair", "\u00e9clair",
             "\U0001F680 Rocket Inc", "Zo\u00eb", "\u212a Kelvin Co", "\ufb01nance Co", "ǅ", "ǆ", "\u1e9e", "\u017f", "a\u030a", "Ωmega", "inc", "corporation corporation", "Smith & Co. LLC"]
    for n in names:
        add("companyKey", n, E.company_key(n))
        add("roleKey", n, E.role_key(n))
        add("fold", n, E._fold(n))
    add("roleKey", "Unknown role", E.role_key("Unknown role"))


def hash_pick(b: str) -> bool:
    return sum(map(ord, b)) % 4 == 0


def build_mailtext(msgs: list[Message]) -> None:
    from tests import test_mailtext as tm
    bodies = [tm.DEEL, tm.NEWSLETTER, tm.OUTLOOK_HEADER]
    bodies += [m.body for m in msgs if len(m.body) < 4000]
    bodies += [
        "", "   \n  ", "\n\n\n", "hello", "Hi there", "> Hi there\n> thanks for applying",
        "Having trouble viewing? View this email online.\n\nWe would like to invite you to interview for the analyst role at Acme next week.",
        "<script>alert(1)</script> hello\n\nSee https://evil.example.com/?x=\"><img src=x onerror=alert(1)> now",
        "Hi Jordan,\nPlease see:\n- One\n- Two\n- Three\nThanks,\nSam", "Steps:\n1. First\n2) Second\n3. Third", "\u2022 A\n\u2022 B\n" + ENDASH + " C",
        "Hello\r\nWorld\r\n\r\nNew paragraph", "Line one\rLine two", "a" * 400 + "\nUnsubscribe here", "a" * 149 + "\nUnsubscribe here", "a" * 150 + "\nunsubscribe",
        "a" * 100 + "\n\n" + "b" * 60 + "\n\nView this email online",
        "Real content " * 15 + "\n\n" + COPY + " 2026 LinkedIn Corporation\n\nOther",
        "Hello,\nOn Mon, Oct 5, 2026 at 9:00 AM Pat <pat@x.com> wrote:\nHi\nOn Tue, Oct 6 Pat wrote:\nHi again",
        "Hi\n\nLe lun. 5 oct. 2026 \xe0 09:00, Acme <jobs@acme.com> a \xe9crit :\n> Bonjour",
        "Hi\n\n-----Original Message-----\nFrom: A\nTo: B",
        "Hi\n\n--- Original Message ---\nFrom: A", "Hi\n\n> quoted\n> more", "Hi\nFrom: A <a@b.com>\nSent: Monday\nTo: B\nSubject: X\nbody",
        "Hi\nFrom: A <a@b.com>\nDate: Monday\nTo: B\nSubject: X\nbody", "Hi\nDe: A\nEnvoy\xe9: lundi\n\xc0: B\nObjet: X", "Hi\nFrom: A <a@b.com>\nTo: B\nbody",
        "Hello\n\nFrom:\nA <a@b.com>\nSent:\nMonday\nTo:\nB\nSubject:\nS\nBody here",
        "EXT SENDER" + ENDASH + " Be cautious\nHi\nCAUTION: This email originated outside\n[EXTERNAL] hello\nexternal sender: ok",
        "Hi Jordan,\nthanks\nfor\nyour\ninterest.\nBest,\nSam", "Hello,\nthere\nHi,\nthere", "Short,\nline", "A line ending with a long comma-separated list of things,\nnext line",
        "Referrals:\nyou get a bonus\nOther:\nUpper start", "Term:\nlower start\nTerm2:\n(paren)", "Sentence.\nNew sentence\nQuestion?\nAnother", "He said \"hi.\"\nThen left",
        "Item\n:\ncolon next\n,comma\n;semi\n)paren\n.dot\n?question", "-\nBullet next\n\u2022\nBullet next 2\n*\nstar\n" + ENDASH + "\ndash",
        "Hello" + NBSP + "world" + NNBSP + "x" + ZWSP + "y" + CGJ + "z" + SHY + "w" + BOM + "v",
        "See ( https://example.com/a?b=c ) and [https://example.org/x] now.", "Visit https://www.example.com/path. Then https://example.com/a,b; and (https://x.io/y).",
        "HTTPS://WWW.EXAMPLE.COM/UP http://localhost:8080/x http://user:pw@host.example:99/p http://[::1]:80/x http://[abc/x http://abc]/x http://[v1.x]/y",
        "http://[::1]/ http://[2001:db8::1]/ http://[fe80::1%25eth0]/ http://[1.2.3.4]/ http://[::ffff:1.2.3.4]/ http://[:::1]/ http://[1:2:3:4:5:6:7:8]/ http://[1:2:3:4:5:6:7:8:9]/",
        "http:// https:// http:///path https://?q=1 https://#frag https://a@/x https://:80/x https://\uff21.example/ https://exa\uff0fmple.com/ https://\u2100.com/x https://caf\xe9.example/",
        "https://a.b/c?d=e&f=g#h https://example.com/" + "p" * 500 + " https://example.com/'quoted' https://example.com/\"dq\" https://example.com/a<b>c",
        "mailto:x@y.com ftp://x.y/z www.example.com not-a-url:// httpx://nope http:/one-slash",
        "<b>bold</b> & \"quotes\" 'single' > greater < less &amp; entity", "Tom & Jerry's \"show\" <3",
        "Para one.\n\nPara two\nwraps here.\n\n\n\nPara three.", "Para one.\n \t \nPara two.", "   leading spaces\n\ttabs\there  ", "x\n" * 300,
        "Caf\xe9 \u2014 r\xe9sum\xe9 re\xe7u.\n\n\U0001F680 launch \U0001F389\n\n\u4f1a\u793e\u306e\u6848\u5185", "Dear Candidate,\nWe are pleased.\nKind regards,\nTeam",
        "Hello there\n\nGood morning Jordan,\nBody text.\nSincerely,\nCo", "Hi,\nHey you!\nDear Sir,\nHello world, this is a long salutation that exceeds the limit of forty chars!",
        "Thanks!\nThank you.\nMany thanks\nTalk soon\nCheers,\nRegards,\nBest regards", "Thanks\nfor your help", "On Fri, Oct 23, 2026 at 4:49 PM Jordan Lee wrote:\nHi",
        "On Fri,\nOct 23, 2026 at 4:49 PM\nJordan Lee <\njordan.lee@outlook.com\n> wrote:\nHi",
        "On October 5 Pat wrote:\nThanks", "Text\nOn Mon Pat wrote:\nx", "Text\nLe 5 oct a \xe9crit:\nx", "Text\nLe lun 5 oct a \xe9crit :\nx",
    ]
    seen = set()
    uniq = []
    for b in bodies:
        if b not in seen:
            seen.add(b)
            uniq.append(b)
    rng = random.Random(99)
    for _ in range(260):
        n = rng.randint(1, 9)
        b = ""
        for _i in range(n):
            b += (rng.choice(FRAGMENTS_SEPARATORS + ["\n", "\n", "\n\n"]) if b else "") + rng.choice(SENTENCES + [tm.DEEL.split("\n")[rng.randrange(8)]])
        if b not in seen:
            seen.add(b)
            uniq.append(b)
    for b in uniq:
        if len(uniq) < 400 or hash_pick(b):
            add("blocks", b, M._blocks(b))
        add("parts", b, [list(p) for p in M.parts(b)])
        add("render", b, str(M.render(b)))
    for b in [None]:
        add("parts", b, [list(p) for p in M.parts(b)])
        add("render", b, str(M.render(b)))
    # inline: every sentence with url-ish content, plus the odd ones
    for t in [s for s in uniq if "http" in s or "&" in s or "<" in s][:80] + ["", "x"]:
        add("inline", t, M._inline(t))
    # joins on pairs of lines
    lines = ["Hi Jordan,", "Hello", "Best,", "Thanks", "From:", "Sent:", "To:", "Subject:", "From: A", "Date: Monday", "-", "\u2022", ENDASH, "*", "x", "Referrals:", "you get a bonus",
             "Upper", ":colon", ",comma", ";semi", ")paren", ".dot", "?q", "Done.", "Done!", "Done?", "Done:", "Done.\"", "Done.')", "a,", "twenty four chars exactly,", "twenty-five chars exactly,x",
             "- item", "1. item", "12) item", "123. item", "On Mon, Oct 5 Pat wrote:", "On Mon", "Le 5 oct", "Le lundi 5", "From: ", "good evening", "Dear Team,",
             "Envoy\xe9:", "\xc0:", "Objet:", "De:", "Bcc:", "\U0001F680 emoji", "\u00c9cole", "\xe9cole", "\u01c5x", "\u1fbc"]
    for a, b in product(lines, lines):
        add("joins", [a, b], M._joins(a, b))
    for s in [None, "", "  ", "Pat Lee <pat@acme.com>", '"Lee, Pat" <pat@acme.com>', "pat@acme.com <pat@acme.com>", "pat@acme.com", "Pat", " Pat Lee  <  pat@acme.com  > ",
              "Pat <pat@acme.com", "Pat <<pat@acme.com>>", "<pat@acme.com>", "\"Pat\" <pat@a.com>>", "A <b> <c>", "Pat >", "@", "a@", "\u00c9mile <e@x.fr>", "Pat\u3000Lee <p@x.co>", '""<a@b.c>',
              "\x1c Pat <a@b>\x1f", "pat@acme.com ", "Name Only", "Name <>", "<>"]:
        add("splitSender", s, list(M.split_sender(s)))


def build_urls() -> None:
    urls = [
        "https://example.com", "https://www.example.com/a", "HTTP://WWW.EXAMPLE.COM", "http://www.www.example.com", "https://WWW.Example.Com:8080/x?y#z",
        "https://user:pw@host.example:99/p", "https://user@host", "https://a@b@host.example/", "http://[::1]/", "http://[::1]:80/x", "http://[2001:db8::1]:443/",
        "http://[fe80::1%25eth0]/", "http://[fe80::1%eth0]/", "http://[fe80::1%]/", "http://[1.2.3.4]/", "http://[::ffff:1.2.3.4]/", "http://[::ffff:1.2.3.04]/",
        "http://[:::1]/", "http://[1:2:3:4:5:6:7:8]/", "http://[1:2:3:4:5:6:7:8:9]/", "http://[1::2::3]/", "http://[::g]/", "http://[abc/x", "http://abc]/x", "http://[v1.x]/y",
        "http://[v1.]/y", "http://[vz.x]/y", "http://[]/", "http://x[::1]/", "http://[::1]x/", "http://[::1]:80", "http://[::1]:", "http://[::1", "http://::1]",
        "http://", "https://", "http:///path", "https://?q=1", "https://#frag", "https://a@/x", "https://:80/x", "https://[::1]@host/", "https://host:/x", "https://host:abc/x",
        "https://\uff21.example/", "https://exa\uff0fmple.com/", "https://\u2100.com/x", "https://caf\xe9.example/", "https://\u00e9.example/", "https://a\uff20b.example/", "https://a\uff1ab.example/",
        "https://a\uff03b.example/", "https://a\uff1fb.example/", "https://\u4f8b\u3048.jp/", "https://EXAMPLE.COM./", "https://exa mple.com", "https://a.b/c/d/e", "https://x.y.z.w.example.co.uk/",
        "https://localhost", "https://127.0.0.1:8080/", "https://1.2.3.4", "http:/one-slash", "httpx://nope", "hTtPs://MiXeD.CaSe/Path", "https://xn--caf-dma.example/",
        "https://\u0130stanbul.example/", "https://ß.example/", "https://exam\ufb01ple.com", "https://a%40b.example/", "https://a.example\\path", "https://a.example;params", "https://a.example/p;x=1",
    ]
    for u in urls:
        try:
            host = urllib.parse.urlparse(u).hostname
            add("urlHostname", u, {"host": host})
        except ValueError:
            add("urlHostname", u, {"error": True})


def build_match() -> None:
    roles = ["Data Analyst", "Data Analyst | NAM", "Data Analyst, Toronto", "Senior Data Analyst", "Operations Manager", "Operations Manager | NAM", "Operations Manager Lead",
             "Senior Engineer", "Senior Engineering Manager", "Engineer", "Software Engineer", "Software Engineer II", "Software Engineer Intern", "Product Manager", "Product Manager - Growth",
             "Product", "Associate Product Manager", "Staff Engineer", "Customer Experience Lead, Business Owner", "Customer Experience", "", "Unknown role", "Data  Analyst!", "DATA ANALYST",
             "R\xe9gisseur Principal", "Analyste de donn\xe9es", "Analyste de donn\xe9es senior", "VP Sales", "VP of Sales", "Head of Data", "Head of Data Science", "x", "x y", "x y z"]
    for a, b in product(roles, roles):
        ka, kb = E.role_key(a), E.role_key(b)
        add("sameRole", {"aKey": ka, "bKey": kb, "aRole": a, "bRole": b}, MA.same_role(ka, kb, a, b))
    add("sameRole", {"aKey": "", "bKey": "x", "aRole": "", "bRole": "x"}, MA.same_role("", "x", "", "x"))
    add("sameRole", {"aKey": "a", "bKey": "b"}, MA.same_role("a", "b"))
    add("sameRole", {"aKey": "a", "bKey": "a"}, MA.same_role("a", "a"))
    for r in roles + [None, "\u00c9COLE de Data", "caf\xe9 manager", "Data\u00dfAnalyst"]:
        add("words", r, MA._words(r))

    rng = random.Random(4242)
    stages = ["Applied", "Interview", "Assessment", "Offer", "Rejected"]
    events = [None, "applied", "interview", "rejected", "offer", "heard_back", "assessment"]
    for n in range(400):
        apps = []
        for i in range(rng.choice([0, 0, 1, 1, 2, 3, 4])):
            role = rng.choice(roles)
            apps.append({"id": 10 + i, "role": role, "role_key": E.role_key(role), "stage": rng.choice(stages)})
        role = rng.choice(roles)
        thread_app = rng.choice([None, None, None, None, 5])
        thread_id = rng.choice(["t1", "t1", ""]) if thread_app is not None else rng.choice(["t1", ""])
        ckey = rng.choice(["acme", "acme", ""])
        event = rng.choice(events)
        rkey = E.role_key(role)

        def fake_thread(conn, account_id, tid, _app=thread_app):
            return _app if tid else None

        with mock.patch.object(MA.db, "thread_application", fake_thread), \
                mock.patch.object(MA.db, "all_applications_for", lambda conn, ck, _a=apps: [dict(a) for a in _a]):
            m = MA.find_application(None, 1, thread_id, ckey, rkey, event=event, role=role)
        add("findApplication", {
            "threadId": thread_id, "threadApplicationId": thread_app, "ckey": ckey, "rkey": rkey, "event": event, "role": role,
            "applications": [{"id": a["id"], "role": a["role"], "roleKey": a["role_key"], "stage": a["stage"]} for a in apps],
        }, {"kind": m.kind, "applicationId": m.application_id})

    # The random cases above rarely line up two or three applications for one role in specific stages, so the
    # re-application rules (an Offer counts as closed for "applied" mail, the newest same-role application wins) get
    # an exhaustive sweep of their own.
    def run(apps, event, role, ckey="acme", thread_app=None, thread_id=""):
        rkey = E.role_key(role)
        with mock.patch.object(MA.db, "thread_application", lambda conn, account_id, tid: thread_app if tid else None), \
                mock.patch.object(MA.db, "all_applications_for", lambda conn, ck: [dict(a) for a in apps]):
            m = MA.find_application(None, 1, thread_id, ckey, rkey, event=event, role=role)
        add("findApplication", {
            "threadId": thread_id, "threadApplicationId": thread_app, "ckey": ckey, "rkey": rkey, "event": event, "role": role,
            "applications": [{"id": a["id"], "role": a["role"], "roleKey": a["role_key"], "stage": a["stage"]} for a in apps],
        }, {"kind": m.kind, "applicationId": m.application_id})

    def app(i, role, stage):
        return {"id": i, "role": role, "role_key": E.role_key(role), "stage": stage}

    sweep_events = [None, "applied", "interview", "rejected"]
    for n in (1, 2):
        for combo in product(stages, repeat=n):
            for event in sweep_events:
                run([app(10 + i, "Data Analyst", s) for i, s in enumerate(combo)], event, "Data Analyst")
    for combo in product(["Applied", "Interview", "Offer", "Rejected"], repeat=3):
        for event in sweep_events:
            run([app(10 + i, "Data Analyst", s) for i, s in enumerate(combo)], event, "Data Analyst")
    # One application for the role and one for another job, in every pair of stages.
    for s1, s2 in product(stages, repeat=2):
        for event in sweep_events:
            for role in ("Data Analyst", "Product Manager", ""):
                run([app(10, "Data Analyst", s1), app(11, "Operations Manager", s2)], event, role)
    # A closed application for the role next to an open one with no role: a re-application is still new, not the open one.
    for s1, s2 in product(stages, repeat=2):
        for event in sweep_events:
            run([app(10, "Data Analyst", s1), app(11, "", s2)], event, "Data Analyst")
    # A longer title for the same job, a re-application, and a thread that already knows the application.
    for s in stages:
        run([app(10, "Data Analyst | NAM", s), app(11, "Data Analyst", "Offer")], "applied", "Data Analyst")
        run([app(10, "Data Analyst", s)], "applied", "Data Analyst", thread_app=5, thread_id="t1")


def build_headers() -> None:
    """The hosted mail providers read headers with web/src/providers/headers.ts; the local ones use email.utils and email.header."""
    from email.header import decode_header, make_header
    from email.utils import parseaddr

    froms = [
        "Acme Careers <jobs@acme.com>", '"Acme Careers" <jobs@acme.com>', "jobs@acme.com", "<jobs@acme.com>", "Acme <JOBS@Acme.COM>", "Acme Careers <no-reply@greenhouse.io>",
        '"Lee, Pat" <pat@acme.com>', '"Pat \\"The Hire\\" Lee" <pat@acme.com>', "Pat <pat+tag@acme.com>", "pat@acme.com (Pat Lee)", "Pat Lee pat@acme.com",
        "Acme Careers<jobs@acme.com>", '"Acme <Careers>" <jobs@acme.com>', "", " ", "Acme", "<>", "Acme <>", "Caf\xe9 Recrutement <rh@caf\xe9.fr>", "\u5c71\u7530 <yamada@example.jp>", "Acme (Careers) <jobs@acme.com>", "Acme <jobs@acme.com> (comment)",
        "Acme <jobs@acme.com", "A.B. Smith <a.b.smith@mail.example.co.uk>", "no-reply@accounts.google.com",
        "Workday <acme@myworkday.com>", "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>", "\"O'Brien, Sam\" <sam@acme.com>",
    ]
    # Left out on purpose, because the TypeScript port reads them differently (pinned in web/tests/providers/headers.test.ts):
    # an unquoted comma in the name, several addresses in one header, runs of spaces in the name, an address-looking name,
    # a stray ">", and encoded names (parseaddr leaves them encoded, the port decodes them). The same for decodeMimeWords below:
    # a word glued straight onto an encoded word is left out.
    for f in froms:
        name, addr = parseaddr(f)
        add("parseAddress", f, {"name": name, "email": addr})
    words = [
        "Thank you for applying", "", "=?UTF-8?B?VGhhbmsgeW91IGZvciBhcHBseWluZw==?=", "=?utf-8?Q?Thank_you_for_applying?=", "=?UTF-8?Q?Caf=C3=A9_=E2=80=93_Offer?=",
        "=?UTF-8?B?QWNtZSDigJMgSW50ZXJ2aWV3?= invitation", "Re: =?UTF-8?B?44GT44KT44Gr44Gh44Gv?=", "=?ISO-8859-1?Q?Caf=E9?=", "=?iso-8859-1?B?Q2Fm6Q==?=",
        "=?UTF-8?B?Q2Fm?= =?UTF-8?B?w6k=?=", "=?UTF-8?Q?Caf?=\r\n =?UTF-8?Q?=C3=A9?=", "=?UTF-8?Q?a?= b =?UTF-8?Q?c?=",
        "=?UTF-8?B?not base64!?=", "=?UTF-8?Q?bad=ZZhex?=", "=?UTF-8?X?abc?=", "=?UTF-8?B??=", "plain =? text ?= here", "100% =?UTF-8?Q?_=E2=9C=93?=",
    ]
    for w in words:
        try:
            expected = str(make_header(decode_header(w)))
        except Exception:
            continue
        add("decodeMimeWords", w, expected)


def build_links() -> None:
    threads = [None, "", "18c2f0a1b2c3d4e5", "a/b c", "t\xe9 &x=1", "\U0001F680"]
    addrs = [None, "", "me@gmail.com", "me+tag@gmail.com", "m\xe9@gmail.com", "a b@c.d", "me@work.example.com"]
    webs = [None, "", "https://outlook.live.com/owa/?ItemID=AAMk&exvsurl=1", "javascript:alert(1)", "http://insecure.example.com/x", "data:text/html,hi", "https://outlook.office.com/mail/x", "HTTPS://upper.example"]
    for p, a, t, w in product(["gmail", "outlook", "yahoo", ""], addrs[:4], threads[:4], webs[:4]):
        add("mailboxLink", {"provider": p, "address": a, "threadId": t, "webLink": w}, to_list(L.mailbox_link(p, a, t, w)))
    for p, a, t, w in product(["gmail", "outlook"], addrs[:3], threads[2:], webs[2:]):
        add("mailboxLink", {"provider": p, "address": a, "threadId": t, "webLink": w}, to_list(L.mailbox_link(p, a, t, w)))
    senders = ["Pat Lee <pat@acme.com>", '"Lee, Pat" <pat+x@acme.com>', "no-reply@acme.com", "Acme <no-reply@acme.com>", "Acme <do-not-reply@acme.com>", "A <donotreply@acme.com>",
               "A <noreply@acme.com>", "A <mailer-daemon@acme.com>", "A <bounces@acme.com>", "A <bounce.1@acme.com>", "A <notifications@acme.com>", "A <my-notification@acme.com>",
               "A <notificationsx@acme.com>", "A <announcements@acme.com>", "pat@acme.com", "Pat", "", None, "Pat <not an address>", "Pat <a@b>", "Pat <a@b.c>", "\u00c9mile <\u00e9mile@caf\xe9.fr>",
               "Pat <pat@acme.com", "A <a@@b.com>", "A <a b@c.com>", "A <no_reply@acme.com>", "A <no.reply@acme.com>", "A <NOREPLY@acme.com>", "A <info@acme.com>"]
    subjects = [None, "", "Interview", "Re: Interview", "RE: Interview", "re:Interview", "  Re:   x ", "Caf\xe9 & chat?", "Hello world", "A/B test", "\U0001F680", "Fwd: Re: x"]
    accounts = [None, "", "me@gmail.com", "me@outlook.com", "me@hotmail.com", "me@live.com", "me@msn.com", "me@ME.OUTLOOK.COM", "me@work.example.com", "me@Company.com", "not-an-address", "m\xe9@gmail.com"]
    for p, acct, s, subj in product(["gmail", "outlook", "yahoo"], accounts[::2], senders[:12], subjects[:3]):
        add("replyLink", {"provider": p, "account": acct, "sender": s, "subject": subj, "webLink": None}, to_list(L.reply_link(p, acct, s, subj)))
    for p, acct, s, subj in product(["gmail", "outlook"], accounts[:3], senders[12:], subjects[6:9]):
        add("replyLink", {"provider": p, "account": acct, "sender": s, "subject": subj, "webLink": None}, to_list(L.reply_link(p, acct, s, subj)))
    for acct in ["pat@olive.com", "me@hotmail.co.uk", "me@live.ca", "me@hotmail.com.au", "me@outlook.fr", "me@acme-outlook.com", "me@outlook.com.evil.com"]:
        add("replyLink", {"provider": "outlook", "account": acct, "sender": "Pat <pat@acme.com>", "subject": "Hi", "webLink": None}, to_list(L.reply_link("outlook", acct, "Pat <pat@acme.com>", "Hi")))
    for w in webs:
        for acct in accounts[:5]:
            add("replyLink", {"provider": "outlook", "account": acct, "sender": "Pat <pat@acme.com>", "subject": "Hi", "webLink": w}, to_list(L.reply_link("outlook", acct, "Pat <pat@acme.com>", "Hi", w)))


def to_list(v):
    return None if v is None else list(v)


def build_pystr() -> None:
    samples = ["", "Hello", "HELLO World", "Stra\xdfe", "\u1e9e", "\u0130stanbul", "I\u0307", "\u03a3", "\u0391\u03a3", "\u03c3\u03c2", "\u212a", "\u017f", "\u00b5", "\ufb01", "\ufb03",
               "\u01c4\u01c5\u01c6", "\u1f88", "\u13a0", "\U0001f600", "Ω", "e\u0301", "\u30ac", "\u30ab\u3099", "\u1100\u1161", "\u03a3\u03af\u03c3\u03c5\u03c6\u03bf\u03c2", "ǰ", "ŉ", "ẖ",
               "\u0345", "\uff21\uff22", "\u2160", "\u00bd", "\u2460", "caf\u00e9", "CAF\u00c9", "\u0149", "\u1e9b", "x\u00dfy", "\u0587"]
    for s in samples:
        add("casefold", s, s.casefold())
        add("capitalize", s, s.capitalize())
        add("pyLower", s, s.lower())
    for s in ["", "abc", "a b", "a/b", "a b/c", "\xe9", "\U0001f680", "~-_.", "!*'()", "a+b=c&d", "50%", "caf\xe9?", "\u4f8b", "A\xdf", "\x00\x7f", "line\nbreak", "tab\t"]:
        add("quote", s, urllib.parse.quote(s))
        add("quoteNoSafe", s, urllib.parse.quote(s, safe=""))
    for s in ["", "a&b", "<>", "'\"", "&amp;", "plain", "\u00e9\U0001f680", "<script>alert('x')</script>"]:
        from markupsafe import escape
        add("escapeHtml", s, str(escape(s)))
    for s in ["", " ", "  a  ", "\t\n a \r\x0b\x0c", "\x1c\x1d\x1e\x1f a \x85", "\u00a0a\u00a0", "\u2000a\u200a", "\u3000a\u3000", "\ufeffa\ufeff", "\u200ba\u200b", "a b  c\n\td", "\u2028a\u2029"]:
        add("strip", s, s.strip())
        add("splitWords", s, s.split())
        add("cpLen", s, len(s))
    for s in ["abc", "\U0001f680\U0001f680\U0001f680", "a\U0001f680b", "\u00e9", ""]:
        add("cpLen", s, len(s))
        add("cpHead", {"s": s, "n": 2}, s[:2])
        add("cpHead", {"s": s, "n": 1}, s[:1])
        add("cpHead", {"s": s, "n": 0}, s[:0])
        add("cpHead", {"s": s, "n": 10}, s[:10])


# regex translator cases ----------------------------------------------------------------------------------------------

REGEX_CASES = [
    # (source, flags, text)
    (r"\w+", "", "caf\xe9 \u4f8b\u3048 \u03b1\u03b2\u03b3 _x1 \u0661\u0662"),
    (r"\w+", "", "-- \U0001F680 --"), (r"\W+", "", "ab, cd"), (r"[\w-]+", "", "a-b_c d"), (r"[\w.-]+@[\w.-]+", "", "mail me: a.b-c@x-y.com now"),
    (r"\d+", "", "abc \u0661\u0662\u0663 123 \u00b2"), (r"\D+", "", "12ab34"),
    (r"\s+", "", "a \t\n\r\x0b\x0c\x1c\x1d\x1e\x1f\x85\xa0\u1680\u2000\u200a\u2028\u2029\u202f\u205f\u3000\ufeffb"),
    (r"\S+", "", "  ab\u00a0cd  "), (r"[\s]+", "", "a \u00a0b"), (r"[^\s]+", "", " ab\u3000cd"),
    (r"\bword\b", "", "a word here"), (r"\bword\b", "", "\u00e9word\u00e9"), (r"\bword\b", "", "_word_"), (r"\bword\b", "", "word"), (r"\bword\b", "", "swordfish"),
    (r"\bunsubscribe\b", "i", "x \u00e9unsubscribe\u00e9 Unsubscribe!"), (r"\Bx\B", "", "axa x"), (r"\b", "", ""), (r"\b\w", "", "  \u00e9a"),
    (r"a.b", "", "a\nb"), (r"a.b", "", "a\rb"), (r"a.b", "", "a\u2028b"), (r"a.b", "", "a\u2029b"), (r"a.b", "", "a\U0001F680b"), (r"a.{1}b", "", "a\U0001F680b"), (r".+", "", "ab\ncd"),
    (r"end$", "", "the end"), (r"end$", "", "the end\n"), (r"end$", "", "the end\n\n"), (r"end$", "", "the end\r\n"), (r"end\Z", "", "the end\n"), (r"end\Z", "", "the end"),
    (r"^start", "", "start here"), (r"^start", "", "x\nstart"), (r"\Astart", "", "start"), (r"^$", "", ""), (r"^$", "", "\n"), (r"$", "", "ab"), (r"$", "", "ab\n"),
    (r"x*$", "", "axx\n"),
    (r"(?P<a>\w+)@(?P<b>\w+)", "", "pat@acme"), (r"(?P<a>x)(?P=a)", "", "xx"), (r"(?P<a>x)(?P=a)", "", "xy"), (r"(?i)hello", "", "HeLLo"), (r"hello", "i", "HELLO"),
    (r"caf\xe9", "i", "CAF\xc9"), (r"\u0391", "i", "\u03b1"), (r"k", "i", "\u212a"), (r"s", "i", "\u017f"), (r"\u00fc", "i", "\u00dc"),
    (r"[a-z]+", "i", "ABC\u212a"), (r"[^a-z]+", "i", "ABC1"),
    (r"a{2}", "", "aaa"), (r"a{2,}", "", "aaaa"), (r"a{,2}", "", "aaa"), (r"a{,2}b", "", "aab"), (r"a{1,2}?", "", "aaa"), (r"{", "", "a{b"), (r"a{b", "", "a{b"), (r"a{1", "", "a{1"),
    (r"a{1,x}", "", "a{1,x}"), (r"x{}", "", "x{}"), (r"}", "", "a}b"), (r"]", "", "a]b"), (r"a]", "", "a]"), (r"[]]", "", "]"), (r"[^]]", "", "a]"), (r"[]a]+", "", "]a]"),
    (r"[[]", "", "a[b"), (r"[a[]", "", "["), (r"\[x\]", "", "[x]"), (r"[(\[]\s*x\s*[)\]]", "", "( x ]"),
    (r"[-a]", "", "-"), (r"[a-]", "", "-"), (r"[\d-]", "", "-"), (r"[a\-z]+", "", "a-z"), (r"[+*?.]+", "", "a+*?."), (r"[\.]", "", "."),
    (r"[\n\t]+", "", "a\n\tb"), (r"[^|!\n]+?", "", "ab|c"), (r"[!.,:;|\n\u2014]", "", "x\u2014y"), (r"[\u2018\u2019]", "", "\u2019"), (r"[\x41-\x43]+", "", "ABCD"),
    (r"\u00e9\u00c9", "", "\xe9\xc9"), (r"\xe9", "", "\xe9"), (r"\U0001F680", "", "\U0001F680"), (r"[\U0001F680-\U0001F6FF]", "", "x\U0001F680"), (r"\x41", "", "A"),
    (r"\.", "", "a.b"), (r"\-", "", "a-b"), (r"\ ", "", "a b"), (r"\#\&\~", "", "#&~"), (r"\'", "", "a'b"), (r"\"", "", 'a"b'), (r"\/", "", "a/b"), (r"\@", "", "a@b"), (r"\<\>", "", "<>"),
    (r"\$", "", "a$"), (r"\^", "", "a^"), (r"\|", "", "a|b"), (r"\(\)", "", "()"), (r"\{\}", "", "{}"), (r"\*", "", "*"), (r"\+", "", "+"), (r"\?", "", "?"),
    (r"(?:a|b)+", "", "abba"), (r"(a)(b)?", "", "a"), (r"(?=a)a", "", "a"), (r"(?!a)b", "", "b"), (r"(?<=a)b", "", "ab"), (r"(?<!a)b", "", "ab b"), (r"a(?=\s*(?:[!.]|$))", "", "a!"),
    (r"a(?=\s*(?:[!.]|$))", "", "a\n"), (r"(?<=[.!?])\s+", "", "ab. cd"), (r"x(?!sent to)y", "", "xy"), (r"(?:(?!sent to)[^\n\xb7])+?", "", "ab sent to"),
    (r"\d{1,2}[.)]", "", "12) a"), (r"^\d{1,2}[.)]\s+\S", "", "3. x"), (r"^(?:[-\u2022*\u2013]|\d{1,2}[.)])\s+\S", "", "\u2022 item"), (r"^(?:[-\u2022*\u2013]|\d{1,2}[.)])\s+\S", "", "\u0663. item"),
    (r"^On .{3,160}\bwrote:?$", "i", "On Fri, Oct 23 at 4:49 PM Jordan Lee <j@x.com> wrote:"), (r"^On .{3,160}\bwrote:?$", "i", "On Fri wrote:\n"), (r"^Le .{3,160}\ba \xe9crit\s?:?$", "i", "Le lun. 5 \xe0 09:00 X a \xc9CRIT :"),
    (r"[A-Z][a-z]{2,8} \d", "", "x Oct 23"), (r"[A-Z][a-z]{2,8} \d", "i", "x OCT 23"), (r"\b(?:i|me|my|we|us|our|you|your)\b", "i", "Is it me? Yes"), (r"\b(?:i|me|my|we|us|our|you|your)\b", "i", "\u00e9I\u00e9"),
    (r"(?:a|an|the|my|your|our)\b", "i", "The role"), (r"(?:a|an|the|my|your|our)\b", "i", "Theatre"),
    (r"https?://[^\s<>\"')\]]+", "i", "see HTTPS://a.b/c?d=e. next"), (r"https?://[^\s<>\"')\]]+", "i", "x http://a.b/c)d"), (r"https?://[^\s<>\"')\]]+", "i", "x http://a.b/\u00a0c"),
    (r"[.!?:][\"')]?$", "", 'done."'), (r"[.!?:][\"')]?$", "", "done.\n"), (r"[.!?;:]", "", "a;b"),
    (r"application (?:to|for) (?:the )?(?P<r>[^|!\n]+?) (?:at|with) (?P<c>[^!.|\n,]+?)(?=\s*(?:[!.,:;|\n\u2014]|\s-\s|\s\u2013\s|\sfor\b|$))", "i", "Application for the Data Analyst at Acme Corp - next"),
    (r"application (?:to|for) (?:the )?(?P<r>[^|!\n]+?) (?:at|with) (?P<c>[^!.|\n,]+?)(?=\s*(?:[!.,:;|\n\u2014]|\s-\s|\s\u2013\s|\sfor\b|$))", "i", "application to X at Y\n"),
    (r"(?:position|role) of (?P<r>[^.!\n]+?)\s*(?:[.!]|\n|$)", "i", "our position of Customer Experience Lead."), (r"(?:position|role) of (?P<r>[^.!\n]+?)\s*(?:[.!]|\n|$)", "i", "role of Lead\n"),
    (r"\s+(?:position|role|opening|vacancy|job)$", "i", "Analyst role"), (r"\s+(?:position|role|opening|vacancy|job)$", "i", "Analyst role\n"), (r"\s+(?:position|role|opening|vacancy|job)$", "i", "Analyst roles"),
    (r"(?:no-?reply|do-?not-?reply|jobs?|careers?|recruiting|notifications?|info|support|hr|talent)", "i", "NoReply"),
    (r"[\u00a0\u2000-\u200a\u202f\u205f\u3000]", "", "a\u2003b"), (r"[\u034f\u200b-\u200f\u2060\ufeff\u00ad]", "", "a\u200eb"), (r"\u00a9\s?\d{4}", "i", "\xa9 2026"),
    (r"you(?:'re| are) receiving (?:this|these|linkedin)", "i", "You're receiving this"), (r"\bif (?:you(?:'re| are)?|your \w+(?: \w+)?) (?:are |is |were )?(?:selected|shortlisted)", "i", "if your \u00e9ligible profile is selected"),
    (r"\bif (?:you(?:'re| are)?|your \w+(?: \w+)?) (?:are |is |were )?(?:selected|shortlisted)", "i", "If you're selected"),
    (r"^", "", "abc"), (r"a|", "", "b"), (r"(?:)", "", "abc"), (r"[a-c]{2}", "", "xabc"), (r"a{0}", "", "a"),
    (r"interview", "i", "\u0130NTERVIEW"), (r"interview", "i", "\u0131nterview"), (r"[i]+", "i", "\u0131\u0130I"), (r"[^i]", "i", "\u0131x"), (r"(?P<id>i+)", "i", "\u0130i"),
    (r"(?P<id>i+)", "", "\u0130i"), (r"(?i)it", "", "\u0130T"), (r"k+", "i", "\u212a"), (r"\u03c3", "i", "\u03c2"), (r"\u00b5", "i", "\u03bc"), (r"i", "", "\u0130"),
    (r"\n", "", "a\nb"), (r"\t", "", "a\tb"), (r"\r\n", "", "a\r\nb"), (r"\f\v", "", "\f\v"), (r"[\b]", "", "\b"),
]
REGEX_SPLITS = [
    (r"(?<=[.!?])\s+|\n+", "", "One. Two!  Three?\nFour\n\nFive"), (r"(?<=[.!?])\s+|\n+", "", ""), (r"(?<=[.!?])\s+|\n+", "", "\n\nabc\n"), (r"\n\s*\n", "", "a\n\nb\n \n\nc"),
    (r"\n\s*\n", "", "a\n\u00a0\nb"), (r"\n\s*\n", "", "\n\n"), (r"\s+", "", " a  b "), (r"x", "", "axbxc"), (r"x", "", "xx"), (r"\d", "", "a1b2c"),
]
REGEX_SUBS = [
    (r"\s+", "g", " ", "a  b\t\nc"), (r"\s+", "g", " ", "\u00a0a\u3000\u3000b"), (r"[ \t]+", "g", " ", "a \t b\u00a0\u00a0c"), (r"\b(?:inc|llc|co)\b\.?", "ig", "", "acme inc. and co llc, \u00e9inc"),
    (r"\b(?:careers?|team|via \w+)\b", "ig", " ", "Acme Careers Team via L\u00e9on"), (r"^(?:[-\u2022*\u2013]|\d{1,2}[.)])\s+", "g", "", "- item"), (r"^(?:[-\u2022*\u2013]|\d{1,2}[.)])\s+", "g", "", "12) item"),
    (r"\s+(?:position|role|opening|vacancy|job)$", "ig", "", "Analyst  ROLE"), (r"[\u034f\u200b-\u200f\u2060\ufeff\u00ad]", "g", "", "a\u200bb\u00adc\ufeffd"), (r"x", "g", "y", "xxx"), (r"x+", "g", "-", "abxxc"),
]
REGEX_FULL = [
    (r"[-\u2022*\u2013]", "", "-"), (r"[-\u2022*\u2013]", "", "--"), (r"[-\u2022*\u2013]", "", "\u2022"), (r"[-\u2022*\u2013]", "", ""), (r"[-\u2022*\u2013]", "", "-\n"),
    (r"(?:no-?reply|jobs?)", "i", "Jobs"), (r"(?:no-?reply|jobs?)", "i", "jobsx"), (r"(?:no-?reply|jobs?)", "i", "jobs\n"), (r"(?:no-?reply|jobs?)", "i", "xjobs"), (r"[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+", "", "a@b.co"),
    (r"[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+", "", "a@b"), (r"[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+", "", "a b@c.d"), (r"[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+", "", "\u00e9@caf\xe9.fr"), (r"[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+", "", "a@b.c\n"),
    (r"a|ab", "", "ab"), (r"a*", "", ""), (r"a*", "", "b"),
]


def match_json(m):
    if m is None:
        return None
    return {"match": m.group(0), "groups": list(m.groups()), "named": m.groupdict()}


def build_regex() -> None:
    warnings.simplefilter("ignore", FutureWarning)   # "[[]" is a deliberate case
    flagmap = {"i": re.I}
    for src, flags, text in REGEX_CASES:
        fl = 0
        for f in flags:
            fl |= flagmap[f]
        pat = re.compile(src, fl)
        add("regexSearch", {"source": src, "flags": flags, "text": text}, match_json(pat.search(text)))
        add("regexMatch", {"source": src, "flags": flags, "text": text}, match_json(pat.match(text)))
    for src, flags, text in REGEX_SPLITS:
        add("regexSplit", {"source": src, "flags": flags, "text": text}, re.split(src, text, flags=re.I if "i" in flags else 0))
    for src, flags, repl, text in REGEX_SUBS:
        fl = re.I if "i" in flags else 0
        add("regexSub", {"source": src, "flags": flags, "repl": repl, "text": text}, re.sub(src, repl, text, flags=fl))
    for src, flags, text in REGEX_FULL:
        pat = re.compile(src, re.I if "i" in flags else 0)
        add("regexFullmatch", {"source": src, "flags": flags, "text": text}, match_json(pat.fullmatch(text)))


# --------------------------------------------------------------------------------------------------------------------

def coverage_report() -> list[str]:
    """Rule patterns that no sample sentence in PHRASES triggers (so the corpus would not notice them breaking)."""
    rules = C.load_rules()
    missing = []
    for kind, pats in list(rules.strong.items()) + list(rules.weak.items()):
        for p in pats:
            if not any(p.search(s) for s in PHRASES + SENTENCES + SUBJECTS):
                missing.append(p.pattern)
    addresses = [mk("", "", s).sender_email.lower() for s in SENDERS]
    for p in (*rules.exclude_sender, *rules.exclude_subject, *rules.negated_offers, *rules.conditionals):
        if not any(p.search(s) for s in PHRASES + SENTENCES + SUBJECTS + addresses):
            missing.append(p.pattern)
    return missing


def build() -> dict:
    CASES.clear()
    MESSAGES.clear()
    _MSG_INDEX.clear()
    msgs = corpus_messages()
    build_classify(msgs)
    build_text_cases(msgs)
    build_extract(msgs)
    build_mailtext(msgs)
    build_urls()
    build_match()
    build_headers()
    build_links()
    build_pystr()
    build_regex()
    return {
        "messages": MESSAGES,
        "meta": {
            "generator": "scripts/export_fixtures.py",
            "python": ".".join(map(str, sys.version_info[:3])),
            "unicode": unicodedata.unidata_version,
            "counts": {k: len(v) for k, v in sorted(CASES.items())},
        },
        "cases": dict(sorted(CASES.items())),
    }


def same_apart_from_python_patch(a: str, b: str) -> bool:
    """Two fixture texts are the same once the Python patch number (3.14.4 vs 3.14.5) is left out of "python"."""
    def tolerant(text: str) -> str:
        return re.sub(r'("python": "\d+\.\d+)\.\d+"', r'\1"', text, count=1)
    return tolerant(a) == tolerant(b)


def dump(data: dict) -> str:
    lines = ["{", f'"meta": {json.dumps(data["meta"], sort_keys=True)},', '"messages": [']
    lines += [json.dumps(m, ensure_ascii=True, separators=(",", ":")) + ("," if i < len(data["messages"]) - 1 else "") for i, m in enumerate(data["messages"])]
    lines += ["],", '"cases": {']
    fns = list(data["cases"].items())
    for fi, (fn, cases) in enumerate(fns):
        lines.append(f"{json.dumps(fn)}: [")
        for ci, c in enumerate(cases):
            lines.append(json.dumps(c, ensure_ascii=True, separators=(",", ":")) + ("," if ci < len(cases) - 1 else ""))
        lines.append("]" + ("," if fi < len(fns) - 1 else ""))
    lines += ["}", "}", ""]
    return "\n".join(lines)


def python_export_golden(now: str) -> dict:
    """What the local edition computes from the committed python-export.json: Flow data for every account and period, people, counts."""
    from jobtracker import contacts, db, stats

    export = json.loads(PY_EXPORT.read_text(encoding="utf-8"))
    at = datetime.fromisoformat(now.replace("Z", "+00:00"))

    class Frozen(datetime):
        @classmethod
        def now(cls, tz=None):
            return at if tz else at.replace(tzinfo=None)

    conn = db.connect(":memory:")
    try:
        for name, rows in export["tables"].items():
            for row in rows:
                cols = list(row)
                conn.execute(f"INSERT INTO {name} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", [row[c] for c in cols])
        with mock.patch.object(stats, "datetime", Frozen):
            sankey = {f"{account}:{days}": stats.sankey(conn, account, days) for account in (0, 1, 2) for days in (0, 30, 60, 90, 180)}
        return {"now": now, "sankey": sankey, "contacts": contacts.derive(conn), "counts": {name: len(rows) for name, rows in export["tables"].items()}}
    finally:
        conn.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="fail if the committed fixture file is out of date")
    args = ap.parse_args()
    data = build()
    text = dump(data)
    missing = coverage_report()
    if missing:
        print("warning: no sample sentence triggers these rule patterns:", *missing, sep="\n  ", file=sys.stderr)
    previous = json.loads(PY_EXPORT_GOLDEN.read_text(encoding="utf-8")) if PY_EXPORT_GOLDEN.exists() else {}
    snapshot_golden = python_export_golden(previous.get("now") or json.loads(PY_EXPORT.read_text(encoding="utf-8"))["exportedAt"])
    snapshot_text = json.dumps(snapshot_golden, indent=2, ensure_ascii=False) + "\n"
    if args.check:
        ok = OUT.exists() and same_apart_from_python_patch(OUT.read_text(encoding="utf-8"), text)
        snapshot_ok = previous == snapshot_golden
        print("fixtures up to date" if ok else "fixtures are out of date: run scripts/export_fixtures.py")
        if not snapshot_ok:
            print("python-export.golden.json is out of date: run scripts/export_fixtures.py")
        return 0 if ok and snapshot_ok else 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8")
    if previous != snapshot_golden:
        PY_EXPORT_GOLDEN.write_text(snapshot_text, encoding="utf-8")
        print(f"wrote {PY_EXPORT_GOLDEN}")
    total = sum(data["meta"]["counts"].values())
    print(f"wrote {OUT} ({total} cases, {OUT.stat().st_size // 1024} KiB)")
    for k, v in data["meta"]["counts"].items():
        print(f"  {k}: {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
