"""The loop: flag what isn't an application, and the app learns rules from it."""
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from jobtracker import db, learn
from jobtracker.classify import classify
from jobtracker.models import Message
from jobtracker.sync import process_message
from jobtracker.web import create_app


def mail(subject, body, sender, id="m1", day=1):
    name, _, addr = sender.partition("<")
    return Message(id=id, thread_id=id, sender_name=name.strip(), sender_email=addr.rstrip(">") if addr else name,
                   subject=subject, received_at=datetime(2026, 10, day, 12, 0, tzinfo=timezone.utc), body=body)


# An email that the built-in rules take for an interview invitation, but is really a course advert.
ADVERT = "We would like to schedule an interview prep session with you for the analyst role."


@pytest.fixture
def env(tmp_path):
    path = tmp_path / "t.db"
    conn = db.connect(path)
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    conn.commit()
    client = TestClient(create_app(path), base_url="http://127.0.0.1:8765", follow_redirects=False)

    class E:
        pass

    e = E()
    e.conn, e.acct, e.client = conn, acct, client
    yield e
    conn.close()


def sync_in(e, *messages):
    return [process_message(e.conn, e.acct, m) for m in messages]


# --- the whole loop ---------------------------------------------------------------------------

def test_flagging_an_application_removes_it_learns_the_sender_and_blocks_the_next_one(env):
    sender = "Career Coach <hi@coachco.io>"
    first = mail("Re: your application", ADVERT, sender, id="a")
    assert classify(first).related                                   # the built-in rules are fooled
    sync_in(env, first)
    env.conn.execute("UPDATE emails SET needs_review = 0")           # as if it had been trusted enough to become an app
    app = env.conn.execute("INSERT INTO applications (company, company_key, role, role_key, stage) VALUES ('CoachCo', 'coachco', 'Analyst', 'analyst', 'Interview')").lastrowid
    env.conn.execute("UPDATE emails SET application_id = ?", (app,))
    env.conn.commit()

    r = env.client.post(f"/app/{app}/not-application")
    assert r.status_code == 303 and r.headers["location"].startswith("/review?notice=")
    page = env.client.get(r.headers["location"]).text
    assert "Removed CoachCo." in page and "Ignoring emails from hi@coachco.io" in page and "What the app has learned" in page
    assert env.conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0] == 0
    row = env.conn.execute("SELECT * FROM emails").fetchone()
    assert row["related"] == 0 and row["subject"] is None and row["body"] is None      # content erased

    again = mail("Re: your application", ADVERT, sender, id="b", day=5)
    assert sync_in(env, again) == ["ignored"]
    assert env.conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0] == 0
    assert "learned: ignoring" in classify(again, learn.load(env.conn)).reason


def test_the_feedback_fingerprint_survives_the_erasing(env):
    sync_in(env, mail("Re: your application", ADVERT, "Coach <hi@coachco.io>"))
    email = env.conn.execute("SELECT id FROM emails").fetchone()[0]
    assert env.client.post(f"/review/{email}", data={"action": "dismiss"}).status_code == 303
    fb = env.conn.execute("SELECT * FROM feedback").fetchone()
    assert (fb["verdict"], fb["sender_email"], fb["sender_domain"], fb["subject"]) == ("not_job", "hi@coachco.io", "coachco.io", "Re: your application")
    assert fb["reason"].startswith("body:")                         # which rule had fired


# --- Needs review teaches it too ---------------------------------------------------------------

def test_dismissing_in_needs_review_learns_and_clears_similar_queued_mail(env):
    for i, who in enumerate(["a@coachco.io", "b@coachco.io", "c@coachco.io"]):
        sync_in(env, mail("Re: your application", ADVERT, f"Coach <{who}>", id=f"m{i}", day=1 + i))
    queued = [r[0] for r in env.conn.execute("SELECT id FROM emails WHERE needs_review = 1 ORDER BY id")]
    assert len(queued) == 3
    env.client.post(f"/review/{queued[0]}", data={"action": "dismiss"})
    env.client.post(f"/review/{queued[1]}", data={"action": "dismiss"})          # a second address on the domain
    assert {(r["kind"], r["value"]) for r in env.conn.execute("SELECT * FROM learned_rules")} == {
        ("block_sender", "a@coachco.io"), ("block_sender", "b@coachco.io"), ("block_domain", "coachco.io")}
    assert env.conn.execute("SELECT COUNT(*) FROM emails WHERE needs_review = 1").fetchone()[0] == 0      # the third cleared itself
    assert sync_in(env, mail("Re: your application", ADVERT, "Coach <d@coachco.io>", id="new", day=9)) == ["ignored"]


def test_confirming_an_email_makes_its_sender_trusted_and_beats_a_domain_block(env):
    conn = env.conn
    for sender in ("a@acme.io", "b@acme.io"):
        conn.execute("INSERT INTO feedback (created_at, verdict, sender_email, sender_domain, subject, reason) VALUES ('2026-10-01T00:00:00Z', 'not_job', ?, 'acme.io', 's', '')", (sender,))
    conn.execute("INSERT INTO feedback (created_at, verdict, sender_email, sender_domain, subject, reason) VALUES ('2026-10-02T00:00:00Z', 'job', 'pat@acme.io', 'acme.io', 's', '')")
    conn.commit()
    learn.rebuild(conn)
    kinds = {(r["kind"], r["value"]) for r in conn.execute("SELECT * FROM learned_rules WHERE active = 1")}
    assert ("allow_sender", "pat@acme.io") in kinds and ("block_sender", "a@acme.io") in kinds
    assert ("block_domain", "acme.io") not in kinds                  # someone there is real, so the whole domain stays open
    learned = learn.load(conn)
    msg = mail("Hello", "Great news about your candidacy, we would like to schedule an interview.", "Pat <pat@acme.io>")
    assert classify(msg, learned).related and classify(msg, learned).confidence == "high"      # trusted like a hiring system


def test_assigning_in_needs_review_records_a_job_verdict(env):
    sync_in(env, mail("Re: your application", ADVERT, "Pat <pat@acme.io>"))
    email = env.conn.execute("SELECT id FROM emails").fetchone()[0]
    env.client.post(f"/review/{email}", data={"action": "new", "company": "Acme", "role": "Analyst", "stage": "Interview"})
    assert env.conn.execute("SELECT verdict, sender_email FROM feedback").fetchone()[:] == ("job", "pat@acme.io")
    assert env.conn.execute("SELECT kind, value FROM learned_rules").fetchone()[:] == ("allow_sender", "pat@acme.io")


# --- limits on what it will learn -----------------------------------------------------------------

@pytest.mark.parametrize("sender", ["x@gmail.com", "y@gmail.com", "z@gmail.com"])
def test_personal_mail_domains_are_never_blocked_whole(env, sender):
    env.conn.execute("INSERT INTO feedback (created_at, verdict, sender_email, sender_domain, subject) VALUES ('2026-10-01T00:00:00Z', 'not_job', ?, 'gmail.com', 's')", (sender,))
    env.conn.commit()
    learn.rebuild(env.conn)
    assert ("block_domain", "gmail.com") not in {(r["kind"], r["value"]) for r in env.conn.execute("SELECT * FROM learned_rules")}


def test_hiring_systems_are_never_blocked(env):
    for who in ("a@greenhouse.io", "b@greenhouse.io"):
        env.conn.execute("INSERT INTO feedback (created_at, verdict, sender_email, sender_domain, subject) VALUES ('2026-10-01T00:00:00Z', 'not_job', ?, 'greenhouse.io', 's')", (who,))
    env.conn.commit()
    assert learn.rebuild(env.conn) == []


def test_a_wording_that_keeps_being_wrong_is_distrusted_and_goes_to_review(env):
    for i in range(3):
        env.conn.execute("INSERT INTO feedback (created_at, verdict, sender_email, sender_domain, subject, reason) VALUES ('2026-10-01T00:00:00Z', 'not_job', ?, 'x.io', 's', 'body: wording')", (f"s{i}@x{i}.io",))
    env.conn.commit()
    rules = learn.rebuild(env.conn)
    assert any("wording" in r for r in rules)
    learned = learn.load(env.conn)
    assert "body: wording" in learned.distrust
    fooled = classify(mail("Hi", ADVERT, "Someone <someone@else.io>"))
    assert fooled.confidence == "medium"
    cls = classify(mail("Hi", ADVERT, "Someone <someone@else.io>"), learned if fooled.reason == "body: wording" else learn.Learned(distrust=frozenset({fooled.reason})))
    assert cls.related and cls.confidence == "low"


def test_two_wrong_flags_are_not_enough_to_distrust_a_wording(env):
    for i in range(2):
        env.conn.execute("INSERT INTO feedback (created_at, verdict, sender_email, sender_domain, subject, reason) VALUES ('2026-10-01T00:00:00Z', 'not_job', ?, 'x.io', 's', 'body: wording')", (f"s{i}@x{i}.io",))
    env.conn.commit()
    learn.rebuild(env.conn)
    assert learn.load(env.conn).distrust == frozenset()


# --- undo ----------------------------------------------------------------------------------------

def test_undo_removes_a_rule_and_it_is_not_relearned_without_new_evidence(env):
    sync_in(env, mail("Re: your application", ADVERT, "Coach <hi@coachco.io>"))
    email = env.conn.execute("SELECT id FROM emails").fetchone()[0]
    env.client.post(f"/review/{email}", data={"action": "dismiss"})
    rule = env.conn.execute("SELECT id FROM learned_rules").fetchone()[0]
    r = env.client.post(f"/learned/{rule}/undo")
    assert r.status_code == 303 and "Rule removed" in env.client.get(r.headers["location"]).text
    assert learn.load(env.conn).block_senders == frozenset()
    assert learn.rebuild(env.conn) == [] and learn.load(env.conn).block_senders == frozenset()      # same evidence: stays undone
    sync_in(env, mail("Re: your application", ADVERT, "Coach <hi@coachco.io>", id="again", day=4))
    again = env.conn.execute("SELECT id FROM emails WHERE needs_review = 1").fetchone()[0]
    env.client.post(f"/review/{again}", data={"action": "dismiss"})                                    # a second flag is new evidence
    assert learn.load(env.conn).block_senders == frozenset({"hi@coachco.io"})
    assert env.client.post("/learned/9999/undo").status_code == 404


# --- safety ----------------------------------------------------------------------------------------

def test_flagging_never_touches_other_applications_and_unknown_ids_are_404(env):
    keep = env.conn.execute("INSERT INTO applications (company, company_key, role, role_key, stage) VALUES ('Keep', 'keep', 'R', 'r', 'Applied')").lastrowid
    env.conn.commit()
    assert env.client.post("/app/999/not-application").status_code == 404
    assert env.conn.execute("SELECT COUNT(*) FROM applications WHERE id = ?", (keep,)).fetchone()[0] == 1


def test_a_hand_made_application_with_no_emails_is_just_removed(env):
    app = env.conn.execute("INSERT INTO applications (company, company_key, role, role_key, stage, manual) VALUES ('Mine', 'mine', 'R', 'r', 'Applied', 1)").lastrowid
    env.conn.commit()
    r = env.client.post(f"/app/{app}/not-application")
    assert "Removed Mine." in env.client.get(r.headers["location"]).text
    assert env.conn.execute("SELECT COUNT(*) FROM learned_rules").fetchone()[0] == 0


def test_the_new_routes_are_protected_like_the_rest(env):
    for path in ("/app/1/not-application", "/learned/1/undo"):
        assert env.client.post(path, headers={"origin": "https://evil.example.com"}).status_code == 403, path
        assert env.client.post(path, headers={"sec-fetch-site": "cross-site"}).status_code == 403, path


def test_the_buttons_are_on_the_pages(env):
    app = env.conn.execute("INSERT INTO applications (company, company_key, role, role_key, stage, last_activity) VALUES ('A', 'a', 'R', 'r', 'Applied', '2026-10-01T00:00:00Z')").lastrowid
    env.conn.commit()
    assert "Not an application" in env.client.get(f"/app/{app}").text
    page = env.client.get("/review").text
    assert "What the app has learned" in page and "Nothing yet" in page


# --- a mistaken flag must not hide a real job ---------------------------------------------------------

def block(env, sender):
    env.conn.execute("INSERT INTO learned_rules (kind, value, evidence, active, created_at) VALUES ('block_sender', ?, 1, 1, '2026-10-01T00:00:00Z')", (sender,))
    env.conn.commit()


def test_a_blocked_sender_whose_subject_is_about_an_application_goes_to_review_not_the_bin(env):
    block(env, "pat@acme.io")
    msg = mail("Thank you for applying to Acme", "We received your application for the Data Analyst role.", "Pat <pat@acme.io>")
    cls = classify(msg, learn.load(env.conn))
    assert cls.related and cls.confidence == "low" and "overridden" in cls.reason
    assert sync_in(env, msg) == ["review"]
    assert env.conn.execute("SELECT COUNT(*) FROM ignored_mail").fetchone()[0] == 0


def test_a_blocked_sender_whose_subject_is_not_about_an_application_is_still_ignored(env):
    block(env, "hi@coachco.io")
    assert sync_in(env, mail("This week's tips", ADVERT, "Coach <hi@coachco.io>")) == ["ignored"]


# --- the ignored list and the appeal --------------------------------------------------------------------

def test_mail_ignored_by_a_learned_rule_is_listed_and_can_be_restored_with_one_click(env):
    block(env, "pat@acme.io")
    msg = mail("Quick note", "We would like to schedule an interview with you for the analyst role at Acme.", "Pat Lee <pat@acme.io>", id="real")
    assert sync_in(env, msg) == ["ignored"]
    row = env.conn.execute("SELECT * FROM ignored_mail").fetchone()
    assert (row["sender"], row["subject"]) == ("Pat Lee <pat@acme.io>", "Quick note") and "interview" in row["body"]
    page = env.client.get("/review").text
    assert "Ignored because of what it learned" in page and "Quick note" in page and "This was a real job" in page

    r = env.client.post(f"/ignored/{row['id']}/real")
    assert r.status_code == 303
    assert "Restored" in env.client.get(r.headers["location"]).text
    assert env.conn.execute("SELECT COUNT(*) FROM ignored_mail").fetchone()[0] == 0
    kinds = {(x["kind"], x["active"]) for x in env.conn.execute("SELECT kind, active FROM learned_rules")}
    assert ("block_sender", 0) in kinds and ("allow_sender", 1) in kinds             # the block is off, the sender trusted
    restored = env.conn.execute("SELECT related, needs_review, subject FROM emails").fetchone()
    assert restored["related"] == 1 and restored["subject"] == "Quick note"
    assert sync_in(env, mail("Another", ADVERT, "Pat <pat@acme.io>", id="next", day=7)) != ["ignored"]


def test_restoring_any_mail_from_a_sender_lands_in_review_for_you_to_judge(env):
    block(env, "hi@coachco.io")
    sync_in(env, mail("Weekly tips", "Ten habits of highly effective people.", "Coach <hi@coachco.io>", id="tips"))
    row = env.conn.execute("SELECT id FROM ignored_mail").fetchone()
    page = env.client.get(env.client.post(f"/ignored/{row['id']}/real").headers["location"]).text
    assert "Restored. It&#39;s in Needs review" in page
    assert env.conn.execute("SELECT needs_review FROM emails").fetchone()[0] == 1


def test_recheck_keeps_what_a_learned_rule_clears_restorable(env):
    sync_in(env, mail("Quick note", ADVERT, "Coach <hi@coachco.io>", id="x"))
    assert env.conn.execute("SELECT COUNT(*) FROM emails WHERE related = 1").fetchone()[0] == 1
    block(env, "hi@coachco.io")
    from jobtracker.recheck import recheck
    assert recheck(env.conn)["cleared"] == 1
    assert env.conn.execute("SELECT subject FROM ignored_mail").fetchone()[0] == "Quick note"


def test_old_ignored_mail_is_dropped_after_30_days(env):
    block(env, "hi@coachco.io")
    sync_in(env, mail("Old", ADVERT, "Coach <hi@coachco.io>", id="old"))
    env.conn.execute("UPDATE ignored_mail SET created_at = '2026-01-01T00:00:00Z'")
    env.conn.commit()
    sync_in(env, mail("New", ADVERT, "Coach <hi@coachco.io>", id="new", day=3))
    assert [r[0] for r in env.conn.execute("SELECT subject FROM ignored_mail")] == ["New"]


def test_the_appeal_route_is_protected_and_rejects_unknown_ids(env):
    assert env.client.post("/ignored/999/real").status_code == 404
    assert env.client.post("/ignored/1/real", headers={"origin": "https://evil.example.com"}).status_code == 403
