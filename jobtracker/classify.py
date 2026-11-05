"""Decide whether an email is about a job application, and which stage it reports. Plain rules, no AI.

The wording lives in rules.yaml; what you taught the app lives in learn.py and may tighten the result (a learned block
ignores a sender, a distrusted wording goes to Needs review). Every answer carries a short reason that the pages show.

The hosted edition in web/ has a TypeScript port of this module (web/src/pipeline/classify.ts). A change here, or to
rules.yaml, changes what that port must return: run `python scripts/build_rules_json.py` and `python scripts/export_fixtures.py`,
then commit the regenerated files with the change. See web/src/pipeline/PARITY_NOTES.md.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, replace
from functools import lru_cache
from pathlib import Path

import yaml

from .models import Message

RULES_PATH = Path(__file__).with_name("rules.yaml")
# Checked in this order; the first event with a match wins.
PRIORITY = ["offer", "rejected", "interview", "assessment", "applied"]
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")


@dataclass(frozen=True)
class Classification:
    related: bool
    event: str | None  # offer | rejected | interview | assessment | applied | heard_back
    confidence: str  # high | medium | low
    reason: str


@dataclass(frozen=True)
class Rules:
    ats_domains: tuple[str, ...]
    exclude_sender: tuple[re.Pattern, ...]
    exclude_subject: tuple[re.Pattern, ...]
    bulk: re.Pattern
    job_context: re.Pattern
    reply_context: re.Pattern
    negated_offers: tuple[re.Pattern, ...]
    conditionals: tuple[re.Pattern, ...]
    strong: dict[str, tuple[re.Pattern, ...]]
    weak: dict[str, tuple[re.Pattern, ...]]


def _compile(patterns) -> tuple[re.Pattern, ...]:
    return tuple(re.compile(p, re.I) for p in patterns or [])


@lru_cache(maxsize=1)
def load_rules(path: Path = RULES_PATH) -> Rules:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    events = raw["events"]
    return Rules(
        ats_domains=tuple(d.lower() for d in raw["ats_domains"]),
        exclude_sender=_compile(raw["exclude_sender"]),
        exclude_subject=_compile(raw["exclude_subject"]),
        bulk=re.compile(raw["bulk_markers"], re.I),
        job_context=re.compile(raw["job_context"], re.I),
        reply_context=re.compile(raw["reply_context"], re.I),
        negated_offers=_compile(raw["negated_offer_sentences"]),
        conditionals=_compile(raw["conditional_sentences"]),
        strong={e: _compile(v.get("strong")) for e, v in events.items()},
        weak={e: _compile(v.get("weak")) for e, v in events.items()},
    )


def is_ats_domain(domain: str, rules: Rules | None = None) -> bool:
    rules = rules or load_rules()
    domain = domain.lower()
    return any(domain == d or domain.endswith("." + d) for d in rules.ats_domains)


def _drop_sentences(text: str, patterns: tuple[re.Pattern, ...]) -> str:
    kept = [s for s in _SENTENCE_SPLIT.split(text) if s and not any(p.search(s) for p in patterns)]
    return "\n".join(kept)


def strip_conditionals(text: str, rules: Rules | None = None) -> str:
    """Drop boilerplate conditional sentences ("we'll contact you if selected...")."""
    rules = rules or load_rules()
    return _drop_sentences(text, rules.conditionals)


def strip_negated_offers(text: str, rules: Rules | None = None) -> str:
    """Drop sentences like "we are unable to extend an offer" so they can't count as an offer."""
    rules = rules or load_rules()
    return _drop_sentences(text, rules.negated_offers)


def classify(msg: Message, learned=None) -> Classification:
    """`learned` is what the app has learned from your corrections (see learn.py); None means none."""
    result = _classify(msg, learned)
    if learned and result.related and result.reason in learned.distrust and not is_ats_domain(msg.sender_domain):
        # This wording has been wrong too often to act on alone: you decide in Needs review.
        return Classification(True, result.event, "low", result.reason)
    return result


def _strong_event_in(subject: str, rules: Rules) -> str | None:
    """The first event (in PRIORITY order) whose strong wording is in this subject. A negated offer doesn't count as an offer."""
    for event in PRIORITY:
        text = strip_negated_offers(subject, rules) if event == "offer" else subject
        if any(p.search(text) for p in rules.strong[event]):
            return event
    return None


_QUOTES = str.maketrans({"\u2019": "'", "\u2018": "'", "\u201c": '"', "\u201d": '"', "\u00a0": " "})


def _classify(msg: Message, learned=None) -> Classification:
    rules = load_rules()
    # Mail software writes curly quotes ("we\u2019ve received your application"), and the phrases are written with straight ones.
    msg = replace(msg, subject=msg.subject.translate(_QUOTES), body=msg.body.translate(_QUOTES))

    sender = msg.sender_email.lower()
    if any(p.search(sender) for p in rules.exclude_sender):
        return Classification(False, None, "high", "excluded sender")
    if any(p.search(msg.subject) for p in rules.exclude_subject):
        return Classification(False, None, "high", "excluded subject")

    if learned and learned.blocks(sender, msg.sender_domain.lower()):
        # A learned block is built from a few clicks, so it must never hide mail that says, in its subject, that it is
        # about an application. That goes to Needs review instead, where you decide.
        event = _strong_event_in(msg.subject, rules)
        if event:
            return Classification(True, event, "low", f"learned block overridden by the subject: {event}")
        return Classification(False, None, "high", f"learned: ignoring {sender}")

    # A sender you confirmed is treated like a hiring system: its mail is job mail by definition.
    ats = is_ats_domain(msg.sender_domain, rules) or bool(learned and sender in learned.allow_senders)
    subject = strip_conditionals(msg.subject, rules)
    body = strip_conditionals(msg.body, rules)

    if not ats and (msg.bulk or rules.bulk.search(msg.body)):
        # A newsletter or marketing mail. Only its subject can say it is about your application.
        event = _strong_event_in(subject, rules)
        if event:
            return Classification(True, event, "medium", f"subject of a bulk mail: {event}")
        return Classification(False, None, "high", "newsletter or marketing mail")

    if not ats and not rules.job_context.search(f"{subject}\n{body}"):
        return Classification(False, None, "high", "no job context")

    for event in PRIORITY:
        # A negated offer is a rejection, not an offer.
        ev_subject, ev_body = (
            (strip_negated_offers(subject, rules), strip_negated_offers(body, rules))
            if event == "offer"
            else (subject, body)
        )
        for p in rules.strong[event]:
            if p.search(ev_subject):
                return Classification(True, event, "high", f"subject: {p.pattern}")
            if p.search(ev_body):
                return Classification(True, event, "high" if ats else "medium", f"body: {p.pattern}")
        for p in rules.weak[event]:
            if p.search(ev_subject) or p.search(ev_body):
                return Classification(True, event, "medium" if ats else "low", f"weak: {p.pattern}")

    if ats:
        return Classification(True, "heard_back", "medium", "hiring-system mail, no stage phrase")
    if rules.reply_context.search(f"{subject}\n{body}"):
        return Classification(True, "heard_back", "low", "job wording, no stage phrase")
    return Classification(False, None, "high", "no job reply")
