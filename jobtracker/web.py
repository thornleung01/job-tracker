from __future__ import annotations

import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlencode, urlparse

from fastapi import Depends, FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

import requests

import secrets

from . import activity, contacts as contactsmod, db, learn, links, mailtext, reply as replymod, settings, stats
from .extract import UNKNOWN_ROLE, company_key, role_key
from .jobs import notify as jobnotify
from .jobs import store as jobstore
from .jobs.run import run_discovery
from .jobs_web import register as register_jobs
from .profiles import DEFAULT_ID, ProfileError, Profiles
from .providers import clients
from .sync import sync_all

STAGES = ["Applied", "Heard back", "Assessment", "Interview", "Offer", "Rejected"]
EVENT_FOR_STAGE = {v: k for k, v in db.STAGE_FOR_EVENT.items()}
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
TEMPLATE_DIR = str(Path(__file__).with_name("templates"))
STATIC_DIR = str(Path(__file__).with_name("static"))
PERIODS = [(0, "All time"), (30, "Last 30 days"), (90, "Last 90 days"), (180, "Last 180 days")]
SCAN_CHOICES = [(0, "New mail since last sync"), *PERIODS[1:]]
# Columns you can sort the list by. The stage sorts by pipeline order, not alphabetically.
_STAGE_ORDER = "CASE a.stage " + " ".join(f"WHEN '{s}' THEN {i}" for i, s in enumerate(STAGES)) + " END"
SORT_SQL = {
    "company": "a.company COLLATE NOCASE {d}",
    "role": "a.role COLLATE NOCASE {d}",
    "stage": _STAGE_ORDER + " {d}",
    "applied": "a.applied_at IS NULL, a.applied_at {d}",   # unknown dates always last
    "last_activity": "a.last_activity {d}",
    "emails": "n_emails {d}",
}
DEFAULT_DIR = {"applied": "desc", "last_activity": "desc", "emails": "desc"}
SAVED_MESSAGES = {
    "appearance": "Appearance settings saved.", "sync": "Sync settings saved.",
}
PROFILE_COOKIE = "jt_profile"
SIGN_IN_WAIT = 330      # seconds a sign-in may stay "waiting" (the providers give up after 300)
PROVIDERS = ("gmail", "outlook")


def _eta_text(seconds: float | None) -> str:
    if seconds is None:
        return "Estimating time left…"
    if seconds < 45:
        return "Less than a minute left"
    if seconds < 90:
        return "About 1 minute left"
    if seconds < 3600:
        return f"About {round(seconds / 60)} minutes left"
    hours, minutes = divmod(round(seconds / 60), 60)
    return f"About {hours} h {minutes} min left"


def sync_view(s: dict) -> dict:
    """What the progress bar shows for a sync's state: ready-made text, so the page only has to display it."""
    phase, done, total = s["phase"], s["done"], s.get("total")
    who = f"{s['account']} · " if s.get("account") else ""
    percent, eta = None, ""
    if phase == "reading":
        label = f"{who}Reading emails: {done} of {total}" if total else f"{who}Reading emails: {done} so far"
        if total:
            percent = min(100, round(100 * done / total))
            steps = done - s.get("first_done", 0)
            if s.get("t0") and steps >= 3:
                eta = _eta_text((time.time() - s["t0"]) / steps * max(total - done, 0))
            else:
                eta = _eta_text(None)
    elif phase == "jobs":
        label = "Looking for new jobs…"
    else:
        label = f"{who}Finding your emails…"
    return {"running": s["running"], "label": label, "percent": percent, "eta": eta, "note": s.get("note", "")}


def _short(text: str, limit: int = 400) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _now() -> str:
    return db.iso(datetime.now(timezone.utc))


def _days_since(iso: str | None) -> int | None:
    if not iso:
        return None
    then = datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - then).days


def _counts(conn) -> dict[str, int]:
    counts = {s: 0 for s in STAGES}
    for r in conn.execute("SELECT stage, COUNT(*) n FROM applications GROUP BY stage"):
        counts[r["stage"]] = r["n"]
    return counts


def _suggestions(conn) -> list[dict]:
    """The companies and roles you actually have, newest activity first, for the search box."""
    items = []
    for kind, col in (("Company", "company"), ("Role", "role")):
        for r in conn.execute(
            f"SELECT {col} AS text, COUNT(*) AS n, MAX(last_activity) AS latest FROM applications "
            f"WHERE {col}_key != '' GROUP BY {col}_key ORDER BY latest DESC LIMIT 300"
        ):
            items.append({"kind": kind, "text": r["text"], "n": r["n"]})
    return items


def _panel_ctx(conn, app_id: int, *, error=None, form=None, swaps=False, include_emails=True, status=None) -> dict:
    """Everything _panel.html needs. `swaps` adds the hidden elements that refresh the list row in place."""
    a = conn.execute("SELECT * FROM applications WHERE id = ?", (app_id,)).fetchone()
    if not a:
        raise HTTPException(404)
    items, total = activity.history(conn, app_id, 20, include_emails)
    n_emails = conn.execute("SELECT COUNT(*) FROM emails WHERE application_id = ?", (app_id,)).fetchone()[0]
    return {
        "a": a, "r": dict(a, idle_days=_days_since(a["last_activity"]), n_emails=n_emails),
        "entries": items, "total": total, "stages": STAGES, "error": error, "form": form or {},
        "today": activity.today().isoformat(), "swaps": swaps, "counts": _counts(conn) if swaps else None,
        "include_emails": include_emails, "status": status, "step_groups": activity.STEP_GROUPS,
        "latest_email": next((i["id"] for i in items if i["kind"] == "email"), None), "titles": contactsmod.titles(conn, app_id),
    }


def create_app(db_path=db.DEFAULT_PATH, get_provider=None, http_get=None, toast=None, secrets_dir=None) -> FastAPI:
    """`http_get` and `toast` let tests stand in for the internet and for Windows pop-ups."""
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    profiles = Profiles(Path(db_path).parent, db_path, secrets_dir)
    app.state.profiles = profiles
    connecting: dict[tuple[str, str], dict] = {}     # sign-ins in progress, by (profile, provider)
    connecting_lock = threading.Lock()
    app.state.connect_thread = None
    syncs: dict[str, dict] = {}                      # a sync in progress or just finished, by profile
    syncs_lock = threading.Lock()
    app.state.sync_thread = None

    def provider_factory(pid: str):
        if get_provider:
            return get_provider
        from .providers import get_provider as default_get_provider

        return lambda name, address: default_get_provider(name, address, profile=pid)

    def who(pid: str) -> str:
        """Which profile a pop-up is about, only when there is more than one to tell apart."""
        return profiles.name(pid) if len(profiles.ids()) > 1 else ""

    def ui_context(request: Request) -> dict:
        conn = db.connect(profiles.db_path(request.state.profile))
        try:
            ui = dict(settings.load(conn)["appearance"])
            jobs_new = jobstore.unseen_matches(conn)      # the number on the Jobs tab
        finally:
            conn.close()
        light, dark = settings.ACCENTS[ui["accent"]]
        return {"ui": {**ui, "accent_light": light, "accent_dark": dark}, "jobs_new": jobs_new,
                "profiles": profiles.list(), "profile_id": request.state.profile}

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")   # self-hosted fonts
    templates = Jinja2Templates(directory=TEMPLATE_DIR, context_processors=[ui_context])
    templates.env.globals["mailbox_link"] = links.mailbox_link
    templates.env.globals["reply_link"] = links.reply_link
    templates.env.globals["new_token"] = lambda: secrets.token_hex(8)       # one per reply form, so pressing Send twice sends once
    templates.env.filters["mailtext"] = mailtext.render
    templates.env.filters["sender_name"] = lambda s: mailtext.split_sender(s)[0]
    templates.env.filters["sender_addr"] = lambda s: mailtext.split_sender(s)[1]

    @app.middleware("http")
    async def local_only(request: Request, call_next):
        # Blocks DNS-rebinding and cross-site form posts from other web pages.
        if request.url.hostname not in LOCAL_HOSTS:
            return HTMLResponse("Forbidden", status_code=403)
        if request.method == "POST":
            # The page must be this app itself: same host AND port (another local app on a different port
            # is a different origin), and the browser must not say the request came from another site.
            origin = request.headers.get("origin")
            if origin and urlparse(origin).netloc != request.headers.get("host", ""):
                return HTMLResponse("Forbidden", status_code=403)
            if request.headers.get("sec-fetch-site", "same-origin") not in ("same-origin", "none"):
                return HTMLResponse("Forbidden", status_code=403)
        # Which profile this page is for: a link from a pop-up (?profile=), else the one chosen last, else the first.
        requested = request.query_params.get("profile") if request.method == "GET" else None
        cookie = request.cookies.get(PROFILE_COOKIE)
        request.state.profile = next((p for p in (requested, cookie) if profiles.exists(p)), DEFAULT_ID)
        response = await call_next(request)
        if requested and profiles.exists(requested) and cookie != requested:
            response.set_cookie(PROFILE_COOKIE, requested, httponly=True, samesite="lax", max_age=3600 * 24 * 365)
        return response

    def get_conn(request: Request):
        conn = db.connect(profiles.db_path(request.state.profile))
        try:
            yield conn
        finally:
            conn.close()

    def back(url: str = "/") -> RedirectResponse:
        return RedirectResponse(url, status_code=303)

    # -- pages ---------------------------------------------------------------
    @app.get("/", response_class=HTMLResponse)
    def index(request: Request, stage: str = "", q: str = "", account: int = 0, open: str = "",
              sort: str = "", dir: str = "", conn=Depends(get_conn)):
        sort = sort if sort in SORT_SQL else "last_activity"
        direction = dir if dir in ("asc", "desc") else DEFAULT_DIR.get(sort, "asc")
        where, params = [], []
        if stage in STAGES:
            where.append("a.stage = ?")
            params.append(stage)
        if q.strip():
            # % and _ in what you type are ordinary characters, not wildcards.
            literal = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            where.append("(a.company LIKE ? ESCAPE '\\' OR a.role LIKE ? ESCAPE '\\')")
            params += [f"%{literal}%"] * 2
        if account:
            where.append("EXISTS (SELECT 1 FROM emails e WHERE e.application_id = a.id AND e.account_id = ?)")
            params.append(account)
        sql = (
            "SELECT a.*, (SELECT COUNT(*) FROM emails e WHERE e.application_id = a.id) AS n_emails "
            "FROM applications a" + (" WHERE " + " AND ".join(where) if where else "")
            + f" ORDER BY {SORT_SQL[sort].format(d=direction)}, a.id"
        )
        rows = [dict(r, idle_days=_days_since(r["last_activity"])) for r in conn.execute(sql, params)]
        # ?open=3,7 renders those rows already expanded (also what the page does without JavaScript).
        open_ids = {int(x) for x in open.split(",") if x.strip().isdigit()}
        panels = {r["id"]: _panel_ctx(conn, r["id"]) for r in rows if r["id"] in open_ids}
        filters = {k: v for k, v in {"stage": stage, "q": q.strip(), "account": account or ""}.items() if v}
        sorting = {} if (sort, direction) == ("last_activity", "desc") else {"sort": sort, "dir": direction}

        def href(*, ids=open_ids, **extra) -> str:
            params = {**filters, **{**sorting, **extra}, **({"open": ",".join(str(i) for i in sorted(ids))} if ids else {})}
            return "/?" + urlencode(params) if params else "/"
        toggle = {r["id"]: href(ids=open_ids ^ {r["id"]}) for r in rows}
        sort_links = {
            col: href(sort=col, dir=("desc" if direction == "asc" else "asc") if sort == col else DEFAULT_DIR.get(col, "asc"))
            for col in SORT_SQL
        }
        total = conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0]
        return templates.TemplateResponse(request, "index.html", {
            "rows": rows, "counts": _counts(conn), "stages": STAGES, "stage": stage, "q": q, "account": account,
            "panels": panels, "toggle": toggle, "sort": sort, "direction": direction, "sort_links": sort_links,
            "total": total, "filtered": bool(filters), "sorting": sorting, "suggestions": _suggestions(conn),
            "accounts": conn.execute("SELECT * FROM accounts ORDER BY id").fetchall(),
            "review_count": conn.execute("SELECT COUNT(*) FROM emails WHERE needs_review = 1").fetchone()[0],
            "columns": settings.load(conn)["appearance"]["columns"], "col_labels": settings.COLUMNS,
            "today": activity.today().isoformat(),
        })

    @app.get("/app/{app_id}", response_class=HTMLResponse)
    def detail(request: Request, app_id: int, conn=Depends(get_conn)):
        application = conn.execute("SELECT * FROM applications WHERE id = ?", (app_id,)).fetchone()
        if not application:
            raise HTTPException(404)
        emails = conn.execute(
            "SELECT e.*, a.provider, a.address, a.can_reply FROM emails e JOIN accounts a ON a.id = e.account_id "
            "WHERE e.application_id = ? ORDER BY e.received_at DESC, e.id DESC", (app_id,)
        ).fetchall()
        sent = conn.execute("SELECT * FROM sent_replies WHERE application_id = ?", (app_id,)).fetchall()
        timeline = sorted([{"kind": "email", "when": e["received_at"], "id": e["id"], "row": e} for e in emails]
                          + [{"kind": "sent", "when": s["created_at"], "id": s["id"], "row": s} for s in sent],
                          key=lambda t: (t["when"], t["kind"] == "sent", t["id"]), reverse=True)
        others = conn.execute("SELECT id, company, role FROM applications WHERE id != ? ORDER BY company", (app_id,)).fetchall()
        # The detail page keeps its own full email timeline, so the panel only lists notes and steps.
        p = _panel_ctx(conn, app_id, error=request.query_params.get("error"), include_emails=False)
        return templates.TemplateResponse(request, "detail.html", {
            "a": application, "emails": emails, "timeline": timeline, "latest_email_id": emails[0]["id"] if emails else None,
            "stages": STAGES, "others": others, "p": p, "people": contactsmod.for_application(conn, app_id), "kind_label": contactsmod.KIND_LABEL, "titles": contactsmod.titles(conn, app_id),
            "notice": request.query_params.get("notice"), "reply_error": request.query_params.get("reply_error"),
        })

    @app.get("/app/{app_id}/panel", response_class=HTMLResponse)
    def panel(request: Request, app_id: int, conn=Depends(get_conn)):
        return templates.TemplateResponse(request, "_panel.html", {"p": _panel_ctx(conn, app_id)})

    @app.get("/flow", response_class=HTMLResponse)
    def flow(request: Request, account: int = 0, days: int | None = None, conn=Depends(get_conn)):
        if days is None:
            days = settings.load(conn)["appearance"]["flow_days"]
        return templates.TemplateResponse(request, "flow.html", {
            "data": stats.sankey(conn, account, days), "account": account, "days": days,
            "accounts": conn.execute("SELECT * FROM accounts ORDER BY id").fetchall(),
            "periods": PERIODS,
        })

    def learned_from_feedback(conn) -> tuple[list[str], int]:
        """Turn the feedback so far into rules, then clear saved mail the new rules no longer believe."""
        from .recheck import recheck

        rules = learn.rebuild(conn)
        return rules, recheck(conn)["cleared"] if rules else 0

    def learned_notice(rules: list[str], cleared: int, prefix: str = "") -> str:
        if not rules:
            return f"?notice={quote(prefix)}" if prefix else ""
        text = (prefix + " " if prefix else "") + "Learned: " + "; ".join(rules) + "."
        if cleared:
            text += f" Also cleared {cleared} similar email{'s' if cleared != 1 else ''}."
        return f"?notice={quote(_short(text, 600))}"

    @app.post("/app/{app_id}/edit")
    def edit_application(app_id: int, company: str = Form(""), role: str = Form(""), conn=Depends(get_conn)):
        """Fix the company or role by hand. An edited application is yours: re-checks and syncs won't rewrite it."""
        if not conn.execute("SELECT 1 FROM applications WHERE id = ?", (app_id,)).fetchone():
            raise HTTPException(404)
        company, role = re.sub(r"\s+", " ", company).strip()[:80], re.sub(r"\s+", " ", role).strip()[:100]
        if not company:
            return back(f"/app/{app_id}?error={quote('The company cannot be empty.')}")
        role = role or UNKNOWN_ROLE
        with conn:
            conn.execute("UPDATE applications SET company = ?, company_key = ?, role = ?, role_key = ?, manual = 1 WHERE id = ?",
                         (company, company_key(company), role, role_key(role), app_id))
        return back(f"/app/{app_id}")

    @app.post("/app/{app_id}/not-application")
    def not_an_application(app_id: int, conn=Depends(get_conn)):
        """You are telling it this was never a job application: remove it, and learn from the emails that made it."""
        from .recheck import clear_email

        a = conn.execute("SELECT * FROM applications WHERE id = ?", (app_id,)).fetchone()
        if not a:
            raise HTTPException(404)
        with conn:
            for e in conn.execute("SELECT * FROM emails WHERE application_id = ? AND related = 1", (app_id,)).fetchall():
                learn.record(conn, "not_job", e)
                clear_email(conn, e["id"])
            conn.execute("DELETE FROM applications WHERE id = ?", (app_id,))
        rules, cleared = learned_from_feedback(conn)
        return back("/review" + learned_notice(rules, cleared, f"Removed {a['company']}."))

    @app.post("/ignored/{ignored_id}/real")
    def ignored_is_real(ignored_id: int, conn=Depends(get_conn)):
        """You are telling it a mail it ignored was a real job email: the rule that hid it is undone, and it is read again."""
        from .models import Message
        from .sync import process_message

        row = conn.execute("SELECT * FROM ignored_mail WHERE id = ?", (ignored_id,)).fetchone()
        if not row:
            raise HTTPException(404)
        with conn:
            learn.record(conn, "job", {"sender": row["sender"], "subject": row["subject"], "reason": ""})
            conn.execute("DELETE FROM emails WHERE account_id = ? AND provider_msg_id = ? AND related = 0",
                         (row["account_id"], row["provider_msg_id"]))
            conn.execute("DELETE FROM ignored_mail WHERE id = ?", (ignored_id,))
        learn.rebuild(conn)             # confirming the sender switches off the rules that hid it
        name, _, address = row["sender"].partition("<")
        msg = Message(row["provider_msg_id"], row["thread_id"] or "", name.strip(), address.rstrip(">").strip(), row["subject"],
                      datetime.strptime(row["received_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc), row["body"],
                      web_link=row["web_link"])
        outcome = process_message(conn, row["account_id"], msg)
        if outcome == "ignored":
            done = "Rule undone, but this email doesn't read like a job email, so it stays ignored."
        elif outcome == "review":
            done = "Restored. It's in Needs review above; the rule that hid it is gone."
        else:
            done = "Restored and added to your applications. The rule that hid it is gone."
        return back(f"/review?notice={quote(done)}")

    @app.post("/learned/{rule_id}/undo")
    def undo_rule(rule_id: int, conn=Depends(get_conn)):
        if not learn.undo(conn, rule_id):
            raise HTTPException(404)
        done = "Rule removed. New mail is judged without it. Mail it already cleared stays cleared."
        return back(f"/review?notice={quote(done)}#learned")

    CONTACT_KEY = re.compile(r"\d+\|(?:[^@\s|]+@[^@\s|]+|name:[a-z]+)")

    def contact_return(next_url: str) -> str:
        """Back to the page the edit was made on: an application, or the People tab."""
        return next_url if re.fullmatch(r"/app/\d+|/contacts", next_url or "") else "/contacts"

    @app.get("/contacts", response_class=HTMLResponse)
    def contacts_page(request: Request, q: str = "", conn=Depends(get_conn)):
        everyone = contactsmod.derive(conn)
        needle = q.strip().casefold()
        shown = [c for c in everyone if not needle or needle in " ".join([c["name"], c["title"], c["company"], c["role"], c["email"]]).casefold()]
        groups: dict[int, dict] = {}
        for c in shown:                      # newest contact first within an application, and the application you spoke to last on top
            g = groups.setdefault(c["app_id"], {"id": c["app_id"], "company": c["company"], "role": c["role"], "last": c["last"], "people": []})
            g["people"].append(c)
            g["last"] = max(g["last"], c["last"])
        return templates.TemplateResponse(request, "contacts.html", {
            "groups": sorted(groups.values(), key=lambda g: g["last"], reverse=True), "shown": len(shown), "total": len(everyone), "q": q.strip(),
            "kind_label": contactsmod.KIND_LABEL, "notice": request.query_params.get("notice"),
        })

    @app.post("/contacts/edit")
    def edit_contact(key: str = Form(...), name: str = Form(""), title: str = Form(""), next_url: str = Form("/contacts", alias="next"),
                     conn=Depends(get_conn)):
        if not CONTACT_KEY.fullmatch(key):
            raise HTTPException(400)
        contactsmod.save_edit(conn, key, name, title)
        return back(f"{contact_return(next_url)}?notice={quote('Saved.')}")

    @app.post("/contacts/hide")
    def hide_contact(key: str = Form(...), next_url: str = Form("/contacts", alias="next"), conn=Depends(get_conn)):
        if not CONTACT_KEY.fullmatch(key):
            raise HTTPException(400)
        contactsmod.hide(conn, key)
        return back(f"{contact_return(next_url)}?notice={quote('Removed from this application. It is not a person, or you do not want it here.')}")

    @app.get("/review", response_class=HTMLResponse)
    def review(request: Request, conn=Depends(get_conn)):
        from .extract import extract_company_role
        from .models import Message

        emails = []
        for e in conn.execute(
            "SELECT e.*, a.provider, a.address, a.can_reply FROM emails e JOIN accounts a ON a.id = e.account_id "
            "WHERE e.needs_review = 1 ORDER BY e.received_at DESC"
        ):
            msg = Message(e["provider_msg_id"], e["thread_id"] or "", "", (e["sender"] or "").split("<")[-1].rstrip(">"),
                          e["subject"] or "", datetime.now(timezone.utc), e["body"] or "")
            company, role = extract_company_role(msg)
            emails.append({**dict(e), "guess_company": company, "guess_role": role,
                           "guess_stage": db.STAGE_FOR_EVENT.get(e["event"], "Applied")})
        apps = conn.execute("SELECT id, company, role FROM applications ORDER BY company").fetchall()
        return templates.TemplateResponse(request, "review.html", {
            "emails": emails, "apps": apps, "stages": STAGES, "learned": learn.active_rules(conn),
            "ignored": conn.execute("SELECT * FROM ignored_mail ORDER BY received_at DESC LIMIT 50").fetchall(),
            "notice": request.query_params.get("notice"), "error": request.query_params.get("error"),
        })

    @app.get("/settings", response_class=HTMLResponse)
    def settings_page(request: Request, conn=Depends(get_conn)):
        s = settings.load(conn)
        params = request.query_params
        pid = request.state.profile
        notice, error = params.get("notice"), params.get("error")
        waiting = False
        with connecting_lock:
            for provider in PROVIDERS:
                state = connecting.get((pid, provider))
                if not state:
                    continue
                if state["state"] == "waiting":
                    waiting = True
                else:                               # a finished sign-in is reported once
                    connecting.pop((pid, provider))
                    if state["state"] == "done":
                        notice = state["message"]
                    else:
                        error = state["message"]
        sync_progress = None
        with syncs_lock:
            state = syncs.get(pid)
            if state and state["running"]:
                sync_progress = sync_view(state)
            elif state and state.get("message") and not (notice or error):    # a finished sync is reported once
                notice, error = (None, state["message"]) if state["failed"] else (state["message"], None)
                state["message"] = ""
        providers_view = {}
        for name, pretty in (("gmail", "Gmail"), ("outlook", "Outlook")):
            live = [a for a in conn.execute("SELECT * FROM accounts WHERE provider = ? AND active = 1 ORDER BY id", (name,))]
            broken = [a for a in live if a["last_error"] and not a["last_error"].startswith("Skipped")]
            if broken:
                providers_view[name] = {"emoji": "⚠️", "title": f"{pretty} needs attention", "detail": broken[0]["last_error"], "state": "warn"}
            elif live:
                providers_view[name] = {"emoji": "✅", "title": f"{pretty} is connected", "detail": ", ".join(a["address"] for a in live), "state": "ok"}
            else:
                providers_view[name] = {"emoji": "📭", "title": f"{pretty} isn't connected", "detail": "", "state": "none"}
        counts = {r["account_id"]: r["n"] for r in conn.execute("SELECT account_id, COUNT(*) n FROM emails GROUP BY account_id")}
        return templates.TemplateResponse(request, "settings.html", {
            "s": s, "waiting": waiting, "sync_progress": sync_progress, "providers_view": providers_view, "pid": pid, "profile_name": profiles.name(pid),
            "gmail_ready": clients.gmail_ready(), "outlook_ready": clients.outlook_client_id() is not None,
            "email_counts": counts, "default_id": DEFAULT_ID,
            "accounts": conn.execute("SELECT * FROM accounts ORDER BY id").fetchall(),
            "themes": settings.THEMES, "accents": settings.ACCENTS, "densities": settings.DENSITIES,
            "corners": settings.CORNERS, "columns": settings.COLUMNS, "lookbacks": settings.LOOKBACKS,
            "flow_periods": PERIODS, "scan_choices": SCAN_CHOICES,
            "notice": notice, "error": error,
            "saved_msg": SAVED_MESSAGES.get(params.get("saved", "")),
        })

    # -- actions -------------------------------------------------------------
    @app.post("/settings/appearance")
    async def save_appearance(request: Request, conn=Depends(get_conn)):
        form = await request.form()
        settings.save(conn, "appearance", {
            "theme": form.get("theme"), "accent": form.get("accent"), "density": form.get("density"),
            "corners": form.get("corners"), "columns": form.getlist("columns"), "flow_days": form.get("flow_days"),
        })
        return back("/settings?saved=appearance")

    @app.post("/settings/recheck")
    def recheck_saved(conn=Depends(get_conn)):
        from .recheck import recheck

        r = recheck(conn)
        extra = (f" Settled {r['settled']} email{'s' if r['settled'] != 1 else ''} that were waiting for review." if r["settled"] else "") + \
                (f" Filled in {r['roles']} missing role{'s' if r['roles'] != 1 else ''}." if r["roles"] else "")
        if r["cleared"]:
            done = (f"Checked {r['checked']} saved job emails against the current rules. {r['cleared']} turned out to be ordinary mail "
                    f"(newsletters and the like) and {r['removed']} application{'s' if r['removed'] != 1 else ''} made from them "
                    f"{'were' if r['removed'] != 1 else 'was'} removed.")
        else:
            done = f"Checked {r['checked']} saved job emails against the current rules. Nothing needed to change."
        return back(f"/settings?notice={quote(done + extra)}#sync")

    @app.post("/settings/sync")
    def save_sync(lookback_days: int = Form(30), conn=Depends(get_conn)):
        settings.save(conn, "sync", {"lookback_days": lookback_days})
        return back("/settings?saved=sync")

    # -- accounts, per profile -------------------------------------------------------
    @app.post("/settings/credentials/gmail")
    async def save_gmail_credentials(request: Request):
        upload = (await request.form()).get("file")
        if not hasattr(upload, "read"):
            return back(f"/settings?error={quote('Choose the Google credentials file first.')}#accounts")
        try:
            clients.save_gmail(await upload.read(clients.MAX_FILE + 1))
        except clients.ClientError as exc:
            return back(f"/settings?error={quote(str(exc))}#accounts")
        return back(f"/settings?notice={quote('Google credentials saved. You can connect Gmail now.')}#accounts")

    @app.post("/settings/credentials/outlook")
    def save_outlook_credentials(client_id: str = Form("")):
        try:
            clients.save_outlook(client_id)
        except clients.ClientError as exc:
            return back(f"/settings?error={quote(str(exc))}#accounts")
        return back(f"/settings?notice={quote('Microsoft application ID saved. You can connect Outlook now.')}#accounts")

    def start_sign_in(request: Request, provider: str, send: bool = False):
        """Open the provider's sign-in on a background thread. `send` also asks for permission to send replies."""
        pid = request.state.profile
        ready = clients.gmail_ready() if provider == "gmail" else clients.outlook_client_id() is not None
        if not ready and not get_provider:
            what = "the Google credentials file" if provider == "gmail" else "the Microsoft application ID"
            return back(f"/settings?error={quote(f'Add {what} first (one time), then connect.')}#accounts")
        key = (pid, provider)
        with connecting_lock:
            current = connecting.get(key)
            if current and current["state"] == "waiting" and time.time() - current["started"] < SIGN_IN_WAIT:
                return back("/settings#accounts")      # already waiting for that window
            connecting[key] = {"state": "waiting", "started": time.time(), "message": ""}

        def sign_in():
            try:
                account = provider_factory(pid)(provider, None)
                address = account.connect(send=True) if send else account.connect()
                conn = db.connect(profiles.db_path(pid))
                try:
                    with conn:
                        db.upsert_account(conn, provider, address)
                        if send:       # a sign-in that included the send permission turns replying on for that account
                            conn.execute("UPDATE accounts SET can_reply = 1 WHERE provider = ? AND address = ?", (provider, address))
                finally:
                    conn.close()
                tail = " Replying is on." if send else " Press Sync now to read its mail."
                outcome = {"state": "done", "message": f"Connected {provider.capitalize()}: {address}.{tail}"}
            except Exception as exc:  # sign-in can fail in many ways; show it instead of losing it
                outcome = {"state": "error", "message": _short(f"Could not connect {provider.capitalize()}. {exc}", 300)}
            with connecting_lock:
                connecting.setdefault(key, {}).update(outcome)

        thread = threading.Thread(target=sign_in, daemon=True, name=f"sign-in-{pid}-{provider}")
        app.state.connect_thread = thread
        thread.start()
        return back("/settings#accounts")

    @app.post("/settings/connect/{provider}")
    def connect_account(request: Request, provider: str):
        if provider not in PROVIDERS:
            raise HTTPException(404)
        return start_sign_in(request, provider)

    @app.post("/settings/reply-access/{account_id}")
    def reply_access(request: Request, account_id: int, mode: str = Form(...), conn=Depends(get_conn)):
        """Turn replying on (a new sign-in that also asks for permission to send) or off for an account."""
        acct = conn.execute("SELECT * FROM accounts WHERE id = ? AND active = 1", (account_id,)).fetchone()
        if not acct or mode not in ("on", "off"):
            raise HTTPException(404)
        if mode == "on":
            return start_sign_in(request, acct["provider"], send=True)
        with conn:
            conn.execute("UPDATE accounts SET can_reply = 0 WHERE id = ?", (account_id,))
        done = (f"Replying is off for {acct['address']}. The app will not send anything. {acct['provider'].capitalize()} still lists the "
                f"permission until you disconnect and connect again, or remove it in your account's security settings.")
        return back(f"/settings?notice={quote(done)}#accounts")

    @app.post("/email/{email_id}/reply")
    def send_reply(request: Request, email_id: int, body: str = Form(""), token: str = Form(""), conn=Depends(get_conn)):
        target = replymod.target_for(conn, email_id)
        try:
            sent = replymod.send(conn, provider_factory(request.state.profile), email_id, body, token)
        except replymod.ReplyError as exc:
            return back(f"{target}?{'reply_error' if target.startswith('/app/') else 'error'}={quote(_short(str(exc), 300))}")
        done = f"Already sent to {sent['to']}." if sent["duplicate"] else f"Reply sent to {sent['to']}."
        return back(f"{target}?notice={quote(done)}")

    @app.post("/settings/disconnect/{account_id}")
    def disconnect_account(request: Request, account_id: int, conn=Depends(get_conn)):
        acct = conn.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()
        if not acct:
            raise HTTPException(404)
        address = acct["address"]
        try:
            provider = provider_factory(request.state.profile)(acct["provider"], address)
            if hasattr(provider, "disconnect"):
                provider.disconnect()
        except Exception as exc:
            return back(f"/settings?error={quote(_short(f'Could not remove the saved sign-in for {address}. {exc}', 300))}#accounts")
        with conn:
            conn.execute("UPDATE accounts SET active = 0 WHERE id = ?", (account_id,))
        return back(f"/settings?notice={quote('Disconnected ' + acct['address'] + '. Its saved emails and applications are kept.')}#accounts")

    # -- profiles -------------------------------------------------------------------
    def switch_to(pid: str, url: str) -> RedirectResponse:
        response = back(url)
        response.set_cookie(PROFILE_COOKIE, pid, httponly=True, samesite="lax", max_age=3600 * 24 * 365)
        return response

    @app.post("/profiles/switch")
    def switch_profile(profile: str = Form(...), next_url: str = Form("/", alias="next")):
        if not profiles.exists(profile):
            raise HTTPException(404)
        # Back to the same kind of page, never to another site.
        target = next_url if next_url.startswith("/") and not next_url.startswith("//") and "\\" not in next_url else "/"
        return switch_to(profile, target)

    @app.post("/profiles")
    def add_profile(name: str = Form("")):
        try:
            pid = profiles.create(name)
        except ProfileError as exc:
            return back(f"/settings?error={quote(str(exc))}#profiles")
        return switch_to(pid, f"/settings?notice={quote(f'Profile {profiles.name(pid)} created and opened. Connect its email below.')}#accounts")

    @app.post("/profiles/{profile_id}/rename")
    def rename_profile(profile_id: str, name: str = Form("")):
        try:
            profiles.rename(profile_id, name)
        except ProfileError as exc:
            return back(f"/settings?error={quote(str(exc))}#profiles")
        return back(f"/settings?notice={quote('Profile renamed.')}#profiles")

    @app.post("/profiles/{profile_id}/delete")
    def delete_profile(request: Request, profile_id: str, confirm: str = Form("")):
        if confirm != "yes":
            return back(f"/settings?error={quote('Tick the box to confirm. Deleting a profile removes its emails, applications and sign-ins from this PC.')}#profiles")
        name = profiles.name(profile_id)
        try:
            profiles.delete(profile_id)
        except ProfileError as exc:
            return back(f"/settings?error={quote(str(exc))}#profiles")
        response = back(f"/settings?notice={quote(f'Profile {name} deleted.')}#profiles")
        if request.state.profile == profile_id:
            response.set_cookie(PROFILE_COOKIE, DEFAULT_ID, httponly=True, samesite="lax", max_age=3600 * 24 * 365)
        return response

    def run_sync(pid: str, scan: int) -> None:
        """Runs on its own thread so the page can show a progress bar while it works."""
        def report(**fields):
            with syncs_lock:
                state = syncs[pid]
                if "account" in fields and fields["account"] != state.get("account"):
                    state.update(t0=None, first_done=0)            # a new account starts its own clock
                state.update(fields)
                if fields.get("phase") == "reading" and fields.get("total") and state.get("t0") is None:
                    state.update(t0=time.time(), first_done=fields["done"])

        message, failed = "", False
        conn = db.connect(profiles.db_path(pid))
        try:
            results = sync_all(conn, scan or None, get_provider=provider_factory(pid), progress=report)
            report(phase="jobs", done=0, total=None, note="")
            jobs = run_discovery(conn, get=http_get or requests.get, toast=toast or jobnotify.show_toast,   # company feeds, Adzuna, pop-up
                                 owner=pid, who=who(pid))
            lines = []
            for label, outcome in results.items():
                address = label.split(":", 1)[-1]
                if isinstance(outcome, str):
                    lines.append(f"Sync failed for {address} ({outcome.removeprefix('error: ')}).")
                else:
                    new = sum(v for k, v in outcome.items() if k != "duplicate")
                    lines.append(f"Checked {new} new message{'s' if new != 1 else ''} for {address}.")
            found = jobs["feeds"] + jobs["adzuna"]
            if found:
                lines.append(f"Found {found} new job{'s' if found != 1 else ''} to look at.")
            if not results:
                message, failed = "No accounts are connected yet. Connect Gmail or Outlook first.", True
            else:
                message, failed = _short(" ".join(lines)), any(isinstance(v, str) for v in results.values())
        except Exception as exc:  # whatever goes wrong is shown, not lost with the thread
            message, failed = _short(f"Sync failed. {exc}", 300), True
        finally:
            conn.close()
            with syncs_lock:
                syncs[pid].update(running=False, phase="done", message=message, failed=failed, note="")

    @app.post("/sync")
    def sync(request: Request, scan: int = Form(0)):
        if scan not in {v for v, _ in SCAN_CHOICES}:
            raise HTTPException(400)
        pid = request.state.profile
        with syncs_lock:
            if not (syncs.get(pid) or {}).get("running"):
                syncs[pid] = {"running": True, "phase": "finding", "done": 0, "total": None, "account": "", "note": "",
                              "message": "", "failed": False, "t0": None, "first_done": 0}
                thread = threading.Thread(target=run_sync, args=(pid, scan), daemon=True, name=f"sync-{pid}")
                app.state.sync_thread = thread
                thread.start()
        return back("/settings#sync")

    @app.get("/sync/status")
    def sync_status(request: Request):
        with syncs_lock:
            state = syncs.get(request.state.profile)
            view = sync_view(state) if state else {"running": False, "label": "", "percent": None, "eta": "", "note": ""}
        return JSONResponse(view, headers={"Cache-Control": "no-store"})

    @app.post("/app/add")
    def add(company: str = Form(...), role: str = Form(""), stage: str = Form("Applied"), applied_on: str = Form(""),
            conn=Depends(get_conn)):
        company, role = re.sub(r"\s+", " ", company).strip()[:80], re.sub(r"\s+", " ", role).strip()[:100] or UNKNOWN_ROLE
        if not company or stage not in STAGES:
            raise HTTPException(400)
        when = _now()
        if applied_on.strip():
            try:        # the day you applied, so logging something from last week lands in the right place
                day = datetime.strptime(applied_on.strip(), "%Y-%m-%d").replace(hour=12, tzinfo=timezone.utc)
            except ValueError:
                raise HTTPException(400, "Date must look like 2026-10-31")
            if day > datetime.now(timezone.utc):
                raise HTTPException(400, "That date is in the future")
            when = db.iso(day)
        with conn:
            app_id = db.create_application(conn, company, company_key(company), role, role_key(role),
                                           stage, when, manual=True)
            conn.execute("UPDATE applications SET locked = 1 WHERE id = ?", (app_id,))
        return back(f"/app/{app_id}")

    def _log(request: Request, conn, app_id: int, action, form: dict):
        """Run a notes/steps action that returns a status sentence. In-page requests get the
        refreshed panel, plain posts a redirect."""
        in_page = request.headers.get("x-panel") == "1"
        try:
            status = action()
        except LookupError:
            raise HTTPException(404) from None
        except activity.ActivityError as exc:
            if in_page:
                return templates.TemplateResponse(
                    request, "_panel.html", {"p": _panel_ctx(conn, app_id, error=str(exc), form=form)})
            return back(f"/app/{app_id}?error={quote(str(exc))}")
        if in_page:
            return templates.TemplateResponse(
                request, "_panel.html", {"p": _panel_ctx(conn, app_id, swaps=True, status=status)})
        return back(f"/app/{app_id}")

    @app.post("/app/{app_id}/step")
    def add_step(request: Request, app_id: int, label: str = Form(""), day: str = Form(""),
                 body: str = Form(""), conn=Depends(get_conn)):
        def do():
            changed = activity.add_step(conn, app_id, label, day, body)
            return "Step logged. The stage was updated." if changed else "Step logged."
        return _log(request, conn, app_id, do, {"label": label, "day": day, "body": body})

    @app.post("/app/{app_id}/activity/{activity_id}/delete")
    def delete_activity(request: Request, app_id: int, activity_id: int, conn=Depends(get_conn)):
        def do():
            return "Entry deleted." if activity.delete(conn, app_id, activity_id) else "That entry was already gone."
        return _log(request, conn, app_id, do, {})

    @app.post("/app/{app_id}/stage")
    def set_stage(app_id: int, stage: str = Form(...), conn=Depends(get_conn)):
        if stage not in STAGES:
            raise HTTPException(400)
        with conn:
            conn.execute("UPDATE applications SET stage = ?, stage_at = ?, locked = 1 WHERE id = ?",
                         (stage, _now(), app_id))
        return back(f"/app/{app_id}")

    @app.post("/app/{app_id}/unlock")
    def unlock(app_id: int, conn=Depends(get_conn)):
        with conn:
            conn.execute("UPDATE applications SET locked = 0 WHERE id = ?", (app_id,))
        return back(f"/app/{app_id}")

    @app.post("/app/{app_id}/delete")
    def delete(app_id: int, emails: str = Form("clear"), conn=Depends(get_conn)):
        """Delete an application. By default its saved emails are cleared too, so nothing can rebuild it from them.

        With emails="review" they go back to Needs review instead, held there so that a sync does not re-attach them:
        that is for when the application was a wrong grouping and its emails belong somewhere else.
        """
        from .recheck import clear_email

        if emails not in ("clear", "review"):
            raise HTTPException(400)
        with conn:
            for e in conn.execute("SELECT id FROM emails WHERE application_id = ?", (app_id,)).fetchall():
                if emails == "review":
                    conn.execute("UPDATE emails SET application_id = NULL, needs_review = 1, hold = 1 WHERE id = ?", (e["id"],))
                else:
                    clear_email(conn, e["id"])
            conn.execute("UPDATE job_postings SET status = 'seen', application_id = NULL WHERE application_id = ?", (app_id,))
            conn.execute("DELETE FROM applications WHERE id = ?", (app_id,))
        return back("/")

    @app.post("/app/{app_id}/merge")
    def merge(app_id: int, into: int = Form(...), conn=Depends(get_conn)):
        src = conn.execute("SELECT * FROM applications WHERE id = ?", (app_id,)).fetchone()
        dst = conn.execute("SELECT * FROM applications WHERE id = ?", (into,)).fetchone()
        if not src or not dst or app_id == into:
            raise HTTPException(400)
        fields = {
            "last_activity": max(src["last_activity"] or "", dst["last_activity"] or ""),
            "applied_at": min([x for x in (src["applied_at"], dst["applied_at"]) if x] or [None], default=None),
        }
        # A stage you set by hand wins (and stays locked), otherwise the later stage does.
        if not dst["locked"] and (src["locked"] or (src["stage_at"] or "") > (dst["stage_at"] or "")):
            fields.update(stage=src["stage"], stage_at=src["stage_at"], locked=src["locked"])
        sets = ", ".join(f"{k} = ?" for k in fields)
        with conn:
            conn.execute("UPDATE emails SET application_id = ? WHERE application_id = ?", (into, app_id))
            conn.execute("UPDATE activity SET application_id = ? WHERE application_id = ?", (into, app_id))
            conn.execute("UPDATE job_postings SET application_id = ? WHERE application_id = ?", (into, app_id))
            conn.execute(f"UPDATE applications SET {sets} WHERE id = ?", (*fields.values(), into))
            conn.execute("DELETE FROM applications WHERE id = ?", (app_id,))
        return back(f"/app/{into}")

    @app.post("/review/{email_id}")
    def resolve(email_id: int, action: str = Form(...), stage: str = Form("Applied"),
                app_id: int = Form(0), company: str = Form(""), role: str = Form(""),
                conn=Depends(get_conn)):
        email = conn.execute("SELECT * FROM emails WHERE id = ? AND needs_review = 1", (email_id,)).fetchone()
        if not email:
            raise HTTPException(404)
        if stage not in STAGES:
            raise HTTPException(400)
        with conn:
            if action == "dismiss":
                learn.record(conn, "not_job", email)          # before its content is erased
                conn.execute("UPDATE emails SET needs_review = 0, related = 0, event = NULL, subject = NULL, "
                             "body = NULL, sender = NULL, reason = NULL WHERE id = ?", (email_id,))
            elif action in ("assign", "new"):
                if action == "new":
                    company, role = company.strip(), role.strip() or UNKNOWN_ROLE
                    if not company:
                        raise HTTPException(400, "Company is required")
                    app_id = db.create_application(conn, company, company_key(company), role, role_key(role),
                                                   stage, email["received_at"])
                elif not conn.execute("SELECT 1 FROM applications WHERE id = ?", (app_id,)).fetchone():
                    raise HTTPException(400)
                # Record the stage you chose, so the flow chart reflects your decision.
                conn.execute("UPDATE emails SET application_id = ?, needs_review = 0, hold = 0, event = ? WHERE id = ?",
                             (app_id, EVENT_FOR_STAGE[stage], email_id))
                db.apply_event(conn, app_id, EVENT_FOR_STAGE[stage], email["received_at"])
                learn.record(conn, "job", email, app_id)
            else:
                raise HTTPException(400)
        learned_now, cleared = learned_from_feedback(conn)
        return back("/review" + learned_notice(learned_now, cleared))

    register_jobs(app, templates, get_conn, http_get, toast, who)
    return app
