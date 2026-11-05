"""People you are in touch with, and what they do, worked out from the email threads. Plain rules, no AI.

A person turns up in two ways:
- as a sender: their address and display name, and a title found in their signature ("Sofia Hart Sales Sourcer DoorDash / Wolt
  sofia.hart@doordash.com", "Sam Senior Talent Acquisition Specialist @ Deel");
- as someone named in a message, usually a calendar invite: "Ben Hallett-Berry (Manager, Strategy & Operations)".

People belong to an application: a person's title is whatever that application's emails say, and your corrections apply to that
application only. Nothing is stored except those corrections (contact_edits); the list is rebuilt from the saved emails each time.
"""
from __future__ import annotations

import re
import sqlite3
from collections import Counter

from .links import reply_link
from .mailtext import parts, split_sender
from .reply import recipient

# Words that make a phrase a job title. A title is the capitalised words after a name, up to the last of these.
_KEYS = {
    "recruiter", "recruiting", "recruitment", "sourcer", "talent", "acquisition", "coordinator", "manager", "director", "head", "vp",
    "vice", "president", "lead", "partner", "specialist", "associate", "analyst", "engineer", "officer", "founder", "ceo", "cto", "coo",
    "cfo", "hr", "people", "operations", "worker", "representative", "consultant", "executive", "generalist", "principal", "owner",
    "scientist", "designer", "developer", "advisor", "adviser", "administrator", "assistant", "supervisor",
    "gm", "chief", "svp", "evp", "controller", "treasurer", "strategist", "architect",
}
_SMALL = {"&", "of", "and", "for", "the", "-", "/", ","}
_STOP_TOKEN = re.compile(r"^(?:[|·•@]|[-–—])$|@|^\d|^https?:", re.I)
_TEAM_WORDS = {"team", "hiring", "recruiting", "careers", "career", "support", "noreply", "no-reply", "hr", "people", "talent", "notifications",
               "jobs", "recruitment", "staffing", "admin", "info", "hello", "linkedin", "indeed", "glassdoor", "do", "not", "reply"}
_NAME_TOKEN = re.compile(r"^[A-Z][A-Za-z'’-]+$")
_NAME_PARTICLE = {"de", "la", "van", "von", "del", "da", "di", "le", "al", "bin", "ibn"}
_MENTION = re.compile(r"(?P<n>[A-Z][A-Za-z'’-]+(?: (?:[a-z]{2,3}|[A-Z][a-z]+))*(?: [A-Z][A-Za-z'’-]+){1,2}) \((?P<t>[^()]{3,90})\)")
_TEAM_INTRO = re.compile(r"\b(?:I'm|I am|my name is|My name’s|My name's)\s+(?P<n>[A-Z][a-z]+)[^.]{0,40}?\b(?:from|part of|on) the (?P<t>[A-Z][\w&/ ]{2,40}? team)", re.I)

KIND_LABEL = {"recruiter": "Recruiter", "hiring": "Hiring side", "people": "People ops"}


def kind_of(title: str) -> str:
    t = (title or "").lower()
    if re.search(r"recruit|sourcer|talent|coordinator", t):
        return "recruiter"
    if re.search(r"\bpeople\b|\bhr\b|human resources", t):
        return "people"
    if re.search(r"manager|director|\bhead\b|\bvp\b|vice president|president|chief|\bceo\b|\bcto\b|\bcoo\b|lead\b|principal|founder|owner", t):
        return "hiring"
    return ""


def _norm(name: str) -> str:
    return re.sub(r"[^a-z]", "", name.casefold())


def looks_like_a_person(name: str, address: str) -> bool:
    """A display name that is a human name, from an address that takes replies: not 'Deel HQ Hiring Team', not a bot."""
    if not name or name.lower() == (address or "").lower() or "@" in name:
        return False
    tokens = [t for t in name.replace(",", " ").split() if t]
    if not 2 <= len(tokens) <= 5:
        return False
    for t in tokens:
        if t.lower() in _TEAM_WORDS:
            return False
        if not (_NAME_TOKEN.match(t) or t.lower() in _NAME_PARTICLE):
            return False
    return True


def _is_key(token: str) -> bool:
    return token.strip(",&.()/-").lower() in _KEYS


def _title_after(tokens: list[str], start: int) -> str:
    """The job title that follows a name in a run of words, or ''."""
    take: list[str] = []
    for tok in tokens[start:start + 9]:
        if _STOP_TOKEN.search(tok):
            break
        take.append(tok)
    last = max((i for i, t in enumerate(take) if _is_key(t)), default=None)
    if last is None:
        return ""
    words = take[: last + 1]
    # Every word must read like part of a title: capitalised, or a small joining word.
    if not all(w[0].isupper() or w.lower() in _SMALL or w[0] in "&" for w in words) or words[0].lower() in _SMALL:
        return ""
    return " ".join(words).strip(" ,-/&")


def title_in_signature(text: str, names: list[str]) -> str:
    """Look for `<name> <title>` in flattened message text, trying the full name first, then the first name."""
    tokens = text.split()
    low = [t.lower() for t in tokens]
    for name in names:
        want = [w.lower() for w in name.split()]
        if not want:
            continue
        for i in range(len(tokens) - len(want)):
            if low[i:i + len(want)] == want:
                title = _title_after(tokens, i + len(want))
                if title:
                    return title
    return ""


def titles_in_mentions(text: str) -> list[tuple[str, str]]:
    """People named with a title in brackets, usually in an interview invite."""
    out = []
    for m in _MENTION.finditer(text):
        name, title = m.group("n"), re.split(r"\s+[-–|]\s+", m.group("t"))[0].strip()
        if not any(_is_key(w) for w in title.split()) or not looks_like_a_person(name, ""):
            continue
        out.append((name, title))
    return out


def _flat(body: str | None) -> str:
    main, thread, footer = parts(body or "")
    return re.sub(r"\s+", " ", " ".join(main + thread + footer))


MAX_MAILS = 25


def derive(conn: sqlite3.Connection, app_id: int | None = None) -> list[dict]:
    """The people on each application, worked out from that application's own emails, newest contact first.

    A person is listed once per application, with the title that application's mail gives them: the same recruiter can hold
    one role in one search and another in a different one, so nothing is carried between applications. Each person also carries
    the emails connected to them (what they sent, and invites that name them) and a link to write to them.
    """
    mine = {r["address"].lower() for r in conn.execute("SELECT address FROM accounts")}
    apps = {r["id"]: (r["company"], r["role"]) for r in conn.execute("SELECT id, company, role FROM applications")}
    sql = ("SELECT e.id, e.sender, e.subject, e.body, e.application_id, e.received_at, e.thread_id, e.web_link, a.provider, a.address, a.can_reply "
           "FROM emails e JOIN accounts a ON a.id = e.account_id WHERE e.related = 1 AND e.needs_review = 0 AND e.application_id IS NOT NULL")
    args: tuple = ()
    if app_id is not None:
        sql, args = sql + " AND e.application_id = ?", (app_id,)
    people: dict[tuple[int, str], dict] = {}               # (application, normalised name): a sender and a mention of them are one person
    mentions: list[tuple[int, str, str, sqlite3.Row]] = []

    for e in conn.execute(sql + " ORDER BY e.received_at", args):
        aid = e["application_id"]
        name, address = split_sender(e["sender"] or "")
        address = address.lower()
        text = _flat(e["body"])
        if address and address not in mine and recipient(e["sender"] or "") and looks_like_a_person(name, address):
            p = people.setdefault((aid, _norm(name)), {"name": name, "email": address, "titles": Counter(), "emails": 0, "last": "", "sender": True, "mails": {}})
            p["emails"] += 1
            p["last"] = max(p["last"], e["received_at"])
            p["mails"][e["id"]] = {"id": e["id"], "subject": e["subject"] or "(no subject)", "when": e["received_at"], "how": "from"}
            p["last_from"] = e                                     # the newest email they sent, which a new message will answer
            local_first = re.split(r"[._-]", address.split("@")[0])[0]
            guess = title_in_signature(text, [name, name.split()[0], local_first.capitalize()])
            if not guess:        # "I'm Nadia, from the People OPS team" says what they do even with no signature
                m = _TEAM_INTRO.search(text)
                if m and m.group("n").lower() == name.split()[0].lower():
                    guess = m.group("t")
            if guess:
                p["titles"][guess] += 1
        for n, t in titles_in_mentions(text):
            mentions.append((aid, n, t, e))

    first_names = {(aid, p["name"].split()[0].lower()) for (aid, _), p in people.items() if p["sender"]}
    for aid, n, t, e in mentions:
        words = n.split()
        if len(words) >= 3 and (aid, words[0].lower()) in first_names and words[0].lower() not in _NAME_PARTICLE:
            n = " ".join(words[1:])         # "Jocelyn Katie Ellison (Director)": the first word is the line above (a sender's name)
        p = people.setdefault((aid, _norm(n)), {"name": n, "email": "", "titles": Counter(), "emails": 0, "last": "", "sender": False, "mails": {}})
        p["titles"][t] += 1
        p["last"] = max(p["last"], e["received_at"])
        p["mails"].setdefault(e["id"], {"id": e["id"], "subject": e["subject"] or "(no subject)", "when": e["received_at"], "how": "mentions"})

    edits = {r["key"]: r for r in conn.execute("SELECT * FROM contact_edits")}
    out = []
    for (aid, norm), p in people.items():
        key = f"{aid}|{p['email'] or 'name:' + norm}"
        edit = edits.get(key)
        if edit and edit["hidden"]:
            continue
        title = edit["title"] if edit and edit["title"] is not None else (p["titles"].most_common(1)[0][0] if p["titles"] else "")
        company, role = apps.get(aid, ("", ""))
        mails = sorted(p["mails"].values(), key=lambda m: (m["when"], m["id"]), reverse=True)
        sent = p.get("last_from")
        out.append({
            "key": key, "app_id": aid, "name": edit["name"] if edit and edit["name"] else p["name"], "email": p["email"], "title": title,
            "kind": kind_of(title), "company": company, "role": role, "emails": p["emails"], "last": p["last"],
            "edited": bool(edit), "mentioned_only": not p["sender"],
            "mails": mails[:MAX_MAILS], "mail_count": len(mails), "latest_mail": mails[0] if mails else None,
            # a new message to them, written in the mailbox their latest email reached; and whether it can be answered from here
            "compose": reply_link(sent["provider"], sent["address"], sent["sender"], sent["subject"], sent["web_link"]) if sent else None,
            "reply_here": bool(sent and sent["can_reply"]), "reply_email_id": sent["id"] if sent else None,
        })
    out.sort(key=lambda c: c["last"], reverse=True)
    return out


def for_application(conn: sqlite3.Connection, app_id: int) -> list[dict]:
    return derive(conn, app_id)


def titles_from(people: list[dict]) -> dict[str, str]:
    """Address -> title, from people already worked out."""
    return {c["email"]: c["title"] for c in people if c["email"] and c["title"]}


def titles(conn: sqlite3.Connection, app_id: int) -> dict[str, str]:
    """Address -> title within one application, for showing a title beside a sender's name on that application's emails."""
    return {c["email"]: c["title"] for c in derive(conn, app_id) if c["email"] and c["title"]}


def save_edit(conn: sqlite3.Connection, key: str, name: str, title: str) -> None:
    name, title = re.sub(r"\s+", " ", name or "").strip()[:80], re.sub(r"\s+", " ", title or "").strip()[:100]
    with conn:
        conn.execute("INSERT INTO contact_edits (key, name, title, hidden) VALUES (?, ?, ?, 0) "
                     "ON CONFLICT (key) DO UPDATE SET name = excluded.name, title = excluded.title, hidden = 0", (key, name or None, title))


def hide(conn: sqlite3.Connection, key: str) -> None:
    with conn:
        conn.execute("INSERT INTO contact_edits (key, hidden) VALUES (?, 1) ON CONFLICT (key) DO UPDATE SET hidden = 1", (key,))
