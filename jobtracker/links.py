"""Links from a stored email to the original message in the user's web mail, and who a reply goes to.

The hosted edition has a TypeScript port of these (web/src/pipeline/links.ts). A change here changes what it must return, so
regenerate the golden fixtures (`python scripts/export_fixtures.py`) and commit them with the change.
"""
from __future__ import annotations

import re
from urllib.parse import quote

from .mailtext import split_sender


def mailbox_link(provider: str, address: str, thread_id: str | None, web_link: str | None) -> tuple[str, str] | None:
    """(button label, https URL), or None when the original can't be linked to.

    Gmail has no per-message link in its API, but a thread id opens the conversation for a
    given account. Outlook gives a ready-made webLink, which is stored when the mail is synced.
    """
    if provider == "gmail" and address and thread_id:
        return "Open in Gmail", f"https://mail.google.com/mail/?authuser={quote(address)}#all/{quote(thread_id)}"
    if provider == "outlook" and web_link and web_link.startswith("https://"):
        return "Open in Outlook", web_link   # only ever link to https, never anything stored that could be a script URL
    return None


NO_REPLY = re.compile(r"(?:^|[._-])(?:no-?reply|do-?not-?reply|donotreply|mailer-daemon|bounces?|notifications?)(?:[._-]|$)", re.I)
ADDRESS = re.compile(r"[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+")
_CONSUMER_OUTLOOK = ("outlook", "hotmail", "live", "msn")


def _consumer_outlook(account: str) -> bool:
    """A personal Microsoft address: outlook.com, hotmail.co.uk, live.ca ... The whole domain is compared, so olive.com is not live.com."""
    labels = account.rpartition("@")[2].strip().lower().split(".")
    rest = labels[1:]
    return labels[0] in _CONSUMER_OUTLOOK and (len(rest) == 1 or (len(rest) == 2 and rest[0] in ("co", "com"))) and 2 <= len(rest[-1]) <= 3


def recipient(sender: str | None) -> str | None:
    """Where a reply to this sender would go, or None when they don't take replies (or the address isn't a plain one)."""
    to = split_sender(sender)[1]
    return to if ADDRESS.fullmatch(to or "") and not NO_REPLY.search(to.split("@")[0]) else None


def _with_re(subject: str) -> str:
    return subject if re.match(r"re:", subject, re.I) else f"Re: {subject}".strip()


def reply_subject(subject: str | None) -> str:
    """The subject of a reply that is sent from the app: "Re: " once, on one line (no line break can smuggle in a header)."""
    return _with_re(" ".join((subject or "").split()))


def reply_link(provider: str, account: str, sender: str, subject: str | None, web_link: str | None = None) -> tuple[str, str] | None:
    """(button label, https URL) that opens a reply to this sender in the account's own web mail, or None.

    The link opens a new message in Gmail or Outlook, already addressed, with "Re:" and the subject filled in. It works
    whether or not replying from the app is turned on. Senders that say they don't take replies ("no-reply@...") get none.
    """
    to = recipient(sender)
    if not to:
        return None
    subject = _with_re((subject or "").strip())      # the mail program shows what we pass, so only the ends are trimmed
    if provider == "gmail" and account:
        return "Reply in Gmail", f"https://mail.google.com/mail/?authuser={quote(account)}&view=cm&fs=1&to={quote(to)}&su={quote(subject)}"
    if provider == "outlook":
        work = bool(web_link and web_link.startswith("https://outlook.office")) or (
            "@" in (account or "") and not _consumer_outlook(account))
        host = "outlook.office.com/mail" if work else "outlook.live.com/mail/0"
        return "Reply in Outlook", f"https://{host}/deeplink/compose?to={quote(to)}&subject={quote(subject)}"
    return None
