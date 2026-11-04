# Job Tracker, hosted edition

A static, client-side build of Job Tracker for GitHub Pages (https://thornleung01.github.io/job-tracker/). There is no server. Sign-in is Google or Microsoft OAuth in the browser, mail is read straight from Gmail and Microsoft Graph, and everything is stored in IndexedDB on your device, separately for each signed-in user. Tokens are kept in memory only, so after a reload you sign in and connect mail again. Sync runs while the app is open.

The Python app in the repo root is the local edition and is unchanged by this. See `PRODUCT.md` and `DESIGN.md`.

## Run it

```sh
cd web
npm install
npm run dev        # http://localhost:5173/job-tracker/
npm test
npm run build
```

Sign-in needs two client IDs. Put them in `web/.env.local`:

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

## What is not in this edition

Replying from the app, the Jobs tab (resume matching, Adzuna, Windows pop-ups), multiple profiles (each signed-in user has their own data instead) and scheduled background sync.

## Layout

- `src/auth` sign-in, token handling, per-user database name
- `src/providers` Gmail and Graph readers
- `src/pipeline` the classifier, ported from Python and checked against golden fixtures (`tests/fixtures/pipeline-golden.json`, regenerate with `scripts/export_fixtures.py`)
- `src/db`, `src/sync`, `src/portability` Dexie storage, sync, stats, import and export
- `src/app`, `src/pages`, `src/components` the UI; `src/styles/base.css` is the shared stylesheet, kept in step with `jobtracker/templates/base.html`
