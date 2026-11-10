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

## 1. How to use this file

This file is the single entry point for how Job Tracker looks, reads and moves. The YAML block above holds the design tokens (colours, type, radii, spacing, component specs); design tooling reads it, so keep it valid. Everything below is the prose that explains and applies it.

**Rules first, then screens.** Read sections 2 to 4 (principles, words, components) before any screen. A screen spec only says what is unique to the screen and links to the rule or component it uses. Do not restate a rule on a screen.

**File map**

| File | What it holds |
| --- | --- |
| `DESIGN.md` (this file) | Tokens, principles, the components catalogue, the pre-ship checklist |
| [docs/design/styling.md](docs/design/styling.md) | The full styling reference: every value, the owner's rules, where each rule lives in the CSS, worked examples |
| [docs/design/copy.md](docs/design/copy.md) | Voice, formatting, glossary, error and confirm patterns, card copy, copy checklist |
| [docs/design/screens.md](docs/design/screens.md) | One section per screen, grouped by page |
| [docs/design/animation.md](docs/design/animation.md) | Building fixed-size looping UI animations |
| [docs/design/critique.md](docs/design/critique.md) | How to critique a screen, with the rubric |
| `tools/design/` | The scripts the animation and critique guides use |
| `PRODUCT.md` | Who the product is for and what it will not do |

**Skills are distilled.** The design work was first done with four product-design skills (`use-ws-styling`, `support-resolution-card-copy`, `ui-animation`, `design-critique`). They are no longer needed: their content is distilled into `docs/design/styling.md`, `copy.md`, `animation.md` and `critique.md`, and their scripts into `tools/design/`. Reproduce the work from the repo alone.

**Edition legend.** Entries are marked **local** (the Python app, `jobtracker/templates`, one stylesheet in `base.html`), **hosted** (the web app, `web/src`) or **both**. The two stylesheets are kept in step by hand.

**Where tokens live.** Frontmatter names are the design record; the code reads CSS custom properties in `web/src/styles/base.css` (`:root`, the dark blocks, `data-density`, `data-corners`, `data-accent`). Change a value in both and say why.

**To add a component:** reuse a catalogue entry if one fits. Otherwise put its CSS next to the component (`web/src/components/<name>/<name>.css`), take colour, radius and size from tokens only, add an entry to section 4 (what it is, edition, component file, CSS file), then run the checklist in section 8. **To add a screen spec:** add a section to `docs/design/screens.md` under the nearest group and link to the catalogue entries it uses.

## 2. Principles and tokens

### Overview

**Creative North Star: "The Quiet Ledger".** Job Tracker follows a hand-distilled approximation of the Wealthsimple prototype styling (full values in `docs/design/styling.md`), not the real design system, which this local app cannot load. It speaks in plain sentences and one sans typeface: black on a light grey ground, raised cards and pill controls, hairline separators inside cards, nothing that shouts.

The user owns the finish. Theme (system, light, dark), accent (graphite, bronze, forest, clay), density (comfortable, compact) and corners (soft, sharp) are settings, written on `<html>` as `data-theme`, `data-accent` (plus `--accent-l` / `--accent-d`), `data-density` and `data-corners`. Every surface must survive every combination, so it takes colour, radius and size from tokens only.

**The rules, once each**
- **Colour is rationed.** Chroma is for status (the one stage map), the data-viz palette and the single chosen accent. A new colour needs a new status to justify it. No coloured side-stripes. Colour is never the only signal: pair it with a word, shape or icon.
- **Sentence case, no uppercase, weights 400/500/700, one typeface.** No `text-transform: uppercase`, no small caps. Acronyms such as RRSP and ETF are fine. The print resume is the one exception (below).
- **Plain figures, plain links.** No `font-variant-numeric: tabular-nums`. Links are never underlined; they show through ink colour, weight 500 and a tonal hover.
- **Text is at least 12px (0.75rem).** The owner's app rule. 12px is for tags, badges and chart axes; prefer 14px and up for anything a person must read. Sizes are rem so browser settings apply; the one exception is the 16px floor on phone inputs.
- **Tokens, never literals.** No hex, no `#000`/`#fff`, no px radii in component rules. Operable borders use Field line.
- **Pills, 20px raised cards, hairlines inside cards.** Do not nest a raised card in a raised card. Prefer a sentence to a stat card.
- **Honest interaction.** Hover and pointer cursors only on things that act. Standalone controls scale to 0.97 on press; anything inside a container changes tone instead. Never both.
- **Document formats are the exception.** The resume sheet (`.doc-sheet.classic`) and print styles keep a serif font, capital headings and black on white in both themes, because they match a document the owner must produce. The exception stops at the sheet's edge.
- **Never ship Wealthsimple's name, logo, wordmark or font files.**

### Colours

Light values here, dark counterparts in the frontmatter (`dark-*`). CSS names: `--bg`, `--surface`, `--surface-hover`, `--linen` (secondary surface), `--fog` (inactive bg), `--hover`, `--ink`, `--muted`, `--line` (outline), `--field-line`.

- **Accent.** Graphite #000000 / #ffffff by default; Bronze, Forest and Clay are user choices. They replace only `--accent`; text, outlines and badges stay neutral. The accent fills primary buttons, the nav count badge and the active mobile sort chip. `--accent-ink` is the text on it.
- **Neutrals.** Background #f2f2f2 / #000000. Surface #fafafa / #171717 for cards, inputs, popups, secondary buttons (hover #ffffff / #1f1f1f). Surface secondary #ebebeb / #0f0f0f for open rows and panels. Inactive bg 5% black / 7% white for badges, chips, the current tab and press tone (the primer says 3%; held higher so it shows on #f2f2f2). Hover bg 4%. Text primary black / white; Text secondary 55% / 50%.
- **Outline versus Field line.** Outline (8% black / 12% white) is for decorative dividers only. Anything a user must see to operate (inputs, notices, swatch rings) uses Field line (#8c8c8c / #8a8a8a), held to 3:1 against the surface.
- **Stage colours, one map** (`--stage-applied`, `--stage-heard-back`, `--stage-assessment`, `--stage-interview`, `--stage-offer`, `--stage-rejected`, and each with `-text`). The graphic colour fills the dot and chart marks; the text colour is the same hue darkened (light) or lightened (dark) to hold 4.5:1 on the page and the tinted rows. `--offer` and `--rejected` alias the text colours; Rejected doubles as the danger and error colour. The hex table is in the frontmatter and `docs/design/styling.md` 2.4.

### Typography

Font stack `"Wealthsimple Sans Display", Figtree, -apple-system, "SF Pro Display", system-ui, sans-serif`. Figtree is self-hosted (`/static/fonts` local, `web/src/assets/fonts` hosted) so the app works offline. Mono is for code and addresses in setup instructions only.

- **Display** 500, clamp(2rem, 4vw, 2.5rem), 1.2, -0.8px: the page headline, one per page. **Brand** 700, 1.5625rem: the wordmark.
- **Section** 500, 1.25rem (panel sub-headings and **Row** names 1rem/500). **Lede** 400, clamp(1.25rem, 2.2vw, 1.5625rem), max 46ch: the Statistics summary.
- **Body** 400, 1rem, 1.4 (0.9375rem compact). Buttons 500. Email text 0.9375rem/1.7, max 68ch.
- **Small** 0.875rem: dates, help text, field labels (500, muted), table headers. **Label** 500, 0.75rem: tags and the score pill. The stage badge is 0.875rem/500.
- Statistics headline numbers are plain text, 700 at the Display size, a label and one line of context, no boxes.

### Layout

Single column, max-width 1120px, centred, padding 40px 16px 96px. The 16px gutter is the same at every width; room comes from section spacing and card padding. Tokens: `--pad` 16px, `--cell-y` 16px, `--gap` 24px, `--section` 32px (64px from 721px up). Compact density: 12px / 8px / 12px, section 24px (40px), body 0.9375rem, tap 36px. On `pointer: coarse` the tap target is 44px in every density.

Header: wordmark left, nav right (hosted: Applications, People, Resume, Statistics, Settings gear; local: Jobs first, no Resume). At 520px and below the gear moves into the title row and the nav words stay on one row below. At 720px and below tables become stacked blocks and panels collapse to one column. Needs review is not in the nav; a banner on Applications links to it.

### Elevation

Raised surfaces are strokes plus one soft shadow: `--raise` is `inset 0 0 0 1px #fff, 0 0 0 1px rgba(0,0,0,.05), 0 4px 12px rgba(0,0,0,.08)` (secondary button 0.10). The outer stroke is a non-inset spread so it never shrinks the corner radius. Dark: strokes white at 5% and 8%, shadow 0.5 black. Primary buttons are dark glass: gradient, inner top highlight, inner bottom shadow, drop shadow. Popups reuse `--raise`. Layers: `--z-tip` 20, `--z-pop` 30, `--z-skip` 100.

### Shapes and radius names

Round and soft: pills for buttons, inputs, badges, chips and nav links; 20px cards; 12px notices, textareas and popups; 8px for the Minimal segmented indicator. The sharp setting collapses all four to 3px, so every component takes its radius from a token.

| Frontmatter `rounded.*` | CSS custom property | Soft | Used for |
| --- | --- | --- | --- |
| `pill` | `--r-pill` | 999px | buttons, inputs, badges, chips, nav links, dropdown options |
| `card` | `--r-lg` | 20px | cards |
| `sm` | `--r` | 12px | notices, textareas, popups, code blocks |
| `segment` | `--r-seg` | 8px | Minimal segmented options, link hover tone |
| `sharp` | all four | 3px | `data-corners="sharp"` |

### Icons

Lucide only, as the official package or its path data in a CSS mask (`--ico-chevron-right`, `--ico-chevron-down`, `--ico-check`, `--ico-arrow-up`, `--ico-arrow-down`, `--ico-info`, `--ico-alert` in `base.css`). Two sizes: 24px and 16px. Rendered stroke is 2px (strokeWidth 3 at 16px). Colour is `currentColor`. Never hand-draw a path, use emoji or unicode glyphs as icons, or give a multi-path icon a semi-opaque colour (mask icons are single flat fills, so they may use text-secondary). The Settings gear is an inline Lucide `settings`, 24px, stroke 2.

## 3. Writing the words

Full rules, glossary, card copy and checklist: [docs/design/copy.md](docs/design/copy.md). The short version:

- **Voice.** Transparent, human, helpful; never funny in a problem. A person talking to a person, no jargon, codes or enum names. Address the person as you; the app never says I.
- **Minimal copy.** No intro paragraph, no explainer. If the person can see it, do not say it. One muted help line is the ceiling, only where a mistake costs something. Show data as the source system shows it.
- **Sentence case everywhere**, except named places (Settings, Needs review, Recently deleted) and brands (Gmail, Anthropic). No all-caps strings. Print-resume exception: the printed resume template sets the name and section headings in capitals, because it is a document format (see Principles).
- **No em-dashes** anywhere in the app or its docs; use a comma, colon or new sentence. `copy.md` allows a rare em dash; the owner's rule is stricter and wins. No emoji, no semicolons, no ampersands. En dash only for ranges and negatives.
- **Canadian spelling.** Contractions are fine. Say "log in" (verb) and "login" (noun), "email" for a message.
- **Headers, buttons and labels take no end punctuation**; sentences take a full stop. At most one "!" per screen, only for good news.
- **Errors are plain sentences with a next step.** What happened, then what to do, two short sentences at most. Blame the thing, not the person ("That key was refused. Check it in Settings."). Name limits with numbers. Never hold or print a key. Log technical detail to the console, show a sentence.
- **Buttons are named by outcome**, verb plus noun: "Save application", "Write my resume and letter". Destructive verbs say so ("Delete now"). Never "OK", "Yes" or "Submit". One primary per row or card.
- **Not now, Skip, Dismiss, Undo** each mean one thing; Cancel abandons something started and never means "later". Optional fields say "(optional)"; required ones are unmarked.
- **Empty states** name the next step in the button's own words. **Destructive actions** use InlineConfirm, never a browser dialog.
- **Status lines** use the present participle while working and past tense when done. Formats (money, dates, numbers, masking) are in `copy.md` section 2.

**Gate sentences** (`web/src/app/gates.ts`, rendered by `components/Gate.tsx`; never hand-write one on a screen): "Connect your mailbox in Settings." (`#/settings/mail`), "Add your resume first." (`#/resume`), "Add your Anthropic key in Settings." (`#/settings/ai`), "Unlock your key to use AI.", "Paste the job description first.", and the muted "Connect your mailbox to draft this in Gmail or Outlook." where a draft button would be.

## 4. Components catalogue

Each entry gives the edition, the component file and the CSS file. Per-screen use is in [docs/design/screens.md](docs/design/screens.md).

### Buttons
Both. CSS `button, .btn` and variants in `web/src/styles/base.css`; local `jobtracker/templates/base.html`. Pill, min-height `--tap`, padding 0 24px, 500 1rem, `border: none` (always reset the user-agent border).
- **Primary** (`button.primary`, `a.btn.primary`): gradient from the accent to 16% toward white (12% toward black in dark), glass strokes, accent-ink text. One per view or form; when a primary appears, the others step down to secondary.
- **Secondary** (default): Surface fill, `--raise-btn`, hover Surface hover. The default, and the section action (header row, right side, never Primary).
- **Tertiary** (`button.quiet`, `button.hist-del`): 4% to 7% gradient, no shadow. Delete on a history row; an open action disclosure.
- **Danger** (`button.danger`): as secondary with Rejected text. The label still says what it does.
- **Small** `--tap-sm` (36px; 44px on touch). **Icon** buttons are `--tap` square with an `aria-label`.
- States: press scale 0.97 (120ms), disabled 50% opacity, busy (`aria-busy`) progress cursor, focus a 2px ink outline at 3px offset on every interactive element.

### Badges, chips and tags
Both. `StageBadge.tsx` (hosted), `.badge`, `.chip`, `.tag` in `base.css`. The **stage badge** has no pill: the stage word at 0.875rem/500 in its stage text colour, led by a 10px dot in its graphic colour, so markup stays `badge Interview`. A **plain badge** and the jobs score pill are pills on Inactive bg, 0.75rem/500, padding 3px 12px. **Chips** are the same fill at 0.875rem. **Tags** are smaller pills in text-secondary (step and note tags in ink). "Follow up?" and "No reply in 30 days" are tags; an application shows one or the other.

### Segmented controls and tabs
Pick one of four; never mix. Selected is ink at 500, unselected muted at 400, told apart by weight and fill, never colour alone. The indicator is grey (`--fog`), no stroke or shadow.

| Variant | Used for | Look | CSS |
| --- | --- | --- | --- |
| **Minimal** `.tabs` / `.tab` | filter tabs, List/Calendar, Resumes/Cover letters/Tailored | no track; 8px (`--r-seg`) options at `--tap`, count inline; `aria-current="true"` | `base.css` |
| **Default** `.seg` | theme, density, corners | pill track styled as a Primary card, pill options inset 4px, hidden radios | `pages/settings/settings.css` |
| **Section switcher** `.section-switcher` | Settings sections | the Default track, a row of links, `aria-current="page"`, scrolls sideways | `settings.css` |
| **Document switch** `.doc-switch` | Resume / Cover letter, Edit on page / as list | Minimal look on buttons at `--tap-sm`, `aria-pressed="true"` | `components/documents/pageeditor.css` |

Hover is Hover bg; press is a stronger tone, never a scale. Indicators switch instantly (no script on these controls).

### Inputs
Both. `input, select, textarea`, `label.field`, `.help`, and the `appearance: base-select` block in `base.css`; `Combobox.tsx` and `combobox.css` for suggestions. Pill, 1px Field line border, Surface fill, padding 0 20px; border turns ink on focus. Textareas use the 12px radius. Labels 0.875rem/500 muted, 4px inset. Checkboxes and radios use ink as accent-color. Dropdowns use the themed popup where supported (raised surface, pill options, Lucide check). Under 720px, field text is 16px.

### Cards
Both. `.card` in `base.css`. Surface, `--raise`, no border, 20px radius, 16px padding, `--section` below. No hover or pointer cursor on a static card. Group inside a card with dividers or a hairline box.

### Rows and lists
Both. `table.list`, `tr.app-row` in `base.css`; `ApplicationPanel.tsx` and `applicationpanel.css`; `PersonCard.tsx`, `pages/people/people.css`. Hairline dividers (`--line`) between rows inside one card; open rows tint Surface secondary, hover is Hover bg, press is Inactive bg. List content that is not a form or a self-contained object (People, Coming up) is a hairline-divided list on the page background, not a card each. At 720px and below a row becomes a stacked block (see Applications list in screens).

### Disclosures
Both. `base.css`. A **section disclosure** (`summary.disclosure`: Table view, Compare offers) has the Lucide chevron and a 44px row. A **quiet disclosure** (`details.more`) tucks a secondary form under a muted line. An **action disclosure** (`details.action`) is a secondary pill in an action row that opens full width beneath it, turning tertiary while open; `.primary` gives it the primary gradient. The chevron rotates 0 to 90 degrees over 0.16s.

### Tailored split
Hosted. `pages/resume/sections/TailoredSplit.tsx`, `pages/resume/split.css`. Two titled panes side by side, "Tailored resume" and "Tailored cover letter", in a wider container (about 1360px) with columns `minmax(0, 1.55fr) minmax(0, 1fr)`. Each pane is a plain section under a 500 heading, not a card each. The resume sheet keeps its real 816px width and is scaled down with `transform: scale()` when its column is narrower (`ResumeSheet` and `PageEditor` take an optional `fit` prop), so wrapping and the one-page check match print. Under about 1100px the panes stack; under 720px they become one pane at a time behind a `.doc-switch` (Resume, Cover letter, `aria-pressed`), the only toggle on the page. Secondary lists ("Changes from your baseline (n)", Left out, ticks) sit in one section disclosure under the sheet.

### Sticky action bar
Hosted. `pages/resume/sections/ActionBar.tsx`, in `split.css`. A bar under the split that sticks to the bottom of the viewport (`position: sticky; bottom: 0`) while the split is on screen and rests under it otherwise. Surface fill with `--raise`, the card radius, 16px padding, and `safe-area-inset-bottom` on a phone. Left, one muted 0.875rem line saying where the primary action goes, with a quiet text action to change it, or a small select when several match. Right, a secondary pill and one primary pill, at `--tap` (44px) on a phone, where the line wraps above the buttons. Results (saved, page count, characters replaced) are muted lines or a Notice in the bar, never a toast. Do not put more than one primary in it.

### Setup row and setup card
Hosted. `components/setup/SetupRow.tsx` + `setuprow.css`; `SetupCard.tsx` + `setupcard.css`. A hairline-divided list inside one card; each row is a 24px mark (a 2px Field line ring when open, filled ink with a tick when done), a 500 title, a 0.875rem state word ("Connected", "Not yet"), a muted line on what it unlocks, and its own buttons. The card is a flex row: title, muted next-step line, a primary "Continue", a quiet "Dismiss".

### Notices
Both. `components/Notice.tsx`, `.notice` in `base.css`. Surface fill, 1px Field line border, 12px radius, padding 14px 20px, a 16px Lucide info icon (alert icon and Rejected border for errors). Errors are `role="alert"`, others `role="status"`. A notice that reports a result takes focus. Never a coloured side-stripe.

### InlineConfirm
Hosted. `components/InlineConfirm.tsx`, `inlineconfirm.css`. The one way to confirm removing or replacing anything; nothing uses a browser dialog. A tinted Surface-secondary block with a 12px radius, 12px margin and the card padding, directly under the control that opened it: a question title naming the object, an optional one-sentence consequence, the confirm button named by outcome (danger style when destructive) and Cancel, plus optional extra choices between them. Focus starts on Cancel so a stray Enter never removes anything. Escape or Cancel closes it and returns focus to the opener; Escape does nothing while the action runs, and both buttons are held. What happens afterwards is the caller's: remove the block and say what happened in a Notice that takes focus.

### Quiet status row
Hosted (the demo banner, backup nudge, carry-over offer, "Needs review" banner). `.status-row` in `pages/applications/applications.css`; `app/LocalBanner.tsx`; `backup/BackupNudge.tsx` and `backup.css`; `.demo-line` in `settings.css`. One line of muted 0.875rem text followed by text actions. Never a card, never a primary button, never a dialog, and nothing waits on it. When an action dismisses it, focus moves to the page so it is not lost. Account status: the provider's name in a heading, the address or error under it, no emoji. A running sync is an unboxed block (`components/syncprogress/SyncBar.tsx`, `syncbar.css`) with a 10px pill progress bar in the accent on Inactive bg, an indeterminate slide when the total is unknown, and a sentence for time left.

### Charts and ChartFrame
Hosted (local: `templates/statistics.html`). `pages/statistics/ChartFrame.tsx`, `statistics.css` under the `.viz-root` chart root. Every chart sits in `ChartFrame`: a heading, at most one line of note, the chart, a tooltip (a tap pins it on a phone), arrow keys between marks with one tab stop, and a Table view. Stages take fills from the stage map; only the no-outcome grey is the chart's own (#8c8c8c / #8a8a8a). Series colour follows the thing measured (applications Applied blue, replies Heard back purple). One axis, hairline gridlines at a few round values, 12px axis text in muted (never a series colour), thin marks with a 4px rounded data end, no number on every mark. An unfinished period is a 45 degree hatch plus the words "Still coming in".

### Links in running text
Both. `base.css` (the `:is(p, li, .notice, .help, .small, .muted) a` rule). A link inside a paragraph, list item, notice or help line is full-contrast ink, weight 500, no underline, with a tonal background on hover. Buttons, tabs, back links, expanders and sort links style themselves.

## 5. Screens

Each screen has its own section in [docs/design/screens.md](docs/design/screens.md):

- [Applications list](docs/design/screens.md#applications-list): add, filter, quick edit, bulk, saved views, goal, offers, shortcuts
- [Application detail](docs/design/screens.md#application-detail): actions, rounds, offer details, documents, history
- [Resume page](docs/design/screens.md#resume-page): Resume, Job, the tailored split, action bar (Download and Save), Your documents, convert panel, print view, Tailor
- [Settings and Setup](docs/design/screens.md#settings-and-setup): sections, Data, Recently deleted, AI card
- [Log in and setup guide](docs/design/screens.md#log-in-and-setup-guide)
- [Jobs and Calendar](docs/design/screens.md#jobs-and-calendar)
- [People and email](docs/design/screens.md#people-and-email)
- [Gate sentences](docs/design/screens.md#gate-sentences)

## 6. Motion and animation

In the app, motion is small and optional: background, border and colour transitions at 0.16s ease-out, the 0.12s press scale and the chevron rotation, all inside `@media (prefers-reduced-motion: no-preference)`. No bounce, no parallax, nothing else moves.

Fixed-size looping animations of the UI (a README GIF, release note, App Store card) are a separate, dev-only job: a pixel-exact stage, a camera that pushes in and out, one flat timeline of absolute milliseconds, recorded to GIF or mp4 by script. The method, gotchas and checklist are in [docs/design/animation.md](docs/design/animation.md); scripts are in `tools/design/`. A stage reuses the real components and tokens so it cannot drift.

## 7. Critiquing a screen

A critique is about taste first: what reads wrong and why, as tendencies, not violations; design-system conformance and content are secondary notes. Every review starts fresh (never read earlier reviews), looks in six passes (whole read, counts, craft tells, flow, patterns, content cross-check) and keeps three to seven ranked findings. The workflow, rubric, finding format and screenshot recipe are in [docs/design/critique.md](docs/design/critique.md); scripts are in `tools/design/`.

## 8. Pre-ship checklist

Run all before calling a screen done (details: `styling.md` section 5, `copy.md` section 8).

1. **Desktop** (1120px and wider): content in the column, 16px gutter, one Display heading, at most one primary button.
2. **390px phone:** nothing clips, no horizontal overflow (`document.documentElement.scrollWidth <= innerWidth`), tables become stacked blocks, header nav on one row, inputs 16px.
3. **Dark:** switch `data-theme="dark"` and the system setting. No hard-coded light colours; text 4.5:1, graphics 3:1; inputs use Field line.
4. **Every finish combination:** each accent (graphite, bronze, forest, clay), compact density, sharp corners, with theme light and dark. Nothing hard-codes a radius or colour.
5. **Keyboard and focus:** tab order follows reading order, every control shows the 2px ink ring, Enter and Space work on custom controls, focus lands somewhere sensible after a step change, a result or a removed button; the skip link works.
6. **Colour never alone:** state is a word, shape or icon too (stage word plus dot, tab weight and fill, tick plus word, error icon, hatched and labelled provisional values).
7. **44px targets** (36px on a mouse in compact density).
8. **12px minimum text**; rem sizes; weights 400, 500, 700 only.
9. **Tokens, not hex:** no `#000`/`#fff`, no literal px radii, no `font-weight: 600`; one radius name per component.
10. **Honest interaction:** hover and pointer only on things that act; standalone controls scale on press, items in a container use a tone; motion inside `prefers-reduced-motion: no-preference`.
11. **Grep the new CSS** for `#[0-9a-f]{3,6}`, `uppercase`, `tabular-nums`, `text-decoration: underline` and literal `border-radius`; each hit needs a reason.
12. **Words:** sentence case, no em-dashes, no emoji, buttons named by outcome, one help line at most, errors are plain sentences with a next step, gates come from `gates.ts`, destructive steps use InlineConfirm.
13. **Icons:** Lucide only, 24px or 16px, `currentColor`; icon-only buttons have `aria-label`.
14. **Never:** side-stripes, hand-drawn icon paths, a new accent, a stage colour outside the map, a nested raised card, Wealthsimple's name, logo or fonts.
