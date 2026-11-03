from __future__ import annotations

import re
from datetime import datetime
from typing import Callable, Iterator, Protocol

from bs4 import BeautifulSoup

from .. import config
from ..models import Message


class Provider(Protocol):
    name: str
    address: str | None

    def connect(self) -> str:
        """Interactive sign-in. Returns the account's email address."""

    def fetch(self, since: datetime, skip: Callable[[str], bool]) -> Iterator[Message]:
        """Yield messages received at or after `since`, newest first.

        `skip(message_id)` is True for messages already stored, so providers
        can avoid downloading their bodies again.
        """

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


def token_dir(profile: str = "default"):
    """The first profile keeps the original location; every other profile gets a folder of its own."""
    return config.SECRETS_DIR if profile == "default" else config.SECRETS_DIR / "profiles" / profile


def token_persistence(filename: str, profile: str = "default"):
    """Token file encrypted with Windows DPAPI (tied to this Windows user)."""
    from msal_extensions import FilePersistenceWithDataProtection

    folder = token_dir(profile)
    folder.mkdir(parents=True, exist_ok=True)
    return FilePersistenceWithDataProtection(str(folder / filename))
