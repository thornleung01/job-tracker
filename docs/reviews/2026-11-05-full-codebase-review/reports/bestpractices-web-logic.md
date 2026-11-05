# Best practices review: web non-UI layers (full codebase)

Repo `/Users/thorn.leung/job-tracker`, branch `easy-connect`, clean tree. Scope: `web/src/{sync,pipeline,db,portability,providers,jobs,auth}`, `config.ts`, `site.ts`, `types.ts`, `web/vite.config.ts`, `web/tsconfig.json`, `web/package.json`. Read-only review. `npx tsc --noEmit` passes. I did not run vitest.

## Tech stack detected

React 19 + TypeScript 5.6 (strict, `noUnusedLocals`, `isolatedModules`, bundler resolution) + Vite 6 + Dexie 4 (IndexedDB) + Vitest 3 + jsdom/fake-indexeddb. Hosted static edition (GitHub Pages), Node 22 CI. Non-UI layers are a port of a Python app (`jobtracker/`). The classifier in `web/src/pipeline` is verified against golden fixtures and is treated as frozen: nothing below suggests changing its behaviour.

## Conventions discovered

- Actions (`sync/actions.ts`, `pages/settings/actions.ts`) throw `ActionError` (from `db/errors.ts`) or `NotConnected` (from `types.ts`). User-safe messages live on the error; `components/useAction.ts#messageFor` maps errors to sentences.
- Pure logic lives in `sync/*.ts`, `pipeline/*.ts`, `db/*.ts`, with unit tests in `web/tests/**`. Functions take `db` as the first argument and an injectable `now: Date` as the last (most of them).
- `sync/pipeline.ts` is "THE ADAPTER": the only file in `sync/` that imports the classifier. `sync/pipelineTypes.ts` holds the contract. (`jobs/url.ts` imports `pipeline/extract` directly; the rule is stated for `sync/` only.)
- "One rule, used on save and on import": `db/postingUrl.ts` (`parse*` / `clean*` throws / `safe*` drops) and `db/offer.ts` establish this three-function pattern.
- Timestamps are ISO-8601 UTC without milliseconds (`db/time.ts#iso`) so string comparison orders them. Calendar days are `YYYY-MM-DD`; "today" is the viewer's local day (`localToday`). Manual days are stamped noon UTC.
- Dexie: `tx(db, fn)` is `db.transaction("rw", db.tables, fn)`. All transaction callbacks I checked await only Dexie calls or sync functions. No foreign awaits inside transactions, and nested `tx` is Dexie-legal.
- Comments are short "why" notes, sentence-case copy, no emojis. Auth keeps tokens in memory only; the single persisted item is a last-provider hint.
- The pipeline port keeps Python regex text in Python syntax (`pyre.py()` translates) and exposes `pystr` helpers that mimic Python `str`. Shared regex objects are safe because every helper resets `lastIndex` and all use is synchronous.
- No ESLint config or lint script exists, although the source has `eslint-disable` directives (`app/useQuery.ts`).

---

## Critical

None. I looked for bugs that lose data without a trigger or break a stated invariant on the normal path and did not find one. The closest candidates (BP-LOGIC-3, BP-LOGIC-4) need a concurrent action or a particular timezone, so they are rated Important.

---

## Important

### BP-LOGIC-1: Four error families; `MissingRecordError` lives in the wrong module; actions don't follow the `ActionError` convention
- `web/src/sync/activity.ts:22-35`, `web/src/sync/contacts.ts:288-293`, `web/src/components/useAction.ts:8-9`, `web/src/sync/actions.ts:9`
- Evidence:
  ```ts
  // activity.ts
  export class ActivityError extends Error { ... this.name = "ActivityError"; }
  export class MissingRecordError extends Error { ... }
  // contacts.ts
  export class ContactKeyError extends Error { ... }
  // useAction.ts
  if (error instanceof ActionError || error instanceof ActivityError || error instanceof ContactKeyError) return error.message;
  if (error instanceof MissingRecordError) return "That no longer exists. ...";
  ```
  `actions.ts` imports `MissingRecordError` from `./activity`, so the action layer depends on the notes/steps module only to get an error class.
- Why it matters: The stated convention is that actions throw `ActionError`. `ActivityError` and `ContactKeyError` carry the same meaning ("a request the app refuses, with a sentence safe to show") but force the UI mapper to enumerate classes. Any new validation error class that is not added to `messageFor` silently shows "Couldn't save that." and hides a good message. `MissingRecordError`'s doc comment says it covers "application (or email, or rule)", so it is not an activity concept.
- Fix: Move `MissingRecordError` into `db/errors.ts`. Make `ActivityError` and `ContactKeyError` either `extends ActionError` (so `instanceof ActionError` covers all, and `useAction` needs only `ActionError` + `MissingRecordError`) or replace them with `ActionError`. Existing tests (`tests/sync/activity.test.ts:59`, `contacts.test.ts:147`) keep passing in the subclass option.

### BP-LOGIC-2: `sync/upcoming.ts` imports a UI component module
- `web/src/sync/upcoming.ts:2`
- Evidence: `import { dayText } from "../components/TimeText";` (`components/TimeText.tsx` is a React component file, `dayText` is defined at line 64).
- Why it matters: `sync/` is the pure-logic layer (unit-tested without React). This is the only import from `sync/`/`db/`/`pipeline/`/`portability/`/`providers/`/`auth/` into `components/`, `pages/` or `app/` (I grepped). It drags `react/jsx-runtime` into logic tests and creates a latent cycle if `TimeText` ever imports from `sync`. `dayText` is a pure string function and `shortDay` in `upcoming.ts` only needs "Mon D".
- Fix: Move `dayText` (and `MONTHS`) into a `.ts` module under `db/` or `sync/` (for example `db/dayText.ts` next to `time.ts`), and have `TimeText.tsx` re-export or import it. `upcoming.ts` then imports from the logic layer.

### BP-LOGIC-3: Read-then-write outside the transaction, while the module header claims "Each action is one transaction"
- `web/src/sync/actions.ts:1` (header), `:80-131` (`editApplication`, `setStage`, `restoreStage`, `setAppliedOn`, `setInterviewRounds`, `setOfferDetails`, `unlockStage`), `:150-178` (`mergeApplications`); `web/src/sync/recheck.ts:30-75`
- Evidence:
  ```ts
  // mergeApplications: snapshots read before the tx, then written inside it
  const src = await db.applications.get(appId);
  const dst = await db.applications.get(into);
  const lastActivity = (src.lastActivity ?? "") > (dst.lastActivity ?? "") ? ...;
  const fields = { lastActivity: lastActivity || null, appliedAt: appliedCandidates[0] ?? null };
  await tx(db, async () => { ...; await db.applications.update(into, fields); ... });
  ```
  ```ts
  // recheck: decisions made outside the tx
  const rows = (await db.emails.orderBy("id").toArray()).filter((e) => e.related);
  ... if (cls.related || !(await untouched(db, row.applicationId))) continue;
  ... await tx(db, async () => { ... removeApplicationRow(db, appId) ... });
  ```
- Why it matters: Sync runs in the background while the app is open and writes `lastActivity`/`stage`. `mergeApplications` can overwrite a fresher `lastActivity` on the target with the stale snapshot. `recheck` loops every stored email (with an `await` per row) before opening the transaction. The "only remove an application nothing you did is attached to" guarantee in the file header is checked in `untouched()` outside the transaction; a note or stage lock added in that window is deleted by `removeApplicationRow` (it deletes `activity` rows). The window is short and needs a concurrent user action, which is why this is Important and not Critical. The header comment is also inaccurate for 7 of the 12 actions (they are single `get` + `update` with no transaction), and `unlockStage` (`:129-131`) is the only stage action with no existence check and no `MissingRecordError`.
- Fix: Do the reads inside the same `tx` as the writes (move the two `get`s into `mergeApplications`'s `tx`; in `recheck`, either run the classification pass inside one `tx` or re-run `untouched()` inside the transaction before `removeApplicationRow`). Reword the header to "Actions that touch several rows are one transaction", and give `unlockStage` the same `MissingRecordError` check as its siblings.

### BP-LOGIC-4: Calendar day is validated in local time but displayed (and exported) from the UTC prefix
- `web/src/sync/actions.ts:52-58` (`appliedStamp`), `web/src/components/TimeText.tsx:60-72` (`dayText`), `web/src/portability/csv.ts:30,43`, `web/src/db/time.ts:28-33`
- Evidence:
  ```ts
  // actions.ts: the day you pick is compared as a LOCAL day
  if (day > localToday(now)) throw ...
  const noon = new Date(`${day}T12:00:00Z`);
  return iso(noon > now ? now : noon);          // today before noon UTC -> the current instant
  // dayText: "A calendar day from an ISO date or time (its first ten characters)"
  // csv.ts
  const day = (value) => (/^\d{4}-\d{2}-\d{2}/.test(value ?? "") ? value!.slice(0, 10) : "");
  export const csvFilename = (now = new Date()) => `job-tracker-applications-${now.toISOString().slice(0, 10)}.csv`;
  ```
- Why it matters: Only manual non-today days are guaranteed to round-trip (noon UTC). A day that is "today" in a UTC+ zone before noon UTC (for example 08:00 in Sydney) is stamped with the current instant, whose UTC date is yesterday, so the detail page ("Applied {dayText(app.appliedAt)}") and the CSV show yesterday for something you logged today. Applications created from email use the email's UTC instant, so a 9 pm Toronto email shows as the next day in the Applied column and the CSV, while `TimeText` for the same instant shows the local time. `csvFilename` uses the UTC date too, so an evening export in the Americas is named for tomorrow. `localToday` exists for exactly this and is not used for display.
- Fix: Decide the rule once and write it down in `db/time.ts`. Simplest consistent option: store manual "today" as the same noon-UTC rule only when the local day differs from the UTC day, or derive displayed days with a `localDay(iso)` helper (local date of the instant) for synced/instant timestamps and keep the prefix only for values known to be noon-UTC day stamps. Use `localToday(now)` in `csvFilename`. Add a test under `TZ=Australia/Sydney` and `TZ=America/Toronto`.
- Confidence note: the behaviour follows from the code as read; I did not run it under a non-UTC `TZ`.

### BP-LOGIC-5: Two day-stamp implementations that diverge (`whenFor` vs `appliedStamp`)
- `web/src/sync/activity.ts:49-57` vs `web/src/sync/actions.ts:52-58`
- Evidence:
  ```ts
  // activity.ts whenFor
  if (chosen === today) return iso(now);
  return `${chosen}T12:00:00Z`;                 // never clamped to "now"
  // actions.ts appliedStamp
  if (day < "1990-01-01") throw new ActionError("Enter a date from 1990 onward.");
  const noon = new Date(`${day}T12:00:00Z`);
  return iso(noon > now ? now : noon);          // "never a time still ahead"
  ```
  The two also use different error classes (`ActivityError` vs `ActionError`) for the same "Enter the date as year-month-day, for example 2026-10-21." / "The date can't be in the future." messages.
- Why it matters: `appliedStamp` was written to avoid a timestamp in the future. In UTC+13/+14, "yesterday" local is a day whose noon UTC can still be ahead of `now`, and `whenFor` returns it anyway, so a logged step can be dated in the future and `touch()` pushes `lastActivity` into the future (idle days then go negative). `whenFor` also has no lower bound.
- Fix: One `dayStamp(day, now): string` in `db/time.ts` (throws `ActionError`), used by `addApplication`, `setAppliedOn`, `addStep`. Keep the 1990 floor as a named constant.

### BP-LOGIC-6: The matching algorithm exists twice, and the parity-tested copy is not the one the app runs
- `web/src/sync/match.ts:14-53` vs `web/src/pipeline/match.ts:47-111`; related `web/src/sync/learn.ts:32-37` vs `web/src/pipeline/classify.ts:26-41`
- Evidence: `sync/match.ts#findApplication` re-implements steps 1-4 line for line (same `closed` list, same `sameRoleApps[sameRoleApps.length - 1]`, same `open.length === 1` branch) as `pipeline/match.ts#matchApplication`. The adapter (`sync/pipeline.ts`) exposes `sameRole` but not `matchApplication`/`findApplication`, even though `PARITY_NOTES.md` documents `matchApplication`/`findApplication(store, ...)` as the ported, golden-verified API. `Learned.blocks` in `sync/learn.ts` repeats `makeLearned().blocks` (allow, then block sender, then domain suffix).
- Why it matters: The golden fixtures verify `pipeline/match.ts`; the Dexie-facing copy that actually decides which application an email lands on has only whatever tests exist for it. The next change to the Python matcher will be ported to one file and verified there, while the app silently keeps the old behaviour. The "if a name over there changes, fix it here and nowhere else" adapter goal is undermined because behaviour, not just names, is duplicated.
- Fix: Add `matchApplication` to `Pipeline`/`pipelineTypes.ts`/the adapter and make `sync/match.ts#findApplication` do only the Dexie reads (`threadApplication`, `allApplicationsFor`) and delegate the decision. Have `Learned.blocks` call a shared function or have the adapter build the view from `makeLearned`. No classifier behaviour changes.

### BP-LOGIC-7: The same field has different rules on save, on import, and in the paste/bookmarklet path
- `web/src/sync/actions.ts:63-64,83-84`, `web/src/sync/duplicates.ts:27-28`, `web/src/portability/validate.ts:136,145,250-252`, `web/src/jobs/url.ts:6-8`, `web/src/jobs/bookmarklet/draft.ts:6,18-34`, `web/src/sync/contacts.ts:282,297-298`
- Evidence:
  | Field | Save (`actions.ts`) | Import (`validate.ts`) | Add-from-link (`jobs/`) |
  |---|---|---|---|
  | company max | `.slice(0, 80)` | `max: 200` | `MAX_COMPANY_CHARS = 60` |
  | role max | `.slice(0, 100)` | `max: 300` | `MAX_ROLE_DISPLAY_CHARS = 90` |
  | contact edit key | `isContactKey`: digits, `\|`, then an address or `name:[a-z]+` (`contacts.ts:282`) | `/^\d+\|\S+$/` | n/a |
  | posting link | `parsePostingUrl` (reject when over 500) | `safePostingUrl` (same) | `draft.ts#safeUrl` (strips the query when over 500, else drops) |
  `validate.ts:210` silently nulls a dangling `feedback.applicationId`, while `emails`/`activity` with a dangling `applicationId` fail the import. Contact edits are not checked against `appIds`.
- Why it matters: `db/offer.ts` and `db/postingUrl.ts` state the convention ("One rule, used when they are saved and when they are imported") and implement it well. Company, role and the contact key do not follow it. A 150-character company imports fine but can never be re-saved through `editApplication` (cut to 80); an imported contact edit whose key fails `isContactKey` is stored but unreachable; `duplicates.ts` has to repeat the 80/100 slices to compare like with like.
- Fix: Put `COMPANY_MAX`, `ROLE_MAX`, `NOTE_MAX`-style constants and a `cleanCompany/cleanRole` pair in `db/` (parse/clean/safe, like `offer.ts`). Use `isContactKey` in `validate.ts`. Make `bookmarklet/draft.ts#safeUrl` call `parsePostingUrl` (apply the "drop the query" step before it if that behaviour is wanted). Pick one policy for dangling references on import and apply it to all tables.

### BP-LOGIC-8: Graph folder-exclusion lookups ignore failures, so Junk/Sent mail can be read as job mail
- `web/src/providers/graph.ts:76-80`, `web/src/providers/backoff.ts:106`
- Evidence:
  ```ts
  for (const folder of SKIP_FOLDERS) {
    const res = await http.get(`${GRAPH}/me/mailFolders/${folder}?$select=id`, { signal });
    if (res.ok) excluded.add(((await res.json()) as { id: string }).id);
  }
  ```
  `Http.get` returns the non-OK `Response` (not an error) when a rate limit outlasts the retry schedule or for 403/404.
- Why it matters: A throttled or failed lookup leaves `excluded` incomplete with no signal, then messages from `junkemail`, `sentitems`, `drafts`, `deleteditems` pass the `parentFolderId` filter and are classified and stored. A 404 for a folder that doesn't exist is a legitimate skip; a 429/5xx/403 is not. Gmail's equivalent path uses `readJson` and throws `ProviderHttpError`.
- Fix: Treat only 404 as "no such folder". For any other non-OK status use `readJson` (or throw `ProviderHttpError`) so the sync fails visibly and `lastSync` is not advanced. Use `readJson<{ id: string }>` instead of the raw `res.json()` cast.

### BP-LOGIC-9: MSAL error handling treats any error with an `errorCode` as "needs interaction", which can switch the mailbox off on a network blip
- `web/src/auth/microsoft.ts:80-83,159-173`, `web/src/auth/index.ts:200-232`
- Evidence:
  ```ts
  function needsInteraction(e: unknown): boolean {
    const err = e as { name?: string; errorCode?: string } | null;
    return err?.name === "InteractionRequiredAuthError" || typeof err?.errorCode === "string";
  }
  ...
  if (!needsInteraction(e)) throw e;   // otherwise falls through
  ...
  if (!interactive) throw new NotConnected("Outlook needs you to reconnect.");
  ```
  and in `tokenSource`: on `NotConnected` it runs `tokens.delete(provider); setMail(provider, false);`.
- Why it matters: MSAL's browser/auth errors all carry a string `errorCode` (for example `network_error`, `no_network_connectivity`, `timed_out`), so `needsInteraction` is effectively "any MSAL error". An offline silent refresh then becomes `NotConnected("Outlook needs you to reconnect.")`, which marks the mailbox disconnected for the rest of the session instead of surfacing a retryable error. The helper has no comment explaining why the broad check was chosen.
- Fix: Match the interaction-required cases explicitly (`InteractionRequiredAuthError`, `errorCode` in `interaction_required`, `consent_required`, `login_required`, `no_account_error`, `monitor_window_timeout`) and let other errors propagate as ordinary failures. Add a comment citing why.
- Confidence note: depends on MSAL v4 error shapes; worth a quick test with a fake that throws `{ errorCode: "network_error" }`.

---

## Suggestion

### BP-LOGIC-10: Sync lock is per tab; duplicate-key races are reported as "unreadable email"
- `web/src/sync/syncLock.ts:4`, `web/src/sync/sync.ts:72-75,86-99`
- Evidence: `let held = false;` is module state. `emailSeen()` is checked outside the transaction in `processMessage`, and the unique index `&[accountId+providerMsgId]` catches the second writer. `isTransient` lists `DatabaseClosedError`, `QuotaExceededError`, ... but not `ConstraintError`, so it falls into the `"error"` branch and counts toward "Skipped N unreadable emails".
- Why it matters: Two tabs of the same signed-in user can both sync (tokens are per tab). Data stays correct (the unique index rejects the loser and its transaction rolls back), but the summary note is misleading and each tab wastes work.
- Fix: Take the lock with `navigator.locks.request("jobtracker-sync:" + dbName, { ifAvailable: true }, ...)` (keeping the in-memory flag as a fallback), and map `ConstraintError` on the `emails` add to `"duplicate"`. Re-check `emailSeen` inside the transaction.

### BP-LOGIC-11: `syncAccount` error path can mask the real error; user aborts are logged as errors
- `web/src/sync/sync.ts:207-212`
- Evidence:
  ```ts
  } catch (err) {
    console.error(err);
    await db.accounts.update(row.id, { lastError: syncFailureText(err, row.provider) });
    throw err;
  }
  ```
- Why it matters: If `db.accounts.update` rejects (database closed during sign-out), the caller sees that error instead of the provider failure. A deliberate Stop (`AbortError`) is logged with `console.error` and stored as `lastError = "Sync stopped."`, so a stopped sync shows as an account error afterwards.
- Fix: Wrap the update in its own `try/catch`, skip `console.error` for abort errors, and consider not persisting `lastError` for aborts. Related, minor: in `processMessages` the sort key `iso(msg.receivedAt)` (`:81-83`) is computed outside the per-message `try`, so one invalid date would fail the whole batch (providers currently guarantee valid dates).

### BP-LOGIC-12: Dead or test-only exports; `syncAll` duplicates `runSync`
- `web/src/sync/sync.ts:227-242`, `web/src/db/time.ts:11-13`, `web/src/db/repo.ts:57-59,100-102`, `web/src/sync/learn.ts:12,40`, `web/src/sync/pipeline.ts:31`, `web/src/sync/contacts.ts:277-280`, `web/src/sync/upcoming.ts:55-56`, `web/src/pipeline/extract.ts:121-122`
- Evidence (grep over `src` and `tests`): `parseIso`, `getApplication`, `emailsForApplication`, `learn.record` alias, `learn.EMPTY`, `setPipeline`, `extractCompany`, `extractRole` have no references anywhere. `syncAll`, `contacts.titles`, `dayLabel` are referenced only by tests. `syncAll` is a second account-loop orchestrator next to `pages/settings/actions.ts#runSync` (which the app uses), with a different result shape (`Record<string, Counts | string>` where the string is `"error: " + err.message`, i.e. raw error text).
- Why it matters: Public surface that nothing uses invites drift; `syncAll` in particular can be mistaken for the supported path and returns untyped error strings.
- Fix: Delete the unreferenced ones; delete `syncAll` and its test or move it into the test helpers. The `extractCompany`/`extractRole` ports can stay if kept for parity with Python.

### BP-LOGIC-13: The provider display name is written out in six places
- `web/src/sync/sync.ts:129,234`, `web/src/sync/activity.ts:143`, `web/src/auth/index.ts:16`, `web/src/providers/backoff.ts:100`, `web/src/pages/settings/actions.ts:10`
- Evidence: `PROVIDER_NAME = { gmail: "Gmail", outlook: "Outlook" }` (sync.ts), `MAIL_LABEL` (auth), `PROVIDER_LABEL` (settings/actions), `provider === "gmail" ? "Gmail" : "Outlook"` (backoff), `` `${account.provider[0].toUpperCase()}${account.provider.slice(1)} ${account.address}` `` (sync.ts and activity.ts).
- Fix: Export one `PROVIDER_LABEL` from `types.ts` (next to `ProviderName`) and an `accountLabel` helper; import it everywhere. The capitalising trick breaks if a provider is ever named differently from its label.

### BP-LOGIC-14: Small helpers duplicated across modules
- `isRecord` / `isRec` / `isObj`: `web/src/jobs/enrich.ts:51`, `jobs/jsonld.ts:12`, `portability/validate.ts:18`, `portability/python.ts:6`.
- `isBulk(headers)`: identical in `providers/gmail.ts:57-61` (exported) and `providers/graph.ts:33-37` (private).
- `abortError`: `providers/backoff.ts:27` (honours `signal.reason`), `auth/index.ts:58` (always a new `DOMException`), inline `new DOMException("Aborted", "AbortError")` in `auth/google.ts:225,228` and `auth/microsoft.ts:160`. `pages/settings/actions.ts` and `sync.ts#syncFailureText` each carry their own `isAbort` check.
- Why it matters: The abort variants differ in what they throw when the signal has a custom reason (`AbortSignal.timeout`), and the "is this an abort" test is in three places.
- Fix: `web/src/util/isRecord.ts` (or `types.ts`), move `isBulk` to `providers/headers.ts`, and one `abortError`/`isAbortError` pair exported from `providers/backoff.ts` (or `types.ts`) and used by `auth/` and `sync/`.

### BP-LOGIC-15: Unchecked `as` casts where a type guard already exists or is cheap
- `web/src/portability/validate.ts:16,171,178,236,241`, `web/src/portability/index.ts:41`, `web/src/sync/actions.ts:259`, `web/src/sync/activity.ts:83`, `web/src/sync/contacts.ts:195`, `web/src/pipeline/rules.ts:56`
- Evidence: `CONFIDENCE.includes(confidence as string)` then `confidence as EmailRow["confidence"]`; `RULE_KINDS.includes(r.kind as RuleKind)`; `Object.fromEntries(...) as unknown as ImportSummary`; `outcome as RestoreOutcome` (`Outcome` also has `"duplicate"` and `"job-alert"`, which would fall through to the "Restored and added to your applications" message); `(step as Stage)` where `isStage` exists; `e.applicationId as number` after a `.filter` that doesn't narrow; `raw as RawRules` on `rules.json` (a missing event key would be a runtime `TypeError` in `rules.strong[event].some`).
- Fix: Add `isConfidence` and `isRuleKind` next to `isStage`/`isEvent` in `db/stages.ts`/`db/schema.ts`. Replace the `RestoreOutcome` cast with an explicit mapping (`outcome === "ignored" | "review" ? ... : ...`) or widen the type. Use `isStage(step)`. Validate `rules.json` keys in `compileRules` (the golden fixtures stay green).

### BP-LOGIC-16: Two error classes don't set `name` like every other error class here
- `web/src/pipeline/url.ts:4` (`class UrlValueError extends Error {}`), `web/src/pipeline/pyre.ts:20` (`class UnsupportedRegex extends Error {}`)
- Fix: Add the same `this.name = "..."` constructor the other classes use. It makes stack traces and `err.name` checks (`isTransient`, `useAction`) consistent. `mailtext.ts` already uses `instanceof`, so behaviour doesn't change.

### BP-LOGIC-17: Live queries load whole `emails` rows (with bodies) to count or group
- `web/src/sync/queries.ts:64,160,181,222`, `web/src/sync/stats.ts:73`, `web/src/app/useQuery.ts` (liveQuery re-runs on any write to a touched table)
- Evidence: `reviewCount` is `(await db.emails.toArray()).filter((e) => e.needsReview).length`, used by `app/Shell.tsx:27` on every page. `accountSummaries` and `listApplications` also do `db.emails.toArray()` just to count. Each row can hold up to `BODY_LIMIT` (4096) characters, and sync commits one transaction per message, so each commit re-runs these.
- Why it matters: With thousands of stored emails, a long sync re-reads the full table (and rebuilds objects) on every message.
- Fix: Count with a cursor instead of materialising (`db.emails.filter((e) => e.needsReview).count()`, or `.where("[accountId+providerMsgId]").between([id, Dexie.minKey], [id, Dexie.maxKey]).count()` per account). IndexedDB cannot index booleans, so if this matters, add a numeric `review: 0 | 1` field with an index in a version 3 upgrade, or move bodies to their own table. Optional: throttle liveQuery re-runs during a sync.

### BP-LOGIC-18: Every transaction locks every table
- `web/src/db/schema.ts:173-176`
- Evidence: `return db.transaction("rw", db.tables, fn);` is used by single-row writes such as `contacts.saveEdit` and `hide`, `addNote`, `learn.undo`.
- Why it matters: IndexedDB serialises overlapping readwrite scopes, so a note save queues behind a sync batch. Correct, but not necessary.
- Fix: Optionally add `tx(db, tables, fn)` overloads (for example `[db.contactEdits]`) for the narrow actions, keeping `tx(db, fn)` for the cross-table ones.

### BP-LOGIC-19: `package.json` and `tsconfig.json`
- `web/package.json:15` (`yaml`), scripts, `web/tsconfig.json`
- Evidence: `yaml` is in `dependencies` but is only imported by `tests/pipeline/rules-sync.test.ts:4`. There is no lint script or ESLint config even though `app/useQuery.ts` carries `// eslint-disable-next-line react-hooks/exhaustive-deps`. `npm run build` and `npm run typecheck` both run `tsc --noEmit`. `noUncheckedIndexedAccess` is off, so array and record indexing such as `account.provider[0]`, `parts[n - 1]` and `QUOTE_MAP[c]` is typed as always defined.
- Fix: Move `yaml` to `devDependencies`. Either add ESLint (with `react-hooks`) and a `lint` script or remove the stale directive. Consider `noUncheckedIndexedAccess` for the non-pipeline layers first (the pipeline port indexes heavily and is golden-verified, so enabling it there is a bigger change).

### BP-LOGIC-20: Module layering: `portability` reaches into `sync` for shared constants and helpers
- `web/src/portability/validate.ts:8-10`
- Evidence: `import { MAX_ROUNDS } from "../sync/rounds"; import { sanitizeAppearance, sanitizeSync } from "../sync/settings"; import { truncate } from "../sync/text";`
- Why it matters: Import/export is a data-layer concern but now depends on the feature layer; the settings sanitisers and `MAX_ROUNDS` are the "one rule for save and import" and belong beside `db/offer.ts`.
- Fix: Move `MAX_ROUNDS`, the settings sanitisers and the code-point `truncate` into `db/` (or a small `shared/`). `sync/` and `portability/` both import from there. (`sync/text.ts` also repeats `pipeline/pystr.ts#cpLen/cpHead`; keeping them separate is defensible because of the adapter boundary, but say so in a comment.)

### BP-LOGIC-21: Stale or missing "why" comments
- `web/src/jobs/types.ts:1-3,34-51`, `web/src/sync/queries.ts:163-166`, `web/src/sync/actions.ts:20`, `web/src/providers/backoff.ts:59-61`
- Evidence: `jobs/types.ts` still describes a scaffold ("are built separately against these shapes", "Library API (implemented in web/src/jobs/index.ts)") and lists `buildBookmarkletSource`/`draftFromHash` signatures that are now defined elsewhere. `reviewPage` passes `receivedAt: now.toISOString()` into `extractCompanyRole` as a dummy, with no note that only the text is used. `short(text, limit = 400)` is only ever called with `600`. `isRetryable` matches `body.includes("ateLimitExceeded")` (covers `rateLimitExceeded` and `userRateLimitExceeded`) with no comment.
- Fix: Trim the `jobs/types.ts` header to what is true now; add one-line notes to the other three, and drop the unused default.

### BP-LOGIC-22: Settings constants are parallel lists; `saveSettings` is looser than `sanitize`
- `web/src/sync/settings.ts:21-34,104-110,124-130`
- Evidence: `FLOW_PERIODS = [0, 30, 90, 180]`, `PERIODS` (same days with labels) and `SCAN_CHOICES` are maintained separately; `pages/settings/SettingsPage.tsx:473` filters `PERIODS` by `FLOW_PERIODS`. `sanitize()` throws on an unknown section, but `saveSettings` does `section === "appearance" ? sanitizeAppearance(values) : sanitizeSync(values)`, so any other string silently writes the `sync` sanitiser's output under that key.
- Fix: Derive `FLOW_PERIODS` from `PERIODS` (`PERIODS.map((p) => p.days)`). Have `saveSettings` call `sanitize(section, values)` so there is one dispatch.

### BP-LOGIC-23: Magic numbers and strings without names
- `web/src/auth/google.ts:204,246` (`?? 3600`), `web/src/auth/microsoft.ts:112` (`55 * 60_000`), `web/src/sync/queries.ts:135,176` (`300`, `50`), `web/src/sync/activity.ts:130` (`limit = 20`), `web/src/sync/actions.ts:55` (`"1990-01-01"`), `web/src/providers/backoff.ts:4` (`RETRY_WAITS` is a mutable `number[]` export)
- Fix: Name them (`DEFAULT_TOKEN_SECONDS`, `SUGGESTIONS_MAX`, `IGNORED_SHOWN`, `EARLIEST_DAY`), and make `RETRY_WAITS` `readonly`/`as const` (the consuming option is already `readonly number[]`).

### BP-LOGIC-24: Clock injection is not uniform
- `web/src/db/repo.ts:148-164` (`recordFeedback` uses `iso(new Date())`), `web/src/sync/actions.ts:243-249`
- Evidence: Most functions take `now: Date = new Date()` (`addNote`, `setStage`, `rebuild`, `processMessage`), but `recordFeedback`, `applyEvent` callers and `ignoredIsReal` → `recordFeedback` cannot be tested with a fixed clock, and `feedback.createdAt` can differ from the `now` used for the rest of the same action.
- Fix: Add an optional `now` parameter to `recordFeedback` and pass the action's `now` through.

---

## Done well

- Transactions are used correctly: every `tx(...)` callback awaits only Dexie operations or synchronous helpers, nested `tx` calls are scope-compatible, and `exportAll` uses a read transaction. `importAllIfEmpty` does the emptiness check and the write in one transaction (comment explains why).
- `db/offer.ts` and `db/postingUrl.ts` implement a clear "one rule, three entry points" pattern (parse, clean-or-throw, safe-or-drop) with `ActionError` messages that are safe to show.
- Import validation (`portability/validate.ts`) validates everything before any write, collects every problem, caps sizes, checks uniqueness and foreign keys, and is wired so a bad file can never half-replace data. CSV export defuses formula injection and uses RFC 4180 quoting.
- `sync/pipeline.ts` adapter plus `pipelineTypes.ts` keep `sync/` decoupled from the classifier, and `setPipeline` gives a seam for tests.
- Sync behaviour is thought through: oldest-first processing, overlap window (`OVERLAP_DAYS`), keeping the old window start when rows hit transient storage errors, `lastSync` set from the start-of-sync clock, partial batches saved in `finally` on provider failure, and a plain-sentence failure text (`syncFailureText`) that never leaks status codes.
- `providers/backoff.ts`: cancellable sleep that cleans up its listener, `Retry-After` parsing for seconds and HTTP dates, bounded retries and a capped wait, token refresh once on 401, injectable `fetch`/`sleep`/`now`. Graph's `@odata.nextLink` is checked against the Graph host before the bearer token is sent.
- Auth: tokens in memory only, a `generation` counter so a sign-out invalidates in-flight requests, `inflight` de-duplication of token requests, `raceAbort` for per-caller cancellation, popup opened synchronously from the click, `userKey` refuses `:` in `sub`, `validateIdToken` documents its signature limitation honestly with a TODO. Config rejects malformed client IDs from the committed file and never reads them from the URL or storage.
- `jobs/enrich.ts` is defensive for untrusted network input: fixed host allowlist, `redirect: "error"`, `credentials: "omit"`, size caps with streamed reads, timeout that works even for a fetch that ignores its signal, and "never throws". `jobs/bookmarklet/draft.ts` treats the hash as untrusted and re-validates.
- Pipeline port: `pyre.ts` documents each Python-to-JS regex translation and throws on unsupported constructs instead of guessing; regex helpers reset `lastIndex` so shared compiled regexes are safe; `PARITY_NOTES.md` lists known deviations; `mailtext.render` escapes all text and never makes links clickable.
- Error-class naming note is already handled with care (`MissingRecordError` is explicitly "Not named NotFoundError: Dexie wraps errors with that name").
- Strict TypeScript with no `any` outside the self-contained bookmarklet extractor (which is documented as such), and all non-null assertions on `Map.get` are guarded by a prior `has` or insert.

## Not examined / limits

- UI layers (`components`, `pages`, `app`) were read only where they consume these modules (`useAction`, `Shell`, `TimeText`, `useQuery`, settings actions).
- Tests were not reviewed except to confirm which exports they use. vitest was not run.
- Timezone findings (BP-LOGIC-4, BP-LOGIC-5) are from code reading; neither was reproduced under a non-UTC `TZ`.
- `jobs/bookmarklet/extract.ts` is intentionally terse because it is serialised with `Function.prototype.toString`; I did not review it for style.
