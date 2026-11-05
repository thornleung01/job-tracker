"""After you flag mail, only mail from a blocked sender is read again; the Re-check button still reads everything."""
import pytest

from jobtracker import db, learn, recheck
from jobtracker.sync import process_message
from tests.helpers import mk

ADVERT = "We would like to schedule an interview prep session with you for the analyst role."


@pytest.fixture
def conn():
    c = db.connect(":memory:")
    db.upsert_account(c, "gmail", "me@gmail.com")
    for i in range(12):                                     # genuine job mail from other senders
        process_message(c, 1, mk(f"g{i}", f"Thank you for applying to Co{i}", "We received your application.", sender=f"Co{i} <jobs@co{i}.com>", thread=f"t{i}"))
    process_message(c, 1, mk("bad", "Re: your application", ADVERT, sender="Career Coach <hi@coachco.io>"))
    c.commit()
    return c


def block_the_coach(conn):
    conn.execute("INSERT INTO learned_rules (kind, value, evidence, active, created_at) VALUES ('block_sender', 'hi@coachco.io', 2, 1, '2026-10-01T00:00:00Z')")
    conn.commit()


def cleared_ids(conn):
    return {r["provider_msg_id"] for r in conn.execute("SELECT provider_msg_id FROM emails WHERE related = 0 AND sender IS NULL AND subject IS NULL")}


def test_the_narrow_pass_clears_exactly_what_the_full_pass_clears(conn):
    block_the_coach(conn)
    narrow = recheck.recheck(conn, only_blocked=True)
    after_narrow = cleared_ids(conn)

    other = db.connect(":memory:")
    db.upsert_account(other, "gmail", "me@gmail.com")
    for i in range(12):
        process_message(other, 1, mk(f"g{i}", f"Thank you for applying to Co{i}", "We received your application.", sender=f"Co{i} <jobs@co{i}.com>", thread=f"t{i}"))
    process_message(other, 1, mk("bad", "Re: your application", ADVERT, sender="Career Coach <hi@coachco.io>"))
    block_the_coach(other)
    full = recheck.recheck(other)
    assert after_narrow == cleared_ids(other) == {"bad"}
    assert narrow["cleared"] == full["cleared"] == 1 and narrow["removed"] == full["removed"]


def test_the_narrow_pass_reads_only_the_blocked_senders_mail(conn, monkeypatch):
    block_the_coach(conn)
    seen = []
    real = recheck.classify
    monkeypatch.setattr(recheck, "classify", lambda msg, learned=None: seen.append(msg.id) or real(msg, learned))
    result = recheck.recheck(conn, only_blocked=True)
    assert seen == ["bad"] and result["checked"] == 1
    seen.clear()
    assert recheck.recheck(conn)["checked"] == 12 and len(seen) == 12      # the full pass reads every stored job email


def test_a_blocked_domain_is_found_through_the_stored_sender_text(conn):
    conn.execute("INSERT INTO learned_rules (kind, value, evidence, active, created_at) VALUES ('block_domain', 'coachco.io', 2, 1, '2026-10-01T00:00:00Z')")
    assert recheck.recheck(conn, only_blocked=True)["cleared"] == 1


def test_with_no_learned_block_the_narrow_pass_reads_nothing(conn):
    assert recheck.recheck(conn, only_blocked=True)["checked"] == 0


def test_learn_rebuild_still_gives_the_blocks_the_narrow_pass_uses(conn):
    conn.execute("INSERT INTO feedback (created_at, verdict, sender_email, sender_domain, subject, reason) VALUES ('2026-10-01T00:00:00Z', 'not_job', 'hi@coachco.io', 'coachco.io', 'x', 'weak: x')")
    conn.execute("INSERT INTO feedback (created_at, verdict, sender_email, sender_domain, subject, reason) VALUES ('2026-10-02T00:00:00Z', 'not_job', 'hi@coachco.io', 'coachco.io', 'y', 'weak: x')")
    assert learn.rebuild(conn) and recheck.recheck(conn, only_blocked=True)["cleared"] == 1
