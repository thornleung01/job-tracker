# Test quality review: job-tracker, branch easy-connect (full codebase, read-only)

Area: `web/tests` (79 files, 1,645 tests, Vitest + jsdom + fake-indexeddb) and `tests/*.py` (30 files, 884 tests, pytest). Repo files were not edited. Experiments ran in a scratch copy at `/private/tmp/claude-502/-Users-thorn-leung/c9e35028-bd31-40d3-a1cd-3f723d21e55b/scratchpad/cov` (not in the repo).

## Summary

Overall this is a strong suite: behaviour-first, real IndexedDB (fake-indexeddb), real SQLite, almost no mocking of internals, strong auth/race tests, a golden-parity harness against the Python pipeline, and a bookmarklet test that exercises the production-minified code.

Measured with v8 coverage (installed in the scratch copy only):

| Suite | Result | Coverage |
|---|---|---|
| Vitest | 1645/1645 pass, about 20 s wall locally | 97.21% lines, 90.44% branches, 95.02% functions across `src/**` |
| pytest | 877 pass, 7 fail (the expected `ctypes.windll` failures), about 15 s | 93% of 3,689 statements |

Robustness experiments that were clean:
- All three timezones pass (details below).
- Three shuffled orders (`--sequence.shuffle`, seeds 1, 2, 3) pass.
- Shifting the clock forward 400 and 1,500 days passes.
- The full suite passes with 10 CPU burners plus 2 workers (74 s).
- No test makes an unmocked `fetch` call. I replaced global `fetch` with a logger; it was never hit.
- `tsc --noEmit` passes, and it includes `tests/`.
- `scripts/export_fixtures.py --check` reports "fixtures up to date".
- `rules.json` and `unicodeTables.ts` match what `scripts/build_rules_json.py` generates today. Python is 3.14.4, Unicode 16.0.0, the same as recorded in the golden meta.

The weaknesses are mostly around CI wiring, a few untested security claims (real MSAL config), fixtures with no regeneration path, real-timer waits, and a handful of vacuous or implementation-coupled tests.

Network probes (read-only, invalid tokens or nonexistent ids, `Origin: https://thornleung01.github.io`) were run with the sandbox disabled for those curl calls only. The CORS question in TQ-8 is answered from them.

---

## High

### TQ-1 CI is a deploy gate only, and does not cover Python or the shared Python artefacts
- Where: `.github/workflows/pages.yml:3-6`, `:25-35`
- Evidence:
  - The workflow triggers only on `push` to `main` with `paths: ["web/**", ".github/workflows/pages.yml"]`. There is no `pull_request` trigger, so a red test is discovered after merge (it blocks the deploy, not the merge).
  - Nothing runs pytest. `tests/*.py` has 884 tests and is not in CI at all.
  - A change to `jobtracker/rules.yaml`, `jobtracker/classify.py` and the like does not match `web/**`. The web golden parity (`web/tests/pipeline/parity.test.ts`) and `rules-sync.test.ts` that guard the TS port against those files therefore never run for such a change.
  - `scripts/export_fixtures.py --check` exists and works, but is wired nowhere (not in `npm test`, not in CI).
- Recommended change:
  - Add `pull_request` to the workflow.
  - Widen `paths` to include `jobtracker/**`, `scripts/**` and `tests/**`.
  - Add a second job, or a matrix leg, that runs `python scripts/export_fixtures.py --check`, a `--check` for `scripts/build_rules_json.py` (it has none today), and the pytest suite.
  - The pytest job should run on `windows-latest` (see TQ-3), or the 7 Windows-only tests should be skipped on Linux.

### TQ-2 The real MSAL client configuration, which carries the "tokens stay in memory" guarantee, is never executed by a test
- Where: `web/src/auth/microsoft.ts:32-47` (uncovered in the v8 report); `web/tests/auth/auth.test.ts:456-507`; `web/tests/auth/microsoft.test.ts:7-37`
- Evidence:
  - `createMsalClient` is where `cacheLocation: "memoryStorage"` and `temporaryCacheLocation: "memoryStorage"` are set. Every Microsoft test injects a hand-written `MsalLike`.
  - The "never writes a token to localStorage, sessionStorage…" test spies on `Storage.prototype.setItem` while using fakes. It proves the app code does not write tokens. It cannot prove MSAL itself does not.
  - Mutation by reasoning: delete or change those two cache lines (MSAL then defaults to `sessionStorage`, with account and token entries). No test fails.
  - MSAL error shapes are hand-built with `Object.assign(new Error(...), {errorCode})`, so an MSAL upgrade that changes `InteractionRequiredAuthError` would not be noticed.
  - I verified a real-library test is feasible. In the scratch copy, this passed in jsdom: `await createMsalClient({clientId, authority, redirectUri})`, then `expect(localStorage.length + sessionStorage.length).toBe(0)`. The same file instantiated the real `InteractionRequiredAuthError("interaction_required", ...)` and got `name === "InteractionRequiredAuthError"` and `errorCode === "interaction_required"`.
- Recommended change:
  - Add `tests/auth/msal-real.test.ts` that builds the real client and asserts web storage is empty, both after `initialize()` and after a faked `acquireTokenSilent`.
  - In the same file, feed the real `InteractionRequiredAuthError` and `BrowserAuthError("user_cancelled")` through `createMicrosoftAuth` so the error mapping is pinned to the library's real classes.

### TQ-3 The Python suite is red by default off Windows, and cannot be reproduced from `requirements.txt`
- Where: `tests/test_contacts.py` (`test_the_current_page_is_marked_in_the_navigation[/jobs-/jobs]`), `tests/test_jobs_core.py` (`test_discovery_reads_feeds_notifies_and_records_errors`, `test_feeds_checked_recently_are_skipped_unless_forced`), `tests/test_profiles.py` (2 tests), `tests/test_reply.py::test_every_page_localises_times_once_in_the_shared_script`, `tests/test_third_review.py::test_a_broken_company_source_is_recorded_not_raised`; `requirements.txt`
- Evidence:
  - 7 failures, all `AttributeError: module 'ctypes' has no attribute 'windll'`, raised from `msal_extensions/windows.py` via `providers/base.py:51 token_persistence`.
  - These tests reach the real DPAPI-backed `FilePersistenceWithDataProtection` indirectly (page load, jobs discovery), and have no `skipif` or monkeypatch.
  - A suite that is permanently 7 red teaches people to ignore red, and hides regressions in jobs discovery and profiles (the areas those tests cover) on any non-Windows machine.
  - `requirements.txt` lists neither `pytest` nor `httpx` (needed by Starlette's `TestClient`), and pins nothing.
- Recommended change:
  - Add an autouse fixture in `tests/conftest.py` that monkeypatches `jobtracker.providers.base.token_persistence` to a plain-file fake (the module already isolates `SECRETS_DIR` there). Then the 7 tests pass everywhere, and one dedicated `@pytest.mark.skipif(sys.platform != "win32")` test covers the real DPAPI path.
  - Add `requirements-dev.txt` with `pytest` and `httpx`.

---

## Medium

### TQ-4 Two tests burn 16.4 s of real time waiting for the 8-second Undo timer
- Where: `web/tests/pages/applications/quickedit.test.ts:39-48` ("changes the stage from the dropdown and locks it", 8,106 ms) and `:94-102` ("keeps the stage select focused after a change", 8,282 ms)
- Evidence:
  - `QuickStage.tsx` shows an Undo button for `UNDO_MS = 8000`, and "set by you" appears only after it expires. Both tests `waitFor(... "set by you")`, so they sit out the real timer. They take exactly 8.1 s even when the file is run alone.
  - Together that is 18% of the 89.8 s of cumulative test time, and 16.4 of the 17.4 s this file takes.
  - Neither test is about the timer, so the wait is incidental. The same 8 s constant is already tested in `bulk.test.ts:379`, with a different technique (TQ-11).
- Recommended change:
  - Assert the stored result (`stage === "Interview"`, `locked === true`) and that Undo is shown, which is the real behaviour. Drop the "set by you" wait from those two tests.
  - Add one fake-timer test for the 8 s expiry that uses `vi.useFakeTimers({toFake:["setTimeout"]})` and `advanceTimersByTime(8000)`. Settings already does this at `settings.test.ts:432`.

### TQ-5 Other real-timer waits, and negative assertions that follow a fixed sleep
- Where:
  - `web/tests/pages/setup/setup.test.ts:245-268`: sleeps of 1000, 1200 and 1200 ms and a 2 s wait for the "Copied." note (the two slowest tests after TQ-4: 2.1 s and 2.6 s).
  - `web/tests/components/joblink/joblink.test.ts:152-172`: real 300 ms debounce, `sleep(PASTE_DEBOUNCE_MS/3)` then `not.toHaveBeenCalled()`.
  - `web/tests/pages/applications/duplicates.test.ts:10`: `DUPLICATES_DEBOUNCE_MS + 150` per pause.
  - `web/tests/settings/settings.test.ts:72,155,161,280`: `sleep(10..30)` inside `act`.
  - `web/tests/app/app.test.ts:32-36` and `web/tests/local/local.test.ts:33-37`: an identical `go()` helper with a fixed 30 ms.
  - `web/tests/pages/flow/page.test.ts:58,284`: 10 and 15 ms sleeps.
- Evidence:
  - A "not called yet" or "note is absent" assertion after a fixed sleep passes trivially when the machine is slow, or when the feature never fires. `duplicates.test.ts` "stays quiet for a different role…" (1.2 s) and "shows nothing for an empty form…" are of this kind.
  - Timers only fire late, never early, so these tests do not flake red. The harness adds its own late-timer heuristic (TQ-12) to cope, which is a sign the approach is fragile.
  - The suite did pass under 10 CPU burners (74 s), so this is a latent risk and a speed cost, not a current failure.
- Recommended change:
  - Use fake timers (`toFake: ["setTimeout"]`) and `advanceTimersByTimeAsync` for the 2 s clipboard note, both debounces and the 4 s toast. fake-indexeddb uses `setImmediate`, which stays real.
  - Replace `go()`'s sleep with `waitFor` on the route's heading, and share the helper from `tests/app/helpers.ts`.

### TQ-6 The real provider wiring is never exercised through the UI
- Where: `web/tests/components/syncbanner/syncbanner.test.ts:34-60`, `web/tests/settings/settings.test.ts:34-62`, `web/tests/settings/actions.test.ts`; source `web/src/providers/index.ts:11-17` (83% lines), `web/src/providers/headers.ts` (no direct test, 93%)
- Evidence:
  - `SyncBanner` and `SettingsView` always receive `createProvider: vi.fn(...)`. `src/providers/index.ts`, which `SyncBanner.tsx:14` and `SettingsPage.tsx:13` import, has its `createProvider` body (lines 12-13, the Gmail/Graph switch) never executed by any test; that is the uncovered 17% in the v8 report.
  - Real `createGmailProvider` and `createGraphProvider` are tested well in `providers/*.test.ts` with scripted `fetch`. Real `syncAccount` is tested with fake providers. The path UI to token source to real provider to scripted fetch to `processMessages` is never run.
  - `headers.ts` `decodeMimeWords` and `parseAddress` are ports of Python's `email.utils.parseaddr` and RFC 2047 decoding, with no parity golden (unlike the rest of the pipeline).
- Recommended change:
  - Add one integration test: mount `SyncBanner` with the real `createProvider`, `vi.stubGlobal("fetch", scriptedFetch(...))` returning a Gmail list and message JSON (helper already in `tests/providers/helpers.ts`), and assert applications appear.
  - Add `parseAddress` and `decodeMimeWords` cases to `scripts/export_fixtures.py` so they get Python golden parity.

### TQ-7 The cross-origin contracts (tokeninfo, job-board APIs) are only verified by hand, with no canary
- Where: `web/tests/auth/google.test.ts:61-76,89-130` (tokeninfo POST/GET fallback), `web/tests/jobs/enrich.test.ts:36-60` (job-board APIs)
- Evidence: the unit tests prove the client code behaves correctly given a scripted response. Whether Google or the job boards answer a browser from `https://thornleung01.github.io` is outside any test. I checked it now with curl, sending `Origin: https://thornleung01.github.io` and an invalid token or id so only headers matter:

| Endpoint | Result |
|---|---|
| `POST https://oauth2.googleapis.com/tokeninfo` (form body, invalid token) | 400 `invalid_token`, with `access-control-allow-origin: https://thornleung01.github.io` (an error response is still readable by JS) |
| `OPTIONS` preflight on the same URL | 200, allows POST and header `content-type`, and echoes the origin |
| `GET …/tokeninfo?access_token=…` | 400 with the same ACAO |
| `boards-api.greenhouse.io`, `api.ashbyhq.com`, `api.smartrecruiters.com` | ACAO `*` |
| `api.lever.co`, `api.eu.lever.co` | ACAO echoes the origin |
| `jobs.ashbyhq.com/api/non-user-graphql` preflight | 204, ACAO `*`, allows `content-type` |

- Recommended change: add a scheduled GitHub Actions workflow (weekly, plus `workflow_dispatch`) running a tiny Node script that makes the requests above and fails if the ACAO header is missing or the status or JSON shape changes. It needs no token: an invalid token proves CORS and error shape. The POST uses the same form encoding as `google.ts:175`. A valid-token canary is not possible without credentials, so keep the scripted unit tests for that half.

### TQ-8 Two fixtures have no regeneration path, and one generator is not deterministic
- Where: `web/tests/fixtures/python-export.json`, `web/tests/fixtures/python-export.golden.json`, `scripts/seed_demo.py:61-62`, `scripts/build_rules_json.py:49-52`
- Evidence:
  - `pipeline-golden.json` is fine: `export_fixtures.py` regenerates it, `--check` passes, and the meta records Python and Unicode versions.
  - `python-export.json` (39 applications, 80 emails) and `python-export.golden.json` (`now`, `sankey`, `contacts`, `counts`) are consumed by 7 test files (`portability.test.ts:13-14`, `stats.test.ts:11-12`, `applications.test.ts:8`, `settings.test.ts:16`, `portability/postingUrl.test.ts:6` and others). No script writes either. `export_fixtures.py` writes only `pipeline-golden.json`.
  - The first fixture is `seed_demo.py` output (seeded RNG but `now = datetime.now(timezone.utc)`) passed through `export_json.py`, so it cannot be regenerated byte-for-byte. The golden pins `now: "2026-11-04T23:34:53Z"`, which is why the tests do not drift with the clock (good), but nobody can reproduce it.
  - There is no Python-side test that the golden `sankey` and `contacts` still equal what the Python code computes from that export. The "parity" is a snapshot taken once.
  - `build_rules_json.py` has no `--check`. `rules-sync.test.ts` guards `rules.json` only. `unicodeTables.ts` (generated from `unicodedata`, so Python-version dependent) has no drift test. It matches today.
- Recommended change:
  - Add `scripts/export_fixtures.py --python-export` (or a sibling script) that builds the demo DB with a fixed `now`, writes `python-export.json` and computes the golden with the Python `stats` and `contacts` modules.
  - Make `seed_demo.main` accept `now`.
  - Add `--check` to `build_rules_json.py` for both outputs.
  - Wire all three checks into CI (TQ-1).

### TQ-9 Test results depend on the developer's environment (client-ID env vars)
- Where: `web/vite.config.ts:11-15`, `web/tests/config/site-config-alias.test.ts:6-12`, `web/tests/pages/setup/setup.test.ts` ("says Google and Microsoft login aren't set up yet in the test build")
- Evidence: `vite.config.ts` aliases `site-config.json` to an empty fixture so committed IDs cannot affect tests, but `import.meta.env.VITE_GOOGLE_CLIENT_ID` and `VITE_MS_CLIENT_ID` are not neutralised. I ran `VITE_GOOGLE_CLIENT_ID=123-abc.apps.googleusercontent.com VITE_MS_CLIENT_ID=11111111-2222-3333-4444-555555555555 npx vitest run`, and got 1 failure: `setup.test.ts` "…aren't set up yet in the test build". `web/.env.local` is the documented way to set those IDs (`config.ts` header), so a developer who follows the docs gets a red suite. The alias test only asserts `source !== "file"`, so it allows `"build"`. CI is safe, because the workflow sets those variables only on the build step.
- Recommended change: in `vite.config.ts` add `test.env: { VITE_GOOGLE_CLIENT_ID: "", VITE_MS_CLIENT_ID: "" }` (and make the alias test assert `source === "none"` for both).

### TQ-10 Vacuous or weak assertions (tests that can pass for the wrong reason)
- Where and why:
  - `web/tests/components/syncbanner/syncbanner.test.ts:84-91` "shows nothing when the only account is switched off": it only calls `waitFor(() => banner() === null)`. It never asserts the banner was showing before the account was deactivated. `waitFor` returns immediately if the banner is null from the start (not rendered yet, or hidden for another reason), so the test passes with the `active` filter deleted from the code. Mutation by reasoning: the sibling test at `:93` renders the banner for an active, unconnected account, so removing the filter would show it. This test does not detect that. Fix: assert `banner() !== null` before `deactivateAccount`.
  - `web/tests/pages/applications/quickedit.test.ts:50` is titled "…and refuses a day in the future", but nothing types a future date. `type()` bypasses the input's `max`, and the body only checks `field.max === localToday()`. The code that clamps the initial value (`QuickDate.tsx:29-31`) and any save-time guard are unasserted.
  - Placeholder asserts added to satisfy `noUnusedLocals`: `applications.test.ts:155` `expect(zeta).toBeGreaterThan(0)`, `:160` `expect(account).toBeGreaterThan(0)`, `:253` `expect(container).toBeTruthy()`. They test nothing; use `void zeta` or drop the destructured variable.
  - `web/tests/portability/portability.test.ts:88` "carries merges through" ends with `resolves.toBeDefined()`, but `importAll` always resolves to a summary object. The real claim (no dangling ids) is covered only because the validator would throw; assert `summary.emails` and per-row `applicationId`s exist.
  - Import-validation tests cover about 14 rules, but nothing exercises these: `confidence` outside high/medium/low, `kind` outside note/step (activity), `verdict` outside job/not_job, learned-rule `kind` and negative `evidence`, per-field length caps from `str(..., max)`, `__proto__` or constructor keys in rows, or a negative or fractional `id`. `validate.ts` is at 79.6% branch coverage. Several tests also assert only a regex on the message (for example "refuses a bad provider").
  - `web/tests/pages/review/review.test.ts:45` `expect(...value).toBeTruthy()` should assert the expected company.
- Recommended change: fix as described above, and add parameterised validation tests (`it.each`) for the missing rules, reusing `bad()` at `portability.test.ts:96`.

### TQ-11 Tests coupled to implementation
- Where and why:
  - `web/tests/pages/applications/row-memo.test.ts:6-10,28-35`: `vi.mock`s `QuickRole` to count renders (the only `vi.mock` in the 79 files) and asserts `renders.n <= 2` and `=== 0`. It passes or fails on React's scheduling and memoisation details, not on user-visible behaviour. It is also order dependent: with `--no-isolate --poolOptions.threads.singleThread=true`, "ticking one box redraws that row, not the table" fails (verified). Keep it only as a clearly labelled perf guard, or measure with `React.Profiler`.
  - `web/tests/pages/applications/bulk.test.ts:379-390`: `vi.spyOn(globalThis, "setTimeout")`, finds the call whose delay is 8000 and invokes it by hand. Use fake timers (as in TQ-4).
  - `web/tests/jobs/enrich.test.ts:479-484` "clears its timer when the request finishes": `expect(spy).toHaveBeenCalled()` on a global `clearTimeout` spy passes if anything calls `clearTimeout`. Assert with `vi.getTimerCount() === 0` under fake timers.
  - `web/tests/pages/applications/bulk.test.ts:306,322`: `vi.spyOn(bulk, "bulkDelete")` on an internal module to simulate slow and failing deletes. The rest of the suite injects faults at the Dexie layer (`vi.spyOn(db.applications, "update")`, `carryover.test.ts:115,255`). Do the same here.
  - `web/tests/app/signincss.test.ts:13-22`: regex-matches CSS source text (exact `@media (forced-colors: active) { .google-btn.primary { outline: 2px solid; } }`, `not.toMatch(/underline/)`), so reformatting the CSS breaks it with no behaviour change. If forced-colors matters, test it in a real browser (TQ-19).
  - `web/tests/pages/applications/applications.test.ts` and others assert on CSS class names and DOM structure (for example `tr.app-row`, `.quick-text`). That is acceptable here (no other stable hook), but ARIA roles and labels are already used in many places and are preferable.
- Recommended change: as listed.

### TQ-12 The wait helpers are clever and heavy, and duplicated
- Where: `web/tests/support/helpers.ts:1-74`, `web/tests/app/helpers.ts:36-103`, `web/tests/pages/applications/harness.ts:55-166`
- Evidence:
  - `support/helpers.ts` monkey-patches `globalThis.setImmediate` at import to count fake-indexeddb tasks, and switches to a stable-DOM polling loop (up to 5 s) after any timer fires more than 8 ms late. It has no tests of its own, depends on fake-indexeddb's internal scheduling, and makes a test's duration depend on machine load.
  - The same concepts are implemented twice with different signatures: `waitFor` (`app/helpers.ts:55` takes a function returning a value, `harness.ts:81` takes a boolean predicate and a label), `settle` (default 20 ms vs 40 ms), `click`, and `freshDb` (`app/helpers.ts:130`, `harness.ts:19`, `sync/helpers.ts:9`, all `openDatabase(\`...-${Date.now()}-${counter++}\`)`). The message builders are duplicated too: `sync/helpers.ts` has `mk` and `mail`, `pipeline/helpers.ts` has a third `mk`, and `parity.test.ts:60` has a fourth `fromSender`. `daysAgo` is defined in `harness.ts:35`, `sync/activity.test.ts:14` and `pages/flow/page.test.ts:22`; `go()` is defined in `app/app.test.ts:32` and `local/local.test.ts:33`.
  - No exported helper is unused (I checked all eight helper and fixture files).
- Recommended change: converge on one `tests/support/dom.ts` (`render`, `waitFor`, `settle`, `click`, `type`, `key`, `freshDb`, one `daysAgo`) and one `tests/support/messages.ts`. After TQ-5, the busy-machine heuristic can go.

### TQ-13 Giant test files that should be split
- Where: `web/tests/pages/applications/applications.test.ts` (1,032 lines, 63 tests, 8 describes), `web/tests/app/app.test.ts` (651, 7 describes), `web/tests/settings/settings.test.ts` (546), `web/tests/auth/auth.test.ts` (507), `web/tests/jobs/enrich.test.ts` (618)
- Evidence: `applications.test.ts` covers the list, filters, combobox, expandable rows, panel emails, adding by hand, importing the local export, the paste-link flow (`:640-912`, about 270 lines), the bookmarklet arrival (`:913`) and the real job-link library (`:978`). The file already sits in a folder with `bulk`, `quickedit`, `upcoming`, `duplicates` neighbours, so splitting along its describe blocks matches the existing convention.
- Recommended change: split `applications.test.ts` into `list-filters`, `search-combobox`, `panel`, `add-form`, `paste-link` and `bookmarklet-arrival`. Split `app.test.ts` into signed-out, shell, banner and setup-route files.

---

## Low

### TQ-14 Coverage blind spots inside otherwise well-covered modules
- Where, with line coverage:
  - `web/src/pages/flow/exportPng.ts` 13.8%: only the "no canvas context" fallback is tested (`pages/flow/page.test.ts:281`). The drawing and file-name path is untested, and jsdom has no canvas.
  - `web/src/pages/flow/index.tsx` 92% (lines 187-191, 206-208 and others); `web/src/pages/review/index.tsx` branch 77.6%; `web/src/sync/decide.ts` branch 66.7% (line 97); `web/src/providers/headers.ts` branch 77%; `web/src/portability/validate.ts` branch 79.6% (TQ-10).
  - `web/src/auth/google.ts:59-62` (GIS script loads but `google.accounts` is missing) and `:168-170` (`requestAccessToken` throws synchronously).
  - `web/src/auth/session.ts:66-67,75,82-83` (blocked `localStorage` paths).
  - `web/src/app/App.tsx:181-189`, `web/src/components/TimeText.tsx:8-14`.
- Evidence: v8 coverage run in the scratch copy. The bookmarklet `launch` function shows as uncovered in `extract.ts:183-200`, but that is a measurement artefact: it is executed through `new Function(...)` from `Function.toString()` in `source.test.ts` (and is tested well).
- Recommended change: add `google.ts` tests for the two uncovered paths (a fake `window.google` without `accounts`; a token client whose `requestAccessToken` throws). For `exportPng`, either use `@napi-rs/canvas` in a node-environment test or cover it in the browser test of TQ-19.

### TQ-15 Token-validation boundaries
- Where: `web/tests/auth/idToken.test.ts:50-60,70-85`, `web/src/auth/idToken.ts:99-108`
- Evidence:
  - The skew tests use `exp = now-30` (accepted) and `now-120` (rejected), never the exact boundary. Mutating `nowSec >= exp + skew` to `>` survives. The `nbf` test has the same shape.
  - "rejects a missing subject" uses `sub: ""` only, not an absent `sub`.
  - A multi-audience token with no `azp` at all is not tested (only `azp: other`).
  - `validateIdToken` does not check the signature. That is documented and the helper is named "unsigned test JWT", but nothing asserts the deliberate non-verification, for example that a token with a garbage signature is accepted because the access token is verified through tokeninfo and MSAL.
- Recommended change: add boundary cases at `exp = now - skew` and `now - skew + 1`, an absent `sub`, and multi-aud without `azp`.

### TQ-16 Spies and clock state that outlive a test
- Where: `web/tests/app/app.test.ts:327` (`vi.spyOn(console, "error").mockImplementation(...)`, with no restore anywhere in the file, so it silences `console.error` for the rest of the file); `web/tests/settings/settings.test.ts:411-421` (restore is inline in the test body, not in `afterEach`, so a failed assertion earlier leaves it mocked).
- Recommended change: set `restoreMocks: true` (and `unstubGlobals: true`) in `vite.config.ts` `test`, which also removes the per-file `vi.restoreAllMocks()` boilerplate (9 files).

### TQ-17 Time assumptions
- Where: `web/tests/portability/portability.test.ts`, `web/tests/sync/activity.test.ts`, `web/tests/sync/settle.test.ts`, `web/tests/pages/detail/offer.test.ts:151,158,166`, `web/tests/jobs/paste.test.ts:99-101`
- Evidence:
  - Forward in time is safe (+400 and +1,500 days: all 1,645 pass).
  - Backward is not: with the clock shifted 120 days back (scratch-copy setup file patching `Date`), 24 tests fail (`portability.test.ts` validation and round-trip tests, `activity.test.ts` "merges emails and notes newest first, with a limit", `settle.test.ts` "logs an application by hand…"). They embed October 2026 dates and use the real `now` for "not in the future" checks. This is harmless today (CI clocks are current) but shows those files should pin `now`, as `upcoming.test.ts:10-13` already does (`vi.useFakeTimers({toFake:["Date"]})` plus `setSystemTime`).
  - `offer.test.ts` builds expected text from `new Date().getFullYear()` and the real clock, which has a tiny flake window at midnight on 31 December.
  - `paste.test.ts:99-101` asserts wall-clock `< 2000 ms` for a 200 KB input. It is generous and the real assertion is the cap on `late`, but a time bound is a flake source on a loaded runner.
- Recommended change: pin the date in the three files above. Replace the wall-clock bound with an input-size assertion, or move it to a separate benchmark.

### TQ-18 Python suite organisation and gaps
- Where: `tests/test_second_review.py`, `test_third_review.py`, `test_fourth_review.py`, `test_review_fixes.py`; `jobtracker/cli.py`; `jobtracker/web.py:56-86`; `jobtracker/providers/gmail.py:85-102`, `outlook.py:22-40`
- Evidence:
  - Four files are named after review rounds, not modules, so finding where `contacts`, `match` or the CSRF middleware are tested means grepping (the CSRF checks are in `test_web.py:99-101` and `test_second_review.py:93-103`). Eight files define their own near-identical `mail()`/`mk()` builder (`test_classify.py:10`, `test_fourth_review.py:33`, `test_delete.py:14`, `test_newsletters.py:16`, `test_learning.py:14`, `test_roles.py:12`, `test_pipeline.py:22`, `test_settle.py:15`).
  - Coverage: `cli.py` 44% (commands for sync, serve, recheck, and others untested), `__main__.py` 0%, `providers/gmail.py` 83% and `outlook.py` 79% (OAuth connect and token reload), `web.py:56-86` (`_eta_text` and `sync_view` ETA text, a pure function that is cheap to test).
  - What is good: real SQLite (`tmp_path`), `TestClient` for the HTTP layer, only external providers faked, the DNS-rebinding and cross-site POST checks tested for several origins and `sec-fetch-site` values, and `conftest.py` isolates `SECRETS_DIR` so tests cannot touch real credentials.
  - Timezone: pytest has the identical 7 failures (TQ-3) and nothing else under `TZ=Pacific/Kiritimati` or `America/Toronto`. Python tests mostly use `datetime.now(timezone.utc)` (UTC-aware) and fixed `NOW` constants.
- Recommended change: move shared builders to `tests/helpers.py`, and rename review-round files by module as they are touched. Add table-driven tests for `_eta_text` and `sync_view`, and `CliRunner`-style tests for `cli.py` against a temp DB.

### TQ-19 Missing test types
- Browser-level tests for the two OAuth flows (impossible in jsdom). How to cover them:
  - Add Playwright (Chromium) against `vite preview`. For Google, `page.route("https://accounts.google.com/gsi/client", …)` serves a stub script that defines `window.google.accounts.oauth2.initTokenClient` and calls `callback({access_token, expires_in, scope})` from a click. This exercises the real popup-blocker timing rule (`signIn` must open the window synchronously). Stub `https://oauth2.googleapis.com/tokeninfo` with `route.fulfill` (include `access-control-allow-origin`). Then assert the signed-in shell and that the token never reaches `localStorage` or `sessionStorage`.
  - For Microsoft, a `page.route` for `login.microsoftonline.com` that redirects the MSAL popup back with a locally minted RS256-shaped id token is possible but brittle. The pragmatic option is to run real MSAL against the Playwright page with `loginPopup` intercepted. Cover everything else with TQ-2.
  - Add one "popup blocked" test with `--disable-popup-blocking` off and `window.open` returning null.
  - The real-Google tokeninfo CORS question is answered in TQ-7 (works today for POST, GET and preflight) and should be protected by the scheduled canary. A stubbed browser test cannot prove it.
- Accessibility: there are no automated checks (no axe). The suite does assert many ARIA attributes by hand (`aria-activedescendant`, `role=status`, focus return). Add `@axe-core/playwright` to the same browser run for the sign-in, list, detail, settings and flow pages, plus a forced-colors and reduced-motion emulation pass (`signin.css:14`, `syncbanner.css:13`, `base.css:389`).
- Phone layout (CSS only): there are no layout tests. `flow/page.test.ts:163` stubs `matchMedia` for the one JS behaviour that branches on it. The 720/640/520 px rules in `base.css:186-211,274`, `bulk.css:11`, `upcoming.css:13`, `review.css:9` and `flow.css:32` can only be verified in a browser. Add Playwright screenshots at 390x844 with `toHaveScreenshot` thresholds, and assert no horizontal overflow (`document.scrollingElement.scrollWidth <= innerWidth`) on each route.

### TQ-20 Housekeeping
- `.claude/worktrees/…` (26 MB, untracked, shown as `?? .claude/`) holds a full stale copy of `web/tests`. Vitest's `include` is relative to `web/` and pytest's `testpaths = tests`, so neither collects it. Anyone running either runner from a different root would, so add `.claude/` to `.gitignore`.
- `web/tests/pipeline/rules-sync.test.ts` and `web/tests/jobs-bookmarklet/source.test.ts:12-26` depend on the repo layout (`../../../jobtracker/rules.yaml`) and on `process.cwd()` being `web/`, and spawn a child `node` that requires `esbuild` from `node_modules`. They work with `npm test` in `web/` (and in CI) but not from the repo root. The source test also does a top-level `await` child process at import, which adds startup cost to that file.
- `jobtracker` docs: the parity header comment in `parity.test.ts:1-2` says "Regenerate with `python scripts/export_fixtures.py`", but there is no equivalent note in `portability.test.ts` for `python-export.json` (TQ-8).

---

## Coverage map

Assessment key: Direct = a test file imports the module and checks its contract. Barrel = covered through an `index.ts` re-export. Incidental = reached only through other tests (percent from the v8 run). Risk is the cost of a regression.

### web/src (grouped; every module is listed or named)

| Module(s) | Test file(s) | Assessment | Risk |
|---|---|---|---|
| `auth/google.ts` | `auth/google.test.ts`, `auth/auth.test.ts` | Direct, strong; 95.7% lines. Gaps: GIS-load failure path, sync throw (TQ-14) | High |
| `auth/idToken.ts` | `auth/idToken.test.ts` | Direct, strong; boundaries missing (TQ-15) | High |
| `auth/microsoft.ts` | `auth/microsoft.test.ts`, `auth/auth.test.ts` | Direct with a fake `MsalLike`; real client config (lines 32-47) untested (TQ-2); 84.4% | High |
| `auth/index.ts`, `session.ts`, `user.ts` | `auth/auth.test.ts`, `auth/user.test.ts`, `auth/popup-hint.test.ts`, `auth/config.test.ts` | Direct, strong (races, sign-out, token storage); `session.ts` 90% | High |
| `config.ts`, `site.ts` | `auth/config.test.ts`, `config/*.test.ts`, `pages/setup/setup.test.ts` | Direct; env leak (TQ-9) | Medium |
| `portability/validate.ts` | `portability/portability.test.ts` (barrel) | Barrel only, no `validate.test.ts`; 93% lines, 79.6% branches; many rules unasserted (TQ-10) | High |
| `portability/index.ts`, `python.ts`, `format.ts`, `csv.ts` | `portability/portability.test.ts`, `portability/csv.test.ts`, `portability/postingUrl.test.ts`, `pages/settings` tests | Direct and barrel; round-trip, atomic failure and Python-import tested; fixtures lack generator (TQ-8) | High |
| `sync/sync.ts`, `decide.ts`, `pipeline.ts`, `pipelineTypes.ts`, `match.ts`, `text.ts`, `links.ts`, `alerts.ts` | `sync/pipeline.test.ts`, `sync/syncAccount.test.ts`, `sync/settle.test.ts`, `sync/learning.test.ts` | `sync.ts`, `match.ts` direct. `decide.ts`, `pipeline.ts`, `pipelineTypes.ts`, `text.ts`, `links.ts`, `alerts.ts` have no direct test: incidental through `processMessages`, 66.7% branches in `decide.ts` | High |
| `sync/actions.ts`, `bulk.ts`, `duplicates.ts`, `followUp.ts`, `rounds.ts`, `roundsLookup.ts`, `contacts.ts`, `learn.ts`, `recheck.ts`, `activity.ts`, `settings.ts`, `stats.ts`, `queries.ts`, `upcoming.ts`, `groupBy.ts`, `syncLock.ts` | `sync/*.test.ts` (one per module, plus `offer*.test.ts`, `postingUrl.test.ts`) | Direct; `roundsLookup.ts` incidental only (100%). Fault injection and merge/delete integrity are well covered | High |
| `pipeline/classify.ts`, `extract.ts`, `mailtext.ts`, `match.ts`, `links.ts`, `url.ts`, `pyre.ts`, `pystr.ts`, `rules.ts` | `pipeline/*.test.ts`, `pipeline/parity.test.ts` | Direct plus Python golden parity (1 parity test per function, hundreds of cases); `links.ts`, `url.ts`, `classify.ts` through parity and barrel | High |
| `pipeline/unicodeTables.ts` | `parity.test.ts` (incidental) | Generated file; no drift check (TQ-8) | Medium |
| `providers/gmail.ts`, `graph.ts`, `backoff.ts`, `htmlToText.ts` | `providers/*.test.ts` | Direct with scripted `fetch`; good retry/abort coverage | High |
| `providers/headers.ts`, `providers/index.ts` | none direct | Incidental: 93% and 83%; no Python parity for header parsing (TQ-6) | Medium |
| `jobs/url.ts`, `jsonld.ts`, `paste.ts`, `enrich.ts`, `types.ts` | `jobs/url.test.ts`, `jsonld.test.ts`, `paste.test.ts`, `enrich.test.ts` (via barrel `src/jobs`) | Barrel only for all four, but each has its own file; `enrich.ts` uses captured real responses; host allow-list and cross-host redirect tested; 96-100% | Medium |
| `jobs/bookmarklet/extract.ts`, `draft.ts`, `index.ts`, `components/BookmarkletCard.tsx` | `jobs-bookmarklet/*.test.ts` | Direct, including production-minified output; `launch` shows uncovered in v8 only because it runs via `new Function` | Medium |
| `pages/flow/layout.ts`, `Sankey.tsx`, `index.tsx` | `pages/flow/layout.test.ts`, `pages/flow/page.test.ts` | `layout.ts` 100%, direct. `index.tsx` 92%. `exportPng.ts` 13.8% (TQ-14) | Medium |
| `pages/applications/index.tsx`, `AppRow.tsx` | `pages/applications/*.test.ts` (7 files, 2,298 lines) | Direct, extensive; 100% lines | Medium |
| `pages/detail`, `people`, `review`, `settings` (`SettingsPage.tsx`, `actions.ts`, `exportCsv.ts`, `index.tsx`), `setup` (`SetupGuide.tsx`, `steps.ts`, `index.tsx`), `signin` | `pages/detail/*`, `pages/people/*`, `pages/review/*`, `settings/*`, `pages/setup/*`, `app/app.test.ts` | Direct; `signin` via `app/app.test.ts` and `auth/auth.test.ts`; `pages/settings/index.tsx` incidental | Medium |
| `app/App.tsx`, `router.ts`, `pages.ts`, `pageProps.ts`, `appearance.tsx`, `mount.tsx`, `authApi.ts`, `localUser.ts`, `carryOver.ts`, `LocalDataOffer.tsx` | `app/app.test.ts`, `router.test.ts`, `carryover.test.ts`, `local/local.test.ts` | Direct; `carryOver.ts` (local-to-account data move) has dedicated fault-injection tests | High |
| `app/ErrorBoundary.tsx`, `LocalBanner.tsx`, `Shell.tsx`, `accents.ts`, `focus.ts`, `useHash.ts`, `usePage.ts`, `useQuery.ts` | none direct | Incidental via `app.test.ts`; 91-100% | Low |
| `components/SyncBanner.tsx` | `components/syncbanner/syncbanner.test.ts` | Direct; provider factory always faked (TQ-6) | High |
| `components/joblink/*`, `duplicates/*`, `bulk/*`, `quickedit/*`, `rounds/*`, `upcoming/*`, `offer/*`, `followup/*`, `detail/MoreMenu.tsx`, `ApplicationPanel.tsx`, `Combobox.tsx`, `PersonCard.tsx`, `EmailText.tsx`, `TimeText.tsx`, `MailActions.tsx`, `MailMeta.tsx`, `Notice.tsx`, `StageBadge.tsx`, `useAction.ts`, `flash.ts` | `components/*` tests plus page tests | Mixed: `joblink`, `MoreMenu`, `stage`, `OfferDeadline`, `QuickRole` direct. `QuickDate`, `QuickStage`, `BulkBar`, `BulkDeleteConfirm`, `SelectBoxes`, `useSelection`, `DuplicateNotice`, `FollowUpTag/Toggle`, `InterviewLine`, `ComingUp`, `InterviewRounds`, `PersonCard`, `Combobox` tested only through pages (88-100% lines) | Low |
| `db/schema.ts`, `repo.ts`, `time.ts`, `stages.ts`, `offer.ts`, `postingUrl.ts`, `errors.ts` | `db/db.test.ts`, `db/postingUrl.test.ts`, `sync/offer*.test.ts` | Direct; `schema.ts` upgrade path tested with old DB (`db.test.ts:183`) | High |
| `demo/loadDemo.ts` | `local/local.test.ts` | Direct, via pages | Low |
| `main.tsx` | none | 0%: five-line entry point | Low |

### jobtracker/*.py (v8-equivalent line coverage from `coverage.py`, run with the 7 Windows tests failing)

| Module | Test file(s) | Assessment |
|---|---|---|
| `classify.py` 98%, `extract.py` 99%, `mailtext.py` 99%, `match.py` 98%, `links.py` 96% | `test_classify`, `test_mailtext`, `test_roles`, `test_email_links`, `test_newsletters`, `test_settle`, review-round files | Direct and strong; they are also the source of truth for the TS golden |
| `sync.py` 96%, `learn.py` 96%, `recheck.py` 99%, `activity.py` 99%, `contacts.py` 99%, `stats.py` 100%, `reply.py` 96%, `settings.py` 96%, `profiles.py` 98%, `models.py`, `config.py` | `test_pipeline`, `test_learning`, `test_activity`, `test_contacts`, `test_stats`, `test_send`, `test_reply`, `test_settings`, `test_profiles` | Direct |
| `db.py` 96% | used by 28 of 30 test files | Strong, incidental plus `test_consistency`, `test_delete` |
| `joblink.py` 93% (759 lines, 37 missed) | `test_joblink.py` (1,007 lines) | Direct, includes real-transport tests against a pinned address (SSRF protection) |
| `jobs/*` (`feeds` 100%, `store` 100%, `text` 100%, `alerts` 97%, `resume` 97%, `score` 92%, `run` 92%, `notify` 89%, `adzuna` 88%) | `test_jobs_core`, `test_jobs_web`, `test_third_review` | Direct; 3 of the 7 Windows-only failures sit here, so discovery is unverified off Windows (TQ-3) |
| `jobs_web.py` 99% | `test_jobs_web.py` | Via the HTTP client, no import |
| `web.py` 93% | most test files, `test_web.py`, `test_second_review.py` | Via `TestClient`; local-only middleware tested; `_eta_text` and `sync_view` untested (TQ-18) |
| `providers/base.py`, `clients.py` | `test_providers.py`, `test_gmail_quota.py` | Direct |
| `providers/gmail.py` 83%, `outlook.py` 79% | `test_providers.py`, `test_gmail_quota.py`, `test_send.py` | Parse and send tested; OAuth connect and token reload not |
| `cli.py` 44%, `__main__.py` 0% | `test_third_review.py` (one test) | Mostly untested (TQ-18) |

Scripts: `export_fixtures.py` (checked: works and in sync), `build_rules_json.py` (checked, no `--check`), `export_json.py` (exercised only through a committed fixture), `seed_demo.py` (not tested, nondeterministic: TQ-8), `install-task.ps1` (Windows scheduler, not tested).

---

## Timezone run results

Date-sensitive suites were run as the full web suite under each timezone (`TZ=<zone> npx vitest run`):

| TZ | Test Files | Tests |
|---|---|---|
| `Pacific/Kiritimati` (UTC+14) | 79 passed | 1645 passed, 0 failed |
| `Pacific/Pago_Pago` (UTC-11) | 79 passed | 1645 passed, 0 failed |
| `America/Toronto` | 79 passed | 1645 passed, 0 failed |

The `Error: connection lost` / `token expired` / `ProviderHttpError: HTTP 500` lines in the output are expected stderr from tests that exercise failure paths (not failures).

Python (`pytest -q tests`), `TZ=Pacific/Kiritimati` and `TZ=America/Toronto`: 877 passed and 7 failed in each, the same 7 `ctypes.windll` failures as with the default timezone (TQ-3). No timezone-dependent difference.

Other determinism experiments (scratch copy, not the repo):
- Forward clock shift of +400 days and +1,500 days (a setup file that patches `Date`; verified by printing `new Date()`): all pass.
- Backward shift of 120 days: 24 failures (TQ-17).
- `--sequence.shuffle` with seeds 1, 2, 3: all pass.
- `--no-isolate --poolOptions.threads.singleThread=true`: 1 failure, `row-memo.test.ts` "ticking one box redraws that row, not the table" (TQ-11).
- `VITE_GOOGLE_CLIENT_ID` and `VITE_MS_CLIENT_ID` set in the environment: 1 failure (TQ-9).
- 10 CPU-burning processes and `--maxWorkers=2`: 1645 pass in 74 s (59 s with only 2 workers and no burners; about 20 s on this machine with the default pool).
- Global `fetch` replaced by a logging stub: no unmocked network call.

## Slowest tests

From the Vitest JSON reporter (cumulative test time 89.8 s; 21 tests over 500 ms; 10 over 1 s).

1. 8,282 ms: `pages/applications/quickedit.test.ts` "keeps the stage select focused after a change" (real 8 s Undo timer, TQ-4)
2. 8,106 ms: `pages/applications/quickedit.test.ts` "changes the stage from the dropdown and locks it" (same)
3. 2,580 ms: `pages/setup/setup.test.ts` "starts the two seconds again when copied twice" (real 1.2 s sleeps, TQ-5)
4. 2,108 ms: `pages/setup/setup.test.ts` "clears the Copied note after two seconds" (real 2 s)
5. 2,101 ms: `local/local.test.ts` "makes every page usable from the demo data: Applications, Flow, People, Review…"
6. 1,947 ms: `local/local.test.ts` "loads demo data and then deletes everything from Settings"
7. 1,797 ms: `local/local.test.ts` "asks before replacing data when loading demo data from Settings"
8. 1,232 ms: `pages/applications/duplicates.test.ts` "stays quiet for a different role, and goes away when the fields stop matching" (debounce sleeps)
9. 1,061 ms: `components/syncbanner/syncbanner.test.ts` "disables the button and marks the banner busy while it runs"
10. 1,054 ms: `pages/applications/bulk.test.ts` "selects the first 500 from the header, says so, and then lets the action through"

Slowest files: `quickedit.test.ts` 18.4 s, `applications.test.ts` 11.4 s, `local.test.ts` 7.8 s, `bulk.test.ts` 7.6 s, `syncbanner.test.ts` 7.1 s, `setup.test.ts` 7.1 s. Fixing TQ-4 and TQ-5 would remove about 25 s of cumulative test time.

Python's slowest (pytest `--durations`): `test_joblink.py` real-transport tests 0.50 s each, then 0.14 s and below. The Python suite is fast and has no sleeps.

## What the suite does well (keep)

- Behaviour-level assertions on persisted state: for example `expect([saved.stage, saved.locked]).toEqual([...])` after a UI action, and validation tests that assert the target database was untouched (`portability.test.ts:96-107`).
- Security-sensitive tests that check the negative: no token in web storage or URL, cross-host redirect refused, look-alike issuers rejected, tokeninfo token never put in a URL after a send failure, bookmarklet contains no network or eval, local server rejects cross-site POSTs.
- Race conditions pinned: login finishing after sign-out, shared silent refresh, aborted caller, sync lock release on unmount.
- Fixtures: the pipeline golden comes from the real Python functions with a deterministic corpus, and records Python and Unicode versions.
- Enrichment tests use captured real API responses.
