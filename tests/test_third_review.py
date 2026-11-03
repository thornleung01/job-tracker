"""Regression tests for the third code review (jobs feature)."""
import logging
import sqlite3

import pytest
from fastapi.testclient import TestClient

from jobtracker import db
from jobtracker.classify import classify
from jobtracker.jobs import alerts, store
from jobtracker.jobs.run import run_discovery
from jobtracker.jobs.text import dedupe_key
from jobtracker.sync import sync_account
from jobtracker.web import create_app
from tests.test_classify import mk as mail
from tests.test_jobs_core import posting, set_profile
from tests.test_pipeline import mk as mk_pipeline


@pytest.fixture
def conn():
    c = db.connect(":memory:")
    yield c
    c.close()


# --- "will be moving forward" is good news ----------------------------------------------

def test_moving_forward_with_you_is_not_a_rejection():
    good = classify(mail("Next steps", "We will be moving forward with your application and would like to schedule an interview."))
    assert good.event != "rejected"


@pytest.mark.parametrize("text", [
    "We will not be moving forward with your application.",
    "Unfortunately we are not moving forward with your candidacy.",
    "We won't be moving forward with your application.",
])
def test_real_rejections_are_still_rejections(text):
    assert classify(mail("Your application", text)).event == "rejected"


# --- the same job twice, not a family of jobs --------------------------------------------

@pytest.mark.parametrize("a,b", [
    (("Senior Software Engineer", "Toronto, ON"), ("Software Engineer", "Toronto, ON")),
    (("Software Engineer II", "Toronto, ON"), ("Software Engineer III", "Toronto, ON")),
    (("Engineer", "San Francisco, CA"), ("Engineer", "San Jose, CA")),
    (("Engineer", "New York, NY"), ("Engineer", "New Jersey")),
])
def test_different_jobs_get_different_keys(a, b):
    assert dedupe_key("Acme", *a) != dedupe_key("Acme", *b)


def test_the_same_job_from_two_sites_still_shares_a_key():
    assert dedupe_key("Acme Inc", "Data Analyst", "Toronto, Ontario, Canada") == dedupe_key("Acme", "Data Analyst", "Toronto, ON")
    assert dedupe_key("Acme", "Software Developer", "Toronto") == dedupe_key("Acme", "Software Engineer", "Toronto")


def test_senior_and_regular_postings_are_both_kept(conn):
    profile = set_profile(conn)
    n = store.add_postings(conn, [posting(key="1", title="Senior Data Analyst"), posting(key="2", title="Data Analyst")], profile)
    assert n == 2


# --- a database hiccup must not move the sync window --------------------------------------

class OneMessage:
    def __init__(self, msgs):
        self.msgs = msgs

    def fetch(self, since, seen):
        return self.msgs


def test_database_error_keeps_the_old_sync_window(conn, monkeypatch):
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    with conn:
        conn.execute("UPDATE accounts SET last_sync = '2026-10-01T00:00:00Z' WHERE id = ?", (acct,))
    account = conn.execute("SELECT * FROM accounts").fetchone()
    monkeypatch.setattr(db, "create_application", lambda *a, **k: (_ for _ in ()).throw(sqlite3.OperationalError("database is locked")))
    counts = sync_account(conn, account, get_provider=lambda n, a: OneMessage([mk_pipeline("1", "Thank you for applying to Acme")]))
    assert counts == {"retry": 1}
    row = conn.execute("SELECT last_sync, last_error FROM accounts").fetchone()
    assert row["last_sync"] == "2026-10-01T00:00:00Z" and "retried" in row["last_error"]


# --- one bad source must not stop the rest ------------------------------------------------

def test_a_broken_company_source_is_recorded_not_raised(conn):
    set_profile(conn)
    with conn:
        conn.execute("INSERT INTO job_sources (kind, name, config) VALUES ('feed', 'Bad', 'not json')")
        conn.execute("INSERT INTO job_sources (kind, name, config) VALUES ('feed', 'Worse', '{}')")
    result = run_discovery(conn, force=True, get=lambda *a, **k: None, toast=lambda *a: None)
    assert result["feeds"] == 0
    errors = [r["last_error"] for r in conn.execute("SELECT last_error FROM job_sources")]
    assert all(errors)


# --- links survive merging and deleting applications ------------------------------------

def make_client(tmp_path):
    path = tmp_path / "t.db"
    conn = db.connect(path)
    return conn, TestClient(create_app(path), base_url="http://127.0.0.1:8765", follow_redirects=False)


def test_merge_and_delete_keep_job_postings_consistent(tmp_path):
    conn, client = make_client(tmp_path)
    profile = set_profile(conn)
    store.add_postings(conn, [posting(key="1"), posting(key="2", title="Data Analyst II")], profile)
    conn.commit()
    a, b = (store.mark_applied(conn, 1), store.mark_applied(conn, 2))
    conn.commit()
    assert client.post(f"/app/{a}/merge", data={"into": b}).status_code == 303
    assert [r[0] for r in conn.execute("SELECT application_id FROM job_postings ORDER BY id")] == [b, b]
    assert client.post(f"/app/{b}/delete").status_code == 303
    rows = conn.execute("SELECT status, application_id FROM job_postings").fetchall()
    assert all(r["status"] == "seen" and r["application_id"] is None for r in rows)


# --- only the real sites' alert emails are swallowed --------------------------------------

@pytest.mark.parametrize("sender", ["jobs@evil-indeed.com", "jobs@notlinkedin.com"])
def test_lookalike_domains_are_not_alerts(sender):
    assert alerts.alert_site(mail("New jobs for data analyst", sender=f"Alerts <{sender}>")) is None


def test_real_domains_and_subdomains_still_are(tmp_path):
    assert alerts.alert_site(mail("2 new data analyst jobs in Toronto", sender="Indeed <alert@indeed.com>")) == "indeed"
    assert alerts.alert_site(mail("New jobs for you", sender="LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>")) == "linkedin"
    assert alerts.alert_site(mail("New jobs for you", sender="Indeed <alert@mail.indeed.com>")) == "indeed"


def test_an_indeed_status_email_mentioning_hiring_is_not_an_alert():
    assert alerts.alert_site(mail("Acme is hiring - your application was received", sender="Indeed <noreply@indeed.com>")) is None


# --- the tab count agrees with the list ------------------------------------------------

def test_new_count_matches_what_the_list_shows(conn):
    profile = set_profile(conn)
    store.add_postings(conn, [posting(key="1", description="SQL Python Tableau"),
                              posting(key="2", title="Chef", company="Cafe", location="Calgary")], profile)
    shown = store.list_postings(conn, "new", profile["min_score"])
    assert store.counts(conn)["new"] == len(shown) == store.unseen_matches(conn) == 1
    assert store.counts(conn)["all"] == 2


# --- the sign-in task has no console -----------------------------------------------------

def test_serve_survives_having_no_stdout_or_stderr(monkeypatch):
    import sys

    from jobtracker import cli

    seen = {}
    import uvicorn

    monkeypatch.setattr(uvicorn, "run", lambda app, **kw: seen.update(kw))
    monkeypatch.setattr(sys, "stdout", None)
    monkeypatch.setattr(sys, "stderr", None)
    assert cli.main(["serve"]) == 0
    assert seen["log_config"] is None
