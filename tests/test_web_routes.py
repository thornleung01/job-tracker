"""The web app's route table and how every route answers a plain request, pinned in tests/web_routes_snapshot.json.

The route layout in jobtracker/routes/ is allowed to change; the URLs, methods, status codes, redirects and cookies
that a browser sees are not. Each smoke request runs against its own copy of one seeded database, so the order of
the cases does not matter. After a deliberate change to a route, rerun with UPDATE_ROUTE_SNAPSHOT=1 and review the diff.
"""
import json
import os
import shutil
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit

import pytest
import requests
from fastapi.testclient import TestClient

from jobtracker import activity, db
from jobtracker.sync import process_message, process_messages
from jobtracker.web import create_app
from tests.test_pipeline import mk

SNAPSHOT = Path(__file__).with_name("web_routes_snapshot.json")
LOCAL = "http://127.0.0.1:8765"
# Messages that come from other modules (credential checks, profile rules, reply and resume errors) are free to be
# reworded, so a case marked MASK pins that a message is shown but not its wording.
MASK = "mask"


class Provider:
    """Stands in for Gmail: signs in, sends and disconnects without any network."""
    address = "me@gmail.com"

    def connect(self, send=False):
        return self.address

    def disconnect(self):
        pass

    def send_reply(self, **kw):
        return "sent-id"

    def fetch(self, since, skip):
        return iter(())


def offline(*args, **kwargs):
    raise requests.ConnectionError("offline")


def seed(path: Path) -> None:
    conn = db.connect(path)
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    conn.execute("UPDATE accounts SET can_reply = 1")
    process_messages(conn, acct, [
        mk("1", "Thank you for applying to Acme", thread="A", day=1),
        mk("2", "Interview invitation", "We'd like to schedule an interview.", thread="A", day=5),
        mk("3", "Thank you for applying to Initech", sender="Initech <no-reply@lever.co>", thread="B", day=2),
        mk("4", "Update", "Unfortunately we will not be moving forward with your application.",
           sender="Initech <no-reply@lever.co>", thread="B", day=6),
    ])
    process_message(conn, acct, mk("r1", "Re: your application", "Quick question about your CV.", sender="Sam <sam@zzz.com>", day=3))
    conn.execute("INSERT INTO ignored_mail (account_id, provider_msg_id, thread_id, received_at, sender, subject, body, reason, created_at) "
                 "VALUES (?, 'ig1', 't', '2026-10-04T09:00:00Z', 'News <news@x.com>', 'Weekly digest', 'Some jobs', 'newsletter', '2026-10-04T09:00:00Z')", (acct,))
    conn.execute("INSERT INTO job_postings (source, source_key, dedupe_key, title, company, url, found_at, score) "
                 "VALUES ('feed:x', 'k1', 'd1', 'Analyst', 'Acme', 'https://example.com/j', '2026-10-04T09:00:00Z', 70)")
    conn.execute("INSERT INTO notifications (created_at, text) VALUES ('2026-10-04T09:00:00Z', 'One new match')")
    conn.execute("INSERT INTO learned_rules (kind, value, evidence, created_at) VALUES ('block_sender', 'news@x.com', 3, '2026-10-04T09:00:00Z')")
    activity.add_step(conn, 1, "Recruiter call", "2026-10-02", "Went well")
    conn.commit()
    conn.close()


def email_id(path: Path, provider_msg_id: str) -> int:
    conn = db.connect(path)
    try:
        return conn.execute("SELECT id FROM emails WHERE provider_msg_id = ?", (provider_msg_id,)).fetchone()[0]
    finally:
        conn.close()


def upload(name, content, mime="application/json"):
    return {"files": {"file": (name, content, mime)}}


# (id, method, path, extra request arguments, options)
CASES = [
    # pages
    ("home", "GET", "/", {}, ()),
    ("home filtered", "GET", "/?stage=Rejected&q=init&sort=company&dir=asc&open=1,2", {}, ()),
    ("home bad sort", "GET", "/?sort=zzz&dir=up&open=x", {}, ()),
    ("detail", "GET", "/app/1", {}, ()),
    ("detail missing", "GET", "/app/999", {}, ()),
    ("detail bad id", "GET", "/app/abc", {}, ()),
    ("panel", "GET", "/app/1/panel", {}, ()),
    ("panel missing", "GET", "/app/999/panel", {}, ()),
    ("statistics", "GET", "/statistics", {}, ()),
    ("statistics days", "GET", "/statistics?days=30&account=1", {}, ()),
    ("flow moved", "GET", "/flow", {}, ()),
    ("flow moved with filters", "GET", "/flow?days=30&account=1", {}, ()),
    ("contacts", "GET", "/contacts", {}, ()),
    ("contacts search", "GET", "/contacts?q=sam", {}, ()),
    ("review", "GET", "/review", {}, ()),
    ("settings", "GET", "/settings", {}, ()),
    ("settings notice", "GET", "/settings?notice=Hello&saved=sync", {}, ()),
    ("sync status", "GET", "/sync/status", {}, ()),
    ("jobs", "GET", "/jobs", {}, ()),
    ("jobs profile", "GET", "/jobs?tab=profile", {}, ()),
    ("jobs notifications", "GET", "/jobs?tab=notifications", {}, ()),
    ("jobs sources", "GET", "/jobs?tab=sources&view=all&min=50", {}, ()),
    ("static font", "GET", "/static/fonts/Figtree-latin-wght.woff2", {}, ()),
    ("static traversal", "GET", "/static/../web.py", {}, ()),
    ("unknown", "GET", "/nope", {}, ()),
    ("docs off", "GET", "/docs", {}, ()),
    ("openapi off", "GET", "/openapi.json", {}, ()),
    ("get on post route", "GET", "/sync", {}, ()),
    # the guard
    ("foreign host", "GET", "/", {"headers": {"host": "evil.example.com"}}, ()),
    ("foreign origin", "POST", "/sync", {"headers": {"origin": "https://evil.example.com"}}, ()),
    ("other port origin", "POST", "/sync", {"headers": {"origin": "http://127.0.0.1:9999"}}, ()),
    ("cross-site fetch", "POST", "/sync", {"headers": {"sec-fetch-site": "cross-site"}}, ()),
    ("same origin post", "POST", "/sync", {"headers": {"origin": LOCAL, "sec-fetch-site": "same-origin"}}, ()),
    # profile cookie
    ("profile link", "GET", "/?profile=default", {}, ()),
    ("profile link unknown", "GET", "/?profile=nobody", {}, ()),
    ("profile cookie stale", "GET", "/", {"cookies": {"jt_profile": "nobody"}}, ()),
    # applications
    ("edit", "POST", "/app/1/edit", {"data": {"company": " Acme  Inc ", "role": "Analyst", "url": "https://acme.test/j"}}, ()),
    ("edit empty company", "POST", "/app/1/edit", {"data": {"company": " ", "role": "x"}}, ()),
    ("edit missing", "POST", "/app/999/edit", {"data": {"company": "x"}}, ()),
    ("edit no form", "POST", "/app/1/edit", {}, ()),
    ("not application", "POST", "/app/1/not-application", {}, (MASK,)),
    ("not application missing", "POST", "/app/999/not-application", {}, ()),
    ("stage", "POST", "/app/1/stage", {"data": {"stage": "Offer"}}, ()),
    ("stage bad", "POST", "/app/1/stage", {"data": {"stage": "Bogus"}}, ()),
    ("unlock", "POST", "/app/1/unlock", {}, ()),
    ("delete", "POST", "/app/1/delete", {}, ()),
    ("delete to review", "POST", "/app/1/delete", {"data": {"emails": "review"}}, ()),
    ("delete bad mode", "POST", "/app/1/delete", {"data": {"emails": "x"}}, ()),
    ("merge", "POST", "/app/1/merge", {"data": {"into": 2}}, ()),
    ("merge itself", "POST", "/app/1/merge", {"data": {"into": 1}}, ()),
    ("merge missing", "POST", "/app/1/merge", {"data": {"into": 999}}, ()),
    ("add", "POST", "/app/add", {"data": {"company": "Globex", "role": "Dev", "stage": "Interview", "applied_on": "2026-10-01", "url": "https://g.test/j"}}, ()),
    ("add no role", "POST", "/app/add", {"data": {"company": "Globex"}}, ()),
    ("add bad stage", "POST", "/app/add", {"data": {"company": "X", "stage": "Bogus"}}, ()),
    ("add empty company", "POST", "/app/add", {"data": {"company": "  "}}, ()),
    ("add bad date", "POST", "/app/add", {"data": {"company": "X", "applied_on": "yesterday"}}, ()),
    ("add future date", "POST", "/app/add", {"data": {"company": "X", "applied_on": "2999-01-01"}}, ()),
    ("derive empty", "POST", "/app/derive", {"data": {"url": ""}}, ()),
    ("derive bad", "POST", "/app/derive", {"data": {"url": "ftp://x"}}, ()),
    ("step", "POST", "/app/1/step", {"data": {"label": "Phone screen", "day": "2026-10-03", "body": "ok"}}, ()),
    ("step bad", "POST", "/app/1/step", {"data": {"label": "Nonsense"}}, ()),
    ("step in page", "POST", "/app/1/step", {"data": {"label": "Phone screen"}, "headers": {"x-panel": "1"}}, ()),
    ("step bad in page", "POST", "/app/1/step", {"data": {"label": "Nonsense"}, "headers": {"x-panel": "1"}}, ()),
    ("step missing app", "POST", "/app/999/step", {"data": {"label": "Phone screen"}}, ()),
    ("activity delete", "POST", "/app/1/activity/1/delete", {}, ()),
    ("activity delete gone", "POST", "/app/1/activity/99/delete", {}, ()),
    # review and learning
    ("review assign", "POST", "/review/{r1}", {"data": {"action": "assign", "app_id": 1, "stage": "Heard back"}}, (MASK,)),
    ("review new", "POST", "/review/{r1}", {"data": {"action": "new", "company": "Qqq", "role": "Dev", "stage": "Interview"}}, (MASK,)),
    ("review new no company", "POST", "/review/{r1}", {"data": {"action": "new", "company": " "}}, ()),
    ("review dismiss", "POST", "/review/{r1}", {"data": {"action": "dismiss"}}, (MASK,)),
    ("review bad action", "POST", "/review/{r1}", {"data": {"action": "x"}}, ()),
    ("review bad app", "POST", "/review/{r1}", {"data": {"action": "assign", "app_id": 999}}, ()),
    ("review bad stage", "POST", "/review/{r1}", {"data": {"action": "dismiss", "stage": "Bogus"}}, ()),
    ("review missing", "POST", "/review/999", {"data": {"action": "dismiss"}}, ()),
    ("ignored real", "POST", "/ignored/1/real", {}, ()),
    ("ignored real missing", "POST", "/ignored/99/real", {}, ()),
    ("undo rule", "POST", "/learned/1/undo", {}, ()),
    ("undo rule missing", "POST", "/learned/99/undo", {}, ()),
    # people
    ("contact edit", "POST", "/contacts/edit", {"data": {"key": "1|sam@zzz.com", "name": "Sam Lee", "title": "Recruiter", "next": "/app/1"}}, ()),
    ("contact edit open redirect", "POST", "/contacts/edit", {"data": {"key": "1|sam@zzz.com", "name": "S", "next": "//evil.example"}}, ()),
    ("contact edit bad key", "POST", "/contacts/edit", {"data": {"key": "nope"}}, ()),
    ("contact hide", "POST", "/contacts/hide", {"data": {"key": "1|name:sam", "next": "/contacts"}}, ()),
    ("contact hide bad key", "POST", "/contacts/hide", {"data": {"key": "x|y"}}, ()),
    # settings and accounts
    ("appearance", "POST", "/settings/appearance", {"data": {"theme": "dark", "accent": "green", "density": "compact", "corners": "sharp",
                                                           "columns": ["company", "stage"], "flow_days": "30"}}, ()),
    ("appearance empty", "POST", "/settings/appearance", {}, ()),
    ("recheck", "POST", "/settings/recheck", {}, ()),
    ("sync settings", "POST", "/settings/sync", {"data": {"lookback_days": 90}}, ()),
    ("sync settings bad", "POST", "/settings/sync", {"data": {"lookback_days": "x"}}, ()),
    ("gmail credentials none", "POST", "/settings/credentials/gmail", {}, ()),
    ("gmail credentials bad", "POST", "/settings/credentials/gmail", upload("c.json", b"{}"), (MASK,)),
    ("outlook credentials bad", "POST", "/settings/credentials/outlook", {"data": {"client_id": "nope"}}, (MASK,)),
    ("connect gmail", "POST", "/settings/connect/gmail", {}, ()),
    ("connect outlook", "POST", "/settings/connect/outlook", {}, ()),
    ("connect unknown", "POST", "/settings/connect/yahoo", {}, ()),
    ("reply access on", "POST", "/settings/reply-access/1", {"data": {"mode": "on"}}, ()),
    ("reply access off", "POST", "/settings/reply-access/1", {"data": {"mode": "off"}}, ()),
    ("reply access bad", "POST", "/settings/reply-access/1", {"data": {"mode": "maybe"}}, ()),
    ("reply access missing", "POST", "/settings/reply-access/99", {"data": {"mode": "on"}}, ()),
    ("disconnect", "POST", "/settings/disconnect/1", {}, ()),
    ("disconnect missing", "POST", "/settings/disconnect/99", {}, ()),
    ("reply", "POST", "/email/{r1}/reply", {"data": {"body": "Hello", "token": "abcdef0123456789"}}, (MASK,)),
    ("reply empty", "POST", "/email/{r1}/reply", {"data": {"body": "", "token": "abcdef0123456789"}}, (MASK,)),
    ("reply missing", "POST", "/email/999/reply", {"data": {"body": "Hello", "token": "abcdef0123456789"}}, (MASK,)),
    ("sync", "POST", "/sync", {"data": {"scan": 30}}, ()),
    ("sync bad scan", "POST", "/sync", {"data": {"scan": 7}}, ()),
    # profiles
    ("profile switch", "POST", "/profiles/switch", {"data": {"profile": "default", "next": "/statistics"}}, ()),
    ("profile switch open redirect", "POST", "/profiles/switch", {"data": {"profile": "default", "next": "//evil.example"}}, ()),
    ("profile switch backslash", "POST", "/profiles/switch", {"data": {"profile": "default", "next": "/\\evil.example"}}, ()),
    ("profile switch unknown", "POST", "/profiles/switch", {"data": {"profile": "nobody"}}, ()),
    ("profile add", "POST", "/profiles", {"data": {"name": "Work"}}, ()),
    ("profile add empty", "POST", "/profiles", {"data": {"name": ""}}, (MASK,)),
    ("profile rename", "POST", "/profiles/default/rename", {"data": {"name": "Home"}}, ()),
    ("profile rename unknown", "POST", "/profiles/nobody/rename", {"data": {"name": "Home"}}, (MASK,)),
    ("profile delete unconfirmed", "POST", "/profiles/default/delete", {}, ()),
    ("profile delete default", "POST", "/profiles/default/delete", {"data": {"confirm": "yes"}}, (MASK,)),
    # jobs (registered by jobs_web.py)
    ("job status", "POST", "/jobs/1/status", {"data": {"status": "saved", "next": "/jobs?tab=matches"}}, ()),
    ("job status bad", "POST", "/jobs/1/status", {"data": {"status": "x"}}, ()),
    ("job status open redirect", "POST", "/jobs/1/status", {"data": {"status": "saved", "next": "https://evil.example"}}, ()),
    ("job applied", "POST", "/jobs/1/applied", {}, ()),
    ("job applied missing", "POST", "/jobs/99/applied", {}, ()),
    ("jobs refresh", "POST", "/jobs/refresh", {}, (MASK,)),
    ("jobs read all", "POST", "/jobs/notifications/read", {}, ()),
    ("jobs profile save", "POST", "/jobs/profile", {"data": {"titles": "Analyst", "min_score": "60"}}, ()),
    ("resume none", "POST", "/jobs/profile/resume", {}, ()),
    ("resume bad", "POST", "/jobs/profile/resume", upload("r.txt", b"x", "text/plain"), (MASK,)),
    ("resume remove", "POST", "/jobs/profile/resume/remove", {}, ()),
    ("feed add bad", "POST", "/jobs/sources/feed", {"data": {"url": "nope"}}, (MASK,)),
    ("adzuna save empty", "POST", "/jobs/sources/adzuna", {"data": {"app_id": "", "app_key": ""}}, ()),
    ("adzuna remove", "POST", "/jobs/sources/adzuna/remove", {}, ()),
    ("feed remove", "POST", "/jobs/sources/1/remove", {}, ()),
]


def snapshot_location(location: str, mask: bool) -> str:
    """Location with query values kept, or replaced by * when only the key is pinned."""
    parts = urlsplit(location)
    query = urlencode([(k, "*" if mask else v) for k, v in parse_qsl(parts.query, keep_blank_values=True)])
    return parts.path + ("?" + query if query else "") + ("#" + parts.fragment if parts.fragment else "")


def run_case(tmp_path: Path, seeded: Path, case) -> dict:
    name, method, path, extra, options = case
    work = tmp_path / "case"
    if work.exists():
        shutil.rmtree(work)
    shutil.copytree(seeded.parent, work)
    db_path = work / seeded.name
    path = path.replace("{r1}", str(email_id(db_path, "r1")))
    app = create_app(db_path, get_provider=lambda name, address: Provider(), http_get=offline, toast=lambda *a, **k: None,
                     secrets_dir=work / "secrets")
    client = TestClient(app, base_url=LOCAL, follow_redirects=False)
    for k, v in (extra.get("cookies") or {}).items():
        client.cookies.set(k, v)
    kwargs = {k: v for k, v in extra.items() if k in ("data", "files", "headers")}
    response = client.request(method, path, **kwargs)
    for thread in (app.state.sync_thread, app.state.connect_thread):
        if thread:
            thread.join(10)
    result = {"status": response.status_code}
    if "location" in response.headers:
        result["location"] = snapshot_location(response.headers["location"], MASK in options)
    cookie = response.headers.get("set-cookie")
    if cookie:
        result["set_cookie"] = sorted(part.strip().split("=")[0] + ("=" + part.split("=", 1)[1] if part.strip().split("=")[0] in ("jt_profile", "Max-Age", "SameSite", "Path") else "")
                                      for part in cookie.split(";"))
    kind = response.headers.get("content-type", "").split(";")[0]
    result["type"] = kind
    if kind == "application/json":
        body = response.json()
        result["json_keys"] = sorted(body) if isinstance(body, dict) else "list"
        if "error" in body:
            result["error_text"] = "*" if MASK in options else body["error"]
    if response.headers.get("cache-control"):
        result["cache_control"] = response.headers["cache-control"]
    return result


@pytest.fixture(scope="module")
def seeded(tmp_path_factory):
    path = tmp_path_factory.mktemp("seed") / "t.db"
    seed(path)
    return path


def flat_routes(routes):
    """Every route, whether the FastAPI version copies an included router's routes into the app or keeps them nested."""
    for route in routes:
        nested = getattr(route, "original_router", None)
        if nested is not None:
            yield from flat_routes(nested.routes)
        else:
            yield route


def current_snapshot(tmp_path, seeded, app) -> dict:
    routes = sorted(["/".join(sorted(getattr(r, "methods", None) or ["MOUNT"])), r.path, r.name] for r in flat_routes(app.routes))
    return {
        "routes": routes,
        "smoke": {case[0]: run_case(tmp_path, seeded, case) for case in CASES},
    }


def test_route_table_and_smoke_requests_match_the_snapshot(tmp_path, seeded):
    app = create_app(tmp_path / "unused.db")
    now = current_snapshot(tmp_path, seeded, app)
    if os.environ.get("UPDATE_ROUTE_SNAPSHOT"):
        SNAPSHOT.write_text(json.dumps(now, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    expected = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    assert now["routes"] == expected["routes"]
    changed = {k: (expected["smoke"].get(k), v) for k, v in now["smoke"].items() if expected["smoke"].get(k) != v}
    assert not changed, json.dumps(changed, indent=1)
    assert set(expected["smoke"]) == set(now["smoke"])
