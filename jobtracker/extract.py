"""Read the company and the role out of a job email: from the subject and body, the sender's name, and the sender's domain.

Plain rules, no AI. The hosted edition has a TypeScript port of this module (web/src/pipeline/extract.ts). A change here
changes what that port must return, so regenerate the golden fixtures (`python scripts/export_fixtures.py`) and commit them
with the change. See web/src/pipeline/PARITY_NOTES.md.
"""
from __future__ import annotations

import re
import unicodedata

from .classify import is_ats_domain
from .mailtext import INVISIBLE
from .models import Message

UNKNOWN_COMPANY = "Unknown company"
UNKNOWN_ROLE = "Unknown role"

FREE_MAIL = {
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
    "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com",
}
_NOISE_WORDS = re.compile(
    r"\b(?:careers?|recruiting|recruitment|recruiters?|talent|hr|jobs|hiring|team|"
    r"no-?reply|notifications?|do not reply|applications?|via \w+)\b",
    re.I,
)
_COMPANY_SUFFIX = re.compile(r"\b(?:inc|llc|ltd|limited|corp|corporation|co|company|gmbh|plc)\b\.?", re.I)
# Words that make a free-mail display name look like an organization rather than a person.
_ORG_WORDS = re.compile(
    r"\b(?:careers?|recruiting|recruitment|talent|hr|jobs|hiring|team|group|labs?|technologies|"
    r"solutions|systems|studios?|partners|bank|university|consulting|holdings|software|ventures)\b",
    re.I,
)
# A role is introduced by one of these; it never starts mid-sentence.
_INTRO = r"(?:\bfor (?:the|an?|our)|\bas an?|\bto the|\bof)"
MAX_ROLE_WORDS = 10
MAX_ROLE_CHARS = 80
# Titles name a team or a place too: "Operations Manager | NAM", "Customer Experience Lead, Business Owner".
_TITLE = r"[^.!\n]+?"

# (pattern, groups it provides). Tried in order against the subject, then the body.
_END = r"(?=\s*(?:[!.,:;|\n\u2014]|\s-\s|\s\u2013\s|\sfor\b|$))"
_PATTERNS = [
    re.compile(rf"application (?:to|for) (?:the )?(?P<r>[^|!\n]+?) (?:at|with) (?P<c>[^!.|\n,]+?){_END}", re.I),
    re.compile(rf"(?:applying|applied) (?:for|to) (?:the )?(?P<r>[^.\n,]+?) (?:position|role) (?:at|with) (?P<c>[^.\n,!]+?){_END}", re.I),
    re.compile(rf"(?:position|role) of (?P<r>[^.\n,]+?) (?:at|with) (?P<c>[^.\n,!]+?){_END}", re.I),
    re.compile(rf"{_INTRO} (?P<r>{_TITLE}) (?:position|role) (?:at|with) (?P<c>[^.\n,!]+?){_END}", re.I),
    re.compile(rf"(?:thank(?:s| you) for applying (?:to|at|with)|application (?:was sent )?to|interest in joining|interest in|applying to) (?P<c>[^!.|\n,]+?){_END}", re.I),
    re.compile(rf"(?:update|status) (?:on|regarding|about) your (?P<c>[^!.|\n]+?) application", re.I),
    re.compile(r"^(?P<c>[^-|\n]{2,40}?) - (?:thank|thanks|your application|application)", re.I),                # "Clio - Thank you for your application"
    re.compile(rf"consider the (?P<r>{_TITLE}) (?:position|role) (?:at|with) (?P<c>[^.\n,!]+?){_END}", re.I),
    re.compile(rf"(?:application|candidacy) (?:for|to) (?:the |our )?(?P<r>{_TITLE}) (?:position|role)\b", re.I),
    re.compile(rf"for (?:the|our) (?P<r>{_TITLE}) (?:position|role)\b", re.I),
    re.compile(rf"(?:position|role) of (?P<r>{_TITLE})\s*(?:[.!]|\n|$)", re.I),        # "our position of Customer Experience Lead."
    re.compile(r"next steps for (?:the )?(?P<r>[^|!\n]+?)\s*\|", re.I),                  # "Next Steps for Senior Associate | Name"
]


def _clean(value: str | None, limit: int | None = 60) -> str:
    if not value:
        return ""
    value = re.sub(r"\s+", " ", value).strip(" \t\"'-–:;,.!")
    return value[:limit].strip() if limit else value


def _clean_role(value: str | None) -> str:
    role = re.sub(r"\s+(?:position|role|opening|vacancy|job)$", "", _clean(value, None), flags=re.I)
    # A mangled fragment is worse than no role, so implausible candidates are dropped, not trimmed.
    if (
        len(role) > MAX_ROLE_CHARS
        or len(role.split()) > MAX_ROLE_WORDS
        or re.search(r"[.!?;:]", role)
        or re.match(r"(?:a|an|the|my|your|our)\b", role, re.I)       # "the role of a lifetime" is not a job title
        or re.search(r"\b(?:i|me|my|we|us|our|you|your)\b", role, re.I)
    ):
        return ""
    return role


def _tidy(text: str) -> str:
    """Invisible spacer characters (LinkedIn pads its mail with them) and runs of spaces break phrase matching."""
    text = re.sub("[\u00a0\u2000-\u200a\u202f\u205f\u3000]", " ", INVISIBLE.sub("", text or ""))  # no-break and other odd spaces
    return re.sub(r"[ \t]+", " ", text)


def _linkedin_role(msg: Message, body: str, company: str) -> str:
    """LinkedIn's "your application was sent" mail: the title sits between two mentions of the company."""
    if not company or not (msg.sender_domain == "linkedin.com" or msg.sender_domain.endswith(".linkedin.com")):
        return ""
    # The title may not contain "sent to", so the match starts at the last mention, not the banner at the top.
    m = re.search(rf"sent to {re.escape(company)}\s+(?P<r>(?:(?!sent to)[^\n·])+?)\s+{re.escape(company)}\s*·", body, re.I)
    return _clean_role(m.group("r")) if m else ""


def extract_company_role(msg: Message) -> tuple[str, str]:
    company = role = ""
    body = _tidy(msg.body)
    # The last pass flattens line breaks, for titles that mail software broke across lines.
    for text in (_tidy(msg.subject), body, re.sub(r"\s+", " ", body)):
        for pat in _PATTERNS:
            m = pat.search(text)
            if not m:
                continue
            groups = m.groupdict()
            company = company or _clean(groups.get("c"))
            role = role or _clean_role(groups.get("r"))
        if company and role:
            break
    company = company or _sender_company(msg)
    role = role or _linkedin_role(msg, _tidy(msg.body), company)
    return company or UNKNOWN_COMPANY, role or UNKNOWN_ROLE


_SECOND_LEVEL = frozenset({"co", "com", "org", "net", "gov", "ac", "edu", "gob",
                           "ltd", "plc", "sch", "me", "nic", "gen", "ind", "ne", "or", "go", "gc",
                           "ab", "bc", "mb", "nb", "nl", "ns", "nt", "nu", "on", "pe", "qc", "sk", "yt"})


def _sender_company(msg: Message) -> str:
    raw_name = msg.sender_name or ""
    name = _clean(_NOISE_WORDS.sub(" ", raw_name))
    if "@" in name:
        name = ""
    domain = msg.sender_domain
    if domain in FREE_MAIL:
        # Nothing to learn from the domain; only trust a name that reads like an organization.
        return name if name and (_ORG_WORDS.search(raw_name) or _COMPANY_SUFFIX.search(raw_name)) else ""
    if is_ats_domain(domain):
        if name:
            return name   # the display name is the employer ("Acme Careers"); the domain is the vendor
        # Some hiring systems send from <employer>@<system>.com with no display name.
        local = msg.sender_email.split("@")[0]
        return "" if re.fullmatch(r"(?:no-?reply|do-?not-?reply|jobs?|careers?|recruiting|notifications?|info|support|hr|talent)", local, re.I) else local.capitalize()
    parts = domain.split(".")
    # Under a two-letter country domain the company is one label further left only when the second-last label is a registry
    # label (acme.co.uk, acme.com.au, hospital.on.ca); jobs.rbc.ca is rbc under a subdomain, not "jobs".
    label = parts[-3] if len(parts) >= 3 and len(parts[-1]) == 2 and parts[-2] in _SECOND_LEVEL else parts[-2] if len(parts) >= 2 else ""
    # A person's name ("Jane Smith <jane@acme.com>") isn't the company; the domain is.
    if name and label and _fold(label) in _fold(name):
        return name
    return label.capitalize()


def _fold(value: str) -> str:
    """Casefold, drop accents on Latin letters, keep letters/digits of any script."""
    out: list[str] = []
    for ch in unicodedata.normalize("NFKD", value.casefold()):
        if unicodedata.combining(ch) and out and out[-1].isascii():
            continue  # keeps kana/Hangul marks, which change the letter
        if ch.isalnum():
            out.append(ch)
    return "".join(out)


def company_key(company: str) -> str:
    if not company or company == UNKNOWN_COMPANY:
        return ""
    return _fold(_COMPANY_SUFFIX.sub("", company.casefold()))


def role_key(role: str) -> str:
    if not role or role == UNKNOWN_ROLE:
        return ""
    return _fold(role)
