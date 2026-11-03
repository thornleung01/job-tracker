"""Company career pages that publish an open job feed: Greenhouse, Lever, Ashby and SmartRecruiters."""
from __future__ import annotations

import html
import json
import re
import sqlite3
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

from .text import looks_remote

PLATFORMS = {"greenhouse": "Greenhouse", "lever": "Lever", "ashby": "Ashby", "smartrecruiters": "SmartRecruiters"}
MAX_PER_FEED = 300
TIMEOUT = 25


class SourceError(ValueError):
    """Something a person can fix, safe to show on the page."""


def detect(text: str) -> tuple[str, str] | None:
    """('greenhouse', 'acme') from a careers URL, or from the shorthand 'greenhouse:acme'."""
    text = (text or "").strip()
    short = re.fullmatch(r"(greenhouse|lever|ashby|smartrecruiters)\s*:\s*([\w.-]+)", text, re.I)
    if short:
        return short.group(1).lower(), short.group(2)
    if "://" not in text:
        text = "https://" + text
    parsed = urlparse(text)
    host, parts = (parsed.hostname or "").lower(), [p for p in parsed.path.split("/") if p]
    if host.endswith("greenhouse.io"):
        if host.startswith("boards-api") and len(parts) >= 3 and parts[1] == "boards":
            return "greenhouse", parts[2]
        if parts:
            return "greenhouse", parts[0]
    if host.endswith("lever.co") and parts:
        return "lever", parts[0]
    if host.endswith("ashbyhq.com") and parts:
        return "ashby", parts[0]
    if host.endswith("smartrecruiters.com") and parts:
        return "smartrecruiters", parts[0]
    return None


def endpoint(platform: str, token: str) -> str:
    return {
        "greenhouse": f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true",
        "lever": f"https://api.lever.co/v0/postings/{token}?mode=json",
        "ashby": f"https://api.ashbyhq.com/posting-api/job-board/{token}",
        "smartrecruiters": f"https://api.smartrecruiters.com/v1/companies/{token}/postings?limit=100",
    }[platform]


def _text(markup: str) -> str:
    return re.sub(r"\s+", " ", BeautifulSoup(html.unescape(markup or ""), "html.parser").get_text(" ")).strip()


def _iso(value) -> str | None:
    if not value:
        return None
    if isinstance(value, (int, float)):                       # Lever sends milliseconds
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc).isoformat()
    return str(value)


def _posting(platform: str, token: str, company: str, raw_id, title, location, url, description, posted, remote=False) -> dict:
    location = (location or "").strip()
    return {
        "source": f"feed:{platform}:{token}", "source_key": str(raw_id), "title": (title or "").strip(), "company": company,
        "location": location, "remote": remote or looks_remote(location, title or ""), "url": url or "",
        "description": description or "", "posted_at": _iso(posted), "partial": False,
    }


def parse(platform: str, token: str, company: str, data) -> list[dict]:
    out: list[dict] = []
    if platform == "greenhouse":
        for j in data.get("jobs", []):
            out.append(_posting(platform, token, company, j["id"], j.get("title"), (j.get("location") or {}).get("name"),
                                j.get("absolute_url"), _text(j.get("content")), j.get("updated_at")))
    elif platform == "lever":
        for j in data if isinstance(data, list) else []:
            cats = j.get("categories") or {}
            out.append(_posting(platform, token, company, j["id"], j.get("text"), cats.get("location"), j.get("hostedUrl"),
                                j.get("descriptionPlain") or _text(j.get("description")), j.get("createdAt"),
                                remote=(j.get("workplaceType") == "remote")))
    elif platform == "ashby":
        for j in data.get("jobs", []):
            out.append(_posting(platform, token, company, j["id"], j.get("title"), j.get("location"), j.get("jobUrl"),
                                j.get("descriptionPlain") or _text(j.get("descriptionHtml")), j.get("publishedAt"),
                                remote=bool(j.get("isRemote"))))
    elif platform == "smartrecruiters":
        for j in data.get("content", []):
            loc = j.get("location") or {}
            place = ", ".join(x for x in (loc.get("city"), loc.get("region"), (loc.get("country") or "").upper()) if x)
            p = _posting(platform, token, company, j["id"], j.get("name"), place, f"https://jobs.smartrecruiters.com/{token}/{j['id']}",
                         "", j.get("releasedDate"), remote=bool(loc.get("remote")))
            p["partial"] = True          # the list has no description; scored on title and place only
            out.append(p)
    return [p for p in out if p["title"]][:MAX_PER_FEED]


def fetch(platform: str, token: str, company: str, get=requests.get) -> list[dict]:
    try:
        r = get(endpoint(platform, token), timeout=TIMEOUT, headers={"Accept": "application/json", "User-Agent": "JobTracker/1.0 (personal use)"})
    except requests.RequestException:
        raise SourceError("Couldn't reach the feed. Check your internet connection.") from None
    if r.status_code == 404:
        raise SourceError(f"{PLATFORMS[platform]} has no job board called “{token}”. Check the company name in the address.")
    if not r.ok:
        raise SourceError(f"{PLATFORMS[platform]} answered with an error ({r.status_code}). Try again later.")
    try:
        return parse(platform, token, company, r.json())
    except (ValueError, KeyError, TypeError, AttributeError):
        raise SourceError(f"{PLATFORMS[platform]} sent a feed this app couldn't read.") from None


def add_source(conn: sqlite3.Connection, text: str, name: str = "", get=requests.get) -> tuple[int, int]:
    """Add a company by its careers address. Checks it works first, so a typo is caught now.
    Returns (source id, number of postings the feed has right now)."""
    found = detect(text)
    if not found:
        raise SourceError("That address isn't a supported careers page. Use a Greenhouse, Lever, Ashby or SmartRecruiters "
                          "address (for example boards.greenhouse.io/acme).")
    platform, token = found
    company = (name or "").strip() or token.replace("-", " ").replace("_", " ").title()
    postings = fetch(platform, token, company, get)          # raises with a clear message when it doesn't work
    label = f"{platform}:{token}"
    with conn:
        conn.execute("INSERT OR IGNORE INTO job_sources (kind, name, config) VALUES ('feed', ?, ?)",
                     (label, json.dumps({"platform": platform, "token": token, "company": company})))
        row = conn.execute("SELECT id FROM job_sources WHERE kind = 'feed' AND name = ?", (label,)).fetchone()
    return row["id"], len(postings)
