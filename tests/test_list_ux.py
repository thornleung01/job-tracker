import re
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from jobtracker import db
from jobtracker.web import create_app


def ago(days: int) -> str:
    return db.iso(datetime.now(timezone.utc) - timedelta(days=days))


def add(conn, company, role="Analyst", stage="Applied", applied_days_ago=10, last_days_ago=5, emails=0):
    """applied_days_ago=None makes an application whose applied date is unknown."""
    app_id = db.create_application(conn, company, company.lower(), role, role.lower(), stage, ago(applied_days_ago or 0))
    conn.execute("UPDATE applications SET last_activity = ?, applied_at = ? WHERE id = ?",
                 (ago(last_days_ago), None if applied_days_ago is None else ago(applied_days_ago), app_id))
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    for i in range(emails):
        conn.execute("INSERT INTO emails (account_id, provider_msg_id, received_at, related, application_id) VALUES (?, ?, ?, 1, ?)",
                     (acct, f"{company}-{i}", ago(0), app_id))
    conn.commit()
    return app_id


@pytest.fixture
def env(tmp_path):
    path = tmp_path / "t.db"
    conn = db.connect(path)
    add(conn, "Zeta", role="Backend", stage="Interview", applied_days_ago=30, last_days_ago=1, emails=3)
    add(conn, "alpha", role="Data", stage="Rejected", applied_days_ago=20, last_days_ago=9, emails=1)
    add(conn, "Mid", role="Analyst", stage="Applied", applied_days_ago=None, last_days_ago=5, emails=2)
    client = TestClient(create_app(path), base_url="http://127.0.0.1:8765")
    yield conn, client
    conn.close()


def order(html):
    """Companies in the order they appear in the list."""
    return re.findall(r'class="expander"[^>]*><span class="chev" aria-hidden="true"></span><strong>([^<]+)</strong>', html)


def test_default_order_is_latest_activity_first(env):
    _, client = env
    html = client.get("/").text
    assert order(html) == ["Zeta", "Mid", "alpha"]
    states = re.findall(r'<th scope="col" role="columnheader" data-col="\w+" aria-sort="(\w+)"', html)
    assert states == ["none", "none", "none", "none", "descending"]   # company, role, stage, applied, last activity


@pytest.mark.parametrize("query,expected", [
    ("sort=company&dir=asc", ["alpha", "Mid", "Zeta"]),           # ignores capitalization
    ("sort=company&dir=desc", ["Zeta", "Mid", "alpha"]),
    ("sort=stage&dir=asc", ["Mid", "Zeta", "alpha"]),             # pipeline order: Applied, Interview, Rejected
    ("sort=emails", ["Zeta", "Mid", "alpha"]),                    # most emails first by default
    ("sort=last_activity&dir=asc", ["alpha", "Mid", "Zeta"]),
])
def test_sorting(env, query, expected):
    _, client = env
    assert order(client.get(f"/?{query}").text) == expected


def test_unknown_applied_dates_sort_last_in_both_directions(env):
    _, client = env
    assert order(client.get("/?sort=applied&dir=desc").text)[-1] == "Mid"
    assert order(client.get("/?sort=applied&dir=asc").text)[-1] == "Mid"


def test_bad_sort_values_fall_back_safely(env):
    _, client = env
    r = client.get("/?sort=company;DROP TABLE applications&dir=sideways")
    assert r.status_code == 200 and order(r.text) == ["Zeta", "Mid", "alpha"]
    assert len(order(client.get("/").text)) == 3  # nothing was dropped


def test_header_links_toggle_direction_and_keep_filters(env):
    _, client = env
    html = client.get("/?sort=company&dir=asc&stage=Applied").text
    assert re.findall(r'<th scope="col" role="columnheader" data-col="\w+" aria-sort="(\w+)"', html)[0] == "ascending"
    assert 'href="/?stage=Applied&amp;sort=company&amp;dir=desc"' in html     # the same column flips
    assert 'href="/?stage=Applied&amp;sort=role&amp;dir=asc"' in html         # other columns start fresh
    assert 'href="/?stage=Applied&amp;sort=last_activity&amp;dir=desc"' in html


def test_sort_survives_expanding_a_row_and_filtering(env):
    conn, client = env
    a = conn.execute("SELECT id FROM applications WHERE company = 'Zeta'").fetchone()[0]
    html = client.get("/?sort=company&dir=asc").text
    assert f'href="/?sort=company&amp;dir=asc&amp;open={a}"' in html
    assert '<input type="hidden" name="sort" value="company">' in html and '<input type="hidden" name="dir" value="asc">' in html


def test_every_field_has_a_visible_label(env):
    _, client = env
    html = client.get("/").text
    for field, text in (("f-q", "Search"), ("f-stage", "Stage"), ("add-company", "Company"),
                        ("add-role", "Role (optional)"), ("add-stage", "Stage")):
        assert f'<label for="{field}">{text}</label>' in html and f'id="{field}"' in html
    assert 'aria-label="Search"' not in html  # no placeholder-only inputs


def test_result_line_and_clear_filters(env):
    _, client = env
    plain = client.get("/").text
    assert "Showing 3 applications" in plain and "Clear filters" not in plain
    filtered = client.get("/?stage=Rejected&q=alp").text
    assert "Showing 1 of 3 application" in filtered and "Stage: Rejected" in filtered and "Search: alp" in filtered
    assert re.search(r'href="/"[^>]*>Clear filters</a>', filtered)
    assert "Showing 0 of 3 applications" in client.get("/?q=nothing").text


def test_active_stage_tab_is_marked_and_toggles_off(env):
    _, client = env
    html = client.get("/?stage=Rejected").text
    current = lambda page: re.findall(r'<a [^>]*aria-current="true"', page)  # noqa: E731  (tags, not the CSS selectors)
    assert len(current(html)) == 1
    assert re.search(r'href="/" class="tab" aria-current="true"[^>]*>Rejected', html)   # clicking the active tab clears the filter
    assert 'href="/?stage=Interview" class="tab"' in html
    # With no filter, "All" is the current tab and shows the total.
    plain = client.get("/").text
    assert re.search(r'href="/" class="tab" aria-current="true">All <span class="n">3</span>', plain)
    assert len(current(plain)) == 1


def test_stage_tabs_replace_the_metric_cards(env):
    _, client = env
    html = client.get("/").text
    assert '<nav class="tabs" aria-label="Filter by stage">' in html
    assert 'id="count-Interview">1<' in html and 'id="count-Rejected">1<' in html
    assert "font-size:1.625rem" not in html            # no big-number stat tiles


def test_slow_actions_declare_a_busy_label(env):
    _, client = env
    page = client.get("/settings").text
    assert 'data-busy="Syncing..."' in page                 # sign-in runs in the background now, so only Sync waits
    assert "aria-busy" in page and "pageshow" in page


def test_shared_styles_have_touch_targets_states_and_scalable_type(env):
    _, client = env
    css = client.get("/").text
    assert "--tap: 44px" in css and "(pointer: coarse)" in css and "min-height: var(--tap)" in css
    assert "button:disabled" in css and "font: 400 1rem/1.4" in css and "tabular-nums" not in css   # proportional figures everywhere
    assert "font-size: 16px" in css            # stops iOS zooming into fields on focus
    flow = client.get("/flow").text
    assert 'rel="icon"' in flow and 'name="color-scheme"' in flow
    assert "z-index: 5" not in flow and "var(--z-tip)" in flow


def test_flow_chart_works_on_touch_screens(env):
    _, client = env
    html = client.get("/flow").text
    assert "Swipe sideways" in html
    assert "matchMedia('(max-width: 720px)')" in html and "tip.hidden = true" in html
