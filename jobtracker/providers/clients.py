"""The one-time Google and Microsoft app credentials. They identify this app, not a person, so every profile shares them.

Each profile then signs in with its own mail account, and its tokens are stored separately (see base.token_persistence).
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

from .. import config

MAX_FILE = 64 * 1024
# Where Google's sign-in code and tokens go. A client file that points anywhere else could hand your Gmail sign-in to someone else.
GOOGLE_AUTH_URI = "https://accounts.google.com/o/oauth2/auth"
GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token"
GUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


class ClientError(ValueError):
    """A message that is safe to show the user."""


def _write_private(path: Path, text: str) -> None:
    """Write the whole file or none of it, readable by this user only (Windows ignores the mode, its folder permissions apply)."""
    config.SECRETS_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    tmp.replace(path)


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
    if not all(isinstance(block.get(key), str) and block[key] for key in ("client_id", "client_secret")):
        raise ClientError("That Google file is missing its client ID or secret.")
    for key, official in (("auth_uri", GOOGLE_AUTH_URI), ("token_uri", GOOGLE_TOKEN_URI)):
        if block.get(key, official) != official:
            raise ClientError("That Google file sends sign-ins somewhere other than Google, so it was not saved. Download a fresh copy from Google Cloud.")
    # Only what signing in needs is kept, with Google's own addresses.
    kept = {"client_id": block["client_id"], "client_secret": block["client_secret"], "auth_uri": GOOGLE_AUTH_URI, "token_uri": GOOGLE_TOKEN_URI,
            "redirect_uris": ["http://localhost"]}
    if isinstance(block.get("project_id"), str):
        kept["project_id"] = block["project_id"]
    _write_private(gmail_path(), json.dumps({"installed": kept}))


def save_outlook(client_id: str) -> None:
    client_id = (client_id or "").strip()
    if not GUID.match(client_id):
        raise ClientError("That doesn't look like an Application (client) ID. It's 36 characters, such as 1a2b3c4d-1234-5678-9abc-0123456789ab.")
    _write_private(outlook_path(), json.dumps({"client_id": client_id}))
