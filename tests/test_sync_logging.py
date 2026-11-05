"""A message that fails is still skipped for good, but the failure leaves a traceback in the log, with no mail text in it."""
import logging
import sqlite3

import pytest

from jobtracker import db, sync
from tests.helpers import mk


@pytest.fixture
def acct():
    conn = db.connect(":memory:")
    return conn, db.upsert_account(conn, "gmail", "me@gmail.com")


def test_a_failing_message_logs_its_id_and_traceback_but_not_its_text(acct, monkeypatch, caplog):
    conn, account = acct
    def boom(*args, **kwargs):
        raise ValueError("parser blew up")
    monkeypatch.setattr(sync, "process_message", boom)
    msg = mk("abc123", "Interview with Zebra Corp about salary", "Private body text 555-0100")
    with caplog.at_level(logging.WARNING, logger="jobtracker.sync"):
        assert sync.process_messages(conn, account, [msg]) == {"error": 1}
    [record] = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert record.name == "jobtracker.sync" and "abc123" in record.getMessage()
    assert record.exc_info and record.exc_info[0] is ValueError          # the traceback is kept
    text = record.getMessage()
    assert "Zebra" not in text and "salary" not in text and "555-0100" not in text and "me@gmail.com" not in text
    assert db.email_seen(conn, account, "abc123")                         # and it is still marked seen, as before


def test_a_locked_database_logs_a_warning_and_is_retried(acct, monkeypatch, caplog):
    conn, account = acct
    def locked(*args, **kwargs):
        raise sqlite3.OperationalError("database is locked")
    monkeypatch.setattr(sync, "process_message", locked)
    with caplog.at_level(logging.WARNING, logger="jobtracker.sync"):
        assert sync.process_messages(conn, account, [mk("r1", "Thanks for applying")]) == {"retry": 1}
    assert any(r.levelno == logging.WARNING and "r1" in r.getMessage() for r in caplog.records)
    assert not db.email_seen(conn, account, "r1")


def test_a_real_provider_is_required_to_sync(acct):
    conn, _ = acct
    account = conn.execute("SELECT * FROM accounts").fetchone()
    with pytest.raises(TypeError):
        sync.sync_account(conn, account)          # there is no silent default that would read the wrong profile's tokens
    with pytest.raises(TypeError):
        sync.sync_all(conn)
