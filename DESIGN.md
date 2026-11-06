---
name: Job Tracker
description: A calm, Wealthsimple-styled ledger for a personal job search; black and white on light grey, raised pill controls, 20px cards, one sans typeface.
colors:
  background: "#f2f2f2"
  surface: "#fafafa"
  surface-hover: "#ffffff"
  surface-secondary: "#ebebeb"
  inactive-bg: "rgba(0,0,0,0.05)"
  hover-bg: "rgba(0,0,0,0.04)"
  text-primary: "#000000"
  text-secondary: "rgba(0,0,0,0.55)"
  outline: "rgba(0,0,0,0.08)"
  field-line: "#8c8c8c"
  accent-graphite: "#000000"
  accent-bronze: "#5c4b24"
  accent-forest: "#2f5d46"
  accent-clay: "#8f4a32"
  accent-ink: "#ffffff"
  stage-applied: "#5b88d9"
  stage-applied-text: "#2b5fbb"
  stage-heard-back: "#b27ee4"
  stage-heard-back-text: "#8634d4"
  stage-assessment: "#e47eca"
  stage-assessment-text: "#ae248b"
  stage-interview: "#eece2d"
  stage-interview-text: "#736109"
  stage-offer: "#409652"
  stage-offer-text: "#2f6e3c"
  stage-rejected: "#e22b18"
  stage-rejected-text: "#be2414"
  dark-background: "#000000"
  dark-surface: "#171717"
  dark-surface-hover: "#1f1f1f"
  dark-surface-secondary: "#0f0f0f"
  dark-inactive-bg: "rgba(255,255,255,0.07)"
  dark-stage-offer: "#4db565"
  dark-stage-rejected: "#ed4f3c"
  dark-stage-applied-text: "#7198de"
  dark-stage-heard-back-text: "#b482e5"
  dark-stage-assessment-text: "#e47eca"
  dark-stage-interview-text: "#eece2d"
  dark-stage-offer-text: "#4db565"
  dark-stage-rejected-text: "#f07161"
  dark-text-primary: "#ffffff"
  dark-text-secondary: "rgba(255,255,255,0.5)"
  dark-outline: "rgba(255,255,255,0.12)"
  dark-field-line: "#8a8a8a"
  dark-accent-graphite: "#ffffff"
  dark-accent-bronze: "#d9c28a"
  dark-accent-forest: "#8cc7a6"
  dark-accent-clay: "#e0a184"
  dark-accent-ink: "#000000"
  data-viz-01: "#5b88d9"
  data-viz-02: "#b27ee4"
  data-viz-03: "#e47eca"
  data-viz-04: "#eece2d"
  data-viz-good: "#409652"
  data-viz-crit: "#e22b18"
  data-viz-neutral: "#8c8c8c"
typography:
  display:
    fontFamily: "Wealthsimple Sans Display, Figtree, -apple-system, SF Pro Display, system-ui, sans-serif"
    fontSize: "clamp(2rem, 4vw, 2.5rem)"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.8px"
  brand:
    fontFamily: "Wealthsimple Sans Display, Figtree, -apple-system, SF Pro Display, system-ui, sans-serif"
    fontSize: "1.5625rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.25px"
  section:
    fontFamily: "Wealthsimple Sans Display, Figtree, -apple-system, SF Pro Display, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "-0.2px"
  row:
    fontFamily: "Wealthsimple Sans Display, Figtree, -apple-system, SF Pro Display, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.4
  lede:
    fontFamily: "Wealthsimple Sans Display, Figtree, -apple-system, SF Pro Display, system-ui, sans-serif"
    fontSize: "clamp(1.25rem, 2.2vw, 1.5625rem)"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "-0.25px"
  body:
    fontFamily: "Wealthsimple Sans Display, Figtree, -apple-system, SF Pro Display, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.02px"
  small:
    fontFamily: "Wealthsimple Sans Display, Figtree, -apple-system, SF Pro Display, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Wealthsimple Sans Display, Figtree, -apple-system, SF Pro Display, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.18px"
rounded:
  pill: "999px"
  card: "20px"
  sm: "12px"
  segment: "8px"
  sharp: "3px"
spacing:
  gutter: "16px"
  pad: "16px"
  pad-compact: "12px"
  cell-y: "16px"
  cell-y-compact: "8px"
  gap: "24px"
  gap-compact: "12px"
  section: "32px"
  section-web: "64px"
  tap: "44px"
  tap-compact: "36px"
components:
  button-primary:
    backgroundColor: "linear-gradient(180deg, {colors.accent-graphite}, 16% toward white)"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-hover}"
  button-tertiary:
    backgroundColor: "linear-gradient(180deg, rgba(0,0,0,0.04), rgba(0,0,0,0.07))"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.pill}"
  badge:
    backgroundColor: "{colors.inactive-bg}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.pill}"
    padding: "3px 12px"
    typography: "{typography.label}"
  stage-badge:
    backgroundColor: "transparent"
    textColor: "{colors.stage-interview-text}"
    rounded: "{rounded.pill}"
    padding: "0"
    typography: "{typography.small}"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.segment}"
    padding: "0 16px"
    height: "44px"
  tab-current:
    backgroundColor: "{colors.inactive-bg}"
    textColor: "{colors.text-primary}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "16px"
  notice:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "14px 20px"
  panel:
    backgroundColor: "{colors.surface-secondary}"
---

# Design System: Job Tracker

## Overview

**Creative North Star: "The Quiet Ledger"**

Job Tracker follows the Wealthsimple prototype styling reference (the `use-ws-styling` primer in the `product-design` plugin). It is a hand-distilled approximation, not the real design system, which this local app cannot load. The app speaks in plain sentences and one sans typeface: black on a light grey ground, raised cards and pill controls, hairline separators inside cards, and nothing that shouts. It is still a calm place for an anxious moment, and it avoids the dashboard-widget look of metric-card grids.

Depth comes from raised surfaces. A card, a secondary button and a popup each carry a white inner stroke, a 5% outer stroke and a soft drop shadow. Primary buttons are dark glass: a gradient fill with an inner top highlight, an inner bottom shadow and a drop shadow. Color is rationed: the one stage colour map (six stage dots and words, also the Flow chart), and one user-selectable accent (black by default) that fills primary buttons and the active mobile sort chip.

The user owns the finish. Theme (system/light/dark), accent (graphite, bronze, forest, clay), density (comfortable/compact) and corners (soft/sharp) are settings, written onto `<html>` as `data-theme`, `data-density`, `data-corners`, `data-accent` and the `--accent-l` / `--accent-d` variables. Every new surface must survive all combinations.

**Key Characteristics:**
- Light grey ground (#f2f2f2), near-white raised surfaces, true black text; dark theme is pure black with #171717 surfaces.
- One sans typeface for everything. Weights 400, 500 and 700 only.
- Pills for every control; 20px raised cards with 16px padding.
- 16px page gutter at every width; 32px between sections on a phone and 64px on the web.
- Lucide icons only, 24px or 16px, drawn as CSS masks so they take the text color.
- Sentence case, never uppercase; no underlined links; no tabular numbers.
- WCAG AA in both themes; controls are 44px tall by default (36px in compact density on a mouse, 44px again on touch screens).

## Colors

Values below are the light theme with the dark counterpart in the frontmatter (`dark-*`). Token names in the CSS: `--bg`, `--surface`, `--surface-hover`, `--linen` (secondary surface), `--fog` (inactive-bg), `--hover`, `--ink`, `--muted`, `--line` (outline), `--field-line`.

### Primary
- **Graphite Accent** (#000000 light, #ffffff dark): the default accent. Fills primary buttons, the count badge in the nav and the active mobile sort chip. Text on it is `accent-ink` (#ffffff light, #000000 dark).
- **Bronze** (#5c4b24 / #d9c28a), **Forest** (#2f5d46 / #8cc7a6), **Clay** (#8f4a32 / #e0a184): alternative accents the user may pick in Settings. They replace only `--accent`; text, outlines and badges stay neutral.

### Neutral
- **Background** (#f2f2f2 / #000000): page background.
- **Surface** (#fafafa / #171717): cards, inputs, popups, secondary buttons. Hover is #ffffff / #1f1f1f.
- **Surface secondary** (#ebebeb / #0f0f0f): open table rows and their expansion panel.
- **Inactive bg** (rgba(0,0,0,.05) / rgba(255,255,255,.07)): badges, chips, the current tab, hover-pressed rows. The reference says 3%; it is held slightly higher so badges and the current tab stay visible on #f2f2f2.
- **Hover bg** (rgba(0,0,0,.04) / rgba(255,255,255,.04)): row, tab and menu-item hover.
- **Text primary** (#000000 / #ffffff). **Text secondary** (55% black / 50% white): help text, placeholders, chevrons.
- **Outline** (8% black / 12% white): decorative dividers only.
- **Field line** (#8c8c8c / #8a8a8a): borders of inputs and notices; held to 3:1 against the surface, which Outline is not.

### Stage colours (one map, used by the list, the detail page and Statistics)
Each of the six stages has a graphic colour and a text colour, both defined once in the shared stylesheet as `--stage-applied`, `--stage-heard-back`, `--stage-assessment`, `--stage-interview`, `--stage-offer`, `--stage-rejected` and the same names with `-text`. The graphic colour fills the dot beside the stage word, the chart nodes and links on Statistics. The text colour is the same hue pulled darker (light theme) or lighter (dark theme) until it holds 4.5:1 on the page surface and on the tinted rows behind it (open row, hover, badge tint). Short aliases `--applied`, `--heard`, `--assess`, `--interview`, `--offer`, `--rejected` point at the text colours for other text uses (danger buttons, error notices, sync status). Rejected doubles as the danger and error color.

| Stage | Graphic light / dark | Text light / dark |
| --- | --- | --- |
| Applied | #5b88d9 / #5b88d9 | #2b5fbb / #7198de |
| Heard back | #b27ee4 / #b27ee4 | #8634d4 / #b482e5 |
| Assessment | #e47eca / #e47eca | #ae248b / #e47eca |
| Interview | #eece2d / #eece2d | #736109 / #eece2d |
| Offer | #409652 / #4db565 | #2f6e3c / #4db565 |
| Rejected | #e22b18 / #ed4f3c | #be2414 / #f07161 |

The graphics are the Wealthsimple data-viz hues in numeric order (blue, purple, pink, yellow) plus data-viz green and the negative red. In the light theme purple, pink and yellow sit under 3:1 on the page surface (2.9, 2.5 and 1.5), so the dot carries a hairline in the text colour, and the stage word beside it is always present: colour is never the only signal.

### Statistics charts (scoped to the Statistics page's chart root)
- Stages, Offer and Rejected take their fills from the stage map above, so a stage is the same colour on the list and in the chart. Only the no-outcome-yet grey is the chart's own: #8c8c8c / #8a8a8a. Links draw at 0.38 opacity (0.1 dimmed, 0.72 highlighted). Node bars have a 2px corner radius.
- The other charts on the page (pace, speed, reply rate by month) follow the same rules: one axis, recessive hairline gridlines at a few round values, 12px axis text in the secondary ink and never in a series colour, thin marks with a 4px rounded data end, and no number on every mark. Colour follows the thing measured: applications use Applied, replies use Heard back. Past weeks are the chart grey and the current week takes the accent (emphasis form). A month that isn't final is a 45 degree hatch in its own colour, with the words "Still coming in", so colour is never the only signal. Each chart is drawn in a small coordinate space and capped at about 1.25 times its width (`max-width` in `statistics.css`) so its text stays near its normal size on a wide screen and shrinks to fit on a phone.
- Every chart sits in `ChartFrame`: a heading, one line of note at most, the chart, a tooltip (a tap pins it on a phone), arrow keys between marks with one tab stop, and a Table view. The headline numbers are plain text with no boxes: a 2rem/500 value, a label and one line of context.

### Named Rules
**The One Voice Rule.** Chroma is reserved for status, the data-viz palette and the single chosen accent. A surface with a new color needs a new status to justify it.
**The Outline Contrast Rule.** Decorative dividers use Outline; anything a user must see to operate (inputs, notices, swatch rings) uses Field line.

## Typography

**Font:** `"Wealthsimple Sans Display", Figtree, -apple-system, "SF Pro Display", system-ui, sans-serif`. Wealthsimple Sans Display is proprietary and is not shipped; it is named first so a device that has it installed uses it. Figtree (self-hosted variable woff2, SIL OFL, in `/static/fonts` for the local edition and `web/src/assets/fonts` for the hosted one) is the stand-in everywhere else, so the app works offline.
**Mono:** system monospace, only for code and addresses in setup instructions.

### Hierarchy
- **Display** (500, clamp(2rem, 4vw, 2.5rem), 1.2, -0.8px): the page headline, one per page.
- **Brand** (700, 1.5625rem, 1.2): the wordmark in the header.
- **Section** (500, 1.25rem, 1.4): section headings. Panel sub-headings are 1rem/500.
- **Row** (500, 1rem, 1.4): company names in list rows, people names.
- **Lede** (400, clamp(1.25rem, 2.2vw, 1.5625rem), 1.4, max 46ch): the Statistics page sentence summary.
- **Body** (400, 1rem, 1.4, 0.02px; 0.9375rem in compact density). Buttons are 500. Email text is 0.9375rem/1.7 for reading.
- **Small** (400, 0.875rem): dates, role sub-line, help text, table headers (500, muted).
- **Label** (500, 0.75rem, 0.18px): tags and the jobs score pill. The stage badge is the exception: 0.875rem/500, because the stage is what each row is for.

### Named Rules
**The Rem Rule.** All sizes are rem so browser text-size settings are honoured; the one exception is the 16px floor on phone inputs to stop iOS focus zoom.
**The Sentence Case Rule.** No `text-transform: uppercase`, no small caps, no all-caps strings. Acronyms such as RRSP or ETF are the only exception.
**The Plain Figures Rule.** No `font-variant-numeric: tabular-nums`, anywhere. Links are never underlined; interactivity shows through color and tone.

## Layout

Single column, max-width 1120px, centered, padding 40px 16px 96px. The 16px gutter is the same on every screen size; breathing room comes from section spacing and card padding, not a wider margin. Header is a flex row (wordmark left, nav right: Jobs, Applications, People, Statistics, Needs review, then a Settings gear icon; the hosted header has no Jobs link, and instead reads Applications, People, Resume, Statistics, Needs review, then the gear; the local edition's nav is unchanged and has no Resume). At 520px and below the gear moves into the title row and the five words stay on one row below it, with "Needs review" shown as "Review" (`.nav-short` and `.nav-full` in `base.css`; the link's accessible name stays "Needs review"). Card padding `--pad` 16px, table cell vertical padding `--cell-y` 16px, vertical gap `--gap` 24px, and `--section` between cards 32px (64px from 721px up).

Compact density tightens these to 12px / 8px / 12px (section 24px, 40px on the web), drops body to 0.9375rem and tap to 36px. On touch (`pointer: coarse`) the tap target is 44px in every density. At 720px and below each table row becomes a stacked block: company and role on the left, stage (word and dot) on the right, last activity on its own line; column headers become a row of pill sort buttons with the active sort filled in the accent. Role, Applied, Emails, Rounds and Resume columns hide there. The checkbox column stays as a narrow first column of each card. Panels use a two-column form grid (gap 32px) that collapses to one column at 720px.

## Elevation & Depth

Raised surfaces, defined by strokes plus one soft shadow. `--raise` is `inset 0 0 0 1px #fff, 0 0 0 1px rgba(0,0,0,.05), 0 4px 12px rgba(0,0,0,.08)`; the secondary button uses a 0.10 shadow. The outer stroke is a non-inset spread so it never shrinks the corner radius. In dark theme the strokes become white at 5% and 8% over a 0.5 black shadow. Primary buttons add an inner top highlight and inner bottom shadow over the gradient. Popups (dropdown list, search suggestions, chart tooltip) use the same raised surface. Layers: tooltip `--z-tip: 20`, popup `--z-pop: 30`, skip link `--z-skip: 100`.

### Named Rules
**The Press Rule.** Standalone controls (buttons, action pills) scale to 0.97 on press. Anything inside a container (table rows, tabs, segmented options, menu items) signals press with a background tone change, never a scale.
**The Honest Hover Rule.** Hover and pointer cursors belong only to things that do something. Static cards stay at rest.

## Shapes

Round and soft by default: pills (999px) for buttons, inputs, badges, chips and nav links; 20px for cards; 12px for notices and textareas; 8px for the Minimal segmented indicator (the filter tabs). The "sharp" corners setting collapses all four radii to 3px, so every component must take its radius from the tokens, never a literal. Icons are Lucide, drawn as CSS masks in `currentColor` at 16px with stroke 3 (rendering 2px): the list and disclosure chevron, the sort arrows, the dropdown chevron and check, and the notice info and alert icons. The Settings gear is an inline Lucide `settings` at 24px, stroke 2. Never hand-draw an icon path. A semi-opaque color is never applied to a multi-path icon; mask icons are a single flat fill, so they may use text-secondary.

## Components

### Buttons
- **Shape:** pill, min-height `--tap`, padding 0 24px, 500 1rem, `border: none` (the user-agent border is always reset).
- **Primary:** gradient from the accent to 16% toward white (12% toward black in dark), inner highlight, inner shadow and a drop shadow, accent-ink text. Hover mixes both gradient stops 14% toward the ground.
- **Secondary (default):** surface fill with the raised strokes and shadow; hover is Surface hover. Danger variant uses Rejected text.
- **Tertiary:** 4% to 7% black gradient, no shadow. Used for "Delete" on history entries and for an open action disclosure.
- **States:** active scales to 0.97; disabled 50% opacity; busy shows progress cursor. Focus is a 2px ink outline at 3px offset, on every interactive element.

### Badges and chips
**Stage badge:** no pill. The stage word at 0.875rem/500 in its stage text colour, led by a 10px dot in its graphic colour (8px gap), drawn in CSS so the markup stays `badge Interview`. The word is always present, so colour is never the only signal. It stays compact enough for the phone row's top-right cell. **Plain badge** ("Open now") and the jobs score pill: tonal pill on Inactive bg, 0.75rem/500, 3px 12px; the score takes the Offer, Heard back or Applied text colour. Chips are the same fill at 0.875rem; tags are smaller pills in text-secondary (step and note tags in text primary).

### Filter tabs
The Minimal segmented control: no track, text-secondary at 400 weight, 8px-radius options at 44px with the count inline. The current tab gets the Inactive-bg indicator and text primary at 500, so it is distinguished by weight and fill, not color alone. Hover is the Hover bg; press is a slightly stronger tone, never a scale.

### Inputs
Pill, 1px Field line border, Surface fill, padding 0 20px; border shifts to ink on focus plus the outline. Textareas use the 12px radius. Labels are 0.875rem/500 text-secondary with a 4px inset. Checkboxes and radios take ink as accent-color. Dropdowns use the customizable-select popup (raised surface, pill options, Lucide check) where the browser supports it.

### Cards
The Primary card: Surface fill, raised strokes and shadow, no border, 20px radius, 16px padding. The list card holds the table with hairline row dividers; open rows tint Surface secondary and hovered rows use Hover bg. Don't nest a raised card in a raised card; group inside a card with dividers or a hairline box.

### Stacked phone row
Described in Layout: a two-column grid per application with the stage (dot and word) top-right and last activity beneath.

### Notices
Surface fill, 1px Field line border, 12px radius, 16px Lucide info icon (alert icon in the Rejected color for errors). Never a colored side-stripe.

### Expandable list panel
Clicking a company name (a 500 row label with a Lucide chevron) opens an in-place Surface-secondary panel under the row with a two-column form grid and a hairline-divided history list. The chevron rotates from 0 to 90 degrees over 0.16s; disclosures (`details`) reuse the same chevron.

### Settings controls
The Default segmented control (theme, density, corners): a pill track styled as a Primary card, with a grey pill indicator inset 4px inside it, selected option at 500 weight in text primary, the others in text-secondary. Accent swatches are raised pills with an 18px dot and a 2px ink ring when selected. The Settings page is split into one card per section (hosted: Email accounts, Sync, Appearance, Recently deleted, Your data, then Account once logged in; local: Profiles, Email accounts, Sync, Appearance), and the section links at the top (Email accounts, Sync, Appearance, Recently deleted, Your data), which jump to each of those cards, are Minimal segmented options. The reference calls for the indicator to animate between options; this app switches instantly because it has no script on that form.

### Jobs tab
Filter tabs (Matches, Notifications, Your profile, Sources) sit above a second row of view tabs (New, Saved, Applied, Dismissed, All) with counts. Matches are hairline-divided rows inside one card: a 500 title, a small tonal score pill, a muted "company · place · source" line, the match reasons in body ink, then pill actions. "I applied" is the one primary action; Dismiss is the quiet danger. The nav's Jobs link carries a count badge of new matches. On phones the actions wrap under the reasons.

### Hosted-edition patterns
- **One way to add.** A single secondary "Add application" button opens the form in place, between the filter card and the list. While it is open the form's Save is the one primary and Apply filters steps down.
- **One target per row.** A list row expands from its name or anywhere on the row; "Open full page" lives inside the expanded panel, never beside every name.
- **Demo banner.** A quiet one-line status row ("Demo mode: not logged in, data stays in this browser.") with text actions. It never carries a primary button, and "Load demo data" shows only while the database is empty.
- **Detail actions.** One stage select that applies on change, plus a "More" menu (merge, not an application, delete). Nothing uses a browser dialog. Delete and Not an application ask in place with the shared InlineConfirm (Delete says "You can restore it for 30 days" and puts the application in Recently deleted; "Delete for good, keep emails in Needs review" sits inside the same block) (and so do removing a person, deleting selected rows, and the three Your data actions that replace or erase everything): a tinted block under the control that opened it, with the danger button, Cancel, and focus starting on Cancel so a stray Enter never removes anything. Escape or Cancel closes it and returns focus to the opener. Merge asks in place with its own small form (a select and Merge applications); focus starts on the select, and Escape closes it and returns focus to the More button.
- **Paste a job link.** The link field sits at the top of the add form with a quiet "Fill in" button. Anything derived is a suggestion: guessed fields carry a muted "Guessed from the link" hint that clears when you edit, and nothing is saved until Save is pressed. Untrusted text from links, APIs and the bookmarklet is only ever rendered as text.
- **Quick edits.** In the applications list, role and applied date read as plain text and become a field when chosen: Enter or leaving the field saves, Escape restores, and focus goes back to the text. The stage is a coloured pill that is a real dropdown, with a quiet Undo for a few seconds after a change. Nothing shows an edit icon.
- **Interview rounds.** One line under the facts on the application page: "Interview rounds 3 · estimated from your emails", with a quiet "Edit rounds" button. The source note says whether the number is estimated, from logged steps, or set by you. A typed number always wins and is never rewritten by a sync.
- **Coming up.** A hairline-divided list above the filter tabs, no card and no visible heading: company, role and day ("Today", "Tomorrow", "Thu, Oct 15") on one row, each a link to the application. Seven days ahead, five rows at most, hidden while any filter is on and when there is nothing to show.
- **Quiet lines under the stage.** "Interview Thu, Oct 15" and "Decision by Oct 15" sit under the stage in small muted text. They are plain text, with no colour and no icon.
- **Follow-up.** "Follow up?" is a label-size tag on the Inactive bg, in text-secondary, beside the last activity. "Needs follow-up" is a plain checkbox in the filter card, applied with Apply filters like the rest.
- **Select several.** A checkbox column leads the list (the header box selects every row shown), and ticked rows tint with Inactive bg. While any are ticked a card appears between the filter card and the list with the count, a stage select with "Set stage", a danger "Delete" and "Clear selection". Delete asks in place, not in a browser dialog, and afterwards one notice says what happened and takes focus. Row clicks never tick. The box does.
- **Offer details.** On the application page, an "Offer" section with Salary and Decision deadline fields and a quiet "Save offer details". It shows at the Offer stage or once there are details.
- **Duplicate warning.** One muted sentence under the add form's fields with the application as a link. It informs and never blocks Save.
- **Export CSV.** A secondary button beside Export data in Settings, Your data.
- **Backup nudge.** A quiet one-line status row at the top of the Applications page, like the demo banner: muted 0.875rem text ("Your applications only live in this browser. Last backup: never."), then two text actions, "Export a backup" and "Remind me in a week". Never a card, never a primary button, never a dialog, and nothing waits on it. Focus moves to the page when it is snoozed so it isn't lost.
- **Your data, storage and backup file.** Under the card's intro, up to two muted help lines say whether the browser will keep the data and how much space it uses. A second row of secondary buttons ("Choose a backup file", "Back up now", "Choose a different file", "Stop using this file") shows only in a browser that can write to a file, with the file's name as a muted line above it.
- **Recently deleted.** After a delete, a Notice ("Deleted Acme. It stays in Recently deleted for 30 days.") with a small secondary Restore beside it for 8 seconds, in the same place whichever page you deleted from. In Settings it is its own card of hairline-divided rows: company, muted role, stage badge (a resume or cover letter row is a muted kind word and a dot, then its name in bold: "Resume · Resume for Acme, Analyst", "Cover letter · Acme, Analyst"), a muted "Deleted 3 days ago · 27 days left" line, then small Restore and a small danger "Delete now" (which asks in place; the result is a Notice above the rows that takes focus, since the row's button is gone). "Empty recently deleted" is the card's one danger button and also asks in place. The page of a deleted application says so and offers Restore as its one primary button.
- **Add to calendar.** Quiet small secondary buttons ("Add to calendar", "Download all upcoming interviews", "Download interviews (.ics)", "Download this month's interviews") that save a file and say "Calendar file saved." in a status line. No icon, no menu, and no promise of a time: the files hold all-day events.
- **Draft follow-up.** A small pill link, not a button, in the row of actions under an application (with the upcoming interview days and Add to calendar). It is the primary style only when the application needs a follow-up, and it says in its label that it opens a new tab. It is hidden when there is no mail account.
- **No reply tag.** "No reply in 30 days" is the same label-size tag as "Follow up?" (Inactive bg, text-secondary), and "No reply" is a plain checkbox beside "Needs follow-up" in the filter card. An application shows one tag or the other, never both.
- **Search note.** When a row matched on text other than its company or role, a muted "Matched in an email: ..." line sits under the company, with a short snippet as plain text.
- **Saved views.** "Save this view" is a quiet button on the Applications page, shown once the filters or sort differ from the plain list, that opens a one-field form. Saved views are pill chips (Inactive bg, 0.875rem/500) above the list, each a link with a small options button that opens Rename and Delete view in a Surface-secondary block under the chips. The chip for the current view is filled in ink. Deleting a view says so in a muted line under the chips ("Deleted the view \"Mine\".") and focus moves to the next chip's options button, or to that line when it was the last.
- **Weekly goal.** One muted sentence ("This week: 3 of 5 applications. Goal reached.") with a 6px pill bar in the accent on Inactive bg under it, and a quiet "Change goal" button. With no goal it is only a quiet "Set a weekly goal" button. No ring, no confetti, no colour change when it is met. The one button stays where it is when the goal is set or removed (only its words change), so focus stays on it, and a screen-reader-only line says "Weekly goal saved." or "Weekly goal removed."
- **Compare offers.** A card that is closed until opened: a 44px disclosure row with the Lucide chevron and a count, then a hairline-divided table (company as a link, role, salary as typed, decision deadline with the days left in muted text ("3 days left", "Today", "Passed yesterday"), stage date) that scrolls sideways on a phone. It stays as it was left for the rest of the session.
- **Calendar.** A List and Calendar pair of tabs on the Applications page (the same Minimal segmented control). The month is a seven-column grid in a hairline-bordered 20px box: weekday names in muted small text, each day a 44px-or-taller cell with its number, up to three event chips (Inactive bg, 0.75rem, a Lucide icon and the event word, never colour alone) and a muted "+2 more" for the rest. Today's number sits in a 2px ink ring, the chosen day has a 2px ink inset ring on Inactive bg, and days outside the month are muted. It is a `role="grid"` with one tab stop, and forced-colors mode uses system colours for the rings. Weeks start on Monday.
- **Calendar day panel.** Choosing a day opens a raised card under the grid: the long date as a heading, one row per event (icon, word, company and role as a link to the application, "Past" when it is) and "Download interviews (.ics)". Nothing is shown for an empty day except "Nothing on this day." Coming up and Compare offers are not shown in the calendar view.
- **Calendar agenda.** At 720px and below the grid is replaced, not squeezed: one section per day that has events (today first), a heading with the weekday and date, and the same event rows.
- **Resume page.** Hosted edition only. The title "Resume" over a pair of Minimal segmented tabs, Resumes and Cover letters. Resumes is a stack of 20px cards: the master editor card (its sections as plain fields, each line with a "Line type" select (Line, Job, Job title, Bullet, Skill, School) and label, location and dates fields that show only for the types that use them: Job and School take Location, Job title takes Dates, Bullet and Skill take Label; the demo resume is structured in the same layout; "Replace with a file", "Make a version", Print) and one card per resume version, each with a muted "Used for 2 applications" line (a link to the list filtered to that resume), Rename, Edit and a Delete that asks in place. Before there is a master, one card offers "Upload a file" and "Paste text", and what is read is shown to check before Save. Cover letters is a list of rows, each a link to its application with the letter's text.
- **Settings, AI card.** A card titled "AI" (hosted only, with an "AI" jump link) under one muted line: "Only the text you choose to send goes to Anthropic. Your key stays on this device, locked with your passphrase." Labels are "Anthropic key", "Passphrase" (help: "At least 12 characters. You'll type it to unlock your key. It isn't stored anywhere.") and "Model" (a select: "Sonnet 5.5 (recommended)", "Haiku 5.5 (cheaper)", "Opus 5.5 (best)"). Three states. None: the three fields and one primary "Save key". Locked: "Key ending in ••••1234", a Passphrase field and a primary "Unlock", with "Forget key" as a danger button beside it that asks in place ("Forget your key on this device?"). Unlocked: the same key line, a muted "Unlocked until you reload or log out.", then "Check key", "Lock" and "Forget key". Results and errors (a wrong passphrase, a key Anthropic refuses) go to the Notice at the top of Settings, like the other cards.
- **Convert panel on the Resume page.** A card that appears for every upload or paste, headed "Convert to your template". A muted line, "This is the text that will be sent to Anthropic with your key:", labels a read-only text box with a character count under it. Buttons: "Convert with AI" (primary, once the key is unlocked), "Use the simple converter" and "Cancel", plus "Stop" while it converts. With no key, a line says "Add your Anthropic key in Settings to convert with AI." with a Settings link, and the simple converter is the primary button. With a locked key, a Passphrase field and "Unlock" sit inline. The review is the check step with a muted "Converted with AI. Check each line before you save." Above the editor, a "Check these lines" list has one row per line the conversion wasn't sure about: the note ("Not in your file: ..." or "Label added by AI"), the line, and small "Go to line" and "Dismiss" buttons. A collapsed "Not used from your file" lists the words that weren't carried over. The buttons are "Save as master resume" (primary), "Convert again", "Use the simple converter" and "Cancel", and nothing is saved before Save.
- **Documents on the detail page.** A "Documents" section with three plain blocks: "Resume sent" (a select of resume versions, None first), the cover letter (a text box, with Copy text, Draft in Gmail or Outlook and Print) and the job posting (a quiet disclosure with the pasted or captured text). On the list, an open application's panel carries one muted line ("Resume: Analyst v2 · Cover letter").
- **Resume column and filter.** Resume is an optional column (Settings, Appearance, off by default) that sorts and hides on a phone. The filter card has a "Resume" select (Any resume, each version, No resume set) and the current choice shows as a chip ("Resume: Analyst v2", "No resume set"). The Add forms ("Resume sent") and the bulk bar use a select of the versions too, with "Set resume" in the bulk bar. An interview in Coming up and the calendar carries a muted small "Sent: Analyst v2".
- **Print view.** `#/resume/print/:id` shows one document as a single clean column, with a "Print or save as PDF" primary button above it. Printed, the header, nav, banners and buttons are hidden and text is black on white. A cover letter prints in the plain system font with 18mm `@page` margins. A resume prints in the classic template: serif font on US letter with half-inch margins (the named `@page classic`), 10.5pt text on a 1.25 line height, a centered caps name and contact line, ruled caps headings, and job and school rows with the location or dates aligned right. It is black on white in light and dark. For a resume a muted status line beside the print buttons reads "Fits one page" or "About 3 lines over one page". It is advisory, because the screen layout only approximates print.
- **Keyboard shortcuts.** A quiet "Keyboard shortcuts" button at the bottom of the Applications page opens a small modal dialog (440px wide at most, a raised card on a 40% black backdrop): a list of keys in `kbd` pills with what they do, a muted line that they don't work while typing, and one primary Close. The list includes `g` then `r` for Resume. Focus moves in, Tab stays inside (focus that lands anywhere behind it is brought back), Escape or Close shuts it and focus goes back to what opened it, or to the footer button when that is gone.
- **Add several links.** A quiet disclosure inside the Add application form with a textarea (one link per line, up to 10), "Add these" and, while it runs, Stop (the disclosure stays open meanwhile, and focus moves to Stop and back to "Add these"). Each link then gets a plain sentence ("Added Acme, Designer.", "Skipped. Already saved as ...", "Couldn't be read. ..."), all as text.
- **History alignment.** Every dated row in History ends at the same edge, so the dates line up in one column: the Delete button has a fixed width, and an email row leaves that room empty.
- **Links in running text.** A link inside a paragraph, list item, notice or help line is full-contrast ink at weight 500 with no underline, and a tonal background on hover. Buttons, tabs, back links, expanders and sort links style themselves.
- **Lists are lists.** People is one hairline-divided list on the page background, not a card per company. Cards are for grouping a form or a self-contained object such as an email.
- **Log in page.** Two equal "Continue with ..." buttons in one card. Google's own G mark sits on a white pill, as their branding rules ask; the button the person used last gets the primary style. One muted help line says one window logs them in and Google may show an unverified notice (Advanced, then Go to Job Tracker). "Log in without connecting your mailbox" appears only after a login fails. The footer holds Privacy and Site setup.
- **Setup guide page.** `#/setup` is numbered steps in cards, one per console. Every value to copy is a monospace line with a Copy button. The two ID fields check their format as you type and say so in plain words. The generated `site-config.json` text sits below with a Copy button and an "Open site-config.json on GitHub" link, then an invite block with a copyable message. It needs no login.
- **Carry-over offer.** A quiet row, not a card: one sentence saying how many applications are saved in this browser from before login, with "Bring them over" and "Not now". It is never automatic. Afterwards a Notice says the earlier copy is still in this browser, with "Remove the earlier copy", which asks in place before it deletes.

### Disclosures
One system, defined once in the shared stylesheet. A **section disclosure** (`summary.disclosure`: Table view; the local edition's Add an application) has the Lucide chevron and a 44px row. A **quiet disclosure** (`details.more`) tucks a secondary form under a muted line with the same chevron. An **action disclosure** (`details.action`) is a secondary pill that sits in an action row (Edit, the emails list) and opens full width beneath it, turning tertiary while open; `.primary` gives it the primary gradient (Reply).

### Email text
Emails are read, not dumped. The subject is a 500 heading, the sender a bold name with a muted address, and the date and account sit on their own line, in the viewer's time zone with how long ago. The body is 0.9375rem/1.7, max 68ch, with repaired paragraphs and lists. Reply chains and footers fold under "Earlier in this thread" and "Footer and links". Links show their domain and are never clickable. A sent reply is a Surface-secondary card labeled "Reply sent". The newest email carries a "Latest" pill (the accent fill).

### People
Each company on the People tab is a dropdown (`details.company`): a card whose summary row is the chevron, the company name, its role, and a people count. It opens by itself when there is only one or after a search, and Expand all / Collapse all sit above. One shared person component on the People tab and inside each application: bold name, a tag for the kind (Recruiter, Hiring side, People Ops), the title as plain text, then a muted address and last contact. One action row holds Email (primary), Reply here, the emails list and Edit. People are grouped under their application and hairline-divided, never boxed.

### Status and progress
Account status is the provider's name in a heading, with the address or the error under it, and no emoji. A running sync is an unboxed block with a 10px pill progress bar in the accent on Inactive bg, an indeterminate slide when the total is unknown, and a sentence for the time left.

### Motion
Background, border and color transitions at 0.16s ease-out, the 0.12s press scale, and the chevron rotation, all gated behind `prefers-reduced-motion: no-preference`.

## Do's and Don'ts

### Do:
- **Do** take color from the tokens so light, dark and all four accents work without per-theme overrides.
- **Do** use `var(--r-pill)`, `var(--r-lg)`, `var(--r)` and `var(--r-seg)` for radii so the sharp setting applies.
- **Do** size controls with `var(--tap)` and sizes in rem.
- **Do** keep text at WCAG AA in both themes; use Field line for operable borders.
- **Do** raise cards, secondary buttons and popups with `var(--raise)`; reset `border` on every button.
- **Do** draw icons as Lucide masks or inline Lucide SVG, 24px or 16px, with `currentColor`.
- **Do** wrap motion in `prefers-reduced-motion: no-preference`.
- **Do** prefer a sentence over a stat card.

### Don't:
- **Don't** use colored side-stripes on cards, rows or notices.
- **Don't** hand-author icon paths, or use emoji or unicode glyphs as icons.
- **Don't** uppercase text, underline links, or use tabular numbers.
- **Don't** use a weight outside 400, 500 and 700.
- **Don't** introduce a new accent color outside the four choices, or color a stage beyond its entry in the one stage map.
- **Don't** scale list rows, tabs or other items that share edges with siblings on press.
- **Don't** hard-code px radii, `#000`/`#fff` in component rules, or hairline-colored borders on inputs.
- **Don't** use Wealthsimple's name, logo, wordmark or font files in the shipped app.
