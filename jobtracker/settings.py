from __future__ import annotations

import json
import re
import sqlite3

THEMES = ["system", "light", "dark"]
DENSITIES = ["comfortable", "compact"]
CORNERS = ["soft", "sharp"]
# name -> (light accent, dark accent). Both are checked for text contrast on the button.
ACCENTS = {
    "graphite": ("#000000", "#ffffff"),
    "bronze": ("#5c4b24", "#d9c28a"),
    "forest": ("#2f5d46", "#8cc7a6"),
    "clay": ("#8f4a32", "#e0a184"),
}
COLUMNS = {
    "company": "Company",
    "role": "Role",
    "stage": "Stage",
    "applied": "Applied",
    "last_activity": "Last activity",
    "emails": "Emails",
}
FLOW_PERIODS = [0, 30, 90, 180]
LOOKBACKS = [30, 60, 90, 180, 365]

COUNTRIES = {"ca": "Canada", "us": "United States"}
SENIORITY = ["", "junior", "mid", "senior"]
MIN_SCORES = [40, 50, 60, 65, 70, 80]
RESUME_MAX = 60_000
MAX_ITEMS, MAX_LEN = 60, 80

DEFAULTS = {
    "appearance": {
        "theme": "system", "accent": "graphite", "density": "comfortable", "corners": "soft",
        "columns": ["company", "role", "stage", "applied", "last_activity"], "flow_days": 0,
    },
    "sync": {"lookback_days": 30},
    # What the job search matches against. The resume text itself never leaves this PC.
    "profile": {
        "resume_text": "", "skills_must": [], "skills_nice": [], "titles": [], "cities": [], "exclude": [],
        "remote": True, "countries": ["ca"], "seniority": "", "min_score": 65,
    },
}


def clean_list(raw) -> list[str]:
    """A list, or text with one entry per line (commas also split). Trimmed, no repeats, capped."""
    items = re.split(r"[\n,;]+", raw) if isinstance(raw, str) else list(raw or [])
    seen, out = set(), []
    for item in items:
        item = re.sub(r"\s+", " ", str(item)).strip()[:MAX_LEN]
        if item and item.casefold() not in seen:
            seen.add(item.casefold())
            out.append(item)
    return out[:MAX_ITEMS]


def _ensure(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")


def _choice_int(value, allowed: list[int], default: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return number if number in allowed else default


def sanitize(section: str, values: dict) -> dict:
    base = DEFAULTS[section]
    out = dict(base)
    if section == "appearance":
        if values.get("theme") in THEMES: out["theme"] = values["theme"]
        if values.get("accent") in ACCENTS: out["accent"] = values["accent"]
        if values.get("density") in DENSITIES: out["density"] = values["density"]
        if values.get("corners") in CORNERS: out["corners"] = values["corners"]
        if "columns" in values:
            wanted = values["columns"] if isinstance(values["columns"], list) else [values["columns"]]
            cols = [c for c in COLUMNS if c in wanted]
            # Company and Stage are what the list is for, so they can't be hidden.
            out["columns"] = [c for c in COLUMNS if c in cols or c in ("company", "stage")]
        out["flow_days"] = _choice_int(values.get("flow_days"), FLOW_PERIODS, base["flow_days"])
    elif section == "sync":
        out["lookback_days"] = _choice_int(values.get("lookback_days"), LOOKBACKS, base["lookback_days"])
    elif section == "profile":
        out["resume_text"] = str(values.get("resume_text") or "")[:RESUME_MAX]
        for key in ("skills_must", "skills_nice", "titles", "cities", "exclude"):
            out[key] = clean_list(values.get(key, base[key]))
        out["remote"] = bool(values.get("remote", base["remote"]))
        countries = values.get("countries", base["countries"])
        countries = [countries] if isinstance(countries, str) else list(countries or [])
        out["countries"] = [c for c in COUNTRIES if c in countries] or list(base["countries"])
        out["seniority"] = values.get("seniority") if values.get("seniority") in SENIORITY else ""
        out["min_score"] = _choice_int(values.get("min_score"), MIN_SCORES, base["min_score"])
    else:
        raise KeyError(section)
    return out


def load(conn: sqlite3.Connection) -> dict:
    _ensure(conn)
    stored = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings")}
    result = {}
    for section, base in DEFAULTS.items():
        try:
            values = json.loads(stored.get(section, "{}"))
        except ValueError:
            values = {}
        merged = {**base, **(values if isinstance(values, dict) else {})}
        result[section] = sanitize(section, merged)
    return result


def save(conn: sqlite3.Connection, section: str, values: dict) -> dict:
    _ensure(conn)
    clean = sanitize(section, values)
    with conn:
        conn.execute("INSERT INTO settings (key, value) VALUES (?, ?) "
                     "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (section, json.dumps(clean)))
    return clean
