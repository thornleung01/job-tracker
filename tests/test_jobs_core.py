import io
import json
from datetime import datetime, timedelta, timezone

import pytest
import requests

from jobtracker import db, settings
from jobtracker.jobs import adzuna, alerts, feeds, notify, resume, score, store
from jobtracker.jobs.run import run_discovery
from jobtracker.jobs.text import find_skills
from jobtracker.models import Message
from jobtracker.sync import process_message

NOW = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def conn():
    c = db.connect(":memory:")
    yield c
    c.close()


def set_profile(conn, **values):
    base = {"titles": ["Data Analyst"], "skills_must": ["SQL", "Python"], "skills_nice": ["Tableau"],
            "cities": ["Toronto"], "remote": True, "exclude": [], "seniority": "mid", "min_score": 65}
    settings.save(conn, "profile", {**base, **values})
    return store.load_profile(conn)


def posting(**kw):
    return {"source": "test", "source_key": kw.pop("key", "1"), "title": "Data Analyst", "company": "Globex", "location": "Toronto, ON",
            "remote": False, "url": "https://example.com/1", "description": "", "posted_at": None, "partial": False, **kw}


# --- skills --------------------------------------------------------------------

def test_skill_detection_handles_symbols_and_word_boundaries():
    assert set(find_skills("We use C++ and C#, plus .NET and Node.js with PostgreSQL")) >= {"C++", "C#", ".NET", "Node.js", "PostgreSQL"}
    assert "SQL" in find_skills("strong SQL skills") and "SQL" not in find_skills("a nosqlish thing")
    assert "Java" in find_skills("Java developer") and "Java" not in find_skills("JavaScript developer")
    assert "JavaScript" in find_skills("JavaScript developer")


def test_ambiguous_short_names_only_count_when_they_really_are_the_skill():
    assert "R" in find_skills("Skills: Python, R, SQL") and "R" in find_skills("experience with R programming")
    assert "R" not in find_skills("R&D team") and "R" not in find_skills("grade R student")
    assert "Go" in find_skills("Backend in Golang") and "Go" in find_skills("Python, Go, Rust")
    assert "Go" not in find_skills("Go above and beyond. Go to market strategy.")


# --- resume ----------------------------------------------------------------------

def make_docx(lines):
    from docx import Document
    doc = Document()
    for line in lines:
        doc.add_paragraph(line)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


RESUME_LINES = ["Jordan Lee", "Data Analyst", "Globex Inc, 2022 to present", "Built dashboards in Tableau and Power BI using SQL and Python.",
                "Business Intelligence Analyst", "Initech, 2019 to 2022", "5 years of experience in analytics and A/B testing."]


def test_docx_resume_gives_skills_titles_and_level():
    text = resume.extract_text("jordan.docx", make_docx(RESUME_LINES))
    a = resume.analyze(text)
    assert {"SQL", "Python", "Tableau", "Power BI", "A/B Testing"} <= set(a.skills)
    assert "Data Analyst" in a.titles and "Business Intelligence Analyst" in a.titles
    assert a.years == 5 and a.seniority == "mid"


def test_docx_tables_are_read_too():
    from docx import Document
    doc = Document()
    table = doc.add_table(rows=1, cols=2)
    table.rows[0].cells[0].text = "Skills"
    table.rows[0].cells[1].text = "Python, SQL, Docker and Kubernetes for data platform work at scale"
    buf = io.BytesIO()
    doc.save(buf)
    assert {"Python", "SQL", "Docker", "Kubernetes"} <= set(resume.analyze(resume.extract_text("r.docx", buf.getvalue())).skills)


def tiny_pdf(text: str) -> bytes:
    stream = f"BT /F1 12 Tf 50 700 Td ({text}) Tj ET".encode()
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream", b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offsets = b"%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % o for o in offsets)
    return out + b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF" % (len(objs) + 1, xref)


def test_pdf_resume_is_read():
    text = resume.extract_text("cv.pdf", tiny_pdf("Data Analyst with Python and SQL and Tableau experience since 2019"))
    assert {"Python", "SQL", "Tableau"} <= set(resume.analyze(text).skills)


def test_plain_text_resume_and_friendly_errors():
    assert "Python" in resume.analyze(resume.extract_text("cv.txt", b"Software Engineer. Python, Django and Docker for five years of work.")).skills
    with pytest.raises(resume.ResumeError, match="PDF, Word"):
        resume.extract_text("cv.exe", b"x")
    with pytest.raises(resume.ResumeError, match="5 MB"):
        resume.extract_text("cv.txt", b"x" * (resume.MAX_UPLOAD + 1))
    with pytest.raises(resume.ResumeError, match="No text found"):
        resume.extract_text("cv.txt", b"   ")
    with pytest.raises(resume.ResumeError, match="Couldn't read"):
        resume.extract_text("cv.pdf", b"this is not a pdf at all, just text pretending to be one")


def test_seniority_from_years_and_titles():
    assert resume.analyze("Senior Data Engineer\nBuilt pipelines for 8 years").seniority == "senior"
    assert resume.analyze("Recent graduate. Intern at Acme. Python.").seniority == "junior"
    assert resume.analyze("Python developer").seniority == ""


# --- scoring ---------------------------------------------------------------------

def test_a_strong_match_scores_high_with_reasons(conn):
    p = set_profile(conn)
    s, reasons = score.score_posting(p, posting(title="Data Analyst", description="SQL, Python and Tableau dashboards", posted_at=NOW.isoformat()), NOW)
    assert s >= 90
    assert any("Title" in r for r in reasons) and any("SQL" in r for r in reasons) and "Toronto" in reasons and "Posted today" in reasons


def test_an_unrelated_job_scores_low(conn):
    p = set_profile(conn)
    s, _ = score.score_posting(p, posting(title="Registered Nurse", location="Calgary, AB", description="patient care, charting"), NOW)
    assert s < 20


def test_missing_description_is_not_punished_but_partial_is_capped(conn):
    p = set_profile(conn)
    full, _ = score.score_posting(p, posting(), NOW)                          # title + place only: still strong
    assert full >= 90
    capped, reasons = score.score_posting(p, posting(partial=True), NOW)
    assert capped == score.PARTIAL_CAP and "Partial info (from an alert email)" in reasons


def test_remote_counts_as_a_place_when_you_want_remote(conn):
    s, reasons = score.score_posting(set_profile(conn, cities=[]), posting(location="Anywhere", remote=True), NOW)
    assert "Remote" in reasons and s >= 90


def test_skills_use_must_have_weighting(conn):
    p = set_profile(conn, skills_must=["SQL"], skills_nice=["Python"])
    both, _ = score.score_posting(p, posting(description="SQL and Python"), NOW)
    only_other, _ = score.score_posting(p, posting(description="Needs SQL and Spark and Kafka"), NOW)
    assert only_other < both


def test_excluded_words_and_seniority_mismatch_are_penalised(conn):
    p = set_profile(conn, exclude=["security clearance"], seniority="junior")
    base, _ = score.score_posting(p, posting(description="SQL"), NOW)
    cleared, r1 = score.score_posting(p, posting(description="SQL. Requires security clearance."), NOW)
    senior, r2 = score.score_posting(p, posting(title="Senior Data Analyst", description="SQL"), NOW)
    assert cleared <= base - 25 and any("security clearance" in r for r in r1)
    assert senior < base and "Looks more senior than you" in r2


def test_title_synonyms_and_empty_profile(conn):
    p = set_profile(conn, titles=["Software Developer"], skills_must=[], skills_nice=[])
    s, _ = score.score_posting(p, posting(title="Software Engineer", location="Toronto"), NOW)
    assert s >= 80                                                              # developer ≈ engineer
    assert score.score_posting(settings.DEFAULTS["profile"], posting(), NOW)[0] == 0   # nothing to compare against


def test_old_postings_are_less_fresh(conn):
    p = set_profile(conn)
    new, _ = score.score_posting(p, posting(posted_at=(NOW - timedelta(days=1)).isoformat()), NOW)
    old, _ = score.score_posting(p, posting(posted_at=(NOW - timedelta(days=40)).isoformat()), NOW)
    assert new > old


# --- alert emails ----------------------------------------------------------------

LINKEDIN_HTML = """<html><body><table>
<tr><td><a href="https://www.linkedin.com/comm/jobs/view/3912345678?trackingId=abc&amp;refId=1">Data Analyst</a></td></tr>
<tr><td>Globex · Toronto, ON</td></tr><tr><td>Be an early applicant</td></tr>
<tr><td><a href="https://www.linkedin.com/comm/jobs/view/3912345678?trackingId=abc&amp;refId=2">View job</a></td></tr>
<tr><td><a href="https://www.linkedin.com/comm/jobs/view/4000000001?trackingId=x">BI Developer (Remote)</a></td></tr>
<tr><td>Initech · Canada</td></tr>
<tr><td><a href="https://www.linkedin.com/comm/jobs/view/4000000002?trackingId=y">Reporting Analyst</a></td></tr>
<tr><td><a href="https://www.linkedin.com/help">Help</a></td></tr>
</table></body></html>"""

INDEED_HTML = """<html><body>
<div><a href="https://ca.indeed.com/rc/clk?jk=0a1b2c3d4e5f6789&amp;from=alert">Junior Data Analyst</a>
<div>Hooli</div><div>Vancouver, BC</div></div>
<div><a href="https://ca.indeed.com/rc/clk?jk=ffffeeee11112222&amp;from=alert">Analytics Specialist</a>
<div>Pied Piper - Remote</div><div>$70,000 a year</div></div>
<div><a href="https://ca.indeed.com/settings">Manage alerts</a></div></body></html>"""


def alert_msg(sender, subject, html, name=""):
    return Message(id="a1", thread_id="t", sender_name=name, sender_email=sender, subject=subject,
                   received_at=NOW, body="x", html=html)


def test_linkedin_alert_is_recognised_and_parsed():
    msg = alert_msg("jobalerts-noreply@linkedin.com", "New jobs for you: Data Analyst in Toronto", LINKEDIN_HTML)
    assert alerts.alert_site(msg) == "linkedin"
    found = {p["source_key"]: p for p in alerts.parse(msg)}
    assert set(found) == {"linkedin:3912345678", "linkedin:4000000001", "linkedin:4000000002"}   # button link and help link skipped
    a = found["linkedin:3912345678"]
    assert (a["title"], a["company"], a["location"]) == ("Data Analyst", "Globex", "Toronto, ON")
    assert a["url"] == "https://www.linkedin.com/jobs/view/3912345678" and a["partial"] is True
    b = found["linkedin:4000000001"]
    assert b["company"] == "Initech" and b["remote"] is True
    assert found["linkedin:4000000002"]["company"] == ""        # no company line: left empty, not borrowed from a neighbour


def test_indeed_alert_is_recognised_and_parsed():
    msg = alert_msg("alert@indeed.com", "new Data Analyst jobs in Vancouver", INDEED_HTML)
    assert alerts.alert_site(msg) == "indeed"
    found = {p["source_key"]: p for p in alerts.parse(msg)}
    assert set(found) == {"indeed:0a1b2c3d4e5f6789", "indeed:ffffeeee11112222"}
    a = found["indeed:0a1b2c3d4e5f6789"]
    assert (a["title"], a["company"], a["location"]) == ("Junior Data Analyst", "Hooli", "Vancouver, BC")
    assert a["url"] == "https://ca.indeed.com/viewjob?jk=0a1b2c3d4e5f6789"
    assert found["indeed:ffffeeee11112222"]["remote"] is True


def test_unknown_layouts_and_other_mail_give_nothing():
    assert alerts.parse(alert_msg("jobalerts-noreply@linkedin.com", "New jobs for you", "<html><body><p>Nothing here</p></body></html>")) == []
    assert alerts.parse(alert_msg("jobalerts-noreply@linkedin.com", "New jobs for you", "")) == []
    assert alerts.alert_site(alert_msg("news@linkedin.com", "Your weekly digest", "")) is None
    assert alerts.alert_site(alert_msg("recruiter@acme.com", "New jobs for you", "")) is None
    assert alerts.alert_site(alert_msg("no-reply@indeed.com", "Your application was submitted", "")) is None


def test_alert_email_becomes_postings_not_an_application(conn):
    set_profile(conn)
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    msg = alert_msg("jobalerts-noreply@linkedin.com", "New jobs for you: Data Analyst", LINKEDIN_HTML)
    assert process_message(conn, acct, msg) == "job-alert"
    assert conn.execute("SELECT COUNT(*) FROM job_postings").fetchone()[0] == 3
    assert conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0] == 0
    assert db.email_seen(conn, acct, "a1")
    assert process_message(conn, acct, msg) == "duplicate"                 # re-syncing doesn't add them again


# --- company feeds ---------------------------------------------------------------

@pytest.mark.parametrize("text,expected", [
    ("https://boards.greenhouse.io/acme", ("greenhouse", "acme")),
    ("job-boards.greenhouse.io/acme/jobs/123", ("greenhouse", "acme")),
    ("https://boards-api.greenhouse.io/v1/boards/acme/jobs", ("greenhouse", "acme")),
    ("https://jobs.lever.co/acme-co/abc", ("lever", "acme-co")),
    ("https://jobs.ashbyhq.com/acme", ("ashby", "acme")),
    ("https://careers.smartrecruiters.com/AcmeInc", ("smartrecruiters", "AcmeInc")),
    ("lever: acme", ("lever", "acme")),
    ("https://www.acme.com/careers", None),
    ("", None),
])
def test_detecting_the_platform(text, expected):
    assert feeds.detect(text) == expected


GREENHOUSE = {"jobs": [{"id": 11, "title": "Data Analyst", "updated_at": "2026-11-02T10:00:00Z", "location": {"name": "Toronto, ON"},
                        "absolute_url": "https://boards.greenhouse.io/acme/jobs/11",
                        "content": "&lt;p&gt;We need &lt;b&gt;SQL&lt;/b&gt; and Python.&lt;/p&gt;"}]}
LEVER = [{"id": "abc", "text": "Backend Engineer", "categories": {"location": "Remote - Canada"}, "hostedUrl": "https://jobs.lever.co/acme/abc",
          "descriptionPlain": "Python and Docker", "createdAt": 1793000000000, "workplaceType": "remote"}]
ASHBY = {"jobs": [{"id": "x1", "title": "Product Analyst", "location": "Vancouver", "isRemote": False, "jobUrl": "https://jobs.ashbyhq.com/acme/x1",
                   "descriptionPlain": "SQL and Looker", "publishedAt": "2026-11-01T00:00:00Z"}]}
SMART = {"content": [{"id": "999", "name": "Business Analyst", "releasedDate": "2026-11-01T00:00:00Z",
                      "location": {"city": "Ottawa", "region": "ON", "country": "ca", "remote": False}}]}


@pytest.mark.parametrize("platform,data,title,place,partial", [
    ("greenhouse", GREENHOUSE, "Data Analyst", "Toronto, ON", False),
    ("lever", LEVER, "Backend Engineer", "Remote - Canada", False),
    ("ashby", ASHBY, "Product Analyst", "Vancouver", False),
    ("smartrecruiters", SMART, "Business Analyst", "Ottawa, ON, CA", True),
])
def test_feed_parsers(platform, data, title, place, partial):
    (p,) = feeds.parse(platform, "acme", "Acme", data)
    assert (p["title"], p["location"], p["partial"], p["company"]) == (title, place, partial, "Acme")
    assert p["source"] == f"feed:{platform}:acme" and p["url"].startswith("https://")


def test_feed_details_are_cleaned():
    (g,) = feeds.parse("greenhouse", "acme", "Acme", GREENHOUSE)
    assert g["description"] == "We need SQL and Python." and g["posted_at"] == "2026-11-02T10:00:00Z"
    (l,) = feeds.parse("lever", "acme", "Acme", LEVER)
    assert l["remote"] is True and l["posted_at"].startswith("2026-")           # milliseconds converted


class FakeResponse:
    def __init__(self, status=200, data=None):
        self.status_code, self._data, self.ok = status, data, status < 400

    def json(self):
        if isinstance(self._data, Exception):
            raise self._data
        return self._data

    def raise_for_status(self):
        if not self.ok:
            raise requests.HTTPError(str(self.status_code))


def test_feed_errors_are_clear():
    with pytest.raises(feeds.SourceError, match="no job board called “nope”"):
        feeds.fetch("greenhouse", "nope", "Nope", lambda *a, **k: FakeResponse(404))
    with pytest.raises(feeds.SourceError, match=r"error \(500\)"):
        feeds.fetch("lever", "x", "X", lambda *a, **k: FakeResponse(500))
    with pytest.raises(feeds.SourceError, match="couldn't read"):
        feeds.fetch("ashby", "x", "X", lambda *a, **k: FakeResponse(200, ValueError("bad json")))

    def down(*a, **k):
        raise requests.ConnectionError()
    with pytest.raises(feeds.SourceError, match="internet connection"):
        feeds.fetch("ashby", "x", "X", down)


def test_adding_a_company_checks_it_first(conn):
    ok = lambda *a, **k: FakeResponse(200, GREENHOUSE)  # noqa: E731
    source_id, count = feeds.add_source(conn, "https://boards.greenhouse.io/acme-co", "", ok)
    assert count == 1 and conn.execute("SELECT name FROM job_sources WHERE id = ?", (source_id,)).fetchone()["name"] == "greenhouse:acme-co"
    assert json.loads(conn.execute("SELECT config FROM job_sources").fetchone()[0])["company"] == "Acme Co"      # name from the address
    again, _ = feeds.add_source(conn, "greenhouse:acme-co", "", ok)
    assert again == source_id and conn.execute("SELECT COUNT(*) FROM job_sources").fetchone()[0] == 1
    with pytest.raises(feeds.SourceError, match="isn't a supported careers page"):
        feeds.add_source(conn, "https://www.acme.com/careers", "", ok)
    with pytest.raises(feeds.SourceError, match="no job board"):
        feeds.add_source(conn, "greenhouse:typo", "", lambda *a, **k: FakeResponse(404))
    assert conn.execute("SELECT COUNT(*) FROM job_sources").fetchone()[0] == 1   # a failed one isn't saved


# --- adzuna ----------------------------------------------------------------------

def test_adzuna_queries_cover_titles_cities_and_remote_within_the_cap():
    p = {"titles": ["Data Analyst", "BI Developer"], "cities": ["Toronto", "Vancouver"], "remote": True, "countries": ["ca", "us"]}
    q = adzuna.queries(p)
    assert ("Data Analyst", "Toronto", "ca") in q and ("Data Analyst remote", "", "us") in q
    assert len(q) == adzuna.MAX_REQUESTS
    assert adzuna.queries({"titles": [], "cities": ["x"], "remote": True, "countries": ["ca"]}) == []


def test_adzuna_parsing_and_errors():
    data = {"results": [{"id": "77", "title": "Data Analyst", "company": {"display_name": "Globex"}, "location": {"display_name": "Toronto, Ontario"},
                         "redirect_url": "https://www.adzuna.ca/land/77", "description": "SQL needed", "created": "2026-11-02T08:00:00Z"}]}
    creds = {"app_id": "a", "app_key": "k"}
    (p,) = adzuna.search(creds, "data analyst", "Toronto", "ca", lambda *a, **k: FakeResponse(200, data))
    assert (p["source_key"], p["company"], p["location"]) == ("ca:77", "Globex", "Toronto, Ontario")
    with pytest.raises(PermissionError, match="app ID and key"):
        adzuna.search(creds, "x", "", "ca", lambda *a, **k: FakeResponse(401))
    assert adzuna.due(None) and not adzuna.due((datetime.now(timezone.utc) - timedelta(hours=1)).isoformat())
    assert adzuna.due((datetime.now(timezone.utc) - timedelta(hours=7)).isoformat())


# --- store -----------------------------------------------------------------------

def test_same_job_from_two_sources_is_one_posting_and_the_full_one_fills_it_in(conn):
    p = set_profile(conn)
    partial = posting(source="linkedin", key="linkedin:1", partial=True, url="https://linkedin/1")
    full = posting(source="feed:greenhouse:globex", key="77", description="SQL and Python", url="https://boards.greenhouse.io/globex/77", partial=False)
    assert store.add_postings(conn, [partial], p) == 1
    assert store.add_postings(conn, [full], p) == 0
    row = conn.execute("SELECT * FROM job_postings").fetchone()
    assert conn.execute("SELECT COUNT(*) FROM job_postings").fetchone()[0] == 1
    assert row["partial"] == 0 and "SQL" in row["description"] and row["url"].startswith("https://boards.greenhouse")
    assert store.add_postings(conn, [partial], p) == 0                                # the same source key again: nothing


def test_different_cities_or_titles_are_different_postings(conn):
    p = set_profile(conn)
    n = store.add_postings(conn, [posting(key="1", location="Toronto"), posting(key="2", location="Vancouver", source="b"),
                                  posting(key="3", title="Data Engineer", source="c")], p)
    assert n == 3


def test_blank_titles_are_skipped_and_descriptions_capped(conn):
    p = set_profile(conn)
    assert store.add_postings(conn, [posting(title="  "), posting(key="2", description="x" * 10_000)], p) == 1
    assert len(conn.execute("SELECT description FROM job_postings").fetchone()[0]) == store.DESCRIPTION_LIMIT


def test_changing_your_profile_rescores_everything(conn):
    store.add_postings(conn, [posting(description="SQL Python")], set_profile(conn))
    before = conn.execute("SELECT score FROM job_postings").fetchone()[0]
    set_profile(conn, titles=["Nurse"], skills_must=["Nursing"], skills_nice=[], cities=["Calgary"], remote=False)
    store.rescore_all(conn)
    assert conn.execute("SELECT score FROM job_postings").fetchone()[0] < before


def test_listing_filters_statuses_and_scores(conn):
    p = set_profile(conn)
    store.add_postings(conn, [posting(key="1"), posting(key="2", title="Chef", source="b", company="Cafe")], p)
    ids = {r["title"]: r["id"] for r in conn.execute("SELECT id, title FROM job_postings")}
    assert [x["title"] for x in store.list_postings(conn, "new", 0)] == ["Data Analyst", "Chef"]       # best first
    assert [x["title"] for x in store.list_postings(conn, "new", 50)] == ["Data Analyst"]
    store.set_status(conn, ids["Data Analyst"], "saved")
    store.set_status(conn, ids["Chef"], "dismissed")
    assert [x["title"] for x in store.list_postings(conn, "saved")] == ["Data Analyst"]
    assert store.list_postings(conn, "new") == [] and [x["title"] for x in store.list_postings(conn, "dismissed")] == ["Chef"]
    assert store.counts(conn)["saved"] == 1 and store.counts(conn)["all"] == 1       # dismissed stays out of "all"
    with pytest.raises(ValueError):
        store.set_status(conn, 1, "bogus")


def test_marking_applied_creates_a_tracked_application_once(conn):
    store.add_postings(conn, [posting(url="https://example.com/job")], set_profile(conn))
    pid = conn.execute("SELECT id FROM job_postings").fetchone()[0]
    app_id = store.mark_applied(conn, pid)
    app = conn.execute("SELECT * FROM applications WHERE id = ?", (app_id,)).fetchone()
    assert (app["company"], app["role"], app["stage"], app["manual"]) == ("Globex", "Data Analyst", "Applied", 1)
    row = conn.execute("SELECT status, application_id FROM job_postings").fetchone()
    assert (row["status"], row["application_id"]) == ("applied", app_id)
    assert "https://example.com/job" in conn.execute("SELECT body FROM activity WHERE application_id = ?", (app_id,)).fetchone()[0]
    assert store.mark_applied(conn, pid) == app_id and conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0] == 1
    assert store.mark_applied(conn, 999) is None


# --- notifications ---------------------------------------------------------------

def test_one_summary_notification_covering_only_matches_above_the_threshold(conn):
    p = set_profile(conn, min_score=65)
    store.add_postings(conn, [posting(key="1", description="SQL Python Tableau"), posting(key="2", title="Chef", company="Cafe", source="b"),
                              posting(key="3", title="Data Analyst II", company="Hooli", source="c", description="SQL")], p)
    shown = []
    assert notify.notify_new(conn, lambda t, b, u: shown.append((t, b, u))) == 2
    (title, body, url), = shown
    assert title == "2 new jobs match your resume" and body.startswith("Top match: Data Analyst") and "(100)" in body and url.endswith("/jobs")
    assert conn.execute("SELECT COUNT(*) FROM notifications").fetchone()[0] == 1
    assert notify.notify_new(conn, lambda *a: shown.append(a)) == 0 and len(shown) == 1       # never repeats
    store.add_postings(conn, [posting(key="9", title="Data Analyst", company="Initech", source="d", description="SQL Python")], p)
    assert notify.notify_new(conn, lambda *a: shown.append(a)) == 1 and shown[-1][0] == "1 new job matches your resume"


def test_dismissed_jobs_are_not_notified_and_the_record_is_made_before_the_popup(conn):
    p = set_profile(conn)
    store.add_postings(conn, [posting(description="SQL Python")], p)
    store.set_status(conn, 1, "dismissed")
    assert notify.notify_new(conn, lambda *a: None) == 0
    store.set_status(conn, 1, "new")

    def broken(*a):
        raise RuntimeError("no desktop")
    with pytest.raises(RuntimeError):                     # show_toast swallows its own errors; a custom one may not
        notify.notify_new(conn, broken)
    assert conn.execute("SELECT notified FROM job_postings").fetchone()[0] == 1       # recorded first, so it can't loop


def test_toast_helper_never_raises(monkeypatch):
    import sys
    monkeypatch.setitem(sys.modules, "windows_toasts", None)          # as if it wasn't installed
    assert notify.show_toast("t", "b", "http://x") is False


# --- the whole pass ---------------------------------------------------------------

def test_discovery_does_nothing_without_a_profile(conn):
    r = run_discovery(conn, get=lambda *a, **k: pytest.fail("no network without a profile"))
    assert r["skipped"] and r["feeds"] == 0


def test_discovery_reads_feeds_notifies_and_records_errors(conn):
    set_profile(conn)
    conn.execute("INSERT INTO job_sources (kind, name, config) VALUES ('feed', 'greenhouse:acme', ?)",
                 (json.dumps({"platform": "greenhouse", "token": "acme", "company": "Acme"}),))
    conn.execute("INSERT INTO job_sources (kind, name, config) VALUES ('feed', 'lever:gone', ?)",
                 (json.dumps({"platform": "lever", "token": "gone", "company": "Gone"}),))
    conn.commit()

    def get(url, **k):
        return FakeResponse(200, GREENHOUSE) if "greenhouse" in url else FakeResponse(404)
    shown = []
    r = run_discovery(conn, force=True, get=get, toast=lambda *a: shown.append(a))
    assert r["feeds"] == 1 and r["notified"] == 1 and len(shown) == 1
    rows = {s["name"]: s for s in conn.execute("SELECT * FROM job_sources")}
    assert rows["greenhouse:acme"]["last_error"] is None and rows["greenhouse:acme"]["last_checked"]
    assert "no job board called" in rows["lever:gone"]["last_error"]


def test_feeds_checked_recently_are_skipped_unless_forced(conn):
    set_profile(conn)
    conn.execute("INSERT INTO job_sources (kind, name, config, last_checked) VALUES ('feed', 'greenhouse:acme', ?, ?)",
                 (json.dumps({"platform": "greenhouse", "token": "acme", "company": "Acme"}), db.iso(datetime.now(timezone.utc))))
    conn.commit()
    calls = []
    run_discovery(conn, get=lambda *a, **k: calls.append(a) or FakeResponse(200, GREENHOUSE), toast=lambda *a: None)
    assert calls == []
    run_discovery(conn, force=True, get=lambda *a, **k: calls.append(a) or FakeResponse(200, GREENHOUSE), toast=lambda *a: None)
    assert len(calls) == 1


def test_adzuna_runs_only_with_a_key_and_reports_a_bad_key(conn, monkeypatch):
    set_profile(conn)
    conn.execute("INSERT INTO job_sources (kind, name) VALUES ('adzuna', 'adzuna')")
    conn.commit()
    monkeypatch.setattr(adzuna, "load_credentials", lambda profile="default": None)
    assert run_discovery(conn, force=True, get=lambda *a, **k: pytest.fail("no key, no search"), toast=lambda *a: None)["adzuna"] == 0
    monkeypatch.setattr(adzuna, "load_credentials", lambda profile="default": {"app_id": "a", "app_key": "bad"})
    run_discovery(conn, force=True, get=lambda *a, **k: FakeResponse(401), toast=lambda *a: None)
    assert "app ID and key" in conn.execute("SELECT last_error FROM job_sources").fetchone()[0]
