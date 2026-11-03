"""Score a posting against your profile, 0 to 100, with the reasons in plain words.

Four parts: title (40), skills (40), place (15), freshness (5). A part that can't be judged is left out
and the rest are scaled to 100, so a posting with no description isn't punished for having none.
Postings with partial information (an alert email carries only a title, company and place) are capped.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from .text import JUNIOR_WORDS, SENIOR_WORDS, find_skills, looks_remote, normalize, title_words

WEIGHTS = {"title": 40, "skills": 40, "place": 15, "fresh": 5}
PARTIAL_CAP = 85
EXCLUDE_PENALTY = 30


def _age_days(posted_at: str | None, now: datetime) -> int | None:
    if not posted_at:
        return None
    try:
        when = datetime.fromisoformat(posted_at.replace("Z", "+00:00"))
    except ValueError:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return max(0, (now - when).days)


def score_posting(profile: dict, posting: dict, now: datetime | None = None) -> tuple[int, list[str]]:
    now = now or datetime.now(timezone.utc)
    title = posting.get("title") or ""
    description = posting.get("description") or ""
    reasons: list[str] = []
    parts: dict[str, float] = {}

    # Title: how much of one of your target titles the posting's title covers.
    targets = profile.get("titles") or []
    if targets:
        words = title_words(title)
        best, best_target = 0.0, ""
        for target in targets:
            tw = title_words(target)
            if tw:
                share = len(tw & words) / len(tw)
                if share > best:
                    best, best_target = share, target
        parts["title"] = best
        if best >= 0.5:
            reasons.append(f"Title ≈ {best_target}")

    # Skills: of the skills the posting asks for, how many you have (your must-haves count double).
    mine = {s.casefold() for s in (profile.get("skills_must") or []) + (profile.get("skills_nice") or [])}
    must = {s.casefold() for s in (profile.get("skills_must") or [])}
    wanted = find_skills(f"{title}\n{description}")
    if wanted and mine:
        weight = lambda s: 2 if s.casefold() in must else 1  # noqa: E731
        have = [s for s in wanted if s.casefold() in mine]
        parts["skills"] = sum(weight(s) for s in have) / sum(weight(s) for s in wanted)
        if have:
            reasons.append(", ".join(have[:5]) + (f" +{len(have) - 5} more" if len(have) > 5 else ""))
        missing_must = [s for s in must if s in {w.casefold() for w in wanted} and s not in {h.casefold() for h in have}]
        if missing_must:
            reasons.append("Missing: " + ", ".join(missing_must[:3]))

    # Place: one of your cities, or remote when you want remote.
    location = posting.get("location") or ""
    remote = bool(posting.get("remote")) or looks_remote(location, title)
    cities = [c.casefold() for c in (profile.get("cities") or [])]
    if profile.get("remote") or cities:
        if remote and profile.get("remote"):
            parts["place"] = 1.0
            reasons.append("Remote")
        elif location and cities:
            hit = next((c for c in cities if re.search(rf"\b{re.escape(c)}\b", location.casefold())), None)
            parts["place"] = 1.0 if hit else 0.0
            if hit:
                reasons.append(location.split(",")[0].strip().title() if len(location) < 40 else hit.title())
        elif location and not cities:
            parts["place"] = 0.0          # you only want remote and this one isn't

    # Freshness.
    age = _age_days(posting.get("posted_at"), now)
    if age is not None:
        parts["fresh"] = 1.0 if age <= 3 else 0.6 if age <= 7 else 0.2 if age <= 14 else 0.0
        if age <= 3:
            reasons.append("Posted today" if age == 0 else f"Posted {age} day{'s' if age != 1 else ''} ago")

    if not parts:
        score = 0
    else:
        total = sum(WEIGHTS[k] for k in parts)
        score = round(100 * sum(WEIGHTS[k] * v for k, v in parts.items()) / total)

    # Penalties.
    haystack = normalize(f"{title} {description}")
    for word in profile.get("exclude") or []:
        if normalize(word) and re.search(rf"\b{re.escape(normalize(word))}\b", haystack):
            score -= EXCLUDE_PENALTY
            reasons.append(f"Contains “{word}”")
    level = profile.get("seniority") or ""
    words = set(normalize(title).split())
    if level == "junior" and words & SENIOR_WORDS:
        score -= 25
        reasons.append("Looks more senior than you")
    elif level == "mid" and words & (SENIOR_WORDS - {"manager"}):
        score -= 15
        reasons.append("Looks more senior than you")
    elif level == "senior" and words & JUNIOR_WORDS:
        score -= 25
        reasons.append("Looks more junior than you")

    if posting.get("partial"):
        score = min(score, PARTIAL_CAP)
        reasons.append("Partial info (from an alert email)")
    return max(0, min(100, score)), reasons
