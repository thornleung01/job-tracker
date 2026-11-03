from __future__ import annotations

from .base import Provider


def get_provider(name: str, address: str | None = None, profile: str = "default") -> Provider:
    if name == "gmail":
        from .gmail import GmailProvider

        return GmailProvider(address, profile)
    if name == "outlook":
        from .outlook import OutlookProvider

        return OutlookProvider(address, profile)
    raise ValueError(f"Unknown provider: {name}")
