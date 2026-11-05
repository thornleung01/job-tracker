"""Builders shared by several test files."""
from datetime import datetime, timezone

from jobtracker.models import Message


def mk(id, subject, body="", sender="Acme Careers <no-reply@greenhouse.io>", thread=None, day=1):
    """A Message in October 2026, from `sender` ("Name <address>")."""
    name, _, addr = sender.partition("<")
    return Message(
        id=id, thread_id=thread or id, sender_name=name.strip(), sender_email=addr.rstrip(">").strip(),
        subject=subject, received_at=datetime(2026, 10, day, 9, 0, tzinfo=timezone.utc), body=body,
    )
