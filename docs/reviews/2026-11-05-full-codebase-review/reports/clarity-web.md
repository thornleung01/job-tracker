# Clarity review: web/src (hosted edition)

Scope: all of `/Users/thorn.leung/job-tracker/web/src` (about 15,500 lines), branch `easy-connect`, full-codebase read, not a diff.
Read in full: pipeline/, sync/, jobs/, db/, app/, auth/index.ts + google.ts, providers/, portability/, SettingsPage, applications, detail, flow, people, review, SyncBanner, ApplicationPanel, joblink/, bulk/, quickedit/, LocalDataOffer, SetupGuide (first half).
Skimmed only: auth/microsoft.ts (head), auth/idToken.ts (head), styles/base.css (head), SignIn, MoreMenu, followup/, upcoming/InterviewLine, offer/OfferDeadline, unicodeTables.ts (generated).

## Overview

The code base reads like it was written by someone who cares about the reader. Most files open with a header that says what the file is for and why it is shaped that way, comments mostly explain reasons ("a negated offer is a rejection, not an offer", "focus starts on Cancel, the safe choice"), user-facing copy is consistent, and the sync/ layer really is a set of small pure modules (`followUp.ts`, `groupBy.ts`, `syncLock.ts`, `rounds.ts`, `upcoming.ts` are exemplary). AI-slop signals are low: there is almost no filler commenting and few casts. The real clarity debt is structural, and it clusters in five places:

1. **Parallel implementations that have drifted apart or will.** The matcher exists twice (pipeline/match.ts and sync/match.ts), `Learned` twice, the free-mail list twice, `Classification` and `MailLink` twice with different shapes. A newcomer cannot tell which copy is live.
2. **A handful of very long units.** `SettingsView` (about 410 lines), `ApplicationsPage` (275), `DetailPage` (225), `translate` in pyre.ts (190), `parseExportData` (172), `layoutSankey` (165), `useJobLink` (160). Each could be split along seams that already exist in the code.
3. **Layering that points the wrong way.** `components/SyncBanner.tsx` and `app/App.tsx` import from `pages/settings/actions.ts`; `sync/upcoming.ts` imports from `components/TimeText`. That makes "where does the sync logic live?" hard to answer, and it is why the Settings screen and the banner each carry their own copy of the progress and result wording.
4. **Magic numbers and tiny helpers repeated rather than named once.** The 80/100 company and role caps appear in 8 places, a pluralising ternary 25 times, a "newest first" comparator 13 times.
5. **Regex-heavy files are only half explained.** pipeline/ is well served by PARITY_NOTES.md and good header comments, but `jobs/url.ts` leaves its most cryptic patterns (ID_TAIL, ID_HEAD, the brand handlers) with no explanation, and the bookmarklet extractor uses one- and two-letter names throughout.

Several headers have gone stale after refactors (details in CL-WEB-12): a "SQLite trigger" comment in a Dexie app, a file called `pageProps.ts` that holds the route table, a SyncBanner header promising the two screens "cannot drift apart" while they have.

Counts: 15 Medium, 6 Low, nothing blocking.

---

## Medium

### CL-WEB-1: `translate()` in pyre.ts is one 190-line function with the escape handling written out twice
`web/src/pipeline/pyre.ts:58-250` (duplicate blocks at 107-130 and 156-176; header at 1-14; `escapeOutside` at 22-26)

Evidence
- One `while` loop handles backslash escapes, character classes, group openers, quantifiers, `.` and `$`. The character-class branch (lines 128-197) re-implements `\x`, `\u`, `\u{...}` and `\U` exactly as the top-level branch does (lines 105-130 vs 156-176), differing only in the output buffer (`out` vs `cls`) and the `afterSet` flag.
- Variable names are `i`, `n`, `c`, `d`, `cls`, `ch`, `first`, `afterSet`; none says what it holds. `afterSet` is never explained (it means "the previous item was `\d`, `\w` or `\s`, so a following `-` must be literal, not a range").
- Header line 8 jams five unrelated translations into one line: `(?P<n>...)    (?<n>...)        \Z  \A    (?i) at the very start    {,n}   literal "{" and "]"`. A reader cannot tell which pairs are "from to", and `{,n}` with no right-hand side looks like a typo.
- `escapeOutside` ends with `c === "-" ? "-" : c`, a branch that returns the same value as the fallthrough, so it looks meaningful and is not.
- No per-branch comment says why `$` becomes `(?=\n?$)` or why `.` becomes `[^\n]`; the answers are in the header, 150 lines away.

Suggested change
- Extract `readNumericEscape(source, i, kind): { text: string; next: number }` for `\x`, `\u`, `\U` and call it from both places. That removes about 30 duplicated lines.
- Split into `translateEscape`, `translateCharClass`, `translateGroupStart` (each returns `{ text, next }`), leaving `translate` as a 30-line dispatcher.
- Rewrite the header mapping as a two-column list, one translation per line (`(?P<n>...)  ->  (?<n>...)`, `\Z  ->  $`, `{,n}  ->  {0,n}`, a bare `{` or `]` becomes literal).
- Rename `afterSet` to `lastWasClassShorthand`, `cls` to `charClass`, `d` to `escaped`. Delete the dead `"-"` arm.
- Verdict on explanation: header plus PARITY_NOTES.md is good for "what and why"; the body needs two or three short "why" comments at the odd branches (`$`, `.`, the `i`/`I` expansion via `DOTTED_I`).

### CL-WEB-2: Two copies of the matching rules, two copies of `Learned`, two free-mail lists
`web/src/pipeline/match.ts:43-111` vs `web/src/sync/match.ts:14-53`; `web/src/pipeline/classify.ts:26-41` vs `web/src/sync/learn.ts:24-38`; `web/src/pipeline/extract.ts:10-13` vs `web/src/sync/learn.ts:14-17`

Evidence
- `matchApplication` and `findApplication` in pipeline/match.ts implement the four-step matching rule (thread, company+role, single open app, nothing open). sync/match.ts re-implements the same four steps with Dexie calls inline. Only tests reference the pipeline copy (`grep` finds no src caller of `matchApplication`, `MatchStore` or pipeline `findApplication`). Both headers say "Port of / jobtracker/match.py", so a newcomer cannot tell which is authoritative. A rule fix in one copy will silently not apply to the other.
- `makeLearned` (pipeline/classify.ts:26) and `class Learned` (sync/learn.ts:24) implement the identical `blocks()` logic. `makeLearned` is referenced only from tests.
- `FREE_MAIL` (extract.ts, 11 domains) and `PERSONAL_DOMAINS` (learn.ts, 12 domains, adds `msn.com`) are the same concept under two names with a one-entry difference.
- `Classification` is declared in pipeline/classify.ts (with `StageEvent`) and again in sync/pipelineTypes.ts (with `EventName`); `MailLink` is a tuple in pipeline/links.ts and an object in sync/pipelineTypes.ts; `Learned` vs `LearnedView`.

Suggested change
- Make sync/match.ts a 10-line loader: fetch thread application and company applications from Dexie, then call `matchApplication` through the adapter. Delete the second copy of the four steps.
- Have `sync/learn.ts`'s `Learned` be the one implementation and delete `makeLearned`, or the reverse; tests can build one with the constructor.
- Export one `FREE_MAIL_DOMAINS` set from pipeline and import it in learn.ts (decide whether `msn.com` belongs; if the Python side differs, say so in a comment).
- Import `Classification` from the pipeline through the adapter rather than redeclaring it.
- I need clarification: is the pipeline/match.ts copy kept deliberately as the golden-parity target (so the live copy in sync/match.ts is the one to delete or rewire), or is it leftover? The answer decides which copy goes.

### CL-WEB-3: Three layers of pass-through between the UI and the classifier
`web/src/sync/pipeline.ts:1-37`, `web/src/sync/pipelineTypes.ts:1-45`, `web/src/sync/links.ts:1-16`, `web/src/sync/match.ts:12`, `web/src/pipeline/index.ts`

Evidence
- Call chain for a reply link: component -> `sync/links.ts` `replyLink` -> `pipeline().replyLink` (adapter object, 13 members, hand-mirrored in `Pipeline` interface) -> `asLink` converts tuple to object -> `real.replyLink`. Three wrappers for one function, each repeating the signature.
- sync/links.ts is entirely `export const x = (...) => pipeline().x(...)`. `sameRole` in sync/match.ts:12 is the same.
- The adapter header says it is "the one file in web/src/sync that imports the classifier. If a name over there changes, fix it here and nowhere else." That is untrue for the code base as a whole: `components/EmailText.tsx:2` imports `blocksToHtml, parts` and `components/MailMeta.tsx:2` imports `splitSender` straight from `../pipeline`, and `sync/contacts.ts` uses `pipeline().mailParts` while the components use `parts`. So the seam is half-used and the stated benefit does not hold.
- `recipient` in the adapter (pipeline.ts:8-11) re-implements the first two lines of `replyLink` (pipeline/links.ts:51-52): `isAddress(to) && !NO_REPLY.test(...)`, and calls `NO_REPLY.test` directly while the rest of the pipeline uses the `test()` helper (a regex without the `g` flag, so it works, but it is a hidden trap).
- The stated purpose, "setPipeline() lets a test swap in a stand-in", is the only real consumer of this indirection.

Suggested change
- If the test seam is wanted, keep `pipeline.ts` and `pipelineTypes.ts`, but delete `sync/links.ts` and `sameRole` (export `mailboxLink`/`replyLink` from the adapter directly), and make `MailLink` the object shape in one place.
- If the seam is not used by many tests, drop the interface and import the pipeline functions directly; the adapter then shrinks to `asLink`.
- Either way, fix the header so it is true, and make `recipient` a named export in pipeline/links.ts that `replyLink` also calls.

### CL-WEB-4: `SettingsView` is a 410-line component that is five screens in a trench coat
`web/src/pages/settings/SettingsPage.tsx:114-523`

Evidence
- 14 `useState`/`useRef` calls, 10 async handlers, and five JSX sections (accounts, sync, appearance, data, account) in one function body.
- Terse or misleading local names: `a` (appearance settings, line 310), `x` (account, lines 311, 340), `saved`/`setSavedText`/`setSaved` (a `{text, n}` pair used to re-announce the same message), `scan` (a number of days), `when` (module-level function at line 76 that formats a timestamp, easy to confuse with a variable), `say`, `cap`.
- `type Notice` at line 56 shadows the name of `components/Notice.tsx`, which other pages import. Anyone adding the component import here will get a confusing clash.
- `NO_AUTH` (lines 64-73) builds a fake session in an IIFE inside an object literal.
- `settings?.sync.lookbackDays ?? 30` (line 420) repeats the default that `DEFAULTS.sync.lookbackDays` already holds.
- Three near-identical confirm patterns (`confirmDelete`, `confirmDemo`, `pendingImport`) each with their own boolean and busy handling.

Suggested change
- Split into `AccountsSection`, `SyncSection`, `AppearanceSection`, `DataSection`, `AccountSection` components in the same folder; each owns its state. `SettingsView` then composes them in about 40 lines.
- Move the sync-run state (`progress`, `abort`, `syncNow`) into a `useSyncRun(db, auth)` hook shared with the banner (see CL-WEB-5).
- Rename `a` to `appearance`, `x` to `row`, `scan` to `scanDays`, `when` to `formatSyncTime`, the type to `NoticeState`.
- Replace the `?? 30` with `DEFAULTS.sync.lookbackDays`.

### CL-WEB-5: Sync progress and result logic is written twice, and it lives in the wrong layer
`web/src/pages/settings/SettingsPage.tsx:182-223` vs `web/src/components/SyncBanner.tsx:159-236`; `describeSync` (`pages/settings/actions.ts:127`) vs `describeBanner` (`SyncBanner.tsx:52`); `web/src/sync/sync.ts:227`

Evidence
- The progress label and percent expressions are character-for-character the same in both files: `` `${label}: reading ${p.done}${p.total ? ` of ${p.total}` : ""}` `` and `Math.min(100, Math.round((p.done / p.total) * 100))`.
- `describeSync` and `describeBanner` produce near-identical sentences with slightly different counting (`added` vs `read`), so the same sync can report different numbers on the two screens. The SyncBanner header says it goes "through the same connectMailbox and runSync that Settings uses, so the two screens cannot drift apart"; the result wording has in fact already drifted.
- `errorText` is defined in both files (SettingsView line 77, SyncBanner line 48) and again as `message` in auth/index.ts:86; `Progress` is declared in both.
- Layering: `components/SyncBanner.tsx:13` and `app/App.tsx:5` import `PROVIDER_LABEL`, `runSync`, `connectMailbox`, etc. from `pages/settings/actions.ts`. Pages should depend on components, not the reverse. That file also holds import/export helpers and a file-download helper, which are unrelated to mailboxes.
- `syncAll` in sync/sync.ts:227 has no caller in src (the app uses `runSync` in settings/actions.ts), so there are now three sync orchestrators; and `SyncOptions` is declared in both sync.ts:113 and settings/actions.ts:79 with different shapes.

Suggested change
- Create `sync/mailbox.ts` holding `PROVIDER_LABEL`, `registerMailbox`, `connectMailbox`, `isConnected`, `runSync`, `SyncReport`, `accountLabel`, and one `describeSyncReport`. Leave file/import helpers in `pages/settings/`.
- Add `progressFromEvent(label, p): { label, percent }` next to `runSync` and use it in both screens.
- Delete `syncAll` if nothing calls it (confirm with the dead-code pass), or have `runSync` be built on it.
- Rename the second `SyncOptions` (`RunSyncOptions`).

### CL-WEB-6: `ApplicationsPage` mixes filters, the add form and bookmarklet arrival; the list URL is rebuilt six times
`web/src/pages/applications/index.tsx:74-349`; repeated `listUrl({ stage, q, account, followUp, ...sorting ... })` at lines 107, 109, 166, 203, 224, 334

Evidence
- One 275-line function holds: URL-derived filter state, four draft states mirrored by four `useEffect`s (lines 99-102), seven add-form `useState`s, four refs, a focus-request counter (`focusAdd`), a ref-forwarding trick for memoised rows (111-114), a bookmarklet-arrival effect with a dedupe ref (`arrival`), and about 100 lines of JSX.
- `listUrl({ stage, q, account, followUp, ...sorting, open: ... })` is rebuilt with minor variations six times; a new filter must be added in six places.
- Naming: `state` vs `sort` vs `state.sort`, `sorting`, `suggest` (renamed from `suggestions` to avoid a clash with the imported function), `ready` (a boolean for "data has loaded"), `add` (an action runner; `addOpen`, `addStage`, `addApplication` are different things), `r` prop on `AppRow` (AppRow.tsx:18; the row).
- `dataCol` (line 53) maps `lastActivity` to `last_activity` for CSS; only comment is on the helper, not at the `data-col` uses.

Suggested change
- Extract `AddApplicationForm` (the form and its state, using `useJobLink` and `useDuplicates`) into `pages/applications/AddApplicationForm.tsx`; the page passes `onSaved` and an `arrival` draft.
- Add `const urlWith = (patch: Partial<ListState>) => listUrl({ stage, q, account, followUp, ...sorting, open, ...patch })` once, and use it for sort links, row links, clear-filters and the bookmarklet cleanup.
- Rename `r` to `row` in `AppRow`, `suggest` to `searchSuggestions`, `ready` to `hasLoaded`.

### CL-WEB-7: `parseExportData` is eight copies of the same 20-line block with unnamed limits
`web/src/portability/validate.ts:113-285`

Evidence
- One 172-line function with eight table blocks (`accounts`, `applications`, `emails`, ... `contactEdits`), each: `rowsOf(...).forEach((r, i) => { const k = c.at(...); ... if (rowId && ...) push(...) })`. The shape is easy once seen, but the function is too long to hold in the head.
- Unnamed limits: 320, 200, 300, 1000, 2000, 500, 10_000, 1_000_000 in lines 124-252 (`str(r, "address", k, { max: 320 })`, `max: 1_000_000`, ...). A reader cannot tell which come from the app (company 80, role 100, name 80, title 100 are enforced elsewhere) and which are just "big enough to be sane"; the import allows company up to 200 but the app saves 80.
- Locals `d`, `c`, `k`, `r`, `i`, `id`, `str`, `flag`, `time` (the `id` helper shadows the common local `id`).

Suggested change
- One function per table (`parseAccounts(d, c)`, `parseApplications(d, c)`, ...) each returning its typed array; `parseExportData` becomes a 25-line list of calls plus the duplicate checks.
- Name the limits at the top: `const IMPORT_LIMITS = { address: 320, company: 200, ..., body: 1_000_000 }` with one comment: "Generous caps so a hostile file cannot fill storage; the app's own caps are tighter".
- Rename `c` to `check`, `k` to `rowCheck`, and the `id` helper to `readId`.

### CL-WEB-8: jobs/url.ts: the hardest patterns and the brand handlers have no explanation
`web/src/jobs/url.ts:80-82, 91-106, 137, 156, 168-169, 284-293, 340-372`

Evidence (judging whether the regex comments are enough)
- Adequate: SMALL_WORDS (line 29, a good "why"), the `acme.com:8080` case at 155, the Glassdoor KO/KE slug at 309, the `lowerMeridiem`-style comments elsewhere.
- Not adequate:
  - `ID_TAIL` (81) and `ID_HEAD` (82) are the hardest lines in the file: `(?:\d{3,}|(?=[a-z]*\d)[0-9a-f]{8,})`. Nothing says it means "three or more digits, or an 8+ character hex run containing at least one digit". `UUID_TAIL` (80) has no comment either. The loop at 93-97 ("up to 4 passes") has no reason given for 4.
  - `roleFromSlug` (91-106) holds five heuristics in a row (`lettered.length < 2`, `< words.length * 0.7`, `words.length > MAX_ROLE_WORDS`, all-generic, title too long) with no sentence saying what each rejects or why 0.7.
  - `SECOND_LEVEL` (137) is a hand-rolled mini public-suffix list; `registrable` (140) returns `depth` and nothing says it is used by `tenant()` to decide whether there is a subdomain.
  - `linkedin()` (284-293) has no comment on the URL shapes it parses (`/jobs/view/<title>-at-<company>-<id>`); `workday`, `icims`, `breezy`, `teamtailor`, `applytojob` handlers (331-372) give no example path, so you must know each ATS to review them.
  - `tenant()` (278) hard-codes `["www","careers","jobs","apply","ats"]` inline.
  - `sanitizeText` slices to `limit * 20` (line 15) with no reason (cap work on huge input before the regexes).
  - Two unrelated section-divider styles: this file uses `// ----- names from slugs`, while sync/actions.ts and db/repo.ts use `// -- applications ---`.

Suggested change
- Add one example above each of `UUID_TAIL`, `ID_TAIL`, `ID_HEAD` ("`-req-12345`", "`-a1b2c3d4e5`", "`12345-`").
- A two-line docblock on `roleFromSlug` listing the reject rules.
- One `// /jobs/view/<role>-at-<company>-<id>` line above `linkedin`, and a one-line example path above each handler in `BRANDS`.
- `const SLUG_ID_PASSES = 4` and `const MIN_LETTERED_RATIO = 0.7` with a why-comment.

### CL-WEB-9: Bookmarklet extractor uses one- and two-letter names throughout
`web/src/jobs/bookmarklet/extract.ts:25-175` (also 1-7 header, 71-72, 79, 186)

Evidence
- About 40 locals named `c r l u g sg z H V wk tx s rs lp fl hn li ind jb kn hd CA NV f a p o j x pick pp og P Q T m n w i q L bad` with comments that define about 10 of them inline (`// z: clean and cap`, `// rs: ...`). The reader must hold the legend in their head across 150 lines; `c/r/l/u` are the output fields but `a`, `p`, `x`, `j`, `m`, `n` are reused with different meanings in different `try` blocks.
- `let p: any`, `const f = (n: any, k: number): any` (lines 71-72, 79) are `any` in a codebase that otherwise avoids it; `as unknown as Record<string,string>` at line 186.
- The header (line 3) is a single run-on sentence mixing three rules (self-contained, under 6 KB minified, always try/catch) and parenthetical; it reads as an edit-in-place.
- I need clarification: production builds are minified (the tests "build the bookmarklet from the production-minified versions", per bookmarklet/index.ts:27). If esbuild already renames locals in production, the hand-shortened names buy nothing there and only cost readability in source. Is the 6 KB budget measured on the minified output (then use real names) or does `Function.prototype.toString()` get unminified source in some path?

Suggested change
- If minification renames locals: use full names (`company`, `role`, `location`, `url`, `guessFlags`, `isHidden`, `isVisible`, `visibleText`, `firstVisibleText`, `looksLikeLocation`). If not, add a 12-line legend block at the top of `extract` and stop reusing single letters across blocks.
- Replace the `any` JSON-LD walker with `unknown` plus the existing `isObj` pattern, or a local `type Node = Record<string, unknown>`.
- Break the header into three short bullets.

### CL-WEB-10: `useJobLink` juggles eight refs and repeats the same "cancel in flight" block six times
`web/src/components/joblink/useJobLink.ts:47-207`; repeated blocks at 70-76, 101-103, 106-108, 114-116, 147-149, 162-164

Evidence
- Refs: `libRef`, `setRef`, `live`, `auto`, `linkRef`, `controller`, `timer`, `fillRef`, plus seven `useState`s. Each ref has a reason (mostly "read the newest value from a timer"), but the reasons are only partly commented (only `live` and `auto` have comments).
- The three-line "abort, null the controller, `setChecking(false)`" block appears in `stop`, `fillFromLink` (twice), `onLinkChange`, `readPastedText`; `adopt` and `reset` both repeat the same six resets (`auto`, `linkRef`, `setLinkText`, `setPasteText`, `setPasteOpen`, `setResult`, `setUnreadable`, `setHints`).
- Duplicate strings: `"We couldn't read details from this link. Add them below."` (line 117) and `"We couldn't read details from that text. Add them below."` (168) are already defined as `NOTHING_FROM_LINK` / `NOTHING_FROM_TEXT` in `describe.ts:34-35` but not used here.
- `boardName` in describe.ts:17-30 re-implements host matching that `detectBoard` already does in jobs/url.ts.
- `MAX_PASTE_CHARS = 200_000` is defined here (line 11) and again in jobs/paste.ts:6.

Suggested change
- Pull `cancelPending()` (abort, null, `setChecking(false)`, clear timer) and use it in all six places; make `reset()` and `adopt()` share a `clearForm()`.
- Import `NOTHING_FROM_LINK`/`NOTHING_FROM_TEXT` instead of repeating the sentences.
- Import `MAX_PASTE_CHARS` from `jobs`, delete the copy.
- Add one sentence above the ref list: "Refs hold values that async callbacks and timers must read fresh; state holds what renders."

### CL-WEB-11: `derive()` in contacts.ts is an 84-line three-phase loop with terse names
`web/src/sync/contacts.ts:181-264` (also 18-34, 118, 164, 270-280)

Evidence
- One function does: load accounts/apps/emails, build sender "people", collect "mentions", merge mentions into people, apply edits, sort. Variables `p`, `aid`, `mine`, `mentions`, `m`, `n`, `e`, `sent`, `person` do heavy lifting; `mine` is the user's own mailbox addresses.
- `KEYS` (line 18) is "title keywords" (`TITLE_KEYWORDS`); `SMALL` is "title joining words"; `norm` is "name key"; `flat` is "readable plain text of a stored email".
- `titles(db, appId)` (line 278) returns an address-to-title lookup (`Record<string,string>`) and `titlesFrom` too; both are named like lists. `forApplication` (266) is a one-line wrapper over `derive`.
- Magic numbers: 9 (tokens scanned after a name), 80 and 100 (name/title caps in `saveEdit`), 25 (`MAX_MAILS`, named).
- `derive` is a generic name for the main export of the module.

Suggested change
- Split into `collectSenders(emails, accounts)`, `collectMentions(emails)`, `mergeMentions(people, mentions)`, `applyEdits(people, edits)`; `derive` becomes the 15-line composition.
- Rename `KEYS` to `TITLE_KEYWORDS`, `norm` to `nameKey`, `flat` to `plainText`, `mine` to `ownAddresses`, `titles`/`titlesFrom` to `titleByAddress`/`titleByAddressFrom`, `derive` to `contactsForApplications`; drop `forApplication` and call `derive(db, appId)`.

### CL-WEB-12: Headers and comments that no longer match the file
`web/src/app/pageProps.ts:18-27`, `web/src/app/router.ts:1`, `web/src/sync/recheck.ts:77`, `web/src/pipeline/pystr.ts:145`, `web/src/app/pageProps.ts:6`, `web/src/components/SyncBanner.tsx:1-4`, `web/src/jobs/types.ts:1-4, 34-44`, `web/src/sync/match.ts:1`, `web/src/sync/queries.ts:55`

Evidence (each checked against the code)
- **pageProps.ts holds the route table.** The file is named for `PageProps` but also defines `ROUTES` (the single source of truth for URLs and nav), and router.ts opens with "The route table is ROUTES in pageProps.ts". A newcomer looking for routes will not look in a file called pageProps.
- **recheck.ts:77** "Deletes an application row together with what is keyed to it (the SQLite trigger and cascades)". The hosted edition has no SQLite; the function itself performs the cascade by hand with five Dexie calls. This describes the Python edition.
- **pystr.ts `fold`**: `// keeps kana/Hangul marks` on the `combining && isAscii(prev)` line. PARITY_NOTES.md deviation 4 states that comment is wrong in the Python and the port "reproduces the behaviour, not the comment": marks are dropped, ガ and カ fold to the same key. The wrong sentence was ported along with the code.
- **pageProps.ts:6** says the db is "opened with dbNameFor(user)"; the app calls `dbNameForUser(user)` (localUser.ts) which wraps it.
- **SyncBanner header** claims the two screens "cannot drift apart" (see CL-WEB-5).
- **jobs/types.ts** header and block at 34-44: "the parsing library, the bookmarklet, storage ... and the add form are built separately against these shapes" and a copy of the library API. It is scaffolding from a parallel build; the list duplicates `jobs/index.ts` exports and has already gone out of date (it omits `MAX_PASTE_CHARS`, `sanitizeText`, `isSafeSlug`).
- **sync/match.ts:1** "(jobtracker/match.py)" names the Python file but the real port is pipeline/match.ts (CL-WEB-2).
- **queries.ts:55** "SQLite puts NULL before everything when ascending" explains a Python behaviour to match; in a Dexie codebase it needs "to match the local edition" or readers will search for SQLite.

Suggested change
- Rename `pageProps.ts` to `routes.ts` (keep `PageProps` there if you like) or move `ROUTES` to `router.ts`; update the router header.
- Fix or delete each comment listed. Make the `fold` comment say "combining marks are dropped (matches Python's actual behaviour, see PARITY_NOTES #4)".
- Trim the jobs/types.ts "Library API" block to a pointer to `jobs/index.ts`.

### CL-WEB-13: Magic numbers and limits repeated instead of named once
Examples with locations

| Value | Where | Suggest |
| --- | --- | --- |
| company 80 / role 100 caps | sync/actions.ts:63-64, 83-84; contacts.ts:297-298 (name 80, title 100); duplicates.ts:27-28; detail/index.tsx:173,175 (`maxLength`); QuickRole.tsx:68; PersonCard.tsx:80,84 | `db/limits.ts`: `MAX_COMPANY_CHARS`, `MAX_ROLE_CHARS`, `MAX_NAME_CHARS`, `MAX_TITLE_CHARS`; use in logic and `maxLength` |
| company 60 / role 90 / location 80 / url 500 | jobs/url.ts:6-8, bookmarklet/draft.ts:6 (`LIMITS`), db/postingUrl.ts:5, detail/index.tsx:177 | one source; today the same word "company" is capped at 60, 80, 200 in three layers without a comment on why |
| `UNDO_MS = 8000` | bulk/BulkBar.tsx:14, quickedit/QuickStage.tsx:25 | share one constant |
| `MAX_PASTE_CHARS = 200_000` | jobs/paste.ts:6, joblink/useJobLink.ts:11 | export once |
| `UNKNOWN_ROLE`, `UNKNOWN_COMPANY` | pages/detail/index.tsx:27, review/index.tsx:18-19, people/index.tsx:9 vs pipeline/extract.ts:7-8 | import the pipeline constant; a copy drifting would silently break the "no role" display |
| `maxLength={2000}` | ApplicationPanel.tsx:104 vs `NOTE_MAX` (activity.ts:9) | use `NOTE_MAX` |
| 300, 50 slice limits | queries.ts:135 (suggestions), :176 (ignored list) | `SUGGESTION_LIMIT`, `IGNORED_LIST_LIMIT` |
| gap sizes 28/46/14/6; 8 and 12 iterations; label offsets 10/20/12.5/22 | pages/flow/layout.ts:162, 168, 194, 253-267 | named constants with one-line why ("room for labels above real nodes" is already there for the gaps; 8 and 12 are not explained) |
| 14, 25, 3, 400, 40, 60, 80, 90 | jobs/paste.ts:45,50,59,117,158,171 | `HEAD_LINES` and `SCAN_LINES` are named; the rest are not |
| 3600, `* 1000` | auth/google.ts:204, 246 | `DEFAULT_TOKEN_SECONDS` |
| `[0, 50, 250]` ms | app/App.tsx:55 | has a good comment, but name it `CLOSE_RETRY_MS` |
| `500`, `50` | providers/gmail.ts:108 (`maxResults`), graph.ts:86 (`$top`) | `PAGE_SIZE` with the API's maximum noted |

Suggested change: one small `db/limits.ts` for the user-visible text caps (the ones that appear in both logic and `maxLength`), and a named const per file for the rest.

### CL-WEB-14: Small helpers re-implemented across files
Evidence

- **"Newest first" comparators** (`a.x < b.x ? 1 : a.x > b.x ? -1 : 0`): 13 inline copies (sync/queries.ts:135,161,176,206; contacts.ts:189,252,262; recheck.ts:63,116; rounds.ts:107; activity.ts:151; people/index.tsx:28; sync.ts:83). Add `byDesc(get)`/`byAsc(get)` to a shared helper.
- **Pluralising**: 25 inline `n === 1 ? ... : ...` ternaries and five named variants with different names for the same job: `apps` (Sankey.tsx:4), `applicationsLabel` (BulkBar.tsx:11), `applications` (LocalDataOffer.tsx:26), `plural` (SyncBanner.tsx:49), `n` (settings/actions.ts:178). Pick one `plural(count, "email")` in sync/text.ts.
- **`eventLabel`**: identical in pages/detail/index.tsx:29 and pages/review/index.tsx:21.
- **`errorText`**: pages/settings/SettingsPage.tsx:77, components/SyncBanner.tsx:48; `message` in auth/index.ts:86.
- **Provider display name**: `provider[0].toUpperCase() + slice(1)` in sync/activity.ts:143, sync/sync.ts:234, detail/index.tsx:247; `cap()` in Settings; `PROVIDER_LABEL` (settings/actions.ts:10); `PROVIDER_NAME` (sync.ts:129); `MAIL_LABEL` (auth/index.ts:16); inline ternary in providers/backoff.ts:100. Five maps for two strings.
- **`safeDecode`** named identically in app/router.ts:29 (returns input on error) and jobs/url.ts:38 (decodes runs and strips control chars); same name, different behaviour.
- **`isBulk`**: providers/gmail.ts:57 (exported) and providers/graph.ts:33 (private), verbatim.
- **Base64**: `base64ToBytes` (providers/headers.ts:35) and `b64urlToBytes` (auth/idToken.ts:57).
- **Code-point helpers**: `cpLength`/`truncate` (sync/text.ts) vs `cpLen`/`cpHead` (pipeline/pystr.ts); different names and, for `truncate`, a different early-exit.
- **Record type guard**: `isRec` (portability/validate.ts:18, python.ts:6), `isRecord` (jobs/enrich.ts:51), `isObj` (jobs/jsonld.ts:12).
- **Abort error**: `abortError()` in auth/index.ts:58 and providers/backoff.ts:27; `isAbort` in settings/actions.ts:87; `new DOMException("Aborted","AbortError")` inline in google.ts:225,228 and sync.ts:135.
- **"Not an application" flow** (confirm text, `notAnApplication`, `setFlash`, `navigate("/review")`): pages/detail/index.tsx:132-139 and components/ApplicationPanel.tsx:64-71, identical.
- **Not-found-throw**: `if (!(await db.applications.get(appId))) throw new MissingRecordError(...)` appears six times in sync/actions.ts (82, 96, 103, 110, 117, 125) while `requireApplication` already exists in sync/activity.ts:37 and is not exported.
- **Utility file**: sync/text.ts holds three string helpers; a plain `sync/text.ts` plus `db/time.ts` would be the natural home for `plural`, `byDesc` and `cap`.

Suggested change: consolidate into three small files (compare/plural/label helpers in `sync/text.ts`; `requireApplication` exported from activity.ts or db/repo.ts; one `isRecord` in a shared `types` helper). Rename the two `safeDecode`s (`decodeSegment` for the router, `decodeUrlText` for jobs).

### CL-WEB-15: The ten longest and most tangled functions, with how to split them

Longest (line counts approximate, JSX included):

| # | Function | File:lines | ~Lines | How to split |
| --- | --- | --- | --- | --- |
| 1 | `SettingsView` | pages/settings/SettingsPage.tsx:114-523 | 410 | Five section components plus `useSyncRun` hook (CL-WEB-4). |
| 2 | `ApplicationsPage` | pages/applications/index.tsx:74-349 | 275 | `AddApplicationForm` component, `urlWith()` helper (CL-WEB-6). |
| 3 | `DetailPage` | pages/detail/index.tsx:34-259 | 225 | `EditDetailsForm`, `ApplicationControls` (stage select, MoreMenu, merge/delete steps), `EmailTimeline` (240-257); move the not-an-application flow into one shared hook with ApplicationPanel. |
| 4 | `Results` | pages/flow/index.tsx:76-270 | 195 | `useChartTooltip()` for `tip`/`pinned`/`handlers`, `useImageExport()` for `save`/`copy`/`share`, `FlowTables` for the two `<table>`s (225-267). |
| 5 | `Banner` (incl. `reconnectAndSync`) | components/SyncBanner.tsx:96-282 (159-236) | 187 (78) | Hook `useReconnectAndSync`; the three phases (register, connect each, sync) become three small async functions returning `problems`. |
| 6 | `translate` | pipeline/pyre.ts:58-250 | 190 | See CL-WEB-1. |
| 7 | `parseExportData` | portability/validate.ts:113-285 | 172 | One parser per table (CL-WEB-7). |
| 8 | `LocalDataOffer` | app/LocalDataOffer.tsx:44-215 | 170 | State-machine phase to its own `useCarryOver(db)` hook; render each phase as a small component. Four focus refs and three `focus*` booleans want one `focusAfter` ref holding `"bring" \| "opener" \| null`. |
| 9 | `layoutSankey` | pages/flow/layout.ts:121-286 | 165 | `buildGraph`, `placeColumns` (the inner `place`), `orderColumns` (barycenter loop 191-206), `routeSegments`, `labelFor(node)` (248-284). Interfaces `N`, `F`, `S` should be `LayoutNode`, `LayoutFlow`, `LayoutSegment`. |
| 10 | `useJobLink` | components/joblink/useJobLink.ts:47-207 | 160 | CL-WEB-10. |

Most tangled but shorter (worth a pass even though they fit on a screen or two):

| Function | File:lines | Problem | Split |
| --- | --- | --- | --- |
| `derive` | sync/contacts.ts:181-264 | three phases, terse names (CL-WEB-11) | four helpers |
| `extract` | jobs/bookmarklet/extract.ts:25-175 | 150 lines, one-letter names, five layers in `try` blocks (CL-WEB-9) | rename; inner named helpers per layer |
| `readLines` | jobs/paste.ts:84-181 | `head.forEach` with six early `return`s, mutates `out`, `used`, `roleIndex` | `readLabelled`, `readHeadLine(i, line)` returning a partial `Found`; separate `findLocation` |
| `syncAccount` | sync/sync.ts:147-224 | window calculation, id preload, generator wrapper, two modes, error bookkeeping | `syncWindowStart(...)`, `readProvider(...)` async generator, `recordSyncResult(...)` |
| `candidates` | sync/learn.ts:75-122 | `[number, number]` tuples indexed by 0/1 and destructured as `[nj, j]`; three derivation passes | `{ notJob, job }` objects; one helper per rule kind |
| `listApplications` | sync/queries.ts:58-103 | filter, annotate, sort in one function; the `by` comparator table has two hard-to-read null-last rows (`applied`, `rounds`) | `annotate`, `filterRows`, `sortRows`; extract `nullsLast(cmp)` |

---

## Low

### CL-WEB-16: Misleading or terse names
- `titles()` / `titlesFrom()` return lookups, not lists (`sync/contacts.ts:271,278`): rename `titleByAddress`.
- `apps(n)` in `pages/flow/Sankey.tsx:4` is a pluralising formatter, not applications: `applicationCount(n)`.
- `text` in `sync/queries.ts:54` is a case-insensitive string comparator: `compareText`.
- `untouched()` in `sync/recheck.ts:22` is a boolean: `isUntouched`.
- `cleanIds` (`sync/bulk.ts:12`) also enforces a maximum and throws: `validateIds`.
- `Found` is declared in both `jobs/enrich.ts:22` and `jobs/paste.ts:78` with different shapes.
- `Notice` type shadows the `Notice` component (SettingsPage.tsx:56).
- `done` ref in `QuickRole.tsx:21` / `QuickDate.tsx:26` means "already finished": `finished`.
- `parts` helper in `sync/upcoming.ts:12` (parse a YYYY-MM-DD): `parseDay`; `parts` also means something else in pipeline/mailtext.ts.
- `pipeline().extractCompanyRole` is a pair, fine, but `p` as the local name for `pipeline()` appears in 8 files and `p` also means "pattern" in rules.ts; prefer `pipe`.
- Terse locals worth renaming: `n` (many), `r` (AppRow prop), `x` (SettingsView), `a`/`b` fine in comparators only. In sync/stats.ts `n` is used for both a node id and a count in neighbouring lines (102, 110).
- `joinsTight` in `pipeline/mailtext.ts:32`: `":,;).".includes(ch) || ch === "?"` splits one list into two checks for no visible reason; `sub2` (130) is a name that says nothing, compared to its comment "re.sub(pattern, lambda m: m.group(1), text)": `unwrapBrackets`.
- `String.raw` is aliased `R` in mailtext.ts and extract.ts but written in full in the same files (mailtext.ts:18-19), and in classify.ts.

### CL-WEB-17: Code shaped by test gaps rather than by the runtime it ships to
`web/src/components/Combobox.tsx:76`, `pages/settings/SettingsPage.tsx:314`, `pages/detail/index.tsx:74`, `pages/applications/index.tsx:136`, `pages/flow/index.tsx:16-22`, `jobs/enrich.ts:56-58`

Evidence: `scrollIntoView?.(...)`, `typeof matchMedia === "function"`, `query.addEventListener?.(...)`, `res.headers?.get?.(...)`, `res.body?.getReader?.()` exist so jsdom or hand-made fakes do not throw. In production these always exist, so a reader spends effort wondering which browser lacks them. The `flow/index.tsx` comment ("Absent matchMedia (tests) counts as a desktop") is honest; the others say nothing.

Suggested change: define the missing APIs once in the test setup file (`Element.prototype.scrollIntoView = () => {}`, a `matchMedia` stub) and call them directly in app code.

### CL-WEB-18: Over-defensive checks on typed internal paths
- `sync/actions.ts:139` `if (emails !== "clear" && emails !== "review") throw` on a `"clear" | "review"` parameter; `:205` `if (!isStage(stage))` where `stage` is typed `Stage`; `:228` the `else throw new ActionError("Unknown action.")` in `resolveReview` is unreachable for the discriminated union. Compare `bulk.ts:25,42`. If these guard against hand-edited UI state, say so in one comment; otherwise remove.
- `sync/settings.ts:104-110`: the `sanitize()` overloaded dispatcher is never called (grep finds no caller), and `saveSettings` (126-127) does its own ternary instead; the trailing `throw new Error("Unknown settings section")` is unreachable.
- `jobs/enrich.ts:279` `typeof draft?.url !== "string"` and `:281` re-checks `isSafeSlug`/`isSafeId` that `detectBoard` has already applied (the comment at line 42 explains this one as defence in depth; the line 279 check has none).
- `auth/user.ts:40-41` `typeof email === "string"` where `ClaimsLike` types `email?: string`.
- `pages/detail/index.tsx:89-90` "Checked again here, whatever the database holds": reasonable given import, but the same re-check is absent in `PersonCard` for `c.compose.url.startsWith("https://")` (line 56) and again in `MailActions.safe`; three places for one rule: put it in `mailboxLink`/`replyLink` (which already does it in `links.ts:23`) and drop the UI copies.

Suggested change: keep the guards on data that crosses a trust boundary (imports, URL hashes, provider responses), remove the rest, and mark the surviving ones with a "why" line.

### CL-WEB-19: Thin wrappers and test-only exports that add reading load
- Wrappers over one line: `sync/links.ts` (all three), `sync/match.ts:12 sameRole`, `contacts.ts:266 forApplication`, `db/repo.ts` `getApplication` (100), `emailsForApplication` (57), `getContactEdit` (173), `db/time.ts parseIso` (11), `detail/index.tsx:91 say = (m) => setNotice(m)`, `actions.ts:129 unlockStage`.
- No non-test caller found for `getApplication`, `emailsForApplication`, `getContactEdit`, `parseIso`, `dayLabel` (`upcoming.ts:56`), `StageCell` (`StageBadge.tsx:12`), `sanitize` (settings.ts:104), `syncAll` (sync.ts:227). The dead-code pass should confirm, but for clarity they make a reader ask "which one do I call?".
- The pipeline renders email text to an HTML string (`pipeline/mailtext.ts` `inline`, `blocksToHtml`, `render`) and `components/EmailText.tsx` immediately parses that string with `DOMParser` back into React nodes (toNodes, lines 10-26). That round-trip is documented as a security measure, but a reader meeting `render()` in mailtext.ts (used by parity tests only) next to EmailText will not know which path is live. A header sentence in mailtext.ts saying "the app uses `parts` and `blocksToHtml` via EmailText; `render` exists for parity tests" would settle it.

### CL-WEB-20: Thin documentation on the Python-semantics helpers
`web/src/pipeline/pystr.ts:35-90, 107-113, 149`; `web/src/pipeline/rules.ts` (fine)
- `combining`, `rstrip`, `rpartition`, `casefold`, `isAscii`, `SPACE_CLASS` have no comment on why a plain JS call is not enough (the file header says it once, generally). `rstrip` has no summary line while `strip` does.
- `/** Message.sender_domain */` (classify.ts:53) and `/** markupsafe.escape */` (pystr.ts:136) name the Python equivalent but not what the function does; the others in the file ("str.strip(chars) / str.strip()...") do both.
- `pipeline/index.ts` re-exports with `export *`, so `parts`, `render`, `blocks`, `inline`, `joins`, `NO_REPLY`, `search`-like generic names leak into one namespace. `blocks` and `parts` are particularly generic once imported by name in `components/EmailText.tsx`: `import { blocksToHtml, parts } from "../pipeline"`.
- Verdict for pyre/pystr/rules: rules.ts is clear as is (small, with a header that names the generator). pystr.ts and pyre.ts are good "what and why" at file level (and PARITY_NOTES.md is excellent), but a beginner would struggle inside the function bodies (CL-WEB-1).

### CL-WEB-21: Inconsistent patterns among similar components
- **Test injection** is done four different ways: `SettingsView`/`SyncBanner` take `deps?: Partial<Deps>` merged over `defaultDeps`; `ApplicationsPage` takes `deps` typed as `Partial<JobLinkDeps> & { addApplication? }` and unwraps with `deps.addApplication ?? real` plus `(deps.draftFromHash ?? realJobLinkDeps.draftFromHash)`; `App` takes `auth`, `loaders`, `openDb`, `local` props; the sync layer has `setPipeline`. Pick one style (the `{ ...defaultDeps, ...given }` form is the cleanest).
- **Inline confirm** appears as `Confirm` (Settings), `BulkDeleteConfirm`, the carry-over `confirm` phase, the detail page `step === "delete"` block, and `window.confirm` in detail, ApplicationPanel and PersonCard. Same job, five shapes; the keyboard and focus behaviour differ among them (Settings and Bulk focus Cancel; detail does not).
- **Undo-for-eight-seconds** is implemented separately in `BulkBar` and `QuickStage` (CL-WEB-13).
- **Keyboard handling**: `QuickRole` defines `onKey`; `QuickDate` inlines the same Enter/Escape logic in JSX (lines 79-82).
- **Icons**: ApplicationPanel.tsx:148 draws an inline `<svg>` for the arrow while detail/index.tsx:159 uses lucide `ExternalLink` for the same "open" meaning.
- **JSX spacing and separators**: `{"·"}` (9 uses) and `<> <FollowUpTag /></>` space hacks (4 uses) are used to dodge JSX whitespace rules; a small `<Dot />` or `{" "}` convention would read better.
- **Section dividers and comment density** differ: `// -- applications ---` (actions.ts, repo.ts), `// ----- names from slugs` (jobs/url.ts), none elsewhere; bulk/ and quickedit/ carry four- and five-line docblocks on small components while pipeline/ and sync/ stay terse. Not wrong, just uneven.

---

## Strengths

- **Headers explain purpose and constraints**, usually with the reason: `auth/index.ts` (tokens in memory only), `app/router.ts` (never writes the hash by itself), `sync/syncLock.ts`, `sync/followUp.ts`, `app/carryOver.ts`, `db/postingUrl.ts` ("one rule, used wherever a link is saved, imported or shown"), `jobs/enrich.ts` ("only four boards, only fixed hosts, never throws").
- **Small pure modules in sync/** with named constants and docstrings that state the rule and the edge case: `followUp.ts`, `groupBy.ts`, `rounds.ts` (`HORIZON_DAYS`, `SCAN`, `MAX_ROUNDS`, the doc on `interviewMeetings`), `upcoming.ts`, `duplicates.ts`, `bulk.ts` ("Refuses a list longer than BULK_MAX rather than quietly doing part of it").
- **PARITY_NOTES.md** and the pipeline headers make the port's contract and its known deviations explicit; `rules.ts` is the right size and shows the generated-data pattern well.
- **Comments say why**: "A negated offer is a rejection, not an offer" (classify.ts:130), "A learned block is built from a few clicks, so it must never hide mail that says, in its subject, that it is about an application" (97-99), "Focus starts on Cancel, the safe choice for an action that cannot be undone", "An id that does not match means the slug guessed from a company site was the wrong board".
- **User-facing copy** is consistently plain sentence case and the error strings are written for the reader, not the programmer (`syncFailureText`, `messageFor`, the import errors).
- **Naming of exported API** is mostly verb-noun and accurate (`rememberUnrelated`, `settleReview`, `fillMissingRoles`, `cleanOfferSalary`, `parsePostingUrl`, `needsFollowUp`).
- **Type discipline**: only five `as unknown as` casts (auth/google.ts:48, portability/index.ts:41, portability/python.ts:61, sync/sync.ts:173, bookmarklet/extract.ts:186) and one `any` cluster (bookmarklet/extract.ts, CL-WEB-9) in the whole of src; effect-dependency suppressions are each commented or obvious.
- **Accessibility reasoning is written down** where it affects structure (SkipLink, focusHeading, role/aria choices in bulk and quickedit), which helps the next person avoid undoing it.

## Files that most need attention

| File | Why | Findings |
| --- | --- | --- |
| web/src/pages/settings/SettingsPage.tsx | 410-line component, shadowed type name, duplicated sync wording | CL-WEB-4, 5, 15, 16 |
| web/src/pipeline/pyre.ts | 190-line translate with duplicated escape code, garbled header table | CL-WEB-1, 20 |
| web/src/sync/match.ts + pipeline/match.ts | Two copies of the matching rules | CL-WEB-2, 3 |
| web/src/sync/pipeline.ts, pipelineTypes.ts, links.ts | Three pass-through layers, mirrored types, header not true | CL-WEB-3 |
| web/src/components/SyncBanner.tsx + pages/settings/actions.ts | Duplicate progress/result logic, inverted layering, unused `syncAll` | CL-WEB-5 |
| web/src/pages/applications/index.tsx | 275-line page, URL rebuilt six times | CL-WEB-6, 15 |
| web/src/pages/detail/index.tsx | 225-line page, duplicated flows and constants | CL-WEB-13, 14, 15 |
| web/src/portability/validate.ts | 172-line function, unnamed limits | CL-WEB-7 |
| web/src/jobs/url.ts | Hardest regexes and brand handlers unexplained | CL-WEB-8 |
| web/src/jobs/bookmarklet/extract.ts | One-letter names, `any`, run-on header | CL-WEB-9 |
| web/src/components/joblink/useJobLink.ts | 8 refs, six repeated cancel blocks, duplicate strings | CL-WEB-10 |
| web/src/sync/contacts.ts | 84-line three-phase function, terse names, list-named lookups | CL-WEB-11 |
| web/src/app/pageProps.ts + router.ts | File holds routes but is named for props | CL-WEB-12 |
| web/src/pages/flow/layout.ts, flow/index.tsx | 165- and 195-line functions, unnamed layout numbers | CL-WEB-13, 15 |
| web/src/sync/actions.ts | Repeated not-found throw, 80/100 caps, over-defensive guards | CL-WEB-13, 14, 18 |
