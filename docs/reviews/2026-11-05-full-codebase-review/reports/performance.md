# Performance review: job-tracker, branch `easy-connect` (full codebase)

Scope: hosted edition (`web/src`) and local edition (`jobtracker/`). Read-only for the repo.

How the numbers were produced:
- **Web DB and UI numbers** were measured in real headless Google Chrome (macOS) with real IndexedDB through Dexie.
  - The app's own modules were bundled with esbuild: `queries.ts`, `sync.ts`, `recheck.ts`, `contacts.ts`, `stats.ts`, and the Applications, Review and People pages.
  - Data: 1,000 applications and 20,000 emails.
  - Two profiles:
    - **realistic**: 15% of emails related, with 3.9 KB bodies. The other 85% are body-less "stub" rows, which is what `rememberUnrelated` stores.
    - **worst**: all 20,000 rows related with 3.9 KB bodies.
  - Bodies are synthetic prose, so absolute numbers will differ on real mail. Medians of 3 to 7 runs.
- **Regex and CPU numbers** were measured in Node 24 (same V8 as Chrome).
- **Python numbers** were measured on Python 3.14 against a seeded SQLite file of the same size.
  - `fastapi`, `requests`, `yaml`, `bs4` and `markupsafe` are not installed here. I stubbed `yaml` (it loads the same rules as `rules.json`), `bs4` and `markupsafe`.
  - HTTP routes were not run. I timed the SQL and Python functions the route handlers call.
- Network-bound items (Gmail and Outlook latency) could not be measured here. They are marked **estimate**.
- Benchmark scripts are in `/private/tmp/claude-502/-Users-thorn-leung/c9e35028-bd31-40d3-a1cd-3f723d21e55b/scratchpad/bench/`. Nothing in the repo was changed.

---

## High

### PERF-1: Every sync write re-runs three or more full-table `emails.toArray()` liveQueries, so sync runs about 60 to 90 times slower and the UI thread is saturated
- **Where:**
  - `web/src/app/useQuery.ts:12` (`liveQuery(async () => read())`, no throttling).
  - Always-mounted readers:
    - `web/src/app/Shell.tsx:27` → `reviewCount` (`queries.ts:181`, scans all emails).
    - `web/src/components/SyncBanner.tsx:100` → `accountSummaries` (`queries.ts:222`, scans all emails).
  - Page reader on the home route: `web/src/pages/applications/index.tsx:82`. It runs `listApplications` (`queries.ts:64`), `stageCounts`, `reviewCount` and `suggestions`.
  - Writer: `web/src/sync/sync.ts:42`, one all-tables read-write transaction (`tx` → `db.tables`) per message.
- **Evidence (measured, Chrome, realistic 1k/20k, 300 messages through `processMessages`):**

  | Scenario | ms per message | Query re-runs (300 msgs) |
  |---|---|---|
  | No subscribers | 1.50 | – |
  | Shell `reviewCount` + SyncBanner `accountSummaries` only (present on every page) | **92.1** | 301 and 300 |
  | Same, plus the Applications page query | **137** | 299 each |
  | Same three, each limited to 1 run per second | 1.86 | 3 each |
  | Same three unthrottled, but writes batched 25 messages per transaction | 4.59 | 11 to 12 each |

  - Each commit makes Dexie re-run every query that observed `emails`.
  - The queries read the whole table, so each costs about 70 ms (68 ms for `toArray`, 145 ms for the whole page query).
  - The next write's read-write transaction waits for those readers, so each message costs the sum of the readers.
  - Real-flow effect:
    - Gmail (`incremental`): each 25-message batch takes about 3.4 s to save instead of about 40 ms.
    - Outlook (not incremental): 5,000 messages would take about 11 minutes of near-continuous main-thread work instead of about 10 s.
  - The main-thread cost of `listApplications` itself is small (about 4 ms of CPU beyond the scan). The cost is the repetition.
- **Impact:** High at realistic size. It hits every first sync and every rescan, on every page, because the Shell and banner readers are always mounted.
- **Fix (smallest):**
  - In `useQuery`, gate the re-runs so a query starts at most about once per second **while a sync is running**. `isSyncing()` already exists in `web/src/sync/syncLock.ts`. For example, inside the querier: `if (isSyncing()) await sleepUntil(lastStart + 1000)`.
  - Doing it only during sync keeps user-initiated edits (stage change, add) instantly visible.
  - Optional second step: group the 25 messages of a batch into one transaction. Classify outside the transaction, then run `decide` and `add` per message inside it with a per-message fallback. This cuts the notifications 25-fold, but is trickier because a failing request aborts a shared Dexie transaction.
- **Complexity:** Easy (gate). Moderate (batched transaction).
- **Related:** `useQuery` also calls `setValue` with a fresh object on every run, so React re-renders even when nothing visible changed.

### PERF-2: Gmail messages are downloaded one at a time (estimate)
- **Where:** `web/src/providers/gmail.ts:119` (`for (const id of todo) { … await getJson(…messages/{id}?format=full) }`). Python edition: `jobtracker/providers/gmail.py` (`for message_id in todo`).
- **Evidence (reasoned estimate, no Gmail access here):**
  - One `format=full` GET is about 150 to 300 ms from a browser.
  - 1,500 messages (a 30-day first sync, the default) is about 4 to 8 minutes. A 365-day lookback of about 18,000 messages is about 1 to 1.5 hours.
  - Gmail's per-user quota is 250 units per second and a `messages.get` costs 5 units, which is about 50 requests per second. A sequential loop uses about 3 to 5 requests per second.
  - Local processing is about 1.7 ms per message (measured), so network latency is almost all of the wall time.
- **Impact:** High for first-sync time (estimate). Steady-state syncs of a few dozen messages are fine.
- **Fix:** Fetch with a small window of concurrent requests, 5 to 8 (`Promise` pool).
  - Keep the ordered `yield` so oldest-first processing still holds.
  - The existing `createHttp` backoff already handles 429 and `Retry-After`.
  - The shared `http` object is stateless per call, so it is safe to call concurrently.
- **Complexity:** Moderate.

### PERF-3: Outlook first sync and rescans hold the whole mailbox in memory, including an HTML copy nobody reads (memory is an estimate)
- **Where:**
  - `web/src/sync/sync.ts:203` (`const all: Message[] = []`, non-incremental).
  - `web/src/providers/graph.ts:44,61` (`html = text; … html,`) and `web/src/providers/gmail.ts:88`.
  - `Message.html` is never read in `web/src` (the Jobs tab is not in the hosted edition).
  - Python: `jobtracker/sync.py` (`list(fetched())`) and `jobtracker/providers/outlook.py:60` (`html=html`).
- **Evidence:**
  - Outlook (`incremental` is Gmail-only, `settings/actions.ts:111`) collects every message before processing any.
  - Each Message carries the full HTML body plus the flattened text. At about 40 KB of HTML per message and 2 bytes per character that is about 100 KB per message.
  - 5,000 messages is about 500 MB in the tab. A long lookback or newsletter-heavy mailbox can exceed 1 GB.
  - Nothing is saved until the end, so a crash or tab close loses all progress and the next sync downloads everything again.
  - Gmail wastes CPU base64-decoding the HTML part even when a `text/plain` part exists (`gmail.ts:77` `findPart(payload, "text/html")`).
- **Impact:** Medium to High depending on the lookback. The default 30 days is likely fine. A 365-day Outlook scan risks an out-of-memory crash.
- **Fix, in order:**
  1. Stop populating `html` (and skip the HTML decode when text exists). Easy.
  2. Add `Prefer: outlook.body-content-type="text"` to the Graph request. This shrinks pages about 3 to 5 times and removes the DOMParser conversion.
  3. Request `$orderby=receivedDateTime asc` and set `incremental` for Outlook so batches are saved as they arrive. This needs a check that `decide` and `applyEvent` tolerate batch boundaries, as they already do for Gmail.
- **Complexity:** Easy (1 and 2), Moderate (3).

---

## Medium

### PERF-4: People page recomputes everyone from every email on each mount and each write (web 1.1 s, local 1.8 s)
- **Where:** `web/src/sync/contacts.ts:187` (`derive(db)` loads all emails). `flat()` runs `pipeline().mailParts` on each body at line 199. Used by `web/src/pages/people/index.tsx:33`. Python: `jobtracker/contacts.py:127`, used by `/contacts` in `web.py`.
- **Evidence (measured):**

  | Item | Value |
  |---|---|
  | `derive(db)`, realistic (3,069 related emails) | **1,133 ms** (about 0.37 ms per email) |
  | `derive(db)`, worst (19,850 related) | **7,279 ms** |
  | People page mount, 3,000 related emails (Chrome) | **1,560 ms**, 50,011 DOM nodes (about 1,000 collapsed `<details>` with person cards inside) |
  | `flat()` alone | about 0.41 ms per 4 KB body (Node) |
  | Signature search | about 0.12 ms per email (Node) |
  | Python `contacts.derive(conn)` | **1,827 ms** |

  - It is also a liveQuery, so it re-runs on every emails write.
- **Impact:** A blank page for over a second on every visit at realistic size, many seconds at the worst size.
- **Fix:**
  - Cache the per-email parts of `derive` (flattened text, title guess, mentions) in a module-level `Map` keyed by email id plus body length. They are pure functions of the row, so later runs cost only the table read.
  - Render each group's `PersonCard`s only when its `<details>` is opened, or cap the first paint to about 50 groups.
  - Python: memoise per `(email id, len(body))` for the process lifetime.
- **Complexity:** Easy to Moderate.
- **Caution:** Replacing `flat()` with a plain whitespace collapse would be about 10 times faster but could change tokenisation (`joinsTight`) relative to Python. Prefer caching.

### PERF-5: Review page renders one `<option>` per application inside every waiting email's card
- **Where:** `web/src/pages/review/index.tsx:143` (`apps.map(... <option>)` inside `ReviewCard`, one card per waiting email, no cap). Python: `jobtracker/templates/review.html:44`.
- **Evidence (measured, Chrome):**
  - 100 waiting emails × 1,000 applications: **108,278 DOM nodes, 100,700 `<option>` elements, 1.69 s mount**.
  - One unrelated write re-ran the query and re-rendered in **155 ms**. `data.apps` is a new array each run, so every card's select reconciles again.
  - At 300 waiting emails this would be about 5 s and 300,000 nodes (extrapolated).
  - Python renders the same options server-side. 100 × 1,000 options is about 5 MB of HTML (estimate).
  - `reviewPage` also runs `extractCompanyRole` for every waiting email on every re-run (75 ms at 150 waiting, measured).
- **Impact:** Realistic. A first sync with a long lookback routinely leaves 100 or more emails in Needs review.
- **Fix:** Show the first 20 cards with a "Show more" button. Replace the per-card `<select>` with one shared control (`Combobox` or a single `<datalist>`) that mounts its options on focus.
- **Complexity:** Easy to Moderate.

### PERF-6: `recheck()` re-classifies every related email on the main thread after any feedback that creates a rule
- **Where:** `web/src/sync/recheck.ts:31` (classifies all related rows). Called from `actions.ts` `learnedFromFeedback` (when `rules.length`) and Settings "Re-check". Python: `jobtracker/recheck.py:50`, called from `web.py` `learned_from_feedback` inside the request handler.
- **Evidence (measured):**

  | Edition | Realistic (3.1k related) | Worst (19.9k) |
  |---|---|---|
  | Web (Chrome) | **1.64 s** | **10.0 s** |
  | Python (2.9k related, 4 KB bodies) | **6.16 s** | – |

  - Classification is about 0.5 ms per row in JS and 1.96 ms per row in Python.
  - A new `block_sender` or `block_domain` rule can only change emails from that sender or domain. `distrust_pattern` does not change `related`.
- **Impact:** Clicking "Not job mail" the first time a sender hits the threshold freezes the tab (web) or blocks the HTTP response (Python) for seconds.
- **Fix:** From the feedback path, pre-filter rows with `learned.blocks(sender, domain)` before classifying. Add a parameter such as `onlyBlocked`, while keeping the full pass for the manual button. For the full pass, yield to the event loop every few hundred rows.
- **Complexity:** Easy to Moderate.

### PERF-7: Outlook downloads the body of every message again on rescans
- **Where:** `web/src/providers/graph.ts:84-91` (the `skip(raw.id)` check runs after the page, with bodies, was already downloaded). Python: `jobtracker/providers/outlook.py:106`.
- **Evidence (reasoned):** "Last 90 days" rescans and the 1-day overlap re-fetch every body of messages already stored. 3,000 messages × about 40 KB HTML is about 120 MB over the wire. Pages are `$top=50` with full bodies.
- **Impact:** Medium for rescans. Normal incremental syncs are small.
- **Fix:** List with `$select=id,parentFolderId` first (no body). Then fetch bodies only for unseen ids, in `$batch` requests of 20.
- **Complexity:** Moderate.

### PERF-8: Python: adding a company or pressing Refresh re-fetches every feed, one after another, inside the request
- **Where:** `jobtracker/jobs_web.py:98` and `:161` (`run_discovery(conn, force=True, …)`). `jobtracker/jobs/run.py:36` loops feeds sequentially. `jobtracker/jobs/feeds.py:109` uses `requests.get` with a 25 s timeout and no `Session`.
- **Evidence (estimate):** With N configured companies, "Add company" does N+1 sequential HTTPS fetches, each with its own TLS handshake. 10 companies at 0.5 to 1 s is about 5 to 11 s with the request blocked, and up to 25 s per feed when one is slow.
- **Impact:** Medium for people who use the Jobs tab. Not relevant to the hosted edition.
- **Fix:** `add_feed` should fetch only the new source (`run_discovery(only=source_id)`). For the full run, use a `requests.Session` and a small thread pool (4).
- **Complexity:** Easy to Moderate.

---

## Low

### PERF-9: Re-evaluation of the deferred `emails.toArray()` item (measured)
- **Where:** `queries.ts:64` (`listApplications`), `:160` (`reviewPage`), `:181` (`reviewCount`), `:222` (`accountSummaries`); `stats.ts:73` (`sankey`); `recheck.ts:95` (`settleReview`).
- **Measured (Chrome, median ms):**

  | Read | Realistic (3.1k with bodies, 17k stubs) | Worst (20k with bodies) |
  |---|---|---|
  | `emails.toArray()` | 67.8 | 166.5 |
  | `where("applicationId").above(0).toArray()` | **35.4** | 209.6 |
  | `orderBy("applicationId").keys()` | 23.6 | 355.4 |
  | `orderBy("receivedAt").toArray()` | 94.9 | 200.3 |
  | `filter()` collection `.toArray()` | 97.0 | 603.2 |
  | `listApplications` | 72.1 | 205.2 |
  | Whole Applications page query | 145 | 397 |
  | `reviewCount` | 66.9 | 166.3 |
  | `accountSummaries` | 65.5 | 166.9 |
  | `sankey` | 76.5 | 172.9 |
  | `[accountId+providerMsgId]` index count (per account) | 46.8 | – |
  | `[accountId+threadId]` range `toArray()` | 111.4 | – |
  | 20k rows with bodies stripped, `toArray()` | 51.8 | – |

- **Conclusions:**
  - Per-row overhead dominates, not body size, in the stub-heavy profile (52 ms for 20k body-less rows versus 68 ms with 3k bodies). Moving `body` to its own table or adding an `event` index would help the worst profile only, and not the repeated-run problem.
  - Index counts, compound-range scans and `keys()` are no faster than `toArray()`. Do not pursue them.
  - The only cheap read win is `where("applicationId").above(0)`, which skips the stub rows (rows with a `null` `applicationId` are not in the index). It is about 2 times faster in the realistic profile and about 25% slower in the worst. It also cannot serve `reviewCount` or `accountSummaries`.
  - The deferral was right for a single run. The real cost is how often it runs (PERF-1). After PERF-1, the remaining one-shot cost (70 to 200 ms) is acceptable.
- **Fix:** None needed beyond PERF-1. Optional: use `where("applicationId").above(0)` in `listApplications`/`sankey` when the stub share is high.
- **Complexity:** Easy.

### PERF-10: `settleReview` scans the whole emails table and rewrites unchanged rows at the end of every sync
- **Where:** `web/src/sync/recheck.ts:95,101`, called from `sync.ts:214` and `recheck.ts:74`. Python: `jobtracker/recheck.py` `settle_review`, called from `sync.py`.
- **Evidence (measured):** 120 ms with 150 waiting emails (realistic), 294 ms (worst), with no new mail. About 70 ms of that is the table scan. It holds an all-tables read-write transaction for the duration, so liveQuery reads wait. Every waiting row gets `db.emails.update(...)` even when nothing changed.
- **Impact:** Low. It is a once-per-sync cost.
- **Fix:** Skip it when the sync stored no related mail, using `counts["applied-to-application"]` and `counts.review`. Only call `update` when `event`, `confidence`, `reason`, `applicationId` or `needsReview` differ.
- **Complexity:** Easy.

### PERF-11: Quadratic regex behaviour on very long punctuation-free text (theoretical)
- **Where:**
  - `web/src/pipeline/extract.ts:30,42,106`. The `INTRO` alternation includes a bare `\bof` followed by lazy `[^.!\n]+?`, and the third pass runs on whitespace-flattened text so newlines no longer stop it. Same patterns in `jobtracker/extract.py`.
  - `web/src/jobs/paste.ts:69` (`/<[^>]*>/g`).
- **Evidence (measured, synthetic):**
  - `extractCompanyRole` on text made of repeated "of the", with no `.`, `!` or newline: 4 KB takes 1.9 ms, 50 KB takes **207 ms**, 200 KB takes **3.18 s**.
  - Realistic prose bodies are linear: 4 KB takes 0.29 ms, 100 KB takes 6 ms, 400 KB takes 24 ms.
  - Paste box: 60,000 `<` characters with at least one real tag takes about 1.4 s. The cap is 200,000 characters, which would be about 15 s.
  - No catastrophic (exponential) backtracking was found.
- **Impact:** Theoretical. Real mail has a period or newline within a few hundred characters.
- **Fix:** Cap the text given to `extractCompanyRole` at about 50,000 characters (parity caveat: apply the same cap in Python and in the golden export). Cap the paste scan the same way, or bound the tag pattern to `<[^<>]{0,500}>`.
- **Complexity:** Easy.

### PERF-12: Python HTTP calls without a `requests.Session`
- **Where:** `jobtracker/providers/outlook.py:95,106` (one new connection per page and per folder lookup), `jobtracker/jobs/feeds.py:109`, `jobtracker/jobs/adzuna.py:71`.
- **Evidence (reasoned):** Each call pays a fresh TLS handshake of about 50 to 150 ms. For 100 Outlook pages that is a few seconds.
- **Impact:** Low.
- **Fix:** One shared `requests.Session` per fetch or run.
- **Complexity:** Easy.

### PERF-13: `tx()` locks all nine tables for every write (theoretical)
- **Where:** `web/src/db/schema.ts` `tx()` (`db.transaction("rw", db.tables, …)`), used by `processMessage`, `settleReview`, `recheck` and every action.
- **Evidence:** A reader of any table (settings, accounts, activity) waits behind a sync write even when the table sets are disjoint. The effect is not separable from PERF-1 in the measurements, so this is reasoned only.
- **Impact:** Low once PERF-1 is fixed.
- **Fix:** Scope each `tx` to the tables it uses (`emails`, `applications`, `ignoredMail`, `learnedRules`). Only do this if profiling after PERF-1 shows contention.
- **Complexity:** Easy to Moderate.

---

## Measured

| What | Result | Env |
|---|---|---|
| `processMessages`, 300 msgs, per-message transaction (today), no readers | 1.67 ms/msg | Chrome IDB, 1k apps / 20k emails |
| Same, one transaction per 25 messages | 1.46 ms/msg (13% faster) | Chrome IDB |
| Same as today, with Shell, SyncBanner and Applications-page liveQueries | **137 ms/msg** (82× slower) | Chrome IDB |
| Shell + SyncBanner liveQueries only | **92 ms/msg** | Chrome IDB |
| Same three, throttled to 1 run per second | 1.86 ms/msg | Chrome IDB |
| Same three unthrottled, with batched transactions | 4.59 ms/msg (11 to 12 re-runs each) | Chrome IDB |
| Applications page mount, 1,000 rows | 180 ms, 26,435 DOM nodes | Chrome |
| Applications page, one write → liveQuery → re-render | about 33 ms (floor of two frames), no long tasks | Chrome |
| Review page mount, 100 waiting × 1,000 apps | **1,691 ms**, 108,278 nodes (100,700 options) | Chrome |
| Review page, one write → re-render | 155 ms | Chrome |
| People page mount, 3,000 related emails | **1,560 ms**, 50,011 nodes | Chrome |
| `derive(db)` People, realistic / worst | 1,133 ms / 7,279 ms | Chrome IDB |
| `recheck`, realistic / worst | 1,639 ms / 10,008 ms | Chrome IDB |
| `settleReview` (150 waiting, no new mail), realistic / worst | 120 ms / 294 ms | Chrome IDB |
| `applicationDetail(1)` | 5.8 ms / 13.4 ms | Chrome IDB |
| `stageCounts`, `suggestions`, `applications.toArray()` | 2 to 3 ms each | Chrome IDB |
| Scan variants and page queries | see PERF-9 table | Chrome IDB |
| `classify` body 4 / 20 / 100 / 400 KB (job-like) | 0.45 / 2.3 / 11.7 / 46.9 ms | Node 24 |
| `classify`, 4 KB with no job context | 0.19 ms | Node 24 |
| `extractCompanyRole` 4 / 20 / 100 / 400 KB | 0.29 / 1.2 / 6.1 / 24.4 ms | Node 24 |
| `classify`, 7,068 golden messages (avg 82 chars) | 0.020 ms/msg | Node 24 |
| `parts()`/`render()` 4 KB (UI) | 0.36 ms | Node 24 |
| `extractCompanyRole`, punctuation-free "of the" text, 4 / 50 / 200 KB | 1.9 / 207 / 3,178 ms | Node 24 |
| `classify`, 200 KB of spaces | 22 ms | Node 24 |
| `truncate` of a 200 KB body | 0.46 ms | Chrome |
| `derive` split: `flat` / `titleInSignature` / `titlesInMentions` | 0.41 / 0.12 / 0.008 ms per email | Node 24 |
| Paste `<[^>]*>` on 60k `<` characters | 1.38 s | Node 24 |
| Python `process_messages`, 300 msgs, per-message commit | 2.75 ms/msg | Python 3.14, SQLite WAL |
| Python `classify`, 4 KB | 1.96 ms/msg (about 4× the JS) | Python 3.14 |
| Python index SQL (1,000 apps with `n_emails` subquery) | 1.3 ms | Python 3.14 |
| Python account-filter SQL with sort | 2.0 ms | Python 3.14 |
| Python `review_count` SQL (`SCAN emails`) | 3.2 ms | Python 3.14 |
| Python `db.connect()` per request | 0.03 ms | Python 3.14 |
| Python `contacts.derive(conn)` / `(conn, app_id)` | 1,827 ms / 0.39 ms | Python 3.14 |
| Python `recheck` (2.9k related) | 6,159 ms | Python 3.14 |
| Python `settle_review` (150 waiting) | 64 ms | Python 3.14 |
| Python Review page `extract_company_role` × 150 | 19 ms | Python 3.14 |
| Python `mailtext.render` 4 KB | 0.35 ms | Python 3.14 |

### Bundle (`vite build`, output to scratch dir, repo `dist` untouched)

| Chunk | Size | gzip | Loaded |
|---|---|---|---|
| `index-Do5uEDvf.js` (entry: react-dom 210 KB, dexie 100 KB, app, pipeline) | 466.6 KB | 155.1 KB | **eager** |
| `index-DfUPKwEu.css` | 29.4 KB | 6.5 KB | eager |
| `index-C2i47Vje.js` (`@azure/msal-browser` + `msal-common`) | 287.9 KB | 71.5 KB | lazy (`import()` in `auth/microsoft.ts:33`, only when signing in with Microsoft) |
| `index-kTZZaLur.js` (Applications page, including job-link code) | 59.6 KB | 21.0 KB | lazy |
| `demo-export-DMAbq62a.js` (demo data) | 54.1 KB | 6.0 KB | lazy (`demo/loadDemo.ts:33`) |
| Settings / Flow / detail / review / people / setup chunks | 22.3 / 18.6 / 14.5 / 5.4 / 3.0 / 9.9 KB | – | lazy (one per route via `import.meta.glob`) |
| Google Identity Services (`accounts.google.com/gsi/client`) | external | – | script tag injected at run time by `auth/google.ts:53`, not in the bundle |

- The 19k-case fixtures (`tests/fixtures/pipeline-golden.json`, 3.7 MB) are not imported from `src` and are not in `dist`.
- The pipeline module is about 35 KB minified (14 KB gzip) and is part of the entry because `sync` imports it.
- `web/dist` was not rebuilt in place. I built to a scratch directory and the sizes match the committed `dist`.

---

## Checked and fine

- **Per-message classify and extract CPU** is linear and cheap: about 0.5 to 1 ms per 4 KB message, 47 ms at 400 KB.
  - Rules compile once: `loadRules()` is cached and `py()` runs at module load.
  - The Unicode-aware `\b`/`\w` translation in `pyre.ts` has no measurable cost at these sizes.
  - Only `linkedinRole` compiles a regex per call, and only for LinkedIn senders.
- **The pyre/pystr layer** (`strip`, `cpLen`, `Array.from` loops) is O(n) per call. `truncate` on a 200 KB body is 0.46 ms.
- **The per-message transaction** is not itself expensive: 1.67 versus 1.46 ms per message batched. The problem is only the notifications it triggers (PERF-1).
- **Per-message DB round trips** (`emailSeen`, `threadApplication`, `allApplicationsFor`, `get` plus `update`, `add`) are index-backed (`[accountId+providerMsgId]`, `[accountId+threadId]`, `companyKey`). Total about 1.5 ms per message.
- **`learn.rebuild`, `loadLearned`, `activeRules`** read small tables (rules and feedback). Feedback grows with clicks, but is tiny at realistic sizes.
- **`listApplications` CPU** (grouping, regex-based interview-day detection, sort) is about 4 ms in the realistic profile and about 40 ms worst. Interview dates are scanned only for interview-event emails and are capped to 1,500 characters.
- **Applications list rendering:** 1,000 rows mount in 180 ms. A data refresh re-renders all rows (new `r` objects defeat `memo`) within a frame or two, with no long tasks. No virtualisation is needed at 1,000 rows.
- **Combobox** filters at most 600 suggestions per keystroke. `useDuplicates` is debounced and scans 1,000 applications (about 2 ms).
- **Flow page:** the Sankey has at most 8 nodes and about 15 links. PNG export builds one canvas (2400 × about 1500) once, on click, with the font fetched from the browser cache.
- **`providers/backoff.ts`:** bounded retries (5), `Retry-After` honoured and capped at 300 s, abortable sleeps, token fetched per request from an in-memory cache.
- **Gmail id paging** uses `maxResults=500`. The 20k-key `seen` set is built once per sync. A `keys()` pass over about 20k index entries measured 355 ms in the worst profile, which is acceptable once per sync.
- **`jobs/*` enrichment and paste:** 6 s timeouts, 1 MB response caps, fixed hosts, aborted on field edits. The only issue is the synthetic quadratic tag regex (PERF-11).
- **Python SQL:** every list query uses an index (`idx_email_app` covering index for `n_emails`, `idx_email_thread`). `needs_review` has no index but the scan is 3.2 ms at 20k rows. Per-request connection set-up is 0.03 ms.
- **`joblink.py`:** an 8 s total deadline, a 1 MB cap, 4 redirects. One fetch is user-initiated, so caching would not pay. The per-lookup `ThreadPoolExecutor` and `ssl.create_default_context()` cost a few milliseconds.
- **Python process_messages** at 2.75 ms per message and **classify** at 1.96 ms per message give about 14 s of CPU for a 5,000-message first sync. Fine next to network time.
- **Export** (`JSON.stringify` of the whole database) is about 80 MB at the worst case. It is one user-initiated action and fine on desktop.
