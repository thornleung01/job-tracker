"""Work out the company, role and place of a job from a link to its posting.

The server (unlike a browser page) can read any public page, so this reads what career sites publish for search
engines: the known board APIs (Greenhouse, Lever, Ashby, SmartRecruiters), the JSON-LD "JobPosting" data, Open Graph
tags, then the page title, and last of all a guess from the address itself.

Everything fetched is untrusted. The address a person pastes is also untrusted: this must never become a way to reach
the machine's own services or the local network. So every hop of a fetch resolves the host itself, refuses any address
that is not globally routable, and connects to the address it checked (so DNS cannot swap it in between). Nothing
fetched, and no error text, is ever handed back: only the derived fields and a short fixed message.
"""
from __future__ import annotations

import codecs
import concurrent.futures
import html
import http.client
import ipaddress
import json
import re
import socket
import ssl
import time
import unicodedata
from typing import Callable
from urllib.parse import parse_qsl, quote, unquote, urlencode, urljoin, urlsplit, urlunsplit

from bs4 import BeautifulSoup

from .jobs import feeds

MAX_URL = 2000          # longest address accepted from the page
MAX_STORED_URL = 500    # longest address kept with an application
MAX_REDIRECTS = 4
MAX_BYTES = 1_000_000
TOTAL_TIMEOUT = 8.0     # seconds for everything one "Fill in" does
ALLOWED_PORTS = {80, 443}
USER_AGENT = "JobTracker/1.0 (+personal use)"
PAGE_TYPES = {"text/html", "application/json", "application/ld+json"}
ASHBY_HOST = "jobs.ashbyhq.com"      # the one host a POST may go to
_ASHBY_TARGETS = {"job": "/api/non-user-graphql?op=ApiJobPosting",
                  "organization": "/api/non-user-graphql?op=ApiOrganizationFromHostedJobsPageName"}
LIMITS = {"company": 60, "role": 90, "location": 80}

# Messages are fixed on purpose: nothing from the network or from an exception reaches the person.
MSG_INVALID = "That doesn't look like a web link. Paste the full address, starting with https://."
MSG_BLOCKED = "That link points somewhere this app won't open. Use the public address of the job posting."
MSG_NOTHING = "Couldn't read anything from that link. Fill the form in by hand."


class JobLinkError(ValueError):
    """Safe to show: the message is one of the fixed ones above."""


class _FetchFailed(Exception):
    """The page couldn't be read (timeout, error status, wrong type). Never shown, the address is used instead."""


# -- the address ------------------------------------------------------------------------------------------------

_TRACKING = re.compile(
    r"^(utm_.*|gclid|gclsrc|dclid|fbclid|msclkid|mc_cid|mc_eid|igshid|_hsenc|_hsmi|hsa_.*|gh_src|lever-.*|trk|trkinfo|"
    r"trackingid|refid|ref|referrer|src|source|vero_id|vero_conv|_ga|yclid|twclid|li_fat_id|campaign|cid)$", re.I)
_NUMERIC_HOST = re.compile(r"^(0x[0-9a-f]*|\d+)(\.(0x[0-9a-f]*|\d+)){0,3}$", re.I)   # 2130706433, 0x7f.1, 0177.0.0.1, 127.1
_BAD_URL_CHARS = re.compile(r"[\x00-\x20\x7f\"<>\\^`{}]")
_HOST_OK = re.compile(r"^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)*$")


def _is_global(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """True only for an address that is reachable on the public internet."""
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:                     # ::ffff:127.0.0.1 is 127.0.0.1
            return _is_global(ip.ipv4_mapped)
        if ip.sixtofour is not None:                       # 2002:7f00:1:: carries 127.0.0.1
            return _is_global(ip.sixtofour)
        if ip.teredo is not None:
            return all(_is_global(a) for a in ip.teredo)
        if ip in ipaddress.ip_network("64:ff9b::/96"):     # NAT64 carries an IPv4 address in the last 32 bits
            return _is_global(ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF))
        if ip in ipaddress.ip_network("64:ff9b:1::/48") or ip in ipaddress.ip_network("100::/64"):
            return False
    return bool(ip.is_global) and not (ip.is_multicast or ip.is_loopback or ip.is_link_local or ip.is_private
                                       or ip.is_reserved or ip.is_unspecified)


def parse_url(url: str) -> tuple[str, str, int, str]:
    """(scheme, host, port, path and query) for an address worth fetching, else JobLinkError.

    Only http and https, no sign-in details, a real host, port 80 or 443. Hosts written as numbers in any form
    (decimal, hex, octal, short) are refused outright, as are single-word hosts like `localhost` or `intranet`."""
    url = (url or "").strip()
    if not url or len(url) > MAX_URL or _BAD_URL_CHARS.search(url):
        raise JobLinkError(MSG_INVALID)
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        raise JobLinkError(MSG_INVALID) from None
    if parts.scheme.lower() not in ("http", "https") or not parts.netloc:
        raise JobLinkError(MSG_INVALID)
    if "@" in parts.netloc or parts.username is not None or parts.password is not None:
        raise JobLinkError(MSG_INVALID)
    scheme = parts.scheme.lower()
    port = (443 if scheme == "https" else 80) if port is None else port
    if port not in ALLOWED_PORTS:
        raise JobLinkError(MSG_BLOCKED)
    host = (parts.hostname or "").rstrip(".").lower()
    if not host or "%" in host:
        raise JobLinkError(MSG_INVALID)
    if not host.isascii():
        # Normalise first: the idna codec also treats fullwidth dots and digits as ordinary ones, so "127。0。0。1" turns
        # into 127.0.0.1. Every check below must see the host as it will actually be connected to.
        try:
            host = host.encode("idna").decode("ascii").rstrip(".").lower()
        except UnicodeError:
            raise JobLinkError(MSG_INVALID) from None
        if not host:
            raise JobLinkError(MSG_INVALID)
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if not _is_global(literal):
            raise JobLinkError(MSG_BLOCKED)
        return scheme, host, port, _target(parts)
    if _NUMERIC_HOST.match(host) or host.rsplit(".", 1)[-1].isdigit():
        raise JobLinkError(MSG_BLOCKED)                       # a number written the odd way, or a numeric "top level"
    if "." not in host or host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".lan", ".home", ".corp")):
        raise JobLinkError(MSG_BLOCKED)
    if not _HOST_OK.match(host) or len(host) > 253:
        raise JobLinkError(MSG_INVALID)
    return scheme, host, port, _target(parts)


def _target(parts) -> str:
    path = parts.path or "/"
    return path + ("?" + parts.query if parts.query else "")


def clean_url(url: str) -> str:
    """The address without tracking parameters or a #fragment. Raises JobLinkError when it can't be fetched."""
    parse_url(url)
    parts = urlsplit(url.strip())
    pairs = parse_qsl(parts.query, keep_blank_values=True)
    kept = [(k, v) for k, v in pairs if not _TRACKING.match(k)]
    query = urlencode(kept) if len(kept) != len(pairs) else parts.query     # only rewritten when something was removed
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path, query, ""))


def stored_url(url: str | None) -> str | None:
    """The address as it may be kept and linked: http(s), no sign-in details, no odd characters, at most 500 characters.
    None for anything else (javascript:, data:, a pasted script, ...). Used on the way in and again when drawing a link."""
    url = (url or "").strip()
    if not url or len(url) > MAX_STORED_URL or _BAD_URL_CHARS.search(url):
        return None
    try:
        parts = urlsplit(url)
        parts.port
    except ValueError:
        return None
    if parts.scheme.lower() not in ("http", "https") or not parts.hostname or "@" in parts.netloc:
        return None
    return url


def _shorten_for_storage(url: str) -> str:
    if len(url) <= MAX_STORED_URL:
        return url
    bare = url.split("?", 1)[0]
    return bare if len(bare) <= MAX_STORED_URL else ""


# -- the network ------------------------------------------------------------------------------------------------

def _resolve(host: str, timeout: float) -> list[str]:
    """Every address the name has. getaddrinfo can't be interrupted, so it runs on a thread we stop waiting for."""
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    try:
        infos = pool.submit(socket.getaddrinfo, host, None, 0, socket.SOCK_STREAM).result(timeout=max(timeout, 0.05))
    except (OSError, concurrent.futures.TimeoutError):
        raise _FetchFailed from None
    finally:
        pool.shutdown(wait=False)
    seen: list[str] = []
    for info in infos:
        ip = info[4][0].split("%")[0]
        if ip not in seen:
            seen.append(ip)
    return seen


class _Live:
    """A response being read from a socket we opened to a checked address."""

    def __init__(self, conn: http.client.HTTPConnection, resp: http.client.HTTPResponse):
        self._conn, self._resp = conn, resp
        self.status = resp.status
        self.headers = {k.lower(): v for k, v in resp.getheaders()}

    def read(self, n: int) -> bytes:
        return self._resp.read(n)

    def close(self) -> None:
        try:
            self._conn.close()
        except OSError:
            pass


def _pinned(scheme: str, host: str, ip: str, port: int, timeout: float):
    """An HTTP(S) connection that talks to `ip` but is still *for* `host`: the Host header, the TLS server name and the
    certificate check all use the name, while the socket goes only to the address that was checked."""
    class Pinned(http.client.HTTPSConnection if scheme == "https" else http.client.HTTPConnection):
        def connect(self):
            sock = socket.create_connection((ip, port), timeout=timeout)
            if scheme == "https":
                try:
                    sock = ssl.create_default_context().wrap_socket(sock, server_hostname=host)
                except Exception:
                    sock.close()
                    raise
            self.sock = sock
    return Pinned(host, port, timeout=timeout)


def _transport(scheme: str, host: str, ips: list[str], port: int, target: str, headers: dict, timeout: float,
               method: str = "GET", body: bytes | None = None):
    """Open `target` on one of `ips` (already checked) and return the response, headers read and body not yet.
    `method` and `body` are only ever passed by `_Fetcher.post_json`; every ordinary fetch is a GET without a body."""
    last: Exception | None = None
    for ip in ips:
        conn = _pinned(scheme, host, ip, port, timeout)
        try:
            conn.request(method, target, body=body, headers=headers)
            return _Live(conn, conn.getresponse())
        except (OSError, http.client.HTTPException, ssl.SSLError) as exc:
            last = exc
            conn.close()
    raise _FetchFailed from last


class _Fetcher:
    def __init__(self, resolver: Callable | None = None, transport: Callable | None = None, deadline: float | None = None):
        self.resolver = resolver or _resolve
        self.transport = transport or _transport
        self.deadline = deadline if deadline is not None else time.monotonic() + TOTAL_TIMEOUT

    def left(self) -> float:
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise _FetchFailed
        return remaining

    def addresses(self, host: str) -> list[str]:
        """The addresses to connect to. Every one must be global: a name that has even one private answer is refused."""
        try:
            literal = ipaddress.ip_address(host)
        except ValueError:
            literal = None
        if literal is not None:
            if not _is_global(literal):                       # never trust that an earlier check already vetted a literal
                raise JobLinkError(MSG_BLOCKED)
            return [str(literal)]
        try:
            found = list(self.resolver(host, self.left()))
        except _FetchFailed:
            raise
        except Exception:
            raise _FetchFailed from None
        if not found:
            raise _FetchFailed
        ips = []
        for text in found:
            try:
                ip = ipaddress.ip_address(str(text).split("%")[0])
            except ValueError:
                raise JobLinkError(MSG_BLOCKED) from None
            if not _is_global(ip):
                raise JobLinkError(MSG_BLOCKED)
            ips.append(str(ip))
        return ips

    def get(self, url: str, accept: str = "text/html,application/json,application/ld+json;q=0.9") -> tuple[str, bytes, str, str]:
        """(content type, body, final address, charset). Redirects are followed here, by hand, checking each hop afresh."""
        headers = {"User-Agent": USER_AGENT, "Accept": accept, "Accept-Encoding": "identity", "Connection": "close"}
        for _hop in range(MAX_REDIRECTS + 1):
            scheme, host, port, target = parse_url(url)
            ips = self.addresses(host)                        # resolved once, here; the transport only ever sees these
            resp = self.transport(scheme, host, ips, port, target, headers, self.left())
            try:
                if resp.status in (301, 302, 303, 307, 308):
                    where = (resp.headers.get("location") or "").strip()
                    if not where or len(where) > MAX_URL:
                        raise _FetchFailed
                    url = urljoin(url, where)
                    continue
                if resp.status != 200:
                    raise _FetchFailed
                ctype = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
                if ctype not in PAGE_TYPES:
                    raise _FetchFailed
                body, _ = self._read_capped(resp)
                charset = re.search(r"charset=([\w-]+)", resp.headers.get("content-type") or "", re.I)
                return ctype, body, url, (charset.group(1) if charset else "")
            finally:
                resp.close()
        raise _FetchFailed                                    # too many redirects

    def _read_capped(self, resp) -> tuple[bytes, int]:
        """(the body, its size): never more than MAX_BYTES (1 MB), however much the server sends, and always inside the total deadline."""
        chunks, size = [], 0
        while size < MAX_BYTES:
            self.left()
            chunk = resp.read(min(65536, MAX_BYTES - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
        return b"".join(chunks), size

    def post_json(self, op: str, payload: dict) -> bytes:
        """POST `payload` as JSON to one of the fixed Ashby GraphQL operations and return the body.

        Everything `get` enforces applies here too: the host is checked by parse_url and every address it resolves to is
        vetted, the connection goes only to those addresses, and the total clock and 1 MB cap are shared. On top of that:
        the host and path are fixed in this file (`op` only selects between two), no redirect is ever followed (any 3xx is a
        failure, so a POST can't be bounced anywhere), the answer must be exactly application/json, and a body that fills
        the cap is refused rather than truncated."""
        target = _ASHBY_TARGETS.get(op)
        if target is None:
            raise _FetchFailed
        body = json.dumps(payload).encode("ascii")           # ensure_ascii: whatever went in, only ASCII goes out
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json", "Accept-Encoding": "identity", "Connection": "close",
                   "Content-Type": "application/json", "Content-Length": str(len(body))}
        scheme, host, port, path = parse_url("https://" + ASHBY_HOST + target)
        if (scheme, host, port) != ("https", ASHBY_HOST, 443) or path != target:
            raise _FetchFailed
        ips = self.addresses(host)
        resp = self.transport(scheme, host, ips, port, path, headers, self.left(), method="POST", body=body)
        try:
            if resp.status != 200:                            # includes every 3xx: a POST is never redirected
                raise _FetchFailed
            if (resp.headers.get("content-type") or "").split(";")[0].strip().lower() != "application/json":
                raise _FetchFailed
            body, size = self._read_capped(resp)
            if size >= MAX_BYTES:                             # too big to be one of these tiny answers
                raise _FetchFailed
            return body
        finally:
            resp.close()


# -- cleaning what was found ------------------------------------------------------------------------------------

def clean_text(value, limit: int) -> str:
    """Plain text from something that may hold markup: no tags, no control characters, one line, at most `limit`."""
    if value is None or isinstance(value, (dict, list)):
        return ""
    text = html.unescape(str(value))
    if "<" in text:
        text = BeautifulSoup(text, "html.parser").get_text(" ")
    text = "".join(" " if unicodedata.category(c) in ("Cc", "Cf", "Zl", "Zp") else c for c in text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit].rstrip(" ,;:-|")


_BOARD_WORDS = re.compile(r"\b(careers?|jobs?|job board|hiring|recruiting|apply|openings?|work with us|join us)\b", re.I)


def _company_name(text: str) -> str:
    """A site name like "Acme Careers" is the company "Acme"."""
    name = _BOARD_WORDS.sub("", clean_text(text, 120))
    return clean_text(re.sub(r"\s{2,}", " ", name).strip(" -|:·"), LIMITS["company"])


# -- reading a page ---------------------------------------------------------------------------------------------

def _walk(node):
    if isinstance(node, list):
        for item in node:
            yield from _walk(item)
    elif isinstance(node, dict):
        yield node
        for key in ("@graph", "mainEntity", "itemListElement"):
            if key in node:
                yield from _walk(node[key])


def _is_posting(node: dict) -> bool:
    kind = node.get("@type")
    return kind == "JobPosting" or (isinstance(kind, list) and "JobPosting" in kind)


def _place(address) -> str:
    if isinstance(address, str):
        return clean_text(address, LIMITS["location"])
    if not isinstance(address, dict):
        return ""
    country = address.get("addressCountry")
    if isinstance(country, dict):
        country = country.get("name")
    bits = [address.get("addressLocality"), address.get("addressRegion"), country]
    return clean_text(", ".join(clean_text(b, 40) for b in bits if isinstance(b, str) and clean_text(b, 40)), LIMITS["location"])


def _json_ld_location(node: dict) -> str:
    places = []
    locations = node.get("jobLocation")
    for loc in locations if isinstance(locations, list) else [locations]:
        if isinstance(loc, dict):
            p = _place(loc.get("address") or loc.get("name"))
            if p and p not in places:
                places.append(p)
    if not places:                                            # remote jobs often name only who may apply
        wanted = node.get("applicantLocationRequirements")
        for req in wanted if isinstance(wanted, list) else [wanted]:
            if isinstance(req, dict) and clean_text(req.get("name"), 40):
                places.append(clean_text(req.get("name"), 40))
    place = " / ".join(places[:2])
    remote = str(node.get("jobLocationType") or "").upper() == "TELECOMMUTE"
    if remote:
        place = f"Remote ({place})" if place else "Remote"
    return clean_text(place, LIMITS["location"])


def posting_in(data) -> dict | None:
    """The first JobPosting inside parsed JSON-LD (a single object, an array, or an @graph)."""
    for node in _walk(data):
        if _is_posting(node):
            org = node.get("hiringOrganization")
            name = org.get("name") if isinstance(org, dict) else org
            out = {"role": clean_text(node.get("title"), LIMITS["role"]), "company": clean_text(name, LIMITS["company"]),
                   "location": _json_ld_location(node)}
            if out["role"] or out["company"]:
                return out
    return None


def from_json_ld(soup: BeautifulSoup) -> dict | None:
    for script in soup.find_all("script", type=re.compile(r"ld\+json", re.I)):
        try:
            data = json.loads(script.string or script.get_text() or "")
        except ValueError:
            continue
        found = posting_in(data)
        if found:
            return found
    return None


def _meta(soup: BeautifulSoup, key: str) -> str:
    tag = soup.find("meta", attrs={"property": key}) or soup.find("meta", attrs={"name": key})
    return clean_text(tag.get("content"), 200) if tag and tag.get("content") else ""


_SPLIT = re.compile(r"\s+(?:\||-|–|—|·|•|:|@)\s+|\s+at\s+", re.I)
_GENERIC = re.compile(r"^(careers?|jobs?|job (board|openings?|application)|current openings|home|apply|apply now|greenhouse|lever|ashby|"
                      r"workable|workday|smartrecruiters|linkedin|indeed)$", re.I)


def _title_parts(title: str, site: str = "") -> tuple[str, str]:
    """(role, company) from a page title like "Data analyst at Acme | Careers". The company may be empty."""
    title = re.sub(r"^(job application for|apply for|careers? at|jobs? at)\s+", "", clean_text(title, 300), flags=re.I)
    parts = [p.strip() for p in _SPLIT.split(title) if p.strip()]
    site_key = re.sub(r"\W+", "", site.casefold())
    keep = []
    for p in parts:
        if _GENERIC.match(p) or (site_key and re.sub(r"\W+", "", _company_name(p).casefold()) == site_key):
            continue
        keep.append(p)
    if not keep:
        return "", ""
    if len(keep) == 1 or site:
        return keep[0], ""
    return keep[0], _company_name(keep[-1])


def _domain_company(host: str) -> str:
    """"careers.acme-labs.co.uk" -> "Acme Labs". A guess."""
    labels = [l for l in host.split(".") if l]
    if labels and labels[0] in ("www", "m"):
        labels = labels[1:]
    if len(labels) >= 3 and labels[-2] in ("co", "com", "org", "gov", "ac") and len(labels[-1]) == 2:
        base = labels[-3]
    elif len(labels) >= 2:
        base = labels[-2]
    else:
        base = labels[0] if labels else ""
    return clean_text(re.sub(r"[-_]+", " ", base).title(), LIMITS["company"])


_SLUG_SKIP = {"jobs", "job", "careers", "career", "apply", "positions", "position", "openings", "opening", "view", "en", "us",
              "ca", "gb", "details", "detail", "postings", "posting", "listing", "vacancy", "vacancies", "search", "o", "p", "j"}


def _slug_role(path: str) -> str:
    best = ""
    for seg in unquote(path).split("/"):
        words = [w for w in re.split(r"[-_+\s]+", seg) if w]
        if words and re.fullmatch(r"[0-9a-f]{8,}|[0-9a-f-]{32,}|\d+", words[0], re.I):
            words = words[1:]                                # "12345-senior-engineer" -> "senior engineer"
        if len(words) < 2 and not (words and words[0].lower() not in _SLUG_SKIP and words[0].isalpha() and len(words[0]) > 3):
            continue
        if any(re.fullmatch(r"[0-9a-f]{8,}", w, re.I) or w.isdigit() for w in words) and len(words) < 3:
            continue
        words = [w for w in words if not re.fullmatch(r"[0-9a-f]{8,}", w, re.I) and not w.isdigit()]
        if words and words[0].lower() in _SLUG_SKIP:
            continue
        if len(" ".join(words)) > len(best):
            best = " ".join(words)
    return clean_text(best.title() if best else "", LIMITS["role"])


def from_page(body: str, final_url: str) -> dict:
    """Company, role, location and where each came from, out of a page's HTML."""
    soup = BeautifulSoup(body, "html.parser")
    host = urlsplit(final_url).hostname or ""
    out = {"company": "", "role": "", "location": "", "source": "", "guessed_company": False, "guessed_role": False}

    ld = from_json_ld(soup)
    if ld:
        out.update({k: ld[k] for k in ("company", "role", "location")})
        out["source"] = "json-ld"

    site = _company_name(_meta(soup, "og:site_name"))
    if not out["company"] and site:
        out["company"], out["source"] = site, out["source"] or "open-graph"
    if not out["role"]:
        og = _meta(soup, "og:title")
        h1 = soup.find("h1")
        h1_text = clean_text(h1.get_text(" "), LIMITS["role"]) if h1 else ""
        page_title = clean_text(soup.title.get_text(" ") if soup.title else "", 300)
        for source, text in (("open-graph", og), ("h1", h1_text), ("page-title", page_title)):
            if not text:
                continue
            role, company = _title_parts(text, out["company"] or site)
            if not role:
                continue
            out["role"], out["source"] = clean_text(role, LIMITS["role"]), out["source"] or source
            # A heading is the page's own words for the job; a title that had to be split is a guess.
            out["guessed_role"] = source == "page-title" or bool(company)
            if not out["company"] and company:
                out["company"], out["guessed_company"] = company, True
            break
    if not out["company"]:
        out["company"], out["guessed_company"] = _domain_company(host), True
        out["source"] = out["source"] or "link"
    if not out["role"]:
        out["role"], out["guessed_role"] = _slug_role(urlsplit(final_url).path), True
        out["source"] = out["source"] or "link"
    return out


# -- the known job boards ---------------------------------------------------------------------------------------

_BOARD_HOSTS = {
    "greenhouse": ("boards.greenhouse.io", "job-boards.greenhouse.io"),
    "lever": ("jobs.lever.co", "jobs.eu.lever.co"),
    "ashby": ("jobs.ashbyhq.com",),
    "smartrecruiters": ("jobs.smartrecruiters.com",),
}
_TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,80}")
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
_JOB_ID = {"greenhouse": re.compile(r"\d{1,20}"), "lever": re.compile(r"[0-9a-f-]{36}", re.I),
           "ashby": _UUID, "smartrecruiters": re.compile(r"\d{6,30}")}


def _pretty(token: str) -> str:
    return clean_text(re.sub(r"[-_.]+", " ", token).title(), LIMITS["company"])


def _board_api(url: str) -> tuple[str, str, str, str] | None:
    """(platform, token, job id, address of that job in the board's own API) for a link to a known board, else None.
    The API hosts are fixed here, never taken from what was pasted."""
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    found = feeds.detect(url)
    if not found or host not in _BOARD_HOSTS.get(found[0], ()):
        return None
    platform, token = found
    segs = [unquote(s) for s in parts.path.split("/") if s]
    if not _TOKEN.fullmatch(token) or len(segs) < 2:
        return None
    raw = segs[2] if platform == "greenhouse" and len(segs) >= 3 and segs[1] == "jobs" else segs[1]
    job = re.match(r"\d+", raw).group(0) if platform == "smartrecruiters" and re.match(r"\d+", raw) else raw
    if platform == "greenhouse" and segs[1] != "jobs":
        return None
    if not _JOB_ID[platform].fullmatch(job):
        return None
    if platform == "greenhouse":
        api = f"https://boards-api.greenhouse.io/v1/boards/{quote(token)}/jobs/{job}"
    elif platform == "lever":
        api = f"https://{'api.eu.lever.co' if host == 'jobs.eu.lever.co' else 'api.lever.co'}/v0/postings/{quote(token)}/{job}"
    elif platform == "ashby":
        api = feeds.endpoint("ashby", token)
    else:
        api = f"https://api.smartrecruiters.com/v1/companies/{quote(token)}/postings/{job}"
    return platform, token, job, api


def from_board(platform: str, token: str, job: str, data) -> dict | None:
    """Fields from a board API answer, reusing the feed readers the Jobs tab uses."""
    if platform == "greenhouse":
        wrapped, name = {"jobs": [data]}, data.get("company_name")
    elif platform == "lever":
        wrapped, name = [data], None
    elif platform == "ashby":
        wrapped, name = data, None
    else:
        wrapped = {"content": [data]}
        name = (data.get("company") or {}).get("name") if isinstance(data.get("company"), dict) else None
    postings = feeds.parse(platform, token, "", wrapped)
    posting = next((p for p in postings if str(p["source_key"]).lower() == job.lower()), None)
    if not posting:
        return None
    known = clean_text(name, LIMITS["company"])
    location = clean_text(posting["location"], LIMITS["location"])
    if platform == "smartrecruiters":
        location = _smartrecruiters_place(data.get("location")) or location
    if posting["remote"] and "remote" not in location.lower():
        location = f"Remote ({location})" if location else "Remote"
    return {"company": known or _pretty(token), "role": clean_text(posting["title"], LIMITS["role"]), "location": location,
            "source": platform, "guessed_company": not known, "guessed_role": False}


def _smartrecruiters_place(loc) -> str:
    """"Hyderabad, India" from a SmartRecruiters location. Only the public place is ever used: never `address` or
    `postalCode`. `fullLocation` can have empty parts ("Hyderabad, , India"), so it is split on commas, emptied and
    tidied. A remote job is just "Remote". A bare lowercase country code ("in") is shown in capitals."""
    if not isinstance(loc, dict):
        return ""
    if loc.get("remote") is True:
        return "Remote"
    full = loc.get("fullLocation")
    pieces = full.split(",") if isinstance(full, str) else []
    if not any(clean_text(p, 40) for p in pieces):
        city, region, country = loc.get("city"), loc.get("region"), loc.get("country")
        pieces = [x for x in (city, region, country) if isinstance(x, str)]
    bits = []
    for piece in pieces:
        bit = clean_text(piece, 40)
        if len(bit) == 2 and bit.isalpha() and bit.islower():
            bit = bit.upper()
        if bit:
            bits.append(bit)
    return clean_text(", ".join(bits), LIMITS["location"])


def _graphql_data(raw: bytes, key: str):
    """data[key] from a GraphQL answer, or None when it is missing, null or not an object."""
    body = json.loads(raw.decode("utf-8", "replace"))
    inner = body.get("data") if isinstance(body, dict) else None
    found = inner.get(key) if isinstance(inner, dict) else None
    return found if isinstance(found, dict) else None


def _ashby_posting(fetcher: _Fetcher, token: str, job: str) -> dict | None:
    """Role and place from Ashby's own hosted-page GraphQL API (two tiny POSTs, however big the board is), else None.

    The board name and job id are checked here again, so nothing but a plain slug and a UUID can ever be put in a
    request, whoever calls this. The company comes from the second question; if only that one fails the company is the
    usual marked guess. Any failure other than an unsafe address returns None so the board listing is tried next."""
    if not _TOKEN.fullmatch(token) or not _UUID.fullmatch(job):
        return None
    try:
        posting = _graphql_data(fetcher.post_json("job", {
            "operationName": "ApiJobPosting",
            "variables": {"organizationHostedJobsPageName": token, "jobPostingId": job},
            "query": "query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) { "
                     "jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) "
                     "{ id title locationName workplaceType employmentType } }"}), "jobPosting")
        role = clean_text(posting.get("title"), LIMITS["role"]) if posting else ""
        if not role or (posting.get("id") and str(posting["id"]).lower() != job.lower()):
            return None
    except JobLinkError:
        raise
    except (_FetchFailed, ValueError, KeyError, TypeError, AttributeError):
        return None
    location = clean_text(posting.get("locationName"), LIMITS["location"])
    if str(posting.get("workplaceType") or "").lower() == "remote" and "remote" not in location.lower():
        location = f"Remote ({location})" if location else "Remote"
    name = ""
    try:
        org = _graphql_data(fetcher.post_json("organization", {
            "operationName": "ApiOrganizationFromHostedJobsPageName",
            "variables": {"organizationHostedJobsPageName": token, "searchContext": "JobBoard"},
            "query": "query ApiOrganizationFromHostedJobsPageName($organizationHostedJobsPageName: String!, "
                     "$searchContext: OrganizationSearchContext) { organization: organizationFromHostedJobsPageName("
                     "organizationHostedJobsPageName: $organizationHostedJobsPageName, searchContext: $searchContext) { name } }"}),
            "organization")
        name = clean_text(org.get("name"), LIMITS["company"]) if org else ""
    except JobLinkError:
        raise
    except (_FetchFailed, ValueError, KeyError, TypeError, AttributeError):
        name = ""
    return {"company": name or _pretty(token), "role": role, "location": location, "source": "ashby",
            "guessed_company": not name, "guessed_role": False}


# -- the one entry point ----------------------------------------------------------------------------------------

def derive(url: str, *, resolver: Callable | None = None, transport: Callable | None = None) -> dict:
    """company, role, location, url, source, guessed_company, guessed_role for a link to a job posting.

    Raises JobLinkError (with a fixed, safe message) when the link is not one this app will open. A page that simply
    can't be read falls back to a guess from the address itself, and says so with source "link" and the guessed flags."""
    cleaned = clean_url(url)
    fetcher = _Fetcher(resolver, transport)
    result: dict | None = None

    board = _board_api(cleaned)
    if board:
        platform, token, job, api = board
        if platform == "ashby":                              # the board listing can be huge and has no company name
            result = _ashby_posting(fetcher, token, job)
        if result is None:
            try:
                _, body, _, _ = fetcher.get(api, accept="application/json")
                result = from_board(platform, token, job, json.loads(body.decode("utf-8", "replace")))
            except JobLinkError:
                raise                                        # an unsafe hop is an answer, not something to work around
            except (_FetchFailed, ValueError, KeyError, TypeError, AttributeError):
                result = None

    if result is None:
        try:
            ctype, body, final, charset = fetcher.get(cleaned)
            if ctype == "text/html":
                text = body.decode(charset or "utf-8", "replace") if _known_codec(charset) else body.decode("utf-8", "replace")
                result = from_page(text, final)
            else:                                            # a JSON answer: read it like JSON-LD
                found = posting_in(json.loads(body.decode("utf-8", "replace")))
                result = {**found, "source": "json-ld", "guessed_company": False, "guessed_role": False} if found else None
        except JobLinkError:
            raise
        except Exception:                                    # an odd page must not take the form down
            result = None

    if result is None or not (result["company"] or result["role"]):
        _, host, _, _ = parse_url(cleaned)
        result = {"company": _domain_company(host), "role": _slug_role(urlsplit(cleaned).path), "location": "", "source": "link",
                  "guessed_company": True, "guessed_role": True}
    if not (result["company"] or result["role"]):
        raise JobLinkError(MSG_NOTHING)
    return {"company": result["company"], "role": result["role"], "location": result["location"],
            "url": _shorten_for_storage(cleaned), "source": result["source"],
            "guessed_company": bool(result["guessed_company"]), "guessed_role": bool(result["guessed_role"])}


def _known_codec(name: str) -> bool:
    try:
        codecs.lookup(name or "utf-8")
        return True
    except LookupError:
        return False
