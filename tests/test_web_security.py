"""What the guard in web.py does to every request and response: security headers, the host, origin and size checks,
which profile a link may switch to, and that slow work never holds up the page."""
import re
import threading
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from jobtracker import activity, config, db, settings, web
from jobtracker.jobs import resume
from jobtracker.routes.common import PROFILE_COOKIE_MAX_AGE
from jobtracker.web import create_app
from tests.test_web_routes import LOCAL, Provider, offline, seed

PAGES = ["/", "/?open=1,2", "/app/1", "/app/1/panel", "/flow", "/contacts", "/review", "/settings",
         "/jobs", "/jobs?tab=profile", "/jobs?tab=notifications", "/jobs?tab=sources"]


@pytest.fixture
def env(tmp_path):
    path = tmp_path / "t.db"
    seed(path)

    def client(**kw):
        app = create_app(path, get_provider=lambda name, address: Provider(), http_get=offline, toast=lambda *a, **k: None,
                         secrets_dir=tmp_path / "secrets", **kw)
        return TestClient(app, base_url=LOCAL, follow_redirects=False)
    client.path = path
    return client


def csp_directives(response) -> dict[str, str]:
    policy = response.headers["content-security-policy"]
    return {part.split()[0]: " ".join(part.split()[1:]) for part in policy.split(";") if part.strip()}


def assert_hardened(response):
    directives = csp_directives(response)
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert directives["frame-ancestors"] == "'none'"
    assert directives["base-uri"] == "'self'" and directives["form-action"] == "'self'"
    assert directives["object-src"] == "'none'" and directives["default-src"] == "'self'" and directives["connect-src"] == "'self'"


def test_headers_are_on_html_json_redirect_error_and_static_responses(env):
    client = env()
    for response in (
        client.get("/"),                                             # HTML
        client.get("/sync/status"),                                  # JSON
        client.post("/app/1/unlock"),                                # redirect
        client.get("/app/999"),                                      # an error from a route
        client.get("/nope"),                                         # no such route
        client.get("/static/fonts/Figtree-latin-wght.woff2"),        # a static file
        client.get("/", headers={"host": "evil.example.com"}),       # refused by the guard
        client.post("/sync", headers={"origin": "https://evil.example.com"}),
    ):
        assert_hardened(response)


def test_every_page_renders_with_the_policy(env):
    client = env()
    for path in PAGES:
        response = client.get(path)
        assert response.status_code == 200, path
        assert_hardened(response)


def test_scripts_only_run_with_this_responses_nonce_and_never_from_attributes(env):
    client = env()
    first, second = client.get("/"), client.get("/")
    script_src = csp_directives(first)["script-src"]
    nonce = re.fullmatch(r"'self' 'nonce-([\w-]{16,})'", script_src).group(1)     # no 'unsafe-inline', no 'unsafe-eval'
    assert script_src != csp_directives(second)["script-src"], "the nonce must change with every response"
    assert "'unsafe-inline'" not in script_src and "unsafe-eval" not in script_src

    for path in PAGES:
        response = client.get(path)
        page_nonce = re.search(r"'nonce-([\w-]+)'", response.headers["content-security-policy"]).group(1)
        html = response.text
        for attrs in re.findall(r"<script\b([^>]*)>", html, re.I):
            if re.search(r"\bsrc=|type=[\"']application/json", attrs):
                continue            # a file from this app, or data the browser never runs
            assert f'nonce="{page_nonce}"' in attrs, f"{path}: inline script without the nonce: <script{attrs}>"
        markup = re.sub(r"<script\b.*?</script>", "<script></script>", html, flags=re.S | re.I)
        assert not re.search(r"<[a-z][^>]*\son[a-z]+\s*=", markup, re.I), f"{path}: an inline event handler is blocked by the policy"
    assert nonce


def test_the_policy_only_allows_this_app_and_data_images(env):
    directives = csp_directives(env().get("/"))
    for name in ("script-src", "img-src", "font-src", "connect-src", "default-src"):
        assert "http" not in directives[name] and "*" not in directives[name], name
    assert directives["img-src"] == "'self' data:"


def test_a_cross_site_link_cannot_switch_the_profile(env):
    client = env()
    client.post("/profiles", data={"name": "Work"})
    client.cookies.clear()
    cross = client.get("/?profile=work", headers={"sec-fetch-site": "cross-site"})
    assert cross.status_code == 200 and "set-cookie" not in cross.headers
    for site in ("none", "same-origin"):        # a pop-up's link opened by you, or a link inside the app
        opened = client.get("/?profile=work", headers={"sec-fetch-site": site})
        assert "jt_profile=work" in opened.headers["set-cookie"]
        client.cookies.clear()
    assert "jt_profile=work" in client.get("/?profile=work").headers["set-cookie"]     # a browser that sends no header


def test_the_profile_cookie_is_http_only_and_lax(env):
    cookie = env().post("/profiles/switch", data={"profile": "default"}).headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie and f"Max-Age={PROFILE_COOKIE_MAX_AGE}" in cookie


def test_an_oversized_upload_is_refused_before_it_is_read(env):
    client = env()
    big = b"x" * (resume.MAX_UPLOAD + 300_000)
    for path in ("/settings/credentials/gmail", "/jobs/profile/resume"):
        response = client.post(path, files={"file": ("big.json", big, "application/json")})
        assert response.status_code == 413 and "location" not in response.headers, path
        assert_hardened(response)
    small = client.post("/settings/credentials/gmail", files={"file": ("c.json", b"{}", "application/json")})
    assert small.status_code == 303          # an ordinary upload still goes through to its own checks


def test_a_redirect_target_with_control_characters_falls_back_to_home(env):
    client = env()
    for target in ("/flow\r\nSet-Cookie: x=1", "/flow\x00", "/ok "):
        response = client.post("/profiles/switch", data={"profile": "default", "next": target})
        assert response.headers["location"] == "/", repr(target)


def test_the_guard_is_browser_protection_only(env):
    """A caller that sends no Origin and no Sec-Fetch-Site (curl, a script) passes, as the module docstring says."""
    client = env()
    assert client.get("/app/1").status_code == 200
    assert client.post("/app/1/unlock").status_code == 303
    assert "browser protection only" in web.__doc__.lower()


def test_a_slow_database_write_does_not_hold_up_other_requests(env, monkeypatch):
    """`save_appearance` has to be `async` to read the form; its write must go to the thread pool, not run on the event loop."""
    started, release = threading.Event(), threading.Event()
    real = settings.save

    def slow(conn, section, values):
        started.set()
        release.wait(15)
        return real(conn, section, values)

    monkeypatch.setattr(settings, "save", slow)
    with env() as client:                           # one event loop shared by every request below
        saving = threading.Thread(target=lambda: client.post("/settings/appearance", data={"theme": "dark"}))
        saving.start()
        try:
            assert started.wait(5)
            began = time.monotonic()
            response = client.get("/sync/status")
            assert response.status_code == 200 and time.monotonic() - began < 3, "the event loop was blocked"
        finally:
            release.set()
            saving.join(15)


def test_a_slow_recheck_does_not_hold_up_other_requests(env, monkeypatch):
    started, release = threading.Event(), threading.Event()

    def slow(conn):
        started.set()
        release.wait(15)
        return {"checked": 0, "cleared": 0, "removed": 0, "settled": 0, "roles": 0}

    monkeypatch.setattr("jobtracker.routes.accounts.recheck", slow)
    with env() as client:
        working = threading.Thread(target=lambda: client.post("/settings/recheck"))
        working.start()
        try:
            assert started.wait(5)
            began = time.monotonic()
            assert client.get("/sync/status").status_code == 200 and time.monotonic() - began < 3
        finally:
            release.set()
            working.join(15)


def test_adding_an_application_for_your_own_today_is_accepted_even_when_utc_is_a_day_behind(env, monkeypatch):
    """At 8 am in UTC+8 it is still yesterday in UTC: your today must not be refused as 'in the future'."""
    ahead = datetime.now(timezone.utc).date() + timedelta(days=1)
    monkeypatch.setattr(activity, "today", lambda: ahead)
    client = env()
    assert client.post("/app/add", data={"company": "Globex", "applied_on": ahead.isoformat()}).status_code == 303
    assert client.post("/app/add", data={"company": "Globex", "applied_on": (ahead + timedelta(days=1)).isoformat()}).status_code == 400


def test_restoring_an_ignored_email_that_cannot_be_read_keeps_it_in_the_list(env, monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr("jobtracker.sync.process_message", broken)
    client = env()
    response = client.post("/ignored/1/real")
    assert response.status_code == 303 and response.headers["location"].startswith("/review?error=")
    conn = db.connect(env.path)
    row = conn.execute("SELECT subject, bulk FROM ignored_mail WHERE id = 1").fetchone()
    conn.close()
    assert row["subject"] == "Weekly digest"
    assert "Weekly digest" in client.get("/review").text


def test_a_login_window_that_never_reports_back_stops_showing_as_waiting(env, monkeypatch):
    release = threading.Event()

    class Stuck(Provider):
        def connect(self, send=False):
            release.wait(15)
            return self.address

    client = env()
    client.app.state.ctx.get_provider = lambda name, address: Stuck()
    try:
        client.post("/settings/connect/gmail")
        assert "A login window opened" in client.get("/settings").text
        monkeypatch.setattr(config, "SIGN_IN_WAIT", 0)          # the time it is allowed has passed
        html = client.get("/settings").text
        assert "A login window opened" not in html and "timed out" in html
        assert "timed out" not in client.get("/settings").text      # reported once
    finally:
        release.set()
        client.app.state.connect_thread.join(5)
