"""The web app's routes, one module per feature.

Where to add a route: pick the module whose page it belongs to, add the handler to that module's `router`
(an `APIRouter`), and reach shared things through `Depends(get_state)` (the `AppState` with the profiles, the
templates and the sign-in and sync trackers) and `Depends(get_conn)` (this request's database connection) from
`state.py`. Nothing here closes over `create_app`. The modules are `applications` (the list, an application's page
and every action on one), `review` (the Needs review queue and what it learns), `people` (the People tab), `flow`
(the chart), `accounts` (Settings: the page, appearance, credentials, connecting, replying on or off,
disconnecting), `profiles`, `syncing` (the sync button, its progress and its background run) and `reply` (sending a
reply). The Jobs tab is registered from `jobs_web.py`. `web.create_app` includes every router and owns what applies
to all of them: the host and cross-site guard, the security headers and the templates. A new module needs one
`app.include_router(...)` line there, and its routes show up in tests/web_routes_snapshot.json when you regenerate it.
"""
