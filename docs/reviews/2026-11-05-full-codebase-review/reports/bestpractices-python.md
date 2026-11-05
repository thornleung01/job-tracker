# Best Practices Review: local (Python) edition, full codebase

Repo `/Users/thorn.leung/job-tracker`, branch `easy-connect`. Area: `jobtracker/*.py`, `jobtracker/providers/*.py`, `jobtracker/jobs/*.py`, `jobtracker/templates/*.html`, `scripts/*.py`, `requirements.txt`, `pytest.ini`.
Behavioural changes to classify / extract / mailtext are out of bounds; nothing below proposes one (the few observations that touch them are reported only).

## Tech stack detected

Python 3 (the scratch venv runs 3.14.4; no version is declared anywhere) with FastAPI 0.162 / Starlette 1.10, Jinja2 templates, raw `sqlite3` (no ORM), msal + msal-extensions (Windows DPAPI token files), Google API clients, PyYAML rules, BeautifulSoup, pytest. Windows-first desktop app: toasts, DPAPI, a scheduled "sign-in task" under `pythonw`. Mixed repo: `web/` is the TypeScript hosted edition and is out of scope here.

I ran the suite (`877 passed, 7 failed`, the 7 expected `ctypes.windll` failures) and probed the running app with a Starlette `TestClient` against scratch databases outside the repo. Two findings below (BP-PY-1, BP-PY-2) were confirmed that way.

## Conventions discovered

- No lint, format, type-check or CI config for Python (no `pyproject.toml`, `ruff`, `flake8`, `mypy`, `.editorconfig`). The only CI workflow (`.github/workflows/pages.yml`) builds `web/`. So conventions come from the code:
  - `from __future__ import annotations` at the top of nearly every module; PEP 604 unions (`str | None`); built-in generics (`dict[str, int]`).
  - Line length is not enforced (lines of 150 to 250 characters are normal); I did not flag long lines.
  - Module docstrings explain intent in plain language; function docstrings are one or two sentences. Comments say "why".
  - Type hints are applied consistently on the data layer (`sqlite3.Connection`, return types in `db.py`, `sync.py`, `activity.py`, `learn.py`, `reply.py`, `jobs/store.py`) and loosely on the web layer (`conn` untyped in `web.py` / `jobs_web.py`).
  - Raw SQL with `?` placeholders everywhere. `with conn:` is the transaction idiom for writes. f-string SQL is only used for constants or `?` lists (checked: all safe).
  - Domain exceptions that carry user-safe messages: `ReplyError`, `ActivityError`, `ProfileError`, `ClientError`, `SourceError`, `ResumeError`, `JobLinkError`, `NotAllowed`. Handlers turn them into redirects with a `?notice=` / `?error=` query string (POST-redirect-GET flash by query string).
  - Timestamps are stored as UTC strings `YYYY-MM-DDTHH:MM:SSZ` via `db.iso()`. Dependency seams for tests are injected callables (`get_provider`, `http_get`, `toast`, `transport`, `resolver`) plus `_sleep = time.sleep`.
  - Imports of heavy or optional libraries (googleapiclient, msal, pypdf, docx, windows_toasts, uvicorn) are function-local on purpose. Other function-local imports exist to dodge an import cycle (see BP-PY-8).
  - Tests isolate the secrets folder (`tests/conftest.py` autouse fixture).
  - Scripts put the repo on `sys.path` with `sys.path.insert(0, ROOT)` and `# noqa: E402`.
- I respected all of the above: no finding asks for line wrapping, docstring-on-everything, or a different transaction idiom.

---

## Critical

### BP-PY-1 The detail page's scroll-to-email script sits inside `<title>`, so it never runs and pollutes the tab title
`jobtracker/templates/detail.html:2-12` (rendered by `jobtracker/templates/base.html` inside `<title>{% block title %}`)

Evidence:
```
{% block title %}{{ a.company }} · Job Tracker<script>
  // Arriving from a person's "Reply here" or an email link: bring that email into view, ...
  (() => { if (!location.hash.startsWith('#email-')) return; ... })();
</script>
{% endblock %}
```
Rendered output of `GET /app/<id>` (verified): `<title>Acme · Job Tracker<script>   // Arriving from a person's "Reply here" ...`. `<title>` is RCDATA, so the script is plain text: the browser tab shows the JavaScript source, and the code that scrolls to `#email-N` and opens the reply box never executes. The "Reply here" link on the People page (`_person.html`: `/app/{id}?reply=1#email-{id}`) therefore lands at the top of the page and does not open the reply form. The author evidently meant `{% endblock %}` for the title and a separate block for the script.

Why it matters: a shipped feature silently does nothing, and every application detail tab has a garbage title. No test catches it because tests assert on response text, not on a parsed DOM.

Fix: close the title block first and put the script in its own block (add `{% block scripts %}{% endblock %}` before `</body>` in `base.html`, as the other pages already append inline scripts at the end of their content block):
```
{% block title %}{{ a.company }} · Job Tracker{% endblock %}
...
{% block content %} ... <script>(() => { ... })();</script>{% endblock %}
```
Add a test that the `<title>` text contains no `<` and that the detail page has a `<script>` outside `<title>`.

### BP-PY-2 The Jobs page returns 500 off Windows, and DPAPI is not isolated: the "degrades cleanly" contract does not hold
`jobtracker/providers/base.py:51-57`, `jobtracker/jobs/adzuna.py:21-34`, `jobtracker/jobs_web.py:72`, `jobtracker/jobs/run.py:50`, `jobtracker/web.py` (`save_adzuna` path in `jobs_web.py:176-190`)

Evidence: `token_persistence()` imports and instantiates `msal_extensions.FilePersistenceWithDataProtection` unconditionally. On macOS/Linux that raises `AttributeError: module 'ctypes' has no attribute 'windll'` (verified). `adzuna.load_credentials` only catches `(FileNotFoundError, ValueError, OSError)`, so the error escapes:
```
GET /          -> 200      GET /settings -> 200      GET /flow -> 200
GET /contacts  -> 200      GET /review   -> 200      GET /jobs -> 500
```
`jobs_page` calls `adzuna.load_credentials(...)` on every render, so the whole Jobs tab (and the nav badge route that links to it) is down. `run_discovery` documents "Never raises" but calls the same function outside any `try`; `POST /jobs/sources/adzuna` calls `adzuna.save_credentials` outside any `try`. Gmail/Outlook `connect` fail the same way, only surfaced through the sign-in thread's generic `except Exception`. The 7 "expected Windows-only" test failures (`test_discovery_reads_feeds_notifies_and_records_errors`, `test_a_link_with_profile_opens_that_profile_and_remembers_it`, ...) are all this one root cause, not seven separate things. The toast side is done correctly (`notify.show_toast` guards its import and returns False); the token side is not.

Why it matters: the app is the reference/dev edition and is run and tested on macOS here; one Windows-only call takes a whole page down, and the exception text is an unhelpful `ctypes` message when a user does hit it.

Fix: isolate the platform dependency in one place.
```python
# providers/base.py
class SecretStoreUnavailable(RuntimeError): ...

def token_persistence(filename, profile="default"):
    try:
        from msal_extensions import FilePersistenceWithDataProtection
        ...
        return FilePersistenceWithDataProtection(str(folder / filename))
    except (ImportError, AttributeError, NotImplementedError) as exc:
        raise SecretStoreUnavailable("Saved sign-ins need Windows. ...") from exc
```
Catch `SecretStoreUnavailable` in `adzuna.load_credentials/clear_credentials` (return None), in `save_adzuna` (flash an error), and let the sign-in thread show it. Optionally add a `sys.platform` guard test or `pytest.mark.skipif(sys.platform != "win32")` for the tests that genuinely need DPAPI, so the suite is green elsewhere.

### BP-PY-3 Jinja values interpolated into inline JavaScript string literals (`onsubmit="return confirm('...{{ x }}...')"`)
`jobtracker/templates/_reply.html:7` (`{{ r_to }}`), `jobtracker/templates/_person.html:27` (`{{ c.name }}`)

Evidence (verified by rendering):
```
onsubmit="return confirm('Send this reply to {{ r_to }}?')"
```
With `r_to = x'+alert(1)+'@e.vil`, Jinja's HTML autoescape produces `confirm('Send to x&#39;+alert(1)+&#39;@e.vil?')`. The browser decodes the entities before the JS parser sees the attribute, so it runs `confirm('Send to x'+alert(1)+'@e.vil?')`. `r_to` is `i.sender|sender_addr`, i.e. text from the email's From header; `reply.recipient()` accepts it because `_ADDRESS = [^@\s<>]+@[^@\s<>]+\.[^@\s<>]+` allows `'`, `(`, `)` and `+` (verified: `recipient("X <x'+alert(1)+'@e.vil>")` returns the string). The form is only shown when replying is enabled for the account and the sender "takes replies", and the payload fires when the user presses Send, so this needs a user action on an attacker-supplied email, but the page is same-origin to every POST route (delete, send reply, ...). `c.name` is restricted by `looks_like_a_person()` to letters, `'` and `-`, which makes it hard to exploit, but a name saved through Edit (`save_edit`, up to 80 free-text characters) hits the same sink. The other `confirm(...)` strings in the templates are static and safe; `{{ i.kind }}` at `_panel.html:78` is an internal enum.

Why it matters: HTML escaping is the wrong escaping for a JS context. This is the classic template-injection pattern even if exploitation is awkward, and the codebase has no CSP (see BP-PY-17) to contain it.

Fix: do not put values in inline JS. Use a data attribute plus the single delegated handler that `base.html` already has for `data-busy`:
```html
<form ... data-confirm="Send this reply to {{ r_to }}?">
```
```js
document.addEventListener('submit', e => {
  const m = e.target.dataset && e.target.dataset.confirm;
  if (m && !confirm(m)) e.preventDefault();
});
```
(HTML-attribute escaping is then the correct escaping.) Convert the static `confirm` handlers (9 of them) the same way at the same time, which also removes the `\'` escapes. Also consider tightening `links._ADDRESS` to a conventional character set; behaviour of `recipient()` is not part of the classifier, so this is safe to change.

---

## Important

### BP-PY-4 Exceptions are swallowed without logging; one path discards mail permanently with no trace
`jobtracker/sync.py:212-232` (`process_messages`), also `web.py:575`, `web.py:625`, `web.py:709`, `web.py:745`, `jobs/run.py:47-61`, `jobs/notify.py:26`, `jobs/resume.py:58`

Evidence:
```python
except Exception:
    # A message that can't be read at all would fail every time, so mark it seen and move on.
    result = "error"
    try:
        with conn:
            _remember_unrelated(conn, account_id, msg, db.iso(msg.received_at))
    except sqlite3.Error:
        pass
```
Only `reply.py`, `gmail.py` and `outlook.py` create a logger (3 modules, 3 `log.warning` calls in the whole package). Everywhere else a broad `except Exception` turns the failure into a one-line UI string and drops the traceback. In `process_messages` the consequence is bigger: any bug in extraction, classification or the DB layer makes real emails permanently "seen and unrelated" (they are never refetched), and the only residue is the count "Skipped N unreadable message(s)" in `accounts.last_error`, which the next successful sync overwrites. Background threads (`sign_in`, `run_sync`) have no other place to report to.

Why it matters: when classifier behaviour regresses (a real risk, since the TS port is checked against this code), the failure mode is silent data loss with nothing to debug from. The broad catches themselves are defensible (each has a comment saying why); the missing log line is the defect.

Fix: add `log = logging.getLogger(__name__)` to `sync.py`, `web.py`, `jobs/run.py`, `jobs/notify.py`, `jobs/resume.py` and call `log.exception("...")` (or `log.warning(..., exc_info=True)`) inside each of those handlers, with the message id for `process_messages`. Replace `except sqlite3.Error: pass` with a `log.warning`. Configure a rotating file handler in `cli serve` / `sync` because under `pythonw` there is no console (the CLI already special-cases that).

### BP-PY-5 `web.py` is one 760-line closure with 50+ nested handlers, mutable state and presentation logic in it
`jobtracker/web.py:139-899` (`create_app`)

Evidence: everything between `def create_app(...)` and `return app` is nested in one function: page routes, ~30 POST actions, the sign-in state machine (`connecting`, `connecting_lock`), the sync state machine (`syncs`, `syncs_lock`, `run_sync`, `report`), the profile cookie/middleware, and helper closures (`back`, `who`, `ui_context`, `learned_notice`, `contact_return`, `switch_to`, `_log`). Module-level helpers `sync_view` / `_eta_text` (progress text) and `_panel_ctx` also live in the routes module. The handlers repeat the same fetch-or-404 / flash-redirect pattern (about 25 `back(f"...?error={quote(...)}#anchor")` calls). `index()` alone builds SQL, filters, sort links, toggle links and the template context. `jobs_web.register(app, templates, get_conn, http_get, toast, who)` already shows the intended direction.

Why it matters: this is the module most likely to attract merge conflicts and the hardest to test by itself; closure state cannot be unit tested without building the whole app (tests reach in through `app.state.sync_thread` / `connect_thread`, which exist only as test seams).

Fix (incremental, no behaviour change): (1) move `connecting`/`syncs` + their locks and `run_sync`/`start_sign_in` into a small class (`AccountLinker`, `SyncRunner`) in `jobtracker/background.py`, stored on `app.state`; (2) split routes into `APIRouter` modules following the `jobs_web.register` pattern (`pages.py` for index/detail/flow/review/contacts, `actions.py` for application mutations, `settings_web.py` for settings/profiles/accounts, `sync_web.py`); (3) move `sync_view` / `_eta_text` next to the sync runner; (4) add `flash(url, kind, message, anchor="")` to replace the repeated `back(f"?error={quote(...)}")` calls (and the equivalent `to()` in `jobs_web.py`); (5) extract the SQL/filter building in `index()` into a function that returns `(rows, filters)`.

### BP-PY-6 `async def` handlers do blocking SQLite, PDF/docx parsing and whole-table rescoring on the event loop
`jobtracker/jobs_web.py:113-141` (`save_profile`, `upload_resume`), `jobtracker/web.py:498-505` (`save_appearance`), `jobtracker/web.py:528-537` (`save_gmail_credentials`)

Evidence:
```python
@app.post("/jobs/profile")
async def save_profile(request: Request, conn=Depends(get_conn)):
    form = await request.form()
    ...
    settings.save(conn, "profile", {...})
    store.rescore_all(conn)          # loops over every job_postings row with an UPDATE each
```
`upload_resume` awaits the file then calls `resume.extract_text` (pypdf on up to 12 pages, python-docx) and `rescore_all` synchronously. FastAPI runs plain `def` handlers in a thread pool, but `async def` handlers run on the single event loop, so one of these requests stalls every other request, including the `/sync/status` progress polling and `local_only` middleware, for as long as it takes. Every other write handler is a plain `def`, so the app mostly gets this right, which makes these four stand out.

Fix: keep `await request.form()` in the `async def`, and run the blocking part in the pool:
```python
from starlette.concurrency import run_in_threadpool
...
await run_in_threadpool(_save_profile, conn, form)
```
or take the fields with `Form(...)` / `UploadFile` parameters in a plain `def` (the comment in `upload_resume` explains why the form is read by hand to avoid a 422; `File(None)` / `UploadFile | None = None` handles that too). Also move `rescore_all` to a single `executemany` while there.

### BP-PY-7 Schema migration code in `db.connect` is repetitive, unversioned, not safe against concurrent first connections, and DDL is split across two places
`jobtracker/db.py:189-226`, `jobtracker/settings.py:60-61`

Evidence:
```python
if "web_link" not in {r["name"] for r in conn.execute("PRAGMA table_info(emails)")}:
    conn.execute("ALTER TABLE emails ADD COLUMN web_link TEXT")
if "bulk" not in {r["name"] for r in conn.execute("PRAGMA table_info(emails)")}:
    ...   # eight more copies, for emails, ignored_mail, accounts, applications
```
and `_READY: set[str]` is checked and updated with no lock.
- Idempotence is fine (each ALTER is guarded) and ordering is correct today (`executescript(SCHEMA)` first, then ALTERs). But columns `bulk`, `hold`, `reason` (emails), `bulk` (ignored_mail) do not appear in the `CREATE TABLE` text at all, so a brand-new database is created old-shape and then altered; the real schema is spread across `SCHEMA` and nine ALTERs.
- Latent trap: a future `CREATE INDEX ... ON emails (hold)` placed in `SCHEMA` would fail on every existing database, because `executescript(SCHEMA)` runs before the ALTERs.
- Race: the web server, the sync thread and the sign-in thread each call `db.connect`; `_READY` is a plain set and `setup` is computed before any lock, so two threads connecting for the first time to an un-migrated file can both reach the same `ALTER TABLE`, and the loser raises `OperationalError: duplicate column name`.
- The `settings` table is created by `settings._ensure()` on every `load`/`save` (called from `ui_context` on every page render), not in `SCHEMA`.
- No schema version: `PRAGMA user_version` is unused.

Fix: add a lock around the setup block (`_SETUP_LOCK = threading.Lock()`; re-check `_READY` inside it), and replace the nine blocks with a helper and a version number:
```python
def _add_column(conn, table, name, ddl):
    if name not in {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
```
(call it once per column, or keep a `MIGRATIONS = [(1, [...]), ...]` list keyed on `PRAGMA user_version`). Put the `settings` table in `SCHEMA` and delete `_ensure`. Put the added columns in the `CREATE TABLE` text too so fresh and upgraded databases match, and add a test that a fresh database's `PRAGMA table_info` equals an upgraded old one.

### BP-PY-8 Import cycle `sync` <-> `recheck`, cross-module reach into private names, and function-local imports that are not needed
`jobtracker/sync.py:136,176` (`from .config import OVERLAP_DAYS`, `from .recheck import settle_review`), `jobtracker/recheck.py:15,86,102` (`sync_module._remember_ignored`, `sync_module.decide`), `jobtracker/reply.py:15` (`from .links import _ADDRESS, _NO_REPLY`), `jobtracker/reply.py:105` (`activity._touch`), `jobtracker/web.py:303,339,355-356,426-427,509,823`

Evidence: `recheck` imports `sync` at module level and `sync` imports `recheck` inside `sync_account`, a deliberate cycle breaker. `recheck` then calls `sync_module._remember_ignored(...)` (underscore-private); `reply` imports two private regexes from `links` and calls `activity._touch`. In `web.py`, `from .recheck import recheck` is repeated inside four handlers and `from .models import Message`, `from .sync import process_message`, `from .extract import extract_company_role` inside two others, although `sync_all` is already imported from `.sync` at module top and `recheck`/`models`/`extract` have no cycle with `web`. `from .config import OVERLAP_DAYS` inside `sync_account` has no cycle reason at all.

Why it matters: the cycle makes import order matter, hides dependencies from readers and tools, and the private-name reaches mean a "harmless" rename inside `links` or `sync` breaks distant modules.

Fix: move the shared pieces (`decide`, `_remember_unrelated`, `_remember_ignored`, `_fill_role`, `clear_email`) into a lower-level module (for example `jobtracker/pipeline.py` that depends only on `db`, `learn`, `extract`, `match`), have both `sync.py` and `recheck.py` import from it (no cycle, no lazy import), and make the cross-module helpers public (`links.ADDRESS`, `links.NO_REPLY` or a public `links.recipient()`, `activity.touch`). Then hoist the unneeded function-local imports in `web.py` and `sync.py` to the top of the file. Keep the lazy imports of optional heavy libraries, which are intentional.

### BP-PY-9 Duplicated helpers that already drift (timestamps, Message-from-row, sender parsing, reply link rules)
Evidence and locations:
- ISO parsing: `strptime(x, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=utc)` in `web.py:100`, `web.py:369`, `sync.py:140`, `recheck.py:26`; `datetime.fromisoformat(x.replace("Z", "+00:00"))` in `jobs/run.py:23`, `jobs/adzuna.py:82`, `jobs/score.py:23`, `providers/outlook.py:141`. "Now as an ISO string" (`db.iso(datetime.now(timezone.utc))`) is written out 21 times, plus `_now()` in `web.py:93` and `jobs/store.py:27`.
- Building a `Message` from a stored row: `recheck._message` (`recheck.py:19`), `web.ignored_is_real` (`web.py:367-370`) and `web.review` (`web.py:434-435`). They disagree: `review()` builds the message with `sender_name=""` and `received_at=now`, so the "guess company/role" it pre-fills for the form can differ from what the real pipeline (which has the display name, e.g. for hiring-system senders in `_sender_company`) would extract. Observation only; the classifier is not changed by fixing the web helper.
- "Name <addr>" parsing: `mailtext.split_sender`, `learn.split_sender` (returns only the lowercased address), the partition/`rsplit` variants above, and the reverse formatting `f"{msg.sender_name} <{msg.sender_email}>"` in `sync.py` twice. Round-tripping through a string is lossy for display names that contain `<`.
- Reply rules: `reply.recipient()` / `reply.subject_for()` and `links.reply_link()` each re-implement "valid address, not no-reply" and "prefix Re:".
- Provider code: `_is_bulk(headers)` is byte-for-byte identical in `providers/gmail.py:180` and `providers/outlook.py:121`; `SIGN_IN_TIMEOUT = 300` is defined in both (and `web.SIGN_IN_WAIT = 330` is a hand-synchronised second copy, with the relation only in a comment).
- Constants: `web.STAGES` re-lists the six stage names that `db.STAGES` already derives from `STAGE_FOR_EVENT`; `web.PERIODS` vs `settings.FLOW_PERIODS`; `jobs_web.SCORE_CHOICES` vs `settings.MIN_SCORES`.

Why it matters: a rule changed in one copy and not the others (the Message case above is already an example) produces inconsistent behaviour that tests on one path will not catch.

Fix: add small public helpers and use them everywhere: `db.parse_iso(text) -> datetime`, `db.now_iso() -> str`, `models.message_from_row(row)` (move `recheck._message`), one `split_sender` in `mailtext` (with `learn` calling it and lowercasing), `links.recipient()` / `links.reply_subject()` reused by `reply.py`, `providers/base.is_bulk(headers)`, `config.SIGN_IN_TIMEOUT`, and `STAGES = db.STAGES` in `web.py`.

### BP-PY-10 "Date applied" check in `POST /app/add` disagrees with the local-day logic used elsewhere (rejects today for UTC+ users)
`jobtracker/web.py:755-762` vs `jobtracker/activity.py:44-57`

Evidence:
```python
day = datetime.strptime(applied_on.strip(), "%Y-%m-%d").replace(hour=12, tzinfo=timezone.utc)
...
if day > datetime.now(timezone.utc):
    raise HTTPException(400, "That date is in the future")
```
`activity._when_for` compares calendar dates using the machine's local day (`today()`), which its comment says is intentional ("the app runs on your PC"). `add()` instead compares noon UTC of the chosen date with the current UTC instant, so for any user whose local clock is ahead of UTC and who adds an application "today" in the morning (for example 08:00 at UTC+8 is 00:00 UTC, so today at 12:00 UTC is "in the future"), the form's own default value (`value="{{ today }}" max="{{ today }}"` in `index.html`) is rejected with a bare JSON `{"detail": ...}` page. For UTC- users the check is merely too lenient.

Fix: reuse the same function: `when = activity._when_for(applied_on)` (made public) and catch `ActivityError` to flash the message back to the page instead of an `HTTPException`. Also see BP-PY-16 about raw 400 JSON for form errors.

### BP-PY-11 `requirements.txt` is unpinned and mixed; no Python version, lint, or CI coverage for the Python side
`requirements.txt`, `pytest.ini`, `.github/workflows/pages.yml`

Evidence: 17 bare package names, no versions, no lock file; runtime and test dependencies (`pytest`, `httpx`) are in the same file; `windows-toasts` is listed unconditionally (it is only imported lazily and guarded in `jobs/notify.py`, but `pip install -r requirements.txt` on macOS/Linux is likely to fail or pull Windows-only wheels; the scratch venv used for this review does not have it installed). `SETUP.md` never states the required Python version, yet the code needs 3.9+ (`str.removeprefix`) and uses `X | None` only behind `from __future__ import annotations`. The test run already prints a Starlette deprecation warning ("Using `httpx` with `starlette.testclient` is deprecated; install `httpx2` instead"), which is what a floating dependency looks like. The only workflow builds the hosted `web/` edition: nothing runs `pytest`, a linter, or `python scripts/export_fixtures.py --check` (the command that proves the TypeScript port's golden fixtures still match this reference classifier).

Why it matters: this tree is the reference that the TypeScript port is verified against; an unreproducible environment or an unchecked fixture file undermines that.

Fix: add `python_requires`-style documentation (e.g. "Python 3.11+" in SETUP.md) and lower bounds (`fastapi>=0.110`, ...) or a compiled `requirements.lock`; split `requirements-dev.txt`; mark `windows-toasts; sys_platform == "win32"`; add a small `pyproject.toml` with `[tool.pytest.ini_options]` and ruff settings that encode the conventions above (line length off, `E701` allowed if that style is intended); add a CI job running `pytest -q` (on Windows, or Linux once BP-PY-2 is fixed) and `export_fixtures.py --check`.

### BP-PY-12 Notification link ignores `serve --port`
`jobtracker/jobs/notify.py:14` vs `jobtracker/cli.py:33,106-108`

Evidence: `jobs_url()` builds `http://127.0.0.1:{os.environ.get('JOBTRACKER_PORT', '8765')}/jobs`, but `serve --port 9000` never sets `JOBTRACKER_PORT` (nothing in the repo does, and `SETUP.md` does not mention it), so toasts raised from the same server process, and from `sync`, open the wrong port.

Fix: in the `serve` branch set `os.environ["JOBTRACKER_PORT"] = str(args.port)` before `uvicorn.run` (or pass the port into `create_app(...)` and on to `run_discovery`); document the variable in `SETUP.md` for the scheduled `sync` task.

---

## Suggestion

### BP-PY-13 Templates: no macros, inline `<script>`/`<style>` everywhere, duplicated forms
`jobtracker/templates/*.html`

Evidence: zero `{% macro %}` definitions; 14 inline `<script>` blocks (about 600 lines of JavaScript in `index.html`, `settings.html`, `flow.html`, `jobs.html`, `contacts.html`, `base.html`); `base.html` embeds about 40 KB of CSS and each page adds its own `<style>` (`settings.html:4` puts a `<style>` inside the body block); 102 inline `style="..."` attributes; the Delete/Not-an-application forms and their confirm strings exist twice (`_panel.html:96-104`, `detail.html:47-49`) with the long text duplicated. `/static` already exists (self-hosted fonts), so serving CSS/JS from it costs nothing.

What is good here: labels tied to inputs, `sr` text, skip link, `aria-current`, `role="alert"/"status"` with focus handling, `aria-expanded` on row expanders, `lang`, `<main id>`, progressive enhancement (rows expand without JS), `tojson` for data handed to scripts. The JavaScript itself is tidy and defensive.

Fix: extract `base.html`'s CSS to `static/app.css` and the shared scripts to `static/app.js` (browser caching, linting, and it unlocks a CSP without `unsafe-inline`); create `_macros.html` with `confirm_form(action, label, message, ...)`, `notice(kind, text)` and `field(label, name, ...)`; use `data-confirm` (see BP-PY-3).

### BP-PY-14 Type hints are uneven on the web layer and the `Provider` protocol does not match its implementations
`web.py:104,111,123,139,301`, `jobs_web.py:35-43`, `classify.py:67,75`, `providers/base.py:12-26`

Evidence: `conn` is annotated `sqlite3.Connection` in 12 modules but untyped in `web.py` and `jobs_web.py` (`def _counts(conn)`, `_panel_ctx(conn, app_id, *, error=None, ...)`, `get_conn(...)`); `create_app(db_path=..., get_provider=None, http_get=None, toast=None, secrets_dir=None)` takes four untyped injection seams; `classify(msg, learned=None)` and `decide(..., cls, when)` are untyped (importing `Learned` would be circular at runtime but is fine under `TYPE_CHECKING`, which `from __future__ import annotations` already supports). `Provider.connect(self) -> str` omits the `send` parameter the web layer passes (`account.connect(send=True)`), and `send_reply`, `on_wait`, `oldest_first`, `pending` (all used by `sync`/`reply`/`web` through `hasattr`/`getattr`) are not in the protocol. `joblink._is_global(ip: ipaddress._BaseAddress)` annotates with a private class.

Fix: annotate the web helpers with `sqlite3.Connection`; define `GetProvider = Callable[[str, str | None], Provider]` and `HttpGet = Callable[..., requests.Response]` aliases once; extend `Provider` (or add a `SendingProvider` protocol) with the real members and replace the `hasattr` probes; use `ipaddress.IPv4Address | ipaddress.IPv6Address`.

### BP-PY-15 CLI and script ergonomics
`jobtracker/cli.py`, `scripts/*.py`

Evidence and fixes:
- `cli.py` opens connections (`db.connect(...)`) in `recheck`, `connect`, `sync`, `jobs`, `status` and never closes them; short-lived process, but use `contextlib.closing`. `main()` is one long `if args.cmd == ...` chain; `parser.set_defaults(func=...)` per subcommand (as `export_fixtures.py` shows with argparse) removes the chain and the final unreachable `return 2`.
- `cli connect` calls the provider outside any error handling, so a failed sign-in prints a traceback instead of a message; wrap in `try/except (NotConnected, Exception)` and exit 1.
- `scripts/export_json.py` parses `sys.argv` by position while `export_fixtures.py` and `cli.py` use argparse (inconsistent, and no `--help`); build its read-only URI with `Path(path).resolve().as_uri() + "?mode=ro"` since `as_posix()` does not percent-encode `?`, `#` or `%` in a path.
- `scripts/seed_demo.py` always writes `data/demo.db` and ignores `JOBTRACKER_DB`/an output argument, deletes the file silently, never closes its connection, and imports `date` and `activity` in the middle of `main()`.
- `scripts/build_rules_json.py` has no `--check` mode (unlike `export_fixtures.py`); drift is only caught later by vitest, as the docstring says. A `--check` flag makes the Python CI job from BP-PY-11 sufficient.
- The three scripts each do `sys.path.insert(0, ROOT)` with `# noqa: E402`; `export_fixtures.py` also has `import re  # noqa: E402` mid-file. Running them as `python -m scripts.export_fixtures` (add `scripts/__init__.py`) removes the hack.
- `providers/clients.py` writes credential files with `Path.write_text` (non-atomic, default permissions), while `profiles._save` writes to a temp file and `replace`s it (atomic). Use the atomic pattern for both.

### BP-PY-16 Form errors surface as raw JSON 400 pages
`web.py:753,759,761,883,894` (and `HTTPException(400)` throughout)

`add()` and `resolve()` raise `HTTPException(400, "Date must look like ...")`, `"Company is required"`, so a browser form post shows `{"detail":"..."}`; other handlers in the same file flash a readable message by redirect (`?error=`). Since every other validation error in the app flashes, use the same flash helper from BP-PY-5 here. The inline `index.html` add-form has client-side `required`, so this only appears with JS off or a scripted post.

### BP-PY-17 No security response headers (framing)
`web.py:183-203` (`local_only` middleware)

The middleware already blocks foreign Host/Origin/Sec-Fetch-Site on POST, but responses carry no `X-Frame-Options` / `Content-Security-Policy: frame-ancestors 'none'`, so another website can frame `http://127.0.0.1:8765` and clickjack its one-click POST buttons (the delete/merge/send forms have no extra step apart from `confirm()`). Add `response.headers["Content-Security-Policy"] = "frame-ancestors 'none'"` and `X-Content-Type-Options: nosniff` in the same middleware. A full script-src CSP becomes possible only after BP-PY-13.

### BP-PY-18 Per-request overhead: second DB connection and repeated registry reads
`web.py:162-171` (`ui_context`), `profiles.py:36-48`, `web.py:197-199`

`ui_context` opens its own connection on every rendered page (plus `settings.load` and a `COUNT` query) in addition to the handler's `get_conn` connection. `Profiles.list()` reads and parses `profiles.json` on every call and the middleware calls `exists()` (which calls `ids()` which calls `list()`) up to twice per request, then `ui_context` calls `list()` again. Fine at this size, but trivial to improve: stash the handler's connection on `request.state.conn` in `get_conn` and reuse it in `ui_context`; cache `Profiles.list()` keyed on the file's mtime. Also use `time.monotonic()` instead of `time.time()` for the elapsed/ETA arithmetic in `sync_view` (`web.py:79`), `report` (`web.py:685`) and `start_sign_in` (`web.py:557`).

### BP-PY-19 `ignored_is_real` restores mail in separate transactions
`web.py:352-378`

It deletes the `ignored_mail` row and the `emails` row inside `with conn:` (committed), then calls `learn.rebuild(conn)` and `process_message(...)`. If `process_message` raises (an extraction bug, or `OperationalError: database is locked` while a sync runs), the user gets a 500 and the stored copy of the mail is gone; the next sync may refetch it, but that depends on the lookback window. Process first inside the same transaction scope (or catch the failure and re-insert), then delete.

### BP-PY-20 Small style and hygiene items (only where the code does not already decide)
- `settings.py:76-79` writes `if cond: out[...] = ...` on one line (E701); nowhere else in the codebase does this, so it is an outlier rather than a convention.
- `mailtext.py:16` (`_INVISIBLE = re.compile("[...]")`) and `mailtext.py:72` (`.replace("\xa0", " ").replace(" ", " ")`) contain literal invisible characters (U+200B, U+200F, U+2060, U+FEFF, U+00AD, U+202F, which I confirmed byte by byte). `extract.py` writes the equivalent set as `\u` escapes, which is reviewable. Use the escapes here too (this does not change behaviour; verify with `tests/test_mailtext.py`).
- Import grouping: `web.py:15-17` puts `import requests` and stdlib `import secrets` after the third-party FastAPI imports with blank lines between. Also `import secrets` shares its name with the repository's gitignored `secrets/` directory; it works today because a namespace-package directory loses to the stdlib module, but a `secrets/__init__.py` would silently shadow it. Rename the folder (it is `config.SECRETS_DIR`) or import as `from secrets import token_hex`.
- Shadowed builtins in route signatures: `open`, `dir` (`web.py:217-218`), `min` (`jobs_web.py:57`), and `Profiles.list` (method named `list`, then `list[dict]` annotations inside the class). Use `Query(alias="open")` style parameters so the Python names are not builtins; URLs stay the same.
- `jobs_web.py:67` `json.loads(s["config"])` has no guard for a corrupt `config` row (one bad row 500s the Jobs page); `jobs/run.py` guards the same value.
- Search/dedupe in `jobs/store.add_postings` issues one `SELECT` per posting plus one for the twin: fine at current sizes (feeds are capped at 300), noted for completeness.
- `joblink.py` (759 lines) mixes the hardened HTTP fetcher (`_pinned`, `_Fetcher`, SSRF checks) with the page and board parsers. The code is careful and well tested; splitting `joblink/net.py` (fetcher) from `joblink/parse.py` would make the security-critical part reviewable on its own. Low priority.

---

## Done well

- SSRF defence in `joblink.py`: per-hop DNS resolution, global-address check including v4-mapped/6to4/Teredo/NAT64, connection pinned to the vetted IP with TLS name kept, redirect handling by hand, total deadline, fixed error messages that never echo network text. Dependency-injected `resolver` and `transport` for tests.
- `reply.py`: recipient taken from the stored mail never from the form, token recorded before sending for idempotency and rolled back on failure, per-hour/day caps, `NotAllowed` mapped to user-safe errors.
- Parameterised SQL throughout (every f-string SQL was checked: only constants, whitelisted column names, or `?` lists); `with conn:` used consistently for write transactions; `PRAGMA foreign_keys = ON`; WAL; `ON CONFLICT` upserts; the `applications_gone` trigger plus `ON DELETE` rules handle id reuse.
- Connection lifetime in the web layer: `get_conn` is a `try/finally` yield dependency; the sync and sign-in threads open their own connection and close it in `finally` (`web.py:565-572`, `687-714`); shared thread state is guarded by locks; threads are named and `daemon=True`.
- Local-only hardening in the middleware: Host allow-list (DNS rebinding), Origin vs Host with port, `Sec-Fetch-Site`; `switch_profile` and `back_to` validate redirect targets; `contact_return` whitelists `next`; cookies are `httponly` and `samesite=lax`.
- Windows isolation for toasts: `notify.show_toast` imports `windows_toasts` lazily inside a `try` and returns False elsewhere; `cli serve` handles the no-console `pythonw` case.
- Time handling: stored times are UTC strings; `Message.received_at` is documented as timezone-aware UTC; providers normalise naive header dates; the `today()` local-day exception is documented. Gmail `fetch` yields oldest-first so a sync cut short keeps progress; rate-limit retry loop with injectable `_sleep`.
- Profiles: slug ids make `shutil.rmtree` safe, atomic `profiles.json` writes, a lock around mutations.
- Settings: `sanitize` whitelists every value; `load` tolerates corrupt JSON.
- Test hygiene: `conftest.py` autouse fixture keeps tests off the real `secrets/` folder; 877 passing tests; `export_fixtures.py --check` exists as a parity gate.
- Domain exceptions carrying user-safe messages and fixed message constants keep exception text out of pages (`MSG_NOTHING`, `ClientError`).
- Template accessibility basics and progressive enhancement (see BP-PY-13).

## Summary

The Python side is carefully written and consistent with its own conventions; the problems are concentrated in a few places. Counts: 3 Critical, 9 Important, 8 Suggestion (20 findings: BP-PY-1 to BP-PY-20, where Suggestions are BP-PY-13 to BP-PY-20). The Critical items are a misplaced `<script>` in `<title>` (a feature that silently never runs), an off-Windows 500 on `/jobs` caused by unisolated DPAPI (which also explains all 7 "expected" test failures), and Jinja values interpolated into inline JS handlers. Biggest structural risks: swallowed exceptions with no logging in the sync path, the 760-line `create_app` closure, and unversioned/unlocked schema migration. No behavioural change to classify/extract/mailtext is proposed.

Housekeeping note: while probing I briefly created `secrets/profiles/zz-test` in the repo through `token_persistence` (it makes directories); I removed it and confirmed `secrets/` is empty again. `.pytest_cache` / `__pycache__` are gitignored. All other probe data lived under the scratchpad.
