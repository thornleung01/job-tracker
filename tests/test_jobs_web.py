import html as html_lib
import re

import pytest
from fastapi.testclient import TestClient

from jobtracker import db, settings
from jobtracker.jobs import adzuna, store
from jobtracker.web import create_app
from tests.test_jobs_core import GREENHOUSE, FakeResponse, make_docx, posting, RESUME_LINES


class Env:
    def __init__(self, path):
        self.conn = db.connect(path)
        self.toasts = []
        self.responses = {}                       # substring of a URL -> FakeResponse
        self.requests = []
        self.creds = None

    def http_get(self, url, **kw):
        self.requests.append(url)
        for needle, response in self.responses.items():
            if needle in url:
                return response
        return FakeResponse(404)

    def client(self):
        return TestClient(create_app(self.conn_path, http_get=self.http_get, toast=lambda *a: self.toasts.append(a)),
                          base_url="http://127.0.0.1:8765", follow_redirects=False)


@pytest.fixture
def env(tmp_path, monkeypatch):
    e = Env(tmp_path / "t.db")
    e.conn_path = tmp_path / "t.db"
    monkeypatch.setattr(adzuna, "save_credentials", lambda i, k, profile="default": setattr(e, "creds", {"app_id": i, "app_key": k}))
    monkeypatch.setattr(adzuna, "load_credentials", lambda profile="default": e.creds)
    monkeypatch.setattr(adzuna, "clear_credentials", lambda profile="default": setattr(e, "creds", None))
    e.c = e.client()
    yield e
    e.conn.close()


def profile(env, **kw):
    base = {"titles": ["Data Analyst"], "skills_must": ["SQL", "Python"], "skills_nice": ["Tableau"], "cities": ["Toronto"],
            "remote": True, "seniority": "mid", "min_score": 65}
    settings.save(env.conn, "profile", {**base, **kw})


def add_job(env, **kw):
    store.add_postings(env.conn, [posting(**kw)], store.load_profile(env.conn))
    env.conn.commit()


def follow(env, response):
    assert response.status_code == 303, response.text[:200]
    return html_lib.unescape(env.c.get(response.headers["location"]).text)       # Jinja writes ' as &#39;


# --- the page ---------------------------------------------------------------------

def test_jobs_tab_exists_with_four_sections_and_asks_for_a_resume_first(env):
    html = env.c.get("/jobs").text
    for tab in ("Matches", "Notifications", "Your profile", "Sources"):
        assert tab in html
    assert "Start with your resume" in html and 'href="/jobs?tab=profile"' in html
    assert re.search(r'<a href="/jobs"[^>]*aria-current="page"', html)


def test_unknown_tab_view_and_scores_fall_back_safely(env):
    assert env.c.get("/jobs?tab=bogus&view=nope&min=abc").status_code in (200, 422)
    assert env.c.get("/jobs?tab=bogus&view=nope&min=999").status_code == 200


def test_matches_are_listed_best_first_with_reasons_and_actions(env):
    profile(env)
    add_job(env, key="1", description="SQL Python Tableau")
    add_job(env, key="2", title="Data Analyst II", company="Hooli", source="b", description="SQL")
    add_job(env, key="3", title="Chef", company="Cafe", source="c", location="Calgary")
    html = env.c.get("/jobs").text
    titles = re.findall(r'<h2 class="job-title"><a [^>]*>([^<]+)</a>', html)
    assert "Chef" not in titles and set(titles) == {"Data Analyst", "Data Analyst II"}         # below the notify threshold
    assert "Title ≈ Data Analyst" in html and "SQL, Python, Tableau" in html and "Open posting" in html
    assert 'name="status" value="saved"' in html and 'name="status" value="dismissed"' in html and "I applied" in html
    assert "Chef" in env.c.get("/jobs?min=0").text                                                # "Any score" shows everything


def test_nav_badge_counts_new_matches_and_clears_when_handled(env):
    profile(env)
    assert 'class="count"' not in env.c.get("/").text
    add_job(env, description="SQL Python")
    page = env.c.get("/").text
    assert re.search(r'<a href="/jobs"[^>]*>Jobs<span class="count" aria-label="1 new matches">1</span>', page)
    env.c.post("/jobs/1/status", data={"status": "dismissed"})
    assert 'class="count"' not in env.c.get("/").text


def test_posting_text_is_escaped_and_only_web_links_are_clickable(env):
    profile(env)
    add_job(env, title="<script>alert(1)</script> Analyst", company="<b>Evil</b>", url="javascript:alert(1)", description="SQL")
    add_job(env, key="2", source="b", title="Data Analyst", company="Good", url="https://example.com/ok", description="SQL")
    html = env.c.get("/jobs?min=0").text
    assert "<script>alert(1)</script>" not in html and "&lt;script&gt;" in html and "<b>Evil</b>" not in html
    assert "javascript:" not in html and 'href="https://example.com/ok" target="_blank" rel="noopener noreferrer"' in html


# --- actions ----------------------------------------------------------------------

def test_save_dismiss_and_restore(env):
    profile(env)
    add_job(env, description="SQL Python")
    env.c.post("/jobs/1/status", data={"status": "saved", "next": "/jobs?tab=matches&view=new"})
    assert env.conn.execute("SELECT status FROM job_postings").fetchone()[0] == "saved"
    assert "Data Analyst" in env.c.get("/jobs?view=saved").text and "Unsave" in env.c.get("/jobs?view=saved").text
    env.c.post("/jobs/1/status", data={"status": "dismissed"})
    assert "Restore" in env.c.get("/jobs?view=dismissed&min=0").text
    env.c.post("/jobs/1/status", data={"status": "new"})
    assert env.conn.execute("SELECT status FROM job_postings").fetchone()[0] == "new"
    assert env.c.post("/jobs/1/status", data={"status": "bogus"}).status_code == 404
    assert env.c.post("/jobs/99/status", data={"status": "saved"}).status_code == 404


def test_next_address_cannot_send_you_to_another_site(env):
    profile(env)
    add_job(env)
    for bad in ("https://evil.example.com", "//evil.example.com", "/settings", "javascript:alert(1)"):
        r = env.c.post("/jobs/1/status", data={"status": "seen", "next": bad})
        assert r.status_code == 303 and r.headers["location"].startswith("/jobs"), bad


def test_i_applied_adds_the_job_to_applications(env):
    profile(env)
    add_job(env, url="https://example.com/job", description="SQL")
    r = env.c.post("/jobs/1/applied", data={"next": "/jobs?tab=matches"})
    assert "Added to your applications" in follow(env, r)
    app = env.conn.execute("SELECT * FROM applications").fetchone()
    assert (app["company"], app["role"], app["stage"]) == ("Globex", "Data Analyst", "Applied")
    html = env.c.get("/jobs?view=applied").text
    assert f'href="/app/{app["id"]}"' in html and "I applied" not in html
    assert env.c.post("/jobs/99/applied").status_code == 404


# --- profile and resume ------------------------------------------------------------

def upload(env, name, data, ctype="application/octet-stream"):
    return env.c.post("/jobs/profile/resume", files={"file": (name, data, ctype)})


def test_uploading_a_resume_fills_in_the_profile(env):
    r = upload(env, "jordan.docx", make_docx(RESUME_LINES))
    page = follow(env, r)
    assert "Resume read: found" in page
    p = store.load_profile(env.conn)
    assert {"SQL", "Python", "Tableau"} <= set(p["skills_nice"]) and "Data Analyst" in p["titles"] and p["seniority"] == "mid"
    assert p["resume_text"].startswith("Jordan Lee")
    assert "Resume loaded" in page and "Replace resume" in page and "Tableau" in page


def test_a_second_upload_keeps_what_you_already_edited(env):
    profile(env, titles=["Product Analyst"], skills_must=["SQL"], skills_nice=[], seniority="senior")
    upload(env, "jordan.docx", make_docx(RESUME_LINES))
    p = store.load_profile(env.conn)
    assert p["titles"] == ["Product Analyst"] and p["seniority"] == "senior" and p["skills_must"] == ["SQL"]
    assert "SQL" not in p["skills_nice"] and "Python" in p["skills_nice"]            # new skills added, must-haves not duplicated


@pytest.mark.parametrize("name,data,message", [
    ("cv.exe", b"x", "PDF, Word"), ("cv.txt", b"x" * (5 * 1024 * 1024 + 10), "over 5 MB"),
    ("cv.txt", b"  ", "No text found"), ("", b"hello", "Choose a PDF"),
])
def test_bad_resume_uploads_explain_themselves(env, name, data, message):
    page = follow(env, upload(env, name, data))
    assert message in page and 'role="alert"' in page
    assert store.load_profile(env.conn)["resume_text"] == ""


def test_removing_the_resume_keeps_skills(env):
    upload(env, "jordan.docx", make_docx(RESUME_LINES))
    env.c.post("/jobs/profile/resume/remove")
    p = store.load_profile(env.conn)
    assert p["resume_text"] == "" and "SQL" in p["skills_nice"]


def test_saving_the_profile_rescores_existing_jobs(env):
    profile(env)
    add_job(env, description="SQL Python")
    before = env.conn.execute("SELECT score FROM job_postings").fetchone()[0]
    r = env.c.post("/jobs/profile", data={"titles": "Nurse\nMidwife", "cities": "Calgary", "skills_must": "Nursing", "skills_nice": "",
                                           "exclude": "", "seniority": "junior", "min_score": "80", "countries": ["ca", "us"]})
    assert "Profile saved. Every job was scored again." in follow(env, r)
    p = store.load_profile(env.conn)
    assert p["titles"] == ["Nurse", "Midwife"] and p["remote"] is False and p["min_score"] == 80 and p["countries"] == ["ca", "us"]
    assert env.conn.execute("SELECT score FROM job_postings").fetchone()[0] < before


def test_profile_form_rejects_nonsense_values(env):
    env.c.post("/jobs/profile", data={"titles": "x" * 500, "min_score": "1000", "seniority": "wizard", "countries": ["mars"]})
    p = store.load_profile(env.conn)
    assert len(p["titles"][0]) == 80 and p["min_score"] == 65 and p["seniority"] == "" and p["countries"] == ["ca"]


# --- sources ----------------------------------------------------------------------

def test_adding_a_company_career_page(env):
    profile(env)
    env.responses["greenhouse.io"] = FakeResponse(200, GREENHOUSE)
    page = follow(env, env.c.post("/jobs/sources/feed", data={"url": "https://boards.greenhouse.io/acme", "name": "Acme Corp"}))
    assert "Added. That company has 1 open role" in page and "Acme Corp" in page
    assert env.conn.execute("SELECT COUNT(*) FROM job_postings").fetchone()[0] == 1            # fetched straight away
    assert env.toasts and "1 new job matches your resume" in env.toasts[0][0]


def test_bad_career_addresses_are_explained(env):
    assert "isn't a supported careers page" in follow(env, env.c.post("/jobs/sources/feed", data={"url": "https://acme.com/careers"}))
    assert "no job board called" in follow(env, env.c.post("/jobs/sources/feed", data={"url": "greenhouse:typo"}))
    assert env.conn.execute("SELECT COUNT(*) FROM job_sources").fetchone()[0] == 0


def test_removing_a_company_keeps_its_jobs(env):
    profile(env)
    env.responses["greenhouse.io"] = FakeResponse(200, GREENHOUSE)
    env.c.post("/jobs/sources/feed", data={"url": "greenhouse:acme"})
    env.c.post("/jobs/sources/1/remove")
    assert env.conn.execute("SELECT COUNT(*) FROM job_sources").fetchone()[0] == 0
    assert env.conn.execute("SELECT COUNT(*) FROM job_postings").fetchone()[0] == 1


def test_adzuna_key_is_checked_before_it_is_saved(env):
    env.responses["adzuna.com"] = FakeResponse(401)
    assert "app ID and key" in follow(env, env.c.post("/jobs/sources/adzuna", data={"app_id": "a", "app_key": "wrongkey123"}))
    assert env.creds is None and env.conn.execute("SELECT COUNT(*) FROM job_sources").fetchone()[0] == 0
    assert "Enter both" in follow(env, env.c.post("/jobs/sources/adzuna", data={"app_id": "a", "app_key": " "}))
    env.responses["adzuna.com"] = FakeResponse(200, {"results": []})
    assert "Adzuna connected." in follow(env, env.c.post("/jobs/sources/adzuna", data={"app_id": "a", "app_key": "goodkey456"}))
    assert env.creds == {"app_id": "a", "app_key": "goodkey456"}
    page = env.c.get("/jobs?tab=sources").text
    assert "Connected" in page and "Remove Adzuna" in page and "wrongkey123" not in page and "goodkey456" not in page   # the key is never shown again
    env.c.post("/jobs/sources/adzuna/remove")
    assert env.creds is None


def test_adzuna_offline_still_saves_with_a_note(env):
    import requests as rq
    env.http_get = lambda *a, **k: (_ for _ in ()).throw(rq.ConnectionError())
    env.c = env.client()
    assert "couldn't be reached to check it" in follow(env, env.c.post("/jobs/sources/adzuna", data={"app_id": "a", "app_key": "k"}))
    assert env.creds == {"app_id": "a", "app_key": "k"}


def test_sources_tab_explains_alerts_and_shows_what_was_found(env):
    profile(env)
    add_job(env, source="linkedin", key="linkedin:1", partial=True)
    page = env.c.get("/jobs?tab=sources").text
    assert "Job alert" in page and "can't log in to these sites" in page and "LinkedIn 1 · Indeed 0" in page


# --- refresh and notifications ----------------------------------------------------

def test_look_for_jobs_now_checks_sources_and_notifies(env):
    profile(env)
    env.responses["greenhouse.io"] = FakeResponse(200, GREENHOUSE)
    env.c.post("/jobs/sources/feed", data={"url": "greenhouse:acme"})
    env.toasts.clear()
    env.conn.execute("DELETE FROM job_postings")
    env.conn.commit()
    page = follow(env, env.c.post("/jobs/refresh"))
    assert "Checked your sources: 1 new job found, 1 matched well enough to notify you about." in page
    assert len(env.toasts) == 1


def test_refresh_without_a_profile_sends_you_to_set_one_up(env):
    page = follow(env, env.c.post("/jobs/refresh"))
    assert "Add your resume or some skills first" in page and 'role="alert"' in page


def test_notifications_tab_lists_and_marks_read(env):
    profile(env)
    add_job(env, description="SQL Python")
    from jobtracker.jobs import notify
    notify.notify_new(env.conn, lambda *a: None)
    html = env.c.get("/jobs?tab=notifications").text
    assert "1 new job matches your resume" in html and "Mark all read" in html and 'class="notif unread"' in html
    assert re.search(r"Notifications <span class=\"n\">1</span>", html)
    env.c.post("/jobs/notifications/read")
    html = env.c.get("/jobs?tab=notifications").text
    assert 'class="notif unread"' not in html and "Mark all read" not in html


def test_regular_sync_also_looks_for_jobs(env):
    profile(env)
    env.responses["greenhouse.io"] = FakeResponse(200, GREENHOUSE)
    env.c.post("/jobs/sources/feed", data={"url": "greenhouse:acme"})
    env.conn.execute("DELETE FROM job_postings")
    env.conn.execute("UPDATE job_sources SET last_checked = NULL")
    db.upsert_account(env.conn, "gmail", "me@gmail.com")
    env.conn.commit()
    from tests.test_settings import FakeProvider
    c = TestClient(create_app(env.conn_path, get_provider=lambda n, a: FakeProvider(), http_get=env.http_get, toast=lambda *a: None),
                   base_url="http://127.0.0.1:8765", follow_redirects=False)
    c.post("/sync", data={"scan": "0"})
    c.app.state.sync_thread.join(10)
    assert "Found 1 new job to look at." in c.get("/settings").text


def test_new_job_routes_are_protected_like_the_rest(env):
    for path, data in (("/jobs/refresh", {}), ("/jobs/profile", {"titles": "x"}), ("/jobs/1/status", {"status": "saved"}),
                       ("/jobs/sources/feed", {"url": "greenhouse:a"}), ("/jobs/sources/adzuna", {"app_id": "a", "app_key": "b"})):
        assert env.c.post(path, data=data, headers={"origin": "https://evil.example.com"}).status_code == 403, path
        assert env.c.post(path, data=data, headers={"sec-fetch-site": "cross-site"}).status_code == 403, path


def test_the_resume_text_is_never_put_in_a_page_for_other_tabs_or_the_nav(env):
    upload(env, "jordan.docx", make_docx(RESUME_LINES))
    for path in ("/", "/jobs", "/statistics", "/settings", "/jobs?tab=sources"):
        assert "Globex Inc, 2022 to present" not in env.c.get(path).text


# --- review fixes -----------------------------------------------------------------

def test_a_company_feed_whose_saved_settings_are_corrupt_does_not_take_the_page_down(env):
    env.conn.execute("INSERT INTO job_sources (kind, name, config) VALUES ('feed', 'greenhouse:acme', '{not json')")
    env.conn.commit()
    page = env.c.get("/jobs?tab=sources")
    assert page.status_code == 200 and "greenhouse:acme" in page.text           # still listed, so it can be removed


def test_adding_a_company_checks_only_that_company(env):
    profile(env)
    env.responses["boards-api.greenhouse.io/v1/boards/other"] = FakeResponse(200, GREENHOUSE)
    env.responses["boards-api.greenhouse.io/v1/boards/acme"] = FakeResponse(200, GREENHOUSE)
    follow(env, env.c.post("/jobs/sources/feed", data={"url": "greenhouse:other"}))
    env.requests.clear()
    follow(env, env.c.post("/jobs/sources/feed", data={"url": "greenhouse:acme"}))
    boards = [u for u in env.requests if "/boards/" in u]
    assert boards and all("/boards/acme" in u for u in boards)                  # the first company is not fetched again


def test_saving_the_profile_and_reading_a_resume_run_off_the_event_loop(env, monkeypatch):
    import asyncio
    from jobtracker import jobs_web

    where = {}

    def on_loop() -> bool:
        try:
            asyncio.get_running_loop()
            return True
        except RuntimeError:
            return False
    real_save, real_resume = jobs_web._save_profile_form, jobs_web._save_resume
    monkeypatch.setattr(jobs_web, "_save_profile_form", lambda *a: where.update(profile=on_loop()) or real_save(*a))
    monkeypatch.setattr(jobs_web, "_save_resume", lambda *a: where.update(resume=on_loop()) or real_resume(*a))
    env.c.post("/jobs/profile", data={"titles": "Analyst"})
    env.c.post("/jobs/profile/resume", files={"file": ("r.txt", b"Jordan Lee\nData Analyst with SQL and Python for five years of reporting work.", "text/plain")})
    assert where == {"profile": False, "resume": False}
