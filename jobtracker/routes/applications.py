"""The applications list, an application's page, and every action on an application."""
from __future__ import annotations

import re
import sqlite3
from datetime import datetime
from urllib.parse import quote, urlencode

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse

from .. import activity, config, contacts as contactsmod, db, joblink, learn, settings
from ..extract import UNKNOWN_ROLE, company_key, role_key
from ..recheck import clear_email
from .common import STAGES, back, clean, days_since, flash, now_iso, panel_ctx, stage_counts
from .review import learned_from_feedback, learned_notice
from .state import AppState, get_conn, get_state

router = APIRouter()

SUGGESTIONS_PER_KIND = 300
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


def _suggestions(conn: sqlite3.Connection) -> list[dict]:
    """The companies and roles you actually have, newest activity first, for the search box."""
    items = []
    for kind, col in (("Company", "company"), ("Role", "role")):
        for r in conn.execute(
            f"SELECT {col} AS text, COUNT(*) AS n, MAX(last_activity) AS latest FROM applications "
            f"WHERE {col}_key != '' GROUP BY {col}_key ORDER BY latest DESC LIMIT {SUGGESTIONS_PER_KIND}"
        ):
            items.append({"kind": kind, "text": r["text"], "n": r["n"]})
    return items


def _list_query(stage: str, q: str, account: int, sort: str, direction: str) -> tuple[str, list]:
    """The SQL for the list under these filters and this order. Only whitelisted columns reach the SQL text."""
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
    return sql, params


# -- pages -----------------------------------------------------------------------------
@router.get("/", response_class=HTMLResponse)
def index(request: Request, stage: str = "", q: str = "", account: int = 0, open_ids_param: str = Query("", alias="open"),
          sort_param: str = Query("", alias="sort"), dir_param: str = Query("", alias="dir"),
          conn: sqlite3.Connection = Depends(get_conn), state: AppState = Depends(get_state)):
    sort = sort_param if sort_param in SORT_SQL else "last_activity"
    direction = dir_param if dir_param in ("asc", "desc") else DEFAULT_DIR.get(sort, "asc")
    sql, params = _list_query(stage, q, account, sort, direction)
    rows = [dict(r, idle_days=days_since(r["last_activity"])) for r in conn.execute(sql, params)]
    # ?open=3,7 renders those rows already expanded (also what the page does without JavaScript).
    open_ids = {int(x) for x in open_ids_param.split(",") if re.fullmatch(r"[0-9]{1,9}", x.strip())}
    panels = {r["id"]: panel_ctx(conn, r["id"]) for r in rows if r["id"] in open_ids}
    filters = {k: v for k, v in {"stage": stage, "q": q.strip(), "account": account or ""}.items() if v}
    sorting = {} if (sort, direction) == ("last_activity", "desc") else {"sort": sort, "dir": direction}

    def href(*, ids: set[int] = open_ids, **extra) -> str:
        """The list's own address with these rows open and this sort, keeping the filters."""
        query = {**filters, **sorting, **extra}
        if ids:
            query["open"] = ",".join(str(i) for i in sorted(ids))
        return "/?" + urlencode(query) if query else "/"

    toggle = {r["id"]: href(ids=open_ids ^ {r["id"]}) for r in rows}
    sort_links = {
        col: href(sort=col, dir=("desc" if direction == "asc" else "asc") if sort == col else DEFAULT_DIR.get(col, "asc"))
        for col in SORT_SQL
    }
    appearance = settings.load(conn)["appearance"]
    return state.templates.TemplateResponse(request, "index.html", {
        "rows": rows, "counts": stage_counts(conn), "stages": STAGES, "stage": stage, "q": q, "account": account,
        "panels": panels, "toggle": toggle, "sort": sort, "direction": direction, "sort_links": sort_links,
        "total": conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0],
        "filtered": bool(filters), "sorting": sorting, "suggestions": _suggestions(conn),
        "accounts": conn.execute("SELECT * FROM accounts ORDER BY id").fetchall(),
        "review_count": conn.execute("SELECT COUNT(*) FROM emails WHERE needs_review = 1").fetchone()[0],
        "columns": appearance["columns"], "col_labels": settings.COLUMNS,
        "today": activity.today().isoformat(),
    })


@router.get("/app/{app_id}", response_class=HTMLResponse)
def detail(request: Request, app_id: int, conn: sqlite3.Connection = Depends(get_conn), state: AppState = Depends(get_state)):
    application = conn.execute("SELECT * FROM applications WHERE id = ?", (app_id,)).fetchone()
    if not application:
        raise HTTPException(404)
    emails = conn.execute(
        "SELECT e.*, a.provider, a.address, a.can_reply FROM emails e JOIN accounts a ON a.id = e.account_id "
        "WHERE e.application_id = ? ORDER BY e.received_at DESC, e.id DESC", (app_id,)
    ).fetchall()
    sent = conn.execute("SELECT * FROM sent_replies WHERE application_id = ?", (app_id,)).fetchall()
    timeline = sorted(
        [{"kind": "email", "when": e["received_at"], "id": e["id"], "row": e} for e in emails]
        + [{"kind": "sent", "when": s["created_at"], "id": s["id"], "row": s} for s in sent],
        key=lambda t: (t["when"], t["kind"] == "sent", t["id"]), reverse=True)
    others = conn.execute("SELECT id, company, role FROM applications WHERE id != ? ORDER BY company", (app_id,)).fetchall()
    # The detail page keeps its own full email timeline, so the panel only lists notes and steps.
    people = contactsmod.for_application(conn, app_id)
    titles = contactsmod.titles_from(people)
    panel_data = panel_ctx(conn, app_id, error=request.query_params.get("error"), include_emails=False, titles=titles)
    return state.templates.TemplateResponse(request, "detail.html", {
        "a": application, "emails": emails, "timeline": timeline, "latest_email_id": emails[0]["id"] if emails else None,
        "stages": STAGES, "others": others, "p": panel_data, "people": people, "kind_label": contactsmod.KIND_LABEL,
        "titles": titles, "notice": request.query_params.get("notice"), "reply_error": request.query_params.get("reply_error"),
    })


@router.get("/app/{app_id}/panel", response_class=HTMLResponse)
def panel(request: Request, app_id: int, conn: sqlite3.Connection = Depends(get_conn), state: AppState = Depends(get_state)):
    return state.templates.TemplateResponse(request, "_panel.html", {"p": panel_ctx(conn, app_id)})


# -- actions on one application -----------------------------------------------------------------
@router.post("/app/{app_id}/edit")
def edit_application(app_id: int, company: str = Form(""), role: str = Form(""), url: str | None = Form(None),
                     conn: sqlite3.Connection = Depends(get_conn)):
    """Fix the company or role by hand. An edited application is yours: re-checks and syncs won't rewrite it."""
    if not conn.execute("SELECT 1 FROM applications WHERE id = ?", (app_id,)).fetchone():
        raise HTTPException(404)
    company, role = clean(company, config.NAME_MAX), clean(role, config.TITLE_MAX)
    if not company:
        return flash(f"/app/{app_id}", "error", "The company can't be empty.")
    role = role or UNKNOWN_ROLE
    with conn:
        conn.execute("UPDATE applications SET company = ?, company_key = ?, role = ?, role_key = ?, manual = 1 WHERE id = ?",
                     (company, company_key(company), role, role_key(role), app_id))
        if url is not None:         # the field was on the form: blank clears the link, a bad link is quietly ignored
            posting = joblink.stored_url(url)
            if posting or not url.strip():
                conn.execute("UPDATE applications SET url = ? WHERE id = ?", (posting, app_id))
    return back(f"/app/{app_id}")


@router.post("/app/{app_id}/not-application")
def not_an_application(app_id: int, conn: sqlite3.Connection = Depends(get_conn)):
    """You are telling it this was never a job application: remove it, and learn from the emails that made it."""
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


@router.post("/app/derive")
def derive_from_link(url: str = Form("")):
    """Read a job posting's address and say what company, role and place it is for. Goes through the guard in
    `web.create_app` like every other route, so it has the same host and cross-site checks. Only fixed messages
    ever leave: never the page, never an exception."""
    headers = {"Cache-Control": "no-store"}
    try:
        return JSONResponse(joblink.derive(url), headers=headers)
    except joblink.JobLinkError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400, headers=headers)
    except Exception:
        return JSONResponse({"error": joblink.MSG_NOTHING}, status_code=400, headers=headers)


def _applied_when(applied_on: str) -> str:
    """When you applied: now for today, else midday UTC of that day. "Today" is your own calendar day, as it is
    everywhere else in the app, so a UTC+ morning can still log today."""
    if not applied_on.strip():
        return now_iso()
    try:        # the day you applied, so logging something from last week lands in the right place
        day = datetime.strptime(applied_on.strip(), "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, "Date must look like 2026-10-31") from None
    if day > activity.today():
        raise HTTPException(400, "That date is in the future")
    return now_iso() if day == activity.today() else f"{day.isoformat()}T12:00:00Z"


@router.post("/app/add")
def add(company: str = Form(...), role: str = Form(""), stage: str = Form("Applied"), applied_on: str = Form(""),
        url: str = Form(""), conn: sqlite3.Connection = Depends(get_conn)):
    company, role = clean(company, config.NAME_MAX), clean(role, config.TITLE_MAX) or UNKNOWN_ROLE
    if not company or stage not in STAGES:
        raise HTTPException(400)
    when = _applied_when(applied_on)
    with conn:
        app_id = db.create_application(conn, company, company_key(company), role, role_key(role),
                                       stage, when, manual=True, url=joblink.stored_url(url))
        conn.execute("UPDATE applications SET locked = 1 WHERE id = ?", (app_id,))
    return back(f"/app/{app_id}")


def _log(request: Request, state: AppState, conn: sqlite3.Connection, app_id: int, action, form: dict):
    """Run a notes/steps action that returns a status sentence. In-page requests get the
    refreshed panel, plain posts a redirect."""
    in_page = request.headers.get("x-panel") == "1"
    try:
        status = action()
    except LookupError:
        raise HTTPException(404) from None
    except activity.ActivityError as exc:
        if in_page:
            return state.templates.TemplateResponse(
                request, "_panel.html", {"p": panel_ctx(conn, app_id, error=str(exc), form=form)})
        return back(f"/app/{app_id}?error={quote(str(exc))}")
    if in_page:
        return state.templates.TemplateResponse(
            request, "_panel.html", {"p": panel_ctx(conn, app_id, swaps=True, status=status)})
    return back(f"/app/{app_id}")


@router.post("/app/{app_id}/step")
def add_step(request: Request, app_id: int, label: str = Form(""), day: str = Form(""), body: str = Form(""),
             conn: sqlite3.Connection = Depends(get_conn), state: AppState = Depends(get_state)):
    def do():
        changed = activity.add_step(conn, app_id, label, day, body)
        return "Step logged. The stage was updated." if changed else "Step logged."
    return _log(request, state, conn, app_id, do, {"label": label, "day": day, "body": body})


@router.post("/app/{app_id}/activity/{activity_id}/delete")
def delete_activity(request: Request, app_id: int, activity_id: int, conn: sqlite3.Connection = Depends(get_conn),
                    state: AppState = Depends(get_state)):
    def do():
        return "Entry deleted." if activity.delete(conn, app_id, activity_id) else "That entry was already gone."
    return _log(request, state, conn, app_id, do, {})


@router.post("/app/{app_id}/stage")
def set_stage(app_id: int, stage: str = Form(...), conn: sqlite3.Connection = Depends(get_conn)):
    if stage not in STAGES:
        raise HTTPException(400)
    with conn:
        conn.execute("UPDATE applications SET stage = ?, stage_at = ?, locked = 1 WHERE id = ?",
                     (stage, now_iso(), app_id))
    return back(f"/app/{app_id}")


@router.post("/app/{app_id}/unlock")
def unlock(app_id: int, conn: sqlite3.Connection = Depends(get_conn)):
    with conn:
        conn.execute("UPDATE applications SET locked = 0 WHERE id = ?", (app_id,))
    return back(f"/app/{app_id}")


@router.post("/app/{app_id}/delete")
def delete(app_id: int, emails: str = Form("clear"), conn: sqlite3.Connection = Depends(get_conn)):
    """Delete an application. By default its saved emails are cleared too, so nothing can rebuild it from them.

    With emails="review" they go back to Needs review instead, held there so that a sync does not re-attach them:
    that is for when the application was a wrong grouping and its emails belong somewhere else.
    """
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


@router.post("/app/{app_id}/merge")
def merge(app_id: int, into: int = Form(...), conn: sqlite3.Connection = Depends(get_conn)):
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
        for table in ("emails", "activity", "job_postings", "sent_replies", "feedback"):
            conn.execute(f"UPDATE {table} SET application_id = ? WHERE application_id = ?", (into, app_id))
        for edit in conn.execute("SELECT * FROM contact_edits WHERE key LIKE ?", (f"{app_id}|%",)).fetchall():
            conn.execute("INSERT OR IGNORE INTO contact_edits (key, name, title, hidden) VALUES (?, ?, ?, ?)",
                         (f"{into}|" + edit["key"].split("|", 1)[1], edit["name"], edit["title"], edit["hidden"]))
            conn.execute("DELETE FROM contact_edits WHERE key = ?", (edit["key"],))
        conn.execute(f"UPDATE applications SET {sets} WHERE id = ?", (*fields.values(), into))
        conn.execute("DELETE FROM applications WHERE id = ?", (app_id,))
    return back(f"/app/{into}")
