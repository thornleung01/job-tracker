"""The command line, run against a temporary database."""
import os

import pytest
import uvicorn

from jobtracker import cli, db
from jobtracker.providers.base import NotConnected
from tests.helpers import mk


@pytest.fixture
def home(tmp_path, monkeypatch):
    path = tmp_path / "data" / "tracker.db"
    monkeypatch.setattr(db, "DEFAULT_PATH", path)
    return path


class Provider:
    def __init__(self, messages=()):
        self.messages = list(messages)

    def fetch(self, since, skip):
        yield from (m for m in self.messages if not skip(m.id))


def test_profiles_and_status_list_what_is_there(home, capsys):
    conn = db.connect(home)
    db.upsert_account(conn, "gmail", "me@gmail.com")
    conn.commit()
    assert cli.main(["profiles"]) == 0 and cli.main(["status"]) == 0
    out = capsys.readouterr().out
    assert "default  Me" in out and "gmail:me@gmail.com" in out and "last sync: never" in out


def test_an_unknown_profile_is_refused_with_the_known_ones(home, capsys):
    assert cli.main(["--profile", "nobody", "status"]) == 2
    assert "No profile called 'nobody'" in capsys.readouterr().out


def test_sync_runs_every_account_and_reports_each(home, monkeypatch, capsys):
    conn = db.connect(home)
    db.upsert_account(conn, "gmail", "me@gmail.com")
    conn.commit()
    monkeypatch.setattr(cli, "get_provider", lambda name, address, profile="default": Provider([mk("1", "Thank you for applying to Acme")]))
    monkeypatch.setattr(cli, "_discover", lambda *a, **k: "no jobs")
    assert cli.main(["sync"]) == 0
    assert "gmail:me@gmail.com: {'applied-to-application': 1}" in capsys.readouterr().out
    assert db.connect(home).execute("SELECT COUNT(*) FROM applications").fetchone()[0] == 1


def test_a_failed_sync_exits_with_1(home, monkeypatch, capsys):
    conn = db.connect(home)
    db.upsert_account(conn, "gmail", "me@gmail.com")
    conn.commit()

    def broken(name, address, profile="default"):
        raise NotConnected("Gmail account me@gmail.com isn't connected.")
    monkeypatch.setattr(cli, "get_provider", broken)
    monkeypatch.setattr(cli, "_discover", lambda *a, **k: "no jobs")
    assert cli.main(["sync"]) == 1
    assert "error: Gmail account me@gmail.com isn't connected." in capsys.readouterr().out


@pytest.mark.parametrize("error,shown", [(NotConnected("Gmail isn't set up yet."), "Gmail isn't set up yet."),
                                         (TimeoutError("login window closed"), "Couldn't log in to gmail: login window closed")])
def test_a_failed_login_prints_a_sentence_and_exits_1(home, monkeypatch, capsys, error, shown):
    class Failing:
        def connect(self):
            raise error
    monkeypatch.setattr(cli, "get_provider", lambda *a, **k: Failing())
    assert cli.main(["connect", "gmail"]) == 1
    assert shown in capsys.readouterr().err


def test_a_good_login_adds_the_account(home, monkeypatch, capsys):
    class Good:
        def connect(self):
            return "me@gmail.com"
    monkeypatch.setattr(cli, "get_provider", lambda *a, **k: Good())
    assert cli.main(["connect", "gmail"]) == 0
    assert db.connect(home).execute("SELECT address FROM accounts").fetchone()[0] == "me@gmail.com"


def test_serve_tells_the_pop_ups_which_port_it_is_on(home, monkeypatch):
    monkeypatch.setenv("JOBTRACKER_PORT", "8765")       # put back after the test
    monkeypatch.setattr(uvicorn, "run", lambda app, **kw: None)
    assert cli.main(["serve", "--port", "9123"]) == 0
    assert os.environ["JOBTRACKER_PORT"] == "9123"
    from jobtracker.jobs.notify import jobs_url
    assert jobs_url() == "http://127.0.0.1:9123/jobs"


def test_a_command_is_required():
    with pytest.raises(SystemExit):
        cli.main([])
