import re

import pytest
from fastapi.testclient import TestClient

from jobtracker import db, settings
from jobtracker.sync import process_message, process_messages
from jobtracker.web import create_app
from tests.test_pipeline import mk


class FakeProvider:
    def __init__(self, messages=(), address="me@gmail.com", fail=None):
        self.messages, self.address, self.fail = list(messages), address, fail

    def connect(self):
        if self.fail:
            raise RuntimeError(self.fail)
        return self.address

    def fetch(self, since, skip):
        yield from (m for m in self.messages if not skip(m.id))


@pytest.fixture
def env(tmp_path):
    path = tmp_path / "t.db"
    conn = db.connect(path)
    conn.commit()

    def client(provider=None):
        return TestClient(create_app(path, get_provider=(lambda n, a: provider) if provider else None),
                          base_url="http://127.0.0.1:8765", follow_redirects=False)
    yield conn, client
    conn.close()


def test_settings_page_renders_all_sections(env):
    _, client = env
    html = client().get("/settings").text
    for text in ("No accounts connected to this profile yet", "Profiles", "Email accounts", "Sync", "Appearance", "Set up Gmail", "Set up Outlook"):
        assert text in html


def test_provider_tiles_carry_no_emoji(env):
    conn, client = env
    html = client().get("/settings").text
    tiles = re.findall(r'<div class="status">(.*?)</div></div>', html, re.S)
    assert len(tiles) == 2 and all("<h3>" in t and 'class="big"' not in t for t in tiles)
    assert "Gmail isn&#39;t connected" in html and "Outlook isn&#39;t connected" in html
    assert not re.search("[\U0001F300-\U0001FAFF\u2600-\u27BF\uFE0F]", html)


def test_settings_page_has_no_email_filters(env):
    conn, client = env
    c = client()
    html = c.get("/settings").text
    for section in ("profiles", "accounts", "sync", "appearance"):
        assert f'id="{section}"' in html
    for gone in ("Email filters", "Ignore mail from", "Always treat as job mail", "<textarea", 'href="#filters"'):
        assert gone not in html
    assert c.post("/settings/filters", data={"block_senders": "x.com"}).status_code in (404, 405)
    assert "filters" not in settings.load(conn)                      # no longer a setting at all
    assert "Filter settings saved." not in c.get("/settings?saved=filters").text


def test_appearance_saved_and_applied_across_pages(env):
    conn, client = env
    c = client()
    r = c.post("/settings/appearance", data={"theme": "dark", "accent": "clay", "density": "compact",
                                             "corners": "sharp", "columns": ["company", "stage", "emails"], "flow_days": "90"})
    assert r.status_code == 303
    for page in ("/", "/flow", "/review", "/settings"):
        html = c.get(page).text
        assert 'data-theme="dark"' in html and 'data-density="compact"' in html and 'data-corners="sharp"' in html
        assert "--accent-l: #8f4a32" in html
    assert settings.load(conn)["appearance"]["flow_days"] == 90


def test_columns_setting_changes_list(env):
    conn, client = env
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    process_message(conn, acct, mk("1", "Thank you for applying to Acme"))
    c = client()
    header = lambda html, name: 'class="sort" href="' in html and f">{name}<span class=\"sort-ind\"" in html  # noqa: E731
    assert header(c.get("/").text, "Role")
    c.post("/settings/appearance", data={"columns": ["company", "stage"]})
    html = c.get("/").text
    assert not header(html, "Role") and header(html, "Company") and header(html, "Stage")


def test_invalid_appearance_post_does_not_break_pages(env):
    _, client = env
    c = client()
    c.post("/settings/appearance", data={"theme": "x", "accent": '"><script>', "density": "y", "flow_days": "zz"})
    html = c.get("/").text
    html_tag = html[html.index("<html"):html.index(">", html.index("<html"))]
    assert '"><script>' not in html
    assert "data-theme" not in html_tag and 'data-accent="graphite"' in html_tag


def test_connect_account_from_settings(env):
    conn, client = env
    c = client(FakeProvider(address="new@outlook.com"))
    r = c.post("/settings/connect/outlook")
    assert r.status_code == 303                                  # sign-in runs in the background; the page doesn't hang
    c.app.state.connect_thread.join(5)
    page = c.get("/settings").text
    assert "Connected Outlook: new@outlook.com." in page
    assert conn.execute("SELECT address FROM accounts").fetchone()[0] == "new@outlook.com"
    assert "Connected Outlook" not in c.get("/settings").text   # reported once
    assert client().post("/settings/connect/yahoo").status_code == 404


def test_connect_failure_is_shown_not_a_500(env):
    conn, client = env
    c = client(FakeProvider(fail="Missing client file"))
    r = c.post("/settings/connect/gmail")
    assert r.status_code == 303
    c.app.state.connect_thread.join(5)
    page = c.get("/settings").text
    assert "Couldn&#39;t connect Gmail." in page and "Missing client file" in page
    assert conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 0


def test_sync_now_from_settings(env):
    conn, client = env
    db.upsert_account(conn, "gmail", "me@gmail.com")
    conn.commit()
    c = client(FakeProvider([mk("1", "Thank you for applying to Acme")]))
    r = c.post("/sync", data={"scan": "30"})
    assert r.status_code == 303 and r.headers["location"] == "/settings#sync"      # the sync runs in the background
    c.app.state.sync_thread.join(10)
    assert conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0] == 1
    page = c.get("/settings").text
    assert "Synced" in page and "Checked 1 new email for me@gmail.com." in page
    assert "Checked 1 new email" not in c.get("/settings").text                    # reported once
    assert c.post("/sync", data={"scan": "7"}).status_code == 400


def test_sync_without_accounts_explains(env):
    _, client = env
    c = client()
    c.post("/sync")
    c.app.state.sync_thread.join(10)
    assert "No accounts are connected yet" in c.get("/settings").text


def test_sync_error_is_reported(env):
    conn, client = env
    db.upsert_account(conn, "gmail", "me@gmail.com")
    conn.commit()

    class Broken(FakeProvider):
        def fetch(self, since, skip):
            raise RuntimeError("token expired")
    c = client(Broken())
    c.post("/sync")
    c.app.state.sync_thread.join(10)
    page = c.get("/settings").text
    assert 'role="alert"' in page and "token expired" in page


def test_first_sync_uses_lookback_setting(env):
    conn, client = env
    settings.save(conn, "sync", {"lookback_days": 180})
    db.upsert_account(conn, "gmail", "me@gmail.com")
    conn.commit()
    seen = {}

    class Spy(FakeProvider):
        def fetch(self, since, skip):
            seen["since"] = since
            return iter(())
    c = client(Spy())
    c.post("/sync")
    c.app.state.sync_thread.join(10)
    from datetime import datetime, timedelta, timezone
    assert abs((datetime.now(timezone.utc) - seen["since"]) - timedelta(days=180)) < timedelta(minutes=5)


def test_one_unreadable_message_does_not_stop_the_batch(env):
    conn, _ = env
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    good = mk("good", "Thank you for applying to Acme")
    bad = mk("bad", "Thank you for applying to Initech", day=2)
    object.__setattr__(bad, "body", None)  # a None body makes classification raise
    counts = process_messages(conn, acct, [good, bad])
    assert counts == {"applied-to-application": 1, "error": 1}
    assert db.email_seen(conn, acct, "bad")


def test_deleting_an_application_can_send_its_emails_to_review_and_holds_them_there(env):
    conn, client = env
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    process_messages(conn, acct, [mk("1", "Thank you for applying to Acme", thread="A")])
    conn.commit()
    c = client()
    c.post("/app/1/delete", data={"emails": "review"})
    row = conn.execute("SELECT application_id, needs_review, hold FROM emails").fetchone()
    assert row["application_id"] is None and row["needs_review"] == 1 and row["hold"] == 1
    assert "Thank you for applying" in c.get("/review").text


def test_saved_notice_uses_plain_sentences_and_ignores_unknown_values(env):
    _, client = env
    c = client()
    assert "Sync settings saved." in c.get("/settings?saved=sync").text
    assert "Appearance settings saved." in c.get("/settings?saved=appearance").text
    page = c.get("/settings?saved=<script>alert(1)</script>").text
    assert "alert(1)</script>" not in page and "settings saved." not in page  # unknown values show nothing


def test_notice_text_from_the_url_is_escaped(env):
    _, client = env
    page = client().get("/settings?notice=<b>hi</b>").text
    assert "<b>hi</b>" not in page and "&lt;b&gt;hi&lt;/b&gt;" in page


def test_accessibility_basics_present(env):
    _, client = env
    c = client()
    for path in ("/", "/settings", "/flow", "/review"):
        html = c.get(path).text
        assert '<main id="main">' in html and 'href="#main"' in html and html.count("<h1") == 1, path
    flow = c.get("/flow").text
    assert "onchange" not in flow  # auto-submitting selects trap keyboard users
    assert "color-scheme: light" in c.get("/").text


def test_nav_marks_current_page(env):
    _, client = env
    html = client().get("/settings").text
    assert re.search(r'<a href="/settings"[^>]*aria-current="page"', html)


def test_defaults_and_round_trip():
    conn = db.connect(":memory:")
    s = settings.load(conn)
    assert s["appearance"]["theme"] == "system" and s["sync"]["lookback_days"] == 30
    settings.save(conn, "appearance", {"theme": "dark", "accent": "bronze", "density": "compact"})
    assert settings.load(conn)["appearance"]["theme"] == "dark"
    assert settings.load(conn)["appearance"]["accent"] == "bronze"


def test_invalid_values_fall_back_to_defaults():
    conn = db.connect(":memory:")
    out = settings.save(conn, "appearance", {"theme": "neon", "accent": "<script>", "density": 5, "flow_days": "abc"})
    assert out["theme"] == "system" and out["accent"] == "graphite" and out["flow_days"] == 0
    assert settings.save(conn, "sync", {"lookback_days": 7})["lookback_days"] == 30
    assert settings.save(conn, "sync", {"lookback_days": "90"})["lookback_days"] == 90


def test_company_and_stage_columns_cannot_be_hidden():
    out = settings.sanitize("appearance", {"columns": ["role"]})
    assert out["columns"] == ["company", "role", "stage"]


