# Job Tracker

Follow your job applications from the emails in your own mailbox. Job Tracker reads Gmail and Outlook (read-only by default), recognizes application emails with editable rules (no AI), and turns them into a list of applications with a stage, a history, and a Sankey chart of where they went. Everything stays on your own device. Nothing is sent to a server run by the developer.

There are two editions that share one visual system and one classifier.

| | Local edition | Hosted edition |
|---|---|---|
| Where | `jobtracker/` (Python, FastAPI, SQLite, Jinja) | `web/` (TypeScript, React, Dexie), a static site on GitHub Pages: <https://thornleung01.github.io/job-tracker/> |
| Runs on | Your PC, bound to `127.0.0.1`. Made for Windows 10 or 11 | Your browser, no server |
| Mail login | A desktop-app OAuth client you create ([SETUP.md](SETUP.md)) | Google or Microsoft login in the page ([web/README.md](web/README.md)) |
| Data | `data\tracker.db`. Login tokens are encrypted with Windows DPAPI | IndexedDB in your browser, one database per logged-in user. Tokens are kept in memory only |
| Extras | Jobs tab, replying from the app, profiles, hourly background sync | Coming up, follow-up nudges, offer details, bulk actions, CSV export, a guided setup page |
| Docs | [SETUP.md](SETUP.md) | [web/README.md](web/README.md) and the [privacy page](web/public/privacy.html) |

Product and design decisions for both are in [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md).

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

Nothing is sent to a server run by the developer. See [web/public/privacy.html](web/public/privacy.html) for the hosted edition and "Where your data lives" in [SETUP.md](SETUP.md) for the local one.

## Reviews

A full review of the code, tests and docs was done on 2026-11-05. Its findings, the evidence and the fix plan are in [docs/reviews/2026-11-05-full-codebase-review/README.md](docs/reviews/2026-11-05-full-codebase-review/README.md).

## License

Not yet chosen. Until a license file is added, the code is all rights reserved by default.
