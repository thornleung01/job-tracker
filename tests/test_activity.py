from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from jobtracker import activity, db, stats
from jobtracker.activity import ActivityError
from jobtracker.sync import process_messages
from jobtracker.web import create_app
from tests.helpers import mk

NOW = lambda: datetime.now(timezone.utc)  # noqa: E731


def days_ago(n: int) -> datetime:
    return NOW() - timedelta(days=n)


def day(n: int) -> str:
    return (activity.today() - timedelta(days=n)).isoformat()


def make_app(conn, stage="Applied", applied_days_ago=10, stage_days_ago=None, company="Acme"):
    applied = db.iso(days_ago(applied_days_ago))
    app_id = db.create_application(conn, company, company.lower(), "Analyst", "analyst", stage, applied)
    if stage_days_ago is not None:
        conn.execute("UPDATE applications SET stage_at = ? WHERE id = ?", (db.iso(days_ago(stage_days_ago)), app_id))
    conn.commit()
    return app_id


def app_row(conn, app_id):
    return conn.execute("SELECT * FROM applications WHERE id = ?", (app_id,)).fetchone()


@pytest.fixture
def conn():
    c = db.connect(":memory:")
    yield c
    c.close()


# --- notes ---------------------------------------------------------------------

def test_add_note_and_validation(conn):
    a = make_app(conn)
    for bad in ("", "   \n ", None):
        with pytest.raises(ActivityError, match="Write a note"):
            activity.add_note(conn, a, bad)
    with pytest.raises(ActivityError, match="2000"):
        activity.add_note(conn, a, "x" * 2001)
    before = app_row(conn, a)["last_activity"]
    activity.add_note(conn, a, "  Spoke to Sam, send CV Friday  ")
    row = conn.execute("SELECT * FROM activity").fetchone()
    assert (row["kind"], row["body"]) == ("note", "Spoke to Sam, send CV Friday")
    assert app_row(conn, a)["last_activity"] > before


def test_missing_application_raises_lookup_error(conn):
    with pytest.raises(LookupError):
        activity.add_note(conn, 999, "hi")
    with pytest.raises(LookupError):
        activity.add_step(conn, 999, "Interview")


# --- steps: validation ---------------------------------------------------------

def test_step_validation(conn):
    a = make_app(conn)
    for bad in ("   ", "", None, "Coffee chat", "x" * 61, "Interview; DROP TABLE activity"):
        with pytest.raises(ActivityError, match="Choose a step from the list"):
            activity.add_step(conn, a, bad)
    with pytest.raises(ActivityError, match="year-month-day"):
        activity.add_step(conn, a, "Phone screen", "21/10/2026")
    with pytest.raises(ActivityError, match="future"):
        activity.add_step(conn, a, "Phone screen", (activity.today() + timedelta(days=1)).isoformat())
    assert conn.execute("SELECT COUNT(*) FROM activity").fetchone()[0] == 0  # nothing half-saved


# --- steps: stage rules --------------------------------------------------------

def test_stage_step_moves_forward_without_locking(conn):
    a = make_app(conn)
    assert activity.add_step(conn, a, "  interview ", day(3)) is True
    row = app_row(conn, a)
    assert (row["stage"], row["locked"]) == ("Interview", 0)
    assert row["stage_at"].startswith(day(3))
    assert row["last_activity"].startswith(day(3))
    assert conn.execute("SELECT label FROM activity").fetchone()[0] == "Interview"  # canonical casing


def test_stage_step_can_move_backwards_when_newer(conn):
    a = make_app(conn, stage="Rejected", stage_days_ago=5)
    assert activity.add_step(conn, a, "Interview", day(0), "Rejection was a mistake") is True
    assert app_row(conn, a)["stage"] == "Interview"


def test_older_date_is_history_only(conn):
    a = make_app(conn, stage="Interview", stage_days_ago=2)
    assert activity.add_step(conn, a, "Heard back", day(8)) is False
    assert app_row(conn, a)["stage"] == "Interview"
    assert conn.execute("SELECT COUNT(*) FROM activity").fetchone()[0] == 1


def test_applied_step_backfills_applied_date(conn):
    a = make_app(conn, applied_days_ago=3)
    activity.add_step(conn, a, "Applied", day(9))
    assert app_row(conn, a)["applied_at"].startswith(day(9))


def test_custom_label_keeps_stage_but_counts_as_activity(conn):
    a = make_app(conn)
    assert activity.add_step(conn, a, "Phone   screen", day(1), "30 min with Sam") is False
    row = app_row(conn, a)
    assert row["stage"] == "Applied" and row["last_activity"].startswith(day(1))
    step = conn.execute("SELECT * FROM activity").fetchone()
    assert (step["label"], step["body"]) == ("Phone screen", "30 min with Sam")  # whitespace tidied


def test_only_preset_steps_can_be_logged(conn):
    a = make_app(conn)
    every = [s for _group, steps in activity.STEP_GROUPS for s in steps]
    assert every[:6] == db.STAGES and len(every) == len(set(every))        # six stages first, no duplicates
    for label in every:
        activity.add_step(conn, a, label.upper(), day(1))                  # matching ignores capitals
    logged = [r["label"] for r in conn.execute("SELECT label FROM activity ORDER BY id")]
    assert logged == every                                                 # stored with the canonical wording


def test_presets_cover_the_common_search_steps(conn):
    other = dict(activity.STEP_GROUPS)["Other steps"]
    for expected in ("Recruiter call", "Phone screen", "Take-home assignment", "Technical interview", "Final round",
                     "Reference check", "Follow-up sent", "Offer negotiation", "Withdrew application"):
        assert expected in other


def test_later_email_can_still_move_a_step_logged_stage_forward(conn):
    a = make_app(conn)
    activity.add_step(conn, a, "Heard back", day(0))
    changed = db.apply_event(conn, a, "interview", db.iso(NOW() + timedelta(hours=1)))
    assert changed and app_row(conn, a)["stage"] == "Interview"


# --- delete / history ----------------------------------------------------------

def test_delete_keeps_the_stage_change(conn):
    a = make_app(conn)
    activity.add_step(conn, a, "Interview", day(1))
    step_id = conn.execute("SELECT id FROM activity").fetchone()[0]
    assert activity.delete(conn, a, step_id) is True
    assert app_row(conn, a)["stage"] == "Interview"
    assert activity.delete(conn, a, step_id) is False
    other = make_app(conn, company="Initech")
    activity.add_note(conn, other, "mine")
    note_id = conn.execute("SELECT id FROM activity").fetchone()[0]
    assert activity.delete(conn, a, note_id) is False  # can't delete another application's entry


def test_history_merges_emails_newest_first_with_limit(conn):
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    process_messages(conn, acct, [mk("e1", "Thank you for applying to Acme", day=1)])
    a = conn.execute("SELECT id FROM applications").fetchone()[0]
    activity.add_note(conn, a, "latest note")
    entries, total = activity.history(conn, a)
    assert [e["kind"] for e in entries] == ["note", "email"] and total == 2
    assert entries[1]["title"] == "Thank you for applying to Acme" and entries[1]["detail"] == "applied"
    only, total = activity.history(conn, a, include_emails=False)
    assert [e["kind"] for e in only] == ["note"] and total == 1
    for i in range(5):
        activity.add_note(conn, a, f"n{i}")
    entries, total = activity.history(conn, a, limit=3)
    assert len(entries) == 3 and total == 7


# --- flow chart ----------------------------------------------------------------

def test_logged_stage_step_shows_in_flow_but_custom_label_does_not(conn):
    a = make_app(conn)
    activity.add_step(conn, a, "Phone screen", day(2))
    assert {n["id"] for n in stats.sankey(conn)["nodes"]} == {"Applied", "No response yet"}
    activity.add_step(conn, a, "Interview", day(1))
    nodes = {n["id"] for n in stats.sankey(conn)["nodes"]}
    assert {"Heard back", "Interview"} <= nodes


# --- web -----------------------------------------------------------------------

@pytest.fixture
def env(tmp_path):
    path = tmp_path / "t.db"
    conn = db.connect(path)
    app_id = make_app(conn)
    conn.commit()
    client = TestClient(create_app(path), base_url="http://127.0.0.1:8765", follow_redirects=False)
    yield conn, app_id, client
    conn.close()


PANEL = {"X-Panel": "1"}


def test_panel_fragment_is_not_a_full_page_and_escapes_notes(env):
    conn, a, client = env
    activity.add_note(conn, a, "<script>alert(1)</script> & more")
    html = client.get(f"/app/{a}/panel").text
    assert "<html" not in html and "Log a step" in html
    assert "<script>alert(1)</script>" not in html and "&lt;script&gt;alert(1)&lt;/script&gt; &amp; more" in html


def test_there_is_no_separate_add_a_note_box_any_more(env):
    conn, a, client = env
    html = client.get(f"/app/{a}/panel").text
    assert "Add a note" not in html and "Add note" not in html and f'action="/app/{a}/note"' not in html
    assert html.count("<textarea") == 1 and "Note (optional)" in html      # a note goes with a step
    assert client.post(f"/app/{a}/note", data={"body": "x"}).status_code in (404, 405)   # the route is gone too
    assert "Log a step above, with a note if you like." in html


def test_step_with_a_note_in_page_returns_fragment_with_swaps(env):
    conn, a, client = env
    r = client.post(f"/app/{a}/step", data={"label": "Phone screen", "day": day(0), "body": "Call back Monday"}, headers=PANEL)
    assert r.status_code == 200 and "Step logged." in r.text and "Call back Monday" in r.text
    assert f'data-swap-target="stage-{a}"' in r.text and f'data-swap-target="last-{a}"' in r.text
    assert r.text.count("data-swap-target=\"count-") == 6


def test_step_in_page_updates_stage_cell_and_counts(env):
    conn, a, client = env
    r = client.post(f"/app/{a}/step", data={"label": "interview", "day": day(0), "body": "Zoom with Sam"}, headers=PANEL)
    assert r.status_code == 200 and "The stage was updated." in r.text
    cell = r.text.split(f'data-swap-target="stage-{a}"')[1].split("</div>")[0]
    assert "Interview" in cell
    assert 'data-swap-target="count-Interview">1<' in r.text and 'data-swap-target="count-Applied">0<' in r.text
    assert "Zoom with Sam" in r.text


def test_plain_post_redirects_to_detail_page(env):
    conn, a, client = env
    r = client.post(f"/app/{a}/step", data={"label": "Phone screen", "day": day(0), "body": "hello"})
    assert r.status_code == 303 and r.headers["location"] == f"/app/{a}"
    assert conn.execute("SELECT COUNT(*) FROM activity").fetchone()[0] == 1


def test_validation_error_in_page_keeps_what_you_typed(env):
    _, a, client = env
    r = client.post(f"/app/{a}/step", data={"label": "Phone screen", "day": "nope", "body": "keep this"}, headers=PANEL)
    assert r.status_code == 200 and "year-month-day" in r.text and "keep this" in r.text
    assert '<option value="Phone screen" selected>' in r.text      # the dropdown keeps your choice too
    assert "data-swap-target" not in r.text  # nothing changed, so nothing to refresh


def test_step_field_is_a_dropdown_of_presets_not_free_text(env):
    _, a, client = env
    html = client.get(f"/app/{a}/panel").text
    assert f'<select id="step-label-{a}" name="label" required' in html
    assert "<datalist" not in html and f'<input id="step-label-{a}"' not in html
    assert '<option value="" hidden>Choose a step</option>' in html          # a prompt, not a pickable row
    assert '<optgroup label="Moves the application to a stage">' in html and '<optgroup label="Other steps">' in html
    for preset in ("Interview", "Rejected", "Phone screen", "Take-home assignment", "Withdrew application"):
        assert f'<option value="{preset}"' in html
    assert "Other steps only go in the history." not in html          # the group labels already say which steps move the application


def test_forged_or_free_text_step_is_refused_and_nothing_is_saved(env):
    conn, a, client = env
    r = client.post(f"/app/{a}/step", data={"label": "Coffee with the CEO", "day": day(0)}, headers=PANEL)
    assert r.status_code == 200 and "Choose a step from the list." in r.text
    assert conn.execute("SELECT COUNT(*) FROM activity").fetchone()[0] == 0
    r = client.post(f"/app/{a}/step", data={"label": "", "day": day(0)})           # no JavaScript, empty choice
    assert r.status_code == 303 and "error=" in r.headers["location"]


def test_old_free_text_steps_still_show_in_history(env):
    conn, a, client = env
    conn.execute("INSERT INTO activity (application_id, kind, label, body, occurred_at, created_at) "
                 "VALUES (?, 'step', 'Coffee chat', '', '2026-10-01T12:00:00Z', '2026-10-01T12:00:00Z')", (a,))
    conn.commit()
    assert "Coffee chat" in client.get(f"/app/{a}/panel").text


def test_validation_error_without_js_shows_on_detail_page(env):
    _, a, client = env
    r = client.post(f"/app/{a}/step", data={"label": "", "day": day(0)})
    assert r.status_code == 303 and "error=" in r.headers["location"]
    assert "Choose a step from the list." in client.get(r.headers["location"]).text


def test_delete_activity_in_page(env):
    conn, a, client = env
    activity.add_note(conn, a, "temp")
    aid = conn.execute("SELECT id FROM activity").fetchone()[0]
    r = client.post(f"/app/{a}/activity/{aid}/delete", headers=PANEL)
    assert r.status_code == 200 and "Entry deleted." in r.text and "temp" not in r.text
    assert conn.execute("SELECT COUNT(*) FROM activity").fetchone()[0] == 0


def test_unknown_application_is_404(env):
    _, _, client = env
    assert client.post("/app/999/step", data={"label": "Phone screen"}).status_code == 404
    assert client.get("/app/999/panel").status_code == 404


def test_new_routes_reject_foreign_origin(env):
    _, a, client = env
    for path, data in ((f"/app/{a}/step", {"label": "x"}), (f"/app/{a}/activity/1/delete", {})):
        assert client.post(path, data=data, headers={"origin": "https://evil.example.com"}).status_code == 403


def test_list_rows_are_expanders_with_a_page_fallback(env):
    conn, a, client = env
    html = client.get("/").text
    assert f'aria-controls="panel-{a}"' in html and 'aria-expanded="false"' in html
    assert f'id="panel-{a}" hidden' in html and f'href="/app/{a}"' in html and "Open page" in html
    assert f'href="/?open={a}"' in html  # works without JavaScript


def test_open_param_renders_rows_expanded_and_closes_on_second_click(env):
    conn, a, client = env
    b = make_app(conn, company="Initech")
    html = client.get(f"/?open={a}").text
    assert 'aria-expanded="true"' in html and f'id="panel-{a}" hidden' not in html and f'id="panel-{b}" hidden' in html
    assert "Log a step" in html
    assert f'href="/?open={a}%2C{b}"' in html or f'href="/?open={a},{b}"' in html  # opens the other too
    assert 'class="expander" href="/"' in html  # the open row's link closes it
    assert client.get("/?open=abc,,999").status_code == 200  # junk is ignored


def test_filters_survive_in_expander_links(env):
    _, a, client = env
    assert f'href="/?stage=Applied&amp;open={a}"' in client.get("/?stage=Applied").text


def test_detail_page_has_notes_and_steps_panel(env):
    conn, a, client = env
    activity.add_note(conn, a, "remember this")
    html = client.get(f"/app/{a}").text
    assert "Notes and steps" in html and "remember this" in html and "Email timeline" in html


def test_merge_moves_notes_and_delete_removes_them(env):
    conn, a, client = env
    b = make_app(conn, company="Acme Inc")
    activity.add_note(conn, a, "on a")
    activity.add_note(conn, b, "on b")
    client.post(f"/app/{a}/merge", data={"into": b})
    assert {r["body"] for r in conn.execute("SELECT body FROM activity WHERE application_id = ?", (b,))} == {"on a", "on b"}
    client.post(f"/app/{b}/delete")
    assert conn.execute("SELECT COUNT(*) FROM activity").fetchone()[0] == 0


def test_existing_database_gets_the_new_table(tmp_path):
    import sqlite3
    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript("CREATE TABLE applications (id INTEGER PRIMARY KEY, company TEXT NOT NULL, company_key TEXT NOT NULL,"
                      " role TEXT NOT NULL, role_key TEXT NOT NULL, stage TEXT NOT NULL, stage_at TEXT, applied_at TEXT,"
                      " last_activity TEXT, locked INTEGER NOT NULL DEFAULT 0, manual INTEGER NOT NULL DEFAULT 0);")
    old.commit(); old.close()
    c = db.connect(path)
    assert c.execute("SELECT name FROM sqlite_master WHERE name = 'activity'").fetchone()
    c.close()
