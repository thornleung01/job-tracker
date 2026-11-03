# Setup

The app is built and tested. What's left is signing in to your mail. Both accounts are **read-only**: the app can read mail but not send, delete, or change anything.

All commands run from `C:\Users\thorn\job-tracker`.

```powershell
.\.venv\Scripts\python.exe -m pytest -q        # optional: run the tests
```

## 1. Google (Gmail)

> You can do steps 4 to 7 inside the app: **Settings → Email accounts → Set up Gmail** takes the downloaded JSON file, then **Connect Gmail** opens the sign-in. The setup is shared by every profile; each profile signs in with its own Gmail.

1. Go to <https://console.cloud.google.com/> and create a project (any name, e.g. "Job Tracker").
2. **APIs & Services → Library** → search **Gmail API** → **Enable**.
3. **APIs & Services → OAuth consent screen** (may be called *Google Auth platform*):
   - User type **External**; fill in the app name and your email.
   - Add the scope `.../auth/gmail.readonly`.
   - **Publish the app: set status to "In production".** While it's in *Testing*, Google expires the sign-in every ~7 days and syncing breaks.
4. **Credentials → Create credentials → OAuth client ID → Desktop app.** Download the JSON.
5. Save it as `secrets\gmail_client.json` (create the `secrets` folder if needed; it's git-ignored).
6. Create the client and do step 7 *after* publishing in step 3.
7. Sign in:
   ```powershell
   .\.venv\Scripts\python.exe -m jobtracker connect gmail
   ```
   A browser opens. Google will say **"Google hasn't verified this app"**. That's expected, since you made the app. Choose *Advanced → Go to (app name)* and allow read access.

> **Optional, to reply from the app:** under **Data Access** (the consent screen), also add the scope `.../auth/gmail.send`. Then in Settings press **Allow replying** for the account. Reading never uses it.

## 2. Microsoft (Outlook / Hotmail)

> Steps 4 and 5 also work inside the app: **Settings → Email accounts → Set up Outlook** takes the Application (client) ID, then **Connect Outlook** opens the sign-in.

1. Go to <https://entra.microsoft.com/> → **App registrations → New registration**.
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
   - Redirect URI: platform **Mobile and desktop applications**, value `http://localhost`.
2. On the app's **Authentication** page, set **Allow public client flows** to **Yes**.
3. **API permissions → Add → Microsoft Graph → Delegated → `Mail.Read`**.
4. Copy the **Application (client) ID** from the Overview page and save this as `secrets\outlook_client.json`:
   ```json
   { "client_id": "00000000-0000-0000-0000-000000000000" }
   ```
5. Sign in:
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
.\.venv\Scripts\python.exe -m jobtracker status
```

Optional hourly background sync, plus the dashboard starting at sign-in (only while you're signed in to Windows):

```powershell
.\scripts\install-task.ps1
```

## Profiles

A **profile** keeps one person's (or one job search's) mail accounts, applications, job matches, settings and sign-ins apart from everyone else's. Add one in **Settings → Profiles**, then switch with the menu at the top of every page (it appears once you have two). Your first profile keeps the original database and sign-in files, so nothing moves. Each extra profile lives in `data\profiles\<id>\` and `secrets\profiles\<id>\`, and deleting a profile removes those folders.

From the command line, add `--profile <id>` (see `python -m jobtracker profiles`). `sync`, `jobs` and `status` cover every profile when you leave it out, so the hourly task keeps all of them up to date. With more than one profile, job pop-ups start with the profile's name and open that profile.

## 4. Finding jobs (the Jobs tab)

The **Jobs** tab finds openings that fit your resume and shows a Windows pop-up when a good one appears. Matching is plain keyword scoring on this PC (0 to 100, with the reasons shown); nothing is sent to an AI.

1. **Your profile:** upload a PDF, Word or text resume. The app lists the skills and job titles it found. Move your must-have skills to the first box, add your cities, and set the score needed for a notification (default 65).
2. **Sources** (use any or all):
   - **LinkedIn and Indeed alerts.** The app can't log in to these sites (both forbid it). Instead, save a search on each site with an email alert turned on. The next mail sync reads those alert emails and adds the jobs. Alert emails carry only a title, company and place, so those matches are marked "partial info".
   - **Company career pages.** Paste a careers address on Greenhouse, Lever, Ashby or SmartRecruiters (or type `greenhouse:company`). The app checks it every sync.
   - **Adzuna.** Create a free key at <https://developer.adzuna.com> and paste the app ID and key. The key is stored encrypted on this PC and only your search words are sent.
3. **Notifications:** one pop-up per sync at most, only for new jobs at or above your threshold. Test it with `python -m jobtracker notify --test`. Run `.\scripts\install-task.ps1` so the dashboard also starts when you sign in; clicking a pop-up then opens the Jobs tab.

From the command line, `python -m jobtracker jobs` looks for jobs now.

## Replying

Each email has a **Reply** button. Replying is **off until you turn it on** per account: **Settings → Email accounts → Allow replying** signs you in again and asks Google or Microsoft for permission to send mail as you (a separate permission; syncing never uses it). A reply goes only to the person who wrote the email, stays in the same conversation, asks you to confirm before sending, and shows in the application's timeline as **Reply sent**. At most 10 replies an hour and 40 a day can be sent. **Turn off replying** stops the app sending; to drop the permission from Google or Microsoft entirely, disconnect the account and connect it again.

If you'd rather not allow sending, each email still has **Reply in Gmail** or **Reply in Outlook**, which opens a new message in your webmail, already addressed.

## How to read the dashboard

- **Needs review** holds emails the rules weren't sure about. They never change a stage until you decide. Check it after the first sync.
- Setting a stage by hand **locks** that application, so later syncs can't undo it. Use *Unlock* to hand it back.
- Wording the rules miss can be added to `jobtracker\rules.yaml`. Then run `sync --days N` to pick up older mail; emails already stored aren't reclassified.
- Newsletters, digests and marketing mail are ignored on purpose: mail with unsubscribe or tracking links (or a mailing-list header) only counts when its **subject** is about your application, and a stage word alone (interview, offer) with nothing to attach it to goes to **Needs review** instead of making an application. If an earlier version made applications out of such mail, press **Settings -> Sync -> Re-check saved emails** (or run `python -m jobtracker recheck`). It never changes applications you made, locked or added notes to.
- Mail in Spam, Promotions, Social, Junk, Sent, and Drafts is skipped on purpose.

## Where your data lives

| What | Where |
|---|---|
| Applications and stored job emails | `data\tracker.db` (SQLite) |
| Sign-in tokens | `secrets\*.token` (other profiles: `secrets\profiles\<id>\`), encrypted so only your Windows user can read them |
| Other profiles' data | `data\profiles\<id>\tracker.db` |
| OAuth client files | `secrets\*_client.json` |

Both folders are git-ignored. Non-job emails keep only a message ID and date. Job-related emails keep sender, subject, date, and the first 4 KB of text. Nothing leaves this PC except calls to Google and Microsoft to read your mail, and, if you add them, requests to company career pages and Adzuna (which see only search words, never your resume).
