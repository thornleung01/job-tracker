"""Turn the plain text of a stored email into something pleasant to read.

The text comes from HTML flattened to plain text, so it carries the marks of that: line breaks in the middle of
sentences, non-breaking spaces, invisible padding characters, whole reply chains and marketing footers. This module
repairs the line breaks, folds the reply chain and the footer under a toggle, and shows each link as its domain.
Everything is escaped, and links are shown but never made clickable: a link inside an email is not something to
follow from here ("Open in Gmail" is the way to the real message).

The hosted edition has a TypeScript port of this module (web/src/pipeline/mailtext.ts). A change here changes what it must
return, so regenerate the golden fixtures (`python scripts/export_fixtures.py`) and commit them with the change.
"""
from __future__ import annotations

import re
from urllib.parse import urlparse

from markupsafe import Markup, escape

INVISIBLE = re.compile("[\u034f\u200b-\u200f\u2060\ufeff\u00ad]")      # zero-width and soft-hyphen padding that marketing mail adds
_URL = re.compile(r"""https?://[^\s<>"')\]]+""", re.I)
_BRACKETED_URL = re.compile(r"""[(\[]\s*(https?://[^\s<>"')\]]+)\s*[)\]]""", re.I)

_LIST_ITEM = re.compile(r"^(?:[-•*–]|\d{1,2}[.)])\s+\S")
_SALUTATION = re.compile(r"^(?:hi|hello|hey|dear|good (?:morning|afternoon|evening))\b[^.!?]{0,40}[,!]?$", re.I)
_SIGNOFF = re.compile(r"^(?:best|best regards|kind regards|regards|warm regards|thanks|thank you|many thanks|cheers|sincerely|talk soon)[,!.]?$", re.I)
_BANNER = re.compile(r"^(?:EXT SENDER|EXTERNAL (?:EMAIL|SENDER)|CAUTION: This (?:email|message)|\[EXTERNAL\])", re.I)
_QUOTE_START = [
    re.compile(r"^On .{3,160}\bwrote:?$", re.I),
    re.compile(r"^Le .{3,160}\ba écrit\s?:?$", re.I),
    re.compile(r"^-{2,}\s*Original Message\s*-{2,}$", re.I),
    re.compile(r"^>"),
]
# A reply's own header ("On Fri, Oct 23 ... wrote:") always starts a new block, however it was wrapped.
_QUOTE_LEAD = re.compile(r"^(?:On (?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*,? |[A-Z][a-z]{2,8} \d)|Le \w+ \d|From: )")
_HEADER_LABEL = re.compile(r"^(?:From|Sent|To|Cc|Bcc|Subject|Date|De|Envoy\u00e9|\u00c0|Objet):\s*$")
_FOOTER = re.compile(
    r"unsubscribe|this email was (?:intended|sent) for|you(?:'re| are) receiving (?:this|these|linkedin)|©\s?\d{4}|"
    r"manage (?:your )?(?:email )?(?:preferences|subscription|settings)|view (?:this email )?(?:online|in (?:your )?browser)",
    re.I,
)
FOOTER_MIN_BEFORE = 150          # characters of real content that must come first, or a "view online" line at the top is not a footer


_CLOSERS = ":,;).?"       # a line that starts with one of these continues the line before it


def split_sender(sender: str | None) -> tuple[str, str]:
    """'Pat Lee <pat@acme.com>' -> ('Pat Lee', 'pat@acme.com'). A bare address has no name."""
    sender = (sender or "").strip()
    if "<" in sender:
        name, _, rest = sender.partition("<")
        return name.strip().strip('"'), rest.rstrip(">").strip()
    return ("", sender) if "@" in sender else (sender, "")


def _joins(a: str, b: str) -> bool:
    """Is line b the continuation of line a? HTML turned every inline tag into a line break, so most are."""
    if b[0] in _CLOSERS:
        return True
    if re.fullmatch(r"[-•*–]", a):
        return True                        # a bullet on its own line belongs to the next one
    if _HEADER_LABEL.match(a):
        return True                        # "From:" on one line, the sender on the next
    if _HEADER_LABEL.match(b) or re.match(r"^(?:From|Sent|To|Cc|Subject|Date): ", b):
        return False                       # ...and the next label starts a new line of the header
    if _LIST_ITEM.match(b) or _SIGNOFF.match(b) or _SALUTATION.match(b) or _QUOTE_LEAD.match(b) or _SALUTATION.match(a) or _SIGNOFF.match(a):
        return False
    if a.endswith(":") and b[0].islower():
        return True                        # "Referrals:" then "you get a bonus": one thought
    if re.search(r"[.!?:][\"')]?$", a):
        return False
    if a.endswith(",") and len(a) <= 24:
        return False                       # a short line ending in a comma is a greeting or a sign-off
    return True


def _blocks(text: str) -> list[str]:
    text = INVISIBLE.sub("", text or "").replace("\xa0", " ").replace("\u202f", " ").replace("\r\n", "\n")
    out: list[str] = []
    for chunk in re.split(r"\n\s*\n", text):
        cur = ""
        for raw in chunk.split("\n"):
            line = re.sub(r"\s+", " ", raw).strip()
            if not line or _BANNER.match(line):
                continue
            if not cur:
                cur = line
            elif _joins(cur, line):
                cur += ("" if line[0] in _CLOSERS else " ") + line
            else:
                out.append(cur)
                cur = line
        if cur:
            out.append(cur)
    return out


def _is_quote_start(blocks: list[str], i: int) -> bool:
    b = blocks[i]
    if any(p.match(b) for p in _QUOTE_START):
        return True
    # Outlook-style header: "From: …" followed within a couple of lines by "Sent: …" or "Date: …"
    return bool(re.match(r"^(?:From|De):\s", b, re.I) and any(re.match(r"^(?:Sent|Date|Envoy)", x, re.I) for x in blocks[i + 1:i + 4]))


def parts(body: str | None) -> tuple[list[str], list[str], list[str]]:
    """(the message, the earlier thread, the footer), each a list of text blocks."""
    blocks = _blocks(body or "")
    thread: list[str] = []
    for i in range(1, len(blocks)):                    # a message that is only a quote has no thread to fold
        if _is_quote_start(blocks, i):
            blocks, thread = blocks[:i], blocks[i:]
            break
    footer: list[str] = []
    seen = 0
    for i, b in enumerate(blocks):
        if i and seen >= FOOTER_MIN_BEFORE and _FOOTER.search(b):
            blocks, footer = blocks[:i], blocks[i:]
            break
        seen += len(b)
    return blocks, thread, footer


def _inline(text: str) -> str:
    """Escape, and show each link as its domain (the full address stays in the tooltip)."""
    text = _BRACKETED_URL.sub(lambda m: m.group(1), text)
    out, last = [], 0
    for m in _URL.finditer(text):
        out.append(str(escape(text[last:m.start()])))
        url = m.group(0).rstrip(".,;:!?")
        try:
            host = (urlparse(url).hostname or "link").removeprefix("www.")
        except ValueError:          # "http://[abc" and the like: show it as a plain link rather than failing the page
            host = "link"
        out.append(f'<span class="url" title="{escape(url)}">{escape(host)}</span>')
        last = m.start() + len(url)
    out.append(str(escape(text[last:])))
    return "".join(out)


def _html(blocks: list[str]) -> str:
    html, items = [], []

    def flush():
        if items:
            html.append("<ul>" + "".join(f"<li>{i}</li>" for i in items) + "</ul>")
            items.clear()

    for b in blocks:
        if _LIST_ITEM.match(b):
            items.append(_inline(re.sub(r"^(?:[-•*–]|\d{1,2}[.)])\s+", "", b)))
            continue
        flush()
        cls = ' class="sig"' if _SIGNOFF.match(b) else ""
        html.append(f"<p{cls}>{_inline(b)}</p>")
    flush()
    return "".join(html)


def render(body: str | None) -> Markup:
    main, thread, footer = parts(body)
    if not (main or thread or footer):
        return Markup('<div class="mail-text"><p class="mail-empty">No text was stored for this email.</p></div>')
    html = [_html(main) or '<p class="mail-empty">Only quoted or footer text was stored for this email.</p>']
    if thread:
        html.append(f'<details class="mail-fold"><summary>Earlier in this thread</summary>{_html(thread)}</details>')
    if footer:
        html.append(f'<details class="mail-fold"><summary>Footer and links</summary>{_html(footer)}</details>')
    return Markup('<div class="mail-text">' + "".join(html) + "</div>")
