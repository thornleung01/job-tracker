"""Shared text helpers: skill detection, title words, and the key that spots the same job twice."""
from __future__ import annotations

import re
import unicodedata
from functools import lru_cache
from pathlib import Path

import yaml

SKILLS_PATH = Path(__file__).with_name("skills.yaml")
STOPWORDS = {
    "a", "an", "and", "the", "of", "for", "to", "in", "at", "with", "or", "ii", "iii", "iv", "i", "sr", "jr",
    "senior", "junior", "lead", "principal", "staff", "associate", "intern", "internship", "co-op", "coop",
    "remote", "hybrid", "full-time", "part-time", "contract", "temporary", "permanent",
}
FILLER = {"a", "an", "and", "the", "of", "for", "to", "in", "at", "with", "or", "remote", "hybrid"}
# Words that mean the same thing in a job title.
TITLE_SYNONYMS = {
    "developer": "engineer", "programmer": "engineer", "swe": "engineer", "dev": "engineer",
    "analyst": "analyst", "analytics": "analyst", "scientist": "scientist",
    "mgr": "manager", "designer": "designer", "specialist": "specialist", "coordinator": "coordinator",
}
SENIOR_WORDS = {"senior", "sr", "lead", "principal", "staff", "director", "head", "vp", "manager"}
JUNIOR_WORDS = {"junior", "jr", "intern", "internship", "co-op", "coop", "entry", "graduate", "trainee"}


_LIST_SEP = r"[,;/|•·)]"
_AMBIGUOUS = {
    "R": re.compile(rf"(?<![\w&/.+#-])R(?=\s*{_LIST_SEP}|\s+(?:programming|language|studio)\b)|\bR programming\b"),
    "Go": re.compile(rf"\b(?i:golang)\b|(?<![\w&/.+#-])Go(?=\s*{_LIST_SEP})|\bGo (?:programming|language)\b"),
}


@lru_cache(maxsize=1)
def skill_patterns(path: Path = SKILLS_PATH) -> tuple[tuple[str, re.Pattern], ...]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    out = []
    for canonical, synonyms in data.items():
        if str(canonical) in _AMBIGUOUS:
            # "R" and "Go" are also ordinary words and letters, so they only count in their language spelling
            # or as an item in a list of skills ("Python, R, SQL"), and only with that exact capitalisation.
            out.append((str(canonical), _AMBIGUOUS[str(canonical)]))
            continue
        names = {str(canonical), *(str(s) for s in (synonyms or []))}
        # Whole-word match that also copes with names like C++, C#, .NET and Node.js.
        alt = "|".join(re.escape(n) for n in sorted(names, key=len, reverse=True))
        out.append((str(canonical), re.compile(rf"(?<![\w+#.]){'(?:' + alt + ')'}(?![\w+#]|\.\w)", re.I)))
    return tuple(out)


def find_skills(text: str) -> list[str]:
    """Skills from the vocabulary that the text mentions, in the order the vocabulary lists them."""
    return [name for name, pat in skill_patterns() if pat.search(text or "")]


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", (text or "").casefold())
    return re.sub(r"[^a-z0-9 ]+", " ", "".join(c for c in text if not unicodedata.combining(c))).strip()


def clean_title(title: str, company: str = "") -> str:
    """LinkedIn alert links read "Job title Company · Place 2 connections Actively recruiting": keep only the job title."""
    title = re.sub(r"\s+", " ", title or "").strip()
    if company:
        cut = re.search(rf"\s*{re.escape(company)}\s*·", title, re.I)
        if cut and cut.start() > 2:
            title = title[:cut.start()]
    return title.strip(" ·-") or re.sub(r"\s+", " ", title or "").strip()


def title_words(title: str) -> set[str]:
    words = {TITLE_SYNONYMS.get(w, w) for w in normalize(title).split() if w not in STOPWORDS and len(w) > 1}
    return words


def dedupe_key(company: str, title: str, location: str) -> str:
    """The same job listed on two sites shares company, title and city."""
    from ..extract import company_key

    city = normalize((location or "").split(",")[0])
    # Level words stay in: "Senior Engineer" and "Engineer II" are different jobs from "Engineer".
    words = {TITLE_SYNONYMS.get(w, w) for w in normalize(title).split() if w not in FILLER}
    return f"{company_key(company)}|{' '.join(sorted(words))}|{city}"


def looks_remote(*texts: str) -> bool:
    return any(re.search(r"\bremote\b|work from home|\bwfh\b", t or "", re.I) for t in texts)
