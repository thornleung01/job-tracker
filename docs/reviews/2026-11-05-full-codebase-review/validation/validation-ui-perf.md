# Validation: UI best-practices and performance findings

Repo /Users/thorn.leung/job-tracker, branch easy-connect, tree untouched. Dev server on port 5190 and headless Chrome 157 driven over CDP (scripts in this directory: cdp.mjs, bp1b.mjs, bp2b.mjs, bp2c.mjs, bp2d.mjs, bp5.mjs, bp6b.mjs, bp6c.mjs, bp9.mjs, perf1.mjs, perf1b.mjs, perf1c.mjs, perf3.mjs). Both were killed afterwards. App run in demo mode (local build, "Load demo data", 39 applications).

Summary

| id | verdict | severity |
|---|---|---|
| BP-UI-1 | CONFIRMED | Important (agree) |
| BP-UI-2 | PARTLY CONFIRMED | Suggestion (was Important) |
| BP-UI-3 | PARTLY CONFIRMED | Suggestion/Medium (the "contradicts DESIGN.md" part is overstated) |
| BP-UI-5 | CONFIRMED | Important (agree) |
| BP-UI-6 | PARTLY CONFIRMED | Suggestion (was Important) |
| BP-UI-9 | PARTLY CONFIRMED | Suggestion |
| PERF-1 | CONFIRMED | High for big stored mailboxes, Medium for a normal first sync |
| PERF-2 | CONFIRMED (mechanism); timings are unverifiable estimates | Medium to High |
| PERF-3 | CONFIRMED (mechanism); memory figure overstated about 2x | Medium |

---

## BP-UI-1: CONFIRMED (Important)

Code: `web/src/app/App.tsx:169` `<PageHost match={match} .../>` has no key; `PageHost` (App.tsx:61-85) returns `<Page .../>` with no key, so `/app/19` -> `/app/36` reuses the same `DetailPage`. State in `web/src/pages/detail/index.tsx:40` `const [step, setStep] = useState<"merge" | "delete" | null>(null)`. `web/src/app/useQuery.ts:11-15` never clears `value` when `deps` change.

Reproduction (bp1.mjs, bp1b.mjs; screenshot bp1-after-merge.png):
```
start          {"hash":"#/app/19","h1":"Hooli","mergeForm":false}
merge form open{"hash":"#/app/19","h1":"Hooli","mergeForm":true,"mergeSelectOpts":38}
  (More menu -> Merge into... -> Merge applications, target "Acme", id 36)
after merge    {"hash":"#/app/36","h1":"Acme","mergeForm":true,"mergeSelectOpts":37}
```
After the merge, the target application (Acme) opens with the red "Merge applications" form already open (its select now lists 37 other applications, ready to merge Acme into something else). Control: a fresh navigation into a detail page shows `mergeForm:false`. Direct hash change `#/app/16` (merge form open) -> `#/app/34` also keeps `mergeForm:true`.

Stale h1 focus, measured by wrapping `HTMLElement.prototype.focus`:
```
{"t":7741,"focusCall":"H1 Hooli","hash":"#/app/36","h1":"Hooli"}   <- focus() called on the stale heading under the new URL
{"t":7747,"mut":true,"hash":"#/app/36","h1":"Acme"}               <- 6 ms later the same node's text becomes "Acme"
```
So the focus-on-stale-h1 claim is true, but the effect is small: it is the same h1 node, and its text changes 6 ms later. The visible bug is the open merge/delete step (and `notice`, `act.status`, Log-a-step fields carrying over), which is real and sits on a danger form for a record the person has not looked at yet. Merge/Delete still need a click, so no silent data loss.

Severity: Important is fair (wrong destructive form pre-opened on a different record). Not Critical.

Minimal fix, with one correction to the report: do not key `PageHost` (that would reset its `usePage` loader state and flash "Loading" on every route change). Key the page element instead: in `PageHost`, `return <Page key={match.path} db={db} .../>`. `match.path` excludes the query string (router.ts:66-68), so Applications filters keep their state. With the remount the page renders only the back link until data arrives, so `focusHeading` falls to its "focus main, then focus h1 when it appears" branch (focus.ts:20-32) and lands on the right heading. The extra `useQuery` reset (`setValue(undefined)` when deps change) is then unnecessary for this bug.

---

## BP-UI-2: PARTLY CONFIRMED (Suggestion, not Important)

Code: `web/src/components/useAction.ts:62` `disabled: busy !== null`; e.g. detail/index.tsx:182 `<button type="submit" {...act.button("edit")}>`.

Real focus, real key events (Input.dispatchKeyEvent Enter on the focused "Save changes" button), Chrome 157:
```
bp2c, 6 runs:  before BUTTON -> after BODY   (6/6)
bp2b trace:    7314 raf d=false f=btn
               7318 aria-busy/disabled set   d=true  f=btn
               7321 raf                      d=true  f=btn
               7327 aria-busy/disabled gone  d=false f=BODY     <- focus fixup after one rendered frame while disabled
```
So the drop to `document.body` is real: the focused control is disabled long enough for one frame and Chrome moves focus to body, and nothing restores it. (One early run, bp2.mjs, kept focus: it finished inside a single frame. Any action longer than about 16 ms, including every network action, loses focus.)

What the report got wrong: it says the person "has to Tab from the top". Measured (bp2d.mjs): after the drop, pressing Tab goes to the next control after the one that was pressed ("Set stage" select, the next control in DOM order). Chrome keeps the sequential-focus starting point, so a keyboard user is not sent to the top. Screen-reader users do lose their reading position, but the status line ("Saved.") is a live region and announces the result. The stage-select case could not be driven reliably (ArrowDown opened the native popup in headless), so the select claim is by code reading only (detail/index.tsx:179 `disabled={act.busy !== null}`).

Severity: Suggestion (accessibility polish), maybe Medium for screen-reader users. Not Important.

Minimal fix: `button()` returns `"aria-disabled": busy !== null || undefined` instead of `disabled`, plus `button[aria-disabled="true"]` styling and a CSS pointer-events/hover guard; `run()` already ignores re-entry (`running.current`). Alternative that keeps `disabled`: after `run()` finishes, re-focus the element that was active when it started.

---

## BP-UI-3: PARTLY CONFIRMED (Suggestion/Medium)

Confirmed facts:
- `window.confirm` calls (5), `grep` over web/src:
  - web/src/components/ApplicationPanel.tsx:54 `Delete this ${item.kind}? A stage change it made stays.`
  - web/src/components/ApplicationPanel.tsx:58 `Delete this application? Its notes, steps and saved emails are removed...`
  - web/src/components/ApplicationPanel.tsx:65 `Remove this and teach the app it wasn't a job application?...`
  - web/src/components/PersonCard.tsx:37 `Remove ${c.name} from this application?`
  - web/src/pages/detail/index.tsx:133 same text as ApplicationPanel.tsx:65
- In-place confirms (4 patterns): components/bulk/BulkDeleteConfirm.tsx:18-30 (`role="group" aria-labelledby`), pages/detail/index.tsx:195-217 (`role="group" aria-labelledby="h-delete"`), pages/settings/SettingsPage.tsx:97-112 `Confirm` (`role="alertdialog" aria-label="Confirm"`, no Escape handler, no focus return, three uses at :496, :502, :507), app/LocalDataOffer.tsx:191-209 (`role="group"`). That is five patterns including `window.confirm`.
- The same destructive action (delete an application) asks in place on the detail page (detail/index.tsx:195) and via a browser dialog in the list panel (ApplicationPanel.tsx:58), with different copy.
- Settings `Confirm` has no `onKeyDown`/Escape handling (the others do: detail `onStepKey`, BulkBar.tsx:75).

Overstated: the rule text does not cover the list panel or PersonCard. DESIGN.md:321: "**Detail actions.** One stage select that applies on change, plus a "More" menu (merge, not an application, delete). Merge and delete confirm in place, not in a browser dialog." and DESIGN.md:328: "Delete asks in place, not in a browser dialog, and afterwards one notice says what happened and takes focus." (also :336 for the carry-over offer). The detail page and bulk bar comply. `window.confirm` in ApplicationPanel (delete application) contradicts the spirit of :321/:328; "Not an application" (detail:133) and "Remove person" (PersonCard:37) and "Delete entry" (ApplicationPanel:54) are not named by any rule. DESIGN.md has no text on the expandable list panel's confirms (the panel section is :308-319).

Minimal fix: one shared `InlineConfirm` (role=group labelled by the question, focus on Cancel, Escape cancels, focus returns to the opener), used by the Settings `Confirm` and the three ApplicationPanel/PersonCard/detail "not an application" prompts. Do the delete-application prompt in ApplicationPanel first (the only one the written rules cover in spirit).

---

## BP-UI-5: CONFIRMED (Important)

Code: `web/src/styles/base.css:86` `a { color: inherit; text-decoration: none; }`; no `p a` / `.notice a` rule (only `.dup-note a`, `.signin-footer a`, `.setup-link` add weight). DESIGN.md:261: "Links are never underlined; interactivity shows through color and tone."

Computed styles in Chrome (bp5.mjs), "Mail sync isn't set up on this site. Set it up" (settings, SettingsPage.tsx:430):
```
light: link color rgba(0,0,0,.55)  parent color rgba(0,0,0,.55)  weight 400 vs 400  decoration none  sameColor:true sameWeight:true
dark : link color rgba(255,255,255,.5) parent same  weight 400 vs 400  decoration none  sameColor:true sameWeight:true
```
Screenshot bp5-light-setitup.png (and bp5-dark-setitup.png): "Set it up" is visually identical to the sentence. No hover rule either.

privacy.html (public/privacy.html:35 `a { color: inherit; text-decoration: none; font-weight: 500; }`), computed: link weight 500 vs 400 in the parent paragraph, colour identical, light and dark. So there is a cue there, but a weak one (weight alone); report said as much ("weight 500 only").

Nuance: "Set it up" renders only when the site has no mail config (so mainly the local/demo build and a fresh deployment); the Applications-page notices (applications/index.tsx:308, :341) use the same unstyled anchors in the hosted build.

Minimal fix: one base rule, e.g. `p a, .notice a, .help a, .small a, li a { color: var(--ink); font-weight: 500; } ... :hover { background: var(--hover); border-radius: var(--r-seg); }`. Keeps the no-underline rule.

---

## BP-UI-6: PARTLY CONFIRMED (Suggestion)

Confirmed:
- `--accent-l` / `--accent-d` appear in no stylesheet (`grep`: only `base.css:12,46,63` reading them and `app/appearance.tsx:15-16` writing them, `accents.ts:2` comment). `base.css:12` `--accent: var(--accent-l)`.
- With the variables unset, a primary button is invisible. bp6c.mjs on the "Apply filters" button:
  ```
  with JS vars:   bgImg linear-gradient(rgb(0,0,0), color(srgb 0.16 ...)) color rgb(255,255,255) accent "#000000"
  vars removed:   bgImg none  bgColor rgba(0,0,0,0)  color rgb(255,255,255)  accent ""
  ```
  Screenshot bp6c-without-vars.png: white text on the light page, button shows only its shadow. bp6c-with-vars.png is the normal black button.
- A flash of the wrong theme is real for people whose saved theme differs from the OS setting. With saved theme "dark" on an OS in light mode, bp6b.mjs (3 loads) recorded a light `#f2f2f2` body for about 3 frames (t=46 to 90 ms) before `data-theme="dark"` was applied (e.g. run 0: frame 3 bodyBg rgb(242,242,242), frame 6 rgb(0,0,0)). It is an empty light page, not a flash of content. Compact density / sharp corners would also shift after first paint (applied by the same effect).

Not confirmed: "primary buttons are invisible on load". In the signed-in flow the appearance was applied before any primary button existed, in all 3 runs (theme applied at 64 to 90 ms, first `button.primary` at 131 to 141 ms), because the page chunk loads after the settings read. It is a race that the lazy page chunk currently wins, not a measured defect. The sign-in screen claim (a returning user's `.primary` provider button is painted before the `useEffect` at App.tsx:206-208 runs) is plausible from the code but I could not test it: the hosted/auth build needs site-config client IDs (the committed config is empty, and I may not edit it). Unverified.

Severity: Suggestion/Medium (cosmetic flash, latent invisible-button risk), not Important.

Minimal fix: add `--accent-l: #000000; --accent-d: #ffffff;` to the `:root` block in base.css (inline styles from `applyAppearance` still override). For the theme flash, apply a stored hint in `main.tsx` before `mount()`.

---

## BP-UI-9: PARTLY CONFIRMED (Suggestion)

Confirmed (bp9.mjs): `web/src/pages/settings/settings.css:38` `.notice > div > .line { margin: 0; }` is loaded only with the lazy Settings chunk (`pages/settings/index.tsx:3`). The shell-level `MailDeclinedNotice` uses it (`App.tsx:101` `<p className="line">` inside `<Notice>`). Probe, a `.notice > div > p.line` inserted on the Applications page:
```
before visiting Settings: p margin "16px 0px", settings rule loaded: false
after  visiting Settings: p margin "0px",      settings rule loaded: true
```
So that notice has different spacing depending on whether Settings was visited. Also `.notice:focus { outline: none; }` (settings.css:40) has the same page-scoped dependency (Notice is `tabIndex={-1}`; not measured).

Not confirmed:
- `BookmarkletCard` depending on `.sec`/`.field-block` from settings.css: it is rendered only by `SettingsPage.tsx:480`, so the CSS is always present with it. A modularity smell, not a bug.
- `.bar` "defined twice": SyncBanner's bar is styled by its own scoped `.sync-banner .bar` (syncbanner.css:8-13); the unscoped `.bar` in settings.css serves the Settings progress card (SettingsPage.tsx:397). Not a duplicate that bites. `.setup-sr` (setup.css:20) does duplicate `.sr` (base.css:96): true, trivial.
- Setup page has its own copy of the `.line` rule (setup.css:21).

Minimal fix: move `.notice > div > .line` and `.notice:focus` to base.css (next to `.notice`, base.css:222). Optional: delete `.setup-sr` for `.sr`.

---

## PERF-1: CONFIRMED (High for large stored mailboxes; Medium for a normal first sync)

Code confirmed:
- `web/src/app/useQuery.ts:12` `liveQuery(async () => read())`, no throttle.
- `web/src/app/Shell.tsx:26-28` `ReviewCount` -> `reviewCount` = `(await db.emails.toArray()).filter(...)` (queries.ts:180-182), always mounted in `Header`.
- `web/src/components/SyncBanner.tsx:100` `useQuery(() => accountSummaries(db), [db])`, `queries.ts:222-226` `for (const e of await db.emails.toArray())`. Mounted on every page for signed-in (non-local) users (App.tsx:150).
- Writer `web/src/db/schema.ts:174-176` `tx = db.transaction("rw", db.tables, fn)`; `sync.ts:42`/`:48` one per message, each related message does `db.emails.add`.
- `useQuery` call sites: 11.

Reproduction (perf1.mjs, perf1c.mjs; dev server, real `processMessages`, real Dexie liveQuery in Chrome, 60 related messages, the same two always-mounted queries):
| stored emails | no subscribers | two readers (Shell + SyncBanner queries) | query re-runs |
|---|---|---|---|
| 20,000 (1,000 apps) | 1.8 ms/msg | **101.7 ms/msg** (56x) | 119 |
| 2,000 (200 apps) | 1.0 ms/msg | **9.4 ms/msg** (9x) | 119 |

Cost scales with stored table size. At 2,000 rows the slowdown is about 9x but absolute cost is small (a 1,500-message first sync is about 12 s instead of 1.5 s). At 20,000 rows it is the report's 60 to 90x. So High for existing big mailboxes, rescans and long lookbacks; Medium for a fresh 30-day first sync.

Proposed fix verified (perf1b.mjs): I simulated "gate liveQuery re-runs while `isSyncing()`" with a querier of `if (syncing) await sleep(lastStart + 1000 - now); lastStart = now; return read()` (20,000 rows, the same two queries):
```
gated: 1.8 ms/msg (same as no subscribers), query runs: 2 total
truth after sync: reviewCount 400, emailCount 20060
last emitted by gated queries (t=5166, ~490 ms after sync end at t=4677): 400 and 20060  -> equal, not stale
```
Safe, with these caveats on what UI can be stale:
1. During a sync, the nav review badge and the banner/Settings email counts update at most once per second (they showed 2 emissions over a 4.6 s sync). Acceptable.
2. User edits made during a sync (stage change, add, delete, merge) show up in lists up to about 1 s late, because the gate applies to every `useQuery`. Make the gate time-based per hook (first run after mount must not wait: initial `lastStart = 0`), or scope it to the two always-mounted readers (`ReviewCount`, `SyncBanner`) to avoid this.
3. The read must happen after the sleep (so the value is fresh); a commit during the sleep makes Dexie schedule another run, as shown above, so the last value is correct. If the gate checks `isSyncing()` once at the start, a run that began during the sync and ends after it simply returns fresh data; no permanent staleness.
4. The Settings page (it has its own sync buttons and progress) and any test that uses fake timers with the lock held need a look; `isSyncing()` is not reactive, but nothing here depends on that.

Minimal fix: as described in the report (gate in `useQuery`, or only in `ReviewCount` and `SyncBanner`). Smallest and safest variant: a trailing throttle (about 1 s) only for those two readers.

---

## PERF-2: CONFIRMED mechanism; numbers are unverifiable estimates

Code: `web/src/providers/gmail.ts:119-132`, `for (const id of todo) { ensureNotAborted(signal); ... raw = await getJson(.../messages/{id}?format=full) ... yield msg; }`. Strictly one request in flight. The list step (`maxResults=500`) is separate and fine. I did not time Gmail (no access); the 150-300 ms per call and "4 to 8 minutes for 1,500 messages" are estimates. Quota figures (250 units/s/user, 5 units per `messages.get`, about 50 requests/s) match Google's published limits as I know them, so a window of 5 to 8 stays well under (about 100 to 200 units/s at 150 to 300 ms latency).

Safe approach, checked against the code:
- Concurrency window 4 to 6 (not 8+), because Gmail also enforces a per-user concurrent-request limit that surfaces as 429/403 `rateLimitExceeded`.
- `createHttp` (backoff.ts:85-120) retries 429/403-rate-limit/5xx per call with `Retry-After` or `[5,15,30,60,60]` s. That is per request, so with N concurrent callers each backs off independently and all retry at once. Add a shared "cool-down until" timestamp in the pool (or drop the window to 1 after the first 429) so the pool does not hammer.
- Token handling is already safe for concurrency: `auth/index.ts:200-232` coalesces refreshes through the `inflight` map and every caller awaits the same promise.
- Keep results in order: yield in order from a bounded prefetch queue (oldest-first is required, `opts.oldestFirst` reverses `todo`). Keep the 404 `continue` (deleted since listed) and the malformed-message `continue` per message.
- Pass the `signal` to every in-flight request, and make sure unawaited prefetch promises are caught on abort or error so no unhandled rejection is left behind.
- The first non-404 error should stop the generator as it does now, so `sync.ts:188-196`'s `finally` still saves the part-batch.

---

## PERF-3: CONFIRMED mechanism; memory figure overstated about 2x (Medium)

Code:
- `web/src/pages/settings/actions.ts:111` `incremental: gmail`, so Outlook takes the non-incremental branch `web/src/sync/sync.ts:203-205`: `const all: Message[] = []; for await (const msg of read()) all.push(msg); add(counts, await processMessages(db, row.id, all, now));`. Nothing is saved until the whole mailbox is read.
- `web/src/providers/graph.ts:44-47` `html = text; text = htmlToText(text)` and `:61` `html,` in the returned Message; `gmail.ts:77,88` do the same with `findPart(payload, "text/html")`.
- `Message.html` is not read anywhere under `web/src` outside the providers (`grep`); only `tests/providers/gmail.test.ts:48` and `graph.test.ts:51,58` assert it. The sync/pipeline never touch it.
- The Graph request sends only `Prefer: IdType="ImmutableId"` (graph.ts:10) and asks for `body` with no `outlook.body-content-type="text"`.

Measurement (perf3.mjs, Chrome heap after forced GC, 2,000 synthetic messages, 40 KB ASCII HTML each, through the real `parseGraphMessage`):
```
with html:    56.8 KB/message  (113.5 MB for 2,000)
html dropped: 16.7 KB/message  ( 33.3 MB)
```
V8 stores ASCII strings at one byte per character, so the report's "2 bytes per character, about 100 KB per message" is too high: about 57 KB per message with 40 KB HTML, so 5,000 messages is roughly 285 MB (not 500 MB), and dropping `html` removes about 70% of it. Still a real risk for a long Outlook lookback; the default 30 days is fine.

Minimal fix, in order: (1) stop returning `html` (graph.ts:47,61 and gmail.ts:77,88; update the three test assertions). (2) Batching Outlook like Gmail (`incremental` true plus `$orderby=receivedDateTime asc`) is the real memory/crash fix; it needs the same check the report mentions for `decide` across batches. (3) `Prefer: ..., outlook.body-content-type="text"` shrinks pages but changes the text the classifier sees (the pipeline is tuned against `htmlToText` output and has a Python parity requirement), so treat it as a behaviour change, not a pure optimisation, and run the classifier tests first.
