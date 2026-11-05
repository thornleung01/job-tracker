"""Paste a job link: reading a posting safely (no real network anywhere), the route, the form, the stored link."""
import importlib.util
import json
import re
import socket
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from jobtracker import db, joblink
from jobtracker.web import create_app

PUBLIC = "93.184.216.34"


# -- a fake internet ---------------------------------------------------------------------------------------------

class Resp:
    def __init__(self, body=b"", status=200, ctype="text/html; charset=utf-8", headers=None, on_read=None):
        self.status, self._body, self.pos, self.closed, self.read_calls = status, body, 0, False, 0
        self.headers = {"content-type": ctype, **{k.lower(): v for k, v in (headers or {}).items()}}
        self.on_read = on_read

    def read(self, n):
        self.read_calls += 1
        if self.on_read:
            self.on_read()
        chunk = self._body[self.pos:self.pos + n]
        self.pos += len(chunk)
        return chunk

    def close(self):
        self.closed = True


def redirect(to, status=302):
    return Resp(status=status, ctype="text/html", headers={"Location": to})


class Net:
    """Stands in for DNS and for the connection. `routes` maps "host/path" to a Resp (or a callable returning one)."""

    def __init__(self, routes=None, dns=None):
        self.routes, self.dns = routes or {}, dns or {}
        self.resolved, self.connected = [], []

    def resolver(self, host, timeout):
        self.resolved.append(host)
        answer = self.dns.get(host, [PUBLIC])
        return answer() if callable(answer) else answer

    def transport(self, scheme, host, ips, port, target, headers, timeout, method="GET", body=None):
        self.connected.append({"scheme": scheme, "host": host, "ips": list(ips), "port": port, "target": target, "headers": dict(headers),
                               "method": method, "body": body})
        hit = self.routes.get(host + target)
        if hit is None:
            return Resp(b"not found", status=404)
        return hit() if callable(hit) else hit

    def derive(self, url):
        return joblink.derive(url, resolver=self.resolver, transport=self.transport)


def page(body="", head=""):
    return Resp(f"<!doctype html><html><head>{head}</head><body>{body}</body></html>".encode())


def ld(data):
    return f'<script type="application/ld+json">{json.dumps(data).replace("</", "<" + chr(92) + "/")}</script>'


POSTING = {"@context": "https://schema.org", "@type": "JobPosting", "title": "Senior Data Analyst",
           "hiringOrganization": {"@type": "Organization", "name": "Acme Corp"},
           "jobLocation": {"@type": "Place", "address": {"@type": "PostalAddress", "addressLocality": "Toronto",
                                                         "addressRegion": "ON", "addressCountry": "CA"}}}


# -- the address checks ------------------------------------------------------------------------------------------

BAD_ADDRESSES = [
    "http://127.0.0.1/", "http://127.0.0.1:8765/", "http://localhost/", "http://localhost:8765/x", "http://LOCALHOST./",
    "http://foo.localhost/", "http://10.0.0.5/", "http://172.16.0.1/", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/", "http://0.0.0.0/", "http://224.0.0.1/", "http://240.0.0.1/", "http://255.255.255.255/",
    "http://[::1]/", "http://[::]/", "http://[fe80::1]/", "http://[fc00::1]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:169.254.169.254]/",
    "http://[64:ff9b::7f00:1]/", "http://[2002:7f00:1::]/", "http://[ff02::1]/",
    "http://2130706433/", "http://0x7f000001/", "http://0x7f.0x0.0x0.0x1/", "http://0177.0.0.1/", "http://017700000001/", "http://127.1/",
    "http://127.0.1/", "http://2852039166/", "http://intranet/", "http://printer.local/", "http://db.internal/",
    "http://metadata.google.internal/", "http://1.2.3.4.5/",
    # Other Unicode dots and fullwidth digits become ordinary dots and digits under IDNA, so they must be checked after it.
    "http://127\u30020\u30020\u30021/", "http://\uff11\uff12\uff17\uff0e\uff10\uff0e\uff10\uff0e\uff11/", "http://169\u3002254\u3002169\u3002254/",
    "http://192\uff0e168\uff0e1\uff0e1/", "http://10\uff610\uff610\uff615/", "http://0x7f\u30020\u30020\u30021/",
    "http://\uff11\uff12\uff17.0.0.1/", "http://\uff12\uff11\uff13\uff10\uff17\uff10\uff16\uff14\uff13\uff13/",
]


@pytest.mark.parametrize("url", BAD_ADDRESSES)
def test_unsafe_addresses_are_refused_without_connecting(url):
    net = Net()
    with pytest.raises(joblink.JobLinkError) as err:
        net.derive(url)
    assert str(err.value) in (joblink.MSG_BLOCKED, joblink.MSG_INVALID)
    assert net.connected == [] and net.resolved == []


@pytest.mark.parametrize("url", [
    "file:///etc/passwd", "ftp://example.com/x", "gopher://example.com/", "javascript:alert(1)", "data:text/html,hi",
    "//example.com/x", "example.com/job", "", "   ", "https://", "http://user:pw@example.com/", "http://user@example.com/",
    "https://example.com@evil.example/", "http://example.com\\@127.0.0.1/", "https://exa mple.com/", "https://example.com/\"><script>",
    "https://example.com/" + "a" * 2000,
    # only ports 80 and 443 are allowed
    "http://example.com:22/", "https://example.com:8765/", "http://example.com:8080/", "https://example.com:0/", "https://example.com:99999/",
])
def test_bad_schemes_credentials_ports_and_junk_are_refused(url):
    net = Net()
    with pytest.raises(joblink.JobLinkError):
        net.derive(url)
    assert net.connected == []


def test_ports_80_and_443_are_fine():
    for url, port in (("http://example.com:80/x", 80), ("https://example.com:443/x", 443), ("https://example.com/x", 443)):
        net = Net({"example.com/x": page(head="<title>Role</title>")})
        net.derive(url)
        assert net.connected[0]["port"] == port


def test_hostname_that_resolves_to_a_private_address_is_refused():
    for bad in ("127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "100.64.0.9", "::ffff:10.0.0.1", "fe80::1"):
        net = Net(dns={"sneaky.example.com": [bad]})
        with pytest.raises(joblink.JobLinkError):
            net.derive("https://sneaky.example.com/job/1")
        assert net.connected == []


def test_one_private_answer_among_public_ones_refuses_the_name():
    net = Net(dns={"mixed.example.com": [PUBLIC, "192.168.0.10"]})
    with pytest.raises(joblink.JobLinkError):
        net.derive("https://mixed.example.com/job")
    assert net.connected == []


def test_connects_to_the_checked_address_even_if_dns_changes_its_answer():
    """A rebinding resolver: public on the first question, private on any later one. The connection is made to the
    address that was checked, and the name is asked only once for each hop."""
    answers = iter([[PUBLIC], ["127.0.0.1"], ["127.0.0.1"], ["127.0.0.1"]])
    net = Net({"rebind.example.com/job": page(head="<title>Analyst - Rebind</title>")}, dns={"rebind.example.com": lambda: next(answers)})
    out = net.derive("https://rebind.example.com/job")
    assert [c["ips"] for c in net.connected] == [[PUBLIC]]
    assert net.resolved.count("rebind.example.com") == 1
    assert out["role"] == "Analyst"


def test_a_name_that_turns_private_on_a_redirect_hop_is_refused():
    answers = {"a.example.com": [PUBLIC], "b.example.com": ["10.0.0.7"]}
    net = Net({"a.example.com/x": redirect("https://b.example.com/y")}, dns=answers)
    with pytest.raises(joblink.JobLinkError):
        net.derive("https://a.example.com/x")
    assert [c["host"] for c in net.connected] == ["a.example.com"]


@pytest.mark.parametrize("target", [
    "http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:8765/", "https://10.0.0.1/", "http://localhost/", "http://[::1]/",
    "http://2130706433/", "file:///etc/passwd", "ftp://example.com/x", "http://user:pw@example.com/", "https://example.com:22/",
    "//169.254.169.254/x",
])
def test_redirects_are_checked_on_every_hop(target):
    net = Net({"a.example.com/x": redirect(target)})
    with pytest.raises(joblink.JobLinkError):
        net.derive("https://a.example.com/x")
    assert len(net.connected) == 1                       # never connected to the place it was sent


def test_a_private_target_on_the_third_hop_is_still_refused():
    net = Net({"a.example.com/1": redirect("/2"), "a.example.com/2": redirect("https://a.example.com/3"),
               "a.example.com/3": redirect("http://169.254.169.254/")})
    with pytest.raises(joblink.JobLinkError):
        net.derive("https://a.example.com/1")
    assert len(net.connected) == 3


def test_redirects_are_followed_by_hand_and_stop_after_four():
    routes = {f"a.example.com/{i}": redirect(f"/{i + 1}") for i in range(10)}
    net = Net(routes)
    out = net.derive("https://a.example.com/0")
    assert len(net.connected) == joblink.MAX_REDIRECTS + 1       # the page, then four redirects, then it gives up
    assert out["source"] == "link"                                # and falls back to the address
    ok = Net({"a.example.com/0": redirect("/1"), "a.example.com/1": redirect("https://b.example.com/2", 301),
              "b.example.com/2": page(head="<title>Site Reliability Engineer | Bee</title>")})
    assert ok.derive("https://a.example.com/0")["role"] == "Site Reliability Engineer"
    assert ok.derive("https://a.example.com/0")["url"] == "https://a.example.com/0"      # the address you pasted, not the destination


def test_relative_and_protocol_relative_redirects_are_resolved_then_checked():
    net = Net({"a.example.com/x": redirect("/y?z=1"), "a.example.com/y?z=1": page(head="<title>Cook</title>")})
    assert net.derive("https://a.example.com/x")["role"] == "Cook"


def test_oversize_body_is_never_read_past_one_megabyte():
    big = b"<html><head><title>Analyst | Big Co</title></head><body>" + b"x" * 5_000_000
    resp = Resp(big)
    net = Net({"big.example.com/job": resp})
    out = net.derive("https://big.example.com/job")
    assert resp.pos <= joblink.MAX_BYTES and resp.closed
    assert out["role"] == "Analyst"


def test_wrong_content_type_is_not_read():
    for ctype in ("application/pdf", "image/png", "application/octet-stream", "text/plain", "application/xml", ""):
        resp = Resp(b"<title>Analyst | Co</title>", ctype=ctype)
        net = Net({"a.example.com/file": resp})
        out = net.derive("https://a.example.com/file")
        assert resp.read_calls == 0 and resp.closed
        assert out["source"] == "link"


def test_allowed_content_types():
    for ctype in ("text/html", "TEXT/HTML; charset=utf-8", "application/json", "application/ld+json; charset=utf-8"):
        body = json.dumps(POSTING).encode() if "json" in ctype else b"<title>Analyst | Co</title>"
        out = Net({"a.example.com/p": Resp(body, ctype=ctype)}).derive("https://a.example.com/p")
        assert out["source"] != "link", ctype


def test_error_statuses_fall_back_to_the_address():
    for status in (403, 404, 500, 204):
        out = Net({"jobs.example.com/careers/senior-data-analyst": Resp(b"nope", status=status)}).derive("https://jobs.example.com/careers/senior-data-analyst")
        assert out["source"] == "link" and out["role"] == "Senior Data Analyst" and out["company"] == "Example"
        assert out["guessed_company"] and out["guessed_role"]


def test_nothing_internal_comes_back():
    def boom(*args, **kwargs):
        raise RuntimeError("secret internal detail 10.0.0.1")

    out = joblink.derive("https://example.com/jobs/data-analyst", resolver=lambda h, t: [PUBLIC], transport=boom)
    assert "secret" not in json.dumps(out) and out["source"] == "link"
    out = joblink.derive("https://example.com/jobs/data-analyst", resolver=boom, transport=boom)
    assert "secret" not in json.dumps(out)


def test_request_carries_nothing_but_a_neutral_user_agent():
    net = Net({"example.com/job": page(head="<title>Cook</title>")})
    net.derive("https://example.com/job?utm_source=x")
    sent = net.connected[0]["headers"]
    assert sent["User-Agent"] == "JobTracker/1.0 (+personal use)"
    assert sent["Accept-Encoding"] == "identity"
    assert not {k.lower() for k in sent} & {"cookie", "authorization", "referer", "origin", "x-forwarded-for", "proxy-authorization"}
    assert net.connected[0]["target"] == "/job"             # tracking was cleaned before the request


def test_a_slow_server_hits_the_total_timeout(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(joblink.time, "monotonic", lambda: clock[0])
    resp = Resp(b"<title>Cook | Slow</title>" + b" " * 900_000, on_read=lambda: clock.__setitem__(0, clock[0] + 3))
    out = Net({"slow.example.com/j": resp}).derive("https://slow.example.com/j")
    assert resp.read_calls <= 4 and resp.closed
    assert out["source"] == "link"                          # gave up at 8 s and fell back to the address


def test_the_clock_is_shared_by_the_dns_lookup_and_the_connection(monkeypatch):
    seen = []
    net = Net({"example.com/j": page(head="<title>Cook</title>")})
    orig = net.transport
    net.transport = lambda *a: (seen.append(a[-1]), orig(*a))[1]
    net.derive("https://example.com/j")
    assert 0 < seen[0] <= joblink.TOTAL_TIMEOUT == 8


def test_the_real_transport_talks_http_to_the_pinned_address_with_the_right_host_header():
    """A throwaway server on this machine (no outside network): the name is only the Host header, the socket goes to the address."""
    import http.server
    import threading

    seen = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            seen.update(host=self.headers["Host"], ua=self.headers["User-Agent"], cookie=self.headers["Cookie"], path=self.path)
            body = b"<title>Hello</title>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        resp = joblink._transport("http", "careers.example.test", ["127.0.0.1"], server.server_port, "/job?x=1",
                                  {"User-Agent": joblink.USER_AGENT}, 5)
        assert resp.status == 200 and resp.headers["content-type"] == "text/html"
        assert resp.read(100) == b"<title>Hello</title>"
        resp.close()
    finally:
        server.shutdown()
    assert seen["host"].startswith("careers.example.test") and seen["ua"] == joblink.USER_AGENT
    assert seen["cookie"] is None and seen["path"] == "/job?x=1"


# -- the real connection code, with the socket faked -------------------------------------------------------------

def test_the_real_transport_connects_to_the_checked_address_not_the_name(monkeypatch):
    calls = []

    def fake_connect(address, timeout=None, **kw):
        calls.append(address)
        raise OSError("no network in tests")

    monkeypatch.setattr(joblink.socket, "create_connection", fake_connect)
    monkeypatch.setattr(joblink.socket, "getaddrinfo", lambda *a, **k: pytest.fail("the name must not be looked up again"))
    with pytest.raises(joblink._FetchFailed):
        joblink._transport("https", "example.com", [PUBLIC, "93.184.216.35"], 443, "/job", {"User-Agent": "x"}, 5)
    assert calls == [(PUBLIC, 443), ("93.184.216.35", 443)]


def test_the_real_resolver_path_refuses_a_private_answer(monkeypatch):
    def fake_getaddrinfo(host, port, *a, **k):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 0))]

    monkeypatch.setattr(joblink.socket, "getaddrinfo", fake_getaddrinfo)
    monkeypatch.setattr(joblink.socket, "create_connection", lambda *a, **k: pytest.fail("connected to a private address"))
    with pytest.raises(joblink.JobLinkError):
        joblink.derive("https://looks-public.example.com/job")


def test_a_failing_lookup_falls_back_to_the_address(monkeypatch):
    def fail(*a, **k):
        raise socket.gaierror("nope")

    monkeypatch.setattr(joblink.socket, "getaddrinfo", fail)
    out = joblink.derive("https://careers.acme.com/jobs/12345-staff-engineer")
    assert (out["company"], out["role"], out["source"]) == ("Acme", "Staff Engineer", "link")


# -- reading a page ----------------------------------------------------------------------------------------------

def test_json_ld_single_posting():
    out = Net({"acme.com/j": page(ld(POSTING), "<title>ignored</title>")}).derive("https://acme.com/j")
    assert out == {"company": "Acme Corp", "role": "Senior Data Analyst", "location": "Toronto, ON, CA", "url": "https://acme.com/j",
                   "source": "json-ld", "guessed_company": False, "guessed_role": False}


def test_json_ld_in_an_array_and_a_graph():
    other = {"@type": "Organization", "name": "Nope"}
    arr = Net({"acme.com/j": page(ld([other, POSTING]))}).derive("https://acme.com/j")
    graph = Net({"acme.com/j": page(ld({"@context": "https://schema.org", "@graph": [other, {"@type": ["Thing", "JobPosting"], **{k: v for k, v in POSTING.items() if k != "@type"}}]}))}).derive("https://acme.com/j")
    for out in (arr, graph):
        assert (out["company"], out["role"], out["source"]) == ("Acme Corp", "Senior Data Analyst", "json-ld")


def test_json_ld_second_script_and_broken_first_script():
    html = '<script type="application/ld+json">{ not json</script>' + ld(POSTING)
    assert Net({"acme.com/j": page(html)}).derive("https://acme.com/j")["role"] == "Senior Data Analyst"


def test_json_ld_remote_and_places():
    remote = dict(POSTING, jobLocation=None, jobLocationType="TELECOMMUTE", applicantLocationRequirements={"@type": "Country", "name": "Canada"})
    assert Net({"a.com/j": page(ld(remote))}).derive("https://a.com/j")["location"] == "Remote (Canada)"
    bare_remote = {k: v for k, v in remote.items() if k not in ("jobLocation", "applicantLocationRequirements")}
    assert Net({"a.com/j": page(ld(bare_remote))}).derive("https://a.com/j")["location"] == "Remote"
    hybrid = dict(POSTING, jobLocationType="TELECOMMUTE")
    assert Net({"a.com/j": page(ld(hybrid))}).derive("https://a.com/j")["location"] == "Remote (Toronto, ON, CA)"
    two = dict(POSTING, jobLocation=[{"address": {"addressLocality": "Toronto"}}, {"address": {"addressLocality": "Montreal", "addressCountry": {"name": "Canada"}}}])
    assert Net({"a.com/j": page(ld(two))}).derive("https://a.com/j")["location"] == "Toronto / Montreal, Canada"


def test_json_ld_organisation_as_a_plain_string():
    posting = dict(POSTING, hiringOrganization="Plain Co")
    assert Net({"a.com/j": page(ld(posting))}).derive("https://a.com/j")["company"] == "Plain Co"


def test_everything_extracted_is_cleaned_and_capped():
    nasty = dict(POSTING, title="  <b>Data</b>\u0000 &amp; <script>alert(1)</script>Analyst\n\t‮ " + "x" * 300,
                 hiringOrganization={"name": "<img src=x onerror=alert(1)>Evil &lt;i&gt;Co&lt;/i&gt; " + "y" * 200})
    out = Net({"a.com/j": page(ld(nasty))}).derive("https://a.com/j")
    for key, cap in (("company", 60), ("role", 90), ("location", 80)):
        assert len(out[key]) <= cap
        assert not re.search(r"[<>\x00-\x08\x0b-\x1f\x7f‮]", out[key]), (key, out[key])
    assert out["role"].startswith("Data & Analyst") and "alert" not in out["role"] and "\n" not in out["role"]
    assert out["company"].startswith("Evil Co")


def test_clean_text_edge_cases():
    assert joblink.clean_text(None, 10) == "" and joblink.clean_text({"a": 1}, 10) == "" and joblink.clean_text(["x"], 10) == ""
    assert joblink.clean_text("a\r\nb\u0085c​d", 50) == "a b c d"
    assert joblink.clean_text("AT&amp;T careers", 50) == "AT&T careers"
    assert joblink.clean_text("x" * 100, 5) == "xxxxx"


def test_open_graph_only_page():
    head = '<meta property="og:site_name" content="Globex Careers"><meta property="og:title" content="Product Designer - Globex Careers">'
    out = Net({"globex.com/j": page(head=head)}).derive("https://globex.com/j")
    assert (out["company"], out["role"], out["source"]) == ("Globex", "Product Designer", "open-graph")
    assert out["guessed_company"] is False and out["guessed_role"] is False


def test_open_graph_title_with_company_after_at():
    head = '<meta property="og:title" content="Product Designer at Initech">'
    out = Net({"jobs.example.com/j": page(head=head)}).derive("https://jobs.example.com/j")
    assert (out["company"], out["role"]) == ("Initech", "Product Designer") and out["guessed_company"]


def test_h1_and_title_fallbacks():
    out = Net({"x.example.com/j": page("<h1> Lead   Chef </h1>", "<title>Lead Chef | Kitchen Co | Careers</title>")}).derive("https://x.example.com/j")
    assert out["role"] == "Lead Chef" and out["source"] == "h1" and not out["guessed_role"]
    out = Net({"x.example.com/j": page("", "<title>Lead Chef | Kitchen Co | Careers</title>")}).derive("https://x.example.com/j")
    assert (out["role"], out["company"], out["source"]) == ("Lead Chef", "Kitchen Co", "page-title")
    assert out["guessed_role"] and out["guessed_company"]


def test_bare_page_is_guessed_from_the_address():
    out = Net({"careers.globex-labs.co.uk/en/jobs/84321-senior-backend-engineer": page("<p>Loading</p>")}).derive(
        "https://careers.globex-labs.co.uk/en/jobs/84321-senior-backend-engineer?utm_campaign=x#apply")
    assert out == {"company": "Globex Labs", "role": "Senior Backend Engineer", "location": "",
                   "url": "https://careers.globex-labs.co.uk/en/jobs/84321-senior-backend-engineer", "source": "link",
                   "guessed_company": True, "guessed_role": True}


def test_tracking_parameters_are_cleaned_but_the_job_id_stays():
    net = Net({"boards.example.com/j": page(head="<title>Cook</title>")})
    out = net.derive("https://Boards.Example.com/j?gh_jid=77&utm_source=li&utm_medium=x&fbclid=1&ref=abc&lever-source=x#top")
    assert out["url"] == "https://boards.example.com/j?gh_jid=77"
    assert net.connected[0]["target"] == "/j?gh_jid=77"
    assert joblink.clean_url("https://a.com/p?a=1&b=a%20b") == "https://a.com/p?a=1&b=a%20b"      # untouched when nothing is removed


def test_long_addresses_are_kept_short_for_storage():
    long = "https://example.com/job?id=" + "1" * 700
    out = Net({"example.com/job?id=" + "1" * 700: page(head="<title>Cook</title>")}).derive(long)
    assert len(out["url"]) <= joblink.MAX_STORED_URL


# -- the known boards --------------------------------------------------------------------------------------------

def test_greenhouse_api():
    api = {"id": 5551, "title": "Support Specialist", "location": {"name": "Remote - Canada"}, "company_name": "Hooli",
           "absolute_url": "https://boards.greenhouse.io/hooli/jobs/5551", "content": "&lt;p&gt;Hi&lt;/p&gt;"}
    net = Net({"boards-api.greenhouse.io/v1/boards/hooli/jobs/5551": Resp(json.dumps(api).encode(), ctype="application/json")})
    out = net.derive("https://boards.greenhouse.io/hooli/jobs/5551?gh_src=abc")
    assert (out["company"], out["role"], out["source"], out["guessed_company"]) == ("Hooli", "Support Specialist", "greenhouse", False)
    assert out["location"] == "Remote - Canada" and out["url"] == "https://boards.greenhouse.io/hooli/jobs/5551"
    assert [c["host"] for c in net.connected] == ["boards-api.greenhouse.io"]


def test_lever_api_and_eu_host():
    api = {"id": "0a1b2c3d-0000-4000-8000-123456789abc", "text": "Account Executive", "categories": {"location": "Toronto"},
           "workplaceType": "remote", "hostedUrl": "https://jobs.lever.co/pied/0a1b2c3d-0000-4000-8000-123456789abc"}
    net = Net({"api.lever.co/v0/postings/pied-piper/0a1b2c3d-0000-4000-8000-123456789abc": Resp(json.dumps(api).encode(), ctype="application/json")})
    out = net.derive("https://jobs.lever.co/pied-piper/0a1b2c3d-0000-4000-8000-123456789abc/apply?lever-source=x")
    assert (out["company"], out["role"], out["source"], out["location"]) == ("Pied Piper", "Account Executive", "lever", "Remote (Toronto)")
    assert out["guessed_company"] is True and out["guessed_role"] is False
    eu = Net({"api.eu.lever.co/v0/postings/pp/0a1b2c3d-0000-4000-8000-123456789abc": Resp(json.dumps(api).encode(), ctype="application/json")})
    assert eu.derive("https://jobs.eu.lever.co/pp/0a1b2c3d-0000-4000-8000-123456789abc")["source"] == "lever"


def test_ashby_board_is_searched_for_the_job():
    job = "5f1c2d3e-0000-4000-8000-aaaaaaaaaaaa"
    board = {"jobs": [{"id": "ffffffff-0000-4000-8000-000000000000", "title": "Other", "location": "NYC"},
                      {"id": job, "title": "Platform Engineer", "location": "Berlin", "isRemote": False, "jobUrl": "x"}]}
    net = Net({"api.ashbyhq.com/posting-api/job-board/vandelay": Resp(json.dumps(board).encode(), ctype="application/json")})
    out = net.derive(f"https://jobs.ashbyhq.com/vandelay/{job}")
    assert (out["role"], out["location"], out["source"], out["company"]) == ("Platform Engineer", "Berlin", "ashby", "Vandelay")


def test_smartrecruiters_api():
    api = {"id": "743999", "name": "Nurse Practitioner", "company": {"name": "Care Corp"}, "location": {"city": "Ottawa", "region": "ON", "country": "ca"}}
    net = Net({"api.smartrecruiters.com/v1/companies/CareCorp/postings/743999": Resp(json.dumps(api).encode(), ctype="application/json")})
    out = net.derive("https://jobs.smartrecruiters.com/CareCorp/743999-nurse-practitioner")
    assert (out["company"], out["role"], out["location"], out["source"], out["guessed_company"]) == ("Care Corp", "Nurse Practitioner", "Ottawa, ON, CA", "smartrecruiters", False)


def test_a_board_api_failure_falls_back_to_the_page():
    job = "0a1b2c3d-0000-4000-8000-123456789abc"
    net = Net({"api.lever.co/v0/postings/pp/" + job: Resp(b"{}", status=404),
               f"jobs.lever.co/pp/{job}": page(ld(POSTING))})
    out = net.derive(f"https://jobs.lever.co/pp/{job}")
    assert out["source"] == "json-ld" and out["company"] == "Acme Corp"
    assert [c["host"] for c in net.connected] == ["api.lever.co", "jobs.lever.co"]


def test_board_look_alike_hosts_and_odd_ids_do_not_reach_the_api_hosts():
    for url in ("https://evil-lever.co/pp/0a1b2c3d-0000-4000-8000-123456789abc", "https://jobs.lever.co.evil.example/pp/0a1b2c3d-0000-4000-8000-123456789abc",
                "https://boards.greenhouse.io/hooli/jobs/12abc", "https://jobs.lever.co/pp/not-a-uuid", "https://boards.greenhouse.io/hooli",
                "https://jobs.lever.co/..%2f..%2fadmin/0a1b2c3d-0000-4000-8000-123456789abc"):
        net = Net()
        net.derive(url)
        assert not any(c["host"].startswith(("api.", "boards-api")) for c in net.connected), url


# -- Ashby's own GraphQL (the POST path) -------------------------------------------------------------------------

ASHBY_JOB = "7458d4e9-da2e-47bd-98cb-adfda43d42b2"
ASHBY_JOB_URL = "jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting"
ASHBY_ORG_URL = "jobs.ashbyhq.com/api/non-user-graphql?op=ApiOrganizationFromHostedJobsPageName"
ASHBY_JOB_ANSWER = {"data": {"jobPosting": {"id": ASHBY_JOB, "title": "Engineering Manager - EU", "locationName": "Remote - European Union",
                                            "workplaceType": "Remote", "employmentType": "FullTime"}}}


def js(data, status=200, ctype="application/json", headers=None):
    return Resp(json.dumps(data).encode(), status=status, ctype=ctype, headers=headers)


def ashby_net(job=None, org=None, extra=None):
    routes = {ASHBY_JOB_URL: job or js(ASHBY_JOB_ANSWER), ASHBY_ORG_URL: org or js({"data": {"organization": {"name": "Ashby"}}})}
    routes.update(extra or {})
    return Net(routes)


def posts(net):
    return [c for c in net.connected if c["method"] == "POST"]


def test_ashby_graphql_gives_a_confirmed_company_role_and_place():
    net = ashby_net()
    out = net.derive(f"https://jobs.ashbyhq.com/ashby/{ASHBY_JOB}?utm_source=x")
    assert out == {"company": "Ashby", "role": "Engineering Manager - EU", "location": "Remote - European Union",
                   "url": f"https://jobs.ashbyhq.com/ashby/{ASHBY_JOB}", "source": "ashby", "guessed_company": False, "guessed_role": False}
    assert [c["method"] for c in net.connected] == ["POST", "POST"]       # the huge board listing is never fetched


def test_ashby_posts_go_only_to_the_fixed_host_port_and_pinned_addresses():
    net = ashby_net()
    net.dns["jobs.ashbyhq.com"] = [PUBLIC, "93.184.216.35"]
    net.derive(f"https://jobs.ashbyhq.com/ashby/{ASHBY_JOB}")
    first, second = posts(net)
    for sent, op in ((first, "ApiJobPosting"), (second, "ApiOrganizationFromHostedJobsPageName")):
        assert (sent["scheme"], sent["host"], sent["port"]) == ("https", "jobs.ashbyhq.com", 443)
        assert sent["ips"] == [PUBLIC, "93.184.216.35"]
        assert sent["target"] == "/api/non-user-graphql?op=" + op
        body = json.loads(sent["body"])
        assert body["operationName"] == op and set(body) == {"operationName", "variables", "query"}
        assert body["variables"]["organizationHostedJobsPageName"] == "ashby"
        assert sent["headers"]["Content-Type"] == "application/json" and sent["headers"]["Content-Length"] == str(len(sent["body"]))
        assert set(sent["headers"]) == {"User-Agent", "Accept", "Accept-Encoding", "Connection", "Content-Type", "Content-Length"}
    assert json.loads(first["body"])["variables"] == {"organizationHostedJobsPageName": "ashby", "jobPostingId": ASHBY_JOB}
    assert json.loads(second["body"])["variables"] == {"organizationHostedJobsPageName": "ashby", "searchContext": "JobBoard"}
    assert net.resolved.count("jobs.ashbyhq.com") == 2                        # each request resolved and vetted afresh


def test_ashby_post_to_a_name_that_resolves_privately_is_refused():
    net = ashby_net()
    net.dns["jobs.ashbyhq.com"] = ["10.0.0.9"]
    with pytest.raises(joblink.JobLinkError):
        net.derive(f"https://jobs.ashbyhq.com/ashby/{ASHBY_JOB}")
    assert net.connected == []


def test_ashby_null_job_falls_back_to_the_board_listing():
    board = {"jobs": [{"id": ASHBY_JOB, "title": "Platform Engineer", "location": "Berlin", "isRemote": False}]}
    net = ashby_net(job=js({"data": {"jobPosting": None}}), extra={"api.ashbyhq.com/posting-api/job-board/ashby": js(board)})
    out = net.derive(f"https://jobs.ashbyhq.com/ashby/{ASHBY_JOB}")
    assert (out["role"], out["location"], out["source"], out["company"], out["guessed_company"]) == ("Platform Engineer", "Berlin", "ashby", "Ashby", True)
    assert [(c["method"], c["host"]) for c in net.connected] == [("POST", "jobs.ashbyhq.com"), ("GET", "api.ashbyhq.com")]


def test_ashby_null_job_and_no_listing_fall_back_to_the_page_then_the_address():
    net = ashby_net(job=js({"data": {"jobPosting": None}}), extra={f"jobs.ashbyhq.com/ashby/{ASHBY_JOB}": page(ld(POSTING))})
    assert net.derive(f"https://jobs.ashbyhq.com/ashby/{ASHBY_JOB}")["source"] == "json-ld"
    bare = ashby_net(job=js({"data": {"jobPosting": None}}))
    out = bare.derive(f"https://jobs.ashbyhq.com/ashby/{ASHBY_JOB}")
    assert out["source"] == "link" and out["guessed_company"] and out["guessed_role"]
    assert [c["method"] for c in bare.connected] == ["POST", "GET", "GET"]    # the org question is never asked for a missing job


def test_ashby_org_failure_keeps_the_job_and_marks_the_company_as_a_guess():
    for org in (Resp(b"{}", status=500, ctype="application/json"), js({"data": {"organization": None}}), js({"errors": [{"message": "x"}]}),
                Resp(b"not json", ctype="application/json"), js({"data": {"organization": {"name": None}}})):
        net = ashby_net(org=org)
        out = net.derive(f"https://jobs.ashbyhq.com/some-board/{ASHBY_JOB}")
        assert (out["company"], out["guessed_company"], out["role"], out["source"]) == ("Some Board", True, "Engineering Manager - EU", "ashby")
        assert [c["method"] for c in net.connected] == ["POST", "POST"]


def test_ashby_remote_workplace_without_the_word_in_the_place():
    job = {"data": {"jobPosting": {"id": ASHBY_JOB, "title": "Analyst", "locationName": "Toronto", "workplaceType": "Remote"}}}
    assert ashby_net(job=js(job)).derive(f"https://jobs.ashbyhq.com/ashby/{ASHBY_JOB}")["location"] == "Remote (Toronto)"
    onsite = {"data": {"jobPosting": {"id": ASHBY_JOB, "title": "Analyst", "locationName": "Toronto", "workplaceType": "OnSite"}}}
    assert ashby_net(job=js(onsite)).derive(f"https://jobs.ashbyhq.com/ashby/{ASHBY_JOB}")["location"] == "Toronto"


def test_ashby_answer_for_a_different_job_is_not_trusted():
    other = {"data": {"jobPosting": {"id": "11111111-2222-4333-8444-555555555555", "title": "Someone Else", "locationName": "X"}}}
    out = ashby_net(job=js(other)).derive(f"https://jobs.ashbyhq.com/ashby/{ASHBY_JOB}")
    assert out["role"] != "Someone Else"


@pytest.mark.parametrize("status", [301, 302, 303, 307, 308])
def test_ashby_post_never_follows_a_redirect(status):
    to = "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting"
    net = ashby_net(job=redirect(to, status), org=redirect("http://169.254.169.254/", status))
    out = net.derive(f"https://jobs.ashbyhq.com/ashby/{ASHBY_JOB}")
    assert out["source"] == "link"                                            # the redirect counted as a plain failure
    assert [c["target"] for c in posts(net)] == ["/api/non-user-graphql?op=ApiJobPosting"]       # asked once, not re-sent anywhere
    assert not any(c["host"] == "169.254.169.254" for c in net.connected)


def test_ashby_post_redirect_to_a_private_address_does_not_even_resolve_it():
    net = ashby_net(job=redirect("http://127.0.0.1:8765/x", 307))
    net.derive(f"https://jobs.ashbyhq.com/ashby/{ASHBY_JOB}")
    assert net.resolved.count("127.0.0.1") == 0 and all(c["host"] != "127.0.0.1" for c in net.connected)


def test_ashby_oversize_answer_is_refused_and_never_read_past_the_cap():
    big = Resp(b'{"data":{"jobPosting":{"id":"' + ASHBY_JOB.encode() + b'","title":"' + b"x" * 5_000_000 + b'"}}}', ctype="application/json")
    net = ashby_net(job=big)
    out = net.derive(f"https://jobs.ashbyhq.com/ashby/{ASHBY_JOB}")
    assert big.pos <= joblink.MAX_BYTES and big.closed
    assert out["source"] == "link"


@pytest.mark.parametrize("ctype", ["text/html", "text/plain", "application/ld+json", "application/octet-stream", "application/jsonp", ""])
def test_ashby_post_answer_must_be_application_json(ctype):
    wrong = Resp(json.dumps(ASHBY_JOB_ANSWER).encode(), ctype=ctype)
    net = ashby_net(job=wrong)
    out = net.derive(f"https://jobs.ashbyhq.com/ashby/{ASHBY_JOB}")
    assert wrong.read_calls == 0 and wrong.closed
    assert out["source"] == "link"


def test_ashby_json_content_type_with_a_charset_is_fine():
    net = ashby_net(job=js(ASHBY_JOB_ANSWER, ctype="Application/JSON; charset=utf-8"))
    assert net.derive(f"https://jobs.ashbyhq.com/ashby/{ASHBY_JOB}")["role"] == "Engineering Manager - EU"


def test_ashby_post_error_status_and_timeout_fall_back():
    for status in (400, 403, 404, 429, 500, 204):
        net = ashby_net(job=Resp(b"{}", status=status, ctype="application/json"))
        assert net.derive(f"https://jobs.ashbyhq.com/ashby/{ASHBY_JOB}")["source"] == "link"


def test_ashby_post_shares_the_total_clock(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(joblink.time, "monotonic", lambda: clock[0])
    slow = Resp(json.dumps(ASHBY_JOB_ANSWER).encode(), ctype="application/json", on_read=lambda: clock.__setitem__(0, clock[0] + 9))
    net = ashby_net(job=slow)
    out = net.derive(f"https://jobs.ashbyhq.com/ashby/{ASHBY_JOB}")
    assert out["source"] == "link" and slow.closed
    assert len(posts(net)) == 1


SLUG_ATTACKS = ['x","jobPostingId":"1', 'a"}) { id } #', "a b", "a/../b", "a\nb", "../x", "a%22b", 'a"b', "-lead", "a" * 82, "a;b", "a{b}", "a\\b",
                "a\u0000b"]
ID_ATTACKS = ['7458d4e9-da2e-47bd-98cb-adfda43d42b2"}', '7458d4e9-da2e-47bd-98cb-adfda43d42b2\n', "7458d4e9-da2e-47bd-98cb-adfda43d42b2 ",
              "-" * 36, "7458d4e9da2e47bd98cbadfda43d42b2", "7458d4e9-da2e-47bd-98cb-adfda43d42b2-extra", '"},"x":{"a":"', "g458d4e9-da2e-47bd-98cb-adfda43d42b2",
              "{{7458d4e9-da2e-47bd-98cb-adfda43d42b}}", "7458d4e9-da2e-47bd-98cb-adfda43d42b2\u0000"]


@pytest.mark.parametrize("slug", SLUG_ATTACKS)
def test_ashby_slug_injection_never_reaches_a_request(slug):
    fetcher = joblink._Fetcher(resolver=lambda h, t: pytest.fail("resolved"), transport=lambda *a, **k: pytest.fail("connected"))
    assert joblink._ashby_posting(fetcher, slug, ASHBY_JOB) is None


@pytest.mark.parametrize("job", ID_ATTACKS)
def test_ashby_job_id_injection_never_reaches_a_request(job):
    fetcher = joblink._Fetcher(resolver=lambda h, t: pytest.fail("resolved"), transport=lambda *a, **k: pytest.fail("connected"))
    assert joblink._ashby_posting(fetcher, "ashby", job) is None


@pytest.mark.parametrize("tail", ID_ATTACKS[:4] + ["%22%7D", "..%2f..%2f", "7458d4e9-da2e-47bd-98cb-adfda43d42b2%0a"])
def test_ashby_job_id_injection_through_the_address_makes_no_post(tail):
    net = ashby_net()
    try:
        net.derive(f"https://jobs.ashbyhq.com/ashby/{tail.replace(' ', '%20').replace(chr(10), '%0a')}")
    except joblink.JobLinkError:
        pass                                                                  # refused outright: also fine
    assert posts(net) == []


def test_ashby_slug_injection_through_the_address_makes_no_post():
    for slug in ("a%22b", "a%20b", "a%0ab", "x%22%2c%22y", "..%2fx", "a%5cb"):
        net = ashby_net()
        net.derive(f"https://jobs.ashbyhq.com/{slug}/{ASHBY_JOB}")
        assert posts(net) == [], slug


def test_post_json_accepts_only_the_two_fixed_operations():
    f = joblink._Fetcher(resolver=lambda h, t: pytest.fail("resolved"), transport=lambda *a, **k: pytest.fail("connected"))
    for op in ("", "x", "/api/other", "https://evil.example/", "job\n", None):
        with pytest.raises(joblink._FetchFailed):
            f.post_json(op, {})


def test_post_body_is_ascii_json_built_with_json_dumps():
    net = ashby_net()
    f = joblink._Fetcher(net.resolver, net.transport)
    f.post_json("job", {"variables": {"jobPostingId": "é\u2028\"}"}})
    sent = net.connected[0]["body"]
    assert isinstance(sent, bytes) and sent.isascii()
    assert json.loads(sent) == {"variables": {"jobPostingId": "é\u2028\"}"}}


def test_the_real_transport_sends_a_post_with_a_body_and_length_to_the_pinned_address():
    import http.server
    import threading

    seen = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            raw = self.rfile.read(int(self.headers["Content-Length"]))
            seen.update(host=self.headers["Host"], ctype=self.headers["Content-Type"], length=self.headers["Content-Length"], body=raw,
                        cookie=self.headers["Cookie"], path=self.path)
            body = b'{"ok": true}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    payload = b'{"a": 1}'
    try:
        resp = joblink._transport("http", "jobs.example.test", ["127.0.0.1"], server.server_port, "/api/x?op=Y",
                                  {"User-Agent": joblink.USER_AGENT, "Content-Type": "application/json", "Content-Length": str(len(payload))},
                                  5, method="POST", body=payload)
        assert resp.status == 200 and resp.read(100) == b'{"ok": true}'
        resp.close()
    finally:
        server.shutdown()
    assert seen["body"] == payload and seen["ctype"] == "application/json" and seen["length"] == str(len(payload))
    assert seen["host"].startswith("jobs.example.test") and seen["cookie"] is None and seen["path"] == "/api/x?op=Y"


def test_the_real_transport_defaults_to_get(monkeypatch):
    methods = []

    class Conn:
        def request(self, method, target, body=None, headers=None):
            methods.append((method, body))
            raise OSError("stop")

        def close(self):
            pass

    monkeypatch.setattr(joblink, "_pinned", lambda *a: Conn())
    with pytest.raises(joblink._FetchFailed):
        joblink._transport("https", "example.com", [PUBLIC], 443, "/", {}, 5)
    assert methods == [("GET", None)]


def test_get_requests_carry_no_method_or_body_to_the_transport():
    net = Net({"example.com/job": page(head="<title>Cook</title>")})
    net.derive("https://example.com/job")
    assert net.connected[0]["method"] == "GET" and net.connected[0]["body"] is None


# -- SmartRecruiters places --------------------------------------------------------------------------------------

SR_LIVE = {"id": "744000159888121", "name": "Software Engineer", "company": {"identifier": "ServiceNow", "name": "ServiceNow"},
           "location": {"city": "Hyderabad", "country": "in", "address": "Plot 12, Hitech City Road", "postalCode": "500081",
                        "remote": False, "hybrid": True, "fullLocation": "Hyderabad, , India"}}


def sr_derive(location, **top):
    api = {**SR_LIVE, "location": location, **top}
    net = Net({"api.smartrecruiters.com/v1/companies/ServiceNow/postings/744000159888121": Resp(json.dumps(api).encode(), ctype="application/json")})
    return net.derive("https://jobs.smartrecruiters.com/ServiceNow/744000159888121-software-engineer")


def test_smartrecruiters_live_posting_has_a_clean_place():
    out = sr_derive(SR_LIVE["location"])
    assert out == {"company": "ServiceNow", "role": "Software Engineer", "location": "Hyderabad, India",
                   "url": "https://jobs.smartrecruiters.com/ServiceNow/744000159888121-software-engineer", "source": "smartrecruiters",
                   "guessed_company": False, "guessed_role": False}
    assert "Plot 12" not in json.dumps(out) and "500081" not in json.dumps(out)


def test_smartrecruiters_place_edge_cases():
    base = {k: v for k, v in SR_LIVE["location"].items() if k != "fullLocation"}
    assert sr_derive({**base, "fullLocation": " Toronto ,,  Ontario ,   Canada, "})["location"] == "Toronto, Ontario, Canada"
    assert sr_derive({**base, "remote": True})["location"] == "Remote"
    assert sr_derive({**base, "remote": True, "fullLocation": "Hyderabad, , India"})["location"] == "Remote"
    assert sr_derive({**base, "fullLocation": ", ,"})["location"] == "Hyderabad, IN"                      # nothing usable: the parts, code in capitals
    assert sr_derive({"country": "in"})["location"] == "IN"                                                # never a bare lowercase code
    assert sr_derive({"fullLocation": "in"})["location"] == "IN"
    assert sr_derive({"city": "Ottawa", "region": "ON", "country": "ca"})["location"] == "Ottawa, ON, CA"
    assert sr_derive({"address": "1 Secret Street", "postalCode": "K1A 0B1"})["location"] == ""
    assert sr_derive({"fullLocation": "<b>Pune</b>,  India"})["location"] == "Pune, India"


# -- the route ---------------------------------------------------------------------------------------------------

@pytest.fixture
def client(tmp_path, monkeypatch):
    net = Net({"acme.com/jobs/1": page(ld(POSTING)), "acme.com/bare": page("<p>x</p>")})
    monkeypatch.setattr(joblink, "_resolve", net.resolver)
    monkeypatch.setattr(joblink, "_transport", net.transport)
    c = TestClient(create_app(tmp_path / "t.db"), base_url="http://127.0.0.1:8765", follow_redirects=False)
    c.net = net
    return c


def test_route_returns_the_fields(client):
    r = client.post("/app/derive", data={"url": "https://acme.com/jobs/1?utm_source=x"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/json")
    assert r.json() == {"company": "Acme Corp", "role": "Senior Data Analyst", "location": "Toronto, ON, CA", "url": "https://acme.com/jobs/1",
                        "source": "json-ld", "guessed_company": False, "guessed_role": False}


@pytest.mark.parametrize("url", ["", "ftp://acme.com/x", "http://127.0.0.1:8765/", "http://169.254.169.254/", "http://u:p@acme.com/", "javascript:alert(1)"])
def test_route_rejects_bad_links_with_a_fixed_message(client, url):
    r = client.post("/app/derive", data={"url": url})
    assert r.status_code == 400 and list(r.json()) == ["error"]
    assert r.json()["error"] in (joblink.MSG_INVALID, joblink.MSG_BLOCKED, joblink.MSG_NOTHING)
    assert client.net.connected == []


def test_route_without_the_field_is_a_400_not_a_422(client):
    assert client.post("/app/derive").status_code == 400


def test_route_is_post_only(client):
    assert client.get("/app/derive?url=https://acme.com/jobs/1").status_code in (404, 405, 422)
    assert client.net.connected == []


def test_route_goes_through_the_local_guard(client, tmp_path):
    data = {"url": "https://acme.com/jobs/1"}
    assert client.post("/app/derive", data=data, headers={"origin": "https://evil.example.com"}).status_code == 403
    assert client.post("/app/derive", data=data, headers={"origin": "http://127.0.0.1:9999"}).status_code == 403
    assert client.post("/app/derive", data=data, headers={"sec-fetch-site": "cross-site"}).status_code == 403
    assert client.post("/app/derive", data=data, headers={"host": "evil.example.com"}).status_code == 403
    assert client.net.connected == []
    assert client.post("/app/derive", data=data, headers={"origin": "http://127.0.0.1:8765", "sec-fetch-site": "same-origin"}).status_code == 200
    foreign = TestClient(create_app(tmp_path / "t2.db"), base_url="http://example.com", follow_redirects=False)
    assert foreign.post("/app/derive", data=data).status_code == 403


def test_route_never_returns_the_fetched_body_or_error_text(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(joblink, "derive", boom)
    r = client.post("/app/derive", data={"url": "https://acme.com/jobs/1"})
    assert r.status_code == 400 and "secret" not in r.text


# -- the form and the stored link --------------------------------------------------------------------------------

def test_add_form_has_the_link_tools(client):
    html = client.get("/").text
    assert 'id="add-link"' in html and "Paste a job link" in html and ">Fill in<" in html
    assert 'name="url"' in html and "Posting link (optional)" in html
    assert 'role="status"' in html and 'aria-busy="false"' in html
    script = html[html.index("the server reads the posting"):]
    script = script[:script.index("</script>")]
    assert "innerHTML" not in script and "insertAdjacentHTML" not in script
    assert "textContent" in script and "/app/derive" in script and "Guessed from the link: check it" in script


def add(client, **extra):
    return client.post("/app/add", data={"company": "Acme", "role": "Analyst", "stage": "Applied", **extra})


def test_add_stores_and_shows_the_link(client, tmp_path):
    r = add(client, url="https://acme.com/jobs/1")
    assert r.status_code == 303
    conn = db.connect(tmp_path / "t.db")
    assert conn.execute("SELECT url FROM applications").fetchone()["url"] == "https://acme.com/jobs/1"
    detail = client.get(r.headers["location"]).text
    assert re.search(r'<a href="https://acme.com/jobs/1" target="_blank" rel="noopener noreferrer">Open posting</a>', detail)
    panel = client.get("/app/1/panel").text
    assert 'href="https://acme.com/jobs/1"' in panel and 'rel="noopener noreferrer"' in panel and "Open posting" in panel
    assert 'href="https://acme.com/jobs/1"' in client.get("/?open=1").text
    conn.close()


def test_add_without_a_link_works_as_before(client, tmp_path):
    assert add(client).status_code == 303
    assert add(client, url="").status_code == 303
    conn = db.connect(tmp_path / "t.db")
    assert [r["url"] for r in conn.execute("SELECT url FROM applications ORDER BY id")] == [None, None]
    assert "Open posting" not in client.get("/app/1").text and "Open posting" not in client.get("/app/1/panel").text
    conn.close()


HOSTILE = ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>alert(1)</script>", '"><script>alert(1)</script>',
           'https://acme.com/"><script>alert(1)</script>', "https://acme.com/ onmouseover=alert(1)", "vbscript:x", "//acme.com/x",
           "https://user:pw@acme.com/", "ftp://acme.com/x", "https://" + "a" * 600 + ".com/"]


@pytest.mark.parametrize("value", HOSTILE)
def test_hostile_links_are_not_stored_or_linked(client, tmp_path, value):
    assert add(client, url=value).status_code == 303
    conn = db.connect(tmp_path / "t.db")
    assert conn.execute("SELECT url FROM applications").fetchone()["url"] is None
    conn.execute("UPDATE applications SET url = ?", (value,))        # and even a value that got in some other way
    conn.commit()
    for page_html in (client.get("/app/1").text, client.get("/app/1/panel").text, client.get("/?open=1").text):
        assert "<script>alert(1)" not in page_html
        assert "Open posting" not in page_html
        assert not re.search(r'<a [^>]*href="(javascript|data|vbscript):', page_html, re.I)
    conn.close()


def test_edit_sets_clears_and_ignores_bad_links(client, tmp_path):
    add(client)
    conn = db.connect(tmp_path / "t.db")
    url = lambda: conn.execute("SELECT url FROM applications").fetchone()["url"]  # noqa: E731
    client.post("/app/1/edit", data={"company": "Acme", "role": "Analyst", "url": "https://acme.com/jobs/2"})
    assert url() == "https://acme.com/jobs/2"
    client.post("/app/1/edit", data={"company": "Acme", "role": "Analyst", "url": "javascript:alert(1)"})
    assert url() == "https://acme.com/jobs/2"                         # quietly ignored
    client.post("/app/1/edit", data={"company": "Acme", "role": "Analyst"})
    assert url() == "https://acme.com/jobs/2"                         # a form without the field leaves it alone
    client.post("/app/1/edit", data={"company": "Acme", "role": "Analyst", "url": "  "})
    assert url() is None
    conn.close()


# -- the column and the export -----------------------------------------------------------------------------------

OLD_SCHEMA = """
CREATE TABLE applications (id INTEGER PRIMARY KEY, company TEXT NOT NULL, company_key TEXT NOT NULL, role TEXT NOT NULL,
    role_key TEXT NOT NULL, stage TEXT NOT NULL, stage_at TEXT, applied_at TEXT, last_activity TEXT,
    locked INTEGER NOT NULL DEFAULT 0, manual INTEGER NOT NULL DEFAULT 0);
INSERT INTO applications (company, company_key, role, role_key, stage, stage_at, applied_at, last_activity)
VALUES ('Old Co', 'oldco', 'Analyst', 'analyst', 'Applied', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
"""


def test_an_existing_database_gets_the_column_and_keeps_its_rows(tmp_path):
    path = tmp_path / "old.db"
    raw = sqlite3.connect(path)
    raw.executescript(OLD_SCHEMA)
    raw.commit()
    raw.close()
    conn = db.connect(path)
    assert "url" in {r["name"] for r in conn.execute("PRAGMA table_info(applications)")}
    row = conn.execute("SELECT * FROM applications").fetchone()
    assert (row["company"], row["url"]) == ("Old Co", None)
    conn.close()
    again = db.connect(path)                                           # connecting again must not try to add it twice
    assert [r["name"] for r in again.execute("PRAGMA table_info(applications)")].count("url") == 1
    again.close()


def test_an_old_database_works_through_the_app(tmp_path):
    path = tmp_path / "old2.db"
    raw = sqlite3.connect(path)
    raw.executescript(OLD_SCHEMA)
    raw.commit()
    raw.close()
    c = TestClient(create_app(path), base_url="http://127.0.0.1:8765", follow_redirects=False)
    assert "Old Co" in c.get("/").text and c.get("/app/1").status_code == 200
    assert c.post("/app/add", data={"company": "New", "stage": "Applied", "url": "https://x.example.com/j"}).status_code == 303
    assert "Open posting" in c.get("/app/2").text


def test_create_application_takes_a_url(tmp_path):
    conn = db.connect(tmp_path / "t.db")
    app_id = db.create_application(conn, "A", "a", "R", "r", "Applied", "2026-01-01T00:00:00Z", url="https://a.example.com/j")
    other = db.create_application(conn, "B", "b", "R", "r", "Applied", "2026-01-01T00:00:00Z")
    assert conn.execute("SELECT url FROM applications WHERE id = ?", (app_id,)).fetchone()["url"] == "https://a.example.com/j"
    assert conn.execute("SELECT url FROM applications WHERE id = ?", (other,)).fetchone()["url"] is None
    conn.close()


def test_export_includes_the_url_column(tmp_path):
    spec = importlib.util.spec_from_file_location("export_json", Path(__file__).resolve().parent.parent / "scripts" / "export_json.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    conn = db.connect(tmp_path / "t.db")
    with conn:
        db.create_application(conn, "A", "a", "R", "r", "Applied", "2026-01-01T00:00:00Z", url="https://a.example.com/j")
    conn.close()
    rows = mod.export(tmp_path / "t.db")["tables"]["applications"]
    assert rows[0]["url"] == "https://a.example.com/j"
    old = tmp_path / "old.db"
    raw = sqlite3.connect(old)
    raw.executescript(OLD_SCHEMA)
    raw.commit()
    raw.close()
    assert "url" not in mod.export(old)["tables"]["applications"][0]      # an export of a not-yet-opened database still works


def test_stored_url_rules():
    ok = ["https://a.example.com/j?x=1", "http://a.example.com/", "HTTPS://a.example.com/j"]
    bad = [None, "", "  ", "javascript:alert(1)", "data:x", "https://", "https://u:p@a.example.com/", 'https://a.example.com/"x', "https://a.example.com/a b",
           "https://a.example.com:99999/", "x" * 501, "https://a.example.com/" + "x" * 500]
    assert all(joblink.stored_url(u) == u for u in ok)
    assert all(joblink.stored_url(u) is None for u in bad)


def test_the_connect_step_refuses_private_literals_even_if_given_one_directly():
    # Defence in depth: the fetcher must not rely on parse_url having vetted a literal address.
    f = joblink._Fetcher(resolver=lambda host, timeout: [PUBLIC], transport=lambda *a, **k: Resp(b""))
    for literal in ("127.0.0.1", "10.0.0.5", "169.254.169.254", "::1", "::ffff:127.0.0.1"):
        with pytest.raises(joblink.JobLinkError):
            f.addresses(literal)
    assert f.addresses("93.184.216.34") == ["93.184.216.34"]
