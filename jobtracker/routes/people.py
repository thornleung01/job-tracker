"""The People tab: everyone you have heard from, grouped by application, and the edits you make to them."""
from __future__ import annotations

import re
import sqlite3

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse

from .. import contacts as contactsmod
from .common import flash
from .state import AppState, get_conn, get_state

router = APIRouter()
CONTACT_KEY = re.compile(r"\d+\|(?:[^@\s|]+@[^@\s|]+|name:[a-z]+)")


def contact_return(next_url: str) -> str:
    """Back to the page the edit was made on: an application, or the People tab."""
    return next_url if re.fullmatch(r"/app/\d+|/contacts", next_url or "") else "/contacts"


@router.get("/contacts", response_class=HTMLResponse)
def contacts_page(request: Request, q: str = "", conn: sqlite3.Connection = Depends(get_conn), state: AppState = Depends(get_state)):
    # A plain `def`, so the work of reading every application's mail runs in the thread pool, not on the event loop.
    everyone = contactsmod.derive(conn)
    needle = q.strip().casefold()
    shown = [c for c in everyone if not needle or needle in " ".join([c["name"], c["title"], c["company"], c["role"], c["email"]]).casefold()]
    groups: dict[int, dict] = {}
    for c in shown:                      # newest contact first within an application, and the application you spoke to last on top
        g = groups.setdefault(c["app_id"], {"id": c["app_id"], "company": c["company"], "role": c["role"], "last": c["last"], "people": []})
        g["people"].append(c)
        g["last"] = max(g["last"], c["last"])
    return state.templates.TemplateResponse(request, "contacts.html", {
        "groups": sorted(groups.values(), key=lambda g: g["last"], reverse=True), "shown": len(shown), "total": len(everyone), "q": q.strip(),
        "kind_label": contactsmod.KIND_LABEL, "notice": request.query_params.get("notice"),
    })


@router.post("/contacts/edit")
def edit_contact(key: str = Form(...), name: str = Form(""), title: str = Form(""), next_url: str = Form("/contacts", alias="next"),
                 conn: sqlite3.Connection = Depends(get_conn)):
    if not CONTACT_KEY.fullmatch(key):
        raise HTTPException(400)
    contactsmod.save_edit(conn, key, name, title)
    return flash(contact_return(next_url), "notice", "Saved.")


@router.post("/contacts/hide")
def hide_contact(key: str = Form(...), next_url: str = Form("/contacts", alias="next"), conn: sqlite3.Connection = Depends(get_conn)):
    if not CONTACT_KEY.fullmatch(key):
        raise HTTPException(400)
    contactsmod.hide(conn, key)
    return flash(contact_return(next_url), "notice", "Removed from this application. It isn't a person, or you don't want it here.")
