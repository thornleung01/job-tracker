"""Links from a stored email to the original message in the user's web mail."""
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


_NO_REPLY = re.compile(r"(?:^|[._-])(?:no-?reply|do-?not-?reply|donotreply|mailer-daemon|bounces?|notifications?)(?:[._-]|$)", re.I)
_ADDRESS = re.compile(r"[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+")
_CONSUMER_OUTLOOK = ("outlook.com", "hotmail.com", "live.com", "msn.com")


def reply_link(provider: str, account: str, sender: str, subject: str | None, web_link: str | None = None) -> tuple[str, str] | None:
    """(button label, https URL) that opens a reply to this sender in the account's own web mail, or None.

    The app never sends mail (it only has permission to read), so a reply is written in Gmail or Outlook itself: the
    link opens a new message there, already addressed, with "Re:" and the subject filled in. Senders that say they
    don't take replies ("no-reply@...") get none.
    """
    _, to = split_sender(sender)
    if not _ADDRESS.fullmatch(to or "") or _NO_REPLY.search(to.split("@")[0]):
        return None
    subject = (subject or "").strip()
    if not re.match(r"re:", subject, re.I):
        subject = f"Re: {subject}".strip()
    if provider == "gmail" and account:
        return "Reply in Gmail", f"https://mail.google.com/mail/?authuser={quote(account)}&view=cm&fs=1&to={quote(to)}&su={quote(subject)}"
    if provider == "outlook":
        work = bool(web_link and web_link.startswith("https://outlook.office")) or (
            "@" in (account or "") and not account.lower().endswith(_CONSUMER_OUTLOOK))
        host = "outlook.office.com/mail" if work else "outlook.live.com/mail/0"
        return "Reply in Outlook", f"https://{host}/deeplink/compose?to={quote(to)}&subject={quote(subject)}"
    return None
