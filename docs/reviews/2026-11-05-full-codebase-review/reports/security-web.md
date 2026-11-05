# Security and privacy review: hosted edition (web/), branch easy-connect

Scope: web/src/auth, app, config.ts, site.ts, index.html (CSP), public/privacy.html, portability, providers, jobs, db, sync/{actions,bulk,duplicates,decide,sync}, the listed components, pages/settings/actions.ts, .github/workflows/pages.yml, web/site-config.json, .github/CODEOWNERS, package-lock.json registry/integrity check. Read-only review, nothing was executed against live services.

Totals: Blocking 0, High 0, Medium 2, Low 6.

No XSS, DOM injection, token persistence, or import-validation defect was found. The two Medium items are an architecture/origin exposure and a privacy-page claim that the code contradicts.

---

## Medium

### SEC-WEB-1: Mail data, DB and the OAuth client are shared with every page on the `thornleung01.github.io` origin
- Severity: Medium
- Location: web/vite.config.ts:6 (`base: "/job-tracker/"`), web/src/auth/user.ts:23 (`jobtracker:${iss}:${sub}`), web/src/auth/google.ts:157-159 (GIS token client), web/src/pages/setup/steps.ts:4 ("Authorized JavaScript origin")
- Description: The app is served from `https://thornleung01.github.io/job-tracker/`. Browser storage (IndexedDB, localStorage) and Google's "Authorized JavaScript origins" are keyed by origin (scheme + host + port), not by path. GitHub Pages serves every project site of one account from the same origin. Evidence: the base path is the only separation (`base: "/job-tracker/"`), the databases are named `jobtracker:https://accounts.google.com:<sub>`, and the setup guide tells the owner to register only the origin for Google. Any other page under `https://thornleung01.github.io/*` (another repo's Pages site, a future project, or one with its own XSS or user-supplied content) can:
  1. open `indexedDB.open("jobtracker:https://accounts.google.com:<sub>")` and read stored email excerpts (4,096 characters of each job email, senders, subjects) and all applications;
  2. call `google.accounts.oauth2.initTokenClient({client_id: <this app's public client id>, scope: "...gmail.readonly"})` from that origin. Google accepts it because the origin is authorized. A user who already consented to this client gets a silent Gmail read token for the other site.
  Microsoft is safer here because the SPA redirect URI is an exact path match (`origin + base`), so only the Google half and the storage half are exposed.
- Exploit scenario: The owner later publishes any second Pages project (a blog, a demo, a fork with a typo-squatted dependency) under the same user site. That project's script, or a script injected into it, reads the Job Tracker databases or requests Gmail tokens for any visitor who also uses Job Tracker. A fork deployed by someone else inherits the same issue on their own github.io origin.
- Fix: Serve the hosted app from its own origin: a custom domain, or an org or user account that hosts only this site. Until then, document in web/README.md and the setup guide that the account must host no other Pages sites. Optionally add an origin-wide "no other sites" note to privacy.html. A path-scoped cookie or CSP cannot fix this.
- Confidence: 0.65 (the exposure is real by the same-origin policy; actual impact depends on whether other Pages sites exist or are added)

### SEC-WEB-2: Privacy page says other-site links cause no request, but the code queries Greenhouse for any site with `?gh_jid=`
- Severity: Medium (privacy-policy accuracy)
- Location: web/public/privacy.html:83 vs web/src/jobs/url.ts:247-252 and web/src/jobs/enrich.ts:56-58 and :263-268
- Description: privacy.html states: "When you paste a job link from Greenhouse, Lever, Ashby or SmartRecruiters ... Links from any other site are read on your device only, with no request." But `detectBoard` has a fallback for company career pages:
  ```
  const jid = u.searchParams.get("gh_jid");
  if (jid && /^\d{1,20}$/.test(jid)) {
    const { label } = registrable(host);
    if (!NOT_A_BOARD_LABEL.has(label)) return ok("greenhouse", label, jid);
  }
  ```
  `enrichJobDraft` then requests `https://boards-api.greenhouse.io/v1/boards/<domain label>/jobs/<gh_jid>` (and `/boards/<label>` for the company name). So a paste of `https://careers.acme.com/open-role?gh_jid=123` sends "acme" (derived from the user's pasted domain) and the job id to Greenhouse, a third party, with no mention in the policy. The page also says the request "contains only the board name and job number"; for these links the "board name" is a guess from the employer's own domain.
- Exploit scenario: Not an attack. A user who relies on the policy ("no request for other sites") has an employer domain label and job id disclosed to Greenhouse. This is a misstatement a Google OAuth verification reviewer or a privacy regulator would flag.
- Fix: Either drop the `gh_jid` heuristic, or amend the paragraph, for example: "Some company career pages that embed Greenhouse (links containing gh_jid) also cause a request to Greenhouse with a name guessed from the site's domain and the job number." Add a test that fails when privacy.html and the list of hosts in `API_HOSTS` diverge.
- Confidence: 0.9

---

## Low

### SEC-WEB-3: A silent token refresh is never checked against the mailbox it was connected for; the connected-address map survives sign-out
- Severity: Low
- Location: web/src/auth/google.ts:224-255 (`requestMailToken`), web/src/auth/index.ts:174-183 (`acquire`), web/src/auth/microsoft.ts:166-178, web/src/pages/settings/actions.ts:15-19 (`connected` map; `forgetConnections` is only called from tests)
- Description: `signIn` verifies the Google token with tokeninfo (`aud`, `azp`, `sub`). `requestMailToken` does not: it takes whatever token the GIS window returns (`prompt: ""` plus a `login_hint`) and stores it as the Gmail token for the signed-in user. The app guards against mailbox mix-ups with `isConnected` (address recorded in the in-memory `connected` map must match the account row), but that map is only updated when `registerMailbox` runs (after a fresh connect), never when `tokenSource` silently re-acquires a token. If the hinted Google session is gone, Google shows its account chooser and the person can pick a different account; the new token is then used for the old account row. Microsoft behaves the same: `acquireTokenPopup` returns another account and `account = r.account` replaces it silently. `forgetConnections()` is never called on sign-out in production code.
- Exploit scenario: Signed in as work@gmail, a person re-grants Gmail access after expiry and picks personal@gmail in the chooser. The sync then stores personal@gmail's job emails under the work@gmail account row and database. No attacker is involved and the data stays in one person's own browser, so the impact is confused data, not disclosure.
- Fix: After every token acquisition that was not part of the initial `signIn`, resolve the address again (`getAddress`) and compare it with `connectedAddress`; reject with `NotConnected` on mismatch. Call `forgetConnections()` from the sign-out path.
- Confidence: 0.5

### SEC-WEB-4: Imported `webLink` values are only length-checked, so an imported file can plant an arbitrary https "Open in Outlook" link
- Severity: Low
- Location: web/src/portability/validate.ts:179 and :226 (`webLink: nullableStr(r, "webLink", k, 2000)`), web/src/pipeline/links.ts:23 (`webLink.startsWith("https://")`), web/src/components/MailActions.tsx:3 and :13
- Description: Posting URLs get strict http(s) validation (`safePostingUrl`) on import, but email `webLink` does not. The render-time guard only requires the `https://` prefix, so `javascript:` is blocked but any https host is accepted. The anchor has `target="_blank" rel="noopener noreferrer"`, so there is no opener risk, and the CSP blocks `javascript:` anyway. The remaining issue is phishing: the button is labelled "Open in Outlook" and points anywhere.
- Exploit scenario: A user imports a JSON file from a forum or a "template" (the import replaces all data). Outlook-provider email rows carry `webLink: "https://evil.example/login"`. On the application detail page the person clicks "Open in Outlook" expecting their mailbox and lands on a credential-harvesting page.
- Fix: In the validator and in `mailboxLink`, accept only the hosts Graph returns (`outlook.office.com`, `outlook.office365.com`, `outlook.live.com`) and reject others; cap at the Graph URL shape. Also drop `webLink` on import for gmail rows (Gmail links are built from the thread id, not stored).
- Confidence: 0.6

### SEC-WEB-5: Google login requests the `profile` scope but never uses it
- Severity: Low (data minimisation)
- Location: web/src/auth/google.ts:10 (`GOOGLE_LOGIN_SCOPES = "openid email profile"`), web/src/auth/google.ts:252-259 (`finish`: only `sub` and `email` are read), web/public/privacy.html (says the name comes "from Microsoft")
- Description: The Google consent screen asks to "see your personal info" because of `profile`, but the code builds the user from `{iss, sub, email}` only and the privacy page says the name is a Microsoft-only item. This asks for more than the app uses, which matters for Google's OAuth verification and for GDPR data minimisation.
- Fix: Use `"openid email"`. No other code depends on `profile`.
- Confidence: 0.7

### SEC-WEB-6: Deploy workflow gives the build job deploy rights; actions are pinned to tags; npm lifecycle scripts run
- Severity: Low
- Location: .github/workflows/pages.yml:9-12 (`permissions: contents: read, pages: write, id-token: write` at workflow level), :27-33 (`actions/checkout@v4`, `setup-node@v4`, `upload-pages-artifact@v3`, `deploy-pages@v4`), :32 (`npm ci`)
- Description: Workflow-level permissions apply to the `build` job, which runs `npm ci` (dependency install scripts) and `npm test` with `pages: write` and `id-token: write`. Only the `deploy` job needs those. All actions are referenced by movable tag instead of a commit SHA. Good: the lockfile has 217 `resolved` URLs all on registry.npmjs.org and 217 integrity hashes, the trigger is `push` to main (no `pull_request_target`), and no secrets are used (client IDs come from repo variables).
- Exploit scenario: A compromised transitive dependency or action tag runs in the build job with an OIDC token that can create a Pages deployment, skipping the deploy job's `github-pages` environment protections. The deployed bundle is the trust anchor for mailbox access, so supply-chain integrity matters more here than in an ordinary static site. (A malicious build step can already alter the artifact, so the added risk is the bypass of environment rules.)
- Fix: Set `permissions: contents: read` on the workflow and add `pages: write` and `id-token: write` only under `jobs.deploy`. Pin actions by full commit SHA with a Dependabot or Renovate config to update them. Consider `npm ci --ignore-scripts` if the build works without install scripts.
- Confidence: 0.55

### SEC-WEB-7: CODEOWNERS protects only site-config.json, not the code that decides whose OAuth app and scopes are used
- Severity: Low
- Location: .github/CODEOWNERS:2 (`/web/site-config.json @thornleung01`), web/src/config.ts:33-41 (`pick`: build env value wins and is not format-checked), web/index.html:7 (CSP)
- Description: The comment says changes "change whose Google or Microsoft app people consent to". But that outcome is also controlled by `src/config.ts` (the env override), `src/auth/*` (scopes, audience checks), `index.html` (the CSP `connect-src`), `vite.config.ts` and `pages.yml` (the `vars.*` wiring). None are listed. CODEOWNERS also only binds when branch protection requires code-owner review, which cannot be seen from the repo.
- Exploit scenario: With more than one maintainer, a PR that widens `googleMailScope` or relaxes the audience check merges without the owner's review.
- Fix: Add `/web/src/auth/`, `/web/src/config.ts`, `/web/index.html`, `/web/public/privacy.html`, `/.github/` to CODEOWNERS and enable required code-owner review on main.
- Confidence: 0.45

### SEC-WEB-8: Dismissed review emails keep `webLink` and `threadId`, and the privacy page mentions extra local-storage keys it does not list
- Severity: Low (privacy accuracy)
- Location: web/src/sync/actions.ts:209-211 (dismiss branch keeps `threadId`, `webLink`, `bulk`), web/public/privacy.html (stores section), web/src/app/carryOver.ts:15 (`jobtracker:carryover-done` in localStorage), web/src/app/LocalDataOffer.tsx:8 and LocalBanner (sessionStorage dismiss keys)
- Description: (a) The policy says non-job email is kept as "only its message ID and date". The Needs-review "dismiss" path nulls subject, body, sender and reason but leaves `threadId` and `webLink` (a direct link to the message in the mailbox). `clearEmail` (used for deletes) does clear them, so the two paths differ. The feedback table also keeps sender address and subject, which the policy covers only as "corrections you give". (b) The policy lists one local-storage item (last provider); the code also writes `jobtracker:carryover-done` to localStorage and two dismiss flags to sessionStorage. None hold personal data.
- Fix: Null `webLink` and `threadId` in the dismiss update (or reuse `clearEmail`), and add the three keys to the storage list.
- Confidence: 0.6

### SEC-WEB-9: tokeninfo falls back to putting the access token in a URL
- Severity: Low
- Location: web/src/auth/google.ts:178-179
- Description: On HTTP 405 or 415 the code retries `GET ${TOKENINFO_URL}?access_token=...`. Google's endpoint accepts POST today, so this path should not trigger, and the request goes only to Google (allowed by CSP). It still puts a live bearer token in a URL that proxies or logs may keep, and the privacy page says tokens never go in "the address bar" (accurate for the browser bar, not for request URLs).
- Fix: Remove the GET fallback and fail with `NOT_VERIFIED`.
- Confidence: 0.3

---

## Checked and clean

- XSS and DOM injection: no `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` or `new Function` anywhere in src. Email text is rendered through `EmailText`, which re-parses the pipeline output with `DOMParser` and rebuilds only `p/ul/li/span.url` as React elements (links are shown as text, never clickable). Company, role, location, sender, subject, notes and offer fields are all React text children. `htmlToText` and JSON-LD paste use `DOMParser` on detached documents (no script or image loads).
- URLs in `href`: every dynamic `href` is a `#/...` hash route, a constant, or passes an https-only check (`MailActions`, `PersonCard`) or `safePostingUrl` (`detail/index.tsx`). All `target="_blank"` links have `rel="noopener noreferrer"`. The bookmarklet link sets `href` through a ref (React refuses `javascript:`), and its click is cancelled inside the app.
- CSP (index.html, copied unchanged into dist/index.html): `default-src 'self'`, `script-src 'self'` plus the single GIS path, no `unsafe-inline` or `unsafe-eval` for scripts, `connect-src` limited to Gmail, Graph, Microsoft login, Google token endpoints and the four job-board API hosts (which match `API_HOSTS` in enrich.ts), `base-uri 'self'`, `form-action 'self'`, `frame-src` for the two login hosts, `img-src 'self' data:`. Limitation: a meta CSP cannot set `frame-ancestors`, so the app can be framed (GitHub Pages cannot send headers); the only destructive actions (delete data, import) ask for confirmation.
- Tokens: kept in module memory (`tokens` map); MSAL configured with `memoryStorage` for both caches; the only persisted auth item is the non-secret last-provider hint. No tokens in logs (`console.warn/error` print message ids and error objects, not tokens) or URLs (apart from SEC-WEB-9). Google token is revoked on sign-out, and a login-only token that came back with mail scope is revoked immediately. A `generation` counter stops late results from reviving a signed-out session.
- OAuth flow: Google identity comes from tokeninfo with `aud` equal to the client id, `azp` check, numeric `sub` check; Microsoft ID token checks `alg`, issuer pattern (GUID tenant), audience (plus `azp` for multi-audience), `exp`, `nbf`, and a per-login random nonce passed to MSAL. Signature is not verified in the browser; the code documents this (idToken.ts header) and no server trusts the claims. Authorization code with PKCE is used by MSAL. Popup handling: `isAuthPopupWindow` renders nothing in the popup so the opener can read the response. Database names include provider issuer and `sub`; `userKey` rejects a `:` in `sub`, so the keys of different providers cannot collide.
- Provider clients: Graph `@odata.nextLink` must start with `https://graph.microsoft.com/` before the bearer token is sent to it; Gmail message ids go through `encodeURIComponent`; query parameters use `URLSearchParams`; retry/backoff honours aborts and caps `Retry-After`. Header decoding (`decodeMimeWords`, `parseAddress`) is linear-time and wrapped in try/catch; charset names go through `TextDecoder` with a UTF-8 fallback.
- Job-board enrichment: requests only to six fixed hosts (`API_HOSTS` check on `parsed.host`, https only, query string must equal the one allowed constant), slug and id validated twice (`isSafeSlug`, `isSafeId`) and URL-encoded, `credentials: "omit"`, `referrerPolicy: "no-referrer"`, `redirect: "error"`, response host re-checked, 1 MB cap (4 MB for the Ashby listing), 6 s timeout, all returned text goes through `sanitizeText`. Only the gh_jid heuristic (SEC-WEB-2) widens it.
- Bookmarklet: extractor makes no network calls and uses no eval; the hash payload is untrusted and re-validated in `draftFromHash` (control and bidi characters stripped, lengths capped, http(s) only, no credentials, `add=1` required, `g` flag allowlisted); it only prefills the form and never saves; parameters are removed from the address afterwards. `launch` severs `opener`. The embedded app URL is built from `window.location.origin + BASE_URL` and escaped (`<`, `%`, `#`, non-ASCII).
- Import and export: the file is parsed and fully validated before any write (types, enums, lengths, `Number.isSafeInteger` ids, referential checks, uniqueness, settings through `sanitize*`); email bodies are truncated to 4,096 characters; posting URLs, offer salary and deadline use the strict shared rules; the Python converter only copies known keys and renames; a `__proto__` key in converted rows only affects the temporary row object and there is no deep merge or `Object.assign` onto shared objects, so no prototype pollution. Learned rules are stored values compared with `Set`/string operations, not compiled to regular expressions. CSV export prefixes `'` for fields starting (after optional whitespace) with `= + - @` or a tab/CR, then RFC 4180-quotes, with a BOM. Downloads use Blob URLs revoked after use.
- Regex safety on untrusted text in my area: `jobs/url.ts`, `jobs/paste.ts`, `jobs/jsonld.ts`, `providers/headers.ts` use bounded or linear patterns; URL length capped at 8,000; paste capped at 200,000 characters and 400 lines. (The pure resource-exhaustion case of many unclosed `<script` in a 200 KB paste is a self-inflicted slowdown and was not reported.)
- Secrets and PII: no client secrets or tokens in the repo; client IDs are public by design and `site-config.json` ships empty; demo and fixture data use `.example` addresses and fake IDs. `.gitignore` excludes `.env`, `token*.json`, `client_secret*.json`.
- Privacy page vs code (matches): read-only scopes (`gmail.readonly`, `Mail.Read`); 4,096-character body limit; non-job mail stored as id and date only on the sync path; 30-day retention for learned-rule-hidden mail (`IGNORED_KEEP_DAYS`); tokens in memory only; Google token revoked on log out and Microsoft token only dropped; export files not uploaded; delete-all clears every table; no analytics or third-party scripts other than the Google GIS script; fonts are self-hosted.
- Supply chain: package-lock.json has 217 packages, all `resolved` on registry.npmjs.org with integrity hashes; no postinstall scripts of mine; `npm ci` is used in CI.
- Not reviewed (outside my area): web/src/pipeline (classifier, regex translation in `pyre.ts`), pages other than settings/setup/signin/detail/applications, the Python edition.
