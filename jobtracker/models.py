from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

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
