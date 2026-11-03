"""Adzuna job search (free API key). Only your search words and places are sent to Adzuna, never your resume."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import requests

from ..providers.base import token_persistence
from .text import looks_remote

API = "https://api.adzuna.com/v1/api/jobs/{country}/search/1"
TOKEN_FILE = "adzuna.token"
MAX_REQUESTS = 12            # per run, well inside the free allowance
MIN_INTERVAL = timedelta(hours=6)
MAX_DAYS_OLD = 14
TIMEOUT = 25


def save_credentials(app_id: str, app_key: str, profile: str = "default") -> None:
    token_persistence(TOKEN_FILE, profile).save(json.dumps({"app_id": app_id.strip(), "app_key": app_key.strip()}))


def load_credentials(profile: str = "default") -> dict | None:
    try:
        data = json.loads(token_persistence(TOKEN_FILE, profile).load() or "{}")
    except (FileNotFoundError, ValueError, OSError):
        return None
    return data if data.get("app_id") and data.get("app_key") else None


def clear_credentials(profile: str = "default") -> None:
    try:
        token_persistence(TOKEN_FILE, profile).clear()
    except (FileNotFoundError, OSError):
        pass


def queries(profile: dict) -> list[tuple[str, str, str]]:
    """(what, where, country) searches from your target titles, cities and countries. Capped."""
    titles = (profile.get("titles") or [])[:3]
    cities = (profile.get("cities") or [])[:3]
    out: list[tuple[str, str, str]] = []
    for title in titles:
        for country in profile.get("countries") or ["ca"]:
            for city in cities:
                out.append((title, city, country))
            if profile.get("remote"):
                out.append((f"{title} remote", "", country))
    return out[:MAX_REQUESTS]


def parse(results: list[dict], country: str) -> list[dict]:
    out = []
    for r in results:
        location = (r.get("location") or {}).get("display_name", "")
        out.append({
            "source": "adzuna", "source_key": f"{country}:{r['id']}", "title": (r.get("title") or "").strip(),
            "company": ((r.get("company") or {}).get("display_name") or "").strip(), "location": location,
            "remote": looks_remote(location, r.get("title", ""), r.get("description", "")), "url": r.get("redirect_url", ""),
            "description": r.get("description", ""), "posted_at": r.get("created"), "partial": False,
        })
    return out


def search(creds: dict, what: str, where: str, country: str, get=requests.get) -> list[dict]:
    params = {"app_id": creds["app_id"], "app_key": creds["app_key"], "what": what, "results_per_page": 30,
              "max_days_old": MAX_DAYS_OLD, "sort_by": "date", "content-type": "application/json"}
    if where:
        params["where"] = where
    r = get(API.format(country=country), params=params, timeout=TIMEOUT)
    if r.status_code in (401, 403):
        raise PermissionError("Adzuna didn't accept the app ID and key. Check them on the Sources tab.")
    r.raise_for_status()
    return parse(r.json().get("results", []), country)


def due(last_checked: str | None, now: datetime | None = None) -> bool:
    if not last_checked:
        return True
    now = now or datetime.now(timezone.utc)
    return now - datetime.fromisoformat(last_checked.replace("Z", "+00:00")) >= MIN_INTERVAL
