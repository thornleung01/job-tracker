# Resolution of the 2026-11-05 review

This file records what was done about the findings in [README.md](README.md). It was written from the six fix agents' own reports (one per area), the integration agent's report, the tests and CI agent's report and the docs agent's report, plus a final verification run. Finding ids link to the evidence in [reports/](reports/) and [validation/](validation/).

How to read the statuses: **Fixed** means a change and a regression test exist; **Partly** means some of it was done and the rest is named; **Skipped** means a deliberate decision with a reason; **Owner** means it needs a person (a decision, a console, DNS, a license or a workflow push). Findings the reviewers listed that are not named below (mostly Low, unvalidated) were handled in the same passes as their neighbours: each fix agent's report listed what it fixed or skipped per id, and the code and tests are the record. This file does not claim a per-id outcome it cannot back, so where an id is not listed, check the git history of the branch.

## Decisions applied

| Decision | What was done |
|---|---|
| (b) Matching | One implementation. Production calls the golden-tested `pipeline/match.ts` through a thin Dexie adapter (`sync/match.ts`). Differential checks found 0 divergences before and after (400 golden and 5,000 random cases). |
| (c) Follow-ups | Both Applied and Heard back are kept. |
| (d) Python off Windows | Supported. `token_persistence` uses DPAPI on Windows and an owner-only file elsewhere. The suite no longer has the 7 expected failures. |
| (e) `gh_jid` | Kept, and disclosed on the privacy page, naming the host. |
| (f) Notes | The freestanding "notes" promise was removed from PRODUCT.md. `addNote` was deleted. Imported notes still show in history. A step can still carry a note. |
| (g) Google scope | `openid email` only. Setup guide, README and tests aligned. |

## Fixed

| Ids | What changed |
|---|---|
| [BP-LOGIC-4](reports/bestpractices-web-logic.md#bp-logic-4-calendar-day-is-validated-in-local-time-but-displayed-and-exported-from-the-utc-prefix), [BP-LOGIC-5](reports/bestpractices-web-logic.md#bp-logic-5-two-day-stamp-implementations-that-diverge-whenfor-vs-appliedstamp) | One local-day rule in `db/time.ts` for the list, detail page, CSV, CSV file name, date editor and idle days. A sweep test covers all 27 whole-hour zones from UTC-12 to UTC+14 plus DST and odd offsets. Idle days are calendar days in the viewer's zone and never negative. |
| [BP-LOGIC-3](reports/bestpractices-web-logic.md#bp-logic-3-read-then-write-outside-the-transaction-while-the-module-header-claims-each-action-is-one-transaction) | Reads moved inside the transaction for merge, recheck and the single-row actions. A test makes a second connection write just before the transaction starts. |
| [BP-LOGIC-6](reports/bestpractices-web-logic.md#bp-logic-6-the-matching-algorithm-exists-twice-and-the-parity-tested-copy-is-not-the-one-the-app-runs) | See decision (b). The golden fixture was extended with exhaustive re-apply and same-role cases; three mutations that survived the old fixture are now caught. |
| [BP-LOGIC-1](reports/bestpractices-web-logic.md#bp-logic-1-four-error-families-missingrecorderror-lives-in-the-wrong-module-actions-dont-follow-the-actionerror-convention), [BP-LOGIC-2](reports/bestpractices-web-logic.md#bp-logic-2-syncupcomingts-imports-a-ui-component-module), BP-LOGIC-7 | One error family in `db/errors.ts`, `dayText` moved out of the UI layer, one limits module (`db/limits.ts`) for save, import and paste. |
| [BP-LOGIC-8](reports/bestpractices-web-logic.md#bp-logic-8-graph-folder-exclusion-lookups-ignore-failures-so-junksent-mail-can-be-read-as-job-mail) | A non-404 failure of the Junk or Sent folder lookup now fails the sync, so lastSync does not advance and Junk mail is not ingested. |
| [BP-LOGIC-9](reports/bestpractices-web-logic.md#bp-logic-9-msal-error-handling-treats-any-error-with-an-errorcode-as-needs-interaction-which-can-switch-the-mailbox-off-on-a-network-blip) | Only genuine interaction-required codes disconnect a mailbox, for both Outlook and Gmail. An offline refresh is retryable. |
| [SEC-WEB-3](reports/security-web.md#sec-web-3-a-silent-token-refresh-is-never-checked-against-the-mailbox-it-was-connected-for-the-connected-address-map-survives-sign-out) | A silent Google refresh is checked against the connected mailbox (Gmail profile address). A different account's token is revoked and never stored. The connected-address map is cleared at sign-out. |
| SEC-WEB-4, SEC-WEB-8 | Imported mail links are limited to the real Outlook hosts. Dismissed review emails are fully erased (thread id and link too). |
| SEC-WEB-5, [SEC-WEB-9](reports/security-web.md#sec-web-9-tokeninfo-falls-back-to-putting-the-access-token-in-a-url) | `profile` scope dropped. The tokeninfo GET fallback runs only on 405 or 415 and the token never reaches the console. |
| [SEC-WEB-2](reports/security-web.md#sec-web-2-privacy-page-says-other-site-links-cause-no-request-but-the-code-queries-greenhouse-for-any-site-with-gh_jid) | Privacy page now discloses the `gh_jid` request and lists the browser storage keys. |
| [SEC-PY-1](reports/security-python.md#sec-py-1-javascript-string-injection-stored-xss-from-an-emails-sender-address-in-the-reply-confirm-dialog), SEC-PY-4, [BP-PY-3](reports/bestpractices-python.md#bp-py-3-jinja-values-interpolated-into-inline-javascript-string-literals-onsubmitreturn-confirm-x-) | No template has an inline event attribute any more. Confirms use `data-confirm` and one delegated listener. A test renders the skeptic's payloads on every page and fails on the old templates. |
| [SEC-PY-3](reports/security-python.md#sec-py-3-no-content-security-policy-and-no-framing-protection-the-port-is-predictable) | Frame, no-sniff, referrer and Content-Security-Policy headers on every response, with a per-response script nonce. A real Chrome run over 10 pages showed 0 violations. |
| SEC-PY-5, 6, 9, 10 (parts) | Outlook reply recipient set explicitly, Google client files validated, Indeed alert links forced to https and an indeed.com host, profile parameter ignored cross-site, upload size capped, open-redirect helper stricter. |
| [BP-PY-1](reports/bestpractices-python.md#bp-py-1-the-detail-pages-scroll-to-email-script-sits-inside-title-so-it-never-runs-and-pollutes-the-tab-title) | Script moved out of the title block. |
| [BP-PY-2](reports/bestpractices-python.md#bp-py-2-the-jobs-page-returns-500-off-windows-and-dpapi-is-not-isolated-the-degrades-cleanly-contract-does-not-hold), [TQ-3](reports/testquality.md#tq-3-the-python-suite-is-red-by-default-off-windows-and-cannot-be-reproduced-from-requirementstxt) | Token storage is platform aware. Disconnect no longer raises on any platform (the library had no `clear`). One real-DPAPI test is skipped off Windows. |
| [BP-PY-4](reports/bestpractices-python.md#bp-py-4-exceptions-are-swallowed-without-logging-one-path-discards-mail-permanently-with-no-trace) | Failures are logged (message id only). The mark-seen behaviour pinned by tests is unchanged. |
| BP-PY-5, 6 and CL-PY-1 | `web.py` split from 899 to 133 lines into routers under `jobtracker/routes/`. A route snapshot of every route and 125 smoke requests, recorded on the old code, passes unchanged. Blocking work runs in the threadpool. |
| [BP-UI-1](reports/bestpractices-web-ui.md#bp-ui-1-routes-with-params-reuse-component-state-so-the-detail-page-shows-and-acts-on-stale-state-after-navigating-between-applications) | Page element keyed by route path. Merge then land on the target shows no merge form and focuses the right heading. |
| BP-UI-2, 3, 5, 6, 9 | Focus returns to the pressed button, five `window.confirm` calls replaced by one shared in-place confirm, in-text links are visible without underlines, accent defaults exist before JavaScript, shell styles moved out of page-scoped CSS. Many smaller accessibility items (BP-UI-4, 7, 10, 12, 17, 18, 21, 23) also fixed. |
| [PERF-1](reports/performance.md#perf-1-every-sync-write-re-runs-three-or-more-full-table-emailstoarray-livequeries-so-sync-runs-about-60-to-90-times-slower-and-the-ui-thread-is-saturated) | Live refreshes are held to one per second during a sync. 40 writes during a sync cause at most 2 reads mid-sync, and the value after release matches the database. |
| [PERF-2](reports/performance.md#perf-2-gmail-messages-are-downloaded-one-at-a-time-estimate), [PERF-3](reports/performance.md#perf-3-outlook-first-sync-and-rescans-hold-the-whole-mailbox-in-memory-including-an-html-copy-nobody-reads-memory-is-an-estimate) | Gmail downloads four at a time in order with a shared pause on rate limits. Outlook no longer keeps an unused HTML copy, and the sync runs in oldest-first batches. A stop leaves lastSync alone and a re-run reaches the same state as an uninterrupted run. |
| PERF-4 and Python hot spots | Contacts derivation is cached (hosted: 1,143 ms to 14 ms on repeat). Python re-check after feedback went from 7.1 s to 0.4 s. |
| [TQ-1](reports/testquality.md#tq-1-ci-is-a-deploy-gate-only-and-does-not-cover-python-or-the-shared-python-artefacts) | A separate `ci.yml` was written and validated for syntax. See Owner below. |
| [TQ-2](reports/testquality.md#tq-2-the-real-msal-client-configuration-which-carries-the-tokens-stay-in-memory-guarantee-is-never-executed-by-a-test), [TQ-4](reports/testquality.md#tq-4-two-tests-burn-164-s-of-real-time-waiting-for-the-8-second-undo-timer) | A real-library MSAL test (changing the cache location fails it) and the 17 s of timer waiting cut to 1.5 s. |
| TQ-5 to TQ-18 (most) | Fake timers, per-test storage reset, a real-provider banner test, header parity cases, a table-driven validator test file, boundary tests for token times, UTC+14 and UTC-11 fixes, a CORS probe script, a split of the largest test file. Slowest tests are all under 2.2 s. |
| DC-WEB-1 to 13 (most), DC-PY-1 to 23 (most) | Dead helpers, constants, CSS and test-only production code removed (`addNote`, `syncAll`, `dayLabel`, `cleanMailText`, `open_applications`, `_default_provider` and others). `get_provider` is now required. The `id_token` router alternative and the removed Google login leftovers are gone. The `azp` check was kept, as the skeptic advised. |
| CL-WEB-1, 4, 5, 7 and CL-PY-3 to 6, 11, 12, 14 to 23 | `translate()` split into small functions (1.2 million random inputs, 0 differences), Settings split into five sections, one shared sync progress module, a table-driven import validator, duplicated Python helpers consolidated, templates use shared macros. |
| DOC-1 to 7, 9, 11 to 21, 23, 25 to 27 | Root `README.md` added, `SETUP.md` and `web/README.md` rewritten, PRODUCT.md and DESIGN.md corrected, privacy page extended, separate Google projects explained for the two editions. |

## Partly or skipped, with reasons

| Ids | Status | Reason |
|---|---|---|
| [BP-UI-2](reports/bestpractices-web-ui.md#bp-ui-2-useactionbutton-disables-the-control-that-has-focus-so-keyboard-focus-drops-to-the-body-after-nearly-every-action) | Fixed by restoring focus | jsdom cannot show the focus drop, so the test simulates it; a real Chrome run confirmed it. |
| BP-UI-11, 13, 14, 15, 16, 19, 20 | Partly or skipped | Strict Mode not enabled, the duplicated dark token block needs a CSS restructure, inline quick-edit triggers keep their small tap size. |
| SEC-PY-2 | Documented | The server has no login of its own and is browser-protected only. `SETUP.md` says to use it on a computer only you use. |
| SEC-PY-8 | Documented | The database and client files are not encrypted. Tokens are encrypted on Windows only. |
| SEC-PY-10b | Skipped | The `?notice=` banner text would need a flash cookie across every redirect for a low-severity issue. |
| PERF-6, 9, 11, 13, 17, 18 | Skipped | Measured no gain, theoretical, or a behaviour change (PERF-6 changes what a feedback click clears). |
| PERF-7 | Skipped | Fetching Outlook bodies in `$batch` changes the request shape. |
| BP-LOGIC-13, 19, 20 and the unified abort helper | Partly | Shared labels were moved to the lowest layer. A shared abort helper would need a new neutral module for one line. |
| CL-WEB-15, CL-PY-7 (CSS and JS to static files), CL-PY-13, 16, 18, 20, DC-PY-8, 9, 24, DC-WEB-14, 16 | Skipped | Low value, informational, or intentionally kept (write-only columns, insurance migrations). |
| BP-PY-16, 20 | Skipped | Needs a template change for a raw 400, or only matters if a `secrets/__init__.py` is added. |
| Old Safari | Known limit | The classifier code (`pipeline/classify.ts`, `pipeline/pyre.ts`) uses regex lookbehind, which Safari before 16.4 cannot run. The code is pinned by the golden fixture, so it was not changed. |
| Header parity | Known, pinned | Five places where the TypeScript address parser reads a header differently from Python are now pinned by tests in `providers/headers.test.ts`. They are not fixed. |

## Owner

| Item | What is needed |
|---|---|
| [SEC-WEB-1](reports/security-web.md#sec-web-1-mail-data-db-and-the-oauth-client-are-shared-with-every-page-on-the-thornleung01githubio-origin) (decision (a)) | Give the app an origin of its own (custom domain or a dedicated account), then update the Google origin and the Microsoft redirect URI. The risk is documented in `web/README.md` as a known risk. |
| [TQ-1](reports/testquality.md#tq-1-ci-is-a-deploy-gate-only-and-does-not-cover-python-or-the-shared-python-artefacts), SEC-WEB-6 | Add `.github/workflows/ci.yml` (written, validated, not run on GitHub) and consider tightening `pages.yml` permissions and pinning actions to commit SHAs. The assistant's token cannot push workflow files. After it lands, add a line about it to the root README and `web/README.md`. |
| DOC-10 | Choose a license. The README says "License: not yet chosen". |
| Console wording | Check the Google Cloud and Microsoft Entra screen names in the setup guide against the real consoles. |
| First real login | The first real Google and Microsoft login is the final proof of the one-click flow. Google's token endpoint was confirmed to allow the Pages origin (`node web/scripts/probe-cors.mjs`). |

## Final verification

Recorded in the pull request that carries this change: type-check, the hosted suite, the same suite under three time zones, the build, the Python suite, the fixture checks and a browser check.
