# Dead-code scan: local Python edition (job-tracker, branch easy-connect)

Scope: `jobtracker/*.py`, `jobtracker/providers/*.py`, `jobtracker/templates/*.html`, `jobtracker/static`, `jobtracker/rules.yaml`, `scripts/*`, `tests/*`, `requirements.txt`, `SETUP.md`, secrets/data handling. `jobtracker/jobs/*` was read only to trace references into it.

The Python edition is in good shape. After a vulture pass, a custom AST reference counter and a coverage run, only a handful of genuinely dead items turned up. The biggest real findings are small: one dead DB helper, one dead constant, one dead fallback path, some dead CSS, and unused imports.

Risk legend: safe = no reference anywhere (including tests, templates, string dispatch). check first = no caller found, but an external or data-compat reason might exist. public-API-like = a deliberate seam, do not remove.

---

## Dead Code

### DC-PY-1  `db.open_applications` is never called
- File: `/Users/thorn.leung/job-tracker/jobtracker/db.py:300-306`
- Evidence: `grep -rn open_applications` over repo (jobtracker, tests, scripts, templates, web/) returns only the def. Zero test references. Vulture flags it. `match.find_application` computes the open set itself from `all_applications_for`.
- Recommendation: delete the function.
- Risk: safe. Size: 8 lines (7 plus a blank).

### DC-PY-2  `learn.EMPTY` constant is never referenced
- File: `/Users/thorn.leung/job-tracker/jobtracker/learn.py:44` (`EMPTY = Learned()`)
- Evidence: `grep -rnw EMPTY` returns only the definition (my AST counter reports 0 prod and 0 test references). Callers use `learn.load(conn)` or `Learned()` directly.
- Recommendation: delete the line.
- Risk: safe. Size: 2 lines.

### DC-PY-3  Unused imports (pyflakes)
- `/Users/thorn.leung/job-tracker/jobtracker/jobs_web.py:8`: `File`, `UploadFile` imported from fastapi. The resume route reads `request.form()` instead (`Form` is used, the other two are not).
- `/Users/thorn.leung/job-tracker/jobtracker/recheck.py:10`: `import re`. No `re.` use in the file.
- `/Users/thorn.leung/job-tracker/jobtracker/providers/outlook.py:3`: `import json`. No `json.` use in the file.
- Evidence: `pyflakes jobtracker scripts tests`.
- Recommendation: remove. Risk: safe. Size: 3 lines touched (2 deleted, 1 trimmed).

### DC-PY-4  `"stages"` key in `_panel_ctx` is never read by `_panel.html`
- File: `/Users/thorn.leung/job-tracker/jobtracker/web.py:132` (`"stages": STAGES`)
- Evidence: `_panel.html` reads only `p.a, p.r, p.entries, p.total, p.error, p.form, p.today, p.swaps, p.counts, p.include_emails, p.status, p.step_groups, p.latest_email, p.titles`. `grep -c "p\.stages"` is 0 in `_panel.html`, `detail.html` and `index.html`. The `stages` that `detail.html` uses is the top-level key passed by the detail route, not `p.stages`. No test reads it.
- Recommendation: drop the key from the dict.
- Risk: safe. Size: 1 fragment.

### DC-PY-5  Dead CSS in templates
- `.person-name` rule: `/Users/thorn.leung/job-tracker/jobtracker/templates/base.html:356`. No markup, JS string or Python emits `person-name` (`_person.html` uses `person-head`, `person-title`, `person-meta`).
- `.scroll-x` rules (4 lines): `/Users/thorn.leung/job-tracker/jobtracker/templates/settings.html:50-53`. `grep scroll-x` finds only these selectors, no `class="..scroll-x.."`.
- Unused CSS custom properties `--applied`, `--heard`, `--assess`, `--interview`: declared at `base.html:32-33`. `--offer` and `--rejected` ARE used, the other four have zero `var(--...)` uses in any template or Python.
- Evidence: scripted check of every `.class` selector and every `--var` in base.html and the page-local `<style>` blocks against all templates plus `*.py`. Result: 97 classes in base.html and 6 page-local style blocks, only these are unreferenced. `.sig`, `.mail-empty` and `.mail-fold` are emitted by `mailtext.py`. `.tag-step` and `.tag-note` are emitted dynamically by `_panel.html:73` (`tag-{{ i.kind }}`). Both are live.
- Recommendation: delete the rules and the four alias declarations.
- Risk: safe (note `tests/test_restyle.py` and `test_consistency.py` scan these templates, so run them after). Size: 5 lines deleted, 2 lines trimmed.

### DC-PY-6  Unused constants in `scripts/export_fixtures.py`
- File: `/Users/thorn.leung/job-tracker/scripts/export_fixtures.py:43-46`: `ZWNJ`, `LSQ`, `RSQ`, `LDQ`, `RDQ`, `BULLET`, `EACUTE` are assigned and never used (vulture; `grep -w` confirms only the assignment).
- Caveat: the file's own corpus uses literal characters or escapes elsewhere, and the golden file `web/tests/fixtures/pipeline-golden.json` is regenerated from it. I ran `python scripts/export_fixtures.py --check`, which printed "fixtures up to date". Removing unused names cannot change output, but re-run `--check` after.
- Recommendation: delete line 44 whole, trim the names from 43, 45 and 46.
- Risk: safe. Size: 1 line deleted, 3 trimmed.

### DC-PY-7  `sync._default_provider` and the `get_provider=None` fallback are never exercised
- File: `/Users/thorn.leung/job-tracker/jobtracker/sync.py:135` and `:206-209`
- Evidence: every caller of `sync_all` and `sync_account` passes `get_provider` (`web.py:690`, `cli.py:82`, and all 7 test call sites). Coverage shows lines 207-209 never run. The fallback also ignores the profile (`get_provider(name, address)` with no `profile=`), so if it were ever reached it would read the default profile's tokens for any profile. That makes it a latent bug as well as dead code.
- Recommendation: make `get_provider` a required argument, or have the fallback delegate with a profile, and delete `_default_provider`.
- Risk: check first (signature change to `sync_all`/`sync_account`; no external callers found). Size: about 5 lines.

### DC-PY-8  Write-only DB columns (informational; do not remove)
- `notifications.posting_ids`: written at `jobs/notify.py:49`, selected nowhere. `grep -rn posting_ids` outside db.py: only that insert.
- `sent_replies.reply_to_email_id`: written at `reply.py:83`, read only by `tests/test_send.py:74`.
- `ignored_mail.reason`: written at `sync.py:29`, never read from `ignored_mail` (`learn._reason` reads `emails.reason`, a different column; `review.html` does not show it).
- Evidence: grep of column names across jobtracker, templates, tests, scripts, and `web/src` (the hosted edition's importer does not read them either).
- Recommendation: leave. They are cheap audit data and dropping a column needs a migration. If you want a clean schema, stop writing them first, then drop later.
- Risk: check first. Size: 0 lines now.

### DC-PY-9  Migration branches for columns that `SCHEMA` already creates
- File: `/Users/thorn.leung/job-tracker/jobtracker/db.py:208-209, 218-223` (`web_link`, `active`, `can_reply`, `url` on `emails`, `accounts`, `applications`).
- Evidence: all four columns are in the `CREATE TABLE` statements at db.py:16-19, 34, 51, so they matter only for a `tracker.db` created before those columns were added. The `bulk` (emails and ignored_mail), `hold` and `reason` migrations are NOT redundant, because those columns are missing from `SCHEMA` (see DC-PY-11).
- Cannot be proven dead statically: your real `data\tracker.db` on the Windows PC is not in this checkout (only `data/demo.db`). If that DB already has all four columns, the four branches can go.
- Recommendation: check the PC's DB with `PRAGMA table_info`, then delete the four checks (or keep them as cheap insurance).
- Risk: check first. Size: 8 lines.

---

## Refactoring Opportunities

### DC-PY-10  `_is_bulk(headers)` is duplicated verbatim in both providers
- Files: `/Users/thorn.leung/job-tracker/jobtracker/providers/gmail.py:~186` and `/Users/thorn.leung/job-tracker/jobtracker/providers/outlook.py:~121` (same body: `list-unsubscribe` / `list-id` / `precedence in bulk, list, junk`).
- Proposed: one `is_bulk(headers)` in `providers/base.py` (next to `html_to_text`). Saves about 4 lines and removes drift risk (a change to the header list in one provider would silently not apply to the other).
- Risk: safe.

### DC-PY-11  `db.connect` migrations: eight near-identical `PRAGMA table_info` blocks, and `SCHEMA` is behind the migrations
- File: `/Users/thorn.leung/job-tracker/jobtracker/db.py:206-223`
- Current state: each of 8 columns re-runs `PRAGMA table_info`. Fresh databases get `bulk`, `hold` and `reason` only through the ALTER path because they are absent from `SCHEMA`.
- Proposed: a `_ensure_column(conn, table, column, ddl)` helper called from a list, and add `bulk/hold/reason` to the `CREATE TABLE` text. Saves about 10 lines and makes `SCHEMA` the true schema.
- Risk: check first (touches every DB open; the existing suite covers it well, coverage 96% for db.py).

### DC-PY-12  Token-directory logic exists twice
- Files: `/Users/thorn.leung/job-tracker/jobtracker/profiles.py` (`Profiles.token_dir`, `secrets_dir` property) and `/Users/thorn.leung/job-tracker/jobtracker/providers/base.py:46-48` (`token_dir`).
- Evidence: `Profiles.token_dir` is called only by `Profiles.delete` and `tests/test_profiles.py:67-115`. `base.token_dir` is what sign-in and token persistence use. The two answer the same question and honour different roots (injected `secrets_dir` vs `config.SECRETS_DIR`). If someone injects a different `secrets_dir`, delete would remove a different folder than the tokens were written to.
- Proposed: make `Profiles.token_dir` delegate to one function. Risk: check first.

### DC-PY-13  Duplicated constants
- `web.STAGES` (`web.py:29`) is the same list, same order, as `db.STAGES` (`db.py:180`, already used by `activity.py` and `stats.py`). Use `STAGES = db.STAGES`.
- `web.PERIODS` values `[0, 30, 90, 180]` duplicate `settings.FLOW_PERIODS` (`settings.py:25`), which is what validates `flow_days`. If one changes alone the dropdown and the validator disagree.
- Risk: safe. Size: about 2 lines.

### DC-PY-14  Reply-address rules duplicated, and a private name imported across modules
- Files: `/Users/thorn.leung/job-tracker/jobtracker/links.py` (`reply_link`, lines 28-48) and `/Users/thorn.leung/job-tracker/jobtracker/reply.py:19-37` (`recipient`).
- Both implement "valid address and not no-reply". `reply.py` imports the underscore-private `_ADDRESS` and `_NO_REPLY` from `links`. Proposed: move `recipient()` into `links.py`, have `reply_link` call it, and drop the private-name import. Risk: safe. Saves about 3 lines.

### DC-PY-15  ISO timestamp parsing and Message rebuild repeated
- `datetime.strptime(x, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=utc)` at `sync.py:140`, `web.py:100`, `web.py:369`, `recheck.py:26`. `db.iso` is the writer, there is no matching reader.
- `web.py:367-370` (`ignored_is_real`) rebuilds a `Message` from a stored row by hand, almost the same as `recheck._message` (which lacks `web_link`).
- Proposed: add `db.parse_iso`, give `recheck._message` an optional `web_link` and reuse it in the route. Saves about 6 lines. Risk: safe.

### DC-PY-16  `Provider` Protocol has drifted from the implementations
- File: `/Users/thorn.leung/job-tracker/jobtracker/providers/base.py:13-31`
- The Protocol declares `connect(self) -> str` but both providers take `connect(send=False)`, and `send_reply(...)` (called by `reply.py:88`) is not declared. Gmail's `oldest_first`, `on_wait`, `pending` are probed with `getattr`/`hasattr` in `sync.py:145-157` and also undeclared. The Protocol is only used as a return annotation, so nothing enforces it.
- Proposed: update it to match, or delete it. Risk: safe.

### DC-PY-17  Statements that are provably stale after the reply feature
- `/Users/thorn.leung/job-tracker/jobtracker/links.py:31` docstring: "The app never sends mail (it only has permission to read)".
- `/Users/thorn.leung/job-tracker/SETUP.md:3`: "Both accounts are read-only: the app can read mail but not send".
- `/Users/thorn.leung/job-tracker/jobtracker/cli.py:26`: `connect` help says "(read-only)". The `connect` CLI does not offer send, so this one is true for the CLI path only. Reword to say reading only.
- `/Users/thorn.leung/job-tracker/tests/test_reply.py:1` docstring ("since the app only reads").
- `PRODUCT.md:13` already states it correctly ("read-only by default; sending is an opt-in per account"), so use that wording.
- Doc-only change. Risk: safe.

### DC-PY-18  Scripts ignore `--help`, and one writes into the repo
- `/Users/thorn.leung/job-tracker/scripts/build_rules_json.py:67-81`: `main()` parses no arguments, so `--help` runs the generator and overwrites `web/src/pipeline/rules.json` and `unicodeTables.ts`. I hit this during the scan (see Verification log). Output was byte-identical, so git shows no diff.
- `/Users/thorn.leung/job-tracker/scripts/export_json.py:36`: treats `--help` as a database path and prints "No database at --help".
- Proposed: add argparse (plus a `--check` mode for build_rules_json, matching `export_fixtures.py`). Risk: safe.
- All scripts still work. `export_fixtures.py --check` passes ("fixtures up to date"). `export_json.py data/demo.db <scratch>` wrote 38 applications, 79 emails. `seed_demo.py` and `install-task.ps1` were read, not run (they write to `data/` and register Windows tasks). Both are referenced from SETUP.md.

### DC-PY-19  `requirements.txt` mixes runtime and test-only packages
- `pytest` and `httpx` are used only by tests (`httpx` is needed only by `fastapi.testclient`; `grep httpx` finds no import in jobtracker). All other entries are imported: fastapi, uvicorn (cli), jinja2 (via `Jinja2Templates`, not a direct import), python-multipart (needed by `Form`/`request.form()`), pyyaml, requests, msal, msal-extensions, google-auth, google-auth-oauthlib, google-api-python-client, beautifulsoup4, pypdf and python-docx (`jobs/resume.py`), windows-toasts (`jobs/notify.py`). No entry is dead. Entries are unpinned (a reproducibility concern, not dead code).
- Proposed: optional `requirements-dev.txt`. Risk: safe.

---

## Test Cleanup

### DC-PY-20  Unused test helper `only_app`
- `/Users/thorn.leung/job-tracker/tests/test_learning.py:45-47`. `grep -rnw only_app tests` returns only the def. Delete. Risk: safe. Size: 4 lines (3 plus a blank).

### DC-PY-21  Unused imports and locals in tests
- `tests/test_reply.py:3` `datetime`, `timezone`. `tests/test_third_review.py:2` `logging`.
- Unused locals: `tests/test_gmail_quota.py:143` (`acct =`), `tests/test_send.py:117` (`ordinary =`).
- Evidence: pyflakes. Risk: safe. Size: 2 lines deleted, 2 assignments trimmed.

### DC-PY-22  Two parametrized tests with identical bodies
- `/Users/thorn.leung/job-tracker/tests/test_joblink.py:107-126`: `test_bad_schemes_credentials_and_junk_are_refused` and `test_only_ports_80_and_443` have the same body (`Net().derive(url)` raises `JobLinkError`, nothing connected). They differ only in the URL list.
- Recommendation: merge into one parametrized test (optional, cases stay). Risk: safe. Saves about 7 lines.

### DC-PY-23  Test imports a helper from another test module
- `/Users/thorn.leung/job-tracker/tests/test_restyle.py` does `from tests.test_pipeline import mk`, which is why `tests/__init__.py` must exist. Move `mk` to `conftest.py` or a `tests/helpers.py`. No line savings; reduces coupling.

### DC-PY-24  Files named after review rounds
- `tests/test_second_review.py`, `test_third_review.py`, `test_fourth_review.py`, `test_review_fixes.py` are grab-bags of regression tests named for when they were written. No duplicated test names across files (checked), and no test I could find exercises removed functionality, so nothing to delete. Relocating each test next to its topic file would make them findable. Optional, no line change. One low-value guard: `tests/test_settings.py:63` asserts a removed `filters` setting no longer exists (keep or drop).

### Verified NOT dead (false alarms to ignore)
- `jobtracker/templates/_last_cell.html` and `_stage_cell.html` are NOT empty. They are single-line files with no trailing newline (245 and 144 bytes; `wc -l` prints 0). They are included from `_panel.html:109-110` and `index.html:89,91`.
- All 37 FastAPI routes (`web.py`) plus 12 in `jobs_web.py` are reachable. Vulture "unused function" hits for them are decorator registrations. Every route has a form, link, fetch or script in a template (checked each path).
- All Jinja globals and filters (`mailbox_link`, `reply_link`, `new_token`, `source_label`, `safe_url`, `posting_url`, `mailtext`, `sender_name`, `sender_addr`) are used in templates.
- `app.state.connect_thread` / `sync_thread` (`web.py:146,149,581,726`) look unused to vulture but are test seams joined by 14 test call sites. Keep (public-API-like).
- `db.row_factory`, `notify.launch_action` (windows-toasts API), `scripts/export_fixtures.py:646 ck` (lambda parameter) are vulture false positives.
- Every key in `rules.yaml` (`ats_domains`, `exclude_sender`, `exclude_subject`, `bulk_markers`, `job_context`, `reply_context`, `negated_offer_sentences`, `conditional_sentences`, `events.*.strong/weak`) is read in `classify.py`. No unused keys.
- Every key in `settings.DEFAULTS` is read outside settings.py (appearance, sync and all profile fields; checked per key).
- Static assets: `Figtree-latin-wght.woff2` is referenced by `base.html:12`. `LICENSES.md` ships with it. The same font also exists in `web/src/assets/fonts/` (byte-identical, `cmp`); that is the hosted edition's own copy and is not this area's dead code. `data/` and `secrets/` are git-ignored; the `.gitignore` entries `token*.json` and `client_secret*.json` match no file this app writes (it writes `*.token`, `gmail_client.json`, `outlook_client.json`), but they are harmless defensive patterns.
- Profiles (`profiles.py`, `/profiles/*` routes) and reply sending (`reply.py`, `send_reply`) are live features reachable from the UI. No flag keeps them off, so they are not obsolete.
- No TODO/FIXME/HACK/XXX markers anywhere in `jobtracker`, `scripts` or `tests` (the "no longer" hits are prose). No commented-out code found (regex scan for commented `import/def/return/if/for/assign`).

---

## Verification log

Run (all from `/Users/thorn.leung/job-tracker`, scratchpad venv, `PYTHONDONTWRITEBYTECODE=1`):
1. `git ls-files` inventory. Scanned: 24 `jobtracker/*.py` files plus `providers/` (5) and `jobs/` (10, reference tracing only), 14 templates (3,500 lines incl. 480-line base.html), 4 scripts plus `install-task.ps1`, 36 test files (about 8,700 lines, 651 top-level defs, 884 collected tests), `requirements.txt`, `SETUP.md`, `rules.yaml` (144 lines), 1 font.
2. `vulture jobtracker scripts [tests] --min-confidence 60`, with and without tests. Every hit cross-checked by hand (routes, test seams and false positives listed above).
3. Custom AST script: every top-level def, class and constant in `jobtracker/**/*.py`, and every nested def or method, counted word-boundary references across prod, tests, scripts and templates. Result: only `open_applications` and `EMPTY` have zero references outside their own definition; nothing is test-only.
4. `pyflakes jobtracker scripts tests` for unused imports and locals.
5. Template checks: every key passed to every `TemplateResponse` and `_panel_ctx` checked for use in its target template using look-behind-aware greps (not just `-w`, which false-matches `p.x`); every `{% include %}` / `{% extends %}` target exists and is included; no `{% macro %}` exists; CSS classes and custom properties from `base.html` and the page-local style blocks checked against all markup and `*.py`.
6. `pytest -p no:cacheprovider` under `coverage` (data file in scratchpad): 877 passed, 7 failed. The 7 failures are the expected Windows-only ones (`ctypes.windll`/msal-extensions DPAPI, toast, localisation script). Total statement coverage 93% (3,689 stmts, 250 missed). I reviewed every uncovered line in the non-jobs modules. All are defensive branches or CLI/provider paths, except the dead `_default_provider` (DC-PY-7) and `open_applications` (DC-PY-1).
7. Scripts: `export_fixtures.py --check` OK. `export_json.py data/demo.db <scratchpad>/out.json` OK. `build_rules_json.py --help` actually RAN the generator and rewrote `web/src/pipeline/rules.json` and `unicodeTables.ts` in the repo (the script has no argument parsing). `git status` and `git diff --stat` afterwards show no change (identical bytes; only mtimes moved). Flagging this openly: it was an unintended write to repo files, content-neutral. No other repo file was touched; `.pytest_cache`, `__pycache__` and `data/` are pre-existing and git-ignored. The only untracked entry is the pre-existing `.claude/` (it holds 4 stale agent worktrees under `.claude/worktrees/`, which are not in `.gitignore` and double every grep hit; consider ignoring or pruning them).
8. Not verified by running: `windows-toasts` toast path, DPAPI token persistence, Gmail/Outlook OAuth, and `install-task.ps1`. Judged by reading only. The task script looks consistent with the CLI (`-m jobtracker sync` and `serve`, `.venv\Scripts\pythonw.exe` as in SETUP.md).

Uncertainty: static counting by name can be fooled by shared names, so a function with a common name could look used when it is not. The AST pass flagged none, but it cannot catch a function whose only caller is another dead function (none seen in the files I read in full: `web.py`, `db.py`, `settings.py`, `sync.py`, `reply.py`, `links.py`, `profiles.py`, `cli.py`, `stats.py`, `match.py`, providers). `joblink.py` (759 lines), `contacts.py`, `mailtext.py`, `extract.py` and `activity.py` were checked by reference count and coverage, not read line by line.

---

## Cleanup plan (safe first)

Step 1, safe, no behaviour change, one commit:
- DC-PY-1 `db.open_applications` (8 lines)
- DC-PY-2 `learn.EMPTY` (2)
- DC-PY-3 unused imports (2 deleted, 1 trimmed)
- DC-PY-4 `"stages"` key in `_panel_ctx` (trim)
- DC-PY-5 dead CSS (5 deleted, 2 trimmed)
- DC-PY-6 unused constants in `export_fixtures.py` (1 deleted, 3 trimmed)
- DC-PY-20, DC-PY-21 test helper and imports (6 lines)
- Then run: `pytest -q` (expect the same 7 Windows-only failures) and `python scripts/export_fixtures.py --check`.
Step 1 total: about 24 lines deleted plus about 9 trims.

Step 2, safe refactors (about 15 lines net): DC-PY-10, 13, 14, 15, 16, 17, 18, 19, 22, 23.

Step 3, check first: DC-PY-7 (make `get_provider` required, about 5 lines), DC-PY-9 (4 migration branches, 8 lines, after checking the PC's real DB), DC-PY-11 and DC-PY-12 (consolidation), DC-PY-8 (leave).

Totals:
- Findings: 24 (9 dead code, 10 refactoring, 5 test cleanup) plus a verified-not-dead list.
- Removable lines: about 24 now (Step 1); about 37 more with Steps 2 and 3 (about 61 in all), mostly de-duplication.
