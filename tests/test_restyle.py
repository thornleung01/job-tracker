"""The Wealthsimple-style restyle: self-hosted type, accent options, and the craft-floor rules."""
import re

import pytest
from fastapi.testclient import TestClient

from jobtracker import db, settings
from jobtracker.web import create_app
from tests.test_pipeline import mk
from jobtracker.sync import process_messages


@pytest.fixture
def env(tmp_path):
    path = tmp_path / "t.db"
    conn = db.connect(path)
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    process_messages(conn, acct, [mk("1", "Thank you for applying to Acme", thread="A", day=1),
                                  mk("2", "Interview", "Please select a time for your interview.", thread="A", day=4)])
    conn.commit()
    client = TestClient(create_app(path), base_url="http://127.0.0.1:8765")
    yield conn, client
    conn.close()


def test_fonts_are_served_from_the_app_not_a_cdn(env):
    _, client = env
    html = client.get("/").text
    assert 'url("/static/fonts/SourceSerif4-latin-wght.woff2")' in html and 'url("/static/fonts/Figtree-latin-wght.woff2")' in html
    assert "fonts.googleapis.com" not in html and "cdn." not in html and "font-display: swap" in html
    for name in ("SourceSerif4-latin-wght.woff2", "Figtree-latin-wght.woff2"):
        r = client.get(f"/static/fonts/{name}")
        assert r.status_code == 200 and r.content[:4] == b"wOF2"
    assert client.get("/static/fonts/LICENSES.md").status_code == 200


def test_static_files_are_still_local_only(env):
    _, client = env
    assert client.get("/static/fonts/Figtree-latin-wght.woff2", headers={"host": "evil.example.com"}).status_code == 403
    assert client.get("/static/../web.py").status_code in (404, 400)


def test_accent_options_are_the_wealthsimple_set_with_graphite_default():
    assert list(settings.ACCENTS) == ["graphite", "bronze", "forest", "clay"]
    assert settings.DEFAULTS["appearance"]["accent"] == "graphite"
    assert settings.sanitize("appearance", {"accent": "ink"})["accent"] == "graphite"   # a saved removed option falls back


def lum(h):
    r, g, b = (int(h.lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4  # noqa: E731
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def ratio(a, b):
    hi, lo = sorted((lum(a), lum(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


@pytest.mark.parametrize("name", list(settings.ACCENTS))
def test_every_accent_gives_readable_button_text_in_both_themes(name):
    light, dark = settings.ACCENTS[name]
    assert ratio("#fdfdfc", light) >= 4.5    # paper text on the light-theme fill
    assert ratio("#14130f", dark) >= 4.5     # near-black text on the dark-theme fill


def test_warm_tokens_and_pill_controls(env):
    _, client = env
    css = client.get("/").text
    for token in ("--bg: #faf8f5", "--ink: #32302f", "--muted: #686664", "--line: #e4e2e1", "--r-pill: 999px", "--r-lg: 24px"):
        assert token in css
    assert "border-radius: var(--r-pill)" in css and "--bg: #12110e" in css      # dark is warm bronze-black
    assert "box-shadow" not in re.sub(r"/\*.*?\*/", "", css.split("<style>")[1].split("</style>")[0], flags=re.S).replace(
        "box-shadow: none", ""), "no shadows anywhere in the shared styles"


def test_sharp_corners_flatten_every_radius(env):
    _, client = env
    css = client.get("/").text
    assert '[data-corners="sharp"] { --r-pill: 3px; --r-lg: 3px; --r: 3px; }' in css


def test_browser_surfaces_are_themed(env):
    _, client = env
    css = client.get("/").text
    for rule in ("::selection", "caret-color: var(--ink)", "accent-color: var(--ink)", "scrollbar-color", "color-scheme: dark"):
        assert rule in css


def test_notices_have_a_full_border_and_a_drawn_icon_not_a_side_stripe(env):
    _, client = env
    css = client.get("/").text
    assert "border-left: 3px" not in css and ".notice::before" in css and "mask" in css


def test_flow_page_uses_a_sentence_and_drawn_icons_not_glyphs(env):
    _, client = env
    html = client.get("/flow").text
    assert 'class="lede"' in html and "Of <strong>1</strong> application, " in html
    assert 'class="stats"' not in html
    assert "✓" not in html and "✕" not in html and "class: 'ico'" in html
    plural = "".join(re.findall(r'<p class="lede">.*?</p>', html, flags=re.S))
    assert "led to an offer" in plural or "led to offers" in plural and "were rejected" in plural or "was rejected" in plural


def test_open_panel_cell_has_no_table_padding_so_it_cannot_overflow_the_card(env):
    conn, client = env
    css = client.get("/").text
    # Higher specificity than table.list td:last-child, so the panel supplies the only padding.
    assert "table.list tr.panel-row > td { padding: 0; }" in css
    assert "@supports (width: 1cqw) { .list-card .panel-inner { position: sticky; left: 0; width: 100cqw; } }" in css


def test_detail_page_has_one_inset_and_clear_heading_levels(env):
    conn, client = env
    a = conn.execute("SELECT id FROM applications").fetchone()[0]
    html = client.get(f"/app/{a}").text
    assert ".card:not(.list-card) .panel-inner { padding: 0; }" in html
    assert '<h2 id="h-notes" class="section">Notes and steps</h2>' in html
    assert '<h2 class="section spaced">Email timeline ' in html and "newest first" in html
    assert "font-size:17px" not in html
    assert "h2.section { font-size: 1.625rem" in html and ".panel-h { font: 500 1.125rem" in html   # section outranks sub-heading


def test_back_link_and_disclosures_use_the_drawn_chevron_not_glyphs(env):
    conn, client = env
    a = conn.execute("SELECT id FROM applications").fetchone()[0]
    detail = client.get(f"/app/{a}").text
    assert '<a class="back" href="/"><span class="chev" aria-hidden="true"></span>All applications</a>' in detail
    assert "←" not in detail
    for page in ("/", "/flow"):
        assert 'summary class="disclosure"' in client.get(page).text
    assert "summary.disclosure::-webkit-details-marker { display: none; }" in detail


def test_phone_layout_keeps_company_stage_and_last_activity(env):
    _, client = env
    html = client.get("/").text
    assert 'data-col="role"' in html and 'data-col="applied"' in html
    assert re.search(r'<span class="role-sub">[^<]+</span>', html)      # role moves under the company name on a phone


def test_phone_rows_stack_instead_of_scrolling_and_stay_a_table_for_screen_readers(env):
    _, client = env
    html = client.get("/").text
    # The phone layout turns table parts into blocks, so explicit roles must keep the semantics.
    assert '<table class="list" role="table">' in html and '<thead role="rowgroup"><tr role="row">' in html
    assert '<tbody role="rowgroup">' in html and 'class="app-row" role="row"' in html and '<td role="cell" data-col="company">' in html
    assert 'role="columnheader"' in html
    for rule in (".list-card table.list tr.app-row { display: grid; grid-template-columns: 1fr auto;",
                 '.list-card table.list tr.app-row > td[data-col="last_activity"] { grid-column: 1 / -1; padding-left: 20px;',
                 ".list-card table.list tr.panel-row[hidden] { display: none; }"):   # block display would otherwise un-hide closed panels
        assert rule in html
    # Scoped to the application list: the Settings accounts table must stay an ordinary table.
    assert "\n    table.list, table.list tbody" not in html
    # The hide rule must out-rank the stacking rule that sets every row cell to display: block.
    assert '.list-card table.list th[data-col="role"], .list-card table.list tr.app-row > td[data-col="role"]' in html


def test_phone_sort_buttons_meet_the_tap_size_and_show_the_active_column(env):
    _, client = env
    css = client.get("/").text
    assert "background: var(--fog); min-height: var(--tap); font-weight: 500; }" in css
    assert '.list-card table.list th[aria-sort="ascending"] a.sort, .list-card table.list th[aria-sort="descending"] a.sort { background: var(--accent); color: var(--accent-ink); }' in css


def test_last_activity_shows_just_days(env):
    conn, client = env
    cell = lambda page: re.search(r'<td role="cell" data-col="last_activity"[^>]*>(.*?)</td>', page, flags=re.S).group(1)  # noqa: E731
    html = client.get("/").text
    # The fixture's mail is a few weeks old: the cell says "N days ago" and nothing else.
    text = re.sub(r"<[^>]+>", "", cell(html)).strip()
    assert re.fullmatch(r"\d+ days ago", text), text
    assert "2026-" not in text and "," not in text                       # no date, no "12d ago" suffix
    assert re.search(r'<time datetime="\d{4}-\d{2}-\d{2}" title="\d{4}-\d{2}-\d{2}">', cell(html))   # exact date stays on hover


@pytest.mark.parametrize("days,expected", [(0, "Today"), (1, "1 day ago"), (2, "2 days ago"), (37, "37 days ago")])
def test_days_wording(tmp_path, days, expected):
    from datetime import datetime, timedelta, timezone
    path = tmp_path / "d.db"
    conn = db.connect(path)
    when = db.iso(datetime.now(timezone.utc) - timedelta(days=days, minutes=5))
    a = db.create_application(conn, "Acme", "acme", "Analyst", "analyst", "Rejected", when)   # even a closed application shows days
    conn.execute("UPDATE applications SET last_activity = ? WHERE id = ?", (when, a)); conn.commit()
    client = TestClient(create_app(path), base_url="http://127.0.0.1:8765")
    cell = re.search(r'<td role="cell" data-col="last_activity"[^>]*>(.*?)</td>', client.get("/").text, flags=re.S).group(1)
    assert re.sub(r"<[^>]+>", "", cell).strip() == expected
    conn.close()


def test_search_suggests_what_you_actually_have(env):
    conn, client = env
    db.create_application(conn, "Globex", "globex", "Data Engineer", "dataengineer", "Applied", db.iso(__import__("datetime").datetime.now(__import__("datetime").timezone.utc)))
    conn.commit()
    html = client.get("/").text
    assert 'role="combobox"' in html and 'aria-controls="f-q-list"' in html and 'role="listbox"' in html and 'autocomplete="off"' in html
    data = __import__("json").loads(re.search(r'id="suggest-data">(.*?)</script>', html, flags=re.S).group(1))
    companies = {d["text"] for d in data if d["kind"] == "Company"}
    roles = {d["text"] for d in data if d["kind"] == "Role"}
    assert {"Acme", "Globex"} <= companies and "Data Engineer" in roles
    assert all(d["n"] >= 1 for d in data)


def test_suggestions_skip_unknown_values_and_are_safe(env):
    conn, client = env
    when = db.iso(__import__("datetime").datetime.now(__import__("datetime").timezone.utc))
    db.create_application(conn, "Unknown company", "", "Unknown role", "", "Applied", when)
    db.create_application(conn, "</script><b>x</b>", "scriptx", "Analyst", "analyst", "Applied", when)
    conn.commit()
    html = client.get("/").text
    payload = re.search(r'id="suggest-data">(.*?)</script>', html, flags=re.S).group(1)
    data = __import__("json").loads(payload)
    texts = {d["text"] for d in data}
    assert "Unknown company" not in texts and "Unknown role" not in texts
    assert "</script><b>" not in payload and "\\u003c/script\\u003e" in payload.replace("\\u003C", "\\u003c")   # can't break out of the script tag
    assert "textContent" in html and ".innerHTML" not in html.split('id="suggest-data"')[1]   # suggestions are drawn as text, never as HTML


def test_search_popup_is_themed_and_keyboard_operable(env):
    _, client = env
    html = client.get("/").text
    for part in (".combo-list { position: absolute; z-index: var(--z-pop)", "border-radius: var(--r-pill)", "ArrowDown", "ArrowUp",
                 "e.key === 'Escape'", "aria-activedescendant", "aria-selected", "requestSubmit"):
        assert part in html
    assert "--z-pop: 30" in html


def test_dropdowns_are_themed_not_the_system_popup(env):
    _, client = env
    css = client.get("/").text
    assert "@supports (appearance: base-select)" in css and "select::picker(select)" in css
    for rule in ("select::picker-icon", "select option::checkmark", "select option:hover", "select:open::picker-icon"):
        assert rule in css
    assert "box-shadow: none" in css.split("select::picker(select) { margin-top")[1].split("}")[0]   # hairline popup, no shadow
    assert "border-radius: var(--r-pill)" in css.split("select option {")[1].split("}")[0]  # pill-shaped rows, like the buttons
    # Options in a group must not inherit the group heading's bold weight.
    assert css.index("select optgroup option { font-weight: 400; }") < css.index("select option:checked { font-weight: 600; }")


def test_phone_nav_fits_one_row(env):
    _, client = env
    css = client.get("/").text
    assert "@media (max-width: 520px)" in css and "justify-content: space-between" in css


def test_settings_accounts_table_lines_up_with_the_card_text(env):
    _, client = env
    html = client.get("/settings").text
    assert ".scroll-x table.list th:first-child, .scroll-x table.list td:first-child { padding-left: 0; }" in html


def test_flow_labels_are_larger_and_the_dark_ramp_starts_lighter(env):
    _, client = env
    html = client.get("/flow").text
    assert ".viz-root .lbl { fill: var(--ink); font-size: 14px" in html and ".viz-root .sub { fill: var(--ink2); font-size: 13px" in html
    assert html.count("--ord-1: #7d7155") == 2        # system-dark and forced-dark, 3.65:1 on the dark card
    assert "#675c45" not in html


def test_serif_is_used_for_headlines_and_company_names(env):
    _, client = env
    html = client.get("/").text
    assert "h1.page { font: 500 clamp(2rem, 4vw, 2.75rem)/1.12 var(--font-display)" in html
    assert "a.expander strong { font: 500 1.1875rem/1.2 var(--font-display)" in html
