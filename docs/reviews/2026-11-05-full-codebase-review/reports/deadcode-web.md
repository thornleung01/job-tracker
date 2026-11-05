# Dead-code scan: web/ (hosted edition), branch easy-connect

Scope: web/src, web/tests, web/public, web/package.json, web/vite.config.ts, web/tsconfig.json, web/index.html. Read-only; nothing in the repo was changed. All paths are under /Users/thorn.leung/job-tracker/web.

Headline: the hosted edition is clean. `tsc --noEmit --noUnusedLocals --noUnusedParameters` reports one issue (a test parameter). No commented-out code, no skipped tests, no orphan modules, no unused fixtures, no unused npm packages. The real findings are a handful of zero-reference exports, test-only production code, dead barrel re-exports, three dead CSS fragments, Google-ID-token leftovers, and duplicated helpers.

Reading guide: "zero refs" means zero references in src and tests (word-boundary match, with barrel `export {..} from` lines stripped so they do not count as uses). "test-only" means referenced only from web/tests.

Important caveat on web/src/styles/base.css: its header says it is ported verbatim from jobtracker/templates/base.html and must be kept in step. Rules that look dead in the hosted app can be live in the local Flask edition, so I did not recommend removing those (see DC-WEB-5).

---

## Dead Code

### DC-WEB-1  Four zero-reference DB helpers
- **Files**: src/db/repo.ts:57-59 `emailsForApplication`, src/db/repo.ts:100-102 `getApplication`, src/db/repo.ts:173-175 `getContactEdit`, src/db/time.ts:11-13 `parseIso`
- **Evidence**: `grep -rnE "(^|[^\w$])(emailsForApplication|getApplication|getContactEdit|parseIso)\b" src tests` returns only the 4 declarations (4 hits, 0 elsewhere). Own-file count is 1 for each, so they are not used locally either.
- **Recommendation**: delete the four functions. After removing `getContactEdit`, the `type ContactEditRow` import at repo.ts:7 becomes unused (tsc will flag it), so remove it too. `EmailRow` and `ApplicationRow` are still used in repo.ts.
- **Risk**: safe. **Size**: about 16 lines.

### DC-WEB-2  `EMPTY` in learn.ts
- **File**: src/sync/learn.ts:40 `export const EMPTY = new Learned();`
- **Evidence**: `grep -rnw EMPTY src tests` finds this one line outside unrelated `EMPTY_DRAFT` (different word). Zero refs.
- **Recommendation**: delete. **Risk**: safe. **Size**: 2 lines.

### DC-WEB-3  `setPipeline` test seam that no test uses
- **File**: src/sync/pipeline.ts:31-33 (and the comment on line 2 "setPipeline() lets a test swap in a stand-in")
- **Evidence**: `grep -rn setPipeline src tests` returns the declaration and the comment only (2 hits). Tests never call it.
- **Recommendation**: delete the function, change `let current` (line 29) to a plain `const`/inline `realPipeline`, and drop the comment sentence. The Pipeline interface in pipelineTypes.ts stays (it is the adapter contract).
- **Risk**: safe. **Size**: about 4 lines.

### DC-WEB-4  Dead re-exports and an unused module-level wrapper
- **Files**:
  - src/sync/learn.ts:12 `export { recordFeedback as record, senderAddress } from "../db/repo";`
  - src/auth/index.ts:10-11 `export { dbNameFor, userKey, type AuthUser, type IdentityProvider }` and `export { IdTokenError, validateIdToken }`
  - src/auth/index.ts:273 `export const currentUser = () => auth().currentUser();`
- **Evidence**: every `learn` consumer is a namespace import and uses only `learn.rebuild`, `learn.undo`, `learn.activeRules`, `learn.RuleView`, `learn.loadLearned` (scripted over all `import * as learn`). Nothing imports `record` or `senderAddress` from learn. For the auth barrel, a resolver over all imports of "../auth", "../../auth", "../../src/auth" found importers for `Session`, `createAuth`, `Auth`, `getSession`, `prepare`, `signIn`, `signOut`, `subscribe`, `takePendingSync`, `isAuthPopupWindow` and for the namespace members `connectMail/getSession/subscribe/takePendingSync/tokenSource/signOut`; none for the six names above. `grep -rnw "currentUser" src tests` shows only the `Auth.currentUser()` interface method and instance calls in tests, never the module-level export.
- **Recommendation**: delete learn.ts:12, auth/index.ts:10-11 (keep `export type { Session }` on line 12), and auth/index.ts:273. Callers that need `dbNameFor`/`IdTokenError` already import from "./user" and "./idToken" directly.
- **Risk**: safe (module-internal barrels, no external consumers in a private web app). **Size**: 4 lines.

### DC-WEB-5  Dead CSS selectors
- **Files**: src/components/components.css:3 (`.f-fill` inside a selector list), src/components/components.css:12 (`.panel-danger`), src/styles/base.css:347 (`.person-name`)
- **Evidence**: all 261 distinct class names across the 582 rules in 25 stylesheets were checked against string literals in src/**/*.ts(x) and index.html, including dynamic prefixes (`badge ${stageClass}`, `tag tag-${i.kind}`, `panel-${r.id}`). 8 classes had no literal reference. Of these:
  - `f-fill`, `panel-danger`: `grep -rn "f-fill\|panel-danger" src ../jobtracker` finds only the CSS. `panel-` appears dynamically only as the element id `panel-${r.id}`, not a class. Dead.
  - `person-name`: used by nothing in src or in jobtracker/templates except the CSS definition (base.html:356); only a test selector fallback `".person-name, .person-head strong"` (tests/pages/detail/detail.test.ts:273) mentions it, and `.person-head strong` satisfies that test. Dead in both editions.
  - NOT dead, do not remove: `tag-note` and `tag-step` (built by `tag-${i.kind}` at ApplicationPanel.tsx:122; note rows come from imported data), `Heard-back` (built by `stageClass`), `.reply-form` (jobtracker/templates/_reply.html:6) and `.badge.score` (jobtracker/templates/jobs.html:72), which are live in the local edition and base.css must stay in step.
- **Recommendation**: remove `.panel-danger` (1 line) and the `.f-fill` fragment from the selector list at components.css:3; remove `.person-name` from base.css (and the same line in jobtracker/templates/base.html to keep the two in step).
- **Risk**: safe for the two components.css items; check first for `.person-name` because it lives in the shared base stylesheet. **Size**: 2 lines.
- Also noted, not recommended for removal: CSS custom properties `--applied`, `--assess`, `--heard`, `--interview` (base.css:23-24) have no `var()` use in either edition, but the lines are shared with the local template.

### DC-WEB-6  `yaml` is a runtime dependency but only tests import it
- **File**: package.json (`dependencies.yaml`)
- **Evidence**: `grep -rn "yaml" src --include='*.ts' --include='*.tsx'` returns 0 imports (only prose in comments and PARITY_NOTES.md); the one import is tests/pipeline/rules-sync.test.ts:4 `import { parse } from "yaml"`.
- **Recommendation**: move `"yaml": "^2.6.0"` from `dependencies` to `devDependencies`. Other dependencies are all used: @azure/msal-browser (src/auth/microsoft.ts:4,33), dexie (6 files), lucide-react (Shell.tsx, MoreMenu.tsx, detail/index.tsx), react/react-dom; devDependencies fake-indexeddb (27 files), jsdom (vite.config.ts), vitest, @vitejs/plugin-react, vite, typescript, @types/react(-dom).
- **Risk**: safe (bundle is unchanged because Vite tree-shakes by import, so this is hygiene). **Size**: 0 lines.

### DC-WEB-7  `StageCell` is superseded by `QuickStage`
- **Files**: src/components/StageBadge.tsx:11-19; tests/components/stage/stage.test.ts:4 (import) and :93-96 (the "notes a stage you set by hand" test)
- **Evidence**: `grep -rn StageCell src` returns only the declaration (1 hit); tests: 4 hits all in stage.test.ts. The list's stage cell is now `QuickStage` (src/components/quickedit/QuickStage.tsx:62 renders the same "set by you" note inline); the detail page uses `StageBadge` directly.
- **Recommendation**: delete `StageCell` and its test; keep `StageBadge` and `stageClass`.
- **Risk**: check first (confirm no external deep link; none found). **Size**: about 15 lines (9 src, 6 test).

### DC-WEB-8  `userDbName` duplicates `dbNameFor`
- **Files**: src/db/schema.ts:159-162 `userDbName(iss, sub)`; src/auth/user.ts:30-32 `dbNameFor(user)` (production)
- **Evidence**: both return `jobtracker:${iss}:${sub}` (`dbNameFor` goes through `userKey` and adds validation). `grep -rn userDbName src` finds only the declaration; tests: 7 uses in tests/db/db.test.ts.
- **Recommendation**: delete `userDbName` and change tests/db/db.test.ts:7,157,158,172 to `dbNameFor({ iss, sub })`, so the test exercises the function production uses.
- **Risk**: check first (test edit). **Size**: 5 lines.

### DC-WEB-9  `extractCompany` and `extractRole` convenience wrappers
- **File**: src/pipeline/extract.ts:121-122
- **Evidence**: zero refs in src and tests (own count 1). The Python source has no `extract_company`/`extract_role` (`grep -n "def extract_company\b\|def extract_role\b" jobtracker/*.py` finds nothing), so they are not parity surface. Callers use `extractCompanyRole`.
- **Recommendation**: delete. Because the pipeline barrel is `export *`, treat as a tiny public-surface change.
- **Risk**: check first. **Size**: 3 lines.

### DC-WEB-10  Production code reachable only from tests
- **Evidence** (src refs = 0, test refs shown):
  - src/sync/activity.ts:59-70 `addNote` (16 test refs in 4 files). The UI (ApplicationPanel.tsx:5) imports only `addStep`, `deleteEntry`, `history`. Notes can still exist as imported `kind: "note"` rows, so the `history()` rendering of notes and the `tag-note` CSS stay.
  - src/sync/sync.ts:226-243 `syncAll` (3 test refs, all tests/sync/syncAccount.test.ts). Settings syncs per account via `syncAccount` (pages/settings/actions.ts:106).
  - src/sync/upcoming.ts:55-56 `dayLabel` (4 test refs); components use `dayWhen(...).text` (ComingUp.tsx:17, InterviewLine.tsx:7).
  - src/pipeline/mailtext.ts:198-201 `cleanMailText` (5 test refs; PARITY_NOTES.md:45 documents it as "new, not in Python").
  - src/db/repo.ts:127-131 `openApplications` (1 test, tests/db/db.test.ts:121).
  - src/auth/index.ts:50 and :243 `Auth.currentUser()` method (4 test assertions in tests/auth/auth.test.ts; replaceable by `getSession().user`).
  - Not flagged: `makeLearned` (classify.ts:26, documented parity helper, 9 test refs) and `forgetConnections` (settings/actions.ts:19, resets module state between tests; legitimate test hook).
- **Recommendation**: delete the functions and move the few test call sites to the production path (for example seed note rows with `db.activity.add`, call `syncAccount` per account, assert `dayWhen(...).text`). Update PARITY_NOTES.md:45 if `cleanMailText` goes.
- **Risk**: check first (tests must be rewritten; `addNote` may be wanted for a notes UI later: confirm with the owner before deleting). **Size**: about 46 production lines plus about 35 test lines changed.

### DC-WEB-11  Barrel re-exports nobody imports through the barrel
- **Files and names** (resolver over every `import ... from "<barrel>"`, incl. multi-line and `import * as`):
  - src/providers/index.ts:6-9: all of `createGmailProvider, getGmailAddress, parseGmailMessage, EXCLUDE, GMAIL, GmailOptions, GmailProvider, createGraphProvider, getGraphAddress, parseGraphMessage, GRAPH, SKIP_FOLDERS, GraphOptions, GraphProvider, htmlToText, ProviderHttpError, RETRY_WAITS, parseRetryAfter, HttpOptions, Sleep`. Only `createProvider` and `getAddress` (defined in that file) are imported (SyncBanner.tsx:14, SettingsPage.tsx:13, settings/actions.ts:6). Tests import these from the individual files.
  - src/jobs/index.ts: `sanitizeText, BoardId, BoardRef, MAX_RESPONSE_BYTES, MAX_ASHBY_LISTING_BYTES, DEFAULT_TIMEOUT_MS, MAX_PASTE_CHARS, EnrichOptions, EMPTY_DRAFT` (0 importers). Others (`cleanJobUrl`, `detectBoard`, ...) are test-only through the barrel.
  - src/pipeline/index.ts:7 `loadRules, compileRules, Rules` (0 importers via barrel; tests import from ./rules).
  - src/portability/index.ts:12 `parseEnvelope, parseExportData`; src/jobs/bookmarklet/index.ts `launch`, `Extracted`.
- **Recommendation**: trim the re-export lists to what is imported. This is optional tidying.
- **Risk**: public-API-like (barrels are the modules' intended surface; a later feature may want them). **Size**: about 8-10 lines.

### DC-WEB-12  SyncBanner `local` prop and `isLocalMode()` check are redundant
- **Files**: src/components/SyncBanner.tsx:11 (import), :76-77 (`local?: boolean`), :92 (`(props.local ?? isLocalMode()) || isLocalUser(user)`); src/app/App.tsx:151 (`local={false}`)
- **Evidence**: the only production render site is App.tsx:151, which is already inside `!isLocalUser(user)` and passes the constant `local={false}`. A local user is the only thing that exists in local mode, so `isLocalUser(user)` alone covers the local-mode check. `grep -rn "<SyncBanner" src` returns 1 hit. The `local` prop is only used by tests/components/syncbanner/syncbanner.test.ts:23,64,66,80.
- **Recommendation**: drop the `local` prop and the `isLocalMode` import; keep `isLocalUser(user)`. Change the syncbanner test at :79-80 to render with `LOCAL_USER`. Note `App`/`mount` also take a `local` prop (App.tsx:27, mount.tsx:11); those are used by tests/local and are a legitimate test seam, so leave them.
- **Risk**: check first. **Size**: about 6 lines.

### DC-WEB-13  Leftovers of the removed Google ID-token flow
- **Evidence**: src/auth/idToken.ts is still live, but only for Microsoft (src/auth/microsoft.ts:6,141); google.ts now identifies via tokeninfo and its header says "Google sign-in no longer uses ID tokens" (idToken.ts:8).
  - idToken.ts:38 (`azp`), :92 (destructure), :100-102: the "several audiences and azp" branch is Google ID-token behaviour. Microsoft v2 ID tokens carry a single `aud` and no `azp`, so this branch cannot trigger for the only remaining caller. Uncertain: I cannot prove from grep what a tenant's token contains; verify against a real Microsoft ID token before removing.
  - tests/auth/idToken.test.ts:25-27 (Google bare-host issuer), :38-42 (azp audience list), and the `GOOGLE_ISSUERS` constant at :6, plus `googleClaims()` at tests/auth/helpers.ts:21-32 (its only importer is idToken.test.ts). These test the validator with Google-shaped claims. The suite could use `msClaims` and `MICROSOFT_ISSUER` throughout.
  - src/app/router.ts:26 `isAuthResponseHash` accepts `id_token=` in the fragment, but MSAL v4 popups return `#code=...&state=...` (authorization code + PKCE); `isAuthPopupWindow` (auth/index.ts:279) already checks only `code|error|state`. `id_token` is implicit-flow only. Uncertain: could not prove MSAL never emits it; the router test at tests/app/router.test.ts:45 asserts it today.
- **Recommendation**: remove the azp branch and the Google-flavoured test cases/helper after verifying a Microsoft token; consider dropping `id_token` from the regex and router test.
- **Risk**: check first (security-adjacent validator: keep the nonce/audience/issuer tests). **Size**: about 20 lines (code 6, tests 14).

### DC-WEB-14  Indexes with no production query (informational)
- **File**: src/db/schema.ts:141 `applications: "++id, companyKey, stage, lastActivity"`
- **Evidence**: `.where("companyKey")` is used (repo.ts:133, duplicates.ts:41). `.where("stage")` is used only by tests (tests/pages/applications/bulk.test.ts:284, tests/sync/bulk.test.ts:73); nothing orders or queries by `lastActivity` (`grep -rnE "(orderBy|where|sortBy)\(\"lastActivity\"" src` is empty).
- **Recommendation**: leave as is. Dropping an index needs a Dexie schema version bump for existing users, and the schema mirrors the Python one. Listed for completeness only.
- **Risk**: public-API-like (persistent schema). **Size**: 0.

---

## Refactoring Opportunities

### DC-WEB-15  Duplicated helpers that should be consolidated
Keep the first location listed; the others import it.
- **`eventLabel` and `UNKNOWN_ROLE`**: byte-identical in src/pages/detail/index.tsx:27-32 and src/pages/review/index.tsx:19-24. `UNKNOWN_ROLE` is also defined in src/pages/people/index.tsx:9 and exported from src/pipeline/extract.ts:8; `UNKNOWN_COMPANY` is in src/pipeline/extract.ts:7 and src/pages/review/index.tsx:18. Keep src/pipeline/extract.ts for the constants (already exported through the pipeline barrel) and move `eventLabel` to a shared component/util module (for example src/components/ or src/sync/text.ts). About -14 lines.
- **error to string**: `errorText` at src/components/SyncBanner.tsx:48 and src/pages/settings/SettingsPage.tsx:77, plus `message` at src/auth/index.ts:86 and an inline copy at src/sync/sync.ts:238. Keep one exported helper (src/sync/text.ts is a natural home). About -4 lines.
- **`readDismissed`**: src/app/LocalBanner.tsx:9 and src/app/LocalDataOffer.tsx:10 differ only in the storage key. Keep one `readFlag(key)` helper. About -7 lines.
- **`isRec`**: src/portability/python.ts:6 and src/portability/validate.ts:18, identical. Export from validate.ts and import in python.ts. -1 line.
- **`abortError`**: src/auth/index.ts:58 (local, no-arg) and src/providers/backoff.ts:27 (exported, honours `signal.reason`); three more inline `new DOMException("Aborted", "AbortError")` at auth/google.ts:225,228 and auth/microsoft.ts:160. Keep backoff.ts's version (it is the more correct one) or move it to a small shared module so auth does not import from providers. About -4 lines.
- Not a duplicate: `safeDecode` in router.ts:29 (simple) vs jobs/url.ts:38 (hardened, strips control characters); keep both. The sync/links.ts, sync/match.ts and sync/pipeline.ts wrappers are the documented single-import adapter, not duplication.
- **Risk**: check first. **Size**: about -30 net lines, plus clearer ownership.

### DC-WEB-16  124 exports used only inside their own file (low value)
- **Evidence**: of 768 named exports analysed, 131 have no reference outside their file in src or tests (59 types and 65 values are used locally; 7 are fully dead and covered by DC-WEB-1/2/9). Examples: `useUserDb` (App.tsx:45), `currentNav` (Shell.tsx:22), `decodeJwt` (idToken.ts:75), `createMsalClient` (microsoft.ts:32), `LIMITS`/`cleanField`/`safeUrl` (bookmarklet/draft.ts), the learn.ts threshold constants, layout.ts constants.
- **Recommendation**: optional: drop the `export` keyword so the module surface matches reality. Not worth a dedicated change; do it opportunistically.
- **Risk**: safe. **Size**: 0 lines.

### DC-WEB-17  11 `eslint-disable` directives with no ESLint configured
- **Evidence**: `grep -rn eslint-disable src tests` returns 11 hits (App.tsx:132, useQuery.ts:14, LocalDataOffer.tsx:87, appearance.tsx:25, SyncBanner.tsx:154, useJobLink.ts:137, detail/index.tsx:58, flow/index.tsx:152, applications/index.tsx:167, tests/pipeline/parity.test.ts:18 and :34). package.json has no eslint dependency and no config file exists in web/ or the repo root.
- **Recommendation**: either add ESLint (the directives then document deliberate exhaustive-deps omissions) or turn them into plain comments. Do not delete without deciding which.
- **Risk**: safe. **Size**: 0-11 lines.

### Markers and commented-out code (all of them)
- TODO/FIXME/HACK: exactly one, src/auth/idToken.ts:6 `TODO(signature)` (verify RS256 against the JWKS). Marked for future work: not flagged as dead.
- Commented-out code: none found (`grep -rnE "^\s*//\s*(const|let|var|function|import|export|return|if|for|await|expect|it\(|describe\()" src tests` returns only prose in src/app/pages.ts:2; block comments are all explanatory).
- `console.*`: 7 `console.error/warn` calls are intentional logging, not debug leftovers. No `debugger`.

---

## Test Cleanup Opportunities

### DC-WEB-18  popup-hint.test.ts repeats google.test.ts
- **Files**: tests/auth/popup-hint.test.ts:38-43 and :45-50 vs tests/auth/google.test.ts:229-235 and :237-243; helper `rejection` is defined in both (popup-hint.test.ts:18, google.test.ts:58).
- **Evidence**: "is the message when the browser blocks the window during login" asserts `signIn()` rejects with `POPUP_HINT` on `popup_failed_to_open`: identical to google.test.ts:229 ("gives the popup hint when the browser blocks the window"). "is not used when the person closes the login window" asserts `"Login was cancelled."` on `popup_closed`: identical to the first half of google.test.ts:237. The other four tests in popup-hint.test.ts (hint text, and the three `requestMailToken` cases) are unique: google.test.ts:279-297 only checks `NotConnected`, not the message.
- **Recommendation**: delete the two duplicate tests (about 13 lines). Optionally move the four unique `requestMailToken` hint tests into google.test.ts and delete popup-hint.test.ts together with its second copy of `authWith`/`rejection`.
- **Risk**: safe. **Size**: about 13 lines (up to about 50 if merged).

### DC-WEB-19  Near-identical DOM test helpers in several places
- **Evidence**:
  - `freshDb`: tests/app/helpers.ts:135, tests/pages/applications/harness.ts:20, tests/sync/helpers.ts:10 (three implementations of "open a uniquely named fake-indexeddb DB and track it for cleanup").
  - `settle`, `waitFor`, `click`: tests/app/helpers.ts:46,56,76 and tests/pages/applications/harness.ts:74,81,95 (same `act` + `quiesce` pattern; differ in defaults and return values). Further local copies: `click` in tests/components/more-menu/more-menu.test.ts:30, `settle` in tests/pages/flow/page.test.ts:56.
  - `daysAgo`: tests/pages/applications/harness.ts:35, tests/pages/flow/page.test.ts:22 (returns ISO), tests/sync/activity.test.ts:14.
  - `mk`: tests/pipeline/helpers.ts:4 and tests/sync/helpers.ts:29 have different signatures; leave.
- **Recommendation**: move the shared parts (DB tracking, `settle`, `waitFor`) into tests/support/helpers.ts, which already hosts `quiesce` for exactly these two files. Keep a thin wrapper where defaults differ (40 vs 20 ms).
- **Risk**: check first (timing-sensitive helpers; run the full suite several times, since tests/support/helpers.ts documents CI-load flakiness). **Size**: about -30 lines.

### DC-WEB-20  Unused parameter in a test
- **File**: tests/providers/graph.test.ts:117 `scriptedFetch((call, n) => {`
- **Evidence**: `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` reports `tests/providers/graph.test.ts(117,42): error TS6133: 'n' is declared but its value is never read.` It is the only diagnostic. tsconfig.json enables `noUnusedLocals` but not `noUnusedParameters`.
- **Recommendation**: drop `n`. Optionally enable `noUnusedParameters` in tsconfig.json so this stays clean (src is already clean).
- **Risk**: safe. **Size**: 0 lines.

### Tests checked and found fine
- All four JSON fixtures are referenced: pipeline-golden.json (parity.test.ts, PARITY_NOTES.md), python-export.json (5 files), python-export.golden.json (2 files), site-config.empty.json (vite.config.ts alias, site-config-alias.test.ts).
- All test-helper exports have importers; the only name-level zeros are the type-only `Fixture`, `Mounted`, `Call` (used locally) and the `$`/`$$` helpers, which my first regex missed and a second pass confirmed are imported in 17 and 11 files.
- No `it.skip`, `it.todo`, `it.only`, `xit`, `xdescribe` anywhere.
- tests/app/signincss.test.ts reads signin.css as text; the `.google-btn`/`.signin-skip` selectors it checks exist and are used.

---

## Verification log

Commands run (all from web/ unless noted):
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`: 1 diagnostic (DC-WEB-20).
- `git ls-files src tests` to define the file set; wrote a Python script (scratchpad/work/exports.py) that extracts every `export const|function|class|type|interface|enum`, `export {..}`, `export {..} from`, `export *`; counted word-boundary references in all .ts/.tsx under src and tests (plus index.html, vite.config.ts) excluding the declaring file; a second pass stripped `export {..} from` lines so barrels do not mask dead origins (this surfaced the barrel findings).
- Barrel resolver: parsed every `import ... from` (multi-line, type, namespace) resolving relative paths to src/{jobs,pipeline,portability,providers,auth,jobs/bookmarklet}/index.ts and listed which re-exported names are actually imported.
- Orphan-module resolver: resolved every relative import/dynamic import/`import.meta.glob`; only src/main.tsx (HTML entry) and src/pages/settings/index.tsx (glob target) have no importer, both expected.
- CSS: extracted every `.class` from selector preludes of all 25 .css files (261 distinct, 582 rules), checked against string literals in src (comments stripped) and dynamic prefixes (`count-`, `tag-`, `stage-`, `panel-`, ...); then grepped jobtracker/ (local edition) for the 8 survivors. Also checked 1 ID, 4 data-* attribute selectors (all referenced), 64 CSS custom properties (4 unused, see DC-WEB-5), and 2 @keyframes (both used).
- npm: grepped imports for each of the 6 dependencies and 8 devDependencies; checked vite.config.ts (jsdom, plugin-react, alias to tests/fixtures/site-config.empty.json), tsconfig.json (`types: ["vite/client"]`).
- Files: referenced each CSS, JSON, font, SVG, HTML asset by basename (all referenced; src/assets/fonts/LICENSES.md and src/pipeline/PARITY_NOTES.md are documentation).
- Duplicate scan: listed every top-level function/arrow const name defined in more than one file, then read each pair.
- Interface-member scan: 817 interface members checked for zero other occurrences (only external-API mirror fields `GisTokenResponse.error_description` and `IdTokenClaims.iat` have one; left alone).
- Markers: grepped TODO|FIXME|HACK|XXX (1 real hit; fixture JSON noise excluded), commented-out code patterns (0), skipped tests (0), `eslint-disable` (11).

Totals scanned:
- Exports: 783 export names/statements found; 768 analysed by name (plus default/star exports); 87 test-helper/fixture exports checked separately.
- Result buckets for the 768: 546 used by src, 91 test-only, 131 no outside reference (59 types, 65 values used locally, 7 fully dead).
- Selectors: 261 distinct classes in 582 rules across 25 CSS files; 1 ID, 4 data attributes, 64 CSS variables, 2 keyframes.
- Files: 273 tracked files under web/ (143 src .ts/.tsx, 87 tests .ts, 25 .css, plus JSON, fonts, HTML, SVG, markdown); 6 dependencies, 8 devDependencies.
- Interface members: 817.

Uncertainty that grep cannot settle:
- Dynamic class construction beyond the template prefixes listed; I found no string-concatenated class that could resurrect the 3 CSS removals.
- Whether a Microsoft ID token can ever carry multiple audiences/`azp` (DC-WEB-13) and whether MSAL ever emits `id_token=` in the popup fragment.
- Whether `addNote` is planned for a notes UI (DC-WEB-10) and whether the pipeline/providers barrels are intended as stable surfaces (DC-WEB-11).
- base.css is shared with the local Flask edition; "dead in web" is not "dead in the repo" for anything in that file.

---

## Cleanup plan (safe first)

| Order | Finding | What | Risk | Lines |
|---|---|---|---|---|
| 1 | DC-WEB-1 | Delete 4 zero-ref DB helpers (+ unused ContactEditRow import) | safe | 16 |
| 2 | DC-WEB-2 | Delete `EMPTY` | safe | 2 |
| 3 | DC-WEB-3 | Delete `setPipeline`, make `current` const | safe | 4 |
| 4 | DC-WEB-4 | Delete dead re-exports and `currentUser` wrapper | safe | 4 |
| 5 | DC-WEB-5 | Delete `.panel-danger`, `.f-fill` (and `.person-name` in both stylesheets after a look) | safe / check first | 2 |
| 6 | DC-WEB-6 | Move `yaml` to devDependencies | safe | 0 |
| 7 | DC-WEB-20 | Drop unused test param `n` (optional: enable noUnusedParameters) | safe | 0 |
| 8 | DC-WEB-18 | Remove 2 duplicate tests in popup-hint.test.ts | safe | 13 |
| 9 | DC-WEB-7 | Delete `StageCell` and its test | check first | 15 |
| 10 | DC-WEB-8 | Delete `userDbName`, point db.test.ts at `dbNameFor` | check first | 5 |
| 11 | DC-WEB-9 | Delete `extractCompany`/`extractRole` | check first | 3 |
| 12 | DC-WEB-12 | Drop SyncBanner `local` prop | check first | 6 |
| 13 | DC-WEB-15 | Consolidate duplicated helpers | check first | 30 |
| 14 | DC-WEB-19 | Consolidate test DB/settle helpers | check first | 30 |
| 15 | DC-WEB-10 | Remove test-only production functions, rewrite their tests | check first | about 80 (46 prod, 35 test) |
| 16 | DC-WEB-13 | Remove Google-era azp branch, fixtures, `id_token` regex (after verifying MS token) | check first | 20 |
| 17 | DC-WEB-11 | Trim unused barrel re-exports | public-API-like | 9 |
| - | DC-WEB-14, 16, 17 | Informational (Dexie indexes, extra exports, eslint-disable) | n/a | 0 |

Total removable lines: about 239 net (safe items 41: DC-WEB-1 to 5 and 18 are 41 lines; check-first and public-API-like items about 198). Counts: 20 findings (14 dead code, 3 refactoring, 3 test cleanup).
