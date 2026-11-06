import pytest
from fastapi.testclient import TestClient

from jobtracker import db, stats
from jobtracker.stats import application_path
from jobtracker.sync import process_messages
from jobtracker.web import create_app
from tests.helpers import mk


def test_paths():
    assert application_path("Applied", {"Applied"}) == ["Applied", "No response yet"]
    assert application_path("Heard back", {"Applied", "Heard back"}) == ["Applied", "Heard back", "Still open"]
    assert application_path("Rejected", {"Applied", "Rejected"}) == ["Applied", "Heard back", "Rejected"]
    # Skipping assessment is allowed; it is only shown when actually reached.
    assert application_path("Offer", {"Applied", "Interview", "Offer"}) == ["Applied", "Heard back", "Interview", "Offer"]
    assert application_path("Rejected", {"Applied", "Assessment", "Interview", "Rejected"}) == [
        "Applied", "Heard back", "Assessment", "Interview", "Rejected"]
    # A hand-set stage with no emails still produces a sensible path.
    assert application_path("Interview", set()) == ["Applied", "Heard back", "Interview", "Still open"]


@pytest.fixture
def conn():
    c = db.connect(":memory:")
    yield c
    c.close()


def seed(conn):
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    process_messages(conn, acct, [
        mk("a1", "Thank you for applying to Acme", thread="A", day=1),
        mk("a2", "Interview", "Please select a time for your interview.", thread="A", day=4),
        mk("a3", "Offer", "We are pleased to offer you the role.", thread="A", day=9),
        mk("b1", "Thank you for applying to Initech", sender="Initech <no-reply@lever.co>", thread="B", day=2),
        mk("b2", "Update", "We will not be moving forward with your application.", sender="Initech <no-reply@lever.co>", thread="B", day=6),
        mk("c1", "Thank you for applying to Hooli", sender="Hooli <no-reply@lever.co>", thread="C", day=3),
    ])
    return acct


def test_sankey_counts_and_conservation(conn):
    seed(conn)
    d = stats.sankey(conn)
    nodes = {n["id"]: n["value"] for n in d["nodes"]}
    assert d["total"] == 3
    assert nodes == {"Applied": 3, "Heard back": 2, "No response yet": 1, "Interview": 1, "Offer": 1, "Rejected": 1}
    links = {(l["source"], l["target"]): l["value"] for l in d["links"]}
    assert links[("Applied", "Heard back")] == 2 and links[("Heard back", "Interview")] == 1
    assert links[("Heard back", "Rejected")] == 1 and links[("Interview", "Offer")] == 1
    # Every application leaves each non-final node: flow in equals flow out.
    for n in d["nodes"]:
        out = sum(l["value"] for l in d["links"] if l["source"] == n["id"])
        inn = sum(l["value"] for l in d["links"] if l["target"] == n["id"])
        if n["id"] != "Applied" and out:
            assert inn == out, n
    assert (d["heard_back"], d["interviews"], d["offers"], d["rejected"]) == (2, 1, 1, 1)


def test_sankey_empty(conn):
    d = stats.sankey(conn)
    assert d["total"] == 0 and d["nodes"] == [] and d["links"] == []


def test_sankey_account_filter(conn):
    seed(conn)
    other = db.upsert_account(conn, "outlook", "me@outlook.com")
    assert stats.sankey(conn, account=other)["total"] == 0
    assert stats.sankey(conn, account=1)["total"] == 3


def test_flow_page(tmp_path):
    path = tmp_path / "t.db"
    conn = db.connect(path)
    seed(conn)
    conn.commit()
    client = TestClient(create_app(path), base_url="http://127.0.0.1:8765")
    html = client.get("/statistics").text
    assert "<h1 class=\"page\">Statistics</h1>" in html and 'id="flow-data"' in html and "Table view" in html
    assert "No applications to chart" in TestClient(create_app(tmp_path / "empty.db"), base_url="http://127.0.0.1:8765").get("/statistics").text
    conn.close()


def test_review_decision_shows_in_flow(tmp_path):
    path = tmp_path / "t.db"
    conn = db.connect(path)
    acct = db.upsert_account(conn, "gmail", "me@gmail.com")
    process_messages(conn, acct, [
        mk("1", "Thank you for applying to Acme", thread="A", day=1),
        mk("r", "Re: your application", "Quick question about your CV.", sender="Sam <sam@zzz.com>", day=3),
    ])
    conn.commit()
    client = TestClient(create_app(path), base_url="http://127.0.0.1:8765", follow_redirects=False)
    rid = conn.execute("SELECT id FROM emails WHERE needs_review = 1").fetchone()[0]
    client.post(f"/review/{rid}", data={"action": "assign", "app_id": 1, "stage": "Assessment"})
    nodes = {n["id"] for n in stats.sankey(db.connect(path))["nodes"]}
    assert "Assessment" in nodes
    conn.close()
