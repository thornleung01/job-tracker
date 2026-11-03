from __future__ import annotations

import base64
import json
import logging
import time
from datetime import datetime, timezone
from email.utils import parseaddr, parsedate_to_datetime
from typing import Callable, Iterator

from ..config import GMAIL_SCOPES, GMAIL_SEND_SCOPE
from ..models import Message
from . import clients
from .base import NotAllowed, NotConnected, html_to_text, token_persistence

SIGN_IN_TIMEOUT = 300   # seconds to finish signing in before giving up
RETRY_WAITS = (5, 15, 30, 60, 60)   # seconds to wait after each rate-limit answer before asking again
_sleep = time.sleep
log = logging.getLogger(__name__)
EXCLUDE = "-in:spam -in:sent -in:drafts -category:promotions -category:social -category:forums"


def _retryable(exc) -> bool:
    """Google's "slow down" answers: too many requests this minute, or a hiccup on their side."""
    status = getattr(getattr(exc, "resp", None), "status", 0)
    content = getattr(exc, "content", b"") or b""
    text = content.decode("utf-8", "replace") if isinstance(content, bytes) else str(content)
    return status in (429, 500, 502, 503, 504) or (status == 403 and "ateLimitExceeded" in text)


def _execute(request, on_wait=None):
    """Run a Gmail request, waiting and trying again when Google says we're going too fast."""
    from googleapiclient.errors import HttpError

    for wait in (*RETRY_WAITS, None):
        try:
            return request.execute()
        except HttpError as exc:
            if wait is None or not _retryable(exc):
                raise
            log.warning("Gmail asked us to slow down; waiting %s seconds", wait)
            if on_wait:
                on_wait(wait)
            _sleep(wait)


def _token_file(address: str | None) -> str:
    return f"gmail_{(address or 'new').replace('@', '_at_')}.token"


class GmailProvider:
    name = "gmail"
    oldest_first = True      # lets a sync save its progress as it goes
    on_wait = None           # called with the seconds to wait when Google asks us to slow down
    pending = None           # how many messages still have to be downloaded, once the list has been read

    def __init__(self, address: str | None = None, profile: str = "default"):
        self.address = address
        self.profile = profile

    # -- auth ----------------------------------------------------------------
    def connect(self, send: bool = False) -> str:
        """Sign in. `send=True` also asks for permission to send mail, which is only ever used for replies you write."""
        from google_auth_oauthlib.flow import InstalledAppFlow

        if not clients.gmail_ready():
            raise NotConnected("Gmail isn't set up yet. Add the Google credentials file in Settings first.")
        flow = InstalledAppFlow.from_client_secrets_file(str(clients.gmail_path()), GMAIL_SCOPES + ([GMAIL_SEND_SCOPE] if send else []))
        creds = flow.run_local_server(port=0, prompt="consent", timeout_seconds=SIGN_IN_TIMEOUT)
        self.address = self._service(creds).users().getProfile(userId="me").execute()["emailAddress"]
        token_persistence(_token_file(self.address), self.profile).save(creds.to_json())
        return self.address

    def disconnect(self) -> None:
        try:
            token_persistence(_token_file(self.address), self.profile).clear()
        except FileNotFoundError:
            pass

    def _credentials(self):
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials

        persistence = token_persistence(_token_file(self.address), self.profile)
        try:
            raw = persistence.load()
        except FileNotFoundError:
            raw = None
        if not raw:
            raise NotConnected(f"Gmail account {self.address} isn't connected. Run: connect gmail")
        info = json.loads(raw)
        creds = Credentials.from_authorized_user_info(info, info.get("scopes") or GMAIL_SCOPES)   # keep whatever was granted
        if not creds.valid:
            creds.refresh(Request())
            persistence.save(creds.to_json())
        return creds

    @staticmethod
    def _service(creds):
        from googleapiclient.discovery import build

        return build("gmail", "v1", credentials=creds, cache_discovery=False)

    # -- replying ------------------------------------------------------------
    def send_reply(self, *, thread_id: str, message_id: str, to: str, subject: str, body: str) -> str:
        """Send `body` to `to` as a reply in the same Gmail conversation. Returns the new message's id."""
        from email.message import EmailMessage

        creds = self._credentials()
        if GMAIL_SEND_SCOPE not in set(creds.scopes or []):
            raise NotAllowed("Gmail hasn't been given permission to send. Turn on replying for this account in Settings.")
        service = self._service(creds)
        original = _execute(service.users().messages().get(userId="me", id=message_id, format="metadata",
                                                           metadataHeaders=["Message-ID", "References"]), self.on_wait)
        headers = {h["name"].lower(): h["value"] for h in (original.get("payload") or {}).get("headers", [])}
        msg = EmailMessage()
        msg["To"] = to
        msg["Subject"] = " ".join(subject.split())
        if headers.get("message-id"):          # these two make mail programs file it under the same conversation
            msg["In-Reply-To"] = headers["message-id"]
            msg["References"] = f"{headers.get('references', '')} {headers['message-id']}".strip()
        msg.set_content(body)
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        sent = _execute(service.users().messages().send(userId="me", body={"raw": raw, "threadId": thread_id}), self.on_wait)
        return sent.get("id", "")

    # -- fetch ---------------------------------------------------------------
    def fetch(self, since: datetime, skip: Callable[[str], bool]) -> Iterator[Message]:
        """Yield messages received at or after `since`, oldest first.

        The list of ids is cheap, so it is read in full first. Bodies are then downloaded one by one, so a
        sync that is cut short has already handed over everything before the point it stopped.
        """
        service = self._service(self._credentials())
        query = f"after:{int(since.timestamp())} {EXCLUDE}"
        ids, page = [], None
        while True:
            resp = _execute(service.users().messages().list(userId="me", q=query, pageToken=page, maxResults=500), self.on_wait)
            ids += [ref["id"] for ref in resp.get("messages", [])]
            page = resp.get("nextPageToken")
            if not page:
                break
        todo = [mid for mid in reversed(ids) if not skip(mid)]      # Gmail lists newest first
        self.pending = len(todo)
        for message_id in todo:
            raw = _execute(service.users().messages().get(userId="me", id=message_id, format="full"), self.on_wait)
            try:
                msg = parse_message(raw)
            except Exception as exc:
                log.warning("Skipping malformed Gmail message %s: %s", message_id, exc)
                continue
            yield msg


def _decode(data: str) -> str:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", errors="replace")


def _find_part(payload: dict, mime: str) -> str | None:
    if payload.get("mimeType") == mime and payload.get("body", {}).get("data"):
        return _decode(payload["body"]["data"])
    for part in payload.get("parts", []) or []:
        found = _find_part(part, mime)
        if found:
            return found
    return None


def _received_at(raw: dict, headers: dict) -> datetime:
    if raw.get("internalDate"):
        return datetime.fromtimestamp(int(raw["internalDate"]) / 1000, tz=timezone.utc)
    try:
        when = parsedate_to_datetime(headers["date"])
    except (KeyError, TypeError, ValueError, IndexError):
        raise ValueError(f"message {raw.get('id')} has no usable internalDate or Date header") from None
    # Naive means the header had no usable zone; treat it as UTC.
    return when.replace(tzinfo=timezone.utc) if when.tzinfo is None else when.astimezone(timezone.utc)


def _is_bulk(headers: dict) -> bool:
    """Mailing lists and newsletters say so in their headers; people and hiring systems don't."""
    return bool(headers.get("list-unsubscribe") or headers.get("list-id")
                or headers.get("precedence", "").strip().lower() in ("bulk", "list", "junk"))


def parse_message(raw: dict) -> Message:
    payload = raw.get("payload") or {}
    headers = {h["name"].lower(): h["value"] for h in payload.get("headers", [])}
    name, addr = parseaddr(headers.get("from", ""))
    html = _find_part(payload, "text/html") or ""
    body = _find_part(payload, "text/plain")
    if body is None:
        body = html_to_text(html) if html else raw.get("snippet", "")
    return Message(
        bulk=_is_bulk(headers),
        id=raw["id"],
        thread_id=raw.get("threadId", raw["id"]),
        sender_name=name,
        sender_email=addr,
        subject=headers.get("subject", ""),
        received_at=_received_at(raw, headers),
        body=body,
        html=html,
    )
