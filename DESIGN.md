---
name: Job Tracker
description: A calm editorial ledger for a personal job search; graphite ink on linen, serif headlines, pill controls, hairlines, no shadows.
colors:
  linen-ground: "#faf8f5"
  paper-surface: "#fdfdfc"
  linen-panel: "#f6f4ef"
  fog: "#f1f0f0"
  graphite-ink: "#32302f"
  pebble-muted: "#686664"
  stone-hairline: "#e4e2e1"
  field-line: "#8c8986"
  accent-graphite: "#32302f"
  accent-bronze: "#5c4b24"
  accent-forest: "#2f5d46"
  accent-clay: "#8f4a32"
  accent-ink: "#fdfdfc"
  stage-applied: "#5b5855"
  stage-heard-back: "#3f5671"
  stage-assessment: "#78560c"
  stage-interview: "#69477a"
  stage-offer: "#2b6747"
  stage-rejected: "#9a4232"
  dark-ground: "#12110e"
  dark-surface: "#1b1915"
  dark-panel: "#16140f"
  dark-fog: "#26231d"
  dark-ink: "#efece5"
  dark-muted: "#a8a397"
  dark-hairline: "#35322b"
  dark-field-line: "#8a8578"
  dark-accent-graphite: "#ece9e2"
  dark-accent-bronze: "#d9c28a"
  dark-accent-forest: "#8cc7a6"
  dark-accent-clay: "#e0a184"
  dark-accent-ink: "#14130f"
  viz-ord-1: "#b9ae96"
  viz-ord-2: "#8f8266"
  viz-ord-3: "#66593f"
  viz-ord-4: "#3a3525"
  viz-good: "#3b7f59"
  viz-crit: "#b0493a"
  viz-neutral: "#8c8883"
typography:
  display:
    fontFamily: "Source Serif 4, Iowan Old Style, Georgia, serif"
    fontSize: "clamp(2rem, 4vw, 2.75rem)"
    fontWeight: 500
    lineHeight: 1.12
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "Source Serif 4, Iowan Old Style, Georgia, serif"
    fontSize: "1.625rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Source Serif 4, Iowan Old Style, Georgia, serif"
    fontSize: "1.1875rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.005em"
  lede:
    fontFamily: "Source Serif 4, Iowan Old Style, Georgia, serif"
    fontSize: "clamp(1.25rem, 2.2vw, 1.5rem)"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "-0.005em"
  body:
    fontFamily: "Figtree, system-ui, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  small:
    fontFamily: "Figtree, system-ui, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Figtree, system-ui, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.01em"
rounded:
  pill: "999px"
  card: "24px"
  sm: "12px"
  sharp: "3px"
spacing:
  pad: "28px"
  pad-compact: "16px"
  cell-y: "16px"
  cell-y-compact: "8px"
  gap: "24px"
  gap-compact: "12px"
  tap: "44px"
  tap-compact: "36px"
components:
  button-primary:
    backgroundColor: "{colors.accent-graphite}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "44px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.graphite-ink}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.fog}"
  badge:
    backgroundColor: "{colors.fog}"
    textColor: "{colors.stage-applied}"
    rounded: "{rounded.pill}"
    padding: "3px 12px"
    typography: "{typography.label}"
  tab:
    backgroundColor: "{colors.paper-surface}"
    textColor: "{colors.graphite-ink}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  tab-current:
    backgroundColor: "{colors.accent-graphite}"
    textColor: "{colors.accent-ink}"
  input:
    backgroundColor: "{colors.paper-surface}"
    textColor: "{colors.graphite-ink}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  card:
    backgroundColor: "{colors.paper-surface}"
    rounded: "{rounded.card}"
    padding: "28px"
  notice:
    backgroundColor: "{colors.paper-surface}"
    rounded: "{rounded.sm}"
    padding: "14px 20px"
  panel:
    backgroundColor: "{colors.linen-panel}"
---

# Design System: Job Tracker

## Overview

**Creative North Star: "The Quiet Ledger"**

A warm, near-monochrome editorial look pinned by the user as "Wealthsimple's aesthetic", read from unofficial third-party references. The app speaks in serif headlines and sentences instead of dashboard widgets: graphite ink on linen, paper-white cards divided by hairlines, pill-shaped controls, and nothing that shouts. Wealthsimple's name, logo and proprietary typefaces are not used; Source Serif 4 stands in for the display serif and Figtree for the UI sans.

Depth comes from tone and hairline only. Color is rationed: the only chromatic notes are the six stage-badge text colors, the Sankey outcome colors, and one user-selectable accent (graphite by default) that fills primary buttons and the current tab. The signature move is the serif voice: page headlines, company names in the list, and the Flow page's sentence summary standing in for a stat-card row.

The user owns the finish. Theme (system/light/dark), accent (graphite, bronze, forest, clay), density (comfortable/compact) and corners (round/sharp) are settings, written onto `<html>` as `data-theme`, `data-density`, `data-corners`, `data-accent` and the `--accent-l` / `--accent-d` variables. Every new surface must survive all combinations.

**Key Characteristics:**
- Linen ground, paper surfaces, graphite ink; dark theme is bronze-black, never blue-grey.
- Source Serif 4 for voice, Figtree for work.
- Pills for every control; 24px hairline cards.
- No shadows, no gradients, no side-stripes, no glyph icons.
- WCAG AA in both themes; controls are 44px tall by default (36px in compact density on a mouse, 44px again on touch screens).

## Colors

Warm graphite and linen with earthy, muted status tones. Values below are the light theme with the dark counterpart in the frontmatter (`dark-*`).

### Primary
- **Graphite Accent** (#32302f light, #ece9e2 dark): the default accent. Fills primary buttons, the current filter tab and the active mobile sort chip. Text on it is `accent-ink` (#fdfdfc light, #14130f dark).
- **Bronze** (#5c4b24 / #d9c28a), **Forest** (#2f5d46 / #8cc7a6), **Clay** (#8f4a32 / #e0a184): alternative accents the user may pick in Settings. They replace only `--accent`; ink, hairlines and badges stay neutral.

### Neutral
- **Linen Ground** (#faf8f5 / #12110e): page background.
- **Paper Surface** (#fdfdfc / #1b1915): cards, inputs, tabs, notices.
- **Linen Panel** (#f6f4ef / #16140f): hovered and open table rows and their expansion panel.
- **Fog** (#f1f0f0 / #26231d): badges, chips, current-nav pill, hover fill, mobile sort chips.
- **Graphite Ink** (#32302f / #efece5): text, secondary-button outline, focus ring.
- **Pebble Muted** (#686664 / #a8a397): secondary text, help text, placeholders, chevrons.
- **Stone Hairline** (#e4e2e1 / #35322b): decorative dividers and card borders only.
- **Field Line** (#8c8986 / #8a8578): borders of controls and notices; held to 3:1 against the surface, which Stone Hairline is not.

### Stage badge text colors
Tonal text on Fog; the word carries the meaning, color supports it. Light / dark: Applied #5b5855 / #b4afa4; Heard back #3f5671 / #9db4d6; Assessment #78560c / #d9b45a; Interview #69477a / #cba9d6; Offer #2b6747 / #8fcfa8; Rejected #9a4232 / #e69a8a. Rejected doubles as the danger and error color.

### Flow chart (scoped to the Flow page's chart root)
- Stage ordinal ramp, sand to bronze: #b9ae96, #8f8266, #66593f, #3a3525 (light); reversed in lightness for dark: #7d7155, #9a8c6a, #b9a97f, #dccb9c.
- Outcomes: Offer green #3b7f59 / #5fb583, Rejected brick #b0493a / #e0705e, no-outcome-yet grey #8c8883 / #8a867c. Links draw at 0.38 opacity (0.1 dimmed, 0.72 highlighted).

### Named Rules
**The One Voice Rule.** Chroma is reserved for status and the single chosen accent. A surface with a new color needs a new status to justify it.
**The Hairline Contrast Rule.** Decorative dividers use Stone Hairline; anything a user must see to operate (inputs, notices, swatch rings) uses Field Line.

## Typography

**Display Font:** Source Serif 4 (Iowan Old Style, Georgia, serif), self-hosted variable woff2
**Body Font:** Figtree (system-ui, Segoe UI, sans-serif), self-hosted variable woff2
**Mono:** system monospace, only for code and addresses in setup instructions

**Character:** A literary serif at medium weight over a friendly geometric sans. Serif carries meaning (where you are, who you applied to); sans carries operation. Both are served from `/static/fonts` so the app works offline (licenses in LICENSES.md).

### Hierarchy
- **Display** (500, clamp(2rem, 4vw, 2.75rem), 1.12, -0.015em): the page headline, one per page.
- **Headline** (500, 1.625rem, 1.2): wordmark in the header and section headings; settings section headings run 1.5rem.
- **Title** (500, 1.1875rem, 1.2): company names in list rows. Panel sub-headings are 1.125rem/1.3.
- **Lede** (400, clamp(1.25rem, 2.2vw, 1.5rem), 1.45, max 46ch): the Flow page sentence summary.
- **Body** (400, 1rem, 1.55; 0.9375rem in compact density): Figtree for everything else. Buttons are 500.
- **Small** (400, 0.875rem): dates, role sub-line, help text, table headers (500, muted).
- **Label** (600, 0.75rem, 0.01em): badges and tags. Never uppercase.

### Named Rules
**The Rem Rule.** All sizes are rem so browser text-size settings are honoured; the one exception is the 16px floor on phone inputs to stop iOS focus zoom.
**The Serif Is Voice Rule.** Serif is for headlines, names and the Flow sentence. Controls, table data and labels stay in Figtree.

## Layout

Single column, max-width 1120px, centered, padding 40px 24px 96px. Header is a flex row (serif wordmark left, nav right: Jobs, Applications, People, Flow, Needs review, then a Settings gear icon). At 520px and below the gear moves into the title row and the words wrap below. Card padding `--pad` 28px, table cell vertical padding `--cell-y` 16px, vertical gap `--gap` 24px.

Compact density tightens these to 16px / 8px / 12px, drops body to 0.9375rem and tap to 36px. On touch (`pointer: coarse`) the tap target is 44px in every density; otherwise it is 44px comfortable by token default (the brief's 40px fine-pointer figure is not in the CSS; see report). At 720px and below each table row becomes a stacked block: company and role on the left, stage badge on the right, last activity on its own line; column headers become a row of pill sort buttons with the active sort filled in the accent. Role, Applied and Emails columns hide there. Panels use a two-column form grid (gap 32px) that collapses to one column at 720px.

## Elevation & Depth

Flat. There are no drop shadows and no gradients anywhere; surfaces separate by tone (Linen, Paper, Fog) and 1px hairlines. The only box-shadow declarations in the build are inset focus and selection rings and a 1px outline ring around accent swatches in Settings, none of which lift anything. The tooltip layer (`--z-tip: 20`) and skip link (`--z-skip: 100`) are the only z-index layers.

### Named Rules
**The Flat-Always Rule.** Hover is a tone change (Fog or Linen fill, or a border darkening to ink), never a lift.

## Shapes

Round and soft by default: pills (999px) for buttons, tabs, inputs, badges, chips, nav links and sort chips; 24px for cards; 12px for notices and textareas. Borders are 1px hairlines. The "sharp" corners setting collapses all three radii to 3px, so every component must take its radius from the tokens, never a literal. The disclosure and list chevron is a drawn 8px rotated border corner, not a glyph. Notices carry a drawn SVG mask icon (info circle, or warning triangle for errors) tinted with currentColor.

## Components

### Buttons
- **Shape:** pill (999px), min-height `--tap`, padding 0 24px, Figtree 500 1rem, 0.015em tracking.
- **Primary:** accent fill, accent-ink text. Hover mixes the accent 14% toward the ground.
- **Secondary (default):** transparent with a 1px ink outline; hover fills Fog. Danger variant uses Rejected text with a 55% mix outline.
- **States:** active nudges 1px down; disabled 50% opacity; busy shows progress cursor. Focus is a 2px ink outline at 3px offset, on every interactive element.

### Badges and chips
Tonal pill on Fog, 0.75rem/600, 3px 12px, text in the stage color. Chips are Fog pills at 0.875rem; tags are smaller Fog pills in muted (step and note tags in ink).

### Filter tabs
Pill row with a count: Paper fill, Field-hairline border, 44px, counts in tabular muted figures. Current tab fills with the accent and its count inherits at 80% opacity. Hover darkens the border to ink.

### Inputs
Pill, 1px Field Line border, Paper fill, padding 0 20px; border shifts to ink on focus plus the outline. Textareas use the 12px radius. Labels are 0.875rem/500 muted with a 4px inset. Checkboxes and radios take ink as accent-color.

### Cards
Paper fill, 1px Stone Hairline border, 24px radius, 28px padding, no shadow. The list card holds the table with hairline row dividers; open or hovered rows tint Linen Panel.

### Stacked phone row
Described in Layout: a two-column grid per application with the Stage badge top-right and last activity beneath.

### Notices
Paper fill, 1px Field Line border, 12px radius, 20px drawn icon. Error variant recolors border and icon to Rejected. Never a colored side-stripe.

### Expandable list panel
Clicking a company name (serif title with a drawn chevron) opens an in-place Linen panel under the row with a two-column form grid and a hairline-divided history list. Chevron rotates from -45deg to 45deg over 0.16s; disclosures (`details`) reuse the same chevron.

### Settings controls
Segmented radios and accent swatches (18px round dots with a 1px ring) for theme, accent, density and corners; Settings is where the user-facing customization lives.

### Jobs tab
Pill tabs (Matches, Notifications, Your profile, Sources) sit above a second row of view pills (New, Saved, Applied, Dismissed, All) with counts. Matches are hairline-divided rows inside one card: serif title, a small tonal score pill, a muted "company · place · source" line, the match reasons in body ink, then pill actions. "I applied" is the one solid action; Dismiss is the quiet danger outline. The nav's Jobs link carries a count badge of new matches. Resume upload, profile lists, and sources reuse the Settings card and form styles. On phones the actions wrap under the reasons.

### Disclosures
One system, defined once in the shared stylesheet. A **section disclosure** (`summary.disclosure`: Add an application, Table view) has the drawn chevron and a 44px row. A **quiet disclosure** (`details.more`) tucks a secondary form under a muted line with the same chevron. An **action disclosure** (`details.action`) is a secondary pill that sits in an action row (Edit, the emails list) and opens full width beneath it; `.primary` fills it with the accent (Reply). The browser's triangle never shows.

### Email text
Emails are read, not dumped. The subject is a serif heading, the sender a bold name with a muted address, and the date and account sit on their own line, in the viewer's time zone with how long ago. The body is Figtree at 0.9375rem/1.7, max 68ch, with repaired paragraphs and lists. Reply chains and footers fold under "Earlier in this thread" and "Footer and links". Links show their domain and are never clickable. A sent reply is a Linen Panel card labeled "Reply sent". The newest email carries a "Latest" pill (the accent fill).

### People
Each company on the People tab is a dropdown (`details.company`): a card whose summary row is the drawn chevron, the company in serif, its role, and a people count. It opens by itself when there is only one or after a search, and Expand all / Collapse all sit above. One shared person component on the People tab and inside each application: bold name, a Fog tag for the kind (Recruiter, Hiring side, People Ops), the title as plain text, then a muted address and last contact. One action row holds Email (primary), Reply here, the emails list and Edit. People are grouped under their application and hairline-divided, never boxed.

### Status and progress
Account status is a large emoji with the provider's name (the user asked for it; it is the one place emoji appear). A running sync is an unboxed block with a 10px pill progress bar in the accent on Fog, an indeterminate slide when the total is unknown, and a sentence for the time left.

### Motion
Only background, border and color transitions at 0.16s ease-out plus the chevron rotation, all gated behind `prefers-reduced-motion: no-preference`.

## Do's and Don'ts

### Do:
- **Do** take color from the tokens so light, dark and all four accents work without per-theme overrides.
- **Do** use `var(--r-pill)`, `var(--r-lg)` and `var(--r)` for radii so the sharp setting applies.
- **Do** size controls with `var(--tap)` and sizes in rem.
- **Do** keep text at WCAG AA in both themes; use Field Line for operable borders.
- **Do** separate surfaces with tone and a 1px hairline.
- **Do** draw icons as CSS or inline SVG strokes using currentColor.
- **Do** wrap motion in `prefers-reduced-motion: no-preference`.
- **Do** let the serif carry the page voice; prefer a sentence over a stat card.

### Don't:
- **Don't** add shadows or gradients.
- **Don't** use colored side-stripes on cards, rows or notices.
- **Don't** use emoji or unicode glyphs as icons.
- **Don't** introduce a new accent color outside the four choices, or color a badge beyond the six stage tones.
- **Don't** use serif for buttons, table data or labels, or uppercase labels.
- **Don't** hard-code px radii, `#000`/`#fff`, or hairline-colored borders on inputs.
- **Don't** use Wealthsimple's name, logo or proprietary typefaces.
