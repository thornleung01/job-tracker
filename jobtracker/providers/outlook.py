from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Callable, Iterator

import requests

from ..config import OUTLOOK_AUTHORITY, OUTLOOK_SCOPES, OUTLOOK_SEND_SCOPE
from ..models import Message
from . import clients
from .base import NotAllowed, NotConnected, html_to_text, token_persistence

SIGN_IN_TIMEOUT = 300   # seconds to finish signing in before giving up
GRAPH = "https://graph.microsoft.com/v1.0"
log = logging.getLogger(__name__)
SKIP_FOLDERS = ("junkemail", "sentitems", "drafts", "deleteditems")


def _client_id() -> str:
    client_id = clients.outlook_client_id()
    if not client_id:
        raise NotConnected("Outlook isn't set up yet. Add the Microsoft application ID in Settings first.")
    return client_id


class OutlookProvider:
    name = "outlook"

    def __init__(self, address: str | None = None, profile: str = "default"):
        self.address = address
        self.profile = profile

    def _app(self):
        import msal
        from msal_extensions import PersistedTokenCache

        cache = PersistedTokenCache(token_persistence("outlook.token", self.profile))
        return msal.PublicClientApplication(_client_id(), authority=OUTLOOK_AUTHORITY, token_cache=cache)

    def connect(self, send: bool = False) -> str:
        """Sign in. `send=True` also asks for permission to send mail, which is only ever used for replies you write."""
        app = self._app()
        result = app.acquire_token_interactive(OUTLOOK_SCOPES + ([OUTLOOK_SEND_SCOPE] if send else []), prompt="select_account",
                                               timeout=SIGN_IN_TIMEOUT)
        if "access_token" not in result:
            raise NotConnected(result.get("error_description", "Outlook sign-in failed."))
        claims = result.get("id_token_claims", {})
        self.address = claims.get("preferred_username") or claims.get("email")
        if not self.address:
            raise NotConnected("Microsoft signed you in but didn't share this account's email address.")
        return self.address

    def disconnect(self) -> None:
        app = self._app()
        for account in app.get_accounts():
            if account["username"].lower() == (self.address or "").lower():
                app.remove_account(account)

    def send_reply(self, *, thread_id: str, message_id: str, to: str, subject: str, body: str) -> str:
        """Reply to the stored message with `body`. Outlook addresses the reply to its sender and files it in the conversation."""
        from urllib.parse import quote

        try:
            token = self._token([OUTLOOK_SEND_SCOPE])
        except NotConnected:
            raise NotAllowed("Outlook hasn't been given permission to send. Turn on replying for this account in Settings.") from None
        r = requests.post(
            f"{GRAPH}/me/messages/{quote(message_id, safe='')}/reply",
            headers={"Authorization": f"Bearer {token}", "Prefer": 'IdType="ImmutableId"'},
            json={"comment": body}, timeout=30,
        )
        if r.status_code not in (200, 202):
            raise RuntimeError(f"Outlook didn't send the reply (error {r.status_code}).")
        return ""

    def _token(self, scopes: list[str] | None = None) -> str:
        app = self._app()
        account = next((a for a in app.get_accounts() if a["username"].lower() == (self.address or "").lower()), None)
        result = app.acquire_token_silent(scopes or OUTLOOK_SCOPES, account=account) if account else None
        if not result or "access_token" not in result:
            raise NotConnected(f"Outlook account {self.address} needs to sign in again. Run: connect outlook")
        return result["access_token"]

    def fetch(self, since: datetime, skip: Callable[[str], bool]) -> Iterator[Message]:
        headers = {
            "Authorization": f"Bearer {self._token()}",
            # Immutable ids survive folder moves, which keeps dedup stable.
            # HTML bodies keep the links that job-alert emails are made of; they are turned into text below.
            "Prefer": 'IdType="ImmutableId"',
        }
        excluded = set()
        for folder in SKIP_FOLDERS:
            r = requests.get(f"{GRAPH}/me/mailFolders/{folder}?$select=id", headers=headers, timeout=30)
            if r.ok:
                excluded.add(r.json()["id"])

        since_utc = since.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        url = (
            f"{GRAPH}/me/messages?$filter=receivedDateTime ge {since_utc}"
            "&$orderby=receivedDateTime desc&$top=50"
            "&$select=id,conversationId,subject,from,receivedDateTime,body,parentFolderId,webLink,internetMessageHeaders"
        )
        while url:
            r = requests.get(url, headers=headers, timeout=60)
            r.raise_for_status()
            data = r.json()
            for raw in data.get("value", []):
                if raw.get("parentFolderId") in excluded or skip(raw["id"]):
                    continue
                try:
                    msg = parse_message(raw)
                except Exception as exc:
                    log.warning("Skipping malformed Outlook message %s: %s", raw.get("id"), exc)
                    continue
                yield msg
            url = data.get("@odata.nextLink")


def _is_bulk(headers: dict) -> bool:
    return bool(headers.get("list-unsubscribe") or headers.get("list-id")
                or headers.get("precedence", "").strip().lower() in ("bulk", "list", "junk"))


def parse_message(raw: dict) -> Message:
    sender = (raw.get("from") or {}).get("emailAddress") or {}
    body = raw.get("body") or {}
    text = body.get("content") or ""
    html = ""
    if (body.get("contentType") or "").lower() == "html":
        html, text = text, html_to_text(text)
    headers = {h.get("name", "").lower(): h.get("value", "") for h in raw.get("internetMessageHeaders") or []}
    return Message(
        bulk=_is_bulk(headers),
        id=raw["id"],
        thread_id=raw.get("conversationId") or raw["id"],
        sender_name=sender.get("name") or "",
        sender_email=sender.get("address") or "",
        subject=raw.get("subject") or "",
        received_at=datetime.fromisoformat(raw["receivedDateTime"].replace("Z", "+00:00")),
        body=text,
        web_link=raw.get("webLink") or None,
        html=html,
    )
