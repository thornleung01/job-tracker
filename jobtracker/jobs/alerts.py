"""Turn LinkedIn and Indeed job-alert emails into postings.

You save a search on each site and switch on its email alert; those emails arrive in the inbox this app
already reads. Nothing is fetched from the sites and no account is used. The layouts of these emails
change now and then, so the parser looks for the stable parts (the job's link and its ID) and treats
everything else as a bonus: a layout it doesn't understand yields nothing instead of wrong data.
"""
from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

from bs4 import BeautifulSoup

from ..models import Message
from .text import looks_remote, clean_title

LINKEDIN_JOB = re.compile(r"/jobs/view/(?:[\w-]*?-)?(\d{6,})")
SEPARATORS = re.compile(r"\s*[·•|]\s*|\s+-\s+|\s+–\s+")
NOISE = re.compile(
    r"^(apply|view job|see all jobs|see more jobs|unsubscribe|easy apply|actively hiring|new|promoted|help|settings|manage|privacy|terms|"
    r"learn why|you are receiving|this email|linkedin corporation|©|\d+ (?:days?|hours?|weeks?) ago|be an early applicant)\b", re.I)


def _is_domain(domain: str, site: str) -> bool:
    return domain == site or domain.endswith("." + site)


def alert_site(msg: Message) -> str | None:
    """'linkedin' or 'indeed' when this email is a job alert from that site."""
    domain = msg.sender_domain
    subject = msg.subject.lower()
    if _is_domain(domain, "linkedin.com") and re.search(r"job alert|new jobs?|jobs? (?:for|like)|is hiring|recommended", subject + " " + msg.sender_name.lower()):
        return "linkedin"
    if _is_domain(domain, "indeed.com") and re.search(r"new .*jobs?|job alert|jobs? (?:for|in|near)|and \d+ more jobs?", subject):
        return "indeed"
    return None


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip(" \t\n·•|-–")


def _block_lines(anchor) -> list[str]:
    """The text of the smallest enclosing block that holds more than just the link, one line per piece."""
    node = anchor
    for _ in range(6):
        node = node.parent
        if node is None:
            break
        lines = [_clean(s) for s in node.get_text("\n").split("\n")]
        lines = [l for l in lines if l]
        if len(lines) >= 3 or node.name in ("table", "body"):
            return lines
    return []


def _company_and_place(title: str, lines: list[str], other_titles: set[str] = frozenset()) -> tuple[str, str]:
    # Only the few lines right after this job's own title, and never past the next job's title: when several
    # jobs share one table, the lines further down belong to the next job.
    start = lines.index(title) + 1 if title in lines else 0
    window = []
    for line in lines[start:start + 4]:
        if line in other_titles:
            break
        window.append(line)
    rest = [l for l in window if l != title and not NOISE.match(l) and len(l) < 120]
    company = place = ""
    for line in rest:
        parts = [p for p in SEPARATORS.split(line) if p]
        if len(parts) >= 2 and not company:
            company, place = _clean(parts[0]), _clean(parts[1])
            break
    if not company and rest:
        company = rest[0]
        place = next((l for l in rest[1:] if re.search(r",\s*[A-Z]{2}\b|\bremote\b|canada|united states|\bon\b$", l, re.I)), "")
    return company, place


def parse(msg: Message) -> list[dict]:
    """Postings found in one alert email. May be empty when the layout isn't understood."""
    site = alert_site(msg)
    if not site or not (msg.html or "").strip():
        return []
    soup = BeautifulSoup(msg.html, "html.parser")
    jobs: dict[str, tuple] = {}
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if site == "linkedin":
            m = LINKEDIN_JOB.search(urlparse(href).path)
            if not m:
                continue
            job_id, url = m.group(1), f"https://www.linkedin.com/jobs/view/{m.group(1)}"
        else:
            parsed = urlparse(href)
            jk = (parse_qs(parsed.query).get("jk") or [""])[0]
            if not re.fullmatch(r"[0-9a-f]{8,}", jk):
                continue
            # The sender of an alert is only a claim, so the link's host is used only when it really is Indeed's.
            host = (parsed.hostname or "").lower()
            job_id, url = jk, f"https://{host if _is_domain(host, 'indeed.com') else 'www.indeed.com'}/viewjob?jk={jk}"
        title = _clean(a.get_text(" "))
        if len(title) < 4 or NOISE.match(title) or title.lower() in {"view job", "apply"}:
            continue                       # the same job often has a second link, such as a button
        jobs.setdefault(f"{site}:{job_id}", (title, url, a))

    all_titles = {title for title, _, _ in jobs.values()}
    out = []
    for key, (title, url, anchor) in jobs.items():
        company, place = _company_and_place(title, _block_lines(anchor), all_titles - {title})
        out.append({
            "source": site, "source_key": key, "title": clean_title(title, company), "company": company, "location": place,
            "remote": looks_remote(place, title), "url": url, "description": "", "posted_at": msg.received_at.isoformat(),
            "partial": True,
        })
    return out
