# Job Tracker, hosted edition

A static, client-side build of Job Tracker for GitHub Pages (https://thornleung01.github.io/job-tracker/). There is no server. Login is Google or Microsoft OAuth in the browser, emails are read straight from Gmail and Microsoft Graph, and everything is stored in IndexedDB on your device, separately for each logged-in user. Tokens are kept in memory only, so after a reload you log in and connect your mailbox again. Sync runs while the app is open.

The Python app in the repo root is the local edition and is unchanged by this. See `PRODUCT.md` and `DESIGN.md`.

## Run it

```sh
cd web
npm install
npm run dev        # http://localhost:5173/job-tracker/
npm test
npm run build
```

Login needs two client IDs. Put them in `web/.env.local`:

```
VITE_GOOGLE_CLIENT_ID=...
VITE_MS_CLIENT_ID=...
```

For the deployed site, set the same values as repository variables `GOOGLE_CLIENT_ID` and `MS_CLIENT_ID` (Settings, Secrets and variables, Actions, Variables). They are public by design. The workflow in `.github/workflows/pages.yml` passes them to the build.

## One-time setup (you do this in the consoles)

**Google Cloud**
- Create an OAuth client of type Web application.
- Authorized JavaScript origins: `https://thornleung01.github.io` and, for development, `http://localhost:5173`.
- Consent screen: External, status Testing. Add everyone you invite as a test user (up to 100). This list is the real access control.
- Scopes: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/gmail.readonly`. Invited people will see Google's "unverified app" screen.

**Microsoft Entra**
- App registration, supported accounts: any organizational directory and personal Microsoft accounts.
- Platform: Single-page application. Redirect URIs: `https://thornleung01.github.io/job-tracker/` and `http://localhost:5173/job-tracker/`.
- Delegated permissions: `openid`, `profile`, `email`, `Mail.Read`.

**GitHub**
- The repository must be public for free Pages.
- Settings, Pages, Source: GitHub Actions.

## Moving your existing data

```sh
python scripts/export_json.py data/tracker.db export.json
```

It opens the database read-only and writes `export.json`. Then use Settings, Your data, Import in the hosted app. The export leaves out the resume and job-search profile.

## Paste a job link

In Add application, paste a job link and the form fills in what it can.

- **Greenhouse, Lever, Ashby, SmartRecruiters:** the app reads the company and role from the link, then confirms them with the board's public API (the six API hosts are allowed in the page's `connect-src`). Ashby uses its hosted pages' small lookup for the exact title, location and company, with the full board listing as a fallback. Lever's API has no company name and its hosted pages can't be read from a browser, so the company stays a marked guess. The bookmarklet gives the exact name.
- **Other sites:** the company and role are guessed from the link and marked "Guessed from the link".
- **LinkedIn, Indeed, Workday and company career pages:** use the "Save to Job Tracker" bookmarklet in Settings. It reads the page you are viewing in your own browser and opens the app with the details filled in. It never saves by itself.
- **Fallback:** "Or paste the job text instead" reads text you copied off the page.

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

Settings, Your data, Export CSV saves every application as `job-tracker-applications-YYYY-MM-DD.csv` for Excel, Numbers or Google Sheets, whatever filters the list has on. Columns: Company, Role, Stage, Applied, Last activity, Emails, Interview rounds, Posting link, Offer salary, Offer deadline. It has no email text and can't be imported back. Use Export data for a full copy.

## What is not in this edition

Replying from the app, the Jobs tab (resume matching, Adzuna, Windows pop-ups), multiple profiles (each logged-in user has their own data instead) and scheduled background sync.

## Layout

- `src/auth` login, token handling, per-user database name
- `src/providers` Gmail and Graph readers
- `src/pipeline` the classifier, ported from Python and checked against golden fixtures (`tests/fixtures/pipeline-golden.json`, regenerate with `scripts/export_fixtures.py`)
- `src/db`, `src/sync`, `src/portability` Dexie storage, sync, stats, import and export
- `src/app`, `src/pages`, `src/components` the UI. `src/styles/base.css` is the shared stylesheet, kept in step with `jobtracker/templates/base.html`
