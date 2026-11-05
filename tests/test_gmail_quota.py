"""Gmail's rate limit must slow the sync down, not break it or throw away what it already read."""
import json
from datetime import datetime, timezone

import pytest
from googleapiclient.errors import HttpError

from jobtracker import db
from jobtracker.providers import gmail
from jobtracker.sync import sync_account
from tests.helpers import mk


class Resp(dict):
    def __init__(self, status):
        super().__init__()
        self.status = status
        self.reason = "x"


def http_error(status, reason):
    body = json.dumps({"error": {"errors": [{"reason": reason}]}}).encode()
    return HttpError(Resp(status), body)


QUOTA = lambda: http_error(403, "rateLimitExceeded")


class Request:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)

    def execute(self):
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


@pytest.fixture
def waits(monkeypatch):
    seen = []
    monkeypatch.setattr(gmail, "_sleep", seen.append)
    return seen


def test_a_rate_limit_answer_is_waited_out_and_retried(waits):
    assert gmail._execute(Request([QUOTA(), QUOTA(), {"ok": 1}])) == {"ok": 1}
    assert waits == [5, 15]


@pytest.mark.parametrize("status,reason", [(429, "rateLimitExceeded"), (403, "userRateLimitExceeded"), (503, "backendError")])
def test_other_slow_down_and_server_hiccups_are_retried_too(waits, status, reason):
    assert gmail._execute(Request([http_error(status, reason), {"ok": 1}])) == {"ok": 1}
    assert len(waits) == 1


def test_it_gives_up_after_the_last_wait(waits):
    with pytest.raises(HttpError):
        gmail._execute(Request([QUOTA() for _ in range(len(gmail.RETRY_WAITS) + 1)]))
    assert waits == list(gmail.RETRY_WAITS)


@pytest.mark.parametrize("error", [http_error(401, "authError"), http_error(404, "notFound"), http_error(403, "insufficientPermissions")])
def test_real_errors_are_not_retried(waits, error):
    with pytest.raises(HttpError):
        gmail._execute(Request([error, {"ok": 1}]))
    assert waits == []


# --- fetching: oldest first, retrying each request ----------------------------------------------

class Service:
    def __init__(self, ids, bodies, fail_get=None):
        self.ids, self.bodies, self.fail_get = ids, bodies, fail_get or {}
        self.gets = []

    def users(self):
        return self

    def messages(self):
        return self

    def list(self, **kw):
        return Request([{"messages": [{"id": i} for i in self.ids]}])

    def get(self, userId, id, format):
        self.gets.append(id)
        outcomes = self.fail_get.get(id, [])
        return Request([*outcomes, self.bodies[id]])


def raw(mid, day):
    return {"id": mid, "threadId": mid, "internalDate": str(int(datetime(2026, 10, day, tzinfo=timezone.utc).timestamp() * 1000)),
            "payload": {"headers": [{"name": "From", "value": "Acme <jobs@acme.com>"}, {"name": "Subject", "value": f"Thank you for applying {mid}"}],
                        "mimeType": "text/plain", "body": {"data": "SGk="}}}


def provider_with(service, monkeypatch):
    p = gmail.GmailProvider("me@gmail.com")
    monkeypatch.setattr(p, "_credentials", lambda: None)
    monkeypatch.setattr(gmail.GmailProvider, "_service", staticmethod(lambda creds: service))
    return p


def test_messages_come_out_oldest_first_and_rate_limits_mid_download_are_absorbed(waits, monkeypatch):
    service = Service(["new", "mid", "old"], {"new": raw("new", 3), "mid": raw("mid", 2), "old": raw("old", 1)},
                      fail_get={"mid": [QUOTA()]})
    p = provider_with(service, monkeypatch)
    got = [m.id for m in p.fetch(datetime(2026, 9, 1, tzinfo=timezone.utc), lambda mid: False)]
    assert got == ["old", "mid", "new"] and waits == [5]
    assert p.oldest_first


def test_already_stored_messages_are_not_downloaded_again(monkeypatch):
    service = Service(["a", "b"], {"a": raw("a", 1), "b": raw("b", 2)})
    p = provider_with(service, monkeypatch)
    list(p.fetch(datetime(2026, 9, 1, tzinfo=timezone.utc), lambda mid: mid == "a"))
    assert service.gets == ["b"]


# --- a sync cut short keeps what it read -----------------------------------------------------------

class Flaky:
    oldest_first = True

    def __init__(self, n, fail_after):
        self.n, self.fail_after = n, fail_after

    def fetch(self, since, skip):
        for i in range(self.n):
            if i == self.fail_after:
                raise RuntimeError("Quota exceeded")
            if not skip(f"m{i}"):
                yield mk(f"m{i}", f"Thank you for applying to Company{i}", thread=f"t{i}", day=1 + i % 20)


def test_a_sync_that_stops_part_way_keeps_its_progress_and_the_next_one_resumes(monkeypatch):
    from jobtracker import sync as sync_module

    monkeypatch.setattr(sync_module, "BATCH", 5)
    conn = db.connect(":memory:")
    db.upsert_account(conn, "gmail", "me@gmail.com")
    conn.commit()
    with pytest.raises(RuntimeError, match="Quota exceeded"):
        sync_account(conn, conn.execute("SELECT * FROM accounts").fetchone(), get_provider=lambda n, a: Flaky(12, fail_after=8))
    row = conn.execute("SELECT last_sync, last_error FROM accounts").fetchone()
    assert row["last_sync"] is None and "Quota exceeded" in row["last_error"]       # not marked as finished
    assert conn.execute("SELECT COUNT(*) FROM emails").fetchone()[0] == 8            # everything read before it stopped was saved
    counts = sync_account(conn, conn.execute("SELECT * FROM accounts").fetchone(), get_provider=lambda n, a: Flaky(12, fail_after=99))
    assert sum(counts.values()) == 4 and conn.execute("SELECT COUNT(*) FROM emails").fetchone()[0] == 12
    assert conn.execute("SELECT last_sync FROM accounts").fetchone()[0] is not None
