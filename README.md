# Job Tracker

Follow your job applications from the emails in your own mailbox. Job Tracker reads Gmail and Outlook (read-only by default), recognizes application emails with editable rules (no AI reads your mail; AI is opt-in for resumes, with your own key), and turns them into a list of applications with a stage, a history, and a Sankey chart of where they went. Everything stays on your own device. Nothing is sent to a server run by the developer.

There are two editions that share one visual system and one classifier.

| | Local edition | Hosted edition |
|---|---|---|
| Where | `jobtracker/` (Python, FastAPI, SQLite, Jinja) | `web/` (TypeScript, React, Dexie), a static site on GitHub Pages: <https://thornleung01.github.io/job-tracker/> |
| Runs on | Your PC, bound to `127.0.0.1`. Made for Windows 10 or 11 | Your browser, no server |
| Mail login | A desktop-app OAuth client you create ([SETUP.md](SETUP.md)) | Google or Microsoft login in the page ([web/README.md](web/README.md)) |
| Data | `data\tracker.db`. Login tokens are encrypted with Windows DPAPI | IndexedDB in your browser, one database per logged-in user. Tokens are kept in memory only |
| Extras | Jobs tab, replying from the app, profiles, hourly background sync | Coming up, a calendar view, follow-up nudges and drafts, offer details, resume and cover letters (resumes print in a one-page classic template), optional AI to convert an uploaded resume into your template with your own Anthropic key, bulk actions, Recently deleted, backups, CSV export, a guided setup page |
| Docs | [SETUP.md](SETUP.md) | [web/README.md](web/README.md) and the [privacy page](web/public/privacy.html) |

Product and design decisions for both are in [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md).

## What the hosted edition does

Everything below is in the hosted edition only. Each item says what you see. [web/README.md](web/README.md) has the details and where the code lives.

- **Applications list:** sort, filter by stage, account and follow-up, and search. Search also reads email subjects and bodies, notes, steps, the job posting and the cover letter (all the words, in any order, ignoring accents) and says "Matched in an email" under the company. Save a filter and sort as a named view (up to 12). Edit a role, applied date or stage in place. Tick rows to set a stage or resume, or delete several at once.
- **Calendar view:** a List and Calendar toggle on the Applications page. The month shows interviews, applied dates, offer decision deadlines, follow-ups and the steps you logged, with the same filters as the list. Weeks start on Monday. On a phone it becomes a list by day. Interview days are guessed from email text, so they can be wrong or missing.
- **Add to calendar:** save an interview day, all upcoming interviews, one day or a whole month as a `.ics` file for your own calendar app. The file is made on your device.
- **Follow-ups:** a "Follow up?" tag after 7 quiet days, "No reply in 30 days" after a month, and a "Draft follow-up" button that opens a new unsent message in your own Gmail or Outlook. The app never sends mail.
- **Offers and goals:** salary and decision deadline at the Offer stage, a Compare offers card when you have two or more, and an optional weekly goal for applications sent.
- **Add faster:** paste a job link, or "Add several links" (up to 10 at once).
- **Keyboard shortcuts:** `/` to search, `j` and `k` to move, `g` then `r` for Resume, and more. Press `?` on the Applications page.
- **Recently deleted:** deleting an application keeps it, with its emails and notes, in Settings for 30 days so you can restore it. Deleted resumes and cover letters wait there too.

## Your data and backups

The hosted edition keeps everything in your browser, so the browser is the only copy. Three things protect it:

- **Ask the browser to keep it.** Once there is data, the app asks the browser not to clear its storage when the device runs low on space. Chrome and Edge decide without asking, Firefox may show a prompt, and Safari may refuse. Settings, Your data says whether the browser will keep it and how much space it uses.
- **Back up.** Settings, Your data, Export data saves a JSON file you can import again. Only this export counts as a backup: the CSV has no emails or notes and can't be imported. If your last backup is more than 14 days old, or you have none, the Applications page shows a quiet reminder. "Remind me in a week" hides it for 7 days. In Chrome and Edge you can also choose one backup file and use "Back up now" to overwrite it without a download each time.
- **Restore.** Import data replaces everything in that browser, after asking. A deleted application can come back from Settings, Recently deleted for 30 days. The JSON export and the backup file include applications, resumes and cover letters in Recently deleted until they are erased.

You can install the site as an app from your browser's menu. It still needs the network to read mail, and it keeps no offline copy. Nothing is sent to a server run by the developer: see the [privacy page](web/public/privacy.html).

## Quick start

Local edition (Windows, Python 3.14). The full guide, including the Google and Microsoft setup, is [SETUP.md](SETUP.md):

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt   # requirements.txt is enough to only run the app
.\.venv\Scripts\python.exe -m jobtracker serve                      # http://127.0.0.1:8765
```

On macOS or Linux the same works for development: use `python3.14 -m venv .venv` and `.venv/bin/python`. There is no Windows encryption there (login files are plain text, readable only by your user) and no job pop-ups.

Hosted edition (Node 22 or newer):

```sh
cd web
npm ci
npm run dev        # http://localhost:5173/job-tracker/
```

With no Google or Microsoft app IDs in `web/site-config.json` the site opens in demo mode: no login, no mailbox, sample data on request.

## Run the tests

```powershell
.\.venv\Scripts\python.exe -m pytest -q     # Python, from the repository root
```

```sh
cd web
npm test                                    # TypeScript (vitest)
npm run typecheck                           # tsc --noEmit
```

Two scripts check that generated files are current. Run both before you push a change to the classifier or its rules:

```sh
python scripts/build_rules_json.py --check
python scripts/export_fixtures.py --check
```

The workflow that deploys the site (`.github/workflows/pages.yml`) runs only the web tests and the build, and only on pushes to `main` that change `web/`. It doesn't run on pull requests and it doesn't run the Python tests, so run those yourself.

## One classifier, two editions

The Python in `jobtracker/{classify,extract,mailtext,links,match}.py` and `jobtracker/rules.yaml` is the source of truth. `web/src/pipeline` is a TypeScript port, proven identical by golden fixtures: the real Python functions run over a fixed corpus and the web tests require the port to return the same answers. After you change either side:

```sh
python scripts/build_rules_json.py     # rules.yaml -> web/src/pipeline/rules.json and unicodeTables.ts
python scripts/export_fixtures.py      # rewrites web/tests/fixtures/pipeline-golden.json
cd web && npm test
```

Use the Python version the fixtures record (see `meta` in `web/tests/fixtures/pipeline-golden.json`, currently 3.14.4 with Unicode 16.0.0). The `--check` form of `export_fixtures.py` ignores only the Python patch number, so a different minor version still fails. Commit `rules.json`, `unicodeTables.ts` and `pipeline-golden.json` together. Rules for the port, its known deviations and how to add a case are in [web/src/pipeline/PARITY_NOTES.md](web/src/pipeline/PARITY_NOTES.md).

### Editing the rules

Wording the classifier misses goes in `jobtracker/rules.yaml` (case-insensitive regular expressions). Then regenerate as above. Emails already stored aren't reclassified: run `python -m jobtracker sync --days N` (local edition) or use Settings, Sync (hosted edition) to pick up older mail.

## Deploy the hosted site

The site is deployed by GitHub Actions to GitHub Pages. The repository must be public for free Pages, and Settings, Pages, Source must be GitHub Actions.

1. Open `#/setup` on the site (<https://thornleung01.github.io/job-tracker/#/setup>) and follow the Google and Microsoft console steps. Keep the Google consent screen in Testing, and use a Google Cloud project that is separate from the local edition's, which is published "In production" (one project can't be both).
2. Paste the two client IDs into the page. It writes the text of `web/site-config.json`. Commit that file to `main`. The IDs are public by design.
3. Pushing to `main` runs `.github/workflows/pages.yml`: `npm ci`, `npm test`, `npm run build` in `web/`, then it publishes `web/dist`.

Changes to `web/site-config.json`, `web/src/auth/`, `web/src/config.ts`, `web/index.html`, `web/public/privacy.html` and `.github/` need the owner's review (`.github/CODEOWNERS`). To host a fork, see "Hosting your own copy" in [web/README.md](web/README.md). That file also describes a known risk of serving the site from the shared `github.io` origin.

## Moving data between editions

From the repository root, `python scripts/export_json.py data/tracker.db export.json` writes a file the hosted edition can import. Then, in the hosted app, choose Settings, Your data, Import data. The app asks before it replaces everything in that browser. The export leaves out your resume, job-search profile and login files.

## Layout

- `jobtracker/` local edition (CLI in `cli.py`, app setup in `web.py`, pages in `routes/` and `templates/`, `jobs/` for the Jobs tab, `providers/` for Gmail and Outlook)
- `web/` hosted edition (see its README for the folder map)
- `scripts/` `export_json.py`, `export_fixtures.py`, `build_rules_json.py`, `seed_demo.py`, `install-task.ps1`
- `tests/` Python tests. `web/tests/` TypeScript tests and fixtures
- `PRODUCT.md`, `DESIGN.md`, `.impeccable/` product and design decisions
- `docs/reviews/` written reviews of the code (see below)

## Contributing

- **Copy** (anything a person reads in the app): sentence case, contractions, no semicolons, no em-dashes, no emoji, Canadian spelling. Say "log in" and "log out" (not "sign in"), "email" for a message, and keep it plain and short. Both editions follow this.
- **Design:** read [DESIGN.md](DESIGN.md) before changing any screen. The short version: take colors, radii and sizes from the CSS variables (never literal values), use Lucide icons only, no underlined links, no tabular numbers, no uppercase text, and every surface has to work in light and dark and with every appearance setting. The two stylesheets (`jobtracker/templates/base.html` and `web/src/styles/base.css`) are kept in step by hand.
- **Classifier changes:** both editions must give the same answers. Follow "One classifier, two editions" above.
- **Privacy:** if a change makes the hosted app contact a new host or store something new in the browser, update `web/index.html` (the Content-Security-Policy) and `web/public/privacy.html` in the same change.
- **Tests:** a behavior change needs a test that fails without the change. Keep `npx tsc --noEmit` in `web/` clean.

## Terms

- **Local edition:** the Python app on your PC. **Hosted edition:** the static site.
- **Demo mode:** a hosted build with no OAuth client IDs, where nothing is logged in. The code calls it "local mode". It isn't the local edition.
- **Profile:** a local-edition feature that keeps one person's accounts and data apart. In the hosted edition each logged-in user has their own database instead.

## Privacy

Nothing is sent to a server run by the developer. In the hosted edition, if you add your own Anthropic key and press Convert, your browser sends the resume text shown to Anthropic when you press Convert, and one short test message ("ping", no resume text) when you press Check key. Nothing else is sent. See [web/public/privacy.html](web/public/privacy.html) for the hosted edition and "Where your data lives" in [SETUP.md](SETUP.md) for the local one.

## Reviews

A full review of the code, tests and docs was done on 2026-11-05. Its findings, the evidence and the fix plan are in [docs/reviews/2026-11-05-full-codebase-review/README.md](docs/reviews/2026-11-05-full-codebase-review/README.md).

## License

Not yet chosen. Until a license file is added, the code is all rights reserved by default.
