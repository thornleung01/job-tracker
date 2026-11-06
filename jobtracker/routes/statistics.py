"""The Statistics tab: where your applications went, as a chart."""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from .. import settings, stats
from .common import PERIODS
from .state import AppState, get_conn, get_state

router = APIRouter()


@router.get("/statistics", response_class=HTMLResponse)
def statistics(request: Request, account: int = 0, days: int | None = None, conn: sqlite3.Connection = Depends(get_conn),
               state: AppState = Depends(get_state)):
    if days is None:
        days = settings.load(conn)["appearance"]["flow_days"]
    return state.templates.TemplateResponse(request, "statistics.html", {
        "data": stats.sankey(conn, account, days), "account": account, "days": days,
        "accounts": conn.execute("SELECT * FROM accounts ORDER BY id").fetchall(),
        "periods": PERIODS,
    })


@router.get("/flow")
def flow_moved(request: Request):
    """The page used to be called Flow, so an old bookmark still works. The filters in the address carry over."""
    query = request.url.query
    return RedirectResponse("/statistics" + (f"?{query}" if query else ""), status_code=307)
