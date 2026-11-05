"""The Jobs tab: matches, notifications, your profile and resume, and where jobs come from.

`register` adds the routes to the app, in four groups (`_matches`, `_notifications`, `_profile`, `_sources`) that share a few
helpers through `Jobs`. Work that can take a while (reading a resume, scoring every job again) runs in the thread pool,
so the rest of the app keeps answering while it does.
"""
from __future__ import annotations

import json
from types import SimpleNamespace
from urllib.parse import quote, urlencode

import requests
from fastapi import Depends, Form, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from starlette.concurrency import run_in_threadpool

from . import config, reply, settings
from .jobs import adzuna, feeds, notify, resume, store
from .jobs.run import run_discovery

TABS = ["matches", "notifications", "profile", "sources"]
SCORE_CHOICES = [(0, "Any score"), (40, "40 or more"), (50, "50 or more"), (60, "60 or more"), (65, "65 or more"), (70, "70 or more"), (80, "80 or more")]
VIEW_LABELS = {"new": "New", "saved": "Saved", "applied": "Applied", "dismissed": "Dismissed", "all": "All"}
SOURCE_LABELS = {"linkedin": "LinkedIn alert", "indeed": "Indeed alert", "adzuna": "Adzuna"}
# Numbers the page text and form fields quote, taken from the code that enforces them so the two can't disagree. Every page can use them.
LIMITS = {
    "resume_mb": resume.MAX_UPLOAD // (1024 * 1024), "adzuna_hours": int(adzuna.MIN_INTERVAL.total_seconds() // 3600),
    "reply_chars": reply.MAX_BODY, "name_chars": config.NAME_MAX, "title_chars": config.TITLE_MAX,
}
SAVED_NOTE = {"profile": "Profile saved. Every job was scored again."}


def source_label(source: str) -> str:
    if source in SOURCE_LABELS:
        return SOURCE_LABELS[source]
    if source.startswith("feed:"):
        return "Career page"
    return source.title()


def safe_url(url: str) -> str:
    """Only ever link to web addresses, whatever a feed or email contained."""
    return url if (url or "").startswith(("https://", "http://")) else ""


def _feed_sources(conn) -> list[dict]:
    """The company feeds for the Sources tab. A row whose saved settings can't be read is still listed, so it can be removed."""
    sources = []
    for s in conn.execute("SELECT * FROM job_sources WHERE kind = 'feed' ORDER BY id"):
        try:
            cfg = json.loads(s["config"])
        except ValueError:
            cfg = {}
        sources.append({**dict(s), "company": cfg.get("company", s["name"]), "platform": feeds.PLATFORMS.get(cfg.get("platform"), "")})
    return sources


def _save_profile_form(conn, form) -> None:
    current = store.load_profile(conn)
    settings.save(conn, "profile", {
        **current,
        "titles": form.get("titles", ""), "skills_must": form.get("skills_must", ""), "skills_nice": form.get("skills_nice", ""),
        "cities": form.get("cities", ""), "exclude": form.get("exclude", ""), "remote": form.get("remote") == "on",
        "countries": form.getlist("countries"), "seniority": form.get("seniority", ""), "min_score": form.get("min_score"),
    })
    store.rescore_all(conn)


def _save_resume(conn, filename: str, data: bytes) -> tuple[str, str]:
    """Read the resume and fold what it says into the profile. Returns ("notice" or "error", text)."""
    try:
        text = resume.extract_text(filename, data)
    except resume.ResumeError as exc:
        return "error", str(exc)
    found = resume.analyze(text)
    p = store.load_profile(conn)
    known = {s.casefold() for s in p["skills_must"] + p["skills_nice"]}
    settings.save(conn, "profile", {
        **p, "resume_text": text, "skills_nice": p["skills_nice"] + [s for s in found.skills if s.casefold() not in known],
        "titles": p["titles"] or found.titles, "seniority": p["seniority"] or found.seniority,
    })
    store.rescore_all(conn)
    return "notice", (f"Resume read: found {len(found.skills)} skills and {len(found.titles)} job titles. "
                      "Check them below and move your must-have skills to the first box.")


def to(tab: str = "matches", **params) -> RedirectResponse:
    query = urlencode({"tab": tab, **{k: v for k, v in params.items() if v not in (None, "")}}, quote_via=quote)
    return RedirectResponse(f"/jobs?{query}", status_code=303)


def back_to(next_url: str, **params) -> RedirectResponse:
    # Only ever return to a Jobs page of this app.
    if not (next_url == "/jobs" or next_url.startswith("/jobs?")):
        return to("matches", **params)
    sep = "&" if "?" in next_url else "?"
    return RedirectResponse(next_url + (sep + urlencode(params, quote_via=quote) if params else ""), status_code=303)


def register(app, templates, get_conn, http_get=None, toast=None, who=lambda pid: "") -> None:
    jobs = SimpleNamespace(app=app, templates=templates, get_conn=get_conn, http_get=http_get or requests.get,
                           toast=toast or notify.show_toast, who=who)
    templates.env.globals.update(source_label=source_label, safe_url=safe_url, limits=LIMITS)
    _matches(jobs)
    _notifications(jobs)
    _profile(jobs)
    _sources(jobs)


def _matches(jobs) -> None:
    app, templates, get_conn = jobs.app, jobs.templates, jobs.get_conn

    @app.get("/jobs", response_class=HTMLResponse)
    def jobs_page(request: Request, tab: str = "matches", view: str = "new", min_score: int = Query(-1, alias="min"), conn=Depends(get_conn)):
        tab = tab if tab in TABS else "matches"
        view = view if view in store.VIEWS else "new"
        profile = store.load_profile(conn)
        floor = min_score if 0 <= min_score <= 100 else (profile["min_score"] if view == "new" else 0)
        params = request.query_params
        alert_counts = {r["source"]: r["n"] for r in conn.execute(
            "SELECT source, COUNT(*) n FROM job_postings WHERE source IN ('linkedin', 'indeed') GROUP BY source")}
        return templates.TemplateResponse(request, "jobs.html", {
            "tab": tab, "view": view, "floor": floor, "counts": store.counts(conn), "view_labels": VIEW_LABELS,
            "postings": store.list_postings(conn, view, floor) if tab == "matches" else [],
            "profile": profile, "ready": store.profile_ready(profile), "score_choices": SCORE_CHOICES,
            "notifications": conn.execute("SELECT * FROM notifications ORDER BY id DESC LIMIT 40").fetchall() if tab == "notifications" else [],
            "unread": conn.execute("SELECT COUNT(*) FROM notifications WHERE read = 0").fetchone()[0],
            "sources": _feed_sources(conn), "alert_counts": alert_counts,
            "adzuna_ready": adzuna.load_credentials(request.state.profile) is not None,
            "adzuna_row": conn.execute("SELECT * FROM job_sources WHERE kind = 'adzuna'").fetchone(),
            "adzuna_searches": adzuna.queries(profile), "max_searches": adzuna.MAX_REQUESTS,
            "countries": settings.COUNTRIES, "seniority_levels": settings.SENIORITY, "min_scores": settings.MIN_SCORES,
            "lists": {k: "\n".join(profile[k]) for k in ("titles", "skills_must", "skills_nice", "cities", "exclude")},
            "notice": params.get("notice"), "error": params.get("error"), "saved_msg": SAVED_NOTE.get(params.get("saved", "")),
            "next_url": str(request.url.path) + ("?" + request.url.query if request.url.query else ""),
        })

    @app.post("/jobs/{posting_id}/status")
    def set_status(posting_id: int, status: str = Form(...), next_url: str = Form("/jobs", alias="next"), conn=Depends(get_conn)):
        if status not in store.STATUSES or not store.set_status(conn, posting_id, status):
            raise HTTPException(404)
        return back_to(next_url)

    @app.post("/jobs/{posting_id}/applied")
    def applied(posting_id: int, next_url: str = Form("/jobs", alias="next"), conn=Depends(get_conn)):
        app_id = store.mark_applied(conn, posting_id)
        if not app_id:
            raise HTTPException(404)
        return back_to(next_url, notice="Added to your applications. Open Applications to follow its progress.")

    @app.post("/jobs/refresh")
    def refresh(request: Request, conn=Depends(get_conn)):
        pid = request.state.profile
        r = run_discovery(conn, force=True, get=jobs.http_get, toast=jobs.toast, owner=pid, who=jobs.who(pid))
        if r["skipped"]:
            return to("profile", error=r["skipped"])
        found = r["feeds"] + r["adzuna"]
        return to("matches", notice=f"Checked your sources: {found} new job{'s' if found != 1 else ''} found"
                                    + (f", {r['notified']} matched well enough to notify you about." if r["notified"] else "."))


def _notifications(jobs) -> None:
    @jobs.app.post("/jobs/notifications/read")
    def read_all(conn=Depends(jobs.get_conn)):
        with conn:
            conn.execute("UPDATE notifications SET read = 1")
        return to("notifications")


def _profile(jobs) -> None:
    app, get_conn = jobs.app, jobs.get_conn

    @app.post("/jobs/profile")
    async def save_profile(request: Request, conn=Depends(get_conn)):
        form = await request.form()
        await run_in_threadpool(_save_profile_form, conn, form)       # scoring every job again can take a while
        return to("profile", saved="profile")

    @app.post("/jobs/profile/resume")
    async def upload_resume(request: Request, conn=Depends(get_conn)):
        # Read the form by hand: a browser that sends no file at all must get a friendly message, not a 422.
        file = (await request.form()).get("file")
        if not hasattr(file, "read"):
            return to("profile", error="Choose a PDF, Word (.docx) or text file first.")
        data = await file.read(resume.MAX_UPLOAD + 1)
        kind, text = await run_in_threadpool(_save_resume, conn, file.filename or "", data)       # reading a PDF is slow
        return to("profile", **{kind: text})

    @app.post("/jobs/profile/resume/remove")
    def remove_resume(conn=Depends(get_conn)):
        settings.save(conn, "profile", {**store.load_profile(conn), "resume_text": ""})
        return to("profile", notice="Resume removed from this app. Your skills and titles are still saved.")


def _sources(jobs) -> None:
    app, get_conn, http_get = jobs.app, jobs.get_conn, jobs.http_get

    @app.post("/jobs/sources/feed")
    def add_feed(request: Request, url: str = Form(""), name: str = Form(""), conn=Depends(get_conn)):
        try:
            source_id, count = feeds.add_source(conn, url, name, http_get)
        except feeds.SourceError as exc:
            return to("sources", error=str(exc))
        pid = request.state.profile
        run_discovery(conn, force=True, get=http_get, toast=jobs.toast, owner=pid, who=jobs.who(pid), only=source_id)
        return to("sources", notice=f"Added. That company has {count} open role{'s' if count != 1 else ''} right now. The good matches are in Matches.")

    @app.post("/jobs/sources/adzuna/remove")
    def remove_adzuna(request: Request, conn=Depends(get_conn)):
        adzuna.clear_credentials(request.state.profile)
        with conn:
            conn.execute("DELETE FROM job_sources WHERE kind = 'adzuna'")
        return to("sources", notice="Adzuna removed. Its key was deleted from this PC.")

    @app.post("/jobs/sources/{source_id}/remove")
    def remove_feed(source_id: int, conn=Depends(get_conn)):
        with conn:
            conn.execute("DELETE FROM job_sources WHERE id = ? AND kind = 'feed'", (source_id,))
        return to("sources", notice="Company removed. Jobs already found stay in your list.")

    @app.post("/jobs/sources/adzuna")
    def save_adzuna(request: Request, app_id: str = Form(""), app_key: str = Form(""), conn=Depends(get_conn)):
        if not app_id.strip() or not app_key.strip():
            return to("sources", error="Enter both the app ID and the app key from your Adzuna account.")
        note = "Adzuna connected."
        try:
            adzuna.search({"app_id": app_id.strip(), "app_key": app_key.strip()}, "test", "", "ca", http_get)
        except PermissionError as exc:
            return to("sources", error=str(exc))
        except requests.RequestException:
            note = "Saved, but Adzuna couldn't be reached to check it. It will be tried at the next sync."
        adzuna.save_credentials(app_id, app_key, request.state.profile)
        with conn:
            conn.execute("INSERT OR IGNORE INTO job_sources (kind, name) VALUES ('adzuna', 'adzuna')")
        return to("sources", notice=note)
