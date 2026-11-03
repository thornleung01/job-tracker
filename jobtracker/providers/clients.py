"""The one-time Google and Microsoft app credentials. They identify this app, not a person, so every profile shares them.

Each profile then signs in with its own mail account, and its tokens are stored separately (see base.token_persistence).
"""
from __future__ import annotations

import json
import re

from .. import config

MAX_FILE = 64 * 1024
GUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


class ClientError(ValueError):
    """A message that is safe to show the user."""


def gmail_path():
    return config.SECRETS_DIR / "gmail_client.json"


def outlook_path():
    return config.SECRETS_DIR / "outlook_client.json"


def gmail_ready() -> bool:
    try:
        info = json.loads(gmail_path().read_text(encoding="utf-8"))
        return bool(info.get("installed", {}).get("client_id"))
    except (OSError, ValueError, AttributeError):
        return False


def outlook_client_id() -> str | None:
    try:
        return json.loads(outlook_path().read_text(encoding="utf-8")).get("client_id") or None
    except (OSError, ValueError, AttributeError):
        return None


def save_gmail(data: bytes) -> None:
    if len(data) > MAX_FILE:
        raise ClientError("That file is too big to be a Google credentials file.")
    try:
        info = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError):
        raise ClientError("That isn't a JSON file. Download the OAuth client file from Google Cloud and choose it here.") from None
    block = info.get("installed") if isinstance(info, dict) else None
    if not isinstance(block, dict):
        if isinstance(info, dict) and "web" in info:
            raise ClientError('That file is for a "Web application". Create the OAuth client as a "Desktop app" instead.')
        raise ClientError("That doesn't look like a Google OAuth client file.")
    if not (block.get("client_id") and block.get("client_secret")):
        raise ClientError("That Google file is missing its client ID or secret.")
    config.SECRETS_DIR.mkdir(parents=True, exist_ok=True)
    gmail_path().write_text(json.dumps({"installed": block}), encoding="utf-8")


def save_outlook(client_id: str) -> None:
    client_id = (client_id or "").strip()
    if not GUID.match(client_id):
        raise ClientError("That doesn't look like an Application (client) ID. It is 36 characters, like 1a2b3c4d-1234-5678-9abc-0123456789ab.")
    config.SECRETS_DIR.mkdir(parents=True, exist_ok=True)
    outlook_path().write_text(json.dumps({"client_id": client_id}), encoding="utf-8")
