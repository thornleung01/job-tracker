import base64
from datetime import datetime, timezone

from jobtracker import db
from jobtracker.providers import gmail, outlook
from jobtracker.sync import sync_all


def b64(s: str) -> str:
    return base64.urlsafe_b64encode(s.encode()).decode().rstrip("=")


def test_gmail_prefers_plain_text_part():
    raw = {
        "id": "g1", "threadId": "th1", "internalDate": "1790000000000",
        "payload": {
            "mimeType": "multipart/alternative",
            "headers": [
                {"name": "From", "value": "Acme Careers <no-reply@greenhouse.io>"},
                {"name": "Subject", "value": "Thank you for applying"},
            ],
            "parts": [
                {"mimeType": "text/html", "body": {"data": b64("<p>html version</p>")}},
                {"mimeType": "text/plain", "body": {"data": b64("plain version")}},
            ],
        },
    }
    m = gmail.parse_message(raw)
    assert (m.id, m.thread_id, m.sender_name, m.sender_email) == ("g1", "th1", "Acme Careers", "no-reply@greenhouse.io")
    assert m.body == "plain version" and m.received_at.tzinfo is not None


def test_gmail_falls_back_to_html_text():
    raw = {
        "id": "g2", "internalDate": "1790000000000",
        "payload": {"mimeType": "text/html", "headers": [{"name": "From", "value": "a@b.com"}],
                    "body": {"data": b64("<html><body><p>Hello <b>there</b></p><script>x()</script></body></html>")}},
    }
    m = gmail.parse_message(raw)
    assert "Hello" in m.body and "there" in m.body and "x()" not in m.body
    assert m.thread_id == "g2" and m.subject == ""


def test_outlook_parse_html_body_and_utc_time():
    raw = {
        "id": "o1", "conversationId": "c1", "subject": "Interview invitation",
        "from": {"emailAddress": {"name": "Sam", "address": "sam@acme.com"}},
        "receivedDateTime": "2026-10-05T14:30:00Z",
        "body": {"contentType": "html", "content": "<div>Please <b>pick</b> a time</div>"},
    }
    m = outlook.parse_message(raw)
    assert m.thread_id == "c1" and m.sender_email == "sam@acme.com"
    assert m.received_at == datetime(2026, 10, 5, 14, 30, tzinfo=timezone.utc)
    assert "pick" in m.body and "<" not in m.body


class FakeProvider:
    def __init__(self, messages=None, error=None):
        self.messages, self.error = messages or [], error

    def fetch(self, since, skip):
        if self.error:
            raise self.error
        yield from (m for m in self.messages if not skip(m.id))


def test_one_failing_account_does_not_stop_the_other():
    from tests.test_pipeline import mk

    conn = db.connect(":memory:")
    db.upsert_account(conn, "gmail", "a@gmail.com")
    db.upsert_account(conn, "outlook", "b@outlook.com")
    providers = {
        "gmail": FakeProvider(error=RuntimeError("token expired")),
        "outlook": FakeProvider([mk("1", "Thank you for applying to Acme")]),
    }
    results = sync_all(conn, get_provider=lambda name, addr: providers[name])
    assert results["gmail:a@gmail.com"].startswith("error:")
    assert results["outlook:b@outlook.com"] == {"applied-to-application": 1}
    rows = {r["provider"]: r for r in conn.execute("SELECT * FROM accounts")}
    assert "token expired" in rows["gmail"]["last_error"] and rows["gmail"]["last_sync"] is None
    assert rows["outlook"]["last_error"] is None and rows["outlook"]["last_sync"] is not None
