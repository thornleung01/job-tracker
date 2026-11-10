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

Open the site's `#/setup` page (https://thornleung01.github.io/job-tracker/#/setup, or "Site setup (for the site owner)" on the login page, which shows only while the site has no client IDs or the address has `?setup`) and follow it. It is for the site owner: ordinary users and the demo build are never sent to it. It works in demo mode and while logged out. It gives you:

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

It opens the database read-only and writes `export.json` (with no second argument it writes `data/jobtracker-export.json`). Then log in to the hosted app and choose Settings, Data, Restore, Import data. The app says the file is from the local edition and asks before it replaces everything in this browser. The export leaves out the resume and job-search profile.

## Paste a job link

In Add application, paste a job link and the form fills in what it can.

- **Greenhouse, Lever, Ashby, SmartRecruiters:** the app reads the company and role from the link, then confirms them with the board's public API (the six API hosts are allowed in the page's `connect-src`). Ashby uses its hosted pages' small lookup for the exact title, location and company, with the full board listing as a fallback. Lever's API has no company name and its hosted pages can't be read from a browser, so the company stays a marked guess. The bookmarklet gives the exact name.
- **Other sites:** the company and role are guessed from the link and marked "Guessed from the link".
- **LinkedIn, Indeed, Workday and company career pages:** use the "Save to Job Tracker" bookmarklet. It is under "Save jobs from any site" in Add application on the Applications page. It reads the page you are viewing in your own browser and opens the app with the details filled in. It never saves by itself.
- **Fallback:** "Or paste the job text instead" reads text you copied off the page.
- **Description:** when the page or board API has one (JSON-LD, or Greenhouse, Lever, Ashby and SmartRecruiters), or the pasted text is long enough to be one, it is kept as the application's job posting text (see "Resume and cover letters").

One more case sends a request. A career page on another site that carries a `gh_jid` parameter (a Greenhouse job number) makes the app guess the Greenhouse board from the page's own domain and ask `boards-api.greenhouse.io` for that job. `public/privacy.html` says so. A wrong guess just finds nothing.

The link is stored on the application and shown as "Open posting". The local Python edition does the same from its server, with extra checks so it can't be pointed at internal addresses.

## Quick edits, interview rounds and offers

- **Quick edits:** on the Applications list, choose a role or an applied date to change it in place. Enter or leaving the field saves, and Escape puts the old value back. The stage is a dropdown. Changing it locks the stage, like setting it on the detail page, and shows Undo for a few seconds.
- **Interview rounds:** the application page counts rounds from your emails (one round per interview day, following reschedules and dropping cancelled ones, raised by named rounds such as "second round") and from the interview steps you log. It is an estimate until you type a number, and "Use estimate" takes you back. The number you type is saved in exports and kept when you merge applications.
- **Coming up:** interviews in the next 7 days show in a short list above the applications (up to five, soonest first), and "Interview Thu, Oct 15" shows under the stage of each application that has one. It comes from your interview emails, follows reschedules, drops cancelled ones, and skips Rejected and Offer. The list hides while any filter is on, and in the calendar view. Each row has "Add to calendar" (see "Add to calendar" below).
- **Follow-ups:** an Applied or Heard back application with no activity for 7 to 29 days gets a "Follow up?" tag. Tick "Needs follow-up" in the filters and choose Apply filters to see only those. After 30 days it gets "No reply in 30 days" instead, and the "No reply" filter shows those (see "More on the Applications page" below).
- **Rounds column:** in Settings, Appearance, choose Rounds as a table column (off by default). It sorts, stays blank where nothing is counted, and is hidden at phone widths like Role, Applied, Emails and Resume.
- **Offer details:** the application page has a Salary (up to 60 characters of free text) and a Decision deadline at the Offer stage. The list shows "Decision by Oct 15" under an Offer. Both are saved in exports and kept when you merge applications.
- **Several at once:** tick rows, or the box in the header for every row shown, to set a stage on all of them (which locks it, like the stage dropdown), set the resume sent (Set resume, with Undo) or delete them. Deleted applications go to Settings, Recently deleted for 30 days (see "Recently deleted" below). Your mailbox isn't touched. Changing a filter clears the ticks. Up to 500 at a time.
- **Duplicate warning:** the Add application form says "You already have ..." with a link when the posting link, or the company and role, match an existing application. It never blocks Save.

## Export a spreadsheet

Settings, Data, Export CSV saves every application, ignoring any filters on the list, as `job-tracker-applications-YYYY-MM-DD.csv` for Excel, Numbers or Google Sheets. Columns: Company, Role, Stage, Applied, Last activity, Emails, Interview rounds, Posting link, Offer salary, Offer deadline, Resume sent (the resume's title). It leaves out applications in Recently deleted, has no email text, resume text or job posting text, and can't be imported back. It doesn't count as a backup. Use Export data for a full copy. That file is format version 3: a `documents` table (resumes and cover letters) and, on applications, `postingText` and `resumeId`. Older files are still read, and a file without `documents` has none.

## Your data, backups and installing

Settings has five sections, Setup, Mail, AI, Data and Appearance, one at a time at `#/settings/:section` (`#/settings` is Setup). `SectionSwitcher` is the row of links, `sections.ts` the list. Mail also shows what the app has learned and the mail it ignored (`MailRulesSection`). Needs review is not in the nav: `ReviewBanner` on Applications links to it. Data has Back up, Restore, Recently deleted and Delete everything.

Setup lists four steps (mailbox, resume, AI key, backup) from `src/sync/setupStatus.ts`. While any is missing, Applications shows `SetupCard` (`src/components/setup/SetupCard.tsx`): "Finish setting up · 2 of 4", the next step, Continue (to Settings) and Dismiss (stored in the settings table of that database, so it stays dismissed). The empty table row on Applications also points there, and in the demo build offers "load the demo data" as a button. The login page always has "Log in without connecting your mailbox", and shows "Site setup (for the site owner)" only when the site has no client IDs or the address has `?setup`. Tests: `tests/components/setup/setupcard-done.test.ts`, `tests/pages/applications/setup-card.test.ts`, `tests/app/app.test.ts` (login page).

All of these live in `src/backup/` and `src/pages/settings/DataSection.tsx`. Tests are in `tests/backup/` and `tests/settings/data-backup.test.ts`.

- **Keep my data.** Once the database has any data, the app asks the browser to keep its storage (`navigator.storage.persist()`), at most once per tab session (the flag is the session storage item `jobtracker:persist-asked`). Chrome and Edge decide silently, Firefox may show its own prompt, and Safari may refuse. Settings, Data says "Your browser will keep this data." or warns that it may clear it, and how much space the site uses (`navigator.storage.estimate()`, for all of the site's storage, not just the data). A browser that says nothing gets no line.
- **Backup reminder.** At the top of the Applications page a quiet row says "Your applications only live in this browser. Last backup: never" (or "12 days ago") with "Export a backup" (opens Settings, Data) and "Remind me in a week". It shows when there is at least one application, no sync is running, and the last JSON backup is more than 14 days old or there is none, unless snoozed in the last 7 days. Days are calendar days in your time zone. Only Export data (JSON) and "Back up now" count as a backup. Export CSV does not.
- **Where the times are kept.** Two ISO times per account database (last backup, last snooze) in local storage under `jobtracker:backup:<database name>`. They are not in the database, so they aren't in the export (an import would bring back a date that is wrong for the new copy). "Delete all my data" clears them.
- **Backup file (Chrome and Edge only).** Under the Back up buttons: "Choose a backup file" opens the browser's save dialog (`showSaveFilePicker`), writes the JSON export there and remembers the file. Then "Back up now" overwrites the same file with a fresh export, "Choose a different file" picks another, and "Stop using this file" forgets it (the file itself stays where it is). The browser may ask for permission again after the tab was closed. The write goes to a temporary copy and replaces the file only when it finishes, so a failure leaves the old backup. What the app keeps is the file handle (a reference to the file, not your data) in its own IndexedDB database, `jobtracker-backup-files`, keyed by account database name. It isn't in the export, and "Delete all my data" removes it. The option isn't shown in Firefox or Safari.
- **Install as an app.** `public/manifest.webmanifest` and the icons in `public/icons/` let a browser offer "Install" or "Add to Home Screen". There is deliberately no service worker: the app needs the network for mail and job boards, and a worker that cached the bundle could keep serving an old version after a fix. So an installed copy opens in its own window but still needs the network and keeps no offline copy. The paths in the manifest are relative, so they follow `base` in `vite.config.ts` when you host a fork. The PNG icons are committed. To redraw them from `public/favicon.svg`, run `node web/scripts/make-icons.mjs` from the repository root (it uses headless Chrome at the macOS default path, or set `CHROME`).

## Resume and cover letters

Code: `src/documents/read/` (reading files), `src/sync/convert.ts` (Convert), `src/ai/`, `src/pages/settings/AiSection/`, `src/pages/resume/ConvertPanel.tsx`, the Resume page (`src/pages/resume/index.tsx`, `src/pages/resume/sections/` with `ResumeSection.tsx`, `JobSection.tsx`, `TailoredSplit.tsx` and `ActionBar.tsx`, `src/pages/resume/split.css`, `src/pages/resume/flowState.ts`, `src/app/resumeFlowStorage.ts` the saved job's storage key and the clear functions Settings and log out call), `src/jobs/readJob.ts` (company and role from a pasted job), `src/ai/extractJob.ts` (the extract prompt and its checks), `src/sync/readJob.ts` (the device first, then one extract call), `src/sync/tailorFlow.ts` (matching and saving the job), `src/sync/documents.ts`, `src/sync/documentLine.ts`, `src/db/documentShape.ts`, `src/components/documents/` (`ResumeSheet.tsx` is the read-only classic sheet, `PageEditor.tsx` the same sheet with every text a field, `ResumeEditing.tsx` the switch between editing on the page and as a list around `SectionsEditor.tsx`, `onepage.ts` and `useOnePage.ts` the one-page check, `tailorReview.ts` the tailor review's pure helpers, `useUnlock.ts` the passphrase form shared by the AI strip and the Convert panel, `deps.ts` what the section injects), `src/documents/pdf/` (the Download PDFs: `layout.ts` turns typed lines into positioned text runs, `resumePdf.ts` and `letterPdf.ts` draw them, `encode.ts` makes text safe for the PDF's standard fonts, `index.ts` is the entry with `resumePdf`, `letterPdf` and `pdfFilename`), `src/app/download.ts` (`downloadPdfs` saves the two files), `src/documents/` (`blankResume.ts` the template and its placeholders, `reread.ts` the re-read offer, `compare.ts` the baseline comparison and its word diff, `postingTerms.ts` the posting's terms), `src/pages/tailor/` (the Tailor picker and workspace), `src/jobs/posting.ts`. Tests: `tests/ai/`, `tests/settings/ai.test.ts`, `tests/pages/resume/convert.test.ts`, `tests/sync/convert.test.ts`, `tests/backup/csp.test.ts`, `tests/documents/` (`split.test.ts`, `read.test.ts`, `read-pdf.test.ts`, `blankResume.test.ts`, `reread.test.ts`, `compare.test.ts`, `postingTerms.test.ts`), `tests/db/documentItems.test.ts`, `tests/sync/documents.test.ts`, `tests/sync/addApplicationDocuments.test.ts`, `tests/sync/coverLetterMail.test.ts`, `tests/sync/resumeList.test.ts`, `tests/sync/sentResume.test.ts`, `tests/pages/resume/` (`print.test.ts`, `template.test.ts`, and the split, action bar and Download tests that replaced `steps.test.ts`), `tests/documents/pdf/` (the layout, both PDFs, WinAnsi encoding, filenames and page counts), `tests/pages/detail/documents.test.ts`, `tests/pages/applications/resume.test.ts`, `tests/components/documents/` (`sectionseditor.test.ts`, `pageeditor.test.ts`, `pageeditorcss.test.ts`, `resumesheet.test.ts`, `tailorReview.test.ts`), `tests/pages/detail/tailorLinks.test.ts`, `tests/pages/tailor/` (`workspace.test.ts`, `workspaceFixes.test.ts`, `picker.test.ts`, `routes.test.ts`), `tests/app/leaveGuard.test.ts`, `tests/sync/tailorBaseline.test.ts`, `tests/components/upcoming/sent.test.ts`, `tests/jobs/posting.test.ts`, `tests/app/resumenav.test.ts`, `tests/pages/tailor/workspaceGuards.test.ts`, `tests/pages/resume/leave.test.ts`, `tests/app/errorboundary.test.ts`, `tests/pages/routeIds.test.ts`, `tests/jobs/readJob.test.ts`, `tests/ai/extractJob.test.ts`, `tests/sync/readJob.test.ts`, `tests/sync/tailorFlow.test.ts`, `tests/sync/tailorForJob.test.ts`, `tests/pages/resume/flowState.test.ts`, `tests/app/resumeFlowStorage.test.ts`, `tests/pages/applications/tailor-link.test.ts`, `tests/backup/privacy-page.test.ts`.

- **Resume page.** The Resume page (`#/resume`, `g` then `r`) is one wide column (about 1240px) with no step strip. With a master the master is shown once, as one line at the top of the Job card ("Using: Master resume · updated Sep 26", a Based on choice of the master or a version, and Edit); with none, the first-run **Resume** intake is the first section. **Job** (waits for a master) takes the posting and an optional link; company and role come from `readJobFromPaste` on the device, and only when both are empty and a key is unlocked does `readJob` make one `extractJob` call, keeping a value only if it appears in the posting. Write with AI (`tailorForJob`) or Start by hand (`draftFromBaseline`) fills the **split**: under the heading "Tailored for {company}" (carrying Rewrite with AI and Start over), Tailored resume (the page editor with change marks and one-page check; read-only `ResumeSheet` behind an Edit button on a phone) in the larger 1.5fr column beside Tailored cover letter, with one "Changes from your baseline" disclosure under both, scaled to the column (`fit` on `ResumeSheet` and `PageEditor`), stacked under about 1100px and a Resume or Cover letter switch under 720px. The **action bar** under it sticks to the bottom of the viewport and holds where Save goes (`jobMatches`, the strict `findDuplicates`: link first, then company and role; "Add as new instead"), **Save** and **Download**. Save is `saveTailoredJob`, one transaction that adds or reuses the application with the posting and link, saves the tailored resume and letter to it and points Resume sent at the resume, all or nothing; it asks first before replacing a saved resume or letter. Download makes two PDFs in the browser from the current draft, saved or not ("Resume – Company – Role.pdf" and "Cover letter – Company – Role.pdf"). The step shown is derived (there is a master, there is a draft, it is saved); `flowState.ts` keeps the job in progress in session storage per database until Save or Start over, and leaving with an unsaved draft goes through the leave guard. `#/resume?step=job` scrolls to Job, `#/resume?step=job&baseline=<id>` also sets Based on, and `#/resume?app=<id>` fills Job from that application and sets the bar to save to it. The saved documents are in "Your documents", a closed disclosure at the foot of the page (the Resumes, Cover letters and Tailored tabs) that opens for the tab links, Edit, `?baseline=` and the Print view's Back link (session storage `jobtracker:resume-docs-open:<database name>`). Exactly one button is primary at a time: Write with AI (or Start by hand without an unlocked key) until there is a draft, then Save.
- **Download PDFs.** `src/documents/pdf/` makes the files with `pdf-lib` (MIT, no network) and its built-in Times fonts, so no font file ships. The resume mirrors the classic template (letter, half-inch margins, one page where it fits, a second page when it doesn't) and the letter is Times 11pt with one-inch margins. Text is cut down to what the standard fonts can encode (WinAnsi): other characters become the closest one or "?", and the page says so once. `pdf-lib` is loaded with `await import("pdf-lib")` inside `resumePdf` and `letterPdf`, on the first Download click, so it is its own chunk and is not in the entry bundle (check `npm run build` output after touching imports there). `downloadPdfs` in `src/app/download.ts` saves the two files one after the other, because a browser may ask before allowing a second download.
- **Master resume.** The Resume section and the Resumes tab take your resume from a PDF, Word (.docx) or text file, or from pasted text, splits it into headed sections and shows them to check and edit before anything is saved. The file is read on the device and never uploaded. The PDF reader is big, so it loads only when a PDF is chosen, as its own chunk, and its worker file is served from the same origin as the app. The importer also recognises typed lines: a job with its location, a job title with its dates, a bullet or skill with a bold label, and a school with its location. This works for PDF, Word and pasted text. PDFs keep a large horizontal gap as a tab marker, and a gap of 3 or more spaces counts as one too, so right-aligned text can be told apart from the text beside it. A line the rules can't classify clearly stays plain text. The heuristics are English-only and best-effort, so check the result in the editor. With no resume yet, "Start from the template" opens a blank copy of the template (header, summary, skills, work experience, education) to type into, with placeholders in the empty fields. Nothing is stored until Save, Save stays off until there is some text, and it stores the resume with `source: "template"` and no empty lines or sections. Cancel asks first only when something has been typed. Editing is on the page by default: the sheet itself, each text a field you type into where it is (Enter moves to the next field, a bullet or skill gets a new one below, and a line holds no newline: pasted newlines become spaces), with move, remove and add buttons on each line and "Add contact line" in the header. A switch, "Edit on page" or "Edit as list", picks between that and the older list of fields, where each line has a "Line type" select (Line, Job, Job title, Bullet, Skill, School) with label, location and dates fields that show only for the types that use them. The choice is remembered in local storage (`jobtracker:resume-editing`). A master saved before the template, with no typed lines, gets a quiet "Re-read it as the template?" offer that opens the usual review and stores nothing until Save (the save keeps the master's own `source`, and Dismiss is remembered per resume for the session). Every save drops empty lines and sections that have no lines left.
- **Versions.** "Make a version" copies the master into a standalone resume version with its own name, at most 5 besides the master. Any number of applications can use one version. Deleting a version sends it to Recently deleted, and an application that used it reads "(deleted)".
- **Tailored tab.** The third tab of Your documents (`#/resume?tab=tailored`) lists the live tailored resumes of live applications (`tailoredPage`), newest first, each with a link to its application (`#/app/:id`), "Based on: Master" or the baseline version's title from the copy's `basedOn` ("a deleted resume" when that baseline is gone; `basedOnText` in `TailoredList.tsx`), Open in Tailor (`#/tailor/:id`), Make reusable (`promoteTailored`, refused with a plain sentence at the cap of 5 reusable versions) and Print. The Resumes tab uses `liveResumes`, so a tailored resume never appears there or in the Resume sent choices. Applications with a master resume get "Tailor for this job" in the open list panel (until they have a tailored resume; it no longer needs posting text) and, with posting text, "Tailor your resume for this job" in the notice after Add application. The panel link goes to the Tailor workspace (`#/tailor/:id`); the notice link goes to the Resume page (`#/resume?app=<id>`). The Resume page's master card and the empty Tailored tab have "Tailor for a job" (`#/resume?step=job`, scrolls to Job on the same page) and each version card "Tailor with this" (`#/resume?step=job&baseline=<id>`); the detail page's "Tailor resume and cover letter" and "Open in Tailor" (shown when the resume sent is tailored) go to `#/tailor/:id` too.
- **Cover letters.** One per application, written on the application page or listed on the Resume page's Cover letters tab. The greeting is "Dear Jane," from the newest recruiter, hiring or people contact the application has, else "Dear hiring team,". Each letter has Copy text, Draft in Gmail or Outlook (a compose window in the same mailbox, like Draft follow-up) and Print.
- **Job posting text.** Kept on the application, up to 20,000 characters. It is captured when you add from a link (JSON-LD on the page, or the Greenhouse, Lever, Ashby and SmartRecruiters board APIs) or from pasted text, and you can paste or edit it on the application page.
- **Resume sent.** A choice on the Add application form, "Add several links" and the application page. The Add forms start with the one you used last. The list has a `resume=` filter (a version's id, or `none`) that saved views keep, an optional Resume column (Settings, Appearance) that sorts, and a bulk Set resume. Interviews show "Sent: Resume title" on Coming up and the calendar.
- **Print.** "Print" opens `#/resume/print/:id`, one document. A resume prints in the classic template (serif, US letter, half-inch margins, one page) and a cover letter keeps the plain layout. For a resume, a muted status beside the print buttons says "Fits one page" or "About 3 lines over one page". It is advisory, because the screen layout only approximates print (`src/components/documents/onepage.ts`). The browser's print dialog also saves it as a PDF. Printing hides everything but the document.
- **Limits.** `src/db/limits.ts`: `MAX_POSTING_CHARS`, the `MAX_DOC_*` limits (including `MAX_DOC_LABEL_CHARS`, 60, and `MAX_DOC_RIGHT_CHARS`, 80) and `MAX_RESUME_VERSIONS`, and for AI `MAX_AI_INPUT_CHARS` (120,000 characters sent), `MAX_CONVERT_CHARS` (12,000 characters of resume text Convert accepts, and `convertTooLong` also refuses many short lines: its reply is the whole resume again as JSON, about 55 characters of it around every line, and 8,000 tokens can't carry more) and `MAX_AI_OUTPUT_CHARS` (60,000 characters read back). Files up to 5 MB and PDFs up to 12 pages (`src/documents/read/errors.ts`).
- **Export and search.** Export data and the backup file carry resumes and cover letters. Export CSV carries only the title of the resume sent. Search reads the job posting and the cover letter. Resume lines carry an optional `kind`, `label` and `right`, additive within export format version 3: a kind that isn't known is dropped on import, a label or right that the line's type doesn't use is dropped, and older files read as plain lines. "Download as text" and search print a bullet or skill as "Label: text", a job or school as "text, location" and a job title as "text dates".

- **Tailor.** The detail page no longer tailors inline: "Tailor resume and cover letter" is a link to the Tailor workspace (`#/tailor/:id`, built in `src/pages/tailor/`), which runs `tailorForApplication` with the person's own key when they ask for AI and otherwise lets them edit a copy of the baseline by hand. `tailorReview.ts` keeps the pure helpers (`composeResume`, `initialTicks`); the word diff (`diffWords`) lives in `src/documents/compare.ts`. An existing copy keeps the baseline it was made from (`?baseline=` only starts a new copy), the Baseline select is locked while an AI draft is live, and an AI write from the Resume view never stages a letter over a saved one. Choosing another baseline for a saved copy counts as a change (Save stays enabled for it). Unsaved work in the workspace, and on the Resume page (typed text in the master or a version, the template, the review of a new master), is guarded for the Back link (not for a new-tab click), the Shell's nav links, browser Back and Forward and an edited address (`src/app/leaveGuard.ts`: the page registers a guard, the Shell links ask it, and a changed hash is put back and handed to it); the one limit is that a stopped Back or Forward leaves one repeated entry in the browser's history. The Job posting box has "Fill from link" (`enrichJobDraft`, injected through `DocumentsDeps` in `deps.ts`) when the application has a posting link; it only fills the box, and Save stores it. "Resume sent" lists the application's tailored resume (`resumesForApplication`) marked "Tailored" with an "Open in Tailor" link. There is no "Make a copy for this job"; "Start from baseline" in the workspace replaces it, and a tailored copy never counts toward the version cap.
- **Convert (AI).** With an Anthropic key unlocked (Settings, AI), the Resume page shows a Convert panel with the extracted text. Pressing Convert sends that text, which includes the contact details in it, straight from the browser to `https://api.anthropic.com` with the person's own key, and nothing else (no email, no contacts, no other application data). The prompt asks for the app's resume structure: the header, then sections that map onto the template's headings, with the person's own words, their order, and no added, dropped or reworded fact. The reply is parsed and checked on the device (`src/ai/verify.ts`): numbers, dates, money, percentages and names that aren't in the source are flagged, labels the model made up are marked, and words from the file that are missing from the result are listed under "Not used from your file". The review is the usual check step, and nothing is saved until the person accepts, as a master resume with `source: "ai"`. If there is no key, it is locked, or the call fails, the simple converter (the rules in `src/documents/read/`) is still there and works as before. Code: `src/sync/convert.ts`.

## AI

Hosted edition only, and opt-in. Each person uses their own Anthropic key and pays Anthropic for their own use. Convert costs a few cents on the default model (Sonnet 5.5). Haiku 5.5 is cheaper and Opus 5.5 is the strongest, chosen in Settings, AI. Code: `src/ai/`. Tests: `tests/ai/`.

- **The vault.** The key is encrypted with AES-GCM under a key derived from the passphrase with PBKDF2-SHA-256 and stored in local storage as `jobtracker:ai:vault:<database name>`. The stored value is only `{v, salt, iv, ciphertext, last4, model}` (`v` is the format version). The entry is authenticated with additional data (AES-GCM) so it can't be moved between people. The plain key and the passphrase are never written anywhere. `last4` is shown so the person can tell which key it is.
- **Locked and unlocked.** Unlocking decrypts the key into memory for this page. A reload or a log out locks it again. "Forget key" and "Delete all my data" remove the vault. It is not in the export, the backup file or the settings table.
- **The call.** `src/ai/client.ts` posts from the browser to `https://api.anthropic.com` (the only AI host in the Content-Security-Policy), only when the person presses Convert, Tailor (or "Write my resume and letter" on the Resume page) or Check key, or pastes a job on the Resume page whose company and role couldn't be read on the device while the key is unlocked: then `extractJob` sends only the posting text and asks for `{ company, role }`, and `verifyExtract` keeps a value only if it appears in the posting. Convert is a structured-output call. Check key sends one short "ping" to Haiku 5.5 with no resume text, so it also calls Anthropic. A key must be unlocked first: Check key on a locked key says "Unlock your key in Settings first."
- **Retries and timeout.** At most 2 retries, after 2 s then 5 s (or the server's `Retry-After`, capped at 30 s), and only for a 429 that isn't a spending limit, a 5xx or 529, and a network failure before the reply arrives. A failed read of a reply is never retried, so there is no double billing. Each request times out after 180 seconds. `ai` may import `providers/backoff` (its helpers depend only on base types).
- **Limits.** `MAX_CONVERT_CHARS` (12,000, plus the reply-size check in `convertTooLong`) caps a Convert text, refused with its own sentence before anything is billed. `MAX_AI_INPUT_CHARS` (120,000) caps what any request sends and `MAX_AI_OUTPUT_CHARS` (60,000) caps what is read back.
- **Errors.** Every failure is one fixed sentence from `src/ai/errors.ts` (`AI_MESSAGES`), never the server's text and never the key.
- **Workspace-scoped keys.** The app only accepts a key that is tied to one Anthropic workspace. Otherwise it shows the `workspaceKey` message ("That key isn't tied to a workspace. Create one inside a workspace in the Anthropic console."), so create the key inside a workspace.
- **Zero data retention.** Organizations with zero data retention or the Compliance API can't be used from a browser.
- **The shared origin.** Other pages on the same `github.io` origin can read the app's browser storage (see "Known risk" below). They would see only the ciphertext, but a weak passphrase can be guessed, so the card asks for at least 12 characters and refuses obviously common passphrases.
- **Privacy.** `public/privacy.html` says all of this, and `tests/backup/privacy-page.test.ts` pins the sentences.

## Recently deleted

Code: `src/sync/trash.ts`, `src/sync/live.ts`, `src/sync/documents.ts`, `src/pages/settings/TrashSection.tsx`, `src/components/trash/`. Tests: `tests/sync/trash.test.ts`, `tests/sync/trashDocuments.test.ts`, `tests/settings/trashDocuments.test.ts`, `tests/pages/settings/trash.test.ts`, `tests/pages/detail/trash.test.ts`, `tests/app/trash.test.ts`.

- **What happens.** "Delete application" (on the list panel, the detail page's More menu, and the bulk Delete) doesn't erase anything. It marks the application deleted (`deletedAt`) and keeps its emails, notes, steps and people edits. For 8 seconds a line says "Deleted Acme. It stays in Recently deleted for 30 days." with Restore.
- **Where it is.** Settings, Recently deleted (a card between Restore and Delete everything) lists each one with when it was deleted and the days left. Restore brings it back with the same id. "Delete now" and "Empty recently deleted" ask in place, then erase for good: every email's content is cleared and only its id and date stay, so the email isn't fetched again, and the application row, notes and steps go. The page of a deleted application says it was deleted and offers Restore.
- **30 days is 30 x 24 hours,** counted on the timestamp, not calendar days. Expired entries are erased when the app starts, once per page load (`purgeOncePerSession`).
- **Resumes and cover letters** wait here for 30 days too. Their rows read "Resume · Resume for Acme, Analyst" and "Cover letter · Acme, Analyst", with the same Restore and Delete now. `isLiveDocument` in `src/sync/documents.ts` is the live check for documents. Restoring a cover letter needs its application restored first.
- **Hidden everywhere.** A deleted application is left out of the list, counts, Statistics, People, Coming up, follow-ups, offers, the weekly goal, duplicate checks and Export CSV. Lists and matches go through `src/sync/live.ts`; the two places that read deleted applications on purpose are `src/sync/trash.ts` and the mail matcher (`src/sync/match.ts`).
- **Still included in Export data and the backup file,** with `deletedAt`, until it is erased. Importing such a file brings them back into Recently deleted.
- **New mail.** Mail for a deleted application is kept with it, not turned into a new application, until you restore it or it is erased (`findDeletedApplication` in `src/sync/match.ts`).
- **Still immediate and permanent:** "Delete for good, keep emails in Needs review" (the application goes, its emails go to Needs review) and "Not an application".

## Search, saved views and keyboard shortcuts

Code: `src/sync/search.ts`, `src/sync/savedViews.ts`, `src/components/savedviews/`, `src/components/shortcuts/`. Tests: `tests/sync/search.test.ts`, `tests/pages/applications/search.test.ts`, `tests/sync/savedViews.test.ts`, `tests/components/savedviews/`, `tests/pages/applications/savedviews.test.ts`, `tests/components/shortcuts/keys.test.ts`, `tests/pages/applications/shortcuts.test.ts`.

- **Search** matches company and role, and also email subjects and bodies, notes, steps, the job posting and the cover letter. Every word must match, in any order, ignoring accents and case. A search of 1 character looks at company and role only, and at most 8 words count. When a row matched in an email, note, step, job posting or cover letter instead of its company or role, a "Matched in an email" line (or note, step, "the job posting", "the cover letter") with a short snippet shows under the company. Searches only read what is already stored on the device.
- **Saved views.** "Save this view" on the Applications page (it shows once the filters or sort differ from the plain list) stores the stage, search, account, follow-up and no-reply filters and the sort under a name of 1 to 40 characters, up to 12 views. They show as chips above the list. A chip is a link to the same address the filters make, so Back and reload work. Each chip has Rename and Delete view (which asks first). They are stored in the IndexedDB settings table under the key `savedViews`, so Export data and the backup file carry them.
- **Keyboard shortcuts** on the Applications page: `/` search, `j` and `k` next and previous application, `Enter` or `o` open or close, `x` tick, `n` add, `g` then `s` Settings, `g` then `r` Resume, `Esc` clear, `?` this list. They are ignored while you type in a field and when Ctrl, Meta or Alt is held, and they work with Caps Lock on. The "Keyboard shortcuts" button at the bottom of the Applications page opens the same list in a dialog.

## More on the Applications page

Tests are named after the feature in `tests/pages/applications/` and `tests/components/`.

- **No reply in 30 days** (`GHOSTED_DAYS` in `src/sync/followUp.ts`). An Applied or Heard back application with no activity for 30 days or more shows a "No reply in 30 days" tag, and the "No reply" checkbox in the filter card shows only those. "Needs follow-up" now means 7 to 29 idle days, so an application is in one or the other.
- **Weekly goal.** "Set a weekly goal" (1 to 50 applications a week) shows "This week: 3 of 5 applications" with a thin bar. The week runs Monday to Sunday in your time zone, counted on each application's applied day, whatever the filters. It is off until you set it. The goal is in the settings table under `weeklyGoal`, so it is exported. Code: `src/sync/goal.ts`, `src/components/goal/`.
- **Compare offers.** With 2 or more applications at Offer (or with a salary or deadline saved), a "Compare offers" card lists company, role, salary as you typed it, decision deadline and the day the application reached its stage. It starts collapsed and stays as you left it for the rest of the tab session (session storage `jobtracker:offers-open:<database name>`). It is hidden in the calendar view. Code: `src/sync/offersView.ts`, `src/components/offers/`.
- **Add several links.** In the Add application form, "Add several links" takes up to 10 job links, one per line, and saves each as an application with the same lookups as a single paste: the same hosts as "Paste a job link", up to 2 at a time, 6 seconds each. It reports each link (added, skipped as a duplicate, couldn't be read) and Stop ends it. Links that weren't added stay in the box. Code: `src/sync/bulkAdd.ts`, `src/components/bulkadd/`.

## Draft a follow-up

Code: `src/sync/followUpDraft.ts`, `src/sync/applicationActions.ts`, `src/components/followup/`. Tests: `tests/sync/followUpDraft.test.ts`, `tests/sync/applicationActions.test.ts`, `tests/components/followup/draft.test.ts`.

A "Draft follow-up" button (in the open list panel and on the application page) opens a new compose window in the account's own Gmail or Outlook with a short ready-to-edit message: "Hi Sam, I applied for the Designer role at Acme on October 14 and wanted to follow up. Is there any update on my application?" The subject is "Following up on my application for Designer at Acme". The recipient is the newest recruiter, hiring or people contact with an address, else the newest contact with an address, else the sender of the newest email that takes replies, and never one of your own addresses. The button is hidden when no mail account is connected. It becomes the main style of button when the application needs a follow-up.

The app never sends mail and asks for no send permission (Gmail is still read-only). The recipient, subject and body are in the link's address, so they leave the device only when you open it, and then they go to Gmail or Outlook. Only an `https` link to `mail.google.com`, `outlook.office.com` or `outlook.live.com` is ever made, and names are cut to one line so nothing can add a second recipient.

## Add to calendar

Code: `src/sync/ics.ts`, `src/components/upcoming/AddToCalendar.tsx`, `src/components/calendar/CalendarExport.tsx`. Tests: `tests/sync/ics.test.ts`, `tests/components/upcoming/calendar.test.ts`.

Each Coming up row, each upcoming interview day on an application, "Download all upcoming interviews" under the Coming up list, and the calendar view's day panel ("Download interviews (.ics)") and month ("Download this month's interviews") save a calendar file. File names: `job-tracker-interview-YYYY-MM-DD.ics` for one day from Coming up or an application, `job-tracker-interviews-YYYY-MM-DD.ics` for the day panel or for all upcoming interviews (dated today), and `job-tracker-interviews-YYYY-MM.ics` for a month. Entries are all-day events (a day, not a time, because the app only knows the day) that link back to the application. The file is made in the browser when you press the button and saved to your device. Nothing is sent. Importing the same day again updates the entry instead of adding a copy (each entry's id is the application and the day). Interview days come from email text and can be wrong or missing, so check them.

## Calendar view

Plan and decisions: [docs/plans/calendar-view.md](../docs/plans/calendar-view.md). Code: `src/components/calendar/`, `src/sync/calendar.ts`, `src/sync/calendarGrid.ts`. Tests: `tests/sync/calendar.test.ts`, `tests/sync/calendarGrid.test.ts`, `tests/components/calendar/`, `tests/pages/applications/calendar.test.ts`, `tests/pages/applications/calendar-demo.test.ts`.

- **Where.** A List | Calendar toggle on the Applications page. The address is `#/?view=calendar&month=YYYY-MM&day=YYYY-MM-DD`, so reload, Back and a copied link work. The calendar uses the page's filters, so "Interview stage, this search" narrows both views. Coming up and Compare offers are hidden in the calendar view.
- **What a day shows.** Interviews, the day you applied, offer decision deadlines, follow-ups ("Follow up due", "Follow up was due", or "No reply in 30 days") and steps you logged. Each has an icon and a word, and past events say so. Events carry a day, not a time. Interview days are guessed from email text and can be wrong or missing. The demo data has 3 demo interview invitations so there is something to see.
- **Weeks start on Monday,** and the weekly goal and the calendar share one definition of the week: `WEEK_START` in `src/db/time.ts` (0 is Sunday, 1 Monday, up to 6 Saturday) is the one line to change, and both move with it (`startOfWeek` and `weekdayOf` in the same file do the arithmetic, and `tests/sync/weekStart.test.ts` checks they can't drift apart). It is not read from the browser's locale.
- **Keyboard.** One day has the tab stop. Arrows move by a day or a week, Home and End go to the ends of the week, Page Up and Page Down change month, Enter or Space opens the day, and Escape goes back to the day from its panel.
- **Day panel** under the grid: the day's events, each a link to its application, and "Download interviews (.ics)". "Download this month's interviews" is beside the month heading.
- **Phone.** At 720 px wide or less an agenda list of the month's days replaces the grid.

## Statistics

Code: `src/sync/statistics.ts` (the numbers), `src/sync/stats.ts` (the funnel and `loadCohort`), `src/pages/statistics/` (the page, `ChartFrame`, `StatTiles`, `WeeklyBars`, `SpeedRanges`, `MonthlyRates`, the funnel's `Sankey`). Tests: `tests/sync/statistics.test.ts`, `tests/sync/stats.test.ts`, `tests/pages/statistics/`. The page was called Flow before. An old `#/flow` address still works: it is rewritten to `#/statistics` with its filters. The saved default period keeps its old name (`flowDays`, `flow_days` in a Python export), so exports and imports are unchanged.

It answers three questions, top to bottom: four headline numbers, then **Pace** (am I keeping up), **How fast companies reply**, **Where applications went** (the funnel), and **Reply rate by month sent** (is my search working).

- **Filters.** Account and period apply to the headline numbers, the speed chart, the funnel and the monthly chart, which all count the same applications (`loadCohort`). Pace and Waiting now ignore the period: pace shows as many weeks as the period (30 days is 5, 90 is 13, 180 is 26, all time up to 52) and counts every application in the account, so the oldest week is never partial, and Waiting now describes today.
- **No stage history.** The app stores only the current stage, so timings come from dated evidence: a classified email's date or a step you logged that names a stage. An application with no applied day, or whose stage you set by hand with no step, adds nothing to the timings. A stage dated before the applied day counts as day 0.
- **Timings.** First reply is the first sign of any stage past Applied, interview is the first Interview email or step, and outcome is the first Offer or Rejected for an application that is at Offer or Rejected now. Each is shown as a median with the middle half (25th to 75th percentile, nearest rank, whole days) and needs at least 3 applications, otherwise it says "Not enough yet".
- **Pace.** Weeks run Monday to Sunday (`WEEK_START`). The average is over weeks that are over, so an unfinished week doesn't pull it down. The goal line, "Goal met 3 weeks in a row" and "Best week" use the weekly goal from the Applications page.
- **Waiting now** counts Applied and Heard back applications by how long they have been quiet. The follow-up and no-reply counts link to the matching filters on the list and match its numbers.
- **Reply rate by month sent** appears once applications span two months. Months where even the last application is under 30 days old are hatched ("Still coming in"), because replies are still arriving.
- **Every chart** has a heading, a tooltip on hover or focus (a tap pins it on a phone), arrow keys between marks, a "Table view" with the same numbers, and works in dark mode and forced-colors mode.
- **Image.** Save as image, Copy image and Share still make a picture of the funnel only, named `job-search-statistics-YYYY-MM-DD.png`, with totals and no names.
- **The Python edition** has the renamed Statistics page with the funnel only. `/flow` there answers with a redirect.

## Browser storage

Everything the hosted app keeps in the browser, apart from tokens (those are in memory only). None of it is a secret and none holds an email.

| Where | Name | What |
|---|---|---|
| IndexedDB | `jobtracker:<iss>:<sub>` (one per logged-in user), or `jobtracker:local` in demo mode | All your data. Tables: accounts, applications (a deleted one has `deletedAt`), emails, activity, feedback, ignoredMail, learnedRules, contactEdits, documents (resumes and cover letters, a deleted one has `deletedAt`), settings. The settings table also holds `appearance`, `sync`, `savedViews`, `weeklyGoal`, `settleMark` (what the last Needs review re-check looked at, so a sync with no new mail skips it: every application's name, role, stage, lock and deleted state, held mail, the learned rules and the rules version) and `emailFailures` (how many times an email failed for a reason other than storage, so one that always fails is given up on after 3 tries instead of holding the sync back for good). Emails carry a helper field `review` (1 while waiting in Needs review) behind an index, so counts never read email text; exports leave it out |
| IndexedDB | `jobtracker-backup-files` | The handle of the chosen backup file, per account database name |
| Local storage | `jobtracker:lastProvider` | The provider you last logged in with |
| Local storage | `jobtracker:carryover-done` | You have already brought earlier applications into an account |
| Local storage | `jobtracker:look:<database name>` | Theme, density, corners and accent, so the page paints before the database opens |
| Local storage | `jobtracker:resume-editing` | Whether the resume editor opens on the page or as a list (`page` or `list`) |
| Local storage | `jobtracker:backup:<database name>` | Last backup time and last snooze time |
| Local storage | `jobtracker:ai:vault:<database name>` | The Anthropic key locked with a passphrase: only `{v, salt, iv, ciphertext, last4, model}`. Never the plain key or the passphrase. Not in the export, the backup file or the settings table. "Forget key" and "Delete all my data" remove it |
| Session storage | `jobtracker:local-banner-dismissed` | You dismissed the demo banner |
| Session storage | `jobtracker:carryover-dismissed` | You chose Not now on the carry-over offer |
| Session storage | `jobtracker:persist-asked` | The app has already asked the browser to keep its storage this session |
| Session storage | `jobtracker:offers-open:<database name>` | Whether the Compare offers card is open |
| Session storage | `jobtracker:reread-dismissed:<resume id>` | You dismissed the offer to re-read the master resume as the template |
| Session storage | `jobtracker:lastResume:<database name>` | The id of the resume last chosen in "Resume sent" on the Add forms (set in `pages/applications/index.tsx`) |
| Session storage | `jobtracker:resume-steps:<database name>` | The job in progress on the Resume page: the posting, company, role and link, the baseline and the unsaved resume and letter (`pages/resume/flowState.ts`); cleared on Save, Start over, Discard changes on leaving, log out and Delete all my data (`app/resumeFlowStorage.ts`) |
| Session storage | `jobtracker:resume-docs-open:<database name>` | Whether Your documents is open on the Resume page (`pages/resume/docsOpen.ts`) |

`public/privacy.html` lists the same names. When you add one, update both and the "Privacy" note in the root README.

## What is not in this edition

Replying from the app, the Jobs tab (resume matching, Adzuna, Windows pop-ups), multiple profiles (each logged-in user has their own data instead) and scheduled background sync.

## Layout

For how anything here should look, read [DESIGN.md](../DESIGN.md) first (it links to the guides in `docs/design/`).

- `src/auth` login, token handling, per-user database name
- `src/providers` Gmail and Graph readers
- `src/pipeline` the classifier, ported from Python and checked against golden fixtures (see "Changing the classifier" below)
- `src/db`, `src/sync`, `src/portability` Dexie storage, sync, stats, import and export. `src/sync` also holds the pure logic behind resumes and cover letters (`documents.ts`), search, saved views, the weekly goal, the calendar, `.ics` files, follow-up drafts and Recently deleted (`trash.ts`, `live.ts`)
- `src/backup` the storage request, backup reminder and optional backup file
- `src/jobs` paste a job link (board lookups, the bookmarklet, pasted text, `readJob.ts` for the Resume page)
- `src/ai` the optional AI: the key vault (`vault.ts`), the Anthropic call (`client.ts`), errors, the convert prompt and checks, the extract prompt for a pasted job (`extractJob.ts`), and the dependencies the UI is given (`deps.ts`). It may import `providers/backoff` (its helpers depend only on base types). Hosted edition only
- `src/documents` pure logic about resumes, with no React or database: reading a resume from a PDF, Word or text file (`read/`), the template (`blankResume.ts`), the re-read offer (`reread.ts`), comparing a tailored copy with its baseline (`compare.ts`) the words a posting asks for (`postingTerms.ts`) and the Download PDFs (`pdf/`, which loads `pdf-lib` only when Download is pressed)
- `src/app`, `src/pages`, `src/components` the UI (`src/app/download.ts` saves a file, or two PDFs, from the browser, `src/app/usePhone.ts` is the one phone-width hook, `src/app/routeId.ts` reads a `:id` route segment; components never import pages, so anything both need lives in `src/app`; `src/pages/resume` is the Resume page (Job and the split in `sections/` with `flowState.ts`, then Your documents) and its print view, `src/components/documents` the Documents section of the application page; one folder per feature in `src/components`, each with its own css: `calendar`, `trash`, `shortcuts`, `savedviews`, `goal`, `offers`, `followup`, `upcoming`, `bulkadd`, and more). `src/styles/base.css` is the shared stylesheet, kept in step with `jobtracker/templates/base.html`
- `src/config.ts`, `src/site.ts` the OAuth client IDs and the repository links, both public by design
- `src/demo` the demo data behind "Load demo data"
- `site-config.json` the two app IDs the setup page writes
- `public/manifest.webmanifest`, `public/icons/` and `scripts/make-icons.mjs` the install manifest, its icons and the script that redraws them
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

GitHub Pages can't set response headers, so the Content-Security-Policy is a `<meta>` tag in `index.html`. Every host in its `connect-src` is a place the app sends requests to. Add one only for a feature that needs it, and list it in `public/privacy.html` in the same change. `tests/backup/csp.test.ts` pins the host list, rejects inline and eval scripts, and checks that every host is named on the privacy page. `https://api.anthropic.com` is there for the optional AI.

## Known risk: the shared github.io origin

Browser storage and Google's "Authorized JavaScript origins" belong to an origin (scheme, host and port), not to a path. GitHub Pages serves every project site of one account from the same origin, `https://thornleung01.github.io`, and `/job-tracker/` is only a path. So any other page on that origin (another repository's Pages site, a future project, a page with a cross-site scripting bug) could read this app's IndexedDB databases, and could ask Google for a Gmail token using this app's public client ID for anyone who has already consented to it. Microsoft is less exposed, because its redirect URI is an exact match on the path. A forked copy has the same exposure on its own github.io origin.

The AI vault is in local storage, so a page on the same origin can also read it. That is ciphertext only, and it is authenticated, but a page could copy it and guess the passphrase offline, so a strong passphrase matters. A page on the same origin can also open this app in a window and watch a typed passphrase, which a passphrase can't prevent. So people should type it only on this address.

This isn't fixed yet. The fix is to serve the app from an origin of its own: a custom domain, or an account or organization that hosts only this site. That is a decision for the repository owner (it needs a domain and DNS, plus new Google and Microsoft origins and redirect URIs). Until then, don't publish any other GitHub Pages site from this account. Moving origins also moves the browser databases, so people would need to export their data and import it on the new site.
