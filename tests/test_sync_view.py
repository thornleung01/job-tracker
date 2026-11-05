"""The sync progress sentence and time estimate shown while a sync runs (a pure function of the run's state)."""
import pytest

from jobtracker.routes import runs
from jobtracker.routes.runs import SyncRun, SyncRuns, _eta_text, sync_view


@pytest.mark.parametrize("seconds, text", [
    (None, "Estimating time left…"),
    (0, "Less than a minute left"),
    (44.9, "Less than a minute left"),
    (45, "About 1 minute left"),
    (89.9, "About 1 minute left"),
    (90, "About 2 minutes left"),
    (600, "About 10 minutes left"),
    (3599, "About 60 minutes left"),
    (3600, "About 1 hour 0 minutes left"),
    (3660, "About 1 hour 1 minute left"),
    (7260, "About 2 hours 1 minute left"),
    (9000, "About 2 hours 30 minutes left"),
])
def test_the_time_left_reads_as_a_short_sentence(seconds, text):
    assert _eta_text(seconds) == text


def test_finding_emails_shows_no_bar_and_no_estimate():
    view = sync_view(SyncRun(account="me@gmail.com"))
    assert view == {"running": True, "label": "me@gmail.com · Finding your emails…", "percent": None, "eta": "", "note": ""}


def test_reading_shows_the_count_the_percent_and_waits_for_three_emails_before_estimating():
    run = SyncRun(phase="reading", done=2, total=10, account="me@gmail.com", t0=100.0, first_done=0)
    view = sync_view(run)
    assert view["label"] == "me@gmail.com · Reading emails: 2 of 10"
    assert view["percent"] == 20
    assert view["eta"] == "Estimating time left…"


def test_the_estimate_comes_from_the_pace_since_this_account_started(monkeypatch):
    monkeypatch.setattr(runs.time, "monotonic", lambda: 160.0)
    # 60 s for 6 emails (not counting the 4 that were already read): 10 s each, 10 left, so 100 s.
    run = SyncRun(phase="reading", done=10, total=20, t0=100.0, first_done=4)
    assert sync_view(run)["eta"] == "About 2 minutes left"


def test_an_unknown_total_counts_up_and_a_finished_read_stops_at_100_percent():
    assert sync_view(SyncRun(phase="reading", done=7, total=None))["label"] == "Reading emails: 7 so far"
    assert sync_view(SyncRun(phase="reading", done=7, total=None))["percent"] is None
    assert sync_view(SyncRun(phase="reading", done=12, total=10))["percent"] == 100


def test_the_jobs_step_has_its_own_label():
    assert sync_view(SyncRun(phase="jobs", account="me@gmail.com"))["label"] == "Looking for new jobs…"


def test_a_new_account_starts_its_own_clock():
    run = SyncRun()
    run.update(phase="reading", total=10, done=3, account="a@x.com")
    first = run.t0
    assert first is not None and run.first_done == 3
    run.update(done=5)
    assert run.t0 == first                       # same account: the clock keeps running
    run.update(account="b@x.com")
    assert (run.t0, run.first_done) == (None, 0)


def test_only_one_sync_per_profile_and_the_result_is_shown_once():
    store = SyncRuns()
    assert store.start("default") is True
    assert store.start("default") is False
    assert store.start("other") is True
    progress, notice, error = store.progress_or_result("default", flash_shown=False)
    assert progress and progress["running"] and notice is None and error is None
    store.finish("default", "Synced 3 new emails.", failed=False)
    assert store.progress_or_result("default", flash_shown=True) == (None, None, None)      # the page already has a message: keep ours for later
    assert store.progress_or_result("default", flash_shown=False) == (None, "Synced 3 new emails.", None)
    assert store.progress_or_result("default", flash_shown=False) == (None, None, None)     # shown once
    assert store.start("default") is True                                                    # and a new run can start


def test_a_failed_run_is_an_error_not_a_notice():
    store = SyncRuns()
    store.start("p")
    store.finish("p", "Couldn't reach Gmail.", failed=True)
    assert store.progress_or_result("p", flash_shown=False) == (None, None, "Couldn't reach Gmail.")
