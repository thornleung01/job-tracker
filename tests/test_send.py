"""Replying from the app: permission, safety limits, the providers' send calls, and how it shows up."""
import base64
import email
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from jobtracker import config, db, reply
from jobtracker.providers import gmail, outlook
from jobtracker.providers.base import NotAllowed, NotConnected
from jobtracker.web import create_app

NOW = datetime(2026, 11, 3, 15, 0, tzinfo=timezone.utc)


class FakeProvider:
    def __init__(self, address="me@gmail.com", fail=None):
        self.address, self.fail, self.sent, self.connected_with_send = address, fail, [], []

    def connect(self, send=False):
        self.connected_with_send.append(send)
        return self.address

    def send_reply(self, **kw):
        if self.fail:
            raise self.fail
        self.sent.append(kw)
        return "sent-id"

    def fetch(self, since, skip):
        return iter(())


@pytest.fixture
def env(tmp_path):
    path = tmp_path / "t.db"
    conn = db.connect(path)
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    conn.execute("UPDATE accounts SET can_reply = 1")
    app = db.create_application(conn, "Acme", "acme", "Analyst", "analyst", "Interview", "2026-10-01T09:00:00Z")

    def add(mid, sender, subject, when="2026-10-05T10:00:00Z", related=1, review=0):
        cur = conn.execute("INSERT INTO emails (account_id, provider_msg_id, thread_id, received_at, sender, subject, body, related, event, confidence, application_id, needs_review) "
                           "VALUES (?, ?, 'thread-1', ?, ?, ?, 'Hello, can we talk?', ?, 'interview', 'high', ?, ?)",
                           (acct, mid, when, sender, subject, related, None if review else app, review))
        return cur.lastrowid
    pat = add("g1", "Pat Lee <pat@acme.com>", "Interview times")
    bot = add("g2", "Acme <no-reply@acme.com>", "Reminder", when="2026-10-06T10:00:00Z")
    conn.commit()
    provider = FakeProvider()
    client = TestClient(create_app(path, get_provider=lambda n, a: provider), base_url="http://127.0.0.1:8765", follow_redirects=False)

    class E:
        pass
    e = E()
    e.conn, e.acct, e.app, e.pat, e.bot, e.provider, e.client, e.add = conn, acct, app, pat, bot, provider, client, add
    return e


def send(e, email_id=None, body="Thanks Pat, Tuesday works.", token="abcdef0123456789", now=NOW):
    return reply.send(e.conn, lambda n, a: e.provider, email_id or e.pat, body, token, now)


# --- the safety rules --------------------------------------------------------------------------

def test_a_reply_goes_to_the_stored_sender_in_the_same_conversation_and_is_recorded(env):
    result = send(env)
    assert result == {"to": "pat@acme.com", "duplicate": False}
    sent = env.provider.sent[0]
    assert sent == {"thread_id": "thread-1", "message_id": "g1", "to": "pat@acme.com", "subject": "Re: Interview times", "body": "Thanks Pat, Tuesday works."}
    row = env.conn.execute("SELECT * FROM sent_replies").fetchone()
    assert (row["to_addr"], row["application_id"], row["reply_to_email_id"]) == ("pat@acme.com", env.app, env.pat)
    assert env.conn.execute("SELECT last_activity FROM applications").fetchone()[0] >= "2026-11-03T15:00:00Z"


def test_pressing_send_twice_sends_once(env):
    send(env)
    assert send(env)["duplicate"] is True
    assert len(env.provider.sent) == 1 and env.conn.execute("SELECT COUNT(*) FROM sent_replies").fetchone()[0] == 1


def test_a_failed_send_is_not_recorded_and_can_be_retried(env):
    env.provider.fail = RuntimeError("network down")
    with pytest.raises(reply.ReplyError, match="wasn't sent: network down"):
        send(env)
    assert env.conn.execute("SELECT COUNT(*) FROM sent_replies").fetchone()[0] == 0
    env.provider.fail = None
    assert send(env)["duplicate"] is False and len(env.provider.sent) == 1          # the same form works the second time


def test_missing_permission_is_explained(env):
    env.provider.fail = NotAllowed("Gmail hasn't been given permission to send.")
    with pytest.raises(reply.ReplyError, match="permission to send"):
        send(env)
    assert env.conn.execute("SELECT COUNT(*) FROM sent_replies").fetchone()[0] == 0


@pytest.mark.parametrize("setup,message", [
    ("UPDATE accounts SET can_reply = 0", "isn't turned on"),
    ("UPDATE accounts SET active = 0", "isn't turned on"),
])
def test_it_only_sends_for_an_account_that_was_allowed(env, setup, message):
    env.conn.execute(setup)
    env.conn.commit()
    with pytest.raises(reply.ReplyError, match=message):
        send(env)
    assert env.provider.sent == []


def test_senders_that_take_no_replies_and_unknown_emails_are_refused(env):
    with pytest.raises(reply.ReplyError, match="doesn't take replies"):
        send(env, env.bot)
    with pytest.raises(reply.ReplyError, match="can't be found"):
        send(env, 999)
    ordinary = env.conn.execute("UPDATE emails SET related = 0 WHERE id = ?", (env.pat,))
    env.conn.commit()
    with pytest.raises(reply.ReplyError, match="can't be found"):
        send(env)
    assert env.provider.sent == []


@pytest.mark.parametrize("body,message", [("", "Write something"), ("   \n ", "Write something"), ("x" * 5001, "5000 characters")])
def test_empty_and_oversized_replies_are_refused(env, body, message):
    with pytest.raises(reply.ReplyError, match=message):
        send(env, body=body)


@pytest.mark.parametrize("token", ["", "short", "NOT-HEX-TOKEN-0000", "a" * 100])
def test_a_missing_or_malformed_form_token_is_refused(env, token):
    with pytest.raises(reply.ReplyError, match="expired"):
        send(env, token=token)


def test_there_is_a_cap_per_hour(env):
    for i in range(reply.MAX_PER_HOUR):
        send(env, token=f"{i:016x}")
    with pytest.raises(reply.ReplyError, match=f"{reply.MAX_PER_HOUR} replies in the last hour"):
        send(env, token="f" * 16)
    assert len(env.provider.sent) == reply.MAX_PER_HOUR
    assert send(env, token="e" * 16, now=NOW + timedelta(hours=2))["duplicate"] is False          # the hour has passed


def test_there_is_a_cap_per_day(env):
    for i in range(reply.MAX_PER_DAY):      # spread over the last day, so the hourly cap is nowhere near
        when = db.iso(NOW - timedelta(minutes=30 * i + 90))
        env.conn.execute("INSERT INTO sent_replies (created_at, account_id, to_addr, subject, body, token) VALUES (?, ?, 'x@y.co', 's', 'b', ?)",
                         (when, env.acct, f"{i + 1000:016x}"))
    env.conn.commit()
    with pytest.raises(reply.ReplyError, match=f"{reply.MAX_PER_DAY} replies in the last day"):
        send(env, token="d" * 16)
    assert env.provider.sent == []


def test_re_is_added_once():
    assert reply.subject_for("Hello") == "Re: Hello" and reply.subject_for("RE: Hello") == "RE: Hello" and reply.subject_for(None) == "Re:"
    assert reply.subject_for("Hi\r\nBcc: evil@x.com") == "Re: Hi Bcc: evil@x.com"          # no line breaks to smuggle a header in


# --- the providers' send calls ---------------------------------------------------------------------

class GmailService:
    def __init__(self):
        self.sent = None

    def users(self):
        return self

    def messages(self):
        return self

    def get(self, **kw):
        assert kw["format"] == "metadata" and kw["id"] == "g1"
        return SimpleNamespace(execute=lambda: {"payload": {"headers": [{"name": "Message-ID", "value": "<abc@mail.acme.com>"}, {"name": "References", "value": "<root@x>"}]}})

    def send(self, userId, body):
        self.sent = body
        return SimpleNamespace(execute=lambda: {"id": "newid"})


def gmail_provider(monkeypatch, scopes):
    service = GmailService()
    p = gmail.GmailProvider("me@gmail.com")
    monkeypatch.setattr(p, "_credentials", lambda: SimpleNamespace(scopes=scopes))
    monkeypatch.setattr(gmail.GmailProvider, "_service", staticmethod(lambda creds: service))
    return p, service


def test_gmail_replies_stay_in_the_conversation(monkeypatch):
    p, service = gmail_provider(monkeypatch, [config.GMAIL_SCOPES[0], config.GMAIL_SEND_SCOPE])
    assert p.send_reply(thread_id="thread-1", message_id="g1", to="pat@acme.com", subject="Re: Hi", body="Thanks!") == "newid"
    assert service.sent["threadId"] == "thread-1"
    msg = email.message_from_bytes(base64.urlsafe_b64decode(service.sent["raw"]))
    assert (msg["To"], msg["Subject"], msg["In-Reply-To"]) == ("pat@acme.com", "Re: Hi", "<abc@mail.acme.com>")
    assert msg["References"] == "<root@x> <abc@mail.acme.com>" and msg.get_payload(decode=True).decode().strip() == "Thanks!"


def test_gmail_refuses_to_send_without_the_send_permission(monkeypatch):
    p, service = gmail_provider(monkeypatch, [config.GMAIL_SCOPES[0]])
    with pytest.raises(NotAllowed, match="permission to send"):
        p.send_reply(thread_id="t", message_id="g1", to="pat@acme.com", subject="Re: Hi", body="x")
    assert service.sent is None


class Posted:
    def __init__(self, status):
        self.status_code = status


def test_outlook_replies_use_graphs_reply_call_with_the_stored_message_id(monkeypatch):
    calls = {}
    monkeypatch.setattr(outlook.requests, "post", lambda url, **kw: calls.update(url=url, **kw) or Posted(202))
    p = outlook.OutlookProvider("me@outlook.com")
    monkeypatch.setattr(p, "_token", lambda scopes=None: calls.setdefault("scopes", scopes) and "TOKEN")
    p.send_reply(thread_id="c", message_id="AAMk=/id+1", to="pat@acme.com", subject="Re: Hi", body="Thanks!")
    assert calls["url"] == "https://graph.microsoft.com/v1.0/me/messages/AAMk%3D%2Fid%2B1/reply" and calls["json"] == {"comment": "Thanks!"}
    assert calls["scopes"] == ["Mail.Send"] and calls["headers"]["Authorization"] == "Bearer TOKEN" and "ImmutableId" in calls["headers"]["Prefer"]


def test_outlook_errors_and_missing_permission_are_explained(monkeypatch):
    monkeypatch.setattr(outlook.requests, "post", lambda url, **kw: Posted(403))
    p = outlook.OutlookProvider("me@outlook.com")
    monkeypatch.setattr(p, "_token", lambda scopes=None: "TOKEN")
    with pytest.raises(RuntimeError, match="error 403"):
        p.send_reply(thread_id="c", message_id="m", to="a@b.co", subject="Re: x", body="x")

    def no_consent(scopes=None):
        raise NotConnected("needs sign in")
    monkeypatch.setattr(p, "_token", no_consent)
    with pytest.raises(NotAllowed, match="permission to send"):
        p.send_reply(thread_id="c", message_id="m", to="a@b.co", subject="Re: x", body="x")


def test_reading_stays_read_only_and_send_is_asked_for_only_when_replying_is_turned_on(monkeypatch, tmp_path):
    assert config.GMAIL_SCOPES == ["https://www.googleapis.com/auth/gmail.readonly"] and config.OUTLOOK_SCOPES == ["Mail.Read"]
    asked = []

    class Flow:
        @staticmethod
        def from_client_secrets_file(path, scopes):
            asked.append(list(scopes))
            raise RuntimeError("stop here")

    import google_auth_oauthlib.flow as flow_module
    monkeypatch.setattr(flow_module, "InstalledAppFlow", Flow)
    monkeypatch.setattr(gmail.clients, "gmail_ready", lambda: True)
    for send_flag in (False, True):
        with pytest.raises(RuntimeError):
            gmail.GmailProvider().connect(send=send_flag)
    assert asked == [[config.GMAIL_SCOPES[0]], [config.GMAIL_SCOPES[0], config.GMAIL_SEND_SCOPE]]

    seen = []
    fake_app = SimpleNamespace(acquire_token_interactive=lambda scopes, **kw: seen.append(list(scopes)) or {"error_description": "stop"})
    monkeypatch.setattr(outlook.OutlookProvider, "_app", lambda self: fake_app)
    for send_flag in (False, True):
        with pytest.raises(NotConnected):
            outlook.OutlookProvider().connect(send=send_flag)
    assert seen == [["Mail.Read"], ["Mail.Read", "Mail.Send"]]


# --- the pages ----------------------------------------------------------------------------------------

def test_the_composer_appears_only_when_replying_is_on_and_the_sender_takes_replies(env):
    html = env.client.get(f"/app/{env.app}").text
    assert html.count('class="action primary reply"') == 1 and f'action="/email/{env.pat}/reply"' in html and "Send reply" in html
    assert 'name="token"' in html and "Only pat@acme.com receives it" in html and "This sender doesn't take replies." in html
    env.conn.execute("UPDATE accounts SET can_reply = 0")
    env.conn.commit()
    html = env.client.get(f"/app/{env.app}").text
    assert 'class="action primary reply"' not in html and "Reply in Gmail" in html and "Allow replying" in html


def test_sending_from_the_page_shows_the_reply_in_the_timeline_and_the_row_panel(env):
    page = env.client.get(f"/app/{env.app}").text
    token = __import__("re").search(r'name="token" value="([0-9a-f]+)"', page).group(1)
    r = env.client.post(f"/email/{env.pat}/reply", data={"body": "Tuesday at 2pm works.\n<script>alert(1)</script>", "token": token})
    assert r.status_code == 303 and r.headers["location"].startswith(f"/app/{env.app}?notice=")
    detail = env.client.get(r.headers["location"]).text
    assert "Reply sent to pat@acme.com." in detail and "Reply sent</span>" in detail and "Tuesday at 2pm works." in detail
    assert "<script>alert(1)</script>" not in detail and "&lt;script&gt;" in detail
    assert detail.count('class="tag latest"') == 1                                   # Latest still marks the newest email received
    assert "Reply sent" in env.client.get(f"/app/{env.app}/panel").text
    again = env.client.post(f"/email/{env.pat}/reply", data={"body": "Tuesday at 2pm works.", "token": token})
    assert "Already sent" in env.client.get(again.headers["location"]).text and len(env.provider.sent) == 1


def test_a_refused_reply_explains_itself_beside_the_replies(env):
    r = env.client.post(f"/email/{env.bot}/reply", data={"body": "hi", "token": "abcdef0123456789"})
    assert r.headers["location"].startswith(f"/app/{env.app}?reply_error=")
    page = env.client.get(r.headers["location"]).text
    assert 'role="alert"' in page and "doesn&#39;t take replies" in page and env.provider.sent == []


def test_the_review_page_can_reply_too(env):
    env.add("g3", "Sam <sam@acme.com>", "Quick question", review=1)
    env.conn.commit()
    html = env.client.get("/review").text
    assert 'class="action reply"' in html and "Send reply" in html


def test_settings_turns_replying_on_with_a_new_sign_in_and_off_again(env):
    env.conn.execute("UPDATE accounts SET can_reply = 0")
    env.conn.commit()
    assert "Allow replying" in env.client.get("/settings").text and "Replying from the app: <b>Off</b>" in env.client.get("/settings").text
    assert env.client.post(f"/settings/reply-access/{env.acct}", data={"mode": "on"}).status_code == 303
    env.client.app.state.connect_thread.join(5)
    assert env.provider.connected_with_send == [True]                                 # the sign-in asked for the send permission
    assert env.conn.execute("SELECT can_reply FROM accounts").fetchone()[0] == 1
    page = env.client.get("/settings").text
    assert "Replying is on." in page and "Turn off replying" in env.client.get("/settings").text
    off = env.client.post(f"/settings/reply-access/{env.acct}", data={"mode": "off"})
    assert "won&#39;t send anything" in env.client.get(off.headers["location"]).text and env.conn.execute("SELECT can_reply FROM accounts").fetchone()[0] == 0


def test_an_ordinary_reconnect_drops_the_send_permission_flag(env):
    env.client.post("/settings/connect/gmail")
    env.client.app.state.connect_thread.join(5)
    assert env.provider.connected_with_send == [False] and env.conn.execute("SELECT can_reply FROM accounts").fetchone()[0] == 0


def test_the_new_routes_are_protected_and_reject_bad_input(env):
    for path, data in ((f"/email/{env.pat}/reply", {"body": "x", "token": "abcdef0123456789"}), (f"/settings/reply-access/{env.acct}", {"mode": "on"})):
        assert env.client.post(path, data=data, headers={"origin": "https://evil.example.com"}).status_code == 403, path
        assert env.client.post(path, data=data, headers={"sec-fetch-site": "cross-site"}).status_code == 403, path
    assert env.client.post(f"/settings/reply-access/{env.acct}", data={"mode": "maybe"}).status_code == 404
    assert env.client.post("/settings/reply-access/999", data={"mode": "on"}).status_code == 404
    assert env.provider.sent == [] and env.provider.connected_with_send == []
