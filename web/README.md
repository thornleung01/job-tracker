# Job Tracker, hosted edition

A static, client-side build of Job Tracker for GitHub Pages (https://thornleung01.github.io/job-tracker/). There is no server. Login is Google or Microsoft OAuth in the browser, emails are read straight from Gmail and Microsoft Graph, and everything is stored in IndexedDB on your device, separately for each logged-in user. Tokens are kept in memory only, so after a reload you log in again (one click, and it reconnects your mailbox). Sync runs while the app is open.

The Python app in the repo root is the local edition (see [SETUP.md](../SETUP.md)); the two share one design and one classifier, and the root [README.md](../README.md) explains how. Product and design decisions are in `PRODUCT.md` and `DESIGN.md`.

## Run it

Needs Node 22 or newer (what the deploy uses; there is no `.nvmrc`). Run the commands from the `web` folder.

```sh
cd web
npm ci             # or npm install; installs exactly what package-lock.json says
npm run dev        # http://localhost:5173/job-tracker/
npm test           # vitest, the whole suite
npm run typecheck  # tsc --noEmit
npm run build      # typecheck, then a production build in web/dist
npm run preview    # serve web/dist
```

These are all the scripts in `package.json` (`npm run` lists them).

Login needs two app IDs, one for Google and one for Microsoft. Without them the site opens in demo mode: no login, no mailbox, one local copy of your data in this browser (the database `jobtracker:local`). The IDs live in `web/site-config.json`, which the setup page writes for you (see below). They are public by design.

You can also set them with `web/.env.local`:

```
VITE_GOOGLE_CLIENT_ID=...
VITE_MS_CLIENT_ID=...
```

or with the repository variables `GOOGLE_CLIENT_ID` and `MS_CLIENT_ID` (Settings, Secrets and variables, Actions, Variables), which `.github/workflows/pages.yml` passes to the build. A non-empty value from the build environment wins over `web/site-config.json`. An ID in the file must match the format of a Google or Microsoft ID, or it is ignored and the setup page says so.

## One-time setup (you do this in the consoles)

Open the site's `#/setup` page (https://thornleung01.github.io/job-tracker/#/setup, the "Set it up" link in Settings, Email accounts (shown while login is off), or Site setup on the login page) and follow it. It works in demo mode and while logged out. It gives you:

- numbered steps for the Google and Microsoft consoles, with a link to each page
- the exact values to copy, each with a Copy button: the JavaScript origin, the redirect URI and the scopes, taken from the address you opened it at
- fields to paste the two IDs into, checked as you type
- the text of `web/site-config.json`, with an "Open site-config.json on GitHub" link to the edit page

On GitHub, replace the file's contents with that text and commit to `main`. The site redeploys in a few minutes (the Actions run is linked from the page) and login turns on. There are no repository variables to set.

### Hosting your own copy

Change these before you deploy a fork: `base` in `web/vite.config.ts` (the repository name, with slashes), `GITHUB_REPO` in `web/src/site.ts`, the issues link in `web/public/privacy.html`, and the owner in `.github/CODEOWNERS`. The test files also name the repository. The setup page then shows your own origin and redirect URI, and you do the one-time setup again with your own Google and Microsoft apps.

### Without the guide

The same facts, compactly.

**Google Cloud**
- Enable the Gmail API.
- Create an OAuth client of type Web application. Authorized JavaScript origins: `https://thornleung01.github.io` and, for development, `http://localhost:5173`. No redirect URIs. (The setup guide shows the origin of the address you opened it at, so open it on `http://localhost:5173/job-tracker/#/setup` to get the development values.)
- Consent screen: External, status Testing. Add everyone you invite as a test user (up to 100). This list is the real access control.
- Use a Google Cloud project of its own for this. The local edition's setup ([SETUP.md](../SETUP.md)) publishes its consent screen "In production" so its logins don't expire weekly, and the status applies to the whole project, not to one client, so one project can't be both. Here, Testing is deliberate: Google lets in only the test users you add, and the hosted app holds no long-lived login that Testing would expire.
- Scopes: `openid`, `email` and `https://www.googleapis.com/auth/gmail.readonly`. The app doesn't ask for `profile`: it reads only your account ID and email address. The setup guide has you add `gmail.readonly` on the Data access page; `openid` and `email` are Google's standard login scopes. Invited people will see Google's "unverified app" screen.

**Microsoft Entra**
- Needs a free Azure account to have a directory.
- App registration, supported accounts: any organizational directory and personal Microsoft accounts.
- Platform: Single-page application. Redirect URIs: `https://thornleung01.github.io/job-tracker/` and `http://localhost:5173/job-tracker/`.
- Delegated permissions: `openid`, `profile`, `email`, `Mail.Read`. (`profile` is where the name comes from. A work or school account may need an admin to approve `Mail.Read`.)
- Edit this app later, don't recreate it. Microsoft gives each person a different user id in each app, so a new app would hide everyone's saved applications.

**GitHub**
- The repository must be public for free Pages.
- Settings, Pages, Source: GitHub Actions.

## Inviting someone

- Gmail: add their address under Test users on the Google consent screen (Audience page). Without that, Google refuses the login.
- They will see Google's notice that the app isn't verified. They choose Advanced, then Go to Job Tracker.
- Outlook needs nothing extra for a personal account. They choose Continue with Microsoft. A work or school account may need an admin to approve `Mail.Read`.
- The bottom of the setup page has a message you can copy and send them.

## What people see

- The login page has Continue with Google and Continue with Microsoft. One window logs them in and asks for read access to their mail. The last one they used is highlighted.
- If they say no to the mail permission, or the window fails, they can choose "Log in without connecting your mailbox" and connect later in Settings.
- After login the mailbox is added and the first sync starts by itself, on every page except Settings.
- If they saved applications in demo mode in this browser, the app offers to bring them into their account. It never does it automatically. Afterwards they can remove the earlier copy.
- Gmail's access is checked with Google (`oauth2.googleapis.com/tokeninfo`) to learn who logged in. Microsoft's ID token is still validated in the browser. Tokens stay in memory only, and Log out revokes the Google token.

## Moving your existing data

From the repository root, not `web/`:

```sh
python scripts/export_json.py data/tracker.db export.json
```

It opens the database read-only and writes `export.json` (with no second argument it writes `data/jobtracker-export.json`). Then log in to the hosted app and choose Settings, Your data, Import data. The app says the file is from the local edition and asks before it replaces everything in this browser. The export leaves out the resume and job-search profile.

## Paste a job link

In Add application, paste a job link and the form fills in what it can.

- **Greenhouse, Lever, Ashby, SmartRecruiters:** the app reads the company and role from the link, then confirms them with the board's public API (the six API hosts are allowed in the page's `connect-src`). Ashby uses its hosted pages' small lookup for the exact title, location and company, with the full board listing as a fallback. Lever's API has no company name and its hosted pages can't be read from a browser, so the company stays a marked guess. The bookmarklet gives the exact name.
- **Other sites:** the company and role are guessed from the link and marked "Guessed from the link".
- **LinkedIn, Indeed, Workday and company career pages:** use the "Save to Job Tracker" bookmarklet in Settings. It reads the page you are viewing in your own browser and opens the app with the details filled in. It never saves by itself.
- **Fallback:** "Or paste the job text instead" reads text you copied off the page.

One more case sends a request. A career page on another site that carries a `gh_jid` parameter (a Greenhouse job number) makes the app guess the Greenhouse board from the page's own domain and ask `boards-api.greenhouse.io` for that job. `public/privacy.html` says so. A wrong guess just finds nothing.

The link is stored on the application and shown as "Open posting". The local Python edition does the same from its server, with extra checks so it can't be pointed at internal addresses.

## Quick edits, interview rounds and offers

- **Quick edits:** on the Applications list, choose a role or an applied date to change it in place. Enter or leaving the field saves, and Escape puts the old value back. The stage is a dropdown. Changing it locks the stage, like setting it on the detail page, and shows Undo for a few seconds.
- **Interview rounds:** the application page counts rounds from your emails (one round per interview day, following reschedules and dropping cancelled ones, raised by named rounds such as "second round") and from the interview steps you log. It is an estimate until you type a number, and "Use estimate" takes you back. The number you type is saved in exports and kept when you merge applications.
- **Coming up:** interviews in the next 7 days show in a short list above the applications (up to five, soonest first), and "Interview Thu, Oct 15" shows under the stage of each application that has one. It comes from your interview emails, follows reschedules, drops cancelled ones, and skips Rejected and Offer. The list hides while any filter is on.
- **Follow-ups:** an Applied or Heard back application with no activity for 7 days gets a "Follow up?" tag. Tick "Needs follow-up" in the filters and choose Apply filters to see only those.
- **Rounds column:** in Settings, Appearance, choose Rounds as a table column (off by default). It sorts, stays blank where nothing is counted, and is hidden at phone widths like Role, Applied and Emails.
- **Offer details:** the application page has a Salary (up to 60 characters of free text) and a Decision deadline at the Offer stage. The list shows "Decision by Oct 15" under an Offer. Both are saved in exports and kept when you merge applications.
- **Several at once:** tick rows, or the box in the header for every row shown, to set a stage on all of them (which locks it, like the stage dropdown) or delete them and their emails. Your mailbox isn't touched. Changing a filter clears the ticks. Up to 500 at a time.
- **Duplicate warning:** the Add application form says "You already have ..." with a link when the posting link, or the company and role, match an existing application. It never blocks Save.

## Export a spreadsheet

Settings, Your data, Export CSV saves every application, ignoring any filters on the list, as `job-tracker-applications-YYYY-MM-DD.csv` for Excel, Numbers or Google Sheets. Columns: Company, Role, Stage, Applied, Last activity, Emails, Interview rounds, Posting link, Offer salary, Offer deadline. It has no email text and can't be imported back. Use Export data for a full copy.

## What is not in this edition

Replying from the app, the Jobs tab (resume matching, Adzuna, Windows pop-ups), multiple profiles (each logged-in user has their own data instead) and scheduled background sync.

## Layout

- `src/auth` login, token handling, per-user database name
- `src/providers` Gmail and Graph readers
- `src/pipeline` the classifier, ported from Python and checked against golden fixtures (see "Changing the classifier" below)
- `src/db`, `src/sync`, `src/portability` Dexie storage, sync, stats, import and export
- `src/jobs` paste a job link (board lookups, the bookmarklet, pasted text)
- `src/app`, `src/pages`, `src/components` the UI. `src/styles/base.css` is the shared stylesheet, kept in step with `jobtracker/templates/base.html`
- `src/config.ts`, `src/site.ts` the OAuth client IDs and the repository links, both public by design
- `src/demo` the demo data behind "Load demo data"
- `site-config.json` the two app IDs the setup page writes
- `index.html` the page shell, with the Content-Security-Policy (see "Deploy and checks")
- `public/privacy.html` the privacy page, served as `/job-tracker/privacy.html`
- `tests` vitest suites, one folder per `src` area, plus `tests/fixtures`

## Changing the classifier

The classifier exists twice, and the Python one is the source of truth. After changing `jobtracker/{classify,extract,mailtext,links,match}.py` or `jobtracker/rules.yaml`, run these from the repository root, then the web tests:

```sh
python scripts/build_rules_json.py     # rules.yaml -> web/src/pipeline/rules.json and unicodeTables.ts
python scripts/export_fixtures.py      # rewrites web/tests/fixtures/pipeline-golden.json
cd web && npm test
```

The trap: skipping this breaks the web tests (`parity.test.ts`, `rules-sync.test.ts`), and running it with a different Python can change the output. The fixtures record the Python and Unicode versions that made them (`meta` in `pipeline-golden.json`). `export_fixtures.py --check` ignores only the Python patch number; a different minor version or Unicode version still counts as out of date. Details, and how to add a case, are in `src/pipeline/PARITY_NOTES.md`.

## Deploy and checks

Pushing to `main` deploys when anything under `web/` (or `.github/workflows/pages.yml`) changed. The workflow runs `npm ci`, `npm test` and `npm run build` on Node 22, then publishes `web/dist`. You can also run it from the Actions tab. The deploy workflow doesn't run on pull requests, and it doesn't run the Python tests or `python scripts/export_fixtures.py --check`, so run those yourself before you push a change to `jobtracker/`. A change to `jobtracker/rules.yaml` alone doesn't deploy, but the regenerated `web/src/pipeline/rules.json` is under `web/`, so committing both does.

`.github/CODEOWNERS` makes the owner review changes to `web/site-config.json`, `web/src/auth/`, `web/src/config.ts`, `web/index.html`, `web/public/privacy.html` and `.github/`, because they decide who can log in, whose Google or Microsoft app people consent to, and what the site tells people about their data. It only blocks a merge if branch protection requires code-owner review.

To check that Google's token endpoint and the job-board APIs still accept requests from the live site's origin, run `node web/scripts/probe-cors.mjs` by hand (it takes an origin as an optional argument and isn't part of CI). It needs network access, and prints one line per check.

GitHub Pages can't set response headers, so the Content-Security-Policy is a `<meta>` tag in `index.html`. Every host in its `connect-src` is a place the app sends requests to. Add one only for a feature that needs it, and list it in `public/privacy.html` in the same change.

## Known risk: the shared github.io origin

Browser storage and Google's "Authorized JavaScript origins" belong to an origin (scheme, host and port), not to a path. GitHub Pages serves every project site of one account from the same origin, `https://thornleung01.github.io`, and `/job-tracker/` is only a path. So any other page on that origin (another repository's Pages site, a future project, a page with a cross-site scripting bug) could read this app's IndexedDB databases, and could ask Google for a Gmail token using this app's public client ID for anyone who has already consented to it. Microsoft is less exposed, because its redirect URI is an exact match on the path. A forked copy has the same exposure on its own github.io origin.

This isn't fixed yet. The fix is to serve the app from an origin of its own: a custom domain, or an account or organization that hosts only this site. That is a decision for the repository owner (it needs a domain and DNS, plus new Google and Microsoft origins and redirect URIs). Until then, don't publish any other GitHub Pages site from this account. Moving origins also moves the browser databases, so people would need to export their data and import it on the new site.
