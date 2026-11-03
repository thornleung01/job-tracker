from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone

from . import db, learn, settings
from .classify import classify
from .extract import UNKNOWN_COMPANY, company_key, extract_company_role, role_key
from .jobs import alerts
from .jobs import store as jobstore
from .match import find_application
from .models import BODY_LIMIT, Message


def _remember_unrelated(conn: sqlite3.Connection, account_id: int, msg: Message, when: str) -> None:
    """Keep only the ID and date so the email isn't fetched or reprocessed."""
    conn.execute(
        "INSERT INTO emails (account_id, provider_msg_id, received_at, related) VALUES (?, ?, ?, 0)",
        (account_id, msg.id, when),
    )


IGNORED_KEEP_DAYS = 30


def _remember_ignored(conn: sqlite3.Connection, account_id: int, msg: Message, when: str, reason: str) -> None:
    """Mail a learned rule ignored stays restorable for a while: you can say "this was a real job"."""
    conn.execute(
        "INSERT OR IGNORE INTO ignored_mail (account_id, provider_msg_id, thread_id, received_at, sender, subject, body, web_link, reason, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (account_id, msg.id, msg.thread_id, when, f"{msg.sender_name} <{msg.sender_email}>", msg.subject, msg.body[:BODY_LIMIT],
         msg.web_link, reason, db.iso(datetime.now(timezone.utc))),
    )
    cutoff = db.iso(datetime.now(timezone.utc) - timedelta(days=IGNORED_KEEP_DAYS))
    conn.execute("DELETE FROM ignored_mail WHERE created_at < ?", (cutoff,))


def decide(conn: sqlite3.Connection, account_id: int, msg: Message, cls, when: str) -> tuple[int | None, bool]:
    """Find or make the application a job email belongs to. Returns (application id or None, needs a human look)."""
    company, role = extract_company_role(msg)
    ckey, rkey = company_key(company), role_key(role)

    match = find_application(conn, account_id, msg.thread_id, ckey, rkey, event=cls.event)
    needs_review = cls.confidence == "low" or match.kind == "ambiguous"
    # Weak wording is fine when the mail clearly belongs to a conversation already being followed (same thread, or the
    # one open application at that company): a "heard back" can only add to what is known, never invent anything.
    if cls.confidence == "low" and match.kind == "matched" and cls.event == "heard_back":
        needs_review = False
    app_id = None

    if not needs_review:
        if match.kind == "matched":
            app_id = match.application_id
        elif company == UNKNOWN_COMPANY:
            needs_review = True
        elif cls.event != "applied" and cls.confidence != "high":
            # "Interview" or "offer" somewhere in the text, with no application to attach it to: you decide.
            needs_review = True
        else:
            app_id = db.create_application(conn, company, ckey, role, rkey, db.STAGE_FOR_EVENT[cls.event], when)
        if app_id and match.kind == "matched":
            _fill_role(conn, app_id, role, rkey)
        if app_id:
            db.apply_event(conn, app_id, cls.event, when)
    return app_id, needs_review


def process_message(conn: sqlite3.Connection, account_id: int, msg: Message, learned=None) -> str:
    """Classify one email and update applications. Safe to re-run on the same email.

    Returns: duplicate | job-alert | ignored | applied-to-application | review
    """
    if db.email_seen(conn, account_id, msg.id):
        return "duplicate"

    when = db.iso(msg.received_at)
    if alerts.alert_site(msg):
        # A LinkedIn/Indeed job alert: its postings go to the Jobs tab, and it never becomes an application.
        jobstore.add_postings(conn, alerts.parse(msg))
        with conn:
            _remember_unrelated(conn, account_id, msg, when)
        return "job-alert"
    cls = classify(msg, learned if learned is not None else learn.load(conn))

    with conn:
        if not cls.related:
            _remember_unrelated(conn, account_id, msg, when)
            if cls.reason.startswith("learned:"):
                _remember_ignored(conn, account_id, msg, when, cls.reason)
            return "ignored"

        app_id, needs_review = decide(conn, account_id, msg, cls, when)

        conn.execute(
            "INSERT INTO emails (account_id, provider_msg_id, thread_id, received_at, sender, "
            "subject, body, related, event, confidence, application_id, needs_review, web_link, reason) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)",
            (
                account_id, msg.id, msg.thread_id, when,
                f"{msg.sender_name} <{msg.sender_email}>", msg.subject, msg.body[:BODY_LIMIT],
                cls.event, cls.confidence, app_id, int(needs_review), msg.web_link, cls.reason,
            ),
        )
    return "review" if needs_review else "applied-to-application"


def _fill_role(conn: sqlite3.Connection, app_id: int, role: str, rkey: str) -> None:
    """If an application was created without a role, adopt one once an email names it."""
    if not rkey:
        return
    conn.execute(
        "UPDATE applications SET role = ?, role_key = ? WHERE id = ? AND role_key = ''",
        (role, rkey, app_id),
    )


BATCH = 25


def _add(total: dict[str, int], more: dict[str, int]) -> None:
    for key, n in more.items():
        total[key] = total.get(key, 0) + n


def sync_account(
    conn: sqlite3.Connection, account: sqlite3.Row, days: int | None = None, get_provider=None, progress=None
) -> dict[str, int]:
    """Fetch and process one account. Records the outcome on the account row.

    `progress(**fields)` is told where the sync is (phase, done, total, note) so a page can show a progress bar.
    """
    from .config import OVERLAP_DAYS

    report = progress or (lambda **fields: None)
    get_provider = get_provider or _default_provider
    now = datetime.now(timezone.utc)
    if days is not None or not account["last_sync"]:
        since = now - timedelta(days=days or settings.load(conn)["sync"]["lookback_days"])
    else:
        last = datetime.strptime(account["last_sync"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        since = last - timedelta(days=OVERLAP_DAYS)

    try:
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

        if getattr(provider, "oldest_first", False):
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
        else:
            counts = process_messages(conn, account["id"], list(fetched()))
    except Exception as exc:  # one broken account must not stop the others
        with conn:
            conn.execute("UPDATE accounts SET last_error = ? WHERE id = ?", (f"{type(exc).__name__}: {exc}", account["id"]))
        raise
    from .recheck import settle_review

    settle_review(conn)          # new mail may be what an older, unsure email was waiting for
    skipped = counts.get("error", 0)
    note = f"Skipped {skipped} unreadable message{'s' if skipped != 1 else ''}" if skipped else None
    if counts.get("retry"):
        # Keep the old window start so the emails that hit a database error are fetched again next time.
        with conn:
            conn.execute("UPDATE accounts SET last_error = ? WHERE id = ?",
                         (f"{counts['retry']} message(s) hit a database error and will be retried", account["id"]))
        return counts
    with conn:
        conn.execute(
            "UPDATE accounts SET last_sync = ?, last_error = ? WHERE id = ?", (db.iso(now), note, account["id"])
        )
    return counts


def sync_all(conn: sqlite3.Connection, days: int | None = None, get_provider=None, progress=None) -> dict[str, dict | str]:
    results: dict[str, dict | str] = {}
    for account in conn.execute("SELECT * FROM accounts WHERE active = 1 ORDER BY id").fetchall():
        label = f"{account['provider']}:{account['address']}"
        if progress:
            progress(account=f"{account['provider'].capitalize()} {account['address']}")
        try:
            results[label] = sync_account(conn, account, days, get_provider, progress)
        except Exception as exc:
            results[label] = f"error: {exc}"
    return results


def _default_provider(name: str, address: str):
    from .providers import get_provider

    return get_provider(name, address)


def process_messages(conn: sqlite3.Connection, account_id: int, messages: list[Message]) -> dict[str, int]:
    """Process oldest-first so stages progress in the order things happened."""
    counts: dict[str, int] = {}
    learned = learn.load(conn)
    for msg in sorted(messages, key=lambda m: m.received_at):
        try:
            result = process_message(conn, account_id, msg, learned)
        except sqlite3.Error:
            # A database problem (locked, a concurrent sync) is temporary. Leave the email unmarked so the
            # next sync tries it again; marking it "not job mail" would lose a real reply for good.
            result = "retry"
        except Exception:
            # A message that can't be read at all would fail every time, so mark it seen and move on.
            result = "error"
            try:
                with conn:
                    _remember_unrelated(conn, account_id, msg, db.iso(msg.received_at))
            except sqlite3.Error:
                pass
        counts[result] = counts.get(result, 0) + 1
    return counts
