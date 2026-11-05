"""Learning from your corrections, with plain rules and no AI.

Every time you say "this isn't a job email" (or confirm that something is), the email's fingerprint is saved: who sent it,
its subject, and which rule made the app think it mattered. From those fingerprints a handful of simple, explainable rules
are rebuilt, saved per profile, and used by the classifier from then on:

- block a sender you only ever flagged as not job mail;
- block a whole domain once two of its addresses were flagged (never personal-mail or hiring-system domains);
- trust a sender whose mail you confirmed as job mail;
- distrust a classifier pattern that keeps being wrong, so what it finds goes to Needs review instead of making an application.

You can see and undo every rule. An undone rule stays undone until you give it new evidence.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from dataclasses import dataclass, field

from . import db
from .classify import is_ats_domain

PERSONAL_DOMAINS = {"gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com",
                    "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com"}
DISTRUST_MIN_FLAGS = 3
DISTRUST_MIN_SHARE = 0.75
DOMAIN_MIN_ADDRESSES = 2
ATS_SENDER_MIN_FLAGS = 2       # one employer's own address at a hiring system, flagged this many times


@dataclass(frozen=True)
class Learned:
    block_senders: frozenset = field(default_factory=frozenset)
    block_domains: frozenset = field(default_factory=frozenset)
    allow_senders: frozenset = field(default_factory=frozenset)
    distrust: frozenset = field(default_factory=frozenset)

    def blocks(self, sender: str, domain: str) -> bool:
        if sender in self.allow_senders:
            return False
        return sender in self.block_senders or any(domain == d or domain.endswith("." + d) for d in self.block_domains)


EMPTY = Learned()


def load(conn: sqlite3.Connection) -> Learned:
    by_kind: dict[str, set] = {}
    for r in conn.execute("SELECT kind, value FROM learned_rules WHERE active = 1"):
        by_kind.setdefault(r["kind"], set()).add(r["value"])
    return Learned(frozenset(by_kind.get("block_sender", ())), frozenset(by_kind.get("block_domain", ())),
                   frozenset(by_kind.get("allow_sender", ())), frozenset(by_kind.get("distrust_pattern", ())))


def split_sender(sender: str) -> str:
    """The address from 'Name <address>'."""
    return (sender.rpartition("<")[2].rstrip(">") if "<" in (sender or "") else (sender or "")).strip().lower()


def record(conn: sqlite3.Connection, verdict: str, email: sqlite3.Row, application_id: int | None = None) -> None:
    """Remember what this email looked like and what you said about it. Call before its content is erased."""
    address = split_sender(email["sender"] or "")
    conn.execute(
        "INSERT INTO feedback (created_at, verdict, sender_email, sender_domain, subject, reason, application_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (db.iso(datetime.now(timezone.utc)), verdict, address,
         address.rpartition("@")[2], email["subject"] or "", _reason(email), application_id),
    )


def _reason(email: sqlite3.Row) -> str:
    try:
        return email["reason"] or ""
    except (IndexError, KeyError):
        return ""


def describe(kind: str, value: str, evidence: int) -> str:
    times = f"{evidence} time{'s' if evidence != 1 else ''}"
    return {
        "block_sender": f"Ignoring emails from {value} (you flagged it {times})",
        "block_domain": f"Ignoring all emails from {value} (you flagged {evidence} of its addresses)",
        "allow_sender": f"Trusting emails from {value} (you confirmed it {times})",
        "distrust_pattern": f"Not trusting one wording on its own: \"{value}\" was wrong {times}, so matches go to Needs review",
    }[kind]


def _candidates(conn: sqlite3.Connection) -> dict[tuple[str, str], int]:
    """The rules the current feedback supports, with how many flags back each one."""
    senders: dict[str, list[int]] = {}      # address -> [not_job, job]
    reasons: dict[str, list[int]] = {}
    for r in conn.execute("SELECT verdict, sender_email, reason FROM feedback"):
        idx = 0 if r["verdict"] == "not_job" else 1
        if r["sender_email"]:
            senders.setdefault(r["sender_email"], [0, 0])[idx] += 1
        if r["reason"] and not r["reason"].startswith("learned"):
            reasons.setdefault(r["reason"], [0, 0])[idx] += 1

    out: dict[tuple[str, str], int] = {}
    domains: dict[str, list[str]] = {}
    confirmed_domains = {a.rpartition("@")[2] for a, (nj, j) in senders.items() if j}
    for address, (nj, j) in senders.items():
        domain = address.rpartition("@")[2]
        if not domain or "@" not in address:
            continue
        if j and not nj:
            out[("allow_sender", address)] = j
        elif nj and not j and (not is_ats_domain(domain) or nj >= ATS_SENDER_MIN_FLAGS):
            # A hiring-system address is blocked only on firmer evidence, and never as a whole domain.
            out[("block_sender", address)] = nj
            if domain not in PERSONAL_DOMAINS and not is_ats_domain(domain):
                domains.setdefault(domain, []).append(address)
    for domain, addresses in domains.items():
        if len(addresses) >= DOMAIN_MIN_ADDRESSES and domain not in confirmed_domains:
            out[("block_domain", domain)] = len(addresses)
    for reason, (nj, j) in reasons.items():
        if nj >= DISTRUST_MIN_FLAGS and nj / (nj + j) >= DISTRUST_MIN_SHARE:
            out[("distrust_pattern", reason)] = nj
    return out


def rebuild(conn: sqlite3.Connection) -> list[str]:
    """Bring the saved rules in line with all feedback. Returns plain-words descriptions of rules that are new."""
    wanted = _candidates(conn)
    existing = {(r["kind"], r["value"]): r for r in conn.execute("SELECT * FROM learned_rules")}
    new_rules = []
    with conn:
        for key, evidence in wanted.items():
            row = existing.get(key)
            if row is None:
                conn.execute("INSERT INTO learned_rules (kind, value, evidence, active, created_at) VALUES (?, ?, ?, 1, ?)",
                             (*key, evidence, db.iso(datetime.now(timezone.utc))))
                new_rules.append(describe(*key, evidence))
            elif not row["active"] and evidence > row["evidence"]:        # undone, but you gave it new evidence
                conn.execute("UPDATE learned_rules SET active = 1, evidence = ? WHERE id = ?", (evidence, row["id"]))
                new_rules.append(describe(*key, evidence))
            elif row["active"] and evidence != row["evidence"]:
                conn.execute("UPDATE learned_rules SET evidence = ? WHERE id = ?", (evidence, row["id"]))
        for key, row in existing.items():             # no longer supported, e.g. you later confirmed that sender
            if row["active"] and key not in wanted:
                conn.execute("UPDATE learned_rules SET active = 0 WHERE id = ?", (row["id"],))
    return new_rules


def active_rules(conn: sqlite3.Connection) -> list[dict]:
    order = {"block_domain": 0, "block_sender": 1, "allow_sender": 2, "distrust_pattern": 3}
    rows = conn.execute("SELECT * FROM learned_rules WHERE active = 1").fetchall()
    blocked = [r["value"] for r in rows if r["kind"] == "block_domain"]
    # A sender already covered by a domain rule is not listed twice (it still has its own rule underneath).
    rows = [r for r in rows if not (r["kind"] == "block_sender" and any(r["value"].endswith("@" + d) for d in blocked))]
    rows.sort(key=lambda r: (order[r["kind"]], -r["id"]))
    return [{"id": r["id"], "kind": r["kind"], "text": describe(r["kind"], r["value"], r["evidence"])} for r in rows]


def undo(conn: sqlite3.Connection, rule_id: int) -> bool:
    with conn:
        return conn.execute("UPDATE learned_rules SET active = 0 WHERE id = ? AND active = 1", (rule_id,)).rowcount > 0
