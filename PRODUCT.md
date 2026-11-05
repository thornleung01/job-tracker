# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
One person running a job search, on their own Windows PC, plus a few invited people using the hosted edition in their own browser. They open the app daily or weekly to see where each application stands (applied, heard back, assessment, interview, offer, rejected), log notes and steps, and read the Flow chart. They also show it to other people (screenshots, demos), so it has to hold up as a presentation piece as well as a daily tool.

## Product Purpose
A local, private job-application tracker. It reads Gmail and Outlook (read-only by default; sending a reply is an opt-in permission per account, used only when the user writes and sends one), recognises application emails with editable rules (no AI), and turns them into a list of applications with a stage, a history, and a Sankey flow of where applications went. Success is that the user never has to search an inbox to know the status of an application.

## Positioning
Everything comes from the user's own email and stays on their own device (their PC, or their browser's storage in the hosted edition): no account with us, no cloud copy, no AI reading the mail. Signing in with Google or Microsoft only identifies the user and grants read access to their own mailbox. Each application's history is the real emails behind it, and every email can be opened.

## Operating Context
Two editions share one visual system (see DESIGN.md).
- **Local edition** (`jobtracker/`): FastAPI + SQLite + server-rendered Jinja templates, no JavaScript framework, bound to 127.0.0.1. Reads mail with desktop-app OAuth clients; tokens are encrypted on the PC. Syncs from the CLI or a scheduled task.
- **Hosted edition** (`web/`, in progress): a static TypeScript app served from GitHub Pages at https://thornleung01.github.io/job-tracker/. There is no server. Sign-in is Google or Microsoft OAuth in the browser (Microsoft: authorization code + PKCE; Google: Identity Services token client, with the access token checked with Google to learn who logged in), mail is read directly from Gmail and Microsoft Graph, and all data stays in IndexedDB on the user's device, namespaced per signed-in user. One click on Continue with Google or Continue with Microsoft logs in and connects the mailbox together, and the first sync starts by itself. Access tokens live in memory only, so after a reload the user logs in again. Sync happens while the app is open; there is no background sync. Access is limited to people on the Google Cloud consent screen's test-user list (an in-app allowlist would be cosmetic, since nobody can see anyone else's data).

Used on desktop mostly, sometimes on a phone-width window. The local edition works offline (no CDNs), so any typeface must be served from the project; the hosted edition bundles its assets the same way.

## Capabilities and Constraints
- Pages: Applications (sortable, filterable list; rows expand in place to log notes and dated steps and to read emails; a "Coming up" list of interviews in the next week, a follow-up nudge for applications gone quiet for 7 days, an optional Rounds column, and selecting several rows to set a stage or delete), Flow (Sankey chart with a table equivalent), Needs review (emails the rules were unsure about), Application detail (with offer salary and decision deadline at the Offer stage), Settings (accounts and sync, appearance, and your data: export JSON or CSV, import; deliberately kept simple, with no email-filter rules).
- Appearance settings are user-facing and must keep working: theme (system/light/dark), accent color, density (comfortable/compact), corners (soft/sharp), list columns, default Flow period.
- Local edition: behavior, copy facts, URLs, form names, and data are not changing; the Wealthsimple restyle is visual only.
- Hosted edition v1 covers Applications, Flow, People, Needs review and Settings. Replying from the app, the Jobs tab (resume parsing, Adzuna, Windows pop-ups), multiple profiles and scheduled background sync are not in it. Coming up, follow-up nudges, offer details, selecting several rows, the duplicate warning, the Rounds column and CSV export are hosted-edition only. The local edition is unchanged.
- Hosted edition sign-in and setup: one-click login that also connects the mailbox (people can decline mail and log in without it); a guided setup page at `#/setup` where the owner follows numbered console steps, pastes the two app IDs and commits a generated `web/site-config.json` (the IDs are public by design; a build-time environment value still overrides the file); a copyable invite message for test users; and an offer, never automatic, to bring applications saved in demo mode in this browser into the account, with the earlier copy removed only on request.
- No em-dashes in UI copy.

## Brand Commitments
- Visual direction is pinned by the user: **Wealthsimple's styling**, taken from the `use-ws-styling` prototype primer (light grey ground, raised near-white cards at 20px, pill buttons with glass gradients on Primary, Lucide icons, one sans typeface, sentence case, no uppercase, no underlined links, no tabular numbers).
- The app keeps its own name, "Job Tracker". It does not use Wealthsimple's name, logo or wordmark. Wealthsimple Sans Display is proprietary and is not shipped: the stylesheet names it first so a device that has it uses it, and the self-hosted Figtree covers every other device.

## Evidence on Hand
The styling comes from the `use-ws-styling` primer in the `product-design` plugin: a hand-distilled approximation that names tokens and approximate values, not the real design system or a spec. It replaces an earlier warm serif look that was read from unofficial third-party references. Where this app departs from the primer, DESIGN.md says so (for example the slightly stronger inactive background, and the emoji status icons the user asked for). No imagery assets exist.

## Product Principles
1. Facts first: a status, a date, and a source email are always one click apart.
2. Calm over clever: the user checks this while anxious about outcomes; nothing should shout.
3. Private by construction: mail is read only by the user's own device (a local server on their PC, or their browser), read-only unless the user turns replying on, with no server of ours in the path and no external services beyond Google, Microsoft and the sources the user adds.
4. Everything is reversible and visible: filters show, manual stages say they were set by the user.

## Accessibility & Inclusion
WCAG AA contrast in light and dark, visible keyboard focus, color never the only signal, full keyboard operation, text that follows browser text size, 44px touch targets on touch screens.
