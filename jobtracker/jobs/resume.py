"""Read a resume on this PC and pull out skills, titles and seniority. Nothing is sent anywhere."""
from __future__ import annotations

import io
import re
from dataclasses import dataclass, field

from .text import find_skills

MAX_UPLOAD = 5 * 1024 * 1024
ALLOWED = (".pdf", ".docx", ".txt")
TITLE_NOUNS = (
    "analyst|engineer|developer|scientist|manager|designer|specialist|coordinator|consultant|director|"
    "administrator|associate|architect|researcher|technician|accountant|strategist|producer|marketer|"
    "representative|officer|planner|editor|writer|lead|programmer|advisor|assistant|intern"
)
_TITLE_LINE = re.compile(rf"^(?:[A-Z][\w&/+.'-]*\s+){{0,4}}(?:{TITLE_NOUNS})(?:\s+(?:I{{1,3}}|IV|\d))?$", re.I)


class ResumeError(ValueError):
    """Something a person can fix, safe to show on the page."""


@dataclass
class Analysis:
    skills: list[str] = field(default_factory=list)
    titles: list[str] = field(default_factory=list)
    seniority: str = ""
    years: int = 0


def extract_text(filename: str, data: bytes) -> str:
    name = (filename or "").lower()
    if not name.endswith(ALLOWED):
        raise ResumeError("Upload a PDF, Word (.docx), or plain text (.txt) file.")
    if len(data) > MAX_UPLOAD:
        raise ResumeError("That file is over 5 MB. Export a smaller copy of your resume.")
    try:
        if name.endswith(".pdf"):
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted:
                raise ResumeError("That PDF is password protected. Export an unlocked copy.")
            text = "\n".join((page.extract_text() or "") for page in reader.pages[:12])
        elif name.endswith(".docx"):
            from docx import Document

            doc = Document(io.BytesIO(data))
            parts = [p.text for p in doc.paragraphs]
            for table in doc.tables:                       # many resumes put skills in a table
                parts += [cell.text for row in table.rows for cell in row.cells]
            text = "\n".join(parts)
        else:
            text = data.decode("utf-8", errors="replace")
    except ResumeError:
        raise
    except Exception:
        raise ResumeError("Couldn't read that file. Try exporting it again, or paste the text instead.") from None
    text = re.sub(r"[ \t]+", " ", text).strip()
    if len(text) < 40:
        raise ResumeError("No text found in that file (a scanned image can't be read). Paste the text instead.")
    return text


def analyze(text: str) -> Analysis:
    skills = find_skills(text)
    titles = []
    for line in text.splitlines():
        line = re.sub(r"\s+", " ", line.strip(" -•·|\t")).strip()
        if 3 <= len(line) <= 48 and _TITLE_LINE.match(line) and line.casefold() not in {t.casefold() for t in titles}:
            titles.append(line)
    years = max([int(n) for n in re.findall(r"(\d{1,2})\+?\s*(?:years|yrs)", text, re.I)] or [0])
    if years >= 6 or re.search(r"\b(senior|sr\.?|principal|staff)\b", " ".join(titles), re.I):
        seniority = "senior"
    elif years >= 2:
        seniority = "mid"
    elif years or re.search(r"\b(intern|junior|entry|graduate)\b", text[:2000], re.I):
        seniority = "junior"
    else:
        seniority = ""
    return Analysis(skills=skills, titles=titles[:6], seniority=seniority, years=years)
