"""Fetching mail from the connected accounts and handing each message to `ingest`.

`sync_all` runs every active account (one failing account never stops the others), `sync_account` runs one and records
how it went on the account row, and `process_messages` stores a batch oldest-first so stages progress in the order things
happened.
"""
from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timedelta, timezone

from . import db, learn, settings
from .config import OVERLAP_DAYS
from .ingest import ERROR, RETRY, process_message, remember_unrelated
from .models import Message
from .recheck import settle_review

log = logging.getLogger(__name__)

BATCH = 25


def _add(total: dict[str, int], more: dict[str, int]) -> None:
    for key, n in more.items():
        total[key] = total.get(key, 0) + n


def _window_start(conn: sqlite3.Connection, account: sqlite3.Row, days: int | None, now: datetime) -> datetime:
    """Where to start reading: `days` back, the look-back in Settings for a first sync, or just before the last sync."""
    if days is not None or not account["last_sync"]:
        return now - timedelta(days=days or settings.load(conn)["sync"]["lookback_days"])
    return db.parse_iso(account["last_sync"]) - timedelta(days=OVERLAP_DAYS)


def _fetch_and_process(conn: sqlite3.Connection, account: sqlite3.Row, since: datetime, get_provider, report) -> dict[str, int]:
    provider = get_provider(account["provider"], account["address"])
    if hasattr(provider, "on_wait"):
        provider.on_wait = lambda seconds: report(note=f"Google asked us to slow down. Waiting {seconds} seconds, then carrying on.")
    report(phase="finding", done=0, total=None, note="")
    found = provider.fetch(since, lambda mid: db.email_seen(conn, account["id"], mid))

    def fetched():
        n = 0
        for msg in found:
            n += 1
            report(phase="reading", done=n, total=getattr(provider, "pending", None), note="")
            yield msg

    if not getattr(provider, "oldest_first", False):
        return process_messages(conn, account["id"], list(fetched()))
    # Save as we go, so a sync that stops part-way (a rate limit, a lost connection) keeps what it read
    # and the next one carries on from there. Memory stays flat on a big first scan, too.
    counts, batch = {}, []
    try:
        for msg in fetched():
            batch.append(msg)
            if len(batch) >= BATCH:
                _add(counts, process_messages(conn, account["id"], batch))
                batch = []
    finally:
        _add(counts, process_messages(conn, account["id"], batch))     # also the part-batch when the fetch fails
    return counts


def _record_outcome(conn: sqlite3.Connection, account: sqlite3.Row, counts: dict[str, int], now: datetime) -> None:
    """Write how the sync went on the account row. A sync that left emails to retry doesn't move the window start."""
    skipped = counts.get(ERROR, 0)
    note = f"Skipped {skipped} unreadable message{'s' if skipped != 1 else ''}" if skipped else None
    with conn:
        if counts.get(RETRY):
            # Keep the old window start so the emails that hit a database error are fetched again next time.
            conn.execute("UPDATE accounts SET last_error = ? WHERE id = ?",
                         (f"{counts[RETRY]} message(s) hit a database error and will be retried", account["id"]))
        else:
            conn.execute("UPDATE accounts SET last_sync = ?, last_error = ? WHERE id = ?", (db.iso(now), note, account["id"]))


def sync_account(
    conn: sqlite3.Connection, account: sqlite3.Row, days: int | None = None, *, get_provider, progress=None
) -> dict[str, int]:
    """Fetch and process one account. Records the outcome on the account row.

    `progress(**fields)` is told where the sync is (phase, done, total, note) so a page can show a progress bar.
    """
    now = datetime.now(timezone.utc)
    since = _window_start(conn, account, days, now)
    try:
        counts = _fetch_and_process(conn, account, since, get_provider, progress or (lambda **fields: None))
    except Exception as exc:  # one broken account must not stop the others
        with conn:
            conn.execute("UPDATE accounts SET last_error = ? WHERE id = ?", (f"{type(exc).__name__}: {exc}", account["id"]))
        raise
    settle_review(conn)          # new mail may be what an older, unsure email was waiting for
    _record_outcome(conn, account, counts, now)
    return counts


def sync_all(conn: sqlite3.Connection, days: int | None = None, *, get_provider, progress=None) -> dict[str, dict | str]:
    results: dict[str, dict | str] = {}
    for account in conn.execute("SELECT * FROM accounts WHERE active = 1 ORDER BY id").fetchall():
        label = f"{account['provider']}:{account['address']}"
        if progress:
            progress(account=f"{account['provider'].capitalize()} {account['address']}")
        try:
            results[label] = sync_account(conn, account, days, get_provider=get_provider, progress=progress)
        except Exception as exc:
            log.warning("Sync failed for account %s: %s", account["id"], exc)
            results[label] = f"error: {exc}"
    return results


def process_messages(conn: sqlite3.Connection, account_id: int, messages: list[Message]) -> dict[str, int]:
    """Process oldest-first so stages progress in the order things happened."""
    counts: dict[str, int] = {}
    learned = learn.load(conn)
    for msg in sorted(messages, key=lambda m: m.received_at):
        try:
            result = process_message(conn, account_id, msg, learned)
        except sqlite3.OperationalError:
            # A locked or busy database (a concurrent sync) is temporary. Leave the email unmarked so the
            # next sync tries it again; marking it "not job mail" would lose a real reply for good.
            log.warning("Message %s hit a database error and will be retried", msg.id, exc_info=True)
            result = RETRY
        except Exception:
            # A message that can't be read at all would fail every time, so mark it seen and move on.
            # The log is the only place the traceback survives, so it is kept; it names the message id, never its text.
            log.exception("Couldn't process message %s, so it is skipped", msg.id)
            result = ERROR
            try:
                with conn:
                    remember_unrelated(conn, account_id, msg.id, db.iso(msg.received_at))
            except sqlite3.Error:
                log.warning("Couldn't mark message %s as seen either", msg.id, exc_info=True)
        counts[result] = counts.get(result, 0) + 1
    return counts
