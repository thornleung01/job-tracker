"""People and their titles, worked out from email threads, one application at a time. Signature formats are real recruiting mail."""
import re

import pytest
from fastapi.testclient import TestClient

from jobtracker import contacts, db
from jobtracker.web import create_app


@pytest.fixture
def env(tmp_path):
    path = tmp_path / "t.db"
    conn = db.connect(path)
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    app1 = db.create_application(conn, "DoorDash", "doordash", "Analyst", "analyst", "Interview", "2026-10-01T09:00:00Z")
    app2 = db.create_application(conn, "Deel", "deel", "Manager", "manager", "Applied", "2026-10-02T09:00:00Z")

    def add(sender, body, app, when="2026-10-05T10:00:00Z", subject="Hello", review=0):
        n = conn.execute("SELECT COUNT(*) FROM emails").fetchone()[0]
        conn.execute("INSERT INTO emails (account_id, provider_msg_id, thread_id, received_at, sender, subject, body, related, event, confidence, application_id, needs_review) "
                     "VALUES (?, ?, 't', ?, ?, ?, ?, 1, 'interview', 'high', ?, ?)", (acct, f"m{n}", when, sender, subject, body, None if review else app, review))
    conn.commit()
    client = TestClient(create_app(path), base_url="http://127.0.0.1:8765", follow_redirects=False)

    class E:
        pass
    e = E()
    e.conn, e.client, e.add, e.app1, e.app2 = conn, client, add, app1, app2
    return e


def by_name(conn, app_id=None):
    return {c["name"]: c for c in contacts.derive(conn, app_id)}


# --- titles in signatures ----------------------------------------------------------------------------

@pytest.mark.parametrize("sender,body,title", [
    ("Sofia Hart <sofia.hart@doordash.com>", "Thanks!\nSara\nSofia Hart\nSales Sourcer\nDoorDash / Wolt\nsofia.hart@doordash.com\n", "Sales Sourcer"),
    ("Jocelyn Ford <jocelyn.ford@doordash.com>", "Best,\nJocelyn Ford Senior Business Recruiter DoorDash / Wolt jocelyn.ford@doordash.com", "Senior Business Recruiter"),
    ("Samuel Okafor <sam.okafor@deel.com>", "Talk soon,\nSam Senior Talent Acquisition Specialist @ Deel 650 2nd Street, San Francisco, CA 94107", "Senior Talent Acquisition Specialist"),
    ("Nadia De La Cruz <nadia.delacruz@deel.com>", "Regards!\n--\nNadia De La Cruz People Operations Specialist\nnadia.delacruz@deel.com", "People Operations Specialist"),
    ("Camila Reyes <camila.reyes@ext.doordash.com>", "Camila Reyes Contingent Worker DoorDash / Wolt camila.reyes@ext.doordash.com", "Contingent Worker"),
])
def test_titles_are_read_from_the_signature(env, sender, body, title):
    env.add(sender, body, env.app1)
    env.conn.commit()
    (person,) = contacts.derive(env.conn)
    assert person["title"] == title and person["email"] == sender.split("<")[1].rstrip(">") and person["app_id"] == env.app1


def test_a_sentence_after_a_name_is_not_a_title(env):
    env.add("Pat Lee <pat@acme.com>", "Pat Lee has invited you to attend: DoorDash Zoom Interview. Hi Pat, thanks for the update!", env.app1)
    env.conn.commit()
    assert by_name(env.conn)["Pat Lee"]["title"] == ""


def test_a_title_can_be_taken_from_i_am_on_the_team(env):
    env.add("Nadia Cruz <nadia@deel.com>", "Hi Jordan, Nice to e-meet you! I'm Nadia, from the People OPS team. Just reaching out.", env.app2)
    env.conn.commit()
    assert by_name(env.conn)["Nadia Cruz"]["title"] == "People OPS team"


def test_kinds_group_recruiters_hiring_side_and_people_ops():
    assert contacts.kind_of("Senior Business Recruiter") == contacts.kind_of("Sales Sourcer") == "recruiter"
    assert contacts.kind_of("Director, New Verticals") == contacts.kind_of("General Manager, Rapid Retail Canada") == "hiring"
    assert contacts.kind_of("People Operations Specialist") == "people" and contacts.kind_of("Contingent Worker") == ""


# --- people named in invites -----------------------------------------------------------------------------

def test_people_named_in_an_invite_are_found_with_their_titles(env):
    env.add("Camila Reyes <camila.reyes@ext.doordash.com>",
            "Schedule - Thu Oct 15 - 10:00AM (EDT)\n10:00AM (EDT) - 10:45AM (EDT): Brandon Doyle (Senior Manager, Strategy and Operations)\n"
            "Ben Hallett-Berry (Manager, Strategy & Operations - DashMart Canada)\nDoorDash Zoom Interview (EDT) | 30 minutes", env.app1)
    env.conn.commit()
    people = by_name(env.conn)
    assert people["Brandon Doyle"]["title"] == "Senior Manager, Strategy and Operations" and people["Brandon Doyle"]["mentioned_only"] and people["Brandon Doyle"]["email"] == ""
    assert people["Ben Hallett-Berry"]["title"] == "Manager, Strategy & Operations"                       # the " - team" tail is dropped
    assert people["Brandon Doyle"]["company"] == "DoorDash" and "DoorDash Zoom Interview" not in people


def test_a_senders_first_name_on_the_line_above_is_not_glued_onto_a_named_person(env):
    env.add("Jocelyn Ford <jocelyn.ford@doordash.com>", "Best,\nJocelyn\nKatie Ellison (Director, New Verticals) | 30 minutes", env.app1)
    env.conn.commit()
    names = set(by_name(env.conn))
    assert "Katie Ellison" in names and "Jocelyn Katie Ellison" not in names


def test_a_sender_who_is_also_named_in_an_invite_is_one_person(env):
    env.add("Sofia Hart <sofia.hart@doordash.com>", "Sofia Hart Sales Sourcer DoorDash", env.app1, when="2026-10-04T00:00:00Z")
    env.add("Camila Reyes <camila.reyes@ext.doordash.com>", "10:00AM: Sofia Hart (Sales Sourcer)", env.app1, when="2026-10-06T00:00:00Z")
    env.conn.commit()
    people = contacts.derive(env.conn)
    assert [c["name"] for c in people].count("Sofia Hart") == 1
    sara = next(c for c in people if c["name"] == "Sofia Hart")
    assert sara["email"] == "sofia.hart@doordash.com" and sara["emails"] == 1 and sara["last"].startswith("2026-10-06")


# --- a person belongs to one application ------------------------------------------------------------------

def test_the_same_person_is_listed_separately_per_application_with_that_applications_title(env):
    env.add("Sam Lee <sam@staffing.com>", "Best,\nSam Lee Senior Recruiter Staffing Co sam@staffing.com", env.app1, when="2026-10-04T00:00:00Z")
    env.add("Sam Lee <sam@staffing.com>", "Cheers,\nSam Lee Hiring Manager Staffing Co sam@staffing.com", env.app2, when="2026-10-06T00:00:00Z")
    env.conn.commit()
    people = contacts.derive(env.conn)
    assert len(people) == 2 and {(c["app_id"], c["title"]) for c in people} == {(env.app1, "Senior Recruiter"), (env.app2, "Hiring Manager")}
    assert contacts.derive(env.conn, env.app1)[0]["title"] == "Senior Recruiter" and len(contacts.derive(env.conn, env.app1)) == 1
    assert contacts.titles(env.conn, env.app2) == {"sam@staffing.com": "Hiring Manager"}


def test_a_name_that_only_appears_in_another_application_is_not_listed_here(env):
    env.add("Gabe Barros <gabe.barros@deel.com>", "See you then.", env.app2)
    env.conn.commit()
    assert contacts.for_application(env.conn, env.app1) == [] and len(contacts.for_application(env.conn, env.app2)) == 1


def test_emails_that_belong_to_no_application_yield_no_people(env):
    env.add("Gabe Barros <gabe.barros@deel.com>", "See you then.", env.app2, review=1)
    env.conn.commit()
    assert contacts.derive(env.conn) == []


# --- who is not a person --------------------------------------------------------------------------------

@pytest.mark.parametrize("sender", [
    "Deel HQ Hiring Team <no-reply@deel.com>", "Shopify Hiring Team <recruiting@talent.shopify.com>", "people.team@deel.com <people.team@deel.com>",
    "LinkedIn <jobs-noreply@linkedin.com>", "Instacart <no-reply@instacart.com>", "Pat <pat@acme.com>", "clio@myworkday.com <clio@myworkday.com>",
])
def test_teams_bots_and_single_names_are_not_people(env, sender):
    env.add(sender, "Thanks for applying. Regards, The Recruiting Team", env.app1)
    env.conn.commit()
    assert contacts.derive(env.conn) == []


def test_your_own_addresses_are_never_listed(env):
    env.add("Jordan Lee <me@gmail.com>", "Jordan Lee Senior Analyst", env.app1)
    env.conn.commit()
    assert contacts.derive(env.conn) == []


# --- corrections apply to one application ---------------------------------------------------------------------

def test_you_can_correct_a_title_for_one_application_and_it_survives_new_mail(env):
    env.add("Dana Whitfield <dw@deel.com>", "Confirmed. Your event has been scheduled.", env.app2)
    env.add("Dana Whitfield <dw@deel.com>", "Confirmed. Your event has been scheduled.", env.app1)
    env.conn.commit()
    key = f"{env.app2}|dw@deel.com"
    assert env.client.post("/contacts/edit", data={"key": key, "name": "Danielle Whitfield", "title": "  Hiring   Manager "}).status_code == 303
    env.add("Dana Whitfield <dw@deel.com>", "Dana Whitfield Head of Strategy dw@deel.com", env.app2, when="2026-10-09T00:00:00Z")
    env.conn.commit()
    here = contacts.derive(env.conn, env.app2)[0]
    assert (here["name"], here["title"], here["kind"], here["edited"]) == ("Danielle Whitfield", "Hiring Manager", "hiring", True)      # yours wins over the mail
    other = contacts.derive(env.conn, env.app1)[0]
    assert (other["name"], other["title"], other["edited"]) == ("Dana Whitfield", "", False)                                      # the other application is untouched


def test_an_edit_returns_to_the_page_it_was_made_on_and_only_to_this_site(env):
    env.add("Gabe Barros <gabe.barros@deel.com>", "See you then.", env.app2)
    env.conn.commit()
    key = f"{env.app2}|gabe.barros@deel.com"
    r = env.client.post("/contacts/edit", data={"key": key, "title": "Interviewer", "name": "Gabe Barros", "next": f"/app/{env.app2}"})
    assert r.headers["location"].startswith(f"/app/{env.app2}?notice=")
    for bad in ("https://evil.example.com", "//evil.example.com", "/settings", "/app/x"):
        r = env.client.post("/contacts/edit", data={"key": key, "title": "Interviewer", "name": "Gabe Barros", "next": bad})
        assert r.headers["location"].startswith("/contacts?notice="), bad


def test_hiding_a_name_removes_it_from_that_application_and_keeps_it_removed(env):
    env.add("Gabe Barros <gabe.barros@deel.com>", "See you then.", env.app2)
    env.conn.commit()
    assert env.client.post("/contacts/hide", data={"key": f"{env.app2}|gabe.barros@deel.com"}).status_code == 303
    env.add("Gabe Barros <gabe.barros@deel.com>", "Another.", env.app2, when="2026-10-09T00:00:00Z")
    env.conn.commit()
    assert contacts.derive(env.conn) == []


@pytest.mark.parametrize("key", ["", "not a key", "dw@deel.com", "name:abc", "x|dw@deel.com", "1|a b@c.d", "1|name:UPPER", "1|name:", "1|x@y@z"])
def test_edits_refuse_malformed_keys(env, key):
    assert env.client.post("/contacts/edit", data={"key": key, "title": "x"}).status_code in (400, 422)
    assert env.client.post("/contacts/hide", data={"key": key}).status_code in (400, 422)
    assert env.conn.execute("SELECT COUNT(*) FROM contact_edits").fetchone()[0] == 0


# --- the People tab --------------------------------------------------------------------------------------------

def test_the_people_tab_groups_people_under_their_application(env):
    env.add("Jocelyn Ford <jocelyn.ford@doordash.com>", "Jocelyn Ford Senior Business Recruiter DoorDash / Wolt jocelyn.ford@doordash.com", env.app1)
    env.add("Samuel Okafor <sam.okafor@deel.com>", "Sam Senior Talent Acquisition Specialist @ Deel", env.app2, when="2026-10-09T00:00:00Z")
    env.conn.commit()
    html = env.client.get("/contacts").text
    assert "2 people across 2 applications" in html and "Senior Business Recruiter" in html and "Recruiter</span>" in html
    assert f'href="/app/{env.app1}"' in html and html.index('class="company-name">Deel') < html.index('class="company-name">DoorDash')      # the application you heard from last first
    found = env.client.get("/contacts?q=doordash").text
    assert "1 of 2 people across 1 application" in found and "Jocelyn Ford" in found and "Samuel Okafor" not in found
    assert "Nobody matches" in env.client.get("/contacts?q=zzz").text


def test_the_same_person_shows_under_each_application_with_its_own_title(env):
    env.add("Sam Lee <sam@staffing.com>", "Best,\nSam Lee Senior Recruiter Staffing Co sam@staffing.com", env.app1)
    env.add("Sam Lee <sam@staffing.com>", "Cheers,\nSam Lee Hiring Manager Staffing Co sam@staffing.com", env.app2)
    env.conn.commit()
    html = env.client.get("/contacts").text
    assert "2 people across 2 applications" in html and "Senior Recruiter" in html and "Hiring Manager" in html


def test_the_people_tab_escapes_everything_it_shows(env):
    env.add('"<script>alert(1)</script> Smith" <x@y.com>', "hi", env.app1)
    env.add("Alex Doe <alex@acme.com>", "Alex Doe <img src=x onerror=alert(1)> Recruiter", env.app1)
    env.conn.commit()
    html = env.client.get("/contacts").text
    assert "<script>alert(1)" not in html and "<img src=x" not in html


def test_the_edit_routes_are_protected(env):
    for path in ("/contacts/edit", "/contacts/hide"):
        data = {"key": "1|a@b.co", "title": "x"}
        assert env.client.post(path, data=data, headers={"origin": "https://evil.example.com"}).status_code == 403
        assert env.client.post(path, data=data, headers={"sec-fetch-site": "cross-site"}).status_code == 403


# --- inside the application ----------------------------------------------------------------------------------------

def test_the_application_page_has_a_people_section_for_that_application_only_with_editing(env):
    env.add("Jocelyn Ford <jocelyn.ford@doordash.com>", "Jocelyn Ford Senior Business Recruiter DoorDash", env.app1)
    env.add("Samuel Okafor <sam.okafor@deel.com>", "Sam Senior Talent Acquisition Specialist @ Deel", env.app2)
    env.conn.commit()
    page = env.client.get(f"/app/{env.app1}").text
    assert 'id="h-people"' in page and "Jocelyn Ford" in page and "Senior Business Recruiter" in page and "Samuel Okafor" not in page
    assert f'name="key" value="{env.app1}|jocelyn.ford@doordash.com"' in page and f'name="next" value="/app/{env.app1}"' in page and "Title for this role" in page
    empty = env.client.get(f"/app/{env.app1 + 100}")
    assert empty.status_code == 404


def test_an_application_without_people_says_so(env):
    page = env.client.get(f"/app/{env.app1}").text
    assert 'id="h-people"' in page and "No people yet" in page


def test_a_title_shows_beside_the_sender_on_that_applications_emails_only(env):
    env.add("Sam Lee <sam@staffing.com>", "Best,\nSam Lee Senior Recruiter Staffing Co sam@staffing.com", env.app1)
    env.add("Sam Lee <sam@staffing.com>", "Cheers,\nSam Lee Hiring Manager Staffing Co sam@staffing.com", env.app2)
    env.add("Gabe Barros <gabe.barros@deel.com>", "See you then.", env.app1, when="2026-10-06T10:00:00Z")           # no title in the mail
    env.conn.commit()
    for url in (f"/app/{env.app1}", f"/app/{env.app1}/panel"):
        html = env.client.get(url).text
        assert '<span class="who">Sam Lee</span><span class="role">Senior Recruiter</span>' in html and "Hiring Manager" not in html.split('id="h-notes"')[-1], url
        assert '<span class="who">Gabe Barros</span><span class="addr">' in html, url                              # nobody gets an empty title
    assert '<span class="who">Sam Lee</span><span class="role">Hiring Manager</span>' in env.client.get(f"/app/{env.app2}").text


def test_emails_waiting_in_review_show_no_title(env):
    env.add("Sam Lee <sam@staffing.com>", "Best,\nSam Lee Senior Recruiter Staffing Co sam@staffing.com", env.app1)
    env.add("Sam Lee <sam@staffing.com>", "Hello again", env.app1, review=1)
    env.conn.commit()
    assert '<span class="role">' not in env.client.get("/review").text


def test_a_title_you_corrected_is_the_one_shown_beside_the_name(env):
    env.add("Gabe Barros <gabe.barros@deel.com>", "See you then.", env.app1)
    env.conn.commit()
    env.client.post("/contacts/edit", data={"key": f"{env.app1}|gabe.barros@deel.com", "name": "Gabe Barros", "title": "Hiring Manager"})
    assert '<span class="role">Hiring Manager</span>' in env.client.get(f"/app/{env.app1}").text


# --- navigation --------------------------------------------------------------------------------------------------

def nav_of(html):
    start = html.index('<nav aria-label="Main">')
    return html[start:html.index("</nav>", start)]


def test_the_navigation_is_jobs_applications_people_flow_needs_review_and_a_settings_icon(env):
    nav = nav_of(env.client.get("/").text)
    assert re.findall(r'<a href="([^"]+)"', nav) == ["/jobs", "/", "/contacts", "/flow", "/review", "/settings"]
    labels = [re.sub(r"<[^>]+>", "", t).strip() for t in re.findall(r"<a [^>]*>(.*?)</a>", nav, re.S)]
    assert labels[:5] == ["Jobs", "Applications", "People", "Flow", "Needs review"] and labels[5] == ""        # Settings has no visible text
    assert 'aria-label="Settings"' in nav and 'title="Settings"' in nav and "<svg" in nav and 'aria-hidden="true"' in nav
    assert "Settings<" not in nav


@pytest.mark.parametrize("path,current", [("/", "/"), ("/jobs", "/jobs"), ("/flow", "/flow"), ("/review", "/review"), ("/settings", "/settings"),
                                          ("/contacts", "/contacts"), ("/app/1", "/")])
def test_the_current_page_is_marked_in_the_navigation(env, path, current):
    marked = re.findall(r'<a href="([^"]+)"[^>]*aria-current="page"', nav_of(env.client.get(path).text))
    assert marked == [current]


# --- the emails connected to each person, and writing to them ------------------------------------------------------

def test_each_person_carries_the_emails_connected_to_them_in_that_application(env):
    env.add("Sofia Hart <sofia.hart@doordash.com>", "Sofia Hart Sales Sourcer DoorDash", env.app1, when="2026-10-03T10:00:00Z", subject="Intro call")
    env.add("Sofia Hart <sofia.hart@doordash.com>", "Following up.", env.app1, when="2026-10-07T10:00:00Z", subject="Next steps")
    env.add("Camila Reyes <camila.reyes@ext.doordash.com>", "10:00AM: Sofia Hart (Sales Sourcer) joins", env.app1, when="2026-10-05T10:00:00Z", subject="Zoom invite")
    env.add("Sofia Hart <sofia.hart@doordash.com>", "A different job entirely.", env.app2, subject="Other application")
    env.conn.commit()
    sara = by_name(env.conn, env.app1)["Sofia Hart"]
    assert [(m["subject"], m["how"]) for m in sara["mails"]] == [("Next steps", "from"), ("Zoom invite", "mentions"), ("Intro call", "from")]     # newest first
    assert sara["mail_count"] == 3 and sara["latest_mail"]["subject"] == "Next steps"
    assert all(m["subject"] != "Other application" for m in sara["mails"])                                         # the other application's mail stays there


def test_the_email_button_opens_a_new_message_in_the_mailbox_their_latest_email_reached(env):
    env.add("Pat Lee <pat@acme.com>", "Pat Lee Senior Recruiter", env.app1, when="2026-10-03T10:00:00Z", subject="Hello")
    env.add("Pat Lee <pat@acme.com>", "Pat Lee Senior Recruiter", env.app1, when="2026-10-06T10:00:00Z", subject="Interview times")
    env.conn.commit()
    (pat,) = contacts.derive(env.conn)
    label, url = pat["compose"]
    assert label == "Reply in Gmail" and url.startswith("https://mail.google.com/mail/?authuser=me%40gmail.com&view=cm")
    assert "to=pat%40acme.com" in url and "su=Re%3A%20Interview%20times" in url
    page = env.client.get(f"/app/{env.app1}").text
    assert ">Email Pat</a>" in page and url.replace("&", "&amp;") in page and 'target="_blank" rel="noopener noreferrer"' in page


def test_someone_named_only_in_an_invite_has_no_email_button_and_says_why(env):
    env.add("Camila Reyes <camila.reyes@ext.doordash.com>", "10:00AM: Brandon Doyle (Senior Manager, Strategy)", env.app1)
    env.conn.commit()
    brian = by_name(env.conn)["Brandon Doyle"]
    assert brian["compose"] is None and brian["email"] == "" and brian["mail_count"] == 1
    page = env.client.get(f"/app/{env.app1}").text
    assert "No address, named in an invite" in page and ">Email Brian</a>" not in page


def test_reply_here_appears_only_when_replying_is_on_and_jumps_to_their_latest_email(env):
    env.add("Pat Lee <pat@acme.com>", "Pat Lee Senior Recruiter", env.app1, subject="Interview times")
    env.conn.commit()
    assert ">Reply here</a>" not in env.client.get(f"/app/{env.app1}").text
    env.conn.execute("UPDATE accounts SET can_reply = 1")
    env.conn.commit()
    email_id = env.conn.execute("SELECT id FROM emails").fetchone()[0]
    page = env.client.get(f"/app/{env.app1}").text
    assert f'href="/app/{env.app1}?reply=1#email-{email_id}"' in page and f'<article class="card" id="email-{email_id}">' in page


def test_the_list_of_connected_emails_links_to_each_email_and_is_capped(env):
    for i in range(contacts.MAX_MAILS + 5):
        env.add("Pat Lee <pat@acme.com>", "Pat Lee Senior Recruiter", env.app1, when=f"2026-10-{1 + i // 24:02d}T{i % 24:02d}:00:00Z", subject=f"Message {i}")
    env.conn.commit()
    (pat,) = contacts.derive(env.conn)
    assert len(pat["mails"]) == contacts.MAX_MAILS and pat["mail_count"] == contacts.MAX_MAILS + 5
    html = env.client.get("/contacts").text
    assert f"{contacts.MAX_MAILS + 5} emails</summary>" in html and f"Showing the latest {contacts.MAX_MAILS} of {contacts.MAX_MAILS + 5}" in html
    assert re.search(r'href="/app/\d+#email-\d+">Message \d+</a>', html)


def test_subjects_in_the_connected_emails_are_escaped(env):
    env.add("Pat Lee <pat@acme.com>", "Pat Lee Senior Recruiter", env.app1, subject="<script>alert(1)</script>")
    env.conn.commit()
    html = env.client.get("/contacts").text
    assert "<script>alert(1)</script>" not in html and "&lt;script&gt;" in html


# --- every company is a dropdown ------------------------------------------------------------------------------------

def company_dropdowns(html):
    return re.findall(r'<details class="card company" id="g-(\d+)" (open)?>', html)


def test_every_company_on_the_people_tab_is_a_dropdown_closed_by_default(env):
    env.add("Jocelyn Ford <jocelyn.ford@doordash.com>", "Jocelyn Ford Senior Business Recruiter DoorDash", env.app1)
    env.add("Samuel Okafor <sam.okafor@deel.com>", "Sam Senior Talent Acquisition Specialist @ Deel", env.app2)
    env.conn.commit()
    html = env.client.get("/contacts").text
    assert [(i, o) for i, o in company_dropdowns(html)] == [(str(env.app2), ""), (str(env.app1), "")] or len(company_dropdowns(html)) == 2
    assert all(o == "" for _, o in company_dropdowns(html))
    assert '<span class="company-name">Deel</span>' in html and '<span class="tag">1 person</span>' in html and "Expand all" in html and "Collapse all" in html
    assert html.count('class="disclosure"') >= 2 and "<h2 class=\"section\" id=\"g-" not in html


def test_a_single_company_or_a_search_opens_its_dropdown(env):
    env.add("Jocelyn Ford <jocelyn.ford@doordash.com>", "Jocelyn Ford Senior Business Recruiter DoorDash", env.app1)
    env.conn.commit()
    assert [o for _, o in company_dropdowns(env.client.get("/contacts").text)] == ["open"]                      # only one company: nothing to hide
    env.add("Samuel Okafor <sam.okafor@deel.com>", "Sam Senior Talent Acquisition Specialist @ Deel", env.app2)
    env.conn.commit()
    assert [o for _, o in company_dropdowns(env.client.get("/contacts?q=deel").text)] == ["open"]               # a search shows what matched


def test_the_dropdown_holds_the_people_and_a_link_to_the_application(env):
    env.add("Jocelyn Ford <jocelyn.ford@doordash.com>", "Jocelyn Ford Senior Business Recruiter DoorDash", env.app1)
    env.add("Samuel Okafor <sam.okafor@deel.com>", "Sam Senior Talent Acquisition Specialist @ Deel", env.app2)
    env.conn.commit()
    html = env.client.get("/contacts").text
    block = html[html.index(f'id="g-{env.app1}"'):]
    nxt = block.find('<details class="card company"', 10)                       # the next company starts where this one ends
    block = block[:nxt] if nxt > 0 else block[:block.index("</main>")]
    assert "Jocelyn Ford" in block and "Samuel Okafor" not in block and f'href="/app/{env.app1}">Open this application</a>' in block


def test_the_people_page_title_is_only_text_and_the_fold_script_sits_in_the_page(env):
    html = env.client.get("/contacts").text
    title = re.search(r"<title>(.*?)</title>", html, re.S).group(1)
    assert title == "People · Job Tracker"
    assert "<script>" not in title
    assert html.count("data-fold") >= 1 and "details.company" in html[html.index("</title>"):]


def test_the_wording_matches_the_hosted_edition(env):
    env.add("Sam Lee <sam@staffing.com>", "Hello again", env.app1, review=1)
    env.conn.commit()
    review = env.client.get("/review").text
    assert "learns to ignore emails like it." in review and "ignore mail like it" not in review
    assert ">Add to application<" in review and ">Create application<" in review
    assert 'name="action" value="assign"' in review and 'name="action" value="new"' in review and 'name="action" value="dismiss"' in review
    page = env.client.get(f"/app/{env.app1}").text
    assert "Emails like it will be ignored from now on." in page and "Mail like it" not in page
    assert ">Delete application</button>" in page and "<button class=\"danger\">Delete</button>" not in page
    panel = env.client.get(f"/app/{env.app1}/panel").text
    assert "Emails like it will be ignored from now on." in panel and ">Delete application</button>" in panel
    assert "Choosing a stage" not in panel and 'optgroup label="Other steps"' in panel          # the select's group labels already say it
