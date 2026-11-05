"""The shapes shared by the mail providers and the rest of the app: a provider-neutral Message, and a stored email read back as one."""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime

from .db import parse_iso

BODY_LIMIT = 4096


@dataclass(frozen=True)
class Message:
    """Provider-neutral email, as returned by every mail provider."""

    id: str
    thread_id: str
    sender_name: str
    sender_email: str
    subject: str
    received_at: datetime  # timezone-aware UTC
    body: str  # plain text
    web_link: str | None = None  # direct link to the message in the provider's web mail, if it gives one
    html: str = ""  # the HTML version, when there is one (job-alert emails keep their links there)
    bulk: bool = False  # the sender marked it as a mailing list / newsletter (List-Unsubscribe and similar headers)

    @property
    def sender_domain(self) -> str:
        return self.sender_email.rsplit("@", 1)[-1].lower()


def split_stored_sender(sender: str | None) -> tuple[str, str]:
    """('Pat Lee', 'pat@acme.com') from the "Pat Lee <pat@acme.com>" text stored on an email."""
    name, _, address = (sender or "").partition("<")
    return name.strip(), (address.rstrip(">") if address else name).strip()


def message_from_row(row: sqlite3.Row) -> Message:
    """A stored email (an `emails` or `ignored_mail` row) as the Message the classifier and reader work on."""
    name, address = split_stored_sender(row["sender"])
    keys = row.keys()
    return Message(
        id=row["provider_msg_id"], thread_id=row["thread_id"] or "", sender_name=name, sender_email=address, subject=row["subject"] or "",
        received_at=parse_iso(row["received_at"]), body=row["body"] or "",
        web_link=row["web_link"] if "web_link" in keys else None, bulk=bool(row["bulk"]) if "bulk" in keys else False,
    )
