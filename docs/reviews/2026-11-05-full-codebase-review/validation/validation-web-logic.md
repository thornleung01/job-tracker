# Validation of bestpractices-web-logic findings (skeptic pass)

Repo: /Users/thorn.leung/job-tracker, branch easy-connect, clean (I edited nothing in the repo).
Scratch tests (throwaway, import repo code by absolute path): `/private/tmp/claude-502/-Users-thorn-leung/c9e35028-bd31-40d3-a1cd-3f723d21e55b/scratchpad/validate/` (`l3.test.ts`, `l4.test.ts`, `l6.test.ts`, `l8.test.ts`, `l9.test.ts`, `vitest.config.mjs`).
Run: `cd web && [TZ=...] npx vitest run --config <that dir>/vitest.config.mjs l4`.

Summary

| id | verdict | corrected severity |
|---|---|---|
| BP-LOGIC-1 | CONFIRMED (facts right, it is a style/convention issue) | Suggestion |
| BP-LOGIC-2 | CONFIRMED | Suggestion |
| BP-LOGIC-3 | PARTLY CONFIRMED (2 real interleavings, the "7 of 12 actions" part is harmless) | Suggestion for the header and `unlockStage`, low Important for `recheck`/`mergeApplications` |
| BP-LOGIC-4 | CONFIRMED, and more common than the report says | Important (keep; arguably higher for a Canadian audience) |
| BP-LOGIC-5 | PARTLY CONFIRMED (divergence real, effect harmless) | Suggestion |
| BP-LOGIC-6 | PARTLY CONFIRMED (duplication and "app runs the unparity-tested copy" are true; zero behavioural divergence today) | Suggestion (latent drift risk) |
| BP-LOGIC-8 | CONFIRMED | Important (keep), but trigger is rare |
| BP-LOGIC-9 | CONFIRMED | Suggestion to low Important (Gmail path behaves the same) |

---

## BP-LOGIC-3 — PARTLY CONFIRMED

Header claim is real: `web/src/sync/actions.ts:1` "Each action is one transaction." Actions with no `tx`: `editApplication` (80), `setStage` (94), `restoreStage` (101), `setAppliedOn` (108), `setInterviewRounds` (115), `setOfferDetails` (122), `unlockStage` (129) = 7. `unlockStage` has no existence check (`actions.ts:129-131`), true.

### 3a. The 7 single-row actions: NOT a lost-update bug
Each is `get` (existence check only) then a partial `update` of named fields. The `get` result is never used to compute the written values, so there is no stale write. Interleaving I tried: another tab deletes the app between `get` and `update`. Result (`l3.test.ts` last case): `update` on a missing key is a silent no-op, nothing is resurrected, count stays 0. The only effect is the friendly `MissingRecordError` is replaced by a silent no-op. Not an invariant break. The header is simply inaccurate for these.

### 3b. `mergeApplications` (`actions.ts:150-178`): real, but tiny window
`src`/`dst` are read at 151-152, `fields` computed from them, and only then `tx` opens at 166.
Reproduction (hook `db.applications.get` so a concurrent writer runs right after the second read):
```
dst.lastActivity after merge: 2026-10-01T00:00:00Z (other tab wrote 2026-11-01)      // stale value overwrote a fresher one
apps left: 0 email.applicationId: 2 exists? false                                    // dst deleted in the gap: src's emails are moved to a dead id, src row removed
```
So (i) a sync or second tab that bumps `dst.lastActivity` in the gap loses that bump, (ii) a second tab that deletes `dst` in the gap leaves emails pointing at a non-existent application (they vanish from every view). Window is the time between two IndexedDB reads and the start of the transaction (milliseconds). Needs two tabs or a sync landing in that moment. Realistic: no (very rare). Impact of (i) is a date that corrects itself on the next email; (ii) is real corruption but needs a delete of the merge target in the same few ms.

### 3c. `recheck` (`recheck.ts:30-75`): real, wider window
`untouched()` (line 22-28, checks `manual`, `locked`, note count) runs per email at line 39, outside `tx` (line 46). `removeApplicationRow` (78-84) deletes the app's `activity` rows. Reproduction: add a note after `untouched()` counted notes and before the `tx`:
```
recheck: {"checked":1,"cleared":1,"removed":1,...} apps: 0 notes left: 0 noteAddedDuringWindow: true
```
The note added during the window is deleted with the application, contradicting the header's "Applications you made or touched are never changed." The window lasts the whole classification loop (one `await` per cleared email), so it is longer than the merge window but still needs a concurrent writer: `recheck` is only called from `learnedFromFeedback` (`actions.ts:25`), which runs right after the user's own action (`notAnApplication`, `resolveReview`). In the same tab `useAction` serialises actions (`useAction.ts:run` returns false while one runs), so it needs a second tab. Realistic: low.

Minimal fix: in `recheck`, call `untouched()` again inside the `tx` for every id in `touched` (skip those now touched) before `clearEmail`/`removeApplicationRow`; in `mergeApplications`, move the two `get`s and the field computation inside the `tx`. Reword line 1 to "Actions that touch several rows are one transaction." Give `unlockStage` the same `MissingRecordError` check.

Severity: report says Important. I would keep Important only for `recheck`/`mergeApplications` and note it needs a second tab; the "7 of 12" part is a comment fix (Suggestion).

---

## BP-LOGIC-4 — CONFIRMED (more common than the report says)

Code as quoted is accurate: `appliedStamp` (`actions.ts:52-58`) validates with `localToday`, stores noon-UTC or `now`; `dayText` (`TimeText.tsx:64-72`), `csv.ts:30` and `csvFilename` (`csv.ts:43`) use the UTC date prefix. `QuickDate.tsx:30` even comments "A day stamped late in the evening can be tomorrow in UTC, so the field never starts past today", so the author knew.

Reproduction, real functions, `l4.test.ts`. Email received at 21:00 Toronto time on 21 Oct 2026 (`2026-10-22T01:00:00Z`), run through `processMessage` -> `decide` -> `createApplication`:
```
TZ=America/Toronto instant 2026-10-22T01:00:00Z = local 2026-10-21, 21:00:00; local day 2026-10-21
  appliedAt: 2026-10-22T01:00:00Z
  list (dayText short): Oct 22 | detail (long): October 22, 2026 | CSV applied|last: 2026-10-22 | 2026-10-22
  TimeText for same instant: <time ... title="Wednesday, October 21, 2026 at 9:00:00 pm EDT">Oct 21, 9:00 pm</time>
  csvFilename at that instant: job-tracker-applications-2026-10-22.csv
  QuickDate: current 2026-10-22 today 2026-10-21 initial 2026-10-21
  QuickDate 12h later: today 2026-10-22 initial 2026-10-22
```
So list, detail page and CSV say Oct 22, the same instant shown by `TimeText` says Oct 21 9 pm, and the CSV file for an evening export is named for tomorrow. In Kiritimati (UTC+14) and Sydney the same stamp reads Oct 22 (matches local day), so the email path is wrong for UTC-minus zones in the evening and for UTC-plus zones in the morning of the day after (not shown above, symmetric).

Every normal email-created application is affected, not just "a particular timezone": any North American user (Toronto/Vancouver, the product's home market) for mail after 8 pm EDT / 7 pm EST (4-5 hours a day). I upgrade the confidence, severity stays Important.

Quick date editor round trip (`QuickDate.tsx:28-33,56`): in Toronto at 21:00 the label says "Oct 22" but the field opens on Oct 21 (clamped to local today), and `max={today}` means you cannot re-enter the day the list shows. Pressing Enter on the unchanged field does nothing (`day === initial`), so there is no silent change; it is a display/edit mismatch. Next morning (local Oct 22) it opens on Oct 22 and matches.

Manual path (`setAppliedOn`/`addApplication`), sweep of 192 (instant, picked day) pairs per zone over 48 h, picking today and yesterday:
```
UTC: 0 mismatches   America/Toronto: 0 mismatches
Australia/Sydney: 44 of 192 mismatches, e.g. now=2026-10-21T13:00Z (local Oct 22 00:00) picked 2026-10-22 stored 2026-10-21T13:00:00Z -> shows 2026-10-21
Pacific/Kiritimati: 56 of 192, e.g. now=2026-10-21T10:00Z (local Oct 22 00:00) picked 2026-10-22 stored 2026-10-21T10:00:00Z -> shows 2026-10-21
```
Manual picks are wrong only in UTC-plus zones: Sydney from local 00:00 to 11:00 each day, Kiritimati 00:00 to 14:00 (picking "today" stores `now` because noon UTC is still ahead, and the UTC prefix is yesterday). Picking an older day is always right (noon-UTC). The report's description of the manual path is correct.

Minimal fix: one `localDay(iso)` helper in `db/time.ts` (local calendar date of an instant) used by `dayText` for instants, `csv.ts` `day()`, `csvFilename`, `QuickDate.current`; keep prefix reading only for noon-UTC day stamps (e.g. have `appliedStamp` always store `${day}T12:00:00Z`, drop the `now` clamp, so a manual day always round-trips). Add a test under `TZ=America/Toronto`.

---

## BP-LOGIC-5 — PARTLY CONFIRMED

Divergence is real: `whenFor` (`activity.ts:49-57`) returns `iso(now)` for today and `${chosen}T12:00:00Z` otherwise, with no "not ahead of now" clamp and no 1990 floor; `appliedStamp` (`actions.ts:52-58`) clamps and floors. Different classes for the same messages (`ActivityError` at activity.ts:52,54 vs `ActionError` at actions.ts:53,54). Duplication confirmed.

Reproduction (`l4.test.ts`, "yesterday local" step stamps swept over 48 h, 96 points):
```
TZ=Pacific/Kiritimati whenFor future stamps: 10 of 96  first: now=2026-10-21T10:00:00Z stamp=2026-10-21T12:00:00Z (2 h ahead)
TZ=Australia/Sydney: 0 of 96   TZ=America/Toronto: 0   TZ=UTC: 0
```
Only UTC+13/+14 zones, only in the first 1-2 local hours after midnight, and only for a step logged for "yesterday". The report's "idle days then go negative" is technically right (`daysSince` -> -1) but `daysAgoText` shows "Today" for `<= 0` (`TimeText.tsx:22`) and `needsFollowUp` is false for it. No visible symptom.

Severity: Suggestion (duplication/consistency), not a bug in practice. Fix as proposed (one shared `dayStamp`), which also fixes the BP-LOGIC-4 manual-path mismatch.

---

## BP-LOGIC-6 — PARTLY CONFIRMED

Which copy runs: `web/src/sync/decide.ts:8` `import { findApplication } from "./match";` and `decide.ts:86` `await findApplication(db, accountId, msg.threadId, ckey, rkey, event, role)`. So production uses `sync/match.ts`. `pipeline/match.ts` `findApplication`/`matchApplication`/`MatchStore` are used by nothing under `src/` except the barrel `pipeline/index.ts:6`; only `tests/pipeline/parity.test.ts:113-120` and `tests/pipeline/match.test.ts` import them. The adapter `sync/pipeline.ts` exposes only `sameRole`, which `sync/match.ts:12` delegates to, so the nontrivial predicate is shared and golden-tested (1159 `sameRole` cases). The thread/company/role decision ladder (steps 1-4) is copied, and the golden `findApplication` fixture (400 cases) runs only `pipeline/match.ts`. Same for `Learned.blocks` (`learn.ts:32-37`) vs `makeLearned().blocks` (`classify.ts:35-38`).

Differential test (`l6.test.ts`): `sync/match.findApplication` over a real fake-IndexedDB Dexie db vs `pipeline/match.findApplication` over the same data.
```
golden cases: 400; divergences sync-vs-pipeline: 0
random cases: 5000; divergences: 0    (random roles incl. level words, "| NAM" suffixes, empty roles/keys; 0-4 apps with all five stages; 7 events; with and without thread id)
```
No divergence today. `sync/match.ts` is also exercised end to end through `processMessage` in `tests/sync/pipeline.test.ts`, `settle.test.ts`, `learning.test.ts`, so "only whatever tests exist" is overstated, but none of those compare against the Python-golden data.

So the finding is accurate about structure and risk (next Python port change is verified only in the file the app does not run) but there is no current defect. Severity: Suggestion. Minimal fix: make `sync/match.ts#findApplication` do only the Dexie reads and call `matchApplication` from the pipeline (expose it in `Pipeline`/adapter); or, cheaper, add a parity test that runs the golden `findApplication` inputs through `sync/match.ts` over a fake Dexie (my `l6.test.ts` is 20 lines of that).

---

## BP-LOGIC-1 — CONFIRMED (low impact)

`activity.ts:22-35` defines `ActivityError` and `MissingRecordError`; `contacts.ts:288-293` `ContactKeyError`; `useAction.ts:8-9` enumerates all three plus `ActionError` and the generic fallback; `actions.ts:9` imports `MissingRecordError` from `./activity`. Error classes in `src` (grep `extends Error`): 12 distinct, of which three carry "safe to show" text outside `ActionError`. Facts match.

Skeptical notes: `MissingRecordError` is also thrown by `activity.ts` itself (`requireApplication`, line 37-41) so it is not only an action concept, and `activity` does not import `actions`, so there is no cycle; moving it to `db/errors.ts` is tidiness. There is no present user-visible bug: every class that is thrown to the UI is covered in `messageFor`. The "new class silently shows Couldn't save that" risk is hypothetical. `ContactKeyError` only fires for a malformed key, which the UI never produces.

Severity: Suggestion. Minimal fix: move `MissingRecordError` to `db/errors.ts`; make `ActivityError`/`ContactKeyError` extend `ActionError` (tests at `activity.test.ts:59`, `contacts.test.ts:147` still pass).

---

## BP-LOGIC-2 — CONFIRMED

`web/src/sync/upcoming.ts:2`: `import { dayText } from "../components/TimeText";` (`dayText` at `TimeText.tsx:64`). `grep import` across `src/sync src/db src/pipeline src/portability src/providers src/auth src/jobs` for `components/|pages/|app/`: this is the only hit. `TimeText.tsx` imports nothing from `sync/`, so there is no cycle today.

What depends on it: `upcoming.ts` is imported by `components/upcoming/InterviewLine.tsx:1`, `components/upcoming/ComingUp.tsx:1`, `sync/queries.ts:13` (`nextInterviewDay`) and the tests `tests/sync/upcoming.test.ts:3`, `tests/pages/applications/upcoming.test.ts:7`. Because `queries.ts` (every list live query) imports `upcoming.ts`, `components/TimeText.tsx` (a `.tsx` with `<time>` JSX) is pulled into the logic layer transitively for the whole applications list/stats code. `dayText` is used by 6 components plus `upcoming.ts`.

Severity: Suggestion. Fix: move `dayText`/`MONTHS` into `db/dayText.ts` (or `db/time.ts`), re-export from `TimeText.tsx`.

---

## BP-LOGIC-8 — CONFIRMED

`providers/graph.ts:76-80` (quoted correctly). `Http.get` returns a non-OK `Response` for 403/404/400 and after a 429/5xx outlasts the retry schedule (`backoff.ts:104-106`, doc at 77-82). A 401 or a network failure throws, so only status-code failures are silent.

Reproduction (`l8.test.ts`): Graph fake where the `junkemail` folder lookup fails and the page contains one inbox message and one message in the Junk folder ("Thank you for applying to Beta Corp"), run through `syncAccount`:
```
junk lookup ok  : counts={"applied-to-application":1}  lastError=null lastSync=2026-10-06T00:00:00Z apps=Acme
junk lookup 429 (outlasts retries): counts={"applied-to-application":2} lastError=null lastSync=2026-10-06T00:00:00Z apps=Acme,Beta Corp
junk lookup 503 : counts={"applied-to-application":2} lastError=null lastSync=... apps=Acme,Beta Corp
junk lookup 403 : counts={"applied-to-application":2} lastError=null lastSync=... apps=Acme,Beta Corp
```
What the user sees: no error, `lastError` stays null, `lastSync` advances, and mail from Junk/Sent/Drafts/Deleted that looks like a job email becomes an application or a Needs review item. It is not "mail skipped silently"; it is the reverse (extra mail ingested silently), and because those message ids are then marked seen, the wrong rows persist until the user cleans them up. The 404 branch is intentional and tested (`tests/providers/graph.test.ts:109`, `missingFolders`).

Realism: needs a lookup to fail with 403, or a 429/5xx that outlasts the 5-step schedule (about 170 s of waiting), so rare. Impact is wrong data without a signal. Severity: keep Important (low frequency, silent). Minimal fix: treat 404 as "no such folder", and for any other non-OK use `readJson` (throws `ProviderHttpError`, so `syncAccount` records `lastError` and does not advance `lastSync`).

---

## BP-LOGIC-9 — CONFIRMED

`auth/microsoft.ts:80-83` `needsInteraction` returns true for any error with a string `errorCode`. In installed msal (`@azure/msal-common` 15.17.0 `AuthError.mjs:40`) every `AuthError` sets `errorCode` (default `""`, still a string), and offline/network failures are `NetworkError`s wrapping `BrowserAuthError` codes `no_network_connectivity` / `get_request_failed` (`msal-browser/dist/network/FetchClient.mjs:33-36,70-73`). So any MSAL failure counts as "needs interaction".

Reproduction (`l9.test.ts`, real `AuthError` class, account remembered through a first popup, then a non-interactive silent refresh that fails):
```
errorCode=network_error | no_network_connectivity | timed_out | get_request_failed | endpoints_resolution_error | invalid_grant | interaction_required
  -> all: NotConnected: Outlook needs you to reconnect.
plain TypeError("Failed to fetch") -> propagates as TypeError   (not wrapped by MSAL, so the only error that bypasses the rule)
```
Network consequence: `microsoft.ts:171` throws `NotConnected`; in `auth/index.ts:219-223` that runs `tokens.delete(provider); setMail(provider, false); store.update({ error })`. So a Wi-Fi blip while the 1-hour access token is being refreshed marks Outlook disconnected until the user reconnects through a popup (existing test `auth.test.ts:335` pins this for `NotConnected`). A non-`NotConnected` error would instead reach `syncFailureText` ("Couldn't reach Outlook. Check your connection...") and leave the mailbox connected.

Mitigations the report omits: the Gmail path does the same for every silent-refresh failure (`google.ts:239-251` rejects `NotConnected` for any `error`/`error_callback`, so a network failure there also disconnects), so this is consistent, if debatable; and `account` is held in memory per tab, so after a page reload the non-interactive path already throws `NotConnected` (`microsoft.ts:163,171`). Impact is a recoverable annoyance (one Reconnect click), not data loss. Severity: Suggestion to low Important. Minimal fix: `needsInteraction` = `name === "InteractionRequiredAuthError"` or `errorCode` in `{interaction_required, consent_required, login_required, no_account_error, monitor_window_timeout}`; let other errors propagate; add a test with `{ errorCode: "no_network_connectivity" }`.
