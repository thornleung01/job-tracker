# Writing the words (voice, tone and card copy)

Self-contained: it distils the Wealthsimple content style guide and the support self-resolution card rules (the originals are no longer
needed), then adds the rules this app follows. Scope: all user-facing English in `web/` (buttons, labels, errors, gates, empty states,
confirms, `public/privacy.html`). The card rules (section 4) apply to any status card a screen shows, such as the Finish setting up
card or a sync result, and to any future card that says what happened and what to do.

Sentences marked **Example** are invented to show a rule. Everything else quoted in this file was checked against `web/src` or
`web/public` at base commit `6ec25e4`. Where the app differs from the Wealthsimple guide, the line says "In this app".

## 1. Voice and tone

### The four voice principles
1. **Transparent, never jargon.** Say it like a person talking to a person. No bank-y or engineer-y words. Never show a raw code, enum,
   HTTP status or stack text.
2. **Human and approachable.** Real people, relatable words, conversational cadence.
3. **Helpful.** Advise, don't hand-hold or prescribe. Explain a tricky idea without talking down.
4. **Funny (sometimes).** Rare. Most jokes won't land. Never in an error or problem.

### Pronouns, contractions, emoji
- Person = **you / your**. The app = **we** (rarely needed; name the thing instead). Never "I / my" for the app's voice. The one
  allowed first-person form is button text the person "says": "Write my resume and letter", "Replace my edits", "Skip, I'll add
  applications by hand".
- Everyday contractions (can't, didn't, isn't, we'll). Avoid regional (ain't, y'all) and stacked ones (shouldn't've).
- No emoji in product copy. No emoji in this app at all.
- Inclusive: person first ("a person with a disability"); never "enabled/disabled" for states ("You turned off reminders", not "You
  disabled reminders"); default to they/them; never alter or truncate a person's name.
- Canadian spelling: cheque, colour, centre ("Help Centre"). Outside brand names, "organization" is fine: the app writes "Your
  Anthropic organization" because the Anthropic console spells it so.

### Tone by context
| Context | Tone | Do | Don't |
|---|---|---|---|
| Problem (failed, refused, locked, offline, too long) | Helpful and transparent | What happened, then the next step, in plain words | Jokes, "Oops", "Uh-oh", "!", blame ("You entered...") |
| Good news (saved, synced, offer found) | Warm and short | A plain confirmation. One "!" at most per screen, only if truly positive | Confetti language, stacked "!" |
| Neutral or routine (progress, status, labels) | Short and functional | A fragment or one sentence | Explaining what the person can already see |
| Legal, security, privacy, keys | More transparent, less casual | Accuracy first, plain words; name the exact thing (read-only, this browser, never stored in plain text) | Reassurance with no fact behind it, vague "secure" claims |
Real examples: problem "That passphrase didn't unlock your key." (`ai/errors.ts`); neutral "Synced 3 minutes ago" (`SetupRows.tsx`);
security "Your key is stored only locked with your passphrase, and the key and the passphrase are never stored in plain text."
(`privacy.html`).

## 2. Formatting rules (exact)

### Capitalization
- **Sentence case everywhere**: headers, labels, buttons, detail rows, menu items. Only the first word and proper nouns are
  capitalized. "Account number", not "Account Number".
- Do not capitalize products (margin, options), asset types (stocks, bonds) or standard account descriptors. Do capitalize registered
  accounts (RRSP, TFSA, RESP, LIRA, HISA), status names (Core, Premium, Generation), proprietary product names and brands (Gmail,
  Outlook, Anthropic, Interac).
- Named places in the app are capitalized: Settings, Needs review, Recently deleted, Job Tracker. Everything else is sentence case
  ("Add application", "Sync now").

### Currency
- Always numerals: "$3", never "three dollars". Detail rows, balances, records: 2 decimals including zeros, "$30.00". Headers and
  sentences drop decimals only when zero ("$30,000"); "$215.60" keeps cents.
- **Negative amounts: en dash, no space**, "–$30.00". Never a hyphen.
- Estimates: prefer words ("about $9.99"). If tight, "Est. $9.99" or "~$9.99". Never a bare "Est." or "~".
- Codes: "USD", "CAD". In this app salary fields show the number the person typed, with a code if given.

### Numbers
- Commas, not spaces: "10,000". Numerals always: "in 2 weeks", "3 resumes". Don't start a sentence with a numeral; rephrase.
- Don't truncate below 100,000. 100K to 990K: truncate only if needed (capital K, no space). Over a million: "1 million" or "$1.8M".
- Percentages: numerals, two decimals only when non-zero ("4%", not "4.00%"). Ranges use one symbol and an en dash: "4–7%".
- Counts: "3 of 4 done". Limits are named with the number: "Add up to 50 links at a time."

### Dates and times
- Spell out when there is room: "January 2, 2023". Abbreviate the **month only** when tight: "Jan 2", "Nov 22". No ordinals for
  specific dates; ordinals only for recurring ("monthly on the 27th").
- Times: 12-hour, lowercase, space before am/pm: "1:00 pm". Timezone in caps, no DST letter: "1:00 pm ET". Ranges use an en dash, no
  spaces: "8 am–8 pm".
- Relative times ("Synced 3 minutes ago") are fine for status. Use the absolute date for anything the person may act on (a deadline, an
  interview).
- Where a date must be typed: "Enter the date as year-month-day, for example 2026-10-21." (`db/time.ts`). The same shape: "Enter the
  deadline as year-month-day, for example 2026-10-15."

### Masking
- Account and card numbers (Wealthsimple rule, not used in this app): last 4 only, **three small bullets then the digits**, "∙∙∙7014".
  Not "****7014", "Card - 7014", "Card | 7014".
- In this app a key is shown by its last 4 characters in a sentence: "Key ending in ••••1234" (four bullets, U+2022;
  `web/tests/settings/ai.test.ts`). Never show more of a secret than that.

### Punctuation
- **Headers, titles, buttons, labels: no end punctuation.** Exceptions: a real question ("Replace your edits?") or one "!" on a
  genuinely positive card. A header that is two sentences punctuates the first and not the last.
- **Sentences (summaries, errors, gates, help lines) take a full stop.**
- En dash (–): ranges and negatives, no spaces. No em dash (—) anywhere in UI copy: it reads as machine-written, so use a comma, a colon or a new sentence (PRODUCT.md and DESIGN.md hold the same rule). Hyphen
  (-): compound adjectives (tax-free), phone numbers.
- Oxford comma in lists of three or more. Avoid ampersands and semicolons; start a new sentence.
- Quote UI names the person must find: Choose "Add application". Straight quotes in code strings; typographic are fine in static HTML.
- "!": roughly once per screen at most, only for good news. Never on a problem.

### Abbreviations
Avoid them (insider talk, trips screen readers). Allowed without expansion: registered accounts and widely known ones (CRA, ETF, URL,
PDF, AI). Spell out anything else on first use. "U.S." takes periods; "USD"/"CAD" for codes.

## 3. Glossary (preferred terms)

One word for one thing. Never vary vocabulary. Canadian spelling. No internal jargon. External institutions and brands keep their own
names. **Decision:** the Wealthsimple glossary was adopted only where Job Tracker has the same thing, and `log in` (verb) / `login`
(noun) was made the one form (the app's own screens, `App.tsx`, `google.ts` and `privacy.html` all use it). Nothing in the repo
recorded this before; this table and the app-terms table are now the record, and the gate wording is also in `DESIGN.md` ("Gate
sentences") and `web/src/app/gates.ts`.

| Use | Not | Applies to Job Tracker? |
|---|---|---|
| our team, support team, contact us | Customer Service, Client Success | **No.** There is no support team. Never write "our team" or "contact us". Point to a screen ("Check it in Settings") |
| account | bank account, client account, user settings | **Yes**: the person's account and a connected mailbox ("Reconnect account") |
| profile | account profile | Rarely; the app says Settings |
| chequing account, credit card, virtual card, digital wallet, cheque, e-transfer / Interac e-Transfer (never plural, never a verb), direct deposit | Cash account, Visa card, mobile wallet, check, DD | No (money products). Keep for any money copy |
| money / funds / cash | withdrawal, deposit | money = casual, funds = formal, cash = uninvested. Only in salary or offer copy: "salary", "offer", never "payout" |
| **log in** (verb), **login** (noun) | sign in, log on, log-in | **Yes**, everywhere user-facing ("Log in", "Log out", "Back to log in"). Code and comments may say sign-in |
| submitted | | A request entered into a process. Use only if the app tracks it; otherwise use stage names |
| recurring / scheduled | auto-pay | recurring repeats; scheduled is one future time. Reminders ("Follow-up scheduled") |
| status | tier | Not used. An application has a "stage" |
| Help Centre | Help Center, Help Desk | No help centre here; say "Settings" or name the screen |
| Dismiss, Undo | Close, Revert | Yes. Dismiss hides a notice. Undo reverses the last change |

**App terms (keep these exact):** application (a job the person applied to; not job, entry, record, card); stage (not status, state,
phase); resume (not CV); Mailbox (the connected Gmail or Outlook; not inbox, email account); key (the person's Anthropic key; not
token, secret, API credential); passphrase (locks the key, it is not a login; not password); Settings (not Preferences, Options); Needs
review (not Inbox, Queue, Flagged); Recently deleted (not Trash, Bin); Delete application / Delete now / Empty recently deleted (not
Remove, Purge); Sync now (not Refresh, Fetch, Pull); Tailor, for a resume for a job (not Customize, Optimize); Export data / Import
(the row is named Backup; not Backup file, Restore).

## 4. Anatomy of a self-resolution card

A card lets the person handle one task in the app before anything else. Use only the elements the situation needs. Only the header is
required.

| Element | Summarized (list or page) | Detailed (panel or chat) |
|---|---|---|
| Header | shared | shared |
| Summary (2 lines max) | shared | shared |
| Timeline / status | only if real data and relevant | only if real data and relevant |
| Detail rows | no | yes, the extra detail lives here |
| Buttons | needs-action cards only | yes |

Header and summary are written once and shared so the variants match. The detailed variant adds rows; it does not lengthen the summary.

**Header.** One line. The rule is line count; guide **about 35 characters or fewer** (past that, check it on device; tighten, it is not
a failure). Lead with the most identifying information. Patterns: problem `{thing} from {source} is {status}`; outcome `{thing} arrives
{date}`; opportunity: state it (one "!", good news only). Sentence case, no end punctuation (a genuine question or one "!" on good news
excepted). Negative amounts use an en dash. **Example:** "Sync from Gmail is paused". Real: "Finish setting up · 2 of 4"
(`SetupCard.tsx`).
**Summary.** Two lines max, guide **about 70 characters or fewer**. Say what happened *and* what to do, in that order, as full
sentences with full stops. Do not repeat the header. If state and action will not both fit, **keep the action** (the header carries the
state). Use the **same words as the button**: a "Reconnect account" button pairs with "Reconnect your account to keep syncing."
Problem: plain, no jokes. Good news: warmer is fine. In this app: the Setup card's line is a fragment ("Next: add your resume",
`NEXT_STEP_TEXT`) because it is a status label, not a message.
**Timeline (conditional).** Include only when the data exists **and** matters for this state. Otherwise omit the field. Never invent
dates or pad with empty labels. Three short labels: start, current, end: "Sent: Nov 22 · Delayed · Expected: Dec 3". With no dates,
"Paid · Flagged · Settled" (drop the prefixes). Abbreviate the month; the status word is a short fragment. In this app a real one is
the trash line "Deleted 3 days ago · 27 days left".
**Detail rows.** `label: value` pairs. Labels sentence case and concise ("Account number", "To", "Type"). Values follow section 2
(masked numbers, 2-decimal currency, correct dates). Never repeat the header or summary.
**Buttons.**
- **Verb + noun, strong verb first**: "Reconnect account", "Add your resume", "Sync now", "Open application". Primary = the resolving
  action. Secondary = defer or dismiss ("Done", "Not now", "Dismiss"). **Two buttons max per card.**
- **Prefer a self-resolution action**: re-enter, review, reconnect, unlock, paste, add, verify. Reach for a human only when nothing
  self-serve exists.
- **Be specific.** "Try again", "Check this", "Resolve this", "Take action" are banned filler. Name the step and where it happens
  ("Re-enter your key", "Paste the job description"); button and summary describe the same step. In this app "Try again" is kept only
  where it literally repeats the thing that just failed or was just made: the Review step's "Try again" (asks in place first if the
  person edited) and the crash screen in `App.tsx`. Never as a second button on a message.
- **"Contact us" is a last resort**, never a default second button. Here it never appears; with no self-serve step, the secondary is
  "Done", "Not now" or "Dismiss".
- **Contacting an outside party differs.** "Contact RBC" can be the primary when only that party can fix it. The analogue here is "Open
  Anthropic console" for a key or credit problem.
- Yes/no pairs need no verb ("This was me" / "This wasn't me"). "View" opens or reveals ("View details"), not "See". Keep labels short;
  they sit side by side.

**Drop-in JSON** (`snake_case` keys, sentence-case values; the schema is open, new fields are fine if they keep that style; include
only the fields used; unknown values are `{placeholders}`, never an invented number or date):

```json
{ "variant": "summarized | detailed", "header": "1 line", "summary": "2 lines max",
  "timeline": { "start": "Sent: Nov 22", "current": "Delayed", "end": "Expected: Dec 3" },
  "details": [ { "label": "Account number", "value": "∙∙∙4321" } ],
  "buttons": { "primary": "Contact RBC", "secondary": "Done" } }
```

### Worked example A: generate (this app's Setup card)
Request: show how far setup is and the next step. Real card (`components/setup/SetupCard.tsx`):

```
Finish setting up · 2 of 4
Next: add your resume
[ Continue ]  [ Dismiss ]
```

Check: one-line header (26 characters), no timeline (no real date), two buttons, primary is the forward action, secondary is quiet.
"Dismiss" is stored in the database, so the card stays gone after a reload.

### Worked example B: review
**Example (invented)**: header "Sync Paused!!", summary "Your sync has been paused. Your Gmail sync is paused and you need to reconnect
it using the settings page." Blocker, header: sentence case, drop "!!", lead with the identifying detail ("Sync from Gmail is paused").
Blocker, summary: too long and repeats the header; use the action ("Reconnect your account to keep syncing."). Fixed card: header "Sync
from Gmail is paused", summary as above, buttons "Reconnect account" / "Not now".

### Review severities
- **Blocker:** header on 2 lines or summary past 2 lines; wrong term; unmasked number; "!" on a problem; hyphen instead of en dash on a
  negative; raw code or jargon shown; a made-up cause.
- **Suggestion:** header past ~35 or summary past ~70; "Contact us" where a self-serve step or "Done" fits; vague or weak verb; header
  not leading with key info; summary repeats header.
- **Good:** say briefly what already works. Keep each finding to a line or two: what, which rule, the fix. Show corrected copy, never
  rewrite silently.

**Compliance and legal.** Do not assert guarantees (a resolution time, an outcome) or product claims in copy. Flag them for a human to
approve.

## 5. Backend-reason fallback (when a message is built from a reason)

A summary is often built from a "reason" supplied by code (an `AiErrorCode`, an HTTP status, a provider error, a sync `lastError`). It
is usually engineer-facing. Never show a raw reason without grading it.

| Tier | The reason is | Do | Real case |
|---|---|---|---|
| 1. Specific and clear | Real information a person understands | Paraphrase into plain voice | Provider says no credit: "Your Anthropic account needs credit." (`needsCredit`) |
| 2. Specific but technical | Real information in jargon, an enum or a code | Translate to plain language. Never show the raw token | 401 becomes "That key was refused. Check it in Settings." (`badKey`); 429 becomes "Too many requests right now. Try again in a minute." (`rateLimited`) |
| 3. Vague, empty or cryptic | "error", "unknown", a bare code, nothing | **Drop it.** Use a state-level sentence that stays honest and keeps the next action. Do not invent a cause | "That came back in a shape the app can't read. Try again." (`badReply`) |
**Two hard rules.**
1. **Never fabricate a cause.** If you do not know why, do not imply a reason ("blocked because of your network"). A made-up cause is a
   trust problem. Stay at the state level.
2. **Always keep an action**, specific and self-serve where possible, even with no usable reason. Avoid vague filler. **If the real
   recovery step is not known, ask the owner for it; do not invent a generic one.** Never default to "Contact us". Escalate to an
   outside party only when only they can fix it. If state and action will not both fit on two lines, keep the action.
**State-level fallbacks (Tier 3).**
| State | Fallback sentence | In this app |
|---|---|---|
| Delayed or slow | "That's taking longer than expected. {specific step}." | "That took too long. Try again." (`timeout`) |
| Flagged or refused | "{Service} declined to answer that." then the step | "Anthropic declined to answer that." (`refused`) |
| Failed | "This didn't go through. {Specific recovery step}." | "Couldn't save the key in this browser." (`vault.ts`, no step exists) |
| In progress | "{Thing} is on the way." Usually needs no reason | "Reading the company and role" |

When you fall back, say so in the PR or commit note ("the provider reason was too vague to show, so this uses the failed-state
sentence").

## 6. App-specific voice rules (what the code does)
### 6.1 Minimal copy
- No intro paragraphs, explainers or how-it-works text. The control and its label carry the meaning.
- If the person can already see it, do not say it. A tick plus "Added" needs no sentence.
- One short help line is the ceiling, in the muted `.help` or `.small muted` style, only where a mistake costs the person something.
- Show data the way the source shows it: sender, subject and company as they arrive.
- Show the plain state, not a sentence about it: "Synced 3 minutes ago", "Not synced yet", "2 of 4 done".
### 6.2 Errors: what happened, then what to do
Two short sentences at most. Say what the person can change.
- Blame the thing, not the person: "That key was refused. Check it in Settings." not "You entered a bad key." Use "That" for the thing
  they just did or gave ("That passphrase didn't unlock your key.").
- Name the limit with its number ("Add up to 50 links at a time. You pasted 63." is **Example**; the app's form is `Enter a whole
  number from 1 to 50.` in `sync/goal.ts`). Give the fix shape when a format is needed (the year-month-day sentence in section 2).
- Errors never hold, print or hint at a key or a secret. `ai/errors.ts` stays link-free; the screen that shows one adds the gate link
  (6.3).
- Anything thrown as `ActionError` is shown as written (`useAction`, `Notice tone="err"`), so every `ActionError` message must be safe,
  plain and finished. A technical message is never an `ActionError`.
- Disappeared things: say what, not why. Log the detail to the console and show a sentence: `console.error(e); report.say("err",
  "Couldn't skip this step. Try again.")`.
- **Announcing.** `Notice` (`components/Notice.tsx`): `tone="err"` renders `role="alert"` (read out at once), every other tone
  `role="status"`. A notice is a live region, so render it with its message already inside. Quiet confirmations that have no box use
  `report.announce(...)` (a screen-reader-only line). Errors beside a field use `role="alert"` directly.
### 6.3 Gate sentences with a link
A gate is the one sentence shown where a feature cannot run yet: what is missing, linked to where it is fixed. Defined once in
`web/src/app/gates.ts` as `GATES[key]`, rendered by `components/Gate.tsx`. Never hand-write a gate sentence on a screen (commit
`6d60ec3` replaced five hand-written ones).

| Key | Sentence | Link |
|---|---|---|
| `mailbox` | "Connect your mailbox in Settings." | `#/settings/mail` |
| `resume` | "Add your resume first." | `#/resume` |
| `aiKey` | "Add your Anthropic key in Settings." | `#/settings/ai` |
| `aiLocked` | "Unlock your key to use AI." | none (field is on the same screen) |
| `posting` | "Paste the job description first." | none (field is on the same screen) |

Plus `DRAFT_NEEDS_MAILBOX`, "Connect your mailbox to draft this in Gmail or Outlook." (muted line where a Draft button would be; links
to the Mail tab; says nothing in the demo build).

Rules: one sentence, starts with the verb for the missing step, ends with a full stop. The link text is the place or action in the
sentence, never "Click here". Gate wording matches the button wording elsewhere ("Add your resume" button, "Add your resume first."
gate). New gate: add a `GateKey`.
### 6.4 Buttons named by outcome
- Name what happens, not the mechanism: "Save application", not "Submit"; "Write my resume and letter", not "Generate"; "Sync now", not
  "Refresh".
- Verb + noun: "Connect Gmail", "Reconnect account", "Add your resume", "Open application", "Print resume", "Tailor another job",
  "Draft letter in Gmail".
- A destructive verb says so: "Delete application", "Delete now", "Replace and save", "Replace my edits", "Discard edits". Never "OK",
  "Yes" or "Confirm" for a destructive step.
- The same action in two places (Setup tab and its own tab) uses the same label.
- Count or target in the label only to tell similar buttons apart (an `aria-label` may add it: "Reconnect account Gmail a@b.com").
- The primary is the one that moves the person forward; at most one `primary` per row or card.
- Not every button is outcome-named yet: the Resume page's action bar uses a bare "Download" and "Save" (the line beside them says
  where Save goes), and its AI button reads "Write with AI". There is no "Next" or "Back" on the page any more. Treat the bare verbs as
  accepted, not as a model for new buttons.
### 6.5 "Not now", "Skip", "Dismiss", "Undo"
Verified in code:
- **Not now**: a decision that comes back, nothing permanent. Used on the local-data offer (`LocalDataOffer.tsx`; hidden until the
  session ends) and on the optional AI key row. Choosing it on a Setup row counts the step done by choice until "Show skipped steps
  again".
- **Skip**: a step the person chooses not to do; say what they do instead ("Skip, I'll add applications by hand", mailbox row). Confirm
  in a status line: "Skipped. You can bring it back with Show skipped steps again." The reverse, "Show skipped steps again" (quiet
  button), confirms "Skipped steps are back."
- **Dismiss**: hides a notice or card with nothing to act on: the sync result, the login-mail notice, the local banner (until the tab
  closes), the Setup card (stored in the database), a flag in the resume check (`FlagList`). On an error notice in the trash host it is
  the only way out.
- **Undo**: reverses the last change right after it happens (bulk edit, quick stage, a taught mail rule). A deleted application offers
  **Restore** instead (8 seconds, then Recently deleted).
- **Cancel** abandons something the person started (a form, an `InlineConfirm`). Never use it for "Not now".
- Secondary skip and dismiss buttons are `quiet` or `muted`, never `primary`. When the Skip button disappears, focus moves to the row
  heading so a keyboard user is not lost.
### 6.6 Optional
- Mark an optional field "(optional)" in the label: "Role (optional)", "Job link (optional)", "Note (optional)". Required fields are
  unmarked; no asterisks.
- A whole optional step says so in its title and keeps the way out: "AI key (optional)" with "Not now". The word for a not-done step is
  "Not yet", not "Missing". The Setup card prefixes its next line "Optional:" for the key.
- Never apologize for something optional ("You can skip this if you want").
### 6.7 Empty states
- One sentence: what is missing, then the next step as a named button or link in the same words as the button. A different cause gets a
  different sentence.
- Real (`pages/applications/index.tsx`): nothing yet, `No applications yet. Choose "Add application", or finish setting up to find them
  in your email.` ("finish setting up" links to Settings; the demo build offers "load the demo data" instead). Filters hide everything:
  "No applications match these filters." with "Clear filters" above the table. Search in Tailor: "No applications match that search."
  Statistics: "No applications to chart for this filter."
- No illustrations, jokes or cheer ("Oops, nothing here"). Keep the table or list frame so the layout does not jump.
### 6.8 In-place confirms (`components/InlineConfirm.tsx`)
What it does: no browser dialog. It renders a `role="group"` named by its question, an optional muted help line, then a danger-styled
confirm button, optional extra children, and **Cancel**. Focus starts on Cancel, so a stray Enter never destroys. Escape closes it (not
while the action is running) and returns focus to the control that opened it. Both buttons are held while the action runs. What happens
after a confirm is the caller's: it removes the question and says what happened.
- Title: a question with the object. Help: one sentence with the consequence. Confirm repeats the verb.
- Real: "Replace what's saved for Gringotts?" / "It already has a tailored resume and a cover letter." / "Replace and save"
  (`StepAdd`). "Replace your edits?" / "Your draft will be replaced by a copy of your resume." / "Replace my edits" (`StepJob`). "Start
  over?" / "The job and the draft will be cleared. Nothing has been saved." / "Start over". "Leave without saving?" / "Text you typed
  on this page hasn't been saved." / "Discard changes".
- Afterwards use a short status line ("Saved to Gringotts"), not a modal.
- Soft delete says where it went: "Deleted Acme. It stays in Recently deleted for 30 days." Hard delete (Delete now, Empty recently
  deleted) always asks first.
### 6.9 Status and progress lines
- Present participle for work in progress, no ellipsis: "Reading the company and role".
- Past tense for done: "Filled from the link." "Skipped steps are back." "Saved to Gringotts".
- Setup rows: a state word ("Added", "Connected", "Linked", "Skipped", "Not yet", "Not available", and for the key "Locked" or
  "Unlocked") and one `unlocks` line saying what the step gives: "Finds your applications in your email." / "Starts every tailored
  resume and letter."
### 6.10 Privacy and key copy (`public/privacy.html`, key forms)
Same voice, more exact. Name the exact permission (`gmail.readonly`, `Mail.Read`), the place ("your browser's IndexedDB"), the time
("30 days") and the verb ("read-only", "erases"). Address the reader as "you" and the product as "the app" or "Job Tracker". Say what
the app can't do as plainly as what it can ("The app can't send, delete or change emails."). Sections lead with what the person wants
to know first: What it reads, What it stores, What leaves your device, Deleting your data. Unlike the rest of the app, this page is
allowed long, dense, list-style sentences, because each one is a fact the person may rely on; keep them literal and never promise
beyond what the code does.

## 7. Before and after

### Real rewrites from this app's history
| Before | After | Commit | Rule |
|---|---|---|---|
| `No applications yet. Sync your mailbox in Settings, or choose "Add application" to add one.` | `No applications yet. Choose "Add application", or finish setting up to find them in your email.` | `ea6a7dd` | Empty state: name the next step with the button's words |
| `No email account connected yet. Connect one in Settings to start syncing.` | `No email account connected yet. Connect your mailbox in Settings.` | `6d60ec3` | One gate sentence, shared |
| `Add your Anthropic key in Settings to convert with AI.` and `... to write with AI.` | `Add your Anthropic key in Settings.` | `6d60ec3` | One gate, no purpose clause repeated per screen |
| `Paste the job description to write with AI.` | `Paste the job description first.` | `6d60ec3` | Gate: verb first, one shape |
| button "Add your resume" (where a prerequisite was missing) | `Add your resume first.` (muted gate with link) | `6d60ec3` | A missing step is a gate, not a button |
| `Connect it in Settings.` after a declined login | the `mailbox` gate (`Connect your mailbox in Settings.`) | `6d60ec3` | Gate wording is the only wording |
| `Reconnect to sync your mailbox.` (plain) | same words, whole sentence linked to Settings, Mail | `c0755be` | The link is the sentence, not "click here" |
| `Next: add your Anthropic key` | `Optional: add your Anthropic key` | `c0755be` | Optional says so (6.6) |
| Mailbox row "Connected" in the demo | "Not available" with `This demo can't connect mail.` | `c0755be` | Don't claim what is not true |
| "Set up mail sync" / "Set up · Job Tracker" | "Site setup (for the site owner)" | `ea6a7dd` | One name wherever it is linked |

### Examples (invented) that follow the real strings in `ai/errors.ts`
| Before (Example) | After (real string) | Rule |
|---|---|---|
| Error: INVALID_API_KEY (401) | That key was refused. Check it in Settings. | Tier 2: translate the code, keep an action |
| Rate limit exceeded: 429 Too Many Requests | Too many requests right now. Try again in a minute. | Tier 2: no raw token, give a time |
| You have entered an invalid passphrase! | That passphrase didn't unlock your key. | Blame the thing; no "!" on a problem |
| Something went wrong. | That took too long. Try again. | Name the state; "Try again" only when it is the real step |
| The date entered is invalid. | Enter the date as year-month-day, for example 2026-10-21. | Give the format and an example |
| Cancel (on an offer to copy local data) | Not now | Cancel abandons a task; Not now defers a decision |
| Your Sync Is Paused!! | Sync from Gmail is paused | Sentence case, no "!", lead with the identifying detail |
| Header "Transaction Declined", button "Try again" | "–$30.00 from Spotify declined", button "Re-enter your card number" | Specific step; en dash on a negative |
| "We are unable to process your request due to an unusual location." | "This didn't go through. Confirm your address to continue." | Never invent a cause |
| Button pair "Contact us" / "Close" | "Reconnect account" / "Not now" | Self-serve first |

Note: the crash screen in `App.tsx` still reads "Something went wrong. Reload the page." because the app cannot know the cause; it
keeps an action (reload) and offers "Try again". That is Tier 3 working as designed, not a violation.

## 8. Copy checklist (run before shipping a screen)

- [ ] Voice: a person talking to a person; no jargon, codes or enum names; you/your (person-said buttons excepted); contractions; Canadian spelling; no emoji.
- [ ] Tone: problem copy has no joke, no "!", no blame; good news has at most one "!".
- [ ] Minimal: no intro paragraph or explainer; one help line at most.
- [ ] Every error says what happened and what to do; no fabricated cause; backend reasons graded and translated.
- [ ] A missing prerequisite uses a `GATES` entry. An empty state names the next step with the button's word.
- [ ] Destructive actions use `InlineConfirm`: a question, a consequence line, an outcome-named button.
- [ ] Buttons: verb + noun, named by outcome; no "Submit", "OK", "Yes", "Resolve this", "Take action"; "Try again" only where it repeats what just failed.
- [ ] Two buttons max per card, one primary. Secondary is "Done", "Not now", "Dismiss" or "Skip, I'll ..."; never "Cancel" for a deferral. No "Contact us".
- [ ] Optional fields say "(optional)"; required ones are unmarked.
- [ ] Sentence case except named places and brands. No end punctuation on headers, buttons, labels (a real question excepted); sentences end with a full stop.
- [ ] Header one line (about 35 characters), summary two lines (about 70), checked at phone width.
- [ ] Money numerals, 2 decimals in rows, en dash for negatives, "about $x" for estimates. Dates full when there is room, month-only abbreviation when tight, no ordinals, "1:00 pm ET". Numbers with commas; limits state their number.
- [ ] Secrets masked ("Key ending in ••••1234"); account numbers "∙∙∙" plus last 4.
- [ ] Glossary exact: application, stage, resume, Mailbox, key, passphrase, log in / login, Recently deleted, Needs review.
- [ ] Errors use `Notice tone="err"` (`role="alert"`); others `role="status"` or `report.announce`; focus lands somewhere sensible when a button disappears.
- [ ] Nothing in a message holds a key, passphrase or token. No guarantees, time promises or legal claims without human sign-off. Privacy copy matches what the code does.
