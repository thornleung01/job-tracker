# Clarity review: local Python edition (branch easy-connect)

Repo: /Users/thorn.leung/job-tracker. Scope: jobtracker/*.py, jobtracker/providers/*.py, jobtracker/templates/*.html, jobtracker/rules.yaml, scripts/*.py, SETUP.md, PRODUCT.md, DESIGN.md, web/README.md. Read-only review; no repo files were changed.

## Overview

The Python edition reads well at the module level. Most domain modules open with a docstring that explains why they exist (`joblink.py`, `mailtext.py`, `learn.py`, `recheck.py`, `reply.py`, `contacts.py`, `profiles.py`), names are plain-English and domain-accurate, and comments mostly explain intent (why a sender is trusted, why a block is overridden by the subject). The weak spots are structural, and they cluster in three places. (1) `web.py` has one 761-line `create_app` closure that holds 40 routes plus two hand-rolled background-thread state machines. (2) Small helpers are copied around: sender parsing in 5 places, timestamp formatting and parsing in 6, whitespace collapsing in 16, plus private functions imported across modules. (3) The Jinja templates carry about 1,000 lines of inline CSS and JS, with copy-paste between pages, and one real bug (a `<script>` inside `<title>`). The docs were written for one edition and extended for two, and now contradict each other and the code in several small ways. The Gmail "In production" vs "Testing" question is a real difference between editions, not an error. It only needs a sentence of explanation in each file (CL-PY-8).

Counts: 10 Medium, 14 Low.

---

## Medium

### CL-PY-1 `create_app` is a 761-line closure with 40 routes
`jobtracker/web.py:139-899`

Evidence: every route, helper (`learned_from_feedback`, `learned_notice`, `contact_return`, `start_sign_in`, `run_sync`, `switch_to`, `_log`) and two shared dicts (`connecting`, `syncs`) live inside one function, so a reader cannot see which handlers share state. `jobs_web.register` (157 lines) already uses the same "closure that registers routes" pattern. `index` (217-262) builds SQL, URLs and view data in one body, and `settings_page` (447-495) mixes view-building with state mutation.

Suggested change: split by feature into `APIRouter` modules (or `register_*(app, ctx)` functions like `jobs_web`), each under about 150 lines:
- `pages.py`: `/`, `/app/{id}`, `/app/{id}/panel`, `/flow`, `/contacts`.
- `review_web.py`: `/review`, `/review/{id}`, `/ignored/{id}/real`, `/learned/{id}/undo`, `learned_from_feedback`, `learned_notice`.
- `application_actions.py`: edit, stage, unlock, delete, merge, add, derive, step, activity delete, not-application.
- `settings_web.py`: settings, appearance, recheck, credentials, connect, reply-access, disconnect, `/email/{id}/reply`.
- `profiles_web.py`: the profile routes.
- `sync_web.py`: `/sync`, `/sync/status`, `run_sync`.

Keep `create_app` as the 30-line composition root: build `templates`, the middleware and `get_conn`, then include the routers. Pass the shared pieces (`profiles`, `templates`, `get_conn`, `provider_factory`, `http_get`, `toast`) through a small `AppContext` dataclass instead of closing over them.

### CL-PY-2 Sign-in and sync progress are untyped dict state machines, and `GET /settings` mutates them
`web.py:144-149`, `447-475`, `547-583`, `676-735`

Evidence:
- `connecting[(pid, provider)]` holds `{"state": "waiting"|"done"|"error", "started", "message"}`.
- `syncs[pid]` holds 10 string keys (`running, phase, done, total, account, note, message, failed, t0, first_done`), initialised as a literal at line 723 and updated by `report()` at 678-685. The meaning of `t0` and `first_done` is only visible by reading `sync_view` at lines 77-79.
- `settings_page` is a GET, but it pops finished sign-ins and clears `state["message"]` (lines 460-473). That "reported once" behaviour is easy to miss, and nothing says a refresh loses the message.
- `run_sync` (676-714) has three jobs: report progress, run `sync_all` plus discovery, and format the user message. The pluralisation idiom `'s' if n != 1 else ''` appears 7 times in this file.

Suggested change:
- Add two small classes in the new modules from CL-PY-1: `SignInTracker` with `start(pid, provider)`, `finish(...)` and `take_result(pid)`, and `SyncRun` (a dataclass, with `Phase` as an `Enum` or `Literal`) with `update(**fields)` and `eta_seconds()`. The lock lives inside the class.
- Move the result-sentence building out of `run_sync` into `sync_summary(results, jobs) -> (message, failed)`.
- Add a `plural(n, word)` helper next to `_short`.
- Rename the "take once" operations so the GET reads `notice, error = sign_ins.take_result(pid) or sync_runs.take_result(pid)`.

### CL-PY-3 The same small helpers are written 3 to 16 times
Evidence (each is a place a reader must verify is identical):
- **Sender parsing** (5 versions): `mailtext.split_sender` (41), `learn.split_sender` (55, returns only the address, lowercased, same name), `recheck._message` (22-28), `web.py:367-370` (`ignored_is_real`) and `web.py:434` (`review`). `ignored_is_real` rebuilds a `Message` by hand when `recheck._message(row)` already does it. Two functions named `split_sender` that return different things is a trap.
- **Timestamp format** `"%Y-%m-%dT%H:%M:%SZ"`: written 6 times (`db.iso` formats it; `recheck.py:26`, `web.py:100`, `web.py:369`, `sync.py:140` and `providers/outlook.py:99` repeat it). `db.iso` has no parsing counterpart.
- **Whitespace collapse** `re.sub(r"\s+", " ", x).strip()`: 16 occurrences, including the `[:80]` / `[:100]` clamps at `web.py:322`, `web.py:751` and `contacts.py:215`. The numbers also appear as `maxlength="80"` / `"100"` in `detail.html:29-30`.
- `_is_bulk(headers)` is byte-identical in `providers/gmail.py:180` and `providers/outlook.py:121`.
- `_now()` in `web.py:93` and `jobs/store.py:28`.
- `token_dir()` in `providers/base.py:46` duplicates `Profiles.token_dir` (`profiles.py:74`) and hard-codes `"default"` instead of `DEFAULT_ID`.
- `STAGES` is defined in both `web.py:29` and `db.py:180`, with the same content and order. `settings.FLOW_PERIODS` duplicates the values in `web.PERIODS`.
- `PERSONAL_DOMAINS` (`learn.py:23`) and `FREE_MAIL` (`extract.py:12`) are near-duplicate sets that differ by `msn.com`.
- `SIGN_IN_TIMEOUT = 300` is defined in both providers, and `web.SIGN_IN_WAIT = 330` is a hand-synchronised copy ("the providers give up after 300").
- `MAX_BODY = 5000` in `reply.py` is repeated as `maxlength="5000"` in `_reply.html:14`.
- `reply_link` (`links.py:35-40`) re-implements `reply.recipient()` and `reply.subject_for()`.

Suggested change:
- Create a `jobtracker/text.py` (or extend `mailtext.py`) with `split_sender`, `sender_address` and `collapse_spaces(s, limit=None)`.
- Add `db.parse_iso()` next to `db.iso()` and use it in the 4 parse sites.
- Move `is_bulk(headers)` and `token_dir` into `providers/base.py`.
- In `web.py` use `STAGES = db.STAGES`.
- Move the length limits and the sign-in timeout into `config.py` and pass them to templates as globals (or at least add "keep in step with" comments).
- Make `links.reply_link` call `reply.recipient` and `reply.subject_for`. These live in `links.py` / `reply.py` today; place the shared pair in `links.py` and import them in `reply.py`, so the dependency points one way.

### CL-PY-4 Modules reach into each other's private names, and `sync` and `recheck` import each other
Evidence:
- `reply.py:18` imports `_ADDRESS, _NO_REPLY` from `links`, and `reply.py:99` calls `activity._touch`.
- `recheck.py:69` calls `sync_module._remember_ignored`.
- `sync.py:175` does `from .recheck import settle_review` inside `sync_account`, and `recheck.py:16` imports `sync` at module level, so the import cycle is hidden by function-level imports. `recheck.settle_review` then calls `sync.decide`.
- `sync.py:132` does `from .config import OVERLAP_DAYS` inside the function, although `config` has no cycle. Lazy imports also appear at `web.py:303`, `339`, `355`, `356`, `426`, `427`, `509`, `823`, `cli.py:13`, `62`, `98`, `joblink.py:753` and `recheck.py:114`, with no comment saying which are for the cycle and which are for startup cost.

Suggested change: drop the underscore on the shared names (`ADDRESS`, `NO_REPLY`, `touch_application`, `remember_ignored`). Move `decide`, `_remember_*` and `process_message` into a `classify_and_store.py` (or `ingest.py`) that both `sync` and `recheck` import. Then `sync` can import `settle_review` at the top, and the cycle disappears. Hoist the cycle-free lazy imports to the top of each file and leave a one-line comment on the ones that must stay lazy.

### CL-PY-5 `db.connect` repeats one migration pattern 8 times, and the schema and the migrations have drifted
`db.py:192-226`, `db.py:11-168`

Evidence: `emails.web_link`, `bulk`, `hold`, `reason`, `ignored_mail.bulk`, `accounts.active`, `can_reply` and `applications.url` each get a 2-line `if "x" not in {r["name"] for r in conn.execute("PRAGMA table_info(t)")}: ALTER TABLE` block. The `PRAGMA` runs 8 times, so a new database reads the table info eight times in a row.

Drift: `SCHEMA` has no `bulk`, `hold` or `reason` on `emails`, and no `bulk` on `ignored_mail`. A new database gets those columns only through `ALTER`. A reader looking for what `emails` contains (the central table) cannot find `hold` or `reason` in `SCHEMA`. Likewise `learn._reason` (70-74) has a try/except for a missing `reason` column that only matters because of this history.

Suggested change:
```python
def _ensure_column(conn, table, column, ddl):
    if column not in {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")

_ADDED_COLUMNS = [("emails", "web_link", "TEXT"), ("emails", "bulk", "INTEGER NOT NULL DEFAULT 0"), ...]
for table, column, ddl in _ADDED_COLUMNS:
    _ensure_column(conn, table, column, ddl)
```
Also put every current column into `SCHEMA`, so `SCHEMA` is the truth for a new database and the list is only the upgrade path. Then `learn._reason` can read `email["reason"]` directly.

### CL-PY-6 `detail.html` puts a `<script>` inside the `<title>` block
`templates/detail.html:2-13`, with `base.html:9`

Evidence: `{% block title %}{{ a.company }} · Job Tracker<script>...</script>{% endblock %}` is rendered inside `<title>...</title>`. Browsers treat the contents of `<title>` as plain text, so the script never runs, and the tab title can show the script source. The "scroll to `#email-N` and open the reply box" behaviour probably does not work. (Please check this in a browser: it is my reading of the HTML parsing rules, not something I ran.)

Suggested change: close the title block after `Job Tracker`, and move the script to the end of the `content` block, or into a `{% block scripts %}{% endblock %}` slot added to `base.html` just before `</body>`. The slot also gives the other templates a place for their scripts (CL-PY-7).

### CL-PY-7 Templates carry about 1,000 lines of inline CSS and JS, with copy-paste between pages
Evidence:
- `base.html` has about 390 lines of CSS plus a 43-line script. `flow.html` has 250 lines of JS (91-345) in one IIFE that does layout, SVG drawing, tooltip, PNG export and sharing. `index.html` has 4 inline scripts (about 140 lines): row expand, search combobox, "Fill in", open-add.
- `jobs.html:20-23` and `settings.html:21-24, 39` redefine `.checks`, `ol.steps` and `h2.sec`. `h2.sec` is byte-identical in both. `.checks input` is also duplicated.
- The `time.local` localiser at `settings.html:326-329` and `jobs.html:221-224` duplicates the richer one in `base.html:449-458` (which also handles `data-fmt` and `data-rel`). It is redundant, because base re-localises anything not marked `data-done`.
- The "focus the notice" snippet exists only on `settings.html:331-332` and `jobs.html:225-226`. `detail.html:16-17`, `contacts.html:6` and `review.html:15-16` also render `data-focus` notices, but nothing focuses them, so the attribute means two different things depending on the page.
- The notice markup (`<div class="notice" role="status" tabindex="-1" data-focus>`) is repeated 9 times.
- `{{ x[:16].replace('T', ' ') }} UTC` appears 9 times (`_panel.html` 3, `jobs.html` 3, `detail.html` 2, `review.html` 1), `'Unknown role'` is hard-coded in 3 templates (`detail.html:30`, `contacts.html:32`, `review.html:50`) beside `extract.UNKNOWN_ROLE`, and the sender header block (`mail-meta` with who, role, addr, when) is pasted in `detail.html:89`, `_panel.html:53` and `review.html:21`.
- `jobs.html:72` reuses stage class names as score colours (`'Offer'`, `'Heard-back'`, `'Applied'`), with thresholds 80 and 65 inline. `jobs.html:191` sets a class and an inline style that say the same thing. There are 100 inline `style=` attributes across the templates (index 20, jobs 21, settings 14).
- `flow.html:~183`: `const display = id => id;` is an identity function whose comment ("Offer and Rejected also get a drawn icon...") does not describe it.

Suggested change:
- Move the page scripts and shared CSS into `jobtracker/static/` (the static mount already exists): `app.css`, `app.js` (the localise, busy-form, autosubmit and data-focus pieces), and one file per heavy page (`flow.js`, `applications.js`). Keep only the JSON data blocks inline. This also makes the "kept in step with `jobtracker/templates/base.html`" claim in `web/README.md:119` checkable by `diff`.
- Add `_macros.html` with `notice(msg, kind)`, `utc_time(iso, rel=False)` and `sender_line(...)`.
- Pass `UNKNOWN_ROLE` and the score tiers (`jobs_web`) to templates as globals.
- Delete `display`.
- Replace the repeated inline styles with 4 or 5 utility classes (`.mt-8`, `.mt-12`, `.flex-1-220`).

### CL-PY-8 Gmail publishing status: "In production" (SETUP.md) vs "Testing" (web/README.md) is a real edition difference, not a contradiction, but nothing says so
`SETUP.md:20`, `settings.html:151`, `web/README.md:46`

Evidence: SETUP.md (and the in-app steps in `settings.html`) tell the single local user to publish "In production" because a Desktop-app client in Testing has its refresh token expire after about 7 days. `web/README.md:46` says "External, status Testing" because the hosted edition uses a Web-application client with no refresh token (tokens live in memory only), and the Testing-mode test-user list is the access control (`PRODUCT.md:21`). Both are right for their edition. A reader who has both files open sees two opposite instructions with no explanation.

Decision: keep both, and add one sentence to each.
- `SETUP.md` step 3, after the "Publish" bullet: "(The hosted edition in `web/` does the opposite on purpose: it stays in Testing and uses the test-user list as its access control. See `web/README.md`.)"
- `web/README.md`, Google Cloud bullet: "Unlike the local edition (`SETUP.md`), do not publish: Testing is what limits the app to your test users, and tokens never persist here, so the 7-day expiry doesn't matter."
- Also state in `SETUP.md` that the Desktop-app OAuth client type differs from the hosted Web-application one, so credentials cannot be reused between editions. `PRODUCT.md:20-21` already hints at it.

### CL-PY-9 The four docs contradict each other and the code in small ways
Evidence (each verified against code or another doc):
- `DESIGN.md:312` says the settings controls "switch instantly because [the app] has no script on that form". `settings.html:258` ("Changes preview instantly") and `settings.html:314-324` have a script that previews every choice before saving.
- `DESIGN.md:193` lists corners as "(round/sharp)". The code (`settings.CORNERS`, `data-corners`) uses `soft` / `sharp`, and `DESIGN.md:277` says "Round and soft by default".
- `PRODUCT.md:38` says "the emoji status icons the user asked for". `DESIGN.md:347` ("no emoji") and `DESIGN.md:367` ("Don't use emoji") say the opposite. `settings.html` uses text titles ("Gmail is connected") with no emoji, so the code agrees with DESIGN.
- `SETUP.md:3` says "Both accounts are read-only: the app can read mail but not send". `SETUP.md:96` and `PRODUCT.md:13` describe opt-in sending. Change line 3 to "read-only by default; sending is an opt-in per account (see Replying)". `links.py:31` repeats the stale claim ("The app never sends mail") in the `reply_link` docstring.
- `PRODUCT.md:21` calls the hosted edition "in progress"; `web/README.md` documents it as live, with a deployed URL. `PRODUCT.md:28` says the local edition's "behavior, copy facts, URLs, form names, and data are not changing; the restyle is visual only", and `web/README.md:5` says it is "unchanged". Since then the local edition gained profiles, replying, People, Jobs link parsing (`joblink.py`) and export scripts, so both statements are stale.
- `PRODUCT.md:26` lists the pages as Applications, Flow, Needs review, Detail and Settings. It leaves out Jobs and People for the local edition, which `base.html:421-430` shows in the main nav. `PRODUCT.md:26` also says Settings has "no email-filter rules", while `jobtracker/learn.py` and `review.html` expose learned rules with undo.
- `SETUP.md:106` lists skipped folders as "Spam, Promotions, Social, Junk, Sent, and Drafts". The code also skips Forums (`gmail.py:20`) and Deleted Items (`outlook.py:18`).
- `web/README.md:77-81` documents `export_json.py` with forward-slash paths; the script's own docstring (`export_json.py:3-4`) uses Windows paths and different defaults. `web/README.md` says "Settings, Your data, Import"; the script says "Settings > Import from the local edition". Pick one wording.

Suggested change: fix each at the source. Add a two-line "Applies to" header to `PRODUCT.md`, `DESIGN.md` and `SETUP.md` (for example "Local edition" / "Both editions") so a reader knows which sections to follow.

### CL-PY-10 `SETUP.md` still reads as a one-time setup note for one PC, and omits steps a maintainer needs
`SETUP.md:1-6`, `:104`, `:56-58`

Evidence:
- The opening ("The app is built and tested. What's left is signing in to your mail", "All commands run from `C:\Users\thorn\job-tracker`") is a hand-off note, not documentation. A path to one person's profile folder is hard-coded.
- Step 6 ("Create the client and do step 7 after publishing in step 3") restates the ordering of steps 3, 4 and 7 and is confusing.
- The numbering is inconsistent: sections 1, 2, 3 and 4 are numbered, but "Profiles", "Replying", "How to read the dashboard" and "Where your data lives" are not, and "4. Finding jobs" comes after the unnumbered "Profiles".
- `SETUP.md:104` says new classifier wording "can be added to `jobtracker\rules.yaml`". It does not say that `python scripts/build_rules_json.py` must then be run and the output committed, or the hosted edition's vitest suite fails on drift (see `scripts/build_rules_json.py:7`). `rules.yaml` itself has no header comment that says it is shared with `web/src/pipeline/rules.json`.
- Not documented anywhere in SETUP.md: the People tab, the "Paste a job link" form on Applications (documented only in `web/README.md:83-92`), `JOBTRACKER_DB` and `scripts/seed_demo.py` (only in the script docstring), and the export-to-hosted flow.
- Arrow style is mixed ("Settings → Email accounts" at line 13 vs "Settings -> Sync -> Re-check" at line 105).

Suggested change: rename the opening to a one-paragraph "What this is and how to start", use `<repo>` instead of the personal path, number all sections or none, add one "Maintainer notes" section (rules.yaml plus `build_rules_json.py`, `seed_demo.py` / `JOBTRACKER_DB`, `export_json.py`), and add a comment block at the top of `rules.yaml`: "Shared with the hosted edition: run `python scripts/build_rules_json.py` after editing."

---

## Low

### CL-PY-11 Several core modules have no header docstring
`jobtracker/web.py`, `db.py`, `sync.py`, `classify.py`, `extract.py`, `match.py`, `settings.py`, `stats.py`, `cli.py`, `models.py`, `config.py`, `providers/base.py`, `providers/gmail.py`, `providers/outlook.py`

Evidence: the modules that do have one (`joblink`, `mailtext`, `learn`, `recheck`, `reply`, `contacts`, `profiles`, `activity`, `links`, `jobs_web`) are the easiest to read, and the missing ones are the most central. `classify.py` has the rule-priority story (`PRIORITY`, learned-block override, bulk handling, ATS trust) spread across inline comments. `web.py` has no statement that it is the local-only dashboard.

Suggested change: 3 to 6 lines each. For example `classify.py`: "Decide whether an email is about a job application, and which stage it reports. Rules come from rules.yaml (shared with the hosted edition); learned rules from learn.py may tighten them. Returns a Classification with a human-readable reason."

### CL-PY-12 `providers/base.py` `Provider` protocol no longer matches the providers
`providers/base.py:13-28`

Evidence: the protocol says `fetch(...)` yields "newest first", but `GmailProvider.fetch` is oldest first (`gmail.py:129`, and `oldest_first = True`). `connect(self)` has no `send` argument, though both providers take it. `send_reply`, `oldest_first`, `on_wait` and `pending` are missing, and `sync.py:145, 157` reach for them with `hasattr` / `getattr`. `get_provider` returns `Provider`, so the type hides what the callers actually use.

Suggested change: update the protocol (add `send_reply`, optional `oldest_first`, `on_wait`, `pending`, `connect(send=False)`) or make the optional attributes a small `ProviderCapabilities`, and fix the "newest first" line.

### CL-PY-13 Builtin names used as parameters
`web.py:217` (`open`, `dir`), `jobs_web.py:53` (`min`)

Evidence: `index(..., open: str = "", sort: str = "", dir: str = "")` shadows `open` and `dir`; `jobs_page(..., min: int = -1)` shadows `min`. They are query-string names, so they are deliberate, but the body of `index` can no longer call `open()`.

Suggested change: `open_ids: str = Query("", alias="open")`, `direction: str = Query("", alias="dir")`, `min_score: int = Query(-1, alias="min")`. The URLs do not change.

### CL-PY-14 `sync.py` reads top to bottom out of order and returns bare strings
`sync.py:23`, `117`, `206`, `68-104`

Evidence: constants sit mid-file (`IGNORED_KEEP_DAYS` at 23, `BATCH` at 117) and `_default_provider` is defined after its use at 135 and 206-209. `process_message` returns one of `"duplicate" | "job-alert" | "ignored" | "applied-to-application" | "review"`, documented in a docstring. `web.py:372` compares against `"ignored"` and `"review"`, and `process_messages` also invents `"retry"` and `"error"`. A typo in any of these would fail silently. `decide` takes an untyped `cls` and has two flags (`needs_review`, `app_id`) that change in 4 places (lines 44-64), including a nested `if app_id and match.kind == "matched"` that is hard to follow.

Suggested change: put constants at the top and drop `_default_provider` (use `providers.get_provider` directly, as `cli.py` does). Define `class Outcome(str, Enum)` for the six outcomes. Annotate `cls: Classification`. In `decide`, return early (`return None, True` for review) instead of toggling `needs_review` through three branches.

### CL-PY-15 `classify._classify` repeats the "walk PRIORITY looking for a strong pattern in the subject" loop three times
`classify.py:111-115`, `124-128`, `133-147`

Evidence: the learned-block override and the bulk branch each loop `for event in PRIORITY`, strip negated offers if `event == "offer"`, and check `rules.strong[event]` against the subject. The same conditional appears a third time in the main loop with body as well. `_classify` is 57 lines with 9 returns.

Suggested change:
```python
def _strong_event_in(text, rules):
    for event in PRIORITY:
        scan = strip_negated_offers(text, rules) if event == "offer" else text
        if any(p.search(scan) for p in rules.strong[event]):
            return event
    return None
```
The first two branches become 3 lines each. Keep the third loop as it is, because it also carries `p.pattern` into the reason.

### CL-PY-16 `contacts.derive` is a 71-line function that does three passes
`contacts.py:127-197`

Evidence: it builds people from senders (144-162), merges "mentions" (163-174) and applies user edits to the output (176-196). Local state (`people`, `mentions`, `first_names`, `edits`) crosses all three. The person dict is built inline twice with 7 keys (150, 171), and `p["last_from"]` is added to a dict whose shape is declared elsewhere. `for_application` (200) is a one-line wrapper, and `titles` (209) is `titles_from(derive(...))`.

Suggested change: split into `_people_from_senders(conn, ...)`, `_merge_mentions(people, mentions)` and `_apply_edits(people, edits)`. Replace the person dict with a small dataclass `Person` with a `new(name, email, is_sender)` constructor. Delete `for_application` and have callers use `derive(conn, app_id)`.

### CL-PY-17 `cli.main` is a 105-line if-chain
`cli.py:21-125`

Evidence: argument parsing, profile resolution and 8 command bodies are in one function. `connect` and `status` open connections they never close. `recheck` prints a long single line (66). The final `return 2` at 125 is unreachable because `cmd` is `required=True`.

Suggested change: one function per command (`cmd_sync(args, profiles)` and so on) and `COMMANDS = {"sync": cmd_sync, ...}`. `main` then parses, resolves profiles and dispatches in about 25 lines.

### CL-PY-18 `joblink.py` is well documented but has two duplicated blocks and a few tangled spots
`joblink.py:303-309` and `341-347`, `659-699`, `498-513`, `704-749`, `752-759`

Evidence:
- The "read at most `MAX_BYTES` in 64 KB chunks under the deadline" loop appears in `_Fetcher.get` and `_Fetcher.post_json`. Extract `_read_capped(resp)`.
- `_ashby_posting` (41 lines) has two nearly identical `try ... except JobLinkError: raise / except (_FetchFailed, ...)` blocks, plus a GraphQL query string embedded inline. Move the two queries to named constants, and wrap the call in `_ashby_query(fetcher, op, variables)`.
- `_slug_role` (498-513) has five stacked `continue` conditions over `words` that are hard to read together (504-510). A short comment with one example per `continue` ("12345-senior-engineer", "view", "ab12cd34ef") would help; better, extract `_is_id_word(w)`.
- `derive` (704-749) is 46 lines of three nested try/except fallbacks. It reads as board, then page, then guess; the helper split `_try_board(fetcher, cleaned)` / `_try_page(fetcher, cleaned)` would show that.
- `_known_codec` is defined after use and does `import codecs` inside the function.
- `_pretty` and `_domain_company` do similar title-casing of a slug.

### CL-PY-19 `mailtext.py` has literal invisible characters in source and a repeated condition
`mailtext.py:16`, `:72`, `:52`, `:83`

Evidence: `_INVISIBLE = re.compile("[͏​-‏⁠﻿­]")` contains raw zero-width characters, and line 72 has a raw narrow no-break space in `.replace(" ", " ")`. In an editor this looks like a no-op, and the `.replace` looks like a typo. `extract.py:51` writes the same idea with `\u034f\u200b-\u200f...` escapes, so the two files are inconsistent. `b[0] in ":,;)." or b[0] == "?"` is written twice (52, 83) and says the same thing.

Suggested change: write the set as escapes (reuse a single `INVISIBLE` constant shared with `extract.py`), name `_CLOSERS = ":,;).?"`, and use `b[0] in _CLOSERS`.

### CL-PY-20 `web.py` has a few over-dense one-liners
`web.py:123-136` (`_panel_ctx`), `245-252` (`href` closure in `index`), `512-520` (`recheck_saved`), `601-603`

Evidence: `_panel_ctx` builds a 14-key dict in 4 lines with a conditional call inside (`titles if titles is not None else contactsmod.titles(...)`); `recheck_saved` builds the message by concatenating three conditional f-strings; the `href(*, ids=open_ids, **extra)` closure merges four dicts in one expression (246).

Suggested change: build each dict one key per line; make `recheck_saved` compose a list of sentences and `" ".join` them; give `href` a docstring and split the merge into three named steps. Add `plural()` (CL-PY-2).

### CL-PY-21 Magic numbers and strings without a name
Evidence: `web.py:202`, `635`, `673` (`3600 * 24 * 365`, three times, plus the same `httponly=True, samesite="lax"` triple, which `switch_to` already wraps once), `web.py:128` (`20`), `web.py:117` (`300`), `web.py:442` (`50`), `web.py:665`; `contacts.py:78` (`start + 9`), `contacts.py:124` (`MAX_MAILS`, but the 9 is not named); `extract.py:60` (`limit=60`); `jobs.html:206` ("at most every 6 hours") vs `jobs/adzuna.py:15 MIN_INTERVAL`; `jobs.html:182` ("about once an hour") vs `jobs/run.py:13 FEED_INTERVAL = timedelta(minutes=50)`; `jobs.html:125` ("up to 5 MB") vs `resume.MAX_UPLOAD`.

Suggested change: add `COOKIE_MAX_AGE`, route the three `set_cookie` calls through `switch_to` (or a `set_profile_cookie` helper), name `HISTORY_PREVIEW = 20`, and pass the interval and upload limits to the templates, so the copy cannot disagree with the code.

### CL-PY-22 Style inconsistencies in `settings.py`, imports and scripts
Evidence:
- `settings.py:76-79`: four one-line `if cond: stmt` statements, in a codebase that otherwise uses block form. The module has no docstring.
- `web.py:15-19`: `import requests` and `import secrets` sit apart from the other imports (stdlib `secrets` after third-party `requests`, with a blank line between each), and `db`, `learn`, `links`... are imported on one 130-character line with an alias (`contactsmod`, `replymod`).
- `scripts/export_fixtures.py:20-31`: `import re` appears after the `sys.path` hack, other stdlib imports are not alphabetised, and the module aliases `C, E, L, M, MA` are hard to read in an 877-line file; `corpus_messages` is 135 lines (212-346) and `build_mailtext` 74.
- `scripts/seed_demo.py:87-88`: imports inside `main()` (`date`, `activity`) while the other imports are at the top.
- `match.py:3-5`: a stray blank line splits the stdlib imports.
- `mailtext.py:32` / `extract.py:51`: `\u00c0` and `\u00e9` escapes mixed with raw characters in the same pattern.

Suggested change: group and sort imports (stdlib / third party / local), use block `if`s in `settings.sanitize`, import the fixture modules under their real names (`classify`, `extract`, `mailtext`...), and split `corpus_messages` into the three corpus groups its comments already describe.

### CL-PY-23 Comments that restate code or are slightly stale
Evidence:
- `web.py:173` `# self-hosted fonts` and `web.py:177` ("one per reply form, so pressing Send twice sends once") are fine, but `web.py:215`, `497`, `527`, `632` are section dividers inside a function that would be unnecessary after the split in CL-PY-1.
- `sync.py:17` docstring says "Keep only the ID and date so the email isn't fetched or reprocessed", true, but `_remember_unrelated` also takes an unused-looking `msg` only for `msg.id`. A `msg_id` parameter would say so.
- `db.py:170-171` comment ("Progression events only move an application forward. Terminal events can land from any stage, but only if the email is newer") sits above `STAGE_FOR_EVENT`, which is just a map; the rules are in `apply_event` below. Move the comment there.
- `classify.py:13` ("Checked in this order; the first event with a match wins") is useful, but `rules.yaml:75` repeats the order in prose and `heard_back` (never in the YAML) appears only in the dataclass comment. Keep one source of truth and link to it.
- `jobs_web.py:44` `# Only ever return to a Jobs page of this app.` and `web.py:643` `# Back to the same kind of page, never to another site.` describe the same open-redirect guard twice, implemented two different ways (`startswith("/jobs")` vs a `//` and backslash check). Share one `safe_local_path(url, prefix=None)` helper.
- Good comments worth keeping: the "why" comments in `classify._classify`, `match.find_application`, `reply.send`, `learn.rebuild`.

### CL-PY-24 Template `onsubmit` strings interpolate email data into JavaScript (flag to the security reviewer)
`_reply.html:9`

Evidence: `onsubmit="return confirm('Send this reply to {{ r_to }}?')"`. Jinja HTML-escapes `'` to `&#39;`, but the browser decodes the attribute value before running it as JavaScript, so an address containing `'` can break out of the string. `links._ADDRESS` (`[^@\s<>]+@...`) allows `'`. Strictly this is a safety issue, not clarity, so I only flag it. The clarity fix, which also removes the issue, is to put the address in a `data-confirm` attribute and have one delegated handler in `base.html` read it. The same handler could serve the 6 other `onsubmit="return confirm(...)"` strings (`detail.html:47-49`, `_panel.html:78, 98, 102`).

---

## Longest or most tangled functions (top 10)

| # | Function | Lines | Why | How to split |
|---|---|---|---|---|
| 1 | `web.py:create_app` (139-899) | 761 | 40 routes, 2 thread state machines, 12 inner helpers | Routers by feature plus `AppContext` (CL-PY-1) |
| 2 | `jobs_web.py:register` (35-191) | 157 | Same closure pattern, 17 routes in 4 groups | Split into `matches`, `profile`, `sources` registrars; `jobs_page` (53-79) builds a 25-key context |
| 3 | `scripts/export_fixtures.py:corpus_messages` (212-346) | 135 | Long literal corpus | One function per corpus group named in the module docstring (a, b, c, d) |
| 4 | `cli.py:main` (21-125) | 105 | If-chain of 8 commands | One function per command plus a dispatch dict (CL-PY-17) |
| 5 | `scripts/export_fixtures.py:build_mailtext` (516-589) | 74 | Several kinds of case in one body | One builder per mailtext function (`parts`, `render`, `split_sender`) |
| 6 | `contacts.py:derive` (127-197) | 71 | Three passes with shared local state | `_people_from_senders`, `_merge_mentions`, `_apply_edits`, dataclass `Person` (CL-PY-16) |
| 7 | `sync.py:sync_account` (125-190) | 66 | Date window, fetch, batch loop with nested generator, error and retry bookkeeping | `_since(account, days, conn)`, `_fetch_and_process(...)`, `_record_outcome(conn, account, counts, now)` |
| 8 | `classify.py:_classify` (97-153) | 57 | 9 returns, 3 repeated priority loops | `_strong_event_in` helper (CL-PY-15) |
| 9 | `web.py:settings_page` (447-495) in create_app | 49 | View building mixed with state mutation | `sign_ins.take_result`, `sync_runs.take_result`, `_providers_view(conn)` (CL-PY-2) |
| 10 | `joblink.py:parse_url` (85-132) and `derive` (704-749) | 48 / 46 | Validation as a long chain of `raise` guards; three nested fallbacks | `parse_url`: split into `_check_scheme_and_port`, `_normalise_host`, `_check_host_name` (the comments already mark these steps); `derive` per CL-PY-18 |

Also worth a look: `stats.sankey` (42-92, 51 lines: query, path building and layout in one body; split `_collect_stage_history(conn)`), `reply.send` (52-100, a linear list of guards: fine as is, but `_check_rate_limit(conn, now)` would shorten it by 8 lines), `index` in `web.py` (217-262, 46 lines).

## Strengths

- Module docstrings on the domain modules explain purpose, boundaries and trust model (`joblink.py`, `reply.py`, `learn.py`, `recheck.py`, `contacts.py`, `profiles.py`). `joblink.py` states its threat model up front, then fixed error messages, which makes 700 lines of defensive code readable.
- Error types are named and carry safe text (`ReplyError`, `ProfileError`, `ClientError`, `ActivityError`, `JobLinkError`), with docstrings saying "safe to show". That keeps user-facing messages visibly separate from internal exceptions.
- Names are domain-clear: `needs_review`, `apply_event`, `settle_review`, `find_application`, `unseen_matches`. Booleans mostly read as questions (`looks_like_a_person`, `is_ats_domain`, `_untouched`).
- Comments in `classify.py`, `match.py`, `reply.py` and `learn.py` explain the reason ("a learned block must never hide mail whose subject says it is about an application"), which is where a reader needs them.
- Thresholds in `learn.py` are named constants (`DISTRUST_MIN_FLAGS`, `DOMAIN_MIN_ADDRESSES`) and `settings.py` centralises choices, defaults and sanitising.
- Scripts have usable docstrings with commands to run (`build_rules_json.py`, `export_json.py`, `seed_demo.py`, `export_fixtures.py`), and `install-task.ps1` documents what it registers.
- Templates use partials with documented parameters (`_reply.html`, `_panel.html` header comments) and semantic, accessible markup.
- DESIGN.md is unusually specific (tokens, rules and rationale), and named rules ("The Outline Contrast Rule") make intent checkable.

## Files that most need attention

| File | Main issues | Findings |
|---|---|---|
| `jobtracker/web.py` | 761-line closure, dict state machines, duplicated parsing, builtin-shadowing params, no docstring | CL-PY-1, 2, 3, 13, 20, 21 |
| `jobtracker/templates/` (index, flow, base, settings, jobs, detail) | Inline CSS/JS, copy-paste, `<script>` in `<title>`, inline handlers | CL-PY-6, 7, 24 |
| `SETUP.md`, `PRODUCT.md`, `DESIGN.md`, `web/README.md` | Edition mix-up, cross-doc contradictions, stale hand-off tone | CL-PY-8, 9, 10 |
| `jobtracker/db.py` | Repeated migration block, schema drift | CL-PY-5 |
| `jobtracker/sync.py`, `recheck.py`, `reply.py`, `links.py` | Private cross-imports, hidden import cycle, stringly outcomes, duplicated recipient logic | CL-PY-3, 4, 14 |
| `jobtracker/contacts.py` | 71-line three-pass function | CL-PY-16 |
| `jobtracker/cli.py` | If-chain `main` | CL-PY-17 |
| `jobtracker/joblink.py` | Duplicated read loop, tangled `_slug_role` / `derive` | CL-PY-18 |
| `jobtracker/providers/base.py`, `gmail.py`, `outlook.py` | Stale protocol, duplicated helpers | CL-PY-3, 12 |
| `jobtracker/classify.py` | Triple priority loop, no docstring | CL-PY-11, 15 |
| `scripts/export_fixtures.py` | 877 lines, aliases `C/E/L/M/MA`, 135-line function | CL-PY-22 |
