"""The reply links that open your own webmail, and showing which email is newest."""
import re
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from jobtracker import db
from jobtracker.links import reply_link
from jobtracker.web import create_app


def query(url):
    return {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}


# --- the links ----------------------------------------------------------------------------------

def test_a_gmail_reply_opens_a_new_message_addressed_to_the_sender_in_that_account():
    label, url = reply_link("gmail", "me@gmail.com", "Pat Lee <pat@acme.com>", "Interview invitation")
    q = query(url)
    assert label == "Reply in Gmail" and url.startswith("https://mail.google.com/mail/?authuser=me%40gmail.com&view=cm")
    assert q["to"] == "pat@acme.com" and q["su"] == "Re: Interview invitation" and q["authuser"] == "me@gmail.com"


def test_re_is_not_doubled_and_an_empty_subject_still_works():
    assert query(reply_link("gmail", "me@gmail.com", "pat@acme.com", "RE: Hello")[1])["su"] == "RE: Hello"
    assert query(reply_link("gmail", "me@gmail.com", "pat@acme.com", "re: Hello")[1])["su"] == "re: Hello"
    assert query(reply_link("gmail", "me@gmail.com", "pat@acme.com", None)[1])["su"] == "Re:"


def test_outlook_replies_use_the_consumer_or_work_site_to_match_the_account():
    label, personal = reply_link("outlook", "me@outlook.com", "Pat <pat@acme.com>", "Hello")
    assert label == "Reply in Outlook" and personal.startswith("https://outlook.live.com/mail/0/deeplink/compose?") and query(personal)["to"] == "pat@acme.com"
    assert reply_link("outlook", "me@company.com", "Pat <pat@acme.com>", "Hello")[1].startswith("https://outlook.office.com/mail/deeplink/compose?")
    # the message's own link says which site holds the mailbox, and wins over the address
    assert reply_link("outlook", "me@hotmail.com", "pat@acme.com", "x", web_link="https://outlook.live.com/owa/?ItemID=1")[1].startswith("https://outlook.live.com")
    assert reply_link("outlook", "me@work.com", "pat@acme.com", "x", web_link="https://outlook.office.com/owa/?ItemID=1")[1].startswith("https://outlook.office.com")


@pytest.mark.parametrize("sender", [
    "Deel <no-reply@deel.support>", "Acme <noreply@acme.com>", "Acme <do-not-reply@acme.com>", "x <notifications@github.com>",
    "mailer-daemon@googlemail.com", "Pat <not an address>", "", "Pat Lee",
])
def test_senders_that_do_not_take_replies_get_no_button(sender):
    assert reply_link("gmail", "me@gmail.com", sender, "Hi") is None


def test_the_address_and_subject_cannot_break_out_of_the_link():
    url = reply_link("gmail", "me@gmail.com", "Pat <pat@acme.com>", "Hi&bcc=evil@x.com #1")[1]
    q = query(url)
    assert "bcc" not in q and q["su"] == "Re: Hi&bcc=evil@x.com #1" and q["to"] == "pat@acme.com"
    assert reply_link("gmail", "me@gmail.com", "evil@x.com&bcc=a@b.com", "Hi") is None


# --- the pages ------------------------------------------------------------------------------------

@pytest.fixture
def env(tmp_path):
    path = tmp_path / "t.db"
    conn = db.connect(path)
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    app = db.create_application(conn, "Acme", "acme", "Analyst", "analyst", "Interview", "2026-10-01T09:00:00Z")

    def add(mid, when, sender, subject, body="Hello there, this is a message."):
        conn.execute("INSERT INTO emails (account_id, provider_msg_id, thread_id, received_at, sender, subject, body, related, event, confidence, application_id) "
                     "VALUES (?, ?, 't1', ?, ?, ?, ?, 1, 'interview', 'high', ?)", (acct, mid, when, sender, subject, body, app))
    add("a", "2026-10-02T09:00:00Z", "Pat Lee <pat@acme.com>", "First: your application")
    add("b", "2026-10-09T14:30:00Z", "Acme <no-reply@acme.com>", "Automated reminder")
    add("c", "2026-10-05T10:15:00Z", "Pat Lee <pat@acme.com>", "Re: Interview times")
    conn.commit()
    c = TestClient(create_app(path), base_url="http://127.0.0.1:8765", follow_redirects=False)
    yield conn, c, app


def test_the_timeline_is_newest_first_and_marks_the_latest_with_its_exact_time(env):
    _, c, app = env
    html = c.get(f"/app/{app}").text
    subjects = re.findall(r'<h3 class="mail-subject">([^<]+)</h3>', html)
    assert subjects == ["Automated reminder", "Re: Interview times", "First: your application"]      # by time received, not by arrival order
    assert html.count('class="tag latest"') == 1 and html.index('class="tag latest"') < html.index('<h3 class="mail-subject">Re: Interview times')
    assert 'datetime="2026-10-09T14:30:00Z" data-rel>2026-10-09 14:30 UTC</time>' in html


def test_reply_buttons_appear_only_where_a_reply_is_possible(env):
    _, c, app = env
    html = c.get(f"/app/{app}").text
    assert html.count("Reply in Gmail") == 2 and html.count("This sender doesn't take replies.") == 1
    assert "su=Re%3A%20Interview%20times" in html and "su=Re%3A%20First%3A%20your%20application" in html
    assert 'target="_blank" rel="noopener noreferrer"' in html


def test_the_expanded_row_shows_the_time_a_latest_marker_and_a_reply_button(env):
    _, c, app = env
    html = c.get(f"/app/{app}/panel").text
    assert html.count('class="tag latest"') == 1 and 'data-fmt="short"' in html and "Reply in Gmail" in html
    assert html.index('class="tag latest"') < html.index("Re: Interview times")


def test_every_page_localises_times_once_in_the_shared_script(env):
    _, c, app = env
    for path in ("/", f"/app/{app}", "/settings", "/jobs"):
        html = c.get(path).text
        assert html.count("const localize = root =>") == 1 and "MutationObserver" in html, path
