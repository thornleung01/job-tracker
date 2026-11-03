"""Profiles (separate people / searches), connecting mail from Settings, and keeping each profile's data apart."""
import json
import re

import pytest
from fastapi.testclient import TestClient

from jobtracker import config, db
from jobtracker.jobs import adzuna, notify, store
from jobtracker.profiles import DEFAULT_ID, ProfileError, Profiles
from jobtracker.providers import base, clients
from jobtracker.sync import sync_all
from jobtracker.web import create_app
from tests.test_jobs_core import posting, set_profile
from tests.test_pipeline import mk


class FakeProvider:
    def __init__(self, address="me@gmail.com", messages=(), fail=None):
        self.address, self.messages, self.fail = address, list(messages), fail
        self.disconnected = False

    def connect(self):
        if self.fail:
            raise RuntimeError(self.fail)
        return self.address

    def disconnect(self):
        self.disconnected = True

    def fetch(self, since, skip):
        yield from (m for m in self.messages if not skip(m.id))


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SECRETS_DIR", tmp_path / "secrets")
    made = []

    def client(provider=None, toast=None):
        app = create_app(tmp_path / "tracker.db", get_provider=(lambda n, a: provider) if provider else None,
                         toast=toast, secrets_dir=tmp_path / "secrets")
        made.append(app)
        return TestClient(app, base_url="http://127.0.0.1:8765", follow_redirects=False)

    class Env:
        pass

    e = Env()
    e.tmp, e.client = tmp_path, client
    e.profiles = Profiles(tmp_path, tmp_path / "tracker.db", tmp_path / "secrets")
    yield e


def new_profile(c, name):
    r = c.post("/profiles", data={"name": name})
    assert r.status_code == 303, r.text
    return re.search(r"jt_profile=([^;]+)", r.headers["set-cookie"]).group(1)


# --- the registry ----------------------------------------------------------------------

def test_there_is_always_a_first_profile_that_keeps_the_original_files(env):
    p = env.profiles
    assert p.list() == [{"id": DEFAULT_ID, "name": "Me"}]
    assert p.db_path(DEFAULT_ID) == env.tmp / "tracker.db"
    assert p.token_dir(DEFAULT_ID) == env.tmp / "secrets"


def test_creating_profiles_gives_each_its_own_folders_and_unique_ids(env):
    p = env.profiles
    a, b, c = p.create("Sam"), p.create("Sam's search"), p.create("sam-s-search")
    assert len({a, b, c, DEFAULT_ID}) == 4
    assert p.db_path(a) != p.db_path(b) and p.token_dir(a) != p.token_dir(b)
    assert p.db_path(a).parent.parent == env.tmp / "profiles"
    assert p.create("default") != DEFAULT_ID                 # the reserved id can't be taken
    assert p.name(a) == "Sam"


@pytest.mark.parametrize("name,message", [("", "Give the profile a name"), ("   ", "Give the profile a name"), ("x" * 41, "40 characters")])
def test_bad_profile_names_are_explained(env, name, message):
    with pytest.raises(ProfileError, match=message):
        env.profiles.create(name)


def test_names_are_unique_ignoring_case_and_extra_spaces(env):
    env.profiles.create("Alex")
    with pytest.raises(ProfileError, match="already a profile"):
        env.profiles.create("  alex ")
    sam = env.profiles.create("Sam")
    with pytest.raises(ProfileError):
        env.profiles.rename(sam, "ALEX")
    env.profiles.rename(sam, "Sam")                          # keeping your own name is fine


def test_odd_names_cannot_escape_the_profiles_folder(env):
    for name in ("../../etc", "..\\..\\secrets", "a/b", "<script>"):
        pid = env.profiles.create(name)
        assert re.fullmatch(r"[a-z0-9-]+", pid)
        assert env.tmp in env.profiles.db_path(pid).parents


def test_a_damaged_registry_falls_back_to_the_first_profile(env):
    (env.tmp / "profiles.json").write_text("{not json", encoding="utf-8")
    assert env.profiles.ids() == [DEFAULT_ID]


def test_deleting_a_profile_removes_its_data_and_tokens_but_never_the_first(env):
    p = env.profiles
    pid = p.create("Sam")
    for folder in (p.db_path(pid).parent, p.token_dir(pid)):
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "x").write_text("data")
    p.delete(pid)
    assert not p.db_path(pid).parent.exists() and not p.token_dir(pid).exists() and pid not in p.ids()
    with pytest.raises(ProfileError, match="can't be deleted"):
        p.delete(DEFAULT_ID)
    with pytest.raises(ProfileError):
        p.delete("nobody")


def test_sign_in_tokens_are_stored_per_profile():
    assert base.token_dir("default") == config.SECRETS_DIR
    assert base.token_dir("sam") == config.SECRETS_DIR / "profiles" / "sam"


# --- using profiles in the app -----------------------------------------------------------

def test_each_profile_has_its_own_applications_and_settings(env):
    c = env.client()
    c.post("/app/add", data={"company": "Acme", "role": "Analyst", "stage": "Applied"})
    assert "Acme" in c.get("/").text
    cookie = new_profile(c, "Sam")
    assert "Acme" not in c.get("/").text                      # a fresh profile starts empty
    c.post("/app/add", data={"company": "Globex", "role": "Chef", "stage": "Applied"})
    c.post("/settings/appearance", data={"theme": "dark", "accent": "clay", "density": "compact", "corners": "sharp",
                                         "columns": ["company"], "flow_days": "30"})
    c.post("/profiles/switch", data={"profile": DEFAULT_ID, "next": "/"})
    page = c.get("/").text
    assert "Acme" in page and "Globex" not in page and 'data-accent="graphite"' in page    # Sam's look didn't leak
    c.post("/profiles/switch", data={"profile": cookie, "next": "/"})
    page = c.get("/").text
    assert "Globex" in page and "Acme" not in page and 'data-accent="clay"' in page


def test_the_profile_menu_only_appears_with_more_than_one_profile(env):
    c = env.client()
    assert 'name="profile"' not in c.get("/").text
    new_profile(c, "Sam")
    html = c.get("/").text
    assert 'action="/profiles/switch"' in html and "Sam" in html and "Me" in html


def test_switching_stays_on_this_site_and_rejects_unknown_profiles(env):
    c = env.client()
    pid = new_profile(c, "Sam")
    for bad in ("https://evil.example.com", "//evil.example.com", "/\\evil.example.com", "javascript:alert(1)"):
        r = c.post("/profiles/switch", data={"profile": pid, "next": bad})
        assert r.headers["location"] == "/", bad
    assert c.post("/profiles/switch", data={"profile": pid, "next": "/jobs"}).headers["location"] == "/jobs"
    assert c.post("/profiles/switch", data={"profile": "nobody", "next": "/"}).status_code == 404
    c.cookies.set("jt_profile", "nobody")                      # a stale or forged cookie falls back safely
    assert c.get("/").status_code == 200


def test_a_link_with_profile_opens_that_profile_and_remembers_it(env):
    c = env.client()
    pid = new_profile(c, "Sam")
    c.post("/profiles/switch", data={"profile": DEFAULT_ID, "next": "/"})
    r = c.get(f"/jobs?profile={pid}")
    assert r.status_code == 200 and f"jt_profile={pid}" in r.headers["set-cookie"] and "HttpOnly" in r.headers["set-cookie"]
    assert c.get("/jobs?profile=nobody").status_code == 200


def test_the_profile_switch_and_create_routes_are_protected_like_the_rest(env):
    c = env.client()
    for path, data in (("/profiles", {"name": "x"}), ("/profiles/switch", {"profile": DEFAULT_ID}), ("/settings/connect/gmail", {}),
                       (f"/profiles/{DEFAULT_ID}/rename", {"name": "x"})):
        assert c.post(path, data=data, headers={"origin": "https://evil.example.com"}).status_code == 403, path
        assert c.post(path, data=data, headers={"sec-fetch-site": "cross-site"}).status_code == 403, path


def test_profile_management_from_settings(env):
    c = env.client()
    r = c.post("/profiles", data={"name": "Sam"})
    assert "created" in r.headers["location"] and "#accounts" in r.headers["location"]
    page = c.get("/settings").text
    assert "Email accounts: Sam" in page and "Open now" in page
    assert "already a profile" in c.get(c.post("/profiles", data={"name": "sam"}).headers["location"]).text
    assert c.post(f"/profiles/{DEFAULT_ID}/rename", data={"name": "Jordan"}).status_code == 303
    assert env.profiles.name(DEFAULT_ID) == "Jordan"
    assert "Give the profile a name" in c.get(c.post("/profiles", data={"name": " "}).headers["location"]).text


def test_deleting_a_profile_needs_the_tick_box_and_returns_you_to_the_first(env):
    c = env.client()
    pid = new_profile(c, "Sam")
    r = c.post(f"/profiles/{pid}/delete", data={})
    assert "Tick the box" in c.get(r.headers["location"]).text and env.profiles.exists(pid)
    r = c.post(f"/profiles/{pid}/delete", data={"confirm": "yes"})
    assert r.status_code == 303 and not env.profiles.exists(pid) and f"jt_profile={DEFAULT_ID}" in r.headers["set-cookie"]
    page = c.get(c.post(f"/profiles/{DEFAULT_ID}/delete", data={"confirm": "yes"}).headers["location"]).text
    assert "can&#39;t be deleted" in page


# --- connecting mail, per profile ---------------------------------------------------------

def test_a_connected_account_belongs_to_the_open_profile_only(env):
    c = env.client(FakeProvider("sam@outlook.com"))
    pid = new_profile(c, "Sam")
    c.post("/settings/connect/outlook")
    c.app.state.connect_thread.join(5)
    page = c.get("/settings").text
    assert "Connected Outlook: sam@outlook.com" in page and "sam@outlook.com" in page
    mine = [tuple(r) for r in db.connect(env.profiles.db_path(pid)).execute("SELECT address FROM accounts")]
    first = db.connect(env.profiles.db_path(DEFAULT_ID)).execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
    assert mine == [("sam@outlook.com",)] and first == 0


def test_sync_reads_only_the_open_profiles_accounts(env):
    c = env.client(FakeProvider(messages=[mk("1", "Thank you for applying to Acme")]))
    conn = db.connect(env.profiles.db_path(DEFAULT_ID))
    db.upsert_account(conn, "gmail", "me@gmail.com")
    conn.commit()
    pid = new_profile(c, "Sam")
    c.post("/sync", data={"scan": "0"})                       # Sam has no accounts: nothing to read
    c.app.state.sync_thread.join(10)
    assert db.connect(env.profiles.db_path(pid)).execute("SELECT COUNT(*) FROM applications").fetchone()[0] == 0
    c.post("/profiles/switch", data={"profile": DEFAULT_ID, "next": "/"})
    c.post("/sync", data={"scan": "0"})
    c.app.state.sync_thread.join(10)
    assert conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0] == 1


def test_connect_waits_for_setup_when_google_or_microsoft_isnt_configured(env):
    c = env.client()                                          # the real providers: no credentials saved yet
    for provider, text in (("gmail", "Google credentials file"), ("outlook", "Microsoft application ID")):
        r = c.post(f"/settings/connect/{provider}")
        assert text in c.get(r.headers["location"]).text
    assert c.app.state.connect_thread is None                 # no sign-in window was attempted


def test_a_failed_sign_in_can_be_tried_again(env):
    c = env.client(FakeProvider(fail="closed the window"))
    c.post("/settings/connect/gmail")
    c.app.state.connect_thread.join(5)
    assert "closed the window" in c.get("/settings").text
    c.post("/settings/connect/gmail")
    c.app.state.connect_thread.join(5)
    assert "closed the window" in c.get("/settings").text


def test_a_second_click_while_signing_in_does_not_open_a_second_window(env):
    import threading

    release = threading.Event()

    class Slow(FakeProvider):
        def connect(self):
            release.wait(5)
            return "me@gmail.com"

    c = env.client(Slow())
    c.post("/settings/connect/gmail")
    first = c.app.state.connect_thread
    page = c.get("/settings").text
    assert "A sign-in window opened" in page and "location.reload" in page
    c.post("/settings/connect/gmail")
    assert c.app.state.connect_thread is first
    release.set()
    first.join(5)
    assert "A sign-in window opened" not in c.get("/settings").text


def test_disconnect_stops_syncing_but_keeps_the_emails_and_reconnect_resumes(env):
    provider = FakeProvider(messages=[mk("1", "Thank you for applying to Acme")])
    c = env.client(provider)
    conn = db.connect(env.profiles.db_path(DEFAULT_ID))
    db.upsert_account(conn, "gmail", "me@gmail.com")
    conn.commit()
    c.post("/sync", data={"scan": "0"})
    c.app.state.sync_thread.join(10)
    assert conn.execute("SELECT COUNT(*) FROM emails").fetchone()[0] == 1
    acct = conn.execute("SELECT id FROM accounts").fetchone()[0]
    r = c.post(f"/settings/disconnect/{acct}")
    assert provider.disconnected and "Disconnected me@gmail.com" in c.get(r.headers["location"]).text.replace("&#39;", "'")
    assert conn.execute("SELECT active FROM accounts").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM emails").fetchone()[0] == 1 and conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0] == 1
    assert sync_all(conn, get_provider=lambda n, a: provider) == {}
    assert "Reconnect" in c.get("/settings").text
    c.post("/settings/connect/gmail")
    c.app.state.connect_thread.join(5)
    assert conn.execute("SELECT active, COUNT(*) FROM accounts").fetchone()[:] == (1, 1)
    assert c.post("/settings/disconnect/999").status_code == 404


def test_a_failing_disconnect_leaves_the_account_connected(env):
    class Stuck(FakeProvider):
        def disconnect(self):
            raise PermissionError("file in use")

    c = env.client(Stuck())
    conn = db.connect(env.profiles.db_path(DEFAULT_ID))
    db.upsert_account(conn, "gmail", "me@gmail.com")
    conn.commit()
    page = c.get(c.post("/settings/disconnect/1").headers["location"]).text
    assert "file in use" in page and conn.execute("SELECT active FROM accounts").fetchone()[0] == 1


# --- the one-time Google and Microsoft setup, done in Settings ------------------------------

GOOD_GOOGLE = {"installed": {"client_id": "abc.apps.googleusercontent.com", "client_secret": "s3cret", "auth_uri": "https://accounts.google.com/o/oauth2/auth"}}


def upload(c, data, name="client.json"):
    return c.post("/settings/credentials/gmail", files={"file": (name, data, "application/json")})


def test_google_credentials_are_validated_and_saved_once_for_everyone(env):
    c = env.client()
    assert not clients.gmail_ready() and "Set up Gmail" in c.get("/settings").text
    r = upload(c, json.dumps(GOOD_GOOGLE).encode())
    assert "Google credentials saved" in c.get(r.headers["location"]).text and clients.gmail_ready()
    page = c.get("/settings").text
    assert "Connect Gmail" in page and "Replace Google credentials" in page
    assert "s3cret" not in page and "abc.apps" not in page          # the secret is never shown again
    new_profile(c, "Sam")
    assert clients.gmail_ready() and "Connect Gmail" in c.get("/settings").text     # shared: no second setup


@pytest.mark.parametrize("data,message", [
    (b"not json", "isn't a JSON file"), (b"[]", "doesn't look like a Google"),
    (json.dumps({"web": {"client_id": "x"}}).encode(), "Desktop app"),
    (json.dumps({"installed": {"client_id": "x"}}).encode(), "missing its client ID or secret"),
    (b"x" * 70000, "too big"),
])
def test_bad_google_files_are_explained_and_not_saved(env, data, message):
    c = env.client()
    page = c.get(upload(c, data).headers["location"]).text.replace("&#39;", "'")
    assert message in page and not clients.gmail_ready()


def test_choosing_no_google_file_is_a_message_not_an_error_page(env):
    c = env.client()
    r = c.post("/settings/credentials/gmail", data={})
    assert r.status_code == 303 and "Choose the Google credentials file" in c.get(r.headers["location"]).text


def test_microsoft_application_id_is_checked_and_saved(env):
    c = env.client()
    guid = "1a2b3c4d-1234-5678-9abc-0123456789ab"
    for bad in ("", "hello", guid + "0", "<script>"):
        page = c.get(c.post("/settings/credentials/outlook", data={"client_id": bad}).headers["location"]).text
        assert "36 characters" in page and clients.outlook_client_id() is None
    r = c.post("/settings/credentials/outlook", data={"client_id": f"  {guid} "})
    assert "Microsoft application ID saved" in c.get(r.headers["location"]).text
    assert clients.outlook_client_id() == guid and "Connect Outlook" in c.get("/settings").text


# --- job discovery and pop-ups know which profile they are for ---------------------------------

def test_adzuna_keys_are_kept_per_profile(env, monkeypatch):
    seen = []
    monkeypatch.setattr(adzuna, "save_credentials", lambda i, k, profile="default": seen.append(("save", profile)))
    monkeypatch.setattr(adzuna, "load_credentials", lambda profile="default": seen.append(("load", profile)))
    c = env.client()
    pid = new_profile(c, "Sam")
    c.get("/jobs?tab=sources")
    assert ("load", pid) in seen and ("load", DEFAULT_ID) not in seen


def test_pop_up_names_the_profile_and_opens_it_when_there_are_several(env):
    toasts = []
    c = env.client(toast=lambda *a: toasts.append(a))
    pid = new_profile(c, "Sam")
    conn = db.connect(env.profiles.db_path(pid))
    profile = set_profile(conn, titles=["Data Analyst"], skills_must=["SQL"], skills_nice=[])
    store.add_postings(conn, [posting(description="SQL")], profile)
    conn.commit()
    assert c.post("/jobs/refresh").status_code == 303
    title, body, url = toasts[0]
    assert title.startswith("Sam: ") and url.endswith(f"/jobs?profile={pid}")


def test_pop_up_has_no_prefix_with_a_single_profile(env):
    toasts = []
    conn = db.connect(":memory:")
    store.add_postings(conn, [posting(description="SQL")], set_profile(conn, skills_must=["SQL"]))
    assert notify.notify_new(conn, lambda *a: toasts.append(a)) == 1
    assert not toasts[0][0].startswith(": ") and toasts[0][2].endswith("/jobs")
