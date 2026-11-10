# Screens

Per-screen specifications for Job Tracker. Read the rules in [DESIGN.md](../../DESIGN.md) first (principles, tokens, the components catalogue), then the screen you are changing. Where a rule is generic it lives in the catalogue and is linked from here, not repeated.

Edition legend: **local** is the Python app (`jobtracker/templates`), **hosted** is the web app (`web/src`), **both** is shared. Pages are under `web/src/pages` and shared parts under `web/src/components`.

To add a screen spec: add a section under the closest group below, name the route and edition, say what is on the page in reading order, say what each control does and where focus goes, and link to the catalogue entry for anything that is not unique to the screen.

## Contents

- [Applications list](#applications-list)
- [Application detail](#application-detail)
- [Resume page and its steps](#resume-page-and-its-steps)
- [Settings and Setup](#settings-and-setup)
- [Log in and setup guide](#log-in-and-setup-guide)
- [Jobs and Calendar](#jobs-and-calendar)
- [People and email](#people-and-email)
- [Gate sentences](#gate-sentences) (used by every screen)

## Applications list

Edition: hosted unless noted. The page at `#/applications` (local: `/`). Shared pieces are in the [catalogue](../../DESIGN.md#4-components-catalogue).

### One way to add

A single secondary "Add application" button opens the form in place, between the filter card and the list. While it is open the form's Save is the one primary and Apply filters steps down.

### One target per row

A list row expands from its name or anywhere on the row; "Open full page" lives inside the expanded panel, never beside every name.

### Duplicate warning

One muted sentence under the add form's fields with the application as a link. It informs and never blocks Save.

### Demo banner

A quiet one-line status row ("Demo mode: not logged in, data stays in this browser.") with text actions. It follows the [quiet status row](../../DESIGN.md#quiet-status-row) rules, and "Load demo data" shows only while the database is empty.

### Backup nudge

A quiet one-line status row at the top of the Applications page, like the demo banner: muted 0.875rem text ("Your applications only live in this browser. Last backup: never."), then two text actions, "Export a backup" and "Remind me in a week". It follows the [quiet status row](../../DESIGN.md#quiet-status-row) rules, and nothing waits on it. Focus moves to the page when it is snoozed so it isn't lost.

### Setup card on Applications

A hosted-edition card above the list while setup is unfinished: the title "Finish setting up · 2 of 4", a muted line naming the next missing step ("Next: add your resume"; "Optional: add your Anthropic key" for the AI key), a primary "Continue" (to Settings, where Setup is the first tab) and a quiet "Dismiss". It is hidden once all four steps are done or skipped, and once dismissed; the dismissal is stored in the person's own database, so it stays gone on reload. It replaces the old "No email account connected yet" notice. The empty table row reads `No applications yet. Choose "Add application", or finish setting up to find them in your email.` with "finish setting up" a link to Settings; in the demo build it reads `No applications yet. Choose "Add application", or load the demo data.` with "load the demo data" an inline button, the same guarded load as the demo banner. The demo build never links to the owner's guide.

### Carry-over offer

A quiet row, not a card: one sentence saying how many applications are saved in this browser from before login, with "Bring them over" and "Not now". It is never automatic. Afterwards a Notice says the earlier copy is still in this browser, with "Remove the earlier copy", which asks in place before it deletes.

### Coming up

A hairline-divided list above the filter tabs, no card and no visible heading: company, role and day ("Today", "Tomorrow", "Thu, Oct 15") on one row, each a link to the application. Seven days ahead, five rows at most, hidden while any filter is on and when there is nothing to show.

### Quiet lines under the stage

"Interview Thu, Oct 15" and "Decision by Oct 15" sit under the stage in small muted text. They are plain text, with no colour and no icon.

### Follow-up

"Follow up?" is a label-size tag on the Inactive bg, in text-secondary, beside the last activity. "Needs follow-up" is a plain checkbox in the filter card, applied with Apply filters like the rest.

### Select several

A checkbox column leads the list (the header box selects every row shown), and ticked rows tint with Inactive bg. While any are ticked a card appears between the filter card and the list with the count, a stage select with "Set stage", a danger "Delete" and "Clear selection". Delete asks in place, not in a browser dialog, and afterwards one notice says what happened and takes focus. Row clicks never tick. The box does.

### Paste a job link

The link field sits at the top of the add form with a quiet "Fill in" button. Anything derived is a suggestion: guessed fields carry a muted "Guessed from the link" hint that clears when you edit, and nothing is saved until Save is pressed. Untrusted text from links, APIs and the bookmarklet is only ever rendered as text.

### Quick edits

In the applications list, role and applied date read as plain text and become a field when chosen: Enter or leaving the field saves, Escape restores, and focus goes back to the text. The stage is a coloured pill that is a real dropdown, with a quiet Undo for a few seconds after a change. Nothing shows an edit icon.

### No reply tag

"No reply in 30 days" is the same label-size tag as "Follow up?" (Inactive bg, text-secondary), and "No reply" is a plain checkbox beside "Needs follow-up" in the filter card. An application shows one tag or the other, never both.

### Search note

When a row matched on text other than its company or role, a muted "Matched in an email: ..." line sits under the company, with a short snippet as plain text.

### Saved views

"Save this view" is a quiet button on the Applications page, shown once the filters or sort differ from the plain list, that opens a one-field form. Saved views are pill chips (Inactive bg, 0.875rem/500) above the list, each a link with a small options button that opens Rename and Delete view in a Surface-secondary block under the chips. The chip for the current view is filled in ink. Deleting a view says so in a muted line under the chips ("Deleted the view \"Mine\".") and focus moves to the next chip's options button, or to that line when it was the last.

### Weekly goal

One muted sentence ("This week: 3 of 5 applications. Goal reached.") with a 6px pill bar in the accent on Inactive bg under it, and a quiet "Change goal" button. With no goal it is only a quiet "Set a weekly goal" button. No ring, no confetti, no colour change when it is met. The one button stays where it is when the goal is set or removed (only its words change), so focus stays on it, and a screen-reader-only line says "Weekly goal saved." or "Weekly goal removed."

### Compare offers

A card that is closed until opened: a 44px disclosure row with the Lucide chevron and a count, then a hairline-divided table (company as a link, role, salary as typed, decision deadline with the days left in muted text ("3 days left", "Today", "Passed yesterday"), stage date) that scrolls sideways on a phone. It stays as it was left for the rest of the session.

### Resume column and filter

Resume is an optional column (Settings, Appearance, off by default) that sorts and hides on a phone. The filter card has a "Resume" select (Any resume, each version, No resume set) and the current choice shows as a chip ("Resume: Analyst v2", "No resume set"). The Add forms ("Resume sent") and the bulk bar use a select of the versions too, with "Set resume" in the bulk bar. An interview in Coming up and the calendar carries a muted small "Sent: Analyst v2".

### Keyboard shortcuts

A quiet "Keyboard shortcuts" button at the bottom of the Applications page opens a small modal dialog (440px wide at most, a raised card on a 40% black backdrop): a list of keys in `kbd` pills with what they do, a muted line that they don't work while typing, and one primary Close. The list includes `g` then `r` for Resume. Focus moves in, Tab stays inside (focus that lands anywhere behind it is brought back), Escape or Close shuts it and focus goes back to what opened it, or to the footer button when that is gone.

### Add several links

A quiet disclosure inside the Add application form with a textarea (one link per line, up to 10), "Add these" and, while it runs, Stop (the disclosure stays open meanwhile, and focus moves to Stop and back to "Add these"). Each link then gets a plain sentence ("Added Acme, Designer.", "Skipped. Already saved as ...", "Couldn't be read. ..."), all as text.

### Stacked phone row

Both editions. A two-column grid per application with the stage (dot and word) top-right and last activity beneath. At 720px and below each table row becomes this stacked block: company and role on the left, stage on the right, last activity on its own line; column headers become a row of pill sort buttons with the active sort filled in the accent. Role, Applied, Emails, Rounds and Resume columns hide there. The checkbox column stays as a narrow first column of each card.

### Expandable list panel

Both editions. Clicking a company name (a 500 row label with a Lucide chevron) opens an in-place Surface-secondary panel under the row with a two-column form grid (gap 32px, one column at 720px and below) and a hairline-divided history list. The chevron rotates from 0 to 90 degrees over 0.16s; [disclosures](../../DESIGN.md#disclosures) reuse the same chevron.

## Application detail

Edition: hosted unless noted. The page at `#/application/:id`.

### Detail actions

One stage select that applies on change, plus a "More" menu (merge, not an application, delete). Nothing uses a browser dialog. Delete and Not an application ask in place with the shared [InlineConfirm](../../DESIGN.md#inlineconfirm), as do removing a person, deleting selected rows, and the Data actions that replace or erase everything. Delete says "You can restore it for 30 days" and puts the application in Recently deleted; "Delete for good, keep emails in Needs review" sits inside the same block. Merge asks in place with its own small form (a select and Merge applications); focus starts on the select, and Escape closes it and returns focus to the More button.

### Interview rounds

One line under the facts on the application page: "Interview rounds 3 · estimated from your emails", with a quiet "Edit rounds" button. The source note says whether the number is estimated, from logged steps, or set by you. A typed number always wins and is never rewritten by a sync.

### Offer details

On the application page, an "Offer" section with Salary and Decision deadline fields and a quiet "Save offer details". It shows at the Offer stage or once there are details.

### Add to calendar

Quiet small secondary buttons ("Add to calendar", "Download all upcoming interviews", "Download interviews (.ics)", "Download this month's interviews") that save a file and say "Calendar file saved." in a status line. No icon, no menu, and no promise of a time: the files hold all-day events.

### Draft follow-up

A small pill link, not a button, in the row of actions under an application (with the upcoming interview days and Add to calendar). It is the primary style only when the application needs a follow-up, and it says in its label that it opens a new tab. It is hidden when there is no mail account.

### Documents on the detail page

A "Documents" section with three plain blocks: "Resume sent" (a select of resume versions, None first), the cover letter (a text box, with Copy text, Draft in Gmail or Outlook and Print) and the job posting (a quiet disclosure with the pasted or captured text). On the list, an open application's panel carries one muted line ("Resume: Analyst v2 · Cover letter"), which adds a plain link "Tailor for this job" (to `#/tailor/<id>`) when a master resume exists and the application has no tailored resume yet. With a master resume, a quiet "Tailor resume and cover letter" button-link sits under "Resume sent" and goes to `#/tailor/<id>`; nothing is tailored inline on the page, and there is no "Make a copy for this job". A tailored resume shows as "Tailored" in "Resume sent" beside an "Open in Tailor" link, and the header's "You sent:" says "(tailored)". The Job posting box offers "Fill from link" when the application has a posting link. After Add application, the "Added Acme" notice carries a link "Tailor your resume for this job" (to `#/resume?app=<id>`, the Resume page steps filled from it) when that application has posting text and a master exists.

### History alignment

Every dated row in History ends at the same edge, so the dates line up in one column: the Delete button has a fixed width, and an email row leaves that room empty.

### Email text

Both editions. Emails are read, not dumped. The subject is a 500 heading, the sender a bold name with a muted address, and the date and account sit on their own line, in the viewer's time zone with how long ago. The body is 0.9375rem/1.7, max 68ch, with repaired paragraphs and lists. Reply chains and footers fold under "Earlier in this thread" and "Footer and links". Links show their domain and are never clickable. A sent reply is a Surface-secondary card labeled "Reply sent". The newest email carries a "Latest" pill (the accent fill).

## Resume page and its steps

Edition: hosted only. `#/resume`, with the Print view and the Tailor pages that hang off it.

### Resume page steps

Hosted edition only. The title "Resume" over a four-step strip: "1 Your resume", "2 The job", "3 Review", "4 Add to applications". Each step reads done (a Lucide check), current or waiting in words as well as tone, never colour alone. Only the current step is open; a finished step collapses to one line with a quiet "Change", and focus moves to the new step's heading when the step changes. Step 1 with no master is the empty state below ("Start from the template", "Upload a file", "Paste text"), the convert and check, then "Save as master resume", which opens step 2; with a master it is one line, "Master resume · updated Nov 10", with "Change" (scrolls to the master under Your documents) and a small "Based on" select (the master or a version, master first). Step 2 waits until a master exists: "Paste the job description" (a big text box), an optional "Job link" with "Fill from link", then Company and Role, filled from the pasted text on the device and marked "Check these" until touched (when both stay empty and the key is unlocked, one small AI call fills them, kept only if the words are in the posting), and "Words from the posting" under the box. The actions wait for a company, and for a link that is a web address (the rule an application's link follows: a plain sentence next to the field says what is wrong). The primary is "Write my resume and letter" (AI, with the inline unlock, and Stop while it writes; with no key, one line and a link to Settings, AI), beside a quiet "Start by hand" that copies the baseline with no AI and starts the letter with the greeting. Step 3 has a switch of two buttons (the `.doc-switch`, the chosen one pressed), Resume and Cover letter: the tailored copy in the page editor with change marks, Use ticks, flags, "Left out" with Add back, "Changes from your baseline" and the one-page check; the letter as an editable text box with its flags and Copy text. Its buttons are "Next", "Try again" (asks in place first if you edited) and "Back", and nothing is saved yet. Step 4 is one sentence: "Already in your applications: Gringotts, Product Analyst (applied Sep 7)" with "Use this one" (the default) and "Add as new", a choice of rows when several match (by link first, then company and role), or "Adds Gringotts, Product Analyst to your applications (Applied, today)". The primary "Save" asks in place before replacing a tailored resume or letter the application already has. An application that is used keeps its own posting text and link and gets the pasted ones only when it has none, and saving without a letter keeps the letter it already has. If the resume the draft was based on has been deleted, one muted line says so and the master is used for Review and for Save. Done reads "Saved to Gringotts" with "Open application", "Edit in Tailor" (`#/tailor/<id>`), "Print resume", "Draft letter in Gmail" or Outlook (when a mailbox is connected) and "Tailor another job" (back to step 2, cleared). The job in progress survives a reload in session storage until Save or "Start over", until "Discard changes" on the leave question (which clears the saved job too), or until log out or "Delete all my data". Leaving the app with an unsaved draft asks first, like the other editors; reloading or closing the tab does not bring up the browser's prompt for the draft (it is kept), only for the editors that keep nothing. `#/resume?step=job` opens step 2, `#/resume?step=job&baseline=<id>` opens it with that resume version as "Based on" (an id that isn't a live resume is ignored), and `#/resume?app=<id>` opens it filled from that application (company, role, posting text and link) with step 4 set to "Use this one" for it. At 390px the strip wraps to one step per line and every control is a 44px target.

### Your documents

Under the steps on the Resume page, a "Your documents" section with three [Minimal segmented](../../DESIGN.md#segmented-controls-and-tabs) tabs, Resumes, Cover letters and Tailored. Resumes is a stack of 20px cards: the master editor card (the sheet editor: the classic one-page sheet itself with every text a borderless field you type into where it is, a line's move up, move down and remove buttons on a white chip that appears on hover or focus and floats in the margin only when the editor is 900px wide or more, otherwise sits over the line's right end, a quiet add row under each section ("Add bullet", "Add job"... the likely next line first, and "Add contact line" under the header), and a muted "Fits one page" line above; a `.doc-switch` of two plain options, "Edit on page" and "Edit as list", the chosen one in a grey rounded rectangle, picks between it and the list of plain fields, where each line has a "Line type" select (Line, Job, Job title, Bullet, Skill, School) and label, location and dates fields that show only for the types that use them; on a phone the controls and the add row are always shown with 44px targets and the sheet uses 16px type; a quiet muted row under the title, "This resume was saved before the template. Re-read it as the template?" with Re-read and Dismiss, shows for a master with no typed lines; the demo resume is structured in the same layout; "Replace with a file", "Make a version", "Tailor for a job" (a plain button that opens step 2 at `#/resume?step=job`), Print) and one card per resume version, each with a muted "Used for 2 applications" line (a link to the list filtered to that resume), Rename, Edit, Duplicate, "Tailor with this" (goes to `#/resume?step=job&baseline=<id>`, step 2 with that version as "Based on"), Print and a Delete that asks in place. Before there is a master, one card offers "Start from the template" (primary: a card with the blank sheet editor to type into, Save off until there is text, and Cancel that asks in place only after something was typed), "Upload a file" and "Paste text", and what is read is shown to check before Save. Cover letters is a list of rows, each a link to its application with the letter's text. Tailored is the same card list for the resumes tailored for one application each, newest first: the title, a muted line with a link to the application ("Acme, Analyst"), "Based on: Master" or the version's title (a deleted baseline reads "Based on: a deleted resume") and the updated date, then "Open in Tailor" (goes to `#/tailor/<id>`), a quiet "Make reusable" (turns it into a resume version; at the five-version cap a plain sentence appears under the row and the row stays) and Print. With none, one muted sentence, "No tailored resumes yet.", and a "Tailor for a job" button that opens step 2. Rows made by the steps show here like any other. The Tailor picker (`#/tailor`) and workspace (`#/tailor/<id>`) stay for an application that already exists. A tailored resume never shows on the Resumes tab.

### Convert panel on the Resume page

A card that appears for every upload or paste, headed "Convert to your template". A muted line, "This is the text that will be sent to Anthropic with your key:", labels a read-only text box with a character count under it. Buttons: "Convert with AI" (primary, once the key is unlocked), "Use the simple converter" and "Cancel", plus "Stop" while it converts. With no key, a line says "Add your Anthropic key in Settings to convert with AI." with a Settings link, and the simple converter is the primary button. With a locked key, a Passphrase field and "Unlock" sit inline. The review is the check step with a muted "Converted with AI. Check each line before you save." Above the editor, a "Check these lines" list has one row per line the conversion wasn't sure about: the note ("Not in your file: ..." or "Label added by AI"), the line, and small "Go to line" and "Dismiss" buttons. A collapsed "Not used from your file" lists the words that weren't carried over. The buttons are "Save as master resume" (primary), "Convert again", "Use the simple converter" and "Cancel", and nothing is saved before Save.

### Print view

`#/resume/print/:id` shows one document as a single clean column, with a "Print or save as PDF" primary button above it. Printed, the header, nav, banners and buttons are hidden and text is black on white. A cover letter prints in the plain system font with 18mm `@page` margins. A resume prints in the classic template: serif font on US letter with half-inch margins (the named `@page classic`), 10.5pt text on a 1.25 line height, a centered caps name and contact line, ruled caps headings, and job and school rows with the location or dates aligned right. It is black on white in light and dark. For a resume a muted status line beside the print buttons reads "Fits one page" or "About 3 lines over one page". It is advisory, because the screen layout only approximates print.

### Tailor pages

Hosted only. `#/tailor` is the picker and `#/tailor/<id>` the workspace (`web/src/pages/tailor`); they stay for an application that already exists. "Open in Tailor", "Edit in Tailor", "Tailor with this" and "Tailor resume and cover letter" all go to `#/tailor/<id>`. Tailoring for a job that has no application yet starts from the Resume steps (`#/resume?step=job`). Nothing is tailored inline on the application page. The change marks, Use ticks, flags and one-page check are the same as in step 3 of the Resume steps above.

## Settings and Setup

Edition: hosted unless noted. `#/settings/:section`.

### Export CSV

A secondary button beside Export data in Settings, Data.

### Data section: Back up, Restore, Delete everything

Settings has five sections, Setup, Mail, AI, Data and Appearance, shown one at a time at `#/settings/:section` (`#/settings` is Setup) under a row of links (the open one has `aria-current`). Data holds three cards, Back up, Restore and Delete everything (a danger card), with Recently deleted between Restore and Delete everything. Under the Back up intro, up to two muted help lines say whether the browser will keep the data and how much space it uses. A second row of secondary buttons ("Choose a backup file", "Back up now", "Choose a different file", "Stop using this file") shows only in a browser that can write to a file, with the file's name as a muted line above it.

### Recently deleted

After a delete, a Notice ("Deleted Acme. It stays in Recently deleted for 30 days.") with a small secondary Restore beside it for 8 seconds, in the same place whichever page you deleted from. In Settings it is its own card of hairline-divided rows: company, muted role, stage badge (a resume or cover letter row is a muted kind word and a dot, then its name in bold: "Resume · Resume for Acme, Analyst", "Cover letter · Acme, Analyst"), a muted "Deleted 3 days ago · 27 days left" line, then small Restore and a small danger "Delete now" (which asks in place; the result is a Notice above the rows that takes focus, since the row's button is gone). "Empty recently deleted" is the card's one danger button and also asks in place. The page of a deleted application says so and offers Restore as its one primary button.

### Settings, AI card

A card titled "AI" (hosted only, the AI section of Settings) under one muted line: "Convert a resume, tailor it for a job and read the company and role from a pasted job. Only the text you choose to send goes to Anthropic. Your key stays on this device, locked with your passphrase." Labels are "Anthropic key", "Passphrase" (help: "At least 12 characters. You'll type it to unlock your key. It isn't stored anywhere.") and "Model" (a select: "Sonnet 5.5 (recommended)", "Haiku 5.5 (cheaper)", "Opus 5.5 (best)"). Three states. None: the three fields and one primary "Save key". Locked: "Key ending in ••••1234", a Passphrase field and a primary "Unlock", with "Forget key" as a danger button beside it that asks in place ("Forget your key on this device?"). Unlocked: the same key line, a muted "Unlocked until you reload or log out.", then "Check key", "Lock" and "Forget key". Results and errors (a wrong passphrase, a key Anthropic refuses) go to the Notice at the top of Settings, like the other cards.

### Settings controls

The theme, density and corners choices use the Default segmented control (`.seg`, see [Segmented controls and tabs](../../DESIGN.md#segmented-controls-and-tabs)). Accent swatches are raised pills with an 18px dot and a 2px ink ring when selected. Settings shows one of five sections at a time (Setup, Mail, AI, Data, Appearance, in the order things depend on each other), chosen with a row of links at the top (`.section-switcher`, a pill track with a grey indicator on the open section; it scrolls sideways when it does not fit). Setup is the default: "Set up Job Tracker" with "2 of 4 done" over four rows (Mailbox, Resume, AI key, Backup), each a tick or an empty circle with words ("Connected", "Linked" when an account exists but needs reconnecting in this tab, "Not yet"; in the demo the mailbox row is done by nature and says "Not available"), a line on what it unlocks and its own buttons; Skip and "Not now" count a row as done by choice. Mail has Account (Log out), Email accounts, Look back on first sync, Sync now and what the app has learned; Data has Back up, Restore, Recently deleted and Delete everything. The reference calls for the indicator to animate between options; this app switches instantly because it has no script on that form.

## Log in and setup guide

Edition: hosted only.

### Log in page

Two equal "Continue with ..." buttons in one card. Google's own G mark sits on a white pill, as their branding rules ask; the button the person used last gets the primary style. One muted help line says one window logs them in and Google may show an unverified notice (Advanced, then Go to Job Tracker). "Log in without connecting your mailbox" is always there under the buttons, a quiet text button in the ink colour (it logs in with the provider that just failed, else the one used last, else the first the site has); it is left out only when the site has no client IDs. The footer holds Privacy, and "Site setup (for the site owner)" only when the site has no client IDs or the address has `?setup` (the address `#/setup` always works).

### Site setup guide page

Its title is "Site setup (for the site owner)", the one name wherever it is linked. `#/setup` is numbered steps in cards, one per console. Every value to copy is a monospace line with a Copy button. The two ID fields check their format as you type and say so in plain words. The generated `site-config.json` text sits below with a Copy button and an "Open site-config.json on GitHub" link, then an invite block with a copyable message. It needs no login.

## Jobs and Calendar

Jobs is the local edition's tab. The calendar is a view of the hosted Applications page.

### Jobs tab

Filter tabs (Matches, Notifications, Your profile, Sources) sit above a second row of view tabs (New, Saved, Applied, Dismissed, All) with counts. Matches are hairline-divided rows inside one card: a 500 title, a small tonal score pill, a muted "company · place · source" line, the match reasons in body ink, then pill actions. "I applied" is the one primary action; Dismiss is the quiet danger. The nav's Jobs link carries a count badge of new matches. On phones the actions wrap under the reasons.

### Calendar

A List and Calendar pair of tabs on the Applications page (the [Minimal segmented control](../../DESIGN.md#segmented-controls-and-tabs)). The month is a seven-column grid in a hairline-bordered 20px box: weekday names in muted small text, each day a 44px-or-taller cell with its number, up to three event chips (Inactive bg, 0.75rem, a Lucide icon and the event word, never colour alone) and a muted "+2 more" for the rest. Today's number sits in a 2px ink ring, the chosen day has a 2px ink inset ring on Inactive bg, and days outside the month are muted. It is a `role="grid"` with one tab stop, and forced-colors mode uses system colours for the rings. Weeks start on Monday.

### Calendar day panel

Choosing a day opens a raised card under the grid: the long date as a heading, one row per event (icon, word, company and role as a link to the application, "Past" when it is) and "Download interviews (.ics)". Nothing is shown for an empty day except "Nothing on this day." Coming up and Compare offers are not shown in the calendar view.

### Calendar agenda

At 720px and below the grid is replaced, not squeezed: one section per day that has events (today first), a heading with the weekday and date, and the same event rows.

## People and email

Both editions.

### Lists are lists

People is one hairline-divided list on the page background, not a card per company (see [Rows and lists](../../DESIGN.md#rows-and-lists)).

### People page

Each company on the People tab is a dropdown (`details.company`): a card whose summary row is the chevron, the company name, its role, and a people count. It opens by itself when there is only one or after a search, and Expand all / Collapse all sit above. One shared person component on the People tab and inside each application: bold name, a tag for the kind (Recruiter, Hiring side, People Ops), the title as plain text, then a muted address and last contact. One action row holds Email (primary), Reply here, the emails list and Edit. People are grouped under their application and hairline-divided, never boxed.

## Gate sentences

Used by every screen. When something is missing, every screen says it in the same words and links to the place that fixes it: "Connect your mailbox in Settings." (`#/settings/mail`), "Add your resume first." (`#/resume`), "Add your Anthropic key in Settings." (`#/settings/ai`), "Unlock your key to use AI." and "Paste the job description first." They live in `src/app/gates.ts`. Gate wording rules are in [copy.md](copy.md#63-gate-sentences-with-a-link).
