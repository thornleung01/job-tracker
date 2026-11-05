# Validation: test quality, dead code, docs findings

Repo: /Users/thorn.leung/job-tracker, branch easy-connect. All runs were done in an APFS clone at
/private/tmp/claude-502/-Users-thorn-leung/c9e35028-bd31-40d3-a1cd-3f723d21e55b/scratchpad/validate/repo
(the real repo was not touched; `git status` there shows only the untracked `.claude/` and `.coverage` that existed before).
Python: venv python 3.14.4. Vitest 3.2.7.

Note: `/Users/thorn.leung/job-tracker/.claude/worktrees/*` holds four stale copies of the Python tree. Every grep below
for the main repo excludes them (otherwise `open_applications` shows 5 hits instead of 1).

---

## TQ-1 CI only gates deploys on push to main -- CONFIRMED

Evidence: `/Users/thorn.leung/job-tracker/.github/workflows/pages.yml:3-7` (only workflow in the repo; `ls .github/workflows` = `pages.yml`):

```yaml
on:
  push:
    branches: [main]
    paths: ["web/**", ".github/workflows/pages.yml"]
  workflow_dispatch:
```

- No `pull_request` trigger. `npm test` runs at line 28 inside the `build` job, so a red web test is found only after merge (it blocks the deploy, not the merge).
- No pytest, no `setup-python`, no `pip` anywhere in the file.
- `paths` ignores `jobtracker/**`, `scripts/**`, `tests/**`, `requirements.txt`. A change to `jobtracker/rules.yaml` does not run `web/tests/pipeline/rules-sync.test.ts`, which reads it (`rules-sync.test.ts:12`: `new URL("../../../jobtracker/rules.yaml", import.meta.url)`), so the TS/Python drift guard never fires for that change.
- `scripts/export_fixtures.py --check` exists (`export_fixtures.py:4`, `:856`) and is referenced by nothing: `grep -rn "export_fixtures\|--check" web/package.json .github web/vite.config.ts` returns no hits.
- `scripts/build_rules_json.py` has no `--check` (no argparse or sys.argv in it).

Correction to the reviewer's recommended change: do NOT just add `pull_request` to pages.yml. The workflow has
`concurrency: group: pages, cancel-in-progress: true` (lines 15-17). A PR run would share the `pages` group and cancel an
in-flight deploy from main. Also the workflow-level `pages: write` / `id-token: write` would be requested on PR runs.
Put the checks in a separate workflow.

Exact YAML I would add (NOT written to the repo; the assistant's token cannot push workflow files, so the owner pushes it).
New file `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  web:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: web } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: web/package-lock.json }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
  python:
    runs-on: windows-latest          # the local edition is Windows-only (DPAPI); see TQ-3
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.14", cache: pip }
      - run: pip install -r requirements.txt
      - run: python -m pytest -q
      - run: python scripts/export_fixtures.py --check
```

Leave pages.yml as is, except optionally widening its `paths` to include `jobtracker/**` and `scripts/**` so a rules.yaml
change redeploys behind a passing `rules-sync` test. I did not run the python job on Windows, so I cannot claim it is green there.

---

## TQ-2 Real MSAL client config never executed by a test -- CONFIRMED

Evidence:
- `/Users/thorn.leung/job-tracker/web/src/auth/microsoft.ts:32-47`: `createMsalClient` holds `cache: { cacheLocation: "memoryStorage", temporaryCacheLocation: "memoryStorage" }` (line 43).
- `grep -rn "createMsalClient\|msal-browser\|vi.mock" web/tests` finds nothing for MSAL (only an unrelated `vi.mock` in `row-memo.test.ts:7`). `tests/auth/microsoft.test.ts:8-37` builds `fake: MsalLike` with `vi.fn` and passes `createClient = vi.fn(async () => fake)`; errors are `Object.assign(new Error("interaction_required"), { name: "InteractionRequiredAuthError", errorCode })` (line 10). So every test injects a fake.
- Real-library scratch test (`repo/web/tests/auth/msal-real.test.ts` in the clone): `await createMsalClient({clientId, authority, redirectUri})`, `expect(localStorage.length + sessionStorage.length).toBe(0)`, `clearCache()`, same assertion; plus `new InteractionRequiredAuthError("interaction_required","x")` name/errorCode and `new BrowserAuthError("user_cancelled").errorCode`.

  Result, unmodified source: `✓ tests/auth/msal-real.test.ts (2 tests)` in jsdom (vitest config `environment: "jsdom"`, MSAL 4.30.0). The claim that it passes in jsdom is true.
- Mutation check (the part that matters): in the clone I replaced line 43 with `cache: { cacheLocation: "localStorage" }` and ran `microsoft.test.ts`, `auth.test.ts` and the new test:

  ```
  ✓ tests/auth/auth.test.ts (42 tests)
  × real msal > builds the real client and leaves web storage empty   → expected 1 to be +0
  ✓ real msal > real error classes
  ✓ tests/auth/microsoft.test.ts (26 tests)
  Tests  1 failed | 69 passed (70)
  ```
  So the 68 existing tests stay green when the in-memory guarantee is broken; only the new real-library test goes red.

Minimal fix: add `web/tests/auth/msal-real.test.ts` (the scratch file, about 20 lines) asserting empty web storage after `createMsalClient` + `clearCache`. Optionally add the error-class checks.

---

## TQ-3 Python suite red off Windows; requirements.txt lacks pytest and httpx -- PARTLY CONFIRMED

First half CONFIRMED. `python -m pytest -q` on macOS: `7 failed, 877 passed` (884 total, matches the report). All 7 fail with
`AttributeError: module 'ctypes' has no attribute 'windll'` (msal_extensions/windows.py `_LOCAL_FREE = ctypes.windll.kernel32.LocalFree`), reached via `jobtracker/providers/base.py:51-57` `token_persistence` -> `FilePersistenceWithDataProtection`. Failing tests:
test_contacts (`/jobs-/jobs`), test_jobs_core x2, test_profiles x2, test_reply (`localises_times`), test_third_review (`broken_company_source`). `grep -n "skipif\|win32" tests/*.py` has no hits.

Second half REJECTED. `/Users/thorn.leung/job-tracker/requirements.txt` (tracked, unchanged since the first commit edab317; `git show HEAD:requirements.txt`) ends with:
```
windows-toasts
pytest
httpx
```
Both are declared (lines 16-17 of 17). `pip list` in the venv: `pytest 9.2.0`, `httpx 0.28.1`, `msal 1.39.0`, `msal-extensions 1.3.1`, `starlette 1.10.0`. The only true residue is "pins nothing" (no versions) and that test tools share the runtime file. SETUP.md also never says to `pip install -r requirements.txt` (that is DOC-5).

The reviewer's suggested fix does not work as written. Callers import the name directly (`from .base import token_persistence` in `providers/gmail.py:14`, `providers/outlook.py:13`, `jobs/adzuna.py:9`), so an autouse fixture patching only `jobtracker.providers.base.token_persistence` leaves the callers using the real one. I tested both in the clone:
- patch only `jobtracker.providers.base.token_persistence` -> `7 failed, 877 passed` (no change).
- patch it in all four modules (`providers.base`, `providers.gmail`, `providers.outlook`, `jobs.adzuna`) with a `msal_extensions.FilePersistence(str(base.token_dir(profile)/filename))` fake, under `sys.platform != "win32"` -> `884 passed`.

Minimal fix: autouse fixture in `tests/conftest.py` that patches `token_persistence` at those four import sites on non-Windows (about 12 lines, verified), or better, make `base.token_persistence` itself return `FilePersistence` when `sys.platform != "win32"` (one change, all callers). The `requirements-dev.txt` part of the reviewer's fix is not needed (pytest and httpx are already listed).

---

## TQ-4 Two quickedit tests burn 16 s on the real 8 s timer -- CONFIRMED

Run: `npx vitest run tests/pages/applications/quickedit.test.ts --reporter=verbose` (file alone):
```
✓ ... > changes the stage from the dropdown and locks it 8111ms
✓ ... > keeps the stage select focused after a change 8114ms
(the other 7 tests: 146-195 ms each)
Tests 9 passed (9)   Duration 18.08s (tests 17.38s)
```
Tests: `/Users/thorn.leung/job-tracker/web/tests/pages/applications/quickedit.test.ts:39-48` and `:94-102`. Both do `await waitFor(() => text(row(container, "Acme")).includes("set by you"))`.
Cause: `web/src/components/quickedit/QuickStage.tsx:25` `const UNDO_MS = 8000;` and `:40` `timer.current = setTimeout(() => setBefore(null), UNDO_MS);`; line 62 renders Undo while `before` is set and "set by you" only once it clears. (The reviewer's 8,106/8,282 ms match my 8,111/8,114.)

Minimal fix: in both tests drop the "set by you" wait; assert on the DB row (`stage`, `locked`) and that the "Undo" button is present, and wait for that instead. Add one fake-timer test for expiry if wanted.

---

## DC-WEB-10 Production code reachable only from tests -- CONFIRMED (factually); one of the six needs a product decision

Commands: `grep -rnw "<name>" src` and `grep -rnw "<name>" tests`; also `public index.html vite.config.ts ../scripts README.md` (zero hits for any of them).

| symbol | src hits | test files / refs |
|---|---|---|
| `addNote` | 1 (definition, `src/sync/activity.ts:59`) | 4 files / 16 refs (carryover, portability, activity, settle) |
| `syncAll` | 1 (`src/sync/sync.ts:227`) | 1 file (syncAccount.test.ts) / 3 refs |
| `dayLabel` | 1 (`src/sync/upcoming.ts:56`, `= dayWhen(day, today).text`) | 1 file (upcoming.test.ts) / 4 refs |
| `cleanMailText` | 1 definition (`src/pipeline/mailtext.ts:199`) + a mention in `src/pipeline/PARITY_NOTES.md:45` | 1 file (mailtext.test.ts) / 5 refs |
| `openApplications` | 1 (`src/db/repo.ts:128`) | 1 file (db.test.ts) / 2 refs (import + one call) |
| `Auth.currentUser` | interface `src/auth/index.ts:50`, impl `:243`, AND a module-level wrapper `export const currentUser` at `:273` | 4 refs, all `auth.currentUser()` in `tests/auth/auth.test.ts:51,60,66,450` |

Extra finding: the report misses that the module-level wrapper `export const currentUser = () => auth().currentUser()` (`auth/index.ts:273`) is also unimported (`grep -rn currentUser src` = exactly those 3 lines), so it goes too.
`syncAll` is not dead by intent only in the sense that `syncAccount` per account (`pages/settings/actions.ts:106`) replaced it. `ApplicationPanel.tsx:5` imports only `STEP_GROUPS, addStep, deleteEntry, history`.

Caveat on `addNote`: `PRODUCT.md:10,26` still promises that rows "expand in place to log notes and dated steps", but the UI has no note input and `addNote` has no caller. Either the doc is stale or a notes box was dropped; decide before deleting. `history()` still renders imported `kind: "note"` rows, so keep that.

Minimal fix: delete the six (about 46 production lines), switch the tests to the real paths (seed notes with `db.activity.add`, loop `syncAccount`, assert `dayWhen(...).text`, `db.applications.where("companyKey")`, `getSession().user`), and drop `PARITY_NOTES.md:45` if `cleanMailText` goes.

---

## DC-WEB-13 Google ID-token leftovers -- PARTLY CONFIRMED

Callers: `grep -rnE "validateIdToken|decodeJwt|azp|id_token|IdTokenClaims" src` -> the only caller of `validateIdToken` is `src/auth/microsoft.ts:141` (issuers `[MICROSOFT_ISSUER]`); `src/auth/index.ts:11` re-exports it; `google.ts` does not use it (its header `google.ts:1-3` says it uses tokeninfo).

1. `azp` branch, `src/auth/idToken.ts:100-102` (`if (audiences.length > 1 && azp !== opts.audience) throw ...`): not reachable for Microsoft in practice (a Microsoft v2 ID token has a single string `aud`), so no production input hits it. BUT it is not a Google leftover: it is the generic OIDC Core 3.1.3.7 multiple-audience rule in a small hand-written validator, and the file has no signature check (`idToken.ts:3-7`), so it is a cheap defence in depth. Not dead code in the "removable with no loss" sense. I could not prove anything about a tenant token from the repo.
   - Do not confuse with `google.ts:115,193` `azp` in the tokeninfo check and `tests/auth/google.test.ts:157-170`; those are live.
2. Google fixtures in tests: CONFIRMED as Google-shaped. `tests/auth/idToken.test.ts:5` `GOOGLE_ISSUERS` (commented "generic fixture: Google-shaped claims"), `googleClaims()` at `tests/auth/helpers.ts:19` is imported only by `idToken.test.ts` (and used in about 17 places there). These exercise the real validator, so they work but mislead; `msClaims`/`MICROSOFT_ISSUER` would test the shipped configuration (the Microsoft path is already covered in `microsoft.test.ts`).
3. `id_token` in the router regex, `src/app/router.ts:26`: `/[#&](code|error|state|id_token)=/`. CONFIRMED unreachable from the real flow: MSAL 4.30.0 popups use authorization code + PKCE (only `response_type: code` in msal-common Constants; `id_token` appears in msal-common/msal-browser only as a field of token-endpoint JSON bodies, never in a URL fragment). `isAuthPopupWindow` (`auth/index.ts:279`) already matches only `code|error|state`. Pinned by `tests/app/router.test.ts:45` (`"#id_token=a.b.c&state=1"`). It is a harmless routing guard, not a security control.

Minimal fix: (a) drop `id_token` from the regex and the router test case (1 line each); (b) re-point the idToken tests at `msClaims`/`MICROSOFT_ISSUER` and delete `googleClaims`; (c) leave the `azp` branch (or remove it only as a conscious decision to relax the OIDC check; then also drop `azp` from `IdTokenClaims`, line 38, and the test at `idToken.test.ts:38-42`).

---

## DC-WEB-1 Four zero-reference DB helpers -- CONFIRMED

`grep -rnE "(^|[^A-Za-z0-9_$])(name)([^A-Za-z0-9_]|$)" src tests` -> 1 hit each, all definitions:
`src/db/repo.ts:57` `emailsForApplication`, `repo.ts:100` `getApplication`, `repo.ts:173` `getContactEdit`, `src/db/time.ts:11` `parseIso`. Tests: 0 hits for each.
Verified by deleting all four in the clone: `tsc --noEmit` flags only `src/db/repo.ts(7,8): TS6133 'ContactEditRow' is declared but its value is never read` (tsconfig has `noUnusedLocals: true`, so `npm run build` would fail until that import is removed); with the import removed, nothing else breaks. I ran `npx vitest run` with the four deleted: `80 files, 1647 tests passed`.
Minimal fix: delete the four functions (15 lines) and the `type ContactEditRow,` import at `repo.ts:7`.

---

## DC-PY-1 `db.open_applications` zero references -- CONFIRMED

`grep -rnw open_applications . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=__pycache__ --exclude-dir=.claude` -> exactly 1 hit: `jobtracker/db.py:300` (the `def`). Zero in `jobtracker/`, `tests/`, `scripts/`, templates, `web/`. No `getattr`-style dynamic lookup found. (Including `.claude/worktrees` adds 4 identical stale definitions, no callers.)
Minimal fix: delete `jobtracker/db.py:300-306` (the 7-line function, plus a blank line). `match.find_application` uses `all_applications_for`.

---

## DC-PY-7 `sync._default_provider` / `get_provider=None` fallback never used -- CONFIRMED; the fallback WOULD ignore the profile

Code: `/Users/thorn.leung/job-tracker/jobtracker/sync.py:135` `get_provider = get_provider or _default_provider`; `:206-209`:
```python
def _default_provider(name: str, address: str):
    from .providers import get_provider
    return get_provider(name, address)
```
`providers/__init__.py:6` signature is `get_provider(name, address=None, profile="default")`, so the fallback always uses `profile="default"`.

Callers (`grep -rnE "sync_account\(|sync_all\(" jobtracker scripts tests --include='*.py'`):
- Production: `jobtracker/web.py:690` `sync_all(conn, scan or None, get_provider=provider_factory(pid), progress=report)`; `jobtracker/cli.py:82` `sync_all(conn, args.days, get_provider=lambda n, a, pid=pid: get_provider(n, a, profile=pid))`. `sync_all` passes through to `sync_account` (`sync.py:200`). No other callers.
- Tests: all 6 call sites (`test_providers.py:77`, `test_profiles.py:289`, `test_gmail_quota.py:146,150`, `test_third_review.py:82`, plus the 1 `sync_all`) pass an explicit `get_provider=`. `grep -rn _default_provider` = the def and line 135 only.
So the fallback is never taken. It is a latent bug trap: a future caller that forgets `get_provider` would silently read the default profile's tokens for a non-default profile, i.e. sync the wrong person's mailbox.
Minimal fix: make `get_provider` a required parameter in `sync_account`/`sync_all` (or keyword-only with no default), delete `_default_provider` and line 135 (about 6 lines). No test changes needed.

---

## DC-PY-5 Dead CSS -- CONFIRMED (with two caveats)

- `.person-name`: `jobtracker/templates/base.html:356`; `grep -rn "person-name" jobtracker web/src tests scripts` -> that line, the same dead rule in `web/src/styles/base.css:347`, and `web/tests/pages/detail/detail.test.ts:273` which uses the selector `".person-name, .person-head strong"` (the second alternative is what matches). No markup emits it.
- `.scroll-x`: `jobtracker/templates/settings.html:50-53` (4 rules). No `class="...scroll-x..."` anywhere in templates or `web/src`. Caveat: `tests/test_restyle.py:270` (`test_settings_accounts_table_lines_up_with_the_card_text`) asserts the literal CSS string `.scroll-x table.list th:first-child, ... { padding-left: 0; }` is in the rendered `/settings` HTML, so it pins dead CSS. Deleting the rules requires deleting that test with them.
- Aliases: `base.html:32-33` declares `--applied --heard --assess --interview --offer --rejected`. `grep -rn "var(--NAME)" jobtracker web/src tests`: applied 0, heard 0, assess 0, interview 0, offer 2, rejected 15. No dynamic `var(--${...})` construction found (the only `getPropertyValue` readers in `flow.html:254` and `exportPng.ts:45` read `--ink`, `--ink2`, `--viz-surface`). The same four aliases are declared in `web/src/styles/base.css:23-24`, also unused. (The report calls them "--stage aliases"; they are short aliases of `--stage-*-text`.)
Minimal fix: delete `.person-name` (both stylesheets), the four `.scroll-x` lines plus `test_restyle.py` test, and the four unused aliases (keep `--offer`, `--rejected`) in both `base.html` and `base.css`; keep the two stylesheets in step (`web/README.md` says so).

---

## DOC-18 SETUP.md "In production" vs web/README.md "Testing" -- CONFIRMED

Read both:
- `SETUP.md:17-20`: "OAuth consent screen ... User type External ... **Publish the app: set status to "In production".** While it's in *Testing*, Google expires the sign-in every ~7 days and syncing breaks." Step 4 (`:21`): "OAuth client ID -> **Desktop app**". Also `jobtracker/templates/settings.html:151` ("publish it to In production. Otherwise, your login expires weekly").
- `web/README.md:45-46`: "Create an OAuth client of type Web application ... Consent screen: External, status Testing. Add everyone you invite as a test user (up to 100). This list is the real access control." Also `web/src/pages/setup/SetupGuide.tsx:150` ("leave the publishing status on Testing").
- Why each is right: local edition uses `InstalledAppFlow` and `creds.refresh` (`jobtracker/providers/gmail.py:64-68,94`), so a Testing-mode refresh token expiring after about 7 days breaks it. Hosted edition uses a short-lived access token, no refresh token (`web/src/auth/google.ts:1-3`), and wants Testing for the allow-list.

Could one project satisfy both? A Desktop-app client and a Web client can sit side by side in one Google Cloud project (clients are per-project objects of different types), but the OAuth consent screen, and so its publishing status (Testing / In production), belongs to the project, not to a client. One project is either Testing or In production. So following both docs in the same project is a real contradiction: set it to In production and the hosted site stops having a test-user allow-list (anyone can attempt login, subject to Google's unverified-app limits; "This list is the real access control" becomes false); leave it in Testing and the local sign-in expires every 7 days. Keeping both working technically (one project, In production) loses the hosted edition's access control; keeping the hosted design (Testing) breaks the local edition weekly. The reviewer's advice of separate projects is the one that satisfies both docs. (I could not exercise the Google console from here; this is from the docs plus Google's documented project-level consent screen behaviour.)
Minimal fix: one sentence in each (the reviewer's proposed text is fine): SETUP.md under step 3 "If you also run the hosted edition, make its Google client in a separate Google Cloud project; the publishing status belongs to the project", and web/README.md under "Google Cloud" "Use a project of its own; Testing here is deliberate".

---

## DOC-5 SETUP.md commands need a .venv nothing creates; personal path; Windows-only/Python version not stated -- CONFIRMED

- `.venv` not created: `grep -rniE "venv|pip install|requirements"` (excluding node_modules, dist, .git, .claude) finds `.venv` only in SETUP.md (lines 8, 26, 47, 63-66), `.gitignore:1` and `scripts/install-task.ps1:8-9` (which `throw "Virtual environment not found at ..."` if it is missing). No `python -m venv`, no `pip install -r requirements.txt` anywhere in docs or scripts. `ls .venv` -> absent in the repo.
- Personal path: `SETUP.md:5` "All commands run from `C:\Users\thorn\job-tracker`."; `SETUP.md:3` "The app is built and tested. What's left is signing in to your mail." is hand-off-note tone.
- Windows-only is true but not stated as a requirement: DPAPI via `jobtracker/providers/base.py:51-57` (the same code that makes 7 tests fail on macOS), `windows-toasts` in requirements.txt, `scripts/install-task.ps1` (Register-ScheduledTask). SETUP.md only mentions Windows in passing ("signed in to Windows", "Windows pop-up", "your Windows user"), as does `PRODUCT.md:10`.
- Python version stated nowhere. The only evidence is that the golden fixtures were generated with `"python": "3.14.4"` (`web/tests/fixtures/pipeline-golden.json` meta) and `PARITY_NOTES.md:27` ("Python 3.14 ships Unicode 16"). I did not test older Pythons, so "needs 3.14" is a recommendation, not a verified floor; I ran the suite on 3.14.4 only.
Minimal fix: replace SETUP.md lines 1-9 with a short "Requires Windows 10/11 and Python 3.14 (what the tests are generated with)" paragraph plus a first block `py -3.14 -m venv .venv` / `.\.venv\Scripts\python.exe -m pip install -r requirements.txt`, and "run from the folder you cloned the repo into" instead of `C:\Users\thorn\...`.

---

## DOC-1 scripts/export_json.py names the wrong import menu path -- CONFIRMED (docstring); web/README.md is only loosely worded

Quote, `/Users/thorn.leung/job-tracker/scripts/export_json.py:6`: "Then sign in to the hosted app and choose Settings > Import from the local edition."
Real UI, `web/src/pages/settings/SettingsPage.tsx:483-498`: card heading `<h2>Your data</h2>`, a file-picker button labelled `Import data` (line 489, next to `Export data`, `Export CSV`), then a confirm dialog "Replace everything in this browser with {file} (from the local edition)? This can't be undone." with the button `Replace my data`. There is no "Import from the local edition" control (`grep -rn "Import from" web/src scripts web/README.md *.md` finds only the docstring). The hosted app says "log in" (web/README.md:69 "Continue with Google"), not "sign in".
`web/README.md:81` says "Settings, Your data, Import" which is close (the button is "Import data") and not wrong, but it omits that import replaces everything in the browser.
Minimal fix: docstring line 6 -> "Then log in to the hosted app, choose Settings, Your data, Import data, and pick the file. The app asks before it replaces what is in that browser." README line 81: "Import" -> "Import data", and add that the app asks before replacing everything in the browser.
