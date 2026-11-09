# Setup

This is the local edition of Job Tracker: it runs on your own PC and keeps everything there. (The hosted edition is a website that needs no install. See [web/README.md](web/README.md).) The local edition is made for Windows 10 or 11 and needs Python 3.14, which is the version the tests and the classifier fixtures are generated with. Older versions are untested. By default both mail accounts are **read-only**: the app can read mail but not send, delete, or change anything. Sending a reply is a separate permission you can turn on per account later (see "Replying").

On macOS or Linux it runs well enough to develop and test with. There is no Windows encryption there, so sign-in files are plain text that only your user can read, and there are no job pop-ups.

All commands run from the project folder (the one that holds this file). Once, to install:

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

`requirements.txt` is everything the app needs to run. To run the tests or the maintenance scripts too, install `requirements-dev.txt` instead, which includes it:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q        # optional: run the tests
```

Everything below that says `python -m jobtracker` means `.\.venv\Scripts\python.exe -m jobtracker`.

> **Use it on a computer only you use.** The dashboard listens on `127.0.0.1` only, so other computers can't reach it, but it has no login of its own. It is protected from other web pages in your browser, not from other programs. Anything else running on the same computer, including another person's account on a shared PC, could use it the way your browser does.

## 1. Google (Gmail)

> You can do steps 4 and 5 inside the app: **Settings → Email accounts → Set up Gmail (one time)** takes the downloaded JSON file, then **Connect Gmail** opens the login (step 6). The setup is shared by every profile; each profile logs in with its own Gmail.

1. Go to <https://console.cloud.google.com/> and create a project (any name, e.g. "Job Tracker").
2. **APIs & Services → Library** → search **Gmail API** → **Enable**.
3. **APIs & Services → OAuth consent screen** (may be called *Google Auth platform*):
   - User type **External**; fill in the app name and your email.
   - Add the scope `.../auth/gmail.readonly`.
   - **Publish the app: set status to "In production".** While it's in *Testing*, Google expires the login every ~7 days and syncing breaks.
   - This is for the local edition's Desktop client. **Use a Google Cloud project of its own for it.** If you also run the hosted edition, create that edition's Google client in a separate project: the hosted site keeps its consent screen in *Testing* on purpose (see [web/README.md](web/README.md)), and the status belongs to the whole project, not to one client. One project can't be both "In production" and "Testing".
4. **Credentials → Create credentials → OAuth client ID → Desktop app.** Create it after you publish in step 3. Download the JSON.
5. Save it as `secrets\gmail_client.json` (create the `secrets` folder if needed; it's git-ignored).
6. Log in:
   ```powershell
   .\.venv\Scripts\python.exe -m jobtracker connect gmail
   ```
   A browser opens. Google will say **"Google hasn't verified this app"**. That's expected, since you made the app. Choose *Advanced → Go to (app name)* and allow read access.

> **Optional, to reply from the app:** under **Data Access** (the consent screen), also add the scope `.../auth/gmail.send`. Then in Settings press **Allow replying** for the account. Reading never uses it.

## 2. Microsoft (Outlook / Hotmail)

> Steps 4 and 5 also work inside the app: **Settings → Email accounts → Set up Outlook (one time)** takes the Application (client) ID, then **Connect Outlook** opens the login.

1. Go to <https://entra.microsoft.com/> → **App registrations → New registration**.
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
   - Redirect URI: platform **Mobile and desktop applications**, value `http://localhost`.
2. On the app's **Authentication** page, set **Allow public client flows** to **Yes**.
3. **API permissions → Add → Microsoft Graph → Delegated → `Mail.Read`**.
4. Copy the **Application (client) ID** from the Overview page and save this as `secrets\outlook_client.json`:
   ```json
   { "client_id": "00000000-0000-0000-0000-000000000000" }
   ```
5. Log in:
   ```powershell
   .\.venv\Scripts\python.exe -m jobtracker connect outlook
   ```

> **Optional, to reply from the app:** under **API permissions**, also add Microsoft Graph, Delegated, `Mail.Send`. Then in Settings press **Allow replying** for the account.

Caveats:
- If a personal Microsoft account can't open Entra without a directory, create a free Azure account at <https://azure.microsoft.com/free> with the same login and retry.
- A **work or school** Outlook account may need an admin to approve `Mail.Read`.

## 3. Use it

Start the dashboard with `python -m jobtracker serve` and open **Settings**. Everything below can be done there: connect Gmail or Outlook, press **Sync now**, and change the look (theme, accent color, density, corners, list columns).

The same actions are available from the command line:

```powershell
.\.venv\Scripts\python.exe -m jobtracker sync            # first run reads the last 30 days
.\.venv\Scripts\python.exe -m jobtracker sync --days 90  # look further back
.\.venv\Scripts\python.exe -m jobtracker serve           # dashboard at http://127.0.0.1:8765
.\.venv\Scripts\python.exe -m jobtracker serve --port 9000
.\.venv\Scripts\python.exe -m jobtracker status
```

`serve --port` also tells the pop-ups which port to open. A `sync` or `jobs` run that starts on its own (the hourly task below) doesn't know about it, so if you keep the dashboard on another port, set the `JOBTRACKER_PORT` environment variable to the same number for those runs. The default is 8765.

Optional hourly background sync, plus the dashboard starting when you log in to Windows (only while you're logged in):

```powershell
.\scripts\install-task.ps1
```

To look around with mock data first, make a separate demo database and point the app at it. Your real data isn't touched:

```powershell
.\.venv\Scripts\python.exe scripts\seed_demo.py                  # writes data\demo.db, replacing it if it exists
$env:JOBTRACKER_DB = "data\demo.db"
.\.venv\Scripts\python.exe -m jobtracker serve
```

`JOBTRACKER_DB` works for any database file, not only the demo one.

To bring your applications into the hosted edition, run `scripts\export_json.py` (see [web/README.md](web/README.md), "Moving your existing data"):

```powershell
.\.venv\Scripts\python.exe scripts\export_json.py        # data\tracker.db -> data\jobtracker-export.json
```

## Profiles

A **profile** keeps one person's (or one job search's) mail accounts, applications, job matches, settings and logins apart from everyone else's. Add one in **Settings → Profiles**, then switch with the menu at the top of every page (it appears once you have two). Your first profile keeps the original database and login files, so nothing moves. Each extra profile lives in `data\profiles\<id>\` and `secrets\profiles\<id>\`, and deleting a profile removes those folders.

From the command line, add `--profile <id>` (see `python -m jobtracker profiles`). `sync`, `jobs` and `status` cover every profile when you leave it out, so the hourly task keeps all of them up to date. With more than one profile, job pop-ups start with the profile's name and open that profile.

## 4. Finding jobs (the Jobs tab)

The **Jobs** tab finds openings that fit your resume and shows a Windows pop-up when a good one appears. Matching is plain keyword scoring on this PC (0 to 100, with the reasons shown); nothing is sent to an AI.

1. **Your profile:** upload a PDF, Word or text resume. The app lists the skills and job titles it found. Move your must-have skills to the first box, add your cities, and set the score needed for a notification (default 65).
2. **Sources** (use any or all):
   - **LinkedIn and Indeed alerts.** The app can't log in to these sites (both forbid it). Instead, save a search on each site with an email alert turned on. The next mail sync reads those alert emails and adds the jobs. Alert emails carry only a title, company and place, so those matches are marked "partial info".
   - **Company career pages.** Paste a careers address on Greenhouse, Lever, Ashby or SmartRecruiters (or type `greenhouse:company`). The app checks it every sync.
   - **Adzuna.** Create a free key at <https://developer.adzuna.com> and paste the app ID and key. The key is stored with the same protection as your mail logins (see "Where your data lives") and only your search words are sent.
3. **Notifications:** one pop-up per sync at most, only for new jobs at or above your threshold. Test it with `python -m jobtracker notify --test`. Run `.\scripts\install-task.ps1` so the dashboard also starts when you log in to Windows; clicking a pop-up then opens the Jobs tab.

From the command line, `python -m jobtracker jobs` looks for jobs now.

## Replying

Each email has a **Reply** button. Replying is **off until you turn it on** per account: **Settings → Email accounts → Allow replying** logs you in again and asks Google or Microsoft for permission to send mail as you (a separate permission; syncing never uses it). A reply goes only to the person who wrote the email, stays in the same conversation, asks you to confirm before sending, and shows in the application's timeline as **Reply sent**. At most 10 replies an hour and 40 a day can be sent. **Turn off replying** stops the app sending; to drop the permission from Google or Microsoft entirely, disconnect the account and connect it again.

If you'd rather not allow sending, each email still has **Reply in Gmail** or **Reply in Outlook**, which opens a new message in your webmail, already addressed.

## How to read the dashboard

- Emails the rules weren't sure about wait in Needs review. They never change a stage until you decide. After the first sync, check the banner at the top of Applications ("N emails need a look", then Review emails).
- Setting a stage by hand **locks** that application, so later syncs can't undo it. Use *Unlock* to hand it back.
- Wording the rules miss can be added to `jobtracker\rules.yaml`. Then run `sync --days N` to pick up older mail; emails already stored aren't reclassified. If you also use the hosted edition, there are two more commands to run so it classifies the same way (see the project [README.md](README.md), "One classifier, two editions").
- Newsletters, digests and marketing mail are ignored on purpose: mail with unsubscribe or tracking links (or a mailing-list header) only counts when its **subject** is about your application, and a stage word alone (interview, offer) with nothing to attach it to goes to **Needs review** instead of making an application. If an earlier version made applications out of such mail, press **Settings → Sync → Re-check saved emails** (or run `python -m jobtracker recheck`). It never changes applications you made, locked or added notes to.
- Mail in Spam, Promotions, Social, Junk, Sent, and Drafts is skipped on purpose.

## Where your data lives

| What | Where |
|---|---|
| Applications and stored job emails | `data\tracker.db` (SQLite) |
| Login tokens | `secrets\*.token` (other profiles: `secrets\profiles\<id>\`) |
| Other profiles' data | `data\profiles\<id>\tracker.db` |
| OAuth client files | `secrets\*_client.json` |

Both folders are git-ignored. Non-job emails keep only a message ID and date. Job-related emails keep sender, subject, date, and the first 4 KB of text.

How well each file is protected:
- **Login tokens (and the Adzuna key):** on Windows they are encrypted with DPAPI, so only your Windows user can read them. On macOS and Linux there is no DPAPI, so they are plain text in a file only your user can open (`0600`). Treat that folder like any other file of credentials.
- **The database and the OAuth client files** are not encrypted on any system (off Windows the client files are at least owner-only). The database holds email excerpts (sender, subject and the first 4 KB of each job email), the text of your resume, and the text of any replies you sent from the app. Anyone or anything that can read the project folder can read them, including backup and sync tools such as OneDrive if the folder is inside a synced folder. Keep the project in a folder that isn't synced, and turn on disk encryption (BitLocker on Windows) if the PC could be lost.
- Dismissing or deleting an email erases its text, sender and subject. The sender address and subject that you taught the app from stay in its learned corrections until you delete the profile.

What leaves this PC:
- Calls to Google and Microsoft to read your mail, and to send a reply if you turn that on.
- Requests to company career pages and to Adzuna, if you use them. Adzuna sees only search words, never your resume.
- **Fill in** on a pasted job link in Add application. This PC reads that public page or its job board's API (Greenhouse, Lever, Ashby or SmartRecruiters). It follows up to 4 redirects, gives up after 8 seconds, and refuses any address that isn't on the public internet.

Nothing else is sent anywhere.

## Scripts

Everything in `scripts\` runs from the project folder with the virtual environment's Python (`.\.venv\Scripts\python.exe scripts\<name>.py`).

| Script | What it does |
|---|---|
| `scripts\export_json.py [source.db] [out.json]` | Writes your applications as a file the hosted edition can import. Defaults: `data\tracker.db` and `data\jobtracker-export.json`. Opens the database read-only. |
| `scripts\seed_demo.py [out.db]` | Makes a demo database with mock applications (default `data\demo.db`). Refuses to write to your real database. |
| `scripts\build_rules_json.py [--check]` | Copies `jobtracker\rules.yaml` into the hosted edition (`web\src\pipeline\`). With `--check` it only reports whether that copy is out of date (exit 1) and writes nothing. |
| `scripts\export_fixtures.py [--check]` | Rewrites the golden test cases the hosted edition's classifier is checked against. With `--check` it only reports whether they're out of date (exit 1). It ignores the Python patch number but not the minor version. |
| `scripts\install-task.ps1 [-EveryMinutes 60]` | Registers the hourly sync and the dashboard-at-login Windows tasks. Remove them with `Unregister-ScheduledTask -TaskName JobTrackerSync, JobTrackerDashboard -Confirm:$false`. |
