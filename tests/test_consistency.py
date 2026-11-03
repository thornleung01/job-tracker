"""The UI follows one system: shared components defined once, tokens instead of one-off values."""
import re
from pathlib import Path

import pytest

from jobtracker import db
from jobtracker.jobs import store
from jobtracker.jobs.text import clean_title

TEMPLATES = Path(__file__).resolve().parent.parent / "jobtracker" / "templates"
PAGES = sorted(p for p in TEMPLATES.glob("*.html"))


def read(name):
    return (TEMPLATES / name).read_text(encoding="utf-8")


# --- disclosures: one definition, in the shared stylesheet ---------------------------------------------------

def test_disclosure_styles_live_in_the_shared_stylesheet_not_in_one_page():
    base = read("base.html")
    assert "details.more > summary::before" in base and "details.action > summary" in base and "-webkit-details-marker" in base
    for page in PAGES:
        if page.name != "base.html":
            assert "details.more" not in page.read_text(encoding="utf-8").split("{% block content %}")[0] or page.name == "base.html", page.name


@pytest.mark.parametrize("page", PAGES, ids=lambda p: p.name)
def test_every_summary_is_styled(page):
    text = page.read_text(encoding="utf-8")
    for m in re.finditer(r"<details([^>]*)>\s*<summary([^>]*)>", text):
        assert re.search(r"\b(?:more|action|mail|card)\b|class=\"disclosure\"|hist-head", m.group(1) + m.group(2)), (page.name, m.group(0))


# --- one person component ----------------------------------------------------------------------------------------

def test_a_person_is_drawn_by_one_shared_component():
    assert (TEMPLATES / "_person.html").exists()
    for retired in ("_person_mail.html", "_person_edit.html"):
        assert not (TEMPLATES / retired).exists()
    for page in ("contacts.html", "detail.html"):
        text = read(page)
        assert '{% include "_person.html" %}' in text and "person-head" not in text and "Title for this role" not in text, page


# --- tokens, not one-off values ------------------------------------------------------------------------------------

@pytest.mark.parametrize("page", [p for p in PAGES if p.name != "flow.html"], ids=lambda p: p.name)
def test_no_hardcoded_corner_radii_or_colours_in_page_styles(page):
    css = "\n".join(re.findall(r"<style>(.*?)</style>", page.read_text(encoding="utf-8"), re.S))
    css = re.sub(r"--[\w-]+\s*:[^;]+;", "", css) if page.name != "base.html" else re.sub(r"(?s):root[^{]*\{.*?\}", "", css)   # token definitions are the one place for raw values
    assert not re.search(r"border-radius:\s*\d+px", css), page.name
    assert not re.search(r"(?<![\w&-])#[0-9a-fA-F]{3,8}\b(?!;?\s*\")", re.sub(r'\[data-[^\]]*\][^{]*\{[^}]*\}', "", css)) or page.name in ("base.html", "settings.html"), page.name


@pytest.mark.parametrize("page", PAGES, ids=lambda p: p.name)
def test_no_em_dashes_in_page_copy(page):
    assert "—" not in page.read_text(encoding="utf-8")


def test_settings_has_no_boxes_inside_its_cards_and_no_status_borders():
    css = read("settings.html")
    assert ".provider { border: 1px solid" not in css and ".provider.ok" not in css and ".provider.warn" not in css
    assert ".progress-card { border: 1px solid" not in css


# --- Jobs: a title is the job ----------------------------------------------------------------------------------------

@pytest.mark.parametrize("raw,company,clean", [
    ("Member of Technical Staff, Post-Training Cohere · Toronto, ON (Remote) 1 connection", "Cohere", "Member of Technical Staff, Post-Training"),
    ("Strategy & Operations Manager Clutch · Toronto, ON Actively recruiting Fast growing", "Clutch", "Strategy & Operations Manager"),
    ("Senior Product Operations Analyst Fidelity Canada · Toronto, ON 2 connections Fast growing", "Fidelity Canada", "Senior Product Operations Analyst"),
    ("Principal Experience Operations Program Manager, Agentic AI Autodesk · Ontario, Canada (Remote) Actively recruiting", "Autodesk", "Principal Experience Operations Program Manager, Agentic AI"),
    ("Data Analyst", "Acme", "Data Analyst"),                                  # nothing to remove
    ("Acme · Toronto", "Acme", "Acme · Toronto"),                              # never reduce a title to nothing
    ("Operations Analyst", "", "Operations Analyst"),
])
def test_alert_titles_lose_the_company_and_place_glued_on(raw, company, clean):
    assert clean_title(raw, company) == clean


def test_stored_titles_are_tidied_once():
    conn = db.connect(":memory:")
    conn.execute("INSERT INTO job_postings (source, source_key, dedupe_key, title, company, found_at) VALUES ('linkedin', 'k', 'd', "
                 "'Strategy & Operations Manager Clutch · Toronto, ON Actively recruiting', 'Clutch', '2026-10-01T00:00:00Z')")
    conn.commit()
    assert store.clean_titles(conn) == 1 and conn.execute("SELECT title FROM job_postings").fetchone()[0] == "Strategy & Operations Manager"
    assert store.clean_titles(conn) == 0
