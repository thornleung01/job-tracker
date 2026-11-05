"""Small text helpers shared by several modules."""
from __future__ import annotations

import re


def collapse_spaces(text: object, limit: int | None = None) -> str:
    """One line: every run of whitespace (line breaks too) becomes a single space, trimmed, then cut to `limit` characters."""
    out = re.sub(r"\s+", " ", "" if text is None else str(text)).strip()
    return out if limit is None else out[:limit]
