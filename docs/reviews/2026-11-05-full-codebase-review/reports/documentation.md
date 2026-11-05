# Documentation review: job-tracker, branch `easy-connect`

Scope: full-repo review of docs against code (not a diff). Repo `/Users/thorn.leung/job-tracker`, clean tree (only untracked `.claude/`).
No CHANGELOG.md exists and no release-please files exist, so there is nothing to update there (see "Nice to have", DOC-24).

What I verified by running or reading code:
- `cd web && npm test`: 79 files, 1645 tests pass. `npm run` lists `dev`, `build`, `preview`, `typecheck` (and `test`).
- Python side not run: no `.venv` in the clone, and system Python 3.14.4 has no `pytest` or `yaml` installed. So `python scripts/export_fixtures.py --check` and `pytest` were not executed; claims about them come from reading the scripts.
- CSP in `web/index.html` against every `fetch(` in `web/src` (see "Privacy cross-check" below).
- Cannot verify offline: current Google Cloud and Microsoft Entra console wording (listed in "Console wording" at the end).

Counts: Wrong 8 (DOC-1 to DOC-8), Missing 9 (DOC-9 to DOC-17), Inconsistent 6 (DOC-18 to DOC-23), Nice to have 5 (DOC-24 to DOC-28).

---------------------------------------------------------------------------------------------------

## Wrong (must fix)

### DOC-1 Local-to-hosted import path is described with a menu that does not exist
- Location: `scripts/export_json.py` lines 1-9 (module docstring); `web/README.md` "Moving your existing data".
- Claim: "Then sign in to the hosted app and choose Settings > Import from the local edition." (docstring). README says "use Settings, Your data, Import".
- Code: `web/src/pages/settings/SettingsPage.tsx` lines 486-491 has a button labelled **Import data** in the **Your data** card. After you choose a file the app asks "Replace everything in this browser with {file} (from the local edition)? This can't be undone." with a **Replace my data** button. There is no "Import from the local edition" item, and the app says "log in", not "sign in".
- Also not said anywhere: importing replaces what is in the browser.
- Proposed docstring text (replace the sentence):
  `Then log in to the hosted app, choose Settings, Your data, Import data, and pick the file. The app says the file is from the local edition and asks before it replaces what is in that browser.`
- Proposed `web/README.md` text (replace the two sentences after the code block):
  `It opens the database read-only and writes export.json. Then log in to the hosted app and choose Settings, Your data, Import data. The app asks before it replaces everything in this browser. The export leaves out the resume and job-search profile.`

### DOC-2 PRODUCT.md says emoji status icons exist and that DESIGN.md explains them
- Location: `PRODUCT.md` line 38 (Evidence on Hand).
- Claim: "Where this app departs from the primer, DESIGN.md says so (for example the slightly stronger inactive background, and the emoji status icons the user asked for)."
- Code: no emoji or pictographic characters anywhere in `jobtracker/templates`, `web/src` or `jobtracker/*.py` (checked with a Unicode-range grep). `DESIGN.md` line 348 says "no emoji" and line 367 says "Don't ... use emoji or unicode glyphs as icons". `.impeccable/design.json` line 461 repeats the rule. DESIGN.md documents only the inactive-background departure (Colors, Neutral).
- Proposed replacement for the sentence:
  `Where this app departs from the primer, DESIGN.md says so (for example the slightly stronger inactive background). Status is never shown with emoji.`

### DOC-3 DESIGN.md quotes banner copy and a setting value that the code does not use
- Location: `DESIGN.md` line 320 (Hosted-edition patterns, Demo banner) and line 193 (Overview).
- Claims: banner reads "Demo mode: not signed in, data stays in this browser."; corners setting is "(round/sharp)".
- Code: `web/src/app/LocalBanner.tsx` renders "Demo mode: not logged in, data stays in this browser." The corners values are `soft` and `sharp` (`web/src/sync/settings.ts` line 8, `jobtracker/settings.py` line 36, `PRODUCT.md` line 27 already says soft/sharp).
- Proposed: line 320 `("Demo mode: not logged in, data stays in this browser.")`; line 193 `corners (soft/sharp)`.

### DOC-4 SETUP.md Google section has a leftover step and the "steps 4 to 7" pointer is wrong
- Location: `SETUP.md` section 1, the note above step 1 and steps 4-7.
- Claim: "You can do steps 4 to 7 inside the app", and step 6 "Create the client and do step 7 after publishing in step 3."
- Code: step 4 already creates the client, so step 6 repeats it and sends the reader backwards. What the app does take (`jobtracker/templates/settings.html` lines 140-160) is the downloaded JSON (end of step 4, step 5) and the sign-in (step 7). The in-app panel is titled "Set up Gmail (one time)", then "Connect Gmail".
- Proposed note (replace the blockquote under "## 1. Google (Gmail)"):
  `> You can do steps 4 and 5 inside the app: **Settings → Email accounts → Set up Gmail (one time)** takes the downloaded JSON file, then **Connect Gmail** opens the sign-in (step 6). The setup is shared by every profile; each profile signs in with its own Gmail.`
- Proposed steps 4-6 (delete the old step 6, renumber 7 to 6):
  ```
  4. **Credentials → Create credentials → OAuth client ID → Desktop app.** Create it after you publish in step 3. Download the JSON.
  5. Save it as `secrets\gmail_client.json` (create the `secrets` folder if needed; it's git-ignored).
  6. Sign in:
  ```

### DOC-5 SETUP.md commands depend on a virtual environment that nothing creates, and the intro is a hand-off note with a personal path
- Location: `SETUP.md` lines 1-9.
- Claims: "The app is built and tested. What's left is signing in to your mail." "All commands run from `C:\Users\thorn\job-tracker`." Every command uses `.\.venv\Scripts\python.exe`.
- Code/repo: `.venv/` is git-ignored and absent from a fresh clone; no doc gives `pip install -r requirements.txt`. The local edition is Windows only: tokens use Windows DPAPI (`jobtracker/providers/base.py` line 52), pop-ups use `windows-toasts` (`jobtracker/jobs/notify.py`), and `scripts/install-task.ps1` registers Windows tasks. The golden fixtures were generated on Python 3.14.4 (`web/tests/fixtures/pipeline-golden.json` meta). No doc states a Python version.
- Proposed replacement for lines 1-9:
  ```
  # Setup

  This is the local edition: it runs on your own Windows PC and keeps everything there. It needs Windows 10 or 11 and Python 3.14 (the version the tests and fixtures are generated with; older versions are untested). Both mail accounts are **read-only**: the app can read mail but not send, delete, or change anything.

  All commands run from the project folder (the one that holds this file). Once, to install:

  ```powershell
  py -3.14 -m venv .venv
  .\.venv\Scripts\python.exe -m pip install -r requirements.txt
  .\.venv\Scripts\python.exe -m pytest -q        # optional: run the tests
  ```
  ```
  Also replace the unprefixed `python -m jobtracker ...` mentions in sections 3, 4 and "Profiles" with the `.\.venv\Scripts\python.exe -m jobtracker ...` form, or add one sentence: `Where this page writes python -m jobtracker, use .\.venv\Scripts\python.exe -m jobtracker.`

### DOC-6 SETUP.md "Nothing leaves this PC except ..." leaves out the paste-a-link fetch
- Location: `SETUP.md`, last paragraph of "Where your data lives".
- Claim: "Nothing leaves this PC except calls to Google and Microsoft to read your mail, and, if you add them, requests to company career pages and Adzuna."
- Code: the local Add application form has a **Fill in** button (`jobtracker/templates/index.html` line 260). `jobtracker/joblink.py` then fetches the pasted public page, the board APIs (Greenhouse, Lever, Ashby via POST to `jobs.ashbyhq.com`, SmartRecruiters), up to 4 redirects, 8 s total, and refuses non-public addresses. Sending a reply (opt-in) also goes to Google or Microsoft. `PRODUCT.md` Principle 3 already says "the sources the user adds".
- Proposed replacement for the final sentence:
  `Nothing leaves this PC except calls to Google and Microsoft (to read your mail, and to send a reply if you turn that on) and, if you use them, requests to company career pages and Adzuna (which see only search words, never your resume). When you press **Fill in** on a pasted job link in Add application, this PC also reads that public page or its job board's API; it refuses addresses that aren't on the public internet.`

### DOC-7 web/README.md commands are written for a working directory the page just left
- Location: `web/README.md` "Run it" (`cd web`), "Moving your existing data" and "Layout".
- Claim: `python scripts/export_json.py data/tracker.db export.json`, and "regenerate with `scripts/export_fixtures.py`".
- Code: the scripts live in the repo root `scripts/`, not `web/scripts/`; `data/tracker.db` is also root-relative. After `cd web` those paths fail. `scripts/export_json.py` uses `ROOT / "data" / "tracker.db"` as its default.
- Proposed: in "Moving your existing data" add `From the repository root, not web/:` before the code block; in Layout write `regenerate with scripts/export_fixtures.py in the repository root`.

### DOC-8 CSP comment in index.html names an owner that no longer fits
- Location: `web/index.html` line 8.
- Claim: "Owned by the auth work: keep connect-src minimal."
- Code: `connect-src` also carries the six job-board hosts added for paste-a-link (`web/src/jobs/enrich.ts`), so it is no longer only auth. And the privacy page is the user-facing mirror of this list but nothing says so.
- Proposed comment:
  `<!-- GitHub Pages cannot set response headers, so the policy is a meta tag. Keep connect-src minimal: add a host only when the app starts talking to it, and say so in public/privacy.html (What leaves your device) in the same change. -->`

---------------------------------------------------------------------------------------------------

## Missing

### DOC-9 No top-level README.md
Location: repo root. The root has `SETUP.md` (local edition, Windows), `PRODUCT.md`, `DESIGN.md`; the hosted edition's docs are in `web/README.md`. GitHub shows nothing on the landing page, and a new contributor cannot tell there are two editions. Proposed full outline with real content is at the end of this file ("Proposed root README.md").

### DOC-10 No LICENSE although the privacy page says "open source"
Location: `web/public/privacy.html` ("Job Tracker is open source"); repo has only font licences (`web/src/assets/fonts/LICENSES.md`, `jobtracker/static/fonts/LICENSES.md`). Without a LICENSE file the code is "all rights reserved" by default. Either add a LICENSE (owner's choice) or change the page to `Job Tracker's source is public on GitHub.`

### DOC-11 Deploy and CI are not described anywhere a contributor would look
Location: `.github/workflows/pages.yml`, `.github/CODEOWNERS`; `web/README.md` only says "the Actions run is linked from the page".
Facts from the files:
- Deploys on push to `main` when `web/**` or the workflow changes, and on manual dispatch. It runs `npm ci`, `npm test`, `npm run build` (Node 22), then Pages.
- No workflow runs on pull requests, and nothing runs the Python tests or `export_fixtures.py --check`.
- A change to `jobtracker/rules.yaml` alone does not deploy; the regenerated `web/src/pipeline/rules.json` is in `web/**`, so it does.
- `CODEOWNERS` makes `web/site-config.json` owner-reviewed because it decides whose Google or Microsoft app people consent to. (It only blocks merges if branch protection requires code-owner review. I cannot see repo settings.)
- Proposed section for `web/README.md`, after "Layout":
  ```
  ## Deploy and checks

  Pushing to `main` deploys when anything under `web/` (or `.github/workflows/pages.yml`) changed. The workflow runs `npm ci`, `npm test` and `npm run build` on Node 22, then publishes `web/dist`. You can also run it from the Actions tab. Nothing runs on pull requests, and nothing in CI runs the Python tests or `python scripts/export_fixtures.py --check`, so run those yourself before you push a change to `jobtracker/`.

  `.github/CODEOWNERS` makes the owner review any change to `web/site-config.json`, because it decides whose Google or Microsoft app people consent to.
  ```
- Also add to `web/README.md` "Run it": `Needs Node 22 or newer (what CI uses; there is no .nvmrc).`

### DOC-12 Parity workflow has a trap that is not written down: `--check` also fails on a different Python patch version
Location: `web/src/pipeline/PARITY_NOTES.md` ("Regenerate after changing Python behaviour or rules"); `scripts/export_fixtures.py` lines 828-834.
- Code: the fixture file stores `meta.python` (`3.14.4`) and `meta.unicode` (`16.0.0`), and `--check` compares the whole generated text. On Python 3.14.5, or any other version, `--check` reports "out of date" even if behaviour is identical, and regenerating on another Unicode version changes `unicodeTables.ts`.
- PARITY_NOTES says only "(--check fails when the committed fixtures are stale)".
- Proposed text for PARITY_NOTES after the two commands:
  `Run both with the same Python the committed files record (see "python" and "unicode" in web/tests/fixtures/pipeline-golden.json, currently 3.14.4 and Unicode 16.0.0). The version is part of the file, so --check also fails on a different Python, even when nothing else changed. Commit rules.json, unicodeTables.ts and pipeline-golden.json together.`

### DOC-13 Python files that the TypeScript port mirrors do not say so
Location: `jobtracker/classify.py`, `extract.py`, `match.py` (no module docstring); `links.py`, `mailtext.py` (docstring, no pointer); `jobtracker/rules.yaml` (header comment only about editing).
Every TS file in `web/src/pipeline` says "Port of jobtracker/X.py", but nothing points back, so a Python-only edit silently breaks the vitest parity run (`web/tests/pipeline/parity.test.ts`, `rules-sync.test.ts`).
Proposed addition (adapt the first line per file) at the top of each of those five modules:
```
"""Which emails are about a job, and what happened. Plain rules, no AI.

Ported to TypeScript in web/src/pipeline (the hosted edition). This file is the source of truth: after changing it or rules.yaml,
run `python scripts/build_rules_json.py` and `python scripts/export_fixtures.py`, then `cd web && npm test`.
See web/src/pipeline/PARITY_NOTES.md.
"""
```
And at the top of `jobtracker/rules.yaml` add:
```
# After editing, run `python scripts/build_rules_json.py` (copies this file to web/src/pipeline/rules.json) and
# `python scripts/export_fixtures.py`, so the hosted edition classifies the same way. See web/src/pipeline/PARITY_NOTES.md.
```

### DOC-14 How to run the Python tests and what they need
Location: `pytest.ini`, `requirements.txt`, `tests/` (29 test modules, no doc). `SETUP.md` has one line `pytest -q` inside the install step only. `requirements.txt` has no Python version, mixes runtime and test packages (`pytest`, `httpx`), and includes `windows-toasts` without a platform marker, which is a Windows-only package (installing on macOS or Linux is likely to fail; I could not confirm offline). `tests/conftest.py` already isolates `secrets/`.
Proposed: covered in the root README "Run the tests" section; optionally change the line to `windows-toasts; sys_platform == "win32"` if non-Windows contributors should be able to run the suite.

### DOC-15 Forking or renaming the repo needs five edits that no doc lists
Hard-coded owner and path: `web/vite.config.ts` line 6 (`base: "/job-tracker/"`), `web/src/site.ts` line 2 (`GITHUB_REPO`), `web/public/privacy.html` line 96 (issues link), `.github/CODEOWNERS` (handle), and the URLs in `web/README.md`, `PRODUCT.md`, `web/tests/**`.
Proposed README text (for `web/README.md`, after "One-time setup"):
```
### Hosting your own copy

Change these before you deploy a fork: `base` in `web/vite.config.ts` (the repository name, with slashes), `GITHUB_REPO` in `web/src/site.ts`, the issues link in `web/public/privacy.html`, and the owner in `.github/CODEOWNERS`. The setup page then shows your own origin and redirect URI.
```

### DOC-16 Hosted features that no doc mentions: Flow "Save as image", "Copy image" and "Share"
Location: `web/src/pages/flow/index.tsx` lines 198-211 (buttons and the line "The image shows totals only. It leaves out company names and email addresses."), `web/src/pages/flow/exportPng.ts`. Not in `web/README.md` (What people see / quick edits), `PRODUCT.md` (Capabilities, "Flow (Sankey chart with a table equivalent)") or `privacy.html` (data that leaves the device).
Proposed `PRODUCT.md` edit: `Flow (Sankey chart with a table equivalent, and Save as image, Copy image and Share for a picture that shows totals only)`.
Proposed `privacy.html` sentence (end of the "Export data and Export CSV" paragraph):
`Save as image, Copy image and Share on the Flow page make a picture of the chart that shows totals only, with no company names or email addresses. Share hands the picture to your device's own share menu, and the app doesn't send it anywhere.`

### DOC-17 `web/README.md` Layout and scripts are incomplete
Location: `web/README.md` "Run it" and "Layout".
- `npm run typecheck` and `npm run preview` exist (`web/package.json`) but are not listed; `npm run build` already runs `tsc --noEmit`.
- Layout omits `src/jobs` (paste-a-link and the bookmarklet), `src/demo` (demo data), `src/config.ts` and `src/site.ts` (IDs and repo links), `tests/` and `public/privacy.html`.
- Proposed "Run it" block:
  ```sh
  cd web
  npm install
  npm run dev        # http://localhost:5173/job-tracker/
  npm test           # vitest, about 20 seconds
  npm run typecheck  # tsc --noEmit
  npm run build      # typecheck, then a production build in web/dist
  npm run preview    # serve web/dist
  ```
- Proposed Layout lines to add:
  ```
  - `src/jobs` paste a job link (board lookups, the bookmarklet, pasted text)
  - `src/config.ts`, `src/site.ts` the OAuth client IDs and the repository links, both public by design
  - `src/demo` the demo data behind "Load demo data"
  - `public/privacy.html` the privacy page, served as `/job-tracker/privacy.html`
  - `tests` vitest suites, one folder per `src` area, plus `tests/fixtures`
  ```

---------------------------------------------------------------------------------------------------

## Inconsistent

### DOC-18 SETUP.md says publish the Google app "In production", web/README.md says keep it "Testing": needs one explanatory sentence in each, and a warning about sharing a project
- Locations: `SETUP.md` section 1 step 3 and `jobtracker/templates/settings.html` line 146 ("publish it to In production. Otherwise, your login expires weekly") versus `web/README.md` "Google Cloud" ("Consent screen: External, status Testing ... This list is the real access control") and `web/src/pages/setup/SetupGuide.tsx` ("leave the publishing status on Testing").
- Both are right for their client. The local edition uses a Desktop client with a refresh token (`jobtracker/providers/gmail.py`), and in Testing Google expires that refresh token after about 7 days. The hosted edition uses a Web client with a short-lived access token and no refresh token (`web/src/auth/google.ts` header), and keeps Testing on purpose so only listed test users can log in.
- Real hazard: the consent screen status (Branding, Audience, Data access) belongs to the Google Cloud project, not the client. One project cannot be both "In production" and "Testing", so someone who follows both docs in one project breaks one of them.
- Proposed sentence to add under SETUP.md step 3 (after the "Publish the app" bullet):
  `This is for the local edition's Desktop client. If you also run the hosted edition, create its Google client in a separate Google Cloud project: the hosted site keeps its consent screen in Testing (see web/README.md), and the status belongs to the project, not the client.`
- Proposed sentence for `web/README.md` under "Google Cloud", Consent screen bullet:
  `Use a project of its own. The local edition's setup (SETUP.md) publishes its consent screen "In production" so sign-ins don't expire weekly, and the status applies to the whole project. Here, Testing is deliberate: Google lets in only the test users you add, and the hosted app holds no long-lived sign-in that Testing would expire.`

### DOC-19 PRODUCT.md mixes the two editions in its Pages bullet, and calls the hosted edition "in progress" while web/README.md describes it as shipped
- Location: `PRODUCT.md` Capabilities, first bullet; Operating Context ("Hosted edition (`web/`, in progress)").
- The bullet lists Applications, Flow, Needs review, Detail, Settings with "export JSON or CSV, import", which is hosted-only; the local Settings has Profiles and no export or import (`jobtracker/templates/settings.html`). People (both editions) and the hosted Setup and Log in pages are missing from it; Jobs (local only) is missing too. The next bullet then says "Hosted edition v1 covers Applications, Flow, People, Needs review and Settings", which contradicts the first.
- Proposed replacement for the first Capabilities bullet:
  `- Pages, both editions: Applications (sortable, filterable list; rows expand in place to log notes and dated steps and to read emails), Flow (Sankey chart with a table equivalent), People, Needs review (emails the rules were unsure about), Application detail, Settings (accounts and sync, appearance; deliberately simple, with no email-filter rules). Local only: Jobs and Profiles. Hosted only: Log in, the #/setup guide, and in Applications a "Coming up" list of interviews in the next week, a follow-up nudge for applications quiet for 7 days, an optional Rounds column, selecting several rows to set a stage or delete, offer salary and decision deadline at the Offer stage, and in Settings Your data (export JSON or CSV, import).`
  And change `(`web/`, in progress)` to `(`web/`, deployed)` if that is now true.

### DOC-20 Vocabulary: "demo mode" and "local" mean different things in docs and code, and "sign in" and "log in" are mixed
- "Demo mode" (UI, README, privacy, DESIGN) is `isLocalMode()`, `LocalBanner`, `LOCAL_DB_NAME`, `localUser` in code, while "local edition" means the Python app.
- The UI says "Log in" and "Log out" (SignIn.tsx, SettingsPage.tsx); `PRODUCT.md`, `DESIGN.md` ("Sign-in page", "not signed in") and `scripts/export_json.py` say sign in. (Provider-facing words such as "sign in to your mail" in the local edition are fine.)
- Proposed: add a short Terms list to the root README (below), and a comment above `isLocalMode` in `web/src/config.ts`:
  `// "Local mode" here means a hosted build with no OAuth client IDs, shown to people as "demo mode". It is not the local edition (the Python app).`
  and use "log in" for the hosted app in docs.

### DOC-21 Scopes and permissions listed differently by the guide and the README
- `web/README.md` lists Google scopes `openid, email, profile, gmail.readonly` and Microsoft delegated `openid, profile, email, Mail.Read`. The in-app guide's Data access step says "add gmail.readonly. The app asks for these scopes in total" next to all four; its Microsoft step says only "add Mail.Read" next to all four.
- Whether Google's Data access page adds openid/email/profile for you and whether Entra needs the OpenID ones listed cannot be checked offline.
- Proposed (README, both bullets): `... Add only gmail.readonly (Mail.Read for Microsoft) on the console page. The other three are the standard login scopes and the app requests them at login.` Confirm in the consoles first; if the guide must add them, change the guide step to name all four.

### DOC-22 The local in-app Google steps skip the scope that SETUP.md requires
- `jobtracker/templates/settings.html` lines 149-154: create project, enable Gmail API, consent screen "(External) and publish", Desktop client, choose the file. `SETUP.md` step 3 also says "Add the scope `.../auth/gmail.readonly`". The in-app list also omits SETUP.md's "Google hasn't verified this app" warning.
- Proposed in-app step 2 wording:
  `Set up the <b>OAuth consent screen</b> (External), add the scope <code>gmail.readonly</code>, and publish it to <b>In production</b>. Otherwise, your login expires weekly.`

### DOC-23 Design docs drifted from each other and from the hosted edition
- `.impeccable/design.json` has `generatedAt` 2026-11-03; `DESIGN.md` gained the whole "Hosted-edition patterns" section after that. design.json has no hosted patterns, and its don't-rule says "color a badge beyond the six stage tones" while DESIGN.md says "color a stage beyond its entry in the one stage map".
- `.impeccable/surfaces/jobtracker-templates-base-html.md` scopes to `jobtracker/templates/*` ("Visual restyle only; behavior, URLs, copy facts, and data do not change", "on a local PC"). That is true for the local edition only; no surface brief covers `web/` (Log in, Setup, hosted Settings).
- DESIGN.md Layout line 265 lists a nav of "Jobs, Applications, People, Flow, Needs review, Settings gear" (local); the hosted header has no Jobs link (`web/src/app/pageProps.ts`). Typography says Figtree lives in `/static/fonts`; the hosted edition bundles it from `web/src/assets/fonts`.
- Proposed: regenerate design.json from DESIGN.md; add `(local edition; the hosted header has no Jobs link)` after the nav list in line 265 and `(hosted: web/src/assets/fonts)` after `/static/fonts` in line 245; add a one-line note at the top of the surface brief: `Scope: the local edition's templates. The hosted edition (web/) follows the same system; see DESIGN.md, Hosted-edition patterns.`

---------------------------------------------------------------------------------------------------

## Nice to have

### DOC-24 CHANGELOG
No `CHANGELOG.md`, no `release-please-config.json`, no `.release-please-manifest.json`, and no release-please workflow, so changelog management is not automated and none exists to update. `package.json` is `0.1.0` and private. Recommendation: skip it; git history uses descriptive commit titles.

### DOC-25 Privacy page gaps (the page is accurate on every material point; these are completeness items)
Verified true: scopes (`gmail.readonly`, `Mail.Read`); body cap 4,096 (`BODY_LIMIT`); hidden mail kept 30 days (`IGNORED_KEEP_DAYS` in `web/src/sync/decide.ts`); name only from Microsoft (`web/src/auth/google.ts` builds the user from `sub` and `email` only); tokens only in memory; revoke on log out for Google; tokeninfo at `oauth2.googleapis.com`; six job-board hosts; the bookmarklet only opens a URL with a hash.
Gaps, each with proposed text:
1. Other browser storage. Code writes `jobtracker:carryover-done` to localStorage (`web/src/app/carryOver.ts`) and dismissal flags to sessionStorage (`LocalBanner.tsx`, `LocalDataOffer.tsx`). The page names only the last-provider hint. Replace the last "What it stores" bullet with:
   `The name of the provider you last logged in with (Google or Microsoft), and a note that you've already brought earlier applications over, kept in local storage so the app can remember them. Neither is a secret. Session storage also holds your Dismiss and Not now choices until you close the tab.`
2. The login page contacts Google when it opens, not only when you click: `SignIn.tsx` calls `auth.prepare("google")` on load, which loads `https://accounts.google.com/gsi/client`. Add to "What leaves your device":
   `The login page loads Google's sign-in script from accounts.google.com as soon as it opens, so Google can tell the page was opened, and Microsoft's sign-in window talks to login.microsoftonline.com when you log in.`
3. Flow picture export: see DOC-16 text.
4. Scope of the page: add a first line under the title: `This page covers the hosted edition at thornleung01.github.io/job-tracker. The local edition runs on your own PC; its notes are in SETUP.md.`
5. Optional: a small table of the hosts the app can contact (copy from the CSP) so the page and `web/index.html` can be diffed by eye. Hosts: `accounts.google.com`, `oauth2.googleapis.com`, `gmail.googleapis.com`, `login.microsoftonline.com`, `graph.microsoft.com`, `boards-api.greenhouse.io`, `api.lever.co`, `api.eu.lever.co`, `api.ashbyhq.com`, `jobs.ashbyhq.com`, `api.smartrecruiters.com`.

Privacy cross-check, CSP against code: every network target in `web/src` (`fetch`, GIS script, MSAL, Gmail, Graph, board APIs) is listed in `connect-src`, `script-src` or `frame-src`; nothing in `web/src` contacts a host that the CSP does not allow. The only other `fetch(url)` is `exportPng.ts` reading the self-hosted font.

### DOC-26 web/README.md small accuracy and clarity edits
- "Export CSV ... whatever filters the list has on": the code exports every application, newest activity first, ignoring filters (`SettingsPage.tsx` calls `exportApplicationsCsv(db)`, which calls `listApplications(db)` with no query). The sentence reads as if filters narrow the export. Proposed: `Settings, Your data, Export CSV saves every application, ignoring any filters on the list, as job-tracker-applications-YYYY-MM-DD.csv ...`
- "the 'Set it up' link in Settings, Email accounts": that link appears only in demo mode (`SettingsPage.tsx` line 430). Proposed: `the "Set it up" link in Settings, Email accounts (shown while login is off), or Site setup on the login page, or type #/setup after the site address.`
- "Edit this app later, don't recreate it" appears for Microsoft only; add the Google equivalent: `Keep the same Google client too: changing the client ID changes nothing for saved data (a Google account id is stable), but an Authorized origin that no longer matches blocks login.` Only add if wanted.
- "Without them the site opens in demo mode: ... one local copy of your data in this browser": add `(the database jobtracker:local)` for developers.
- Add the dev origin to the in-app guide copy or README (the guide derives its values from the address it was opened at, so opening it on `http://localhost:5173/job-tracker/#/setup` gives the dev values; README already lists both, the guide lists one). One line under the Google origin step: `Developing locally? Also add http://localhost:5173.`

### DOC-27 SETUP.md small items
- "Settings -> Sync -> Re-check saved emails" uses ASCII arrows while the rest uses the arrow glyph.
- The line "Both accounts are read-only" is true at install time; a later "Optional, to reply from the app" adds send permission. The intro already says "read-only"; add `by default`. (PRODUCT.md says "read-only by default".)
- Add a short "Move to the hosted edition" pointer: `To bring your applications into the hosted site, run python scripts/export_json.py (see web/README.md, Moving your existing data).`
- `scripts/seed_demo.py` and the `JOBTRACKER_DB` variable are documented only in the script header. Add to SETUP.md, "Use it": `To look around with mock data, run .\.venv\Scripts\python.exe scripts\seed_demo.py, then $env:JOBTRACKER_DB = "data\demo.db" and start serve. Your real data is not touched.`

### DOC-28 Developer-facing odds and ends
- `scripts/export_json.py` has no `--help`: `python scripts/export_json.py --help` treats `--help` as the database path. The docstring is the only usage text. Acceptable, but a one-line `usage:` error when `argv[1]` starts with `-` would help.
- Test file names `test_second_review.py`, `test_third_review.py`, `test_fourth_review.py` describe when they were written, not what they cover; a one-line docstring each would orient a newcomer.
- `web/vite.config.ts` comment says tests never see the committed `site-config.json`; the `VITE_*` values in `web/.env.local` are read through `import.meta.env` and could still reach tests that call `loadConfig()` with defaults. I did not test this (it would need creating a file); if it matters, add: `Tests also should not depend on web/.env.local.`

---------------------------------------------------------------------------------------------------

## Console wording that I could not verify offline

In-app guide `web/src/pages/setup/SetupGuide.tsx` + `steps.ts`, and the local panel `jobtracker/templates/settings.html`:
1. Google Auth Platform menu names: Branding, Audience, Data access, Clients, and the deep links `console.cloud.google.com/auth/{branding,audience,scopes,clients}` (new Google Auth Platform, replacing the "OAuth consent screen" page). SETUP.md already hedges "may be called Google Auth platform".
2. Branding fields "App name", "User support email", "Developer contact information", and whether a github.io privacy link triggers an "Authorized domains" requirement (github.io is a public suffix; the page's own host may need to be added).
3. Audience: "External", "Publishing status: Testing", "Test users", the 100-user cap (the guide says up to 100).
4. Data access: "Add or remove scopes", and whether `openid`, `email`, `profile` are listed by default (see DOC-21). `gmail.readonly` is a restricted scope, so Google may require extra confirmation when you add it.
5. Clients: "Create client", "Application type: Web application", "Authorized JavaScript origins", "Client ID".
6. Entra: `entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade`, "New registration", the full text of the supported-account option (the guide shortens "Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts"), "Redirect URI" platform "Single-page application", Authentication page names for the local edition ("Allow public client flows", "Mobile and desktop applications"), "API permissions → Add a permission → Microsoft Graph → Delegated permissions → Mail.Read", and "Overview → Application (client) ID".
7. Hosted guide omits that a work or school Outlook account may need an admin to approve `Mail.Read` (SETUP.md says it for the local edition). Add to the Microsoft section of the guide: `A work or school account may need an admin to approve Mail.Read.` Also needed for the README "Inviting someone": `Outlook needs nothing extra for personal accounts; a work or school account may need admin approval.`

---------------------------------------------------------------------------------------------------

## Documentation map

| Doc | Audience | Status |
|---|---|---|
| `README.md` (root) | Anyone landing on the repo, new contributors | Missing (DOC-9, outline below) |
| `LICENSE` | Anyone reusing the code | Missing (DOC-10) |
| `SETUP.md` | Owner or user installing the local (Windows) edition | Needs fixes: DOC-4, 5, 6, 18, 27 |
| `web/README.md` | Owner and developers of the hosted edition | Mostly accurate; DOC-1, 7, 11, 15, 17, 18, 26 |
| `PRODUCT.md` | Design and product decisions, both editions | Needs fixes: DOC-2, 16, 19, 20 |
| `DESIGN.md` | Anyone writing UI | Needs fixes: DOC-3, 23 |
| `.impeccable/design.json` | Design tooling (generated from DESIGN.md) | Stale since 2026-11-03: DOC-23 |
| `.impeccable/surfaces/jobtracker-templates-base-html.md` | Design tooling, local templates | Accurate for local only; no hosted brief: DOC-23 |
| `web/public/privacy.html` | People logging in to the hosted app | Accurate; three completeness gaps: DOC-25, 16 |
| In-app: `web/src/pages/setup/*`, `SignIn.tsx`, `SettingsPage.tsx`, banners | Hosted owner and users | Accurate to the code; wording unverifiable offline; DOC-21, 26, 27(7) |
| In-app: `jobtracker/templates/settings.html` (Gmail and Outlook steps) | Local user | One step short of SETUP.md: DOC-22 |
| `web/src/pipeline/PARITY_NOTES.md` | Anyone changing the classifier | Accurate; missing the version trap: DOC-12 |
| File headers: `web/src/**`, `jobtracker/*.py` | Developers | Good on `web/`; Python parity modules lack pointers: DOC-13 |
| `scripts/*.py` header text, `scripts/install-task.ps1` | Developers, local user | Accurate except DOC-1; no `--help`: DOC-28 |
| `web/package.json` scripts | Developers | Four scripts, two unlisted: DOC-17 |
| `pytest.ini`, `requirements.txt` | Developers | Undocumented, `windows-toasts` unmarked: DOC-14 |
| `.github/workflows/pages.yml`, `.github/CODEOWNERS` | Maintainers | Undocumented: DOC-11 |
| `CHANGELOG.md` | n/a | Does not exist and none is required: DOC-24 |

---------------------------------------------------------------------------------------------------

## Proposed root README.md

```markdown
# Job Tracker

Follow your job applications from the emails in your own mailbox. Job Tracker reads Gmail and Outlook (read-only by default), recognises application emails with editable rules (no AI), and turns them into a list of applications with a stage, a history, and a Sankey chart of where they went. Everything stays on your own device.

There are two editions that share one visual system and one classifier.

| | Local edition | Hosted edition |
|---|---|---|
| Where | `jobtracker/` (Python, FastAPI, SQLite, Jinja) | `web/` (TypeScript, React, Dexie), a static site on GitHub Pages: https://thornleung01.github.io/job-tracker/ |
| Runs on | Your Windows PC, bound to 127.0.0.1 | Your browser, no server |
| Mail sign-in | Desktop-app OAuth client you create (SETUP.md) | Google or Microsoft login in the page (web/README.md) |
| Data | `data\tracker.db`, tokens encrypted with Windows DPAPI | IndexedDB in your browser, one database per logged-in user; tokens in memory only |
| Extras | Jobs tab, replying from the app, profiles, hourly background sync | Coming up, follow-up nudges, offer details, bulk actions, CSV export, setup guide |
| Docs | [SETUP.md](SETUP.md) | [web/README.md](web/README.md), [privacy page](web/public/privacy.html) |

## Quick start

Local edition (Windows, Python 3.14): see [SETUP.md](SETUP.md). In short:

    py -3.14 -m venv .venv
    .\.venv\Scripts\python.exe -m pip install -r requirements.txt
    .\.venv\Scripts\python.exe -m jobtracker serve      # http://127.0.0.1:8765

Hosted edition (Node 22): 

    cd web
    npm install
    npm run dev                                         # http://localhost:5173/job-tracker/

With no OAuth client IDs in `web/site-config.json` the site opens in demo mode: no login, no mailbox, sample data on request.

## Run the tests

    .\.venv\Scripts\python.exe -m pytest -q             # Python, from the repository root
    cd web && npm test                                  # TypeScript (vitest), about 20 seconds
    cd web && npm run typecheck

CI (`.github/workflows/pages.yml`) runs only the web tests and the build, and only on pushes to `main` that touch `web/`.

## How the two editions share one classifier

The Python in `jobtracker/{classify,extract,mailtext,links,match}.py` and `jobtracker/rules.yaml` is the source of truth. `web/src/pipeline` is a port, proven identical by golden fixtures. After you change either one:

    python scripts/build_rules_json.py     # rules.yaml -> web/src/pipeline/rules.json and unicodeTables.ts
    python scripts/export_fixtures.py      # rewrites web/tests/fixtures/pipeline-golden.json (--check to verify)
    cd web && npm test

Use the Python version recorded in the fixture file (3.14.4, Unicode 16.0.0). Details and known deviations: [web/src/pipeline/PARITY_NOTES.md](web/src/pipeline/PARITY_NOTES.md).

## Editing the rules

Wording the classifier misses goes in `jobtracker/rules.yaml` (case-insensitive regexes). Then regenerate as above. Emails already stored are not reclassified; run `python -m jobtracker sync --days N` (local) or Settings, Sync (hosted) to pick up older mail.

## Set up login for the hosted site (owner, once)

Open `#/setup` on the site, follow the Google and Microsoft steps, paste the two client IDs, and commit the generated `web/site-config.json` to `main`. Full facts: [web/README.md](web/README.md). Keep the hosted Google consent screen in Testing and use a Google Cloud project separate from the local edition's, which is published "In production".

## Moving data between editions

`python scripts/export_json.py data/tracker.db export.json`, then Settings, Your data, Import data in the hosted app. The export leaves out your resume, job-search profile and sign-in files.

## Deploy

Push to `main`. `.github/workflows/pages.yml` runs `npm ci`, `npm test` and `npm run build` in `web/`, and publishes `web/dist`. Changes to `web/site-config.json` need the owner's review (`.github/CODEOWNERS`).

## Layout

- `jobtracker/` local edition (CLI in `cli.py`, pages in `web.py` and `templates/`, `jobs/` for the Jobs tab, `providers/` for Gmail and Outlook)
- `web/` hosted edition (see its README for the folder map)
- `scripts/` `export_json.py`, `export_fixtures.py`, `build_rules_json.py`, `seed_demo.py`, `install-task.ps1`
- `tests/` Python tests; `web/tests/` TypeScript tests and fixtures
- `PRODUCT.md`, `DESIGN.md`, `.impeccable/` product and design decisions

## Terms

- Local edition: the Python app on your PC. Hosted edition: the static site.
- Demo mode: a hosted build with no OAuth client IDs (called "local mode" in the code).
- Profile: a local-edition feature that keeps one person's accounts and data apart. In the hosted edition each logged-in user has their own database instead.

## Privacy

Nothing is sent to a server run by the developer. See [web/public/privacy.html](web/public/privacy.html) for the hosted edition and "Where your data lives" in [SETUP.md](SETUP.md) for the local one.
```
