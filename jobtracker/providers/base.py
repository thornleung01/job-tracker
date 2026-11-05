"""What every mail provider has in common: the Provider shape, its errors, and where sign-ins are kept.

Sign-in storage (`token_persistence`) depends on the platform:
- Windows: the file is encrypted with DPAPI, so only your Windows user can read it.
- macOS and Linux: there is no DPAPI, so the file is plain text with owner-only permissions (0600). The app is
  Windows-first; this fallback keeps it usable for development and testing elsewhere. Treat that folder
  (`secrets/`, gitignored) like any other credentials file.
"""
from __future__ import annotations

import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Callable, Iterator, Protocol

from bs4 import BeautifulSoup

from ..config import token_dir
from ..models import Message


class Provider(Protocol):
    name: str
    address: str | None
    # Optional capabilities. `sync` and `reply` use them when present.
    oldest_first: bool          # `fetch` yields oldest first, so a sync cut short keeps its progress
    pending: int | None         # messages still to download once the list has been read
    on_wait: Callable[[int], None] | None    # called with the seconds a rate limit makes us wait

    def connect(self, send: bool = False) -> str:
        """Interactive sign-in. Returns the account's email address. `send=True` also asks to send replies."""

    def fetch(self, since: datetime, skip: Callable[[str], bool]) -> Iterator[Message]:
        """Yield messages received at or after `since`.

        `skip(message_id)` is True for messages already stored, so providers
        can avoid downloading their bodies again.
        """

    def send_reply(self, *, thread_id: str, message_id: str, to: str, subject: str, body: str) -> str:
        """Send `body` as a reply in the same conversation. Returns the new message's id."""

    def disconnect(self) -> None:
        """Forget this account's sign-in on this PC. The mailbox itself is untouched."""


class NotConnected(RuntimeError):
    pass


class NotAllowed(RuntimeError):
    """Sending isn't permitted for this account: replying was never turned on, or the permission is missing."""


def html_to_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "head"]):
        tag.decompose()
    return re.sub(r"\n{3,}", "\n\n", soup.get_text("\n")).strip()


def is_bulk(headers: dict) -> bool:
    """Mailing lists and newsletters say so in their headers; people and hiring systems don't."""
    return bool(headers.get("list-unsubscribe") or headers.get("list-id")
                or headers.get("precedence", "").strip().lower() in ("bulk", "list", "junk"))


class TokenFile:
    """One saved sign-in. `load`, `save` and `clear` are what callers use; msal's token cache also needs the rest."""

    def __init__(self, inner):
        self._inner = inner
        self.is_encrypted = bool(getattr(inner, "is_encrypted", False))

    def save(self, content: str) -> None:
        self._inner.save(content)

    def load(self) -> str:
        """The saved text. A file that was never saved raises FileNotFoundError."""
        from msal_extensions.persistence import PersistenceNotFound

        try:
            return self._inner.load()
        except PersistenceNotFound as exc:
            raise FileNotFoundError(str(exc)) from None

    def clear(self) -> None:
        Path(self._inner.get_location()).unlink(missing_ok=True)

    def time_last_modified(self):
        return self._inner.time_last_modified()

    def get_location(self) -> str:
        return self._inner.get_location()


def token_persistence(filename: str, profile: str = "default") -> TokenFile:
    """The saved sign-in file for this profile: DPAPI-encrypted on Windows, owner-only plain text elsewhere."""
    from msal_extensions import FilePersistence, FilePersistenceWithDataProtection

    folder = token_dir(profile)
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = str(folder / filename)
    if sys.platform == "win32":
        return TokenFile(FilePersistenceWithDataProtection(path))
    return TokenFile(FilePersistence(path))
