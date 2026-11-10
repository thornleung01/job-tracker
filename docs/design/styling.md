# Wealthsimple prototype styling (how this app looks)

This file is self-contained and is checked against the CSS (`web/src/styles/base.css` and the per-feature stylesheets). The entry point is [DESIGN.md](../../DESIGN.md).

This section is self-contained. It records the Wealthsimple prototype styling primer (the `use-ws-styling` skill of the `product-design` plugin) as this app applies it. Nothing else is needed to reproduce the look. Token names are the CSS custom properties in `web/src/styles/base.css`.

## 1. When and why

- The primer is a hand-distilled approximation of the Wealthsimple design system, written for places that cannot load the real packages (Magic sites, HTML prototypes, mockups). Job Tracker is such a place, so it uses the primer for prototype fidelity: it should look Wealthsimple-ish without claiming to be the real design system.
- It is not a spec and not a conformance target. Do not use it to judge shipping Wealthsimple product code, and do not treat its numbers as exact. Where the app deliberately differs, this section says so (the inactive fill is 5% not 3%; dark hover surfaces are filled in where the primer says "TBD").
- Stay conservative. When a choice is open: sentence case, generous whitespace, restrained colour, no card if a card is not needed, add space before shrinking type.
- Never ship Wealthsimple's name, logo, wordmark or font files. "Wealthsimple Sans Display" is named first in the font stack so a device that has it installed uses it; Figtree (self-hosted variable woff2 at `web/src/assets/fonts/Figtree-latin-wght.woff2`) is the stand-in everywhere else.
- The user owns the finish: theme (system, light, dark), accent (graphite, bronze, forest, clay), density (comfortable, compact) and corners (soft, sharp) are written on `<html>` as `data-theme`, `data-accent` (plus `--accent-l` / `--accent-d`), `data-density`, `data-corners`. Every new surface must survive all combinations, so it takes colour, radius and size from tokens only.

## 2. The values

### 2.1 Layout and spacing

| Item | Value | Token / place |
| --- | --- | --- |
| Page container | single column, max-width 1120px, centred, padding `40px 16px 96px` | `.wrap` |
| Page gutter | 16px at every width, never 12 or 8, never wider on desktop | `.wrap` padding |
| Card padding | 16px (12px compact) | `--pad` |
| Table cell vertical padding | 16px (8px compact) | `--cell-y` |
| Gap between related blocks (title to content, form rows) | 24px (12px compact) | `--gap` |
| Section spacing | 32px phone, 64px at 721px and wider (24px / 40px compact) | `--section`, media query `min-width: 721px` |
| Section heading to its content | 16px | `h2.section` margin |
| Narrow reading column (Setup, email text) | 760px max, email text 68ch | `.setup`, `.mail-text` |
| Stack inside a form | 12px between a field and the next label, same before the button | `.panel-forms` |

Breathing room comes from section spacing, card padding and column gaps, not from a wider outer gutter. Carousels or scroll rows keep the gutter with padding, not negative margin.

Desktop in the primer is a three-column shell (60px icon rail, fluid main, 400px sidebar, gaps 40px and 64px). This app does not use it: it is one centred column with a top header. Reach for the shell only if a screen truly needs a persistent sidebar.

### 2.2 Navigation per breakpoint

The primer describes floating translucent top and bottom navs with a pill and a gradient scrim for native mobile. This web app uses a simpler header at all widths (do not add a floating bar):

- Header (`header.top`): flex row, wrap, gap `16px 24px`; wordmark left (`.brand`, 700, 1.5625rem/1.2, -0.25px), nav right.
- Nav links: pills, min-height `--tap`, padding `0 18px`, weight 500, muted ink; hover `--hover` fill plus ink; current page (`aria-current="page"`) is ink on `--fog` fill. Gap 4px.
- Hosted nav reads Applications, People, Resume, Statistics, then a Settings gear (Lucide `settings`, 24px, stroke 2, `.icon-link`, padding `0 10px`).
- At 520px and below: the gear moves up into the title row (absolute, top -4px, right -8px), and the words sit on one full-width row below with `justify-content: space-between`, padding `0 4px`, 0.875rem, so four items fit one row and none orphan.
- Skip link first in the DOM (`.skip`, z-index `--z-skip`).
- Back link (`a.back`): `--tap` high, muted, Lucide chevron rotated 180 degrees.

### 2.3 Type ramp and weights

Family: `--font-ui` = `"Wealthsimple Sans Display", "Figtree", -apple-system, "SF Pro Display", system-ui, "Segoe UI", sans-serif`. Mono (system monospace) only for code and addresses in setup instructions. Weights are 400, 500, 700 only. Sizes are in rem so the browser text-size setting applies; the one exception is a 16px floor on phone inputs (stops iOS focus zoom).

| Role | Weight | Size / line-height | Tracking | Used for |
| --- | --- | --- | --- | --- |
| Display (`h1.page`) | 500 | `clamp(2rem, 4vw, 2.5rem)` / 1.2 | -0.8px | page headline, one per page |
| Brand | 700 | 1.5625rem / 1.2 | -0.25px | wordmark |
| Lede | 400 | `clamp(1.25rem, 2.2vw, 1.5625rem)` / 1.4, max 46ch | -0.25px | one-sentence summaries (Statistics) |
| Section (`h2.section`) | 500 | 1.25rem / 1.4 | -0.2px | section headings, company name in a group |
| Row / sub-heading | 500 | 1rem / 1.4 | 0 | row labels, panel headings, button text |
| Body | 400 | 1rem / 1.4 | 0.02px (0.9375rem in compact) | everything else |
| Reading text | 400 | 0.9375rem / 1.7, max 68ch | 0 | email bodies |
| Small | 400 | 0.875rem | 0 | dates, help text, field labels (500, muted), table headers (500, muted) |
| Label | 500 | 0.75rem | 0.18px | tags, plain badges, score pill |
| Hero number | 700 | `clamp(2rem, 4vw, 2.5rem)` / 1.2 | -0.8px | headline figures (primer: xlarge or xxlarge, bold) |

The primer's full scale for reference (size / line-height / tracking): xxsmall 10.5/14/0.21, xsmall 12/16/0.18, small 14/20/0.14, default 16/22/0.02, medium 20/28/-0.2, large 25/30/-0.25, xlarge 32/38/-0.64, xxlarge 40/48/-0.8. Smaller than xsmall (12px) is not used here (see rule 3.9).

### 2.4 Colour roles

Names are the app's tokens; the primer's names are in brackets. Light / dark:

| Token | Role | Light | Dark |
| --- | --- | --- | --- |
| `--bg` | page ground (background-primary) | #f2f2f2 | #000000 |
| `--surface` | cards, inputs, popups, secondary buttons (surface-background-primary) | #fafafa | #171717 |
| `--surface-hover` | hover of those surfaces | #ffffff | #1f1f1f |
| `--linen` | secondary surface: open row, expansion panel, code blocks (surface-background-secondary) | #ebebeb | #0f0f0f |
| `--fog` | inactive-bg: badges, chips, current tab, press tone | rgba(0,0,0,.05) | rgba(255,255,255,.07) |
| `--hover` | hover tone on rows, tabs, menu items | rgba(0,0,0,.04) | rgba(255,255,255,.04) |
| `--ink` | text-primary and strong-bg | #000000 | #ffffff |
| `--muted` | text-secondary: help, placeholders, chevrons | rgba(0,0,0,.55) | rgba(255,255,255,.5) |
| `--line` | outline: decorative dividers only | rgba(0,0,0,.08) | rgba(255,255,255,.12) |
| `--field-line` | borders a user must see (inputs, notices); 3:1 on the surface | #8c8c8c | #8a8a8a |
| `--accent` / `--accent-ink` | primary button fill and its text; default graphite | #000000 / #ffffff | #ffffff / #000000 |
| `--accent-end` | second gradient stop | accent mixed 16% toward white | accent mixed 12% toward black |

Accents the user can choose (replace only `--accent`): graphite #000000 / #ffffff, bronze #5c4b24 / #d9c28a, forest #2f5d46 / #8cc7a6, clay #8f4a32 / #e0a184.

The ink / muted / surface / raise vocabulary: **ink** is full-contrast text, **muted** is secondary text and quiet icons, **surface** is any raised thing, **raise** (`--raise`) is the shadow stack that makes it raised (2.6).

Stage colours: one map, defined once in `:root`. `--stage-X` is the graphic (dots, chart nodes); `--stage-X-text` is the same hue held to 4.5:1 for text.

| Stage | Graphic light / dark | Text light / dark |
| --- | --- | --- |
| Applied | #5b88d9 / #5b88d9 | #2b5fbb / #7198de |
| Heard back | #b27ee4 / #b27ee4 | #8634d4 / #b482e5 |
| Assessment | #e47eca / #e47eca | #ae248b / #e47eca |
| Interview | #eece2d / #eece2d | #736109 / #eece2d |
| Offer | #409652 / #4db565 | #2f6e3c / #4db565 |
| Rejected | #e22b18 / #ed4f3c | #be2414 / #f07161 |

Short aliases for text outside badges: `--offer`, `--rejected` (the `-text` values). Danger buttons, error notices and error text use `--rejected`.

The graphics are the primer's data-viz hues in order: 01 blue #5b88d9, 02 purple #b27ee4, 03 pink #e47eca, 04 yellow #eece2d, 05 green #409652 (dark #4db565), 06 orange #f7984a (dark #fab070). Negative red is #e22b18 (dark #ed4f3c). The primer's semantic tints, if ever needed (light / dark): positive soft #ddeedd / #172616, warning soft #eee9bf / #342d0f, negative soft #f8dad8 / #281211, highlight soft #e0e6f5 / #121c2a; strong text: positive #357941 / #6dc382, warning #7e6812 / #f5dd56, negative #c02416 / #f27868, highlight #305faa / #bacdf4. The app does not use the tints; chroma is reserved (rule 3.10).

Primer's text tiers beyond muted: text-tertiary 42% / 36% and text-inactive 30% / 26%. Not used here (they fail contrast for real text).

### 2.5 Radii

| Token | Value | Used for |
| --- | --- | --- |
| `--r-pill` | 999px | buttons, inputs, badges, chips, nav links, dropdown options |
| `--r-lg` | 20px | cards (primer: all cards are 20px) |
| `--r` | 12px | notices, textareas, popups, code blocks |
| `--r-seg` | 8px | Minimal segmented indicator (filter tabs), link hover tone |
| sharp setting | 3px | `data-corners="sharp"` collapses all four to 3px |

Never write a literal radius in a component. The primer also names 32px for floating bottom sheets (inset 8px from the sides, about 22px from the bottom, all four corners round); this app has no bottom sheet.

### 2.6 Shadows (raised surfaces)

Strokes plus one soft drop shadow, never a border. The outer stroke is a non-inset zero-blur spread, so it does not shrink the corner radius; inner strokes are `inset`.

- `--raise` light: `inset 0 0 0 1px #fff, 0 0 0 1px rgba(0,0,0,.05), 0 4px 12px rgba(0,0,0,.08)`
- `--raise-btn` light: same with the drop shadow at .10
- Dark: `--raise: inset 0 0 0 1px rgba(255,255,255,.05), 0 0 0 1px rgba(255,255,255,.08), 0 4px 12px rgba(0,0,0,.5)`; `--raise-btn` equals `--raise`
- Primary button (glass): `inset 0 1px 0 var(--btn-hi), inset 0 -1px 0 var(--btn-lo), 0 4px 12px var(--btn-drop)`. Light: hi rgba(255,255,255,.12), lo rgba(0,0,0,.5), drop rgba(0,0,0,.35). Dark: hi .55 white, lo .2 black, drop .5 black.
- Popups (dropdown list, suggestions, chart tooltip) use `--raise`.
- Layers: `--z-tip: 20`, `--z-pop: 30`, `--z-skip: 100`; the only ones in the app.

Card variants in the primer: Primary (raised, as above; the only one used for cards), Secondary (`--linen` fill, white outer stroke, 5% black inner stroke, no shadow; used as flat panels), Tertiary (transparent with `--line` outer stroke; the way to group inside a Primary card, along with dividers). Do not nest a raised card in a raised card, and never put a Secondary card inside a Primary one.

### 2.7 Buttons

All buttons: pill, `border: none` (always reset the user-agent border), font 500 1rem/1, tracking 0.02px, padding `0 24px`, min-height `--tap`.

| Variant | Fill | Text | Shadow | Notes |
| --- | --- | --- | --- | --- |
| Primary (`button.primary`, `a.btn.primary`) | `linear-gradient(180deg, --accent, --accent-end)` | `--accent-ink` | glass stack above | hover mixes both stops 14% toward `--bg`. One per view or form. |
| Secondary (default `button`, `.btn`) | `--surface`; hover `--surface-hover` | `--ink` | `--raise-btn` | the default; also the section action |
| Quiet / tertiary (`button.quiet`, `button.hist-del`) | `linear-gradient(180deg, --hover, --fog)` | `--ink` | none | Delete on a history row; an open action disclosure |
| Danger (`button.danger`) | as Secondary | `--rejected` | as Secondary | text colour only; the word still says what it does |
| Icon | a pill or circle button holding one Lucide icon, `--tap` square, Secondary or Quiet fill | `--ink` | per variant | needs an accessible name (`aria-label`) |
| Small | min-height `--tap-sm`, padding `0 14px` or `0 16px`, 0.875rem | | | `--tap-sm` = `--tap` minus 8px (36px); 44px on touch |

States: hover = surface-hover (Secondary) or lightened gradient (Primary); pressed = `transform: scale(0.97)`, 120ms ease-out; disabled = opacity .5, `cursor: not-allowed`; busy (`aria-busy="true"`) = `cursor: progress`. Press scale and a press background change are never layered.

Action disclosure (`details.action > summary`) is a Secondary pill in an action row that opens full width below; `.primary` gives the glass gradient; while open it turns Quiet.

Primer exception not used here: "key action" tiles (a full-width row of 72 to 76px tiles with 20px radius, icon only, label under the tile, at most one Primary). Use it only for an account-hero style row of shortcut actions.

### 2.8 Form controls

- Inputs and selects: pill, 1px `--field-line` border, `--surface` fill, padding `0 20px`, min-height `--tap`, `font: inherit`; focus changes the border to `--ink` and adds the focus ring. Disabled opacity .6.
- Textarea: 12px radius (`--r`), padding `14px 18px`, min-height 96px, line-height 1.5, full width, vertical resize.
- Labels (`label.field`, `.fgroup > label`): 0.875rem / 500 / `--muted`, 4px left inset, 6px above the control.
- Help text (`.help`): `--muted`, 0.875rem, 8px below.
- Placeholder: `--muted`, opacity 1.
- Checkbox and radio: `accent-color: var(--ink)`.
- Under 720px: input, select and textarea font-size 16px.
- Dropdowns: where `appearance: base-select` is supported the popup is themed (`--surface`, `--raise`, 12px radius, 8px padding, max-height `min(360px, 60vh)`); options are pill rows at `--tap`, hover `--hover`, selected option 500 with a Lucide check mask at the end; the closed select shows a 16px chevron-down mask that rotates 180 degrees when open. Other browsers keep the native select.
- Switches (primer; use for binary, immediately-applied settings only): pill track, off = `--fog` with `--line` stroke and a `--muted` thumb on the left; on = positive green (`#409652` / `#4db565`, never accent or black) with a white thumb on the right carrying a Lucide check in the same green; thumb inset about 3px; animate thumb `translateX` and track background.

### 2.9 Segmented controls and tabs

Two styles, not mix-and-match. Selected option is `--ink` at 500; unselected is `--muted` at 400 (selected is told apart by weight and fill, never colour alone). The indicator is grey (`--fog`), never white, coloured or accent, with no stroke or shadow of its own. 

- Default (`.seg` in `pages/settings/settings.css`: theme, density, corners): pill track styled as a Primary card (`--surface`, `--raise`), pill options inset 4px, radio inputs hidden, the checked one on `--fog` at 500.
- Section switcher (`.section-switcher` in `settings.css`: the Settings section links): the same pill track as Default, but a row of links, `aria-current="page"` on the open one, scrolls sideways when it does not fit. It is a Default-style control, not Minimal.
- Minimal (`.tabs` and `.tab` in `base.css`: filter tabs, List/Calendar, Resumes/Cover letters/Tailored): no track, no stroke; options are `--r-seg` (8px) rounded rectangles, min-height `--tap`, padding `0 16px` (`0 12px` on phones), gap 4px (2px on phones), count inline. Hover `--hover`; press `--fog` (tone, never scale); current `--fog` fill with ink at 500 and `aria-current="true"`.
- Document switch (`.doc-switch` in `components/documents/pageeditor.css`: Resume / Cover letter, Edit on page / Edit as list): Minimal look on buttons, `--tap-sm` high, current one has `aria-pressed="true"`.

The indicator of the Default control switches instantly in this app (a CSS-only form with no script); the primer would animate it.

Primer layout for a sidebar header: a Default segmented control on the left and one or two icon buttons on the right, vertically centred.

### 2.10 Cards, rows, lists

- Card (`.card`): `--surface`, `--raise`, `--r-lg`, padding `--pad`, margin-bottom `--section`. Mix carded and background-direct content for rhythm; when in doubt, skip the card.
- Rows (primer "row pattern"): three zones. Leading visual (Lucide 24px, never an emoji or a hand-drawn shape); name in 500 small-to-body size with a 0.875rem muted subtitle beneath; trailing value with a delta beneath. Hairline dividers (`1px solid var(--line)`) between rows inside one card. Hover `--hover`, press `--fog`; rows are interactive only if they act.
- Open or expanded row and its panel: `--linen`.
- Table list: header 0.875rem / 500 / muted; cells padded `--cell-y 16px`; `border-top: 1px solid var(--line)`.
- Phone (720px and below): each table row becomes a stacked grid block (`auto 1fr auto`): checkbox, company and role, stage right; last activity on its own line; column headers become pill sort buttons with the active sort filled with `--accent`.
- Notice: `--surface`, 1px `--field-line` border, 12px radius, padding `14px 20px` (checked against `.notice` in `base.css`; the 16px that DESIGN.md once mentioned is the icon, not the padding), 16px Lucide info icon (alert icon and `--rejected` border for errors). Never a coloured side-stripe.
- Badges: plain badge = pill on `--fog`, 0.75rem/500, padding `3px 12px`, tracking 0.18px. Stage badge = no pill: a 0.875rem/500 word in `--stage-X-text`, led by a 10px dot in `--stage-X` with an 8px gap and a hairline of the text colour at 40% so pale hues show on light. Tags: smaller pills, `--muted` text (step and note tags in ink).
- Section header plus action: header on the left, a Secondary button on the right, vertically centred in the same row; never stacked below, never Primary. A chevron (Lucide chevron-right, 16px, stroke 3, inherits ink) goes after the label only if the whole header navigates.
- Nested comparison (before and after values): a Tertiary box (hairline) with a chevron between two equal-width value blocks (label xsmall muted, value large bold).

### 2.11 Icons

- Lucide only, loaded from the official package, or as the official path data wrapped in a CSS mask. Never hand-author a path, never use emoji or unicode glyphs as icons.
- Two sizes only: 24px (stands alone, containers 56px or taller: nav, buttons with full height, list rows) and 16px (inline, chips, badges, dense rows, anything under 56px). Never 18, 20 or 28.
- Rendered stroke is 2px at every size: strokeWidth 2 at 24, 3 at 16 (rendered = strokeWidth x size / 24).
- Colour is `currentColor`. A multi-path icon must never take a semi-opaque colour (children overlap and smudge): use `--ink` and set `opacity` on the SVG (0.55 for muted). The app's CSS-mask icons are single flat fills, so those may take `--muted`.
- In this app: `--ico-chevron-right`, `--ico-chevron-down`, `--ico-check`, `--ico-arrow-up`, `--ico-arrow-down`, `--ico-info`, `--ico-alert` (all in `:root`, stroke 3, drawn at 16px with `mask` and `background: currentColor`, e.g. `.chev`). The Settings gear is an inline Lucide `settings` at 24px, stroke 2.
- Logos and avatars are rounded squares, not circles, radius about a quarter of the size (32px uses 8px). None are used here.

### 2.12 Tap targets, focus, hover, pressed

- Minimum control height `--tap` = 44px (36px in compact density; always 44px under `@media (pointer: coarse)`). Small controls use `--tap-sm` (36px, 44px on touch).
- Focus: `outline: 2px solid var(--ink); outline-offset: 3px` on `button, a, input, select, textarea, summary` via `:focus-visible`. Inputs also switch their border to ink. A heading or notice that takes programmatic focus after a move has no ring unless keyboard focus (`:focus-visible` gives it `border-radius: var(--r-seg)`).
- Hover: only on things that act (honest hover). Static cards, summaries and presentational blocks stay at rest and keep the default cursor. `cursor: pointer` follows the same rule.
- Pressed: standalone controls (buttons, action pills, interactive cards, banners) scale to 0.97 with `transform-origin: center`. Anything sharing edges with siblings (rows, tabs, segmented options, menu items) uses a tone change (`--fog`), never a scale.
- Links in running text: no underline; full-contrast ink at weight 500 with a `--hover` tone on hover (rule 3.3).

### 2.13 Dark mode

- Follows the system via `prefers-color-scheme`, and `data-theme="light|dark"` overrides it. The dark block is repeated in `:root:not([data-theme="light"])` inside the media query and `:root[data-theme="dark"]`; change both together.
- Ground pure black #000000, surfaces #171717 (hover #1f1f1f), secondary #0f0f0f, text white, muted 50% white, outline 12% white, field-line #8a8a8a. Stage text colours lift to the dark column in 2.4.
- Buttons: Primary becomes the white accent with black text; its glass highlight rises to .55 white; shadows deepen to .5 black.
- Never write `#000` or `#fff` in a component rule: use `--ink`, `--bg`, `--accent-ink`. Tokens carry the dark value, so no per-theme overrides in components.

### 2.14 Motion

All transitions sit inside `@media (prefers-reduced-motion: no-preference)`:
- background, border and colour: 0.16s ease-out
- press scale: 0.12s ease-out (120ms)
- chevron rotation (0 to 90 degrees, open disclosure): 0.16s ease-out
No other animation, no bounce, no parallax.

### 2.15 Data visualisation

Series colours follow the thing measured (applications use Applied blue, replies use Heard back purple), in numeric order of the palette; stages are the same colours as on the list. Axis and tick text is 12px in `--muted`, never in a series colour; gridlines are recessive hairlines at a few round values; marks are thin with a 4px rounded data end; no number on every mark. Segmented charts leave a small visible gap between segments with 2px rounded corners; donuts are filled annular wedges with butt caps, never stroked arcs with round caps. An unfinished period is a 45 degree hatch plus words ("Still coming in"). Each chart is drawn in a small coordinate space and capped at about 1.25 times its drawn width so text stays near its normal size.

## 3. Rules the owner enforces

1. **Sentence case, no uppercase.** No `text-transform: uppercase`, no small caps, no all-caps strings in headlines, labels, buttons, tabs, eyebrows, nav, badges, section headers. Exceptions: inherently uppercase acronyms (RRSP, TFSA, USD, ETF) and brand names, and the print resume (rule 17), whose classic template sets the name and section headings in capitals (`text-transform: uppercase` in `components/documents/resumesheet.css` and `pageeditor.css`).
2. **Weights 400, 500, 700 only.** One typeface everywhere (Wealthsimple Sans Display with the Figtree stand-in); mono only for code and addresses.
3. **No underlined links.** `text-decoration: none` on every anchor; a link in running text shows itself by full ink, weight 500 and a tonal hover.
4. **No tabular figures.** Never set `font-variant-numeric: tabular-nums`, including balances, tables and counts. Proportional figures are the default.
5. **State is never colour alone.** A stage is a word plus a dot; the current tab differs by weight and fill; a done step is a tick or filled mark plus the word; errors carry an icon and words; a provisional chart value is hatched and labelled.
6. **Hover (and pointer cursor) only on things that act.** A hover on something that does nothing on click is a lie. Static cards, empty states and summary panels stay at rest.
7. **A section action is a Secondary button**, right of the section header in the same row, vertically centred. Not stacked below, not Primary (a black pill in every section is noise). Exactly one Primary per view or form. In `pages/settings` there is no header-row action: each `h2.sec` heads a card, and the Primaries there (Save key, Unlock, Sync now, Reconnect account) are the one action of their card or row. "Add application" on the Applications page is the section-action pattern.
8. **Tokens, never raw hex.** Colour, radius and size come from `var(--...)`; no `#000` or `#fff` in component rules; no hard-coded px radii; every colour must work in light, dark and all four accents.
9. **12px minimum text** (0.75rem), for UI copy and for chart axis text. This is the owner's rule for this app; neither the primer nor the old DESIGN.md stated it. A grep of all CSS finds no font size under 0.75rem. Prefer 14px and up for anything a person must read; 12px is for tags, badges, axes. Never fake a smaller size by scaling.
10. **Colour is rationed.** Chroma is only for status (the stage map), the data-viz palette and the one chosen accent. A surface with a new colour needs a new status to justify it. No coloured side-stripes on cards, rows or notices. No new accent outside the four.
11. **Lucide only, 24 or 16, rendered stroke 2px.** No hand-drawn paths, no emoji, no semi-opaque colour on a multi-path icon.
12. **Pills for controls, 20px raised cards, hairlines inside cards.** Do not nest a raised card in a raised card. Mix carded and uncarded content.
13. **Generous space.** Fix a cramped layout by adding space, not by shrinking type or tightening gaps. The gutter is 16px at every width.
14. **Press: scale 0.97 for standalone controls, tone for anything in a container.** Never both on the same element.
15. **Reset the button border** (`border: none`); strokes come from shadows.
16. **Motion honours `prefers-reduced-motion`.**
17. **Document formats are the exception.** The resume sheet (`.doc-sheet.classic`: serif on white US letter, 10.5pt, ruled capital headings, black on white in light and dark) and print styles keep their own font and colours, because they are a document format the owner needs to match, not app UI. The exception stops at the sheet's edge; the page and controls around it follow this section.
18. **Prefer a sentence to a stat card.** Headline numbers are plain text (a 2rem value, a label, one line of context) with no boxes.

## 4. Where each rule lives in this app

| Rule | Token or file |
| --- | --- |
| Gutter 16px, container 1120px | `.wrap` in `web/src/styles/base.css` |
| Section spacing 32 / 64px (24 / 40 compact) | `--section` and its `min-width: 721px` queries in `base.css` |
| Card padding, row padding, gaps | `--pad`, `--cell-y`, `--gap` (compact values under `:root[data-density="compact"]`) |
| Sentence case, no tabular figures, no underline | `a { text-decoration: none }`, the `:is(p, li, ...) a` rule, and absence of `uppercase` / `tabular-nums` in all `web/src/**/*.css` (grep before merging) |
| Weights and family | `--font-ui`; `body` rule in `base.css`; `@font-face` Figtree |
| Type ramp | `h1.page`, `.brand`, `h2.section`, `.small`, `.help`, `.badge`, `.mail-text` in `base.css`; `.lede` in `pages/statistics/statistics.css` |
| Colour roles and dark mode | `:root`, `@media (prefers-color-scheme: dark)` and `:root[data-theme="dark"]` blocks in `base.css` |
| Accents | `--accent-l`, `--accent-d`, `--accent`, `--accent-ink`, `--accent-end` (set from Settings, `data-accent`) |
| State never colour alone | stage badge `::before` dot plus word (`.badge.Applied` ... in `base.css`); `.tab[aria-current="true"]`; `.setup-mark` and `.steps-mark` shapes; `.notice.err::before` icon |
| Radii | `--r-pill`, `--r-lg`, `--r`, `--r-seg`; `data-corners="sharp"` override |
| Shadows | `--raise`, `--raise-btn`, `--btn-hi`, `--btn-lo`, `--btn-drop` |
| Buttons | `button, .btn`, `button.primary`, `button.quiet`, `button.danger`, `button.hist-del`, `details.action > summary` in `base.css` |
| Section action = Secondary | default `button` style; no `primary` class on a section-header action (review in each page's JSX) |
| Form controls | `input, select, textarea`, `label.field`, `.fgroup`, `.help`, `@supports (appearance: base-select)` block in `base.css` |
| Tabs and segmented | `.tabs`, `.tab` in `base.css`; `.seg` and `.section-switcher` in `pages/settings/settings.css`; `.doc-switch` in `components/documents/pageeditor.css` |
| Icons | `--ico-*` masks and `.chev` in `base.css`; inline Lucide for the gear |
| Tap targets | `--tap`, `--tap-sm` (`@media (pointer: coarse)` forces 44px) |
| Focus ring | `:focus-visible` rule in `base.css` (2px ink, 3px offset) |
| Hover only on actors | `button:hover:not(:disabled)`, `a.btn:hover`, `tr.app-row:hover td`; static `.card` has no hover rule |
| Press | `button:active`, `a.btn:active`, `details.action > summary:active` scale; `.tab:active`, `tr.app-row:active td` tone |
| Motion | the `prefers-reduced-motion: no-preference` block at the end of `base.css` |
| Layers | `--z-tip`, `--z-pop`, `--z-skip` |
| Chart text and marks | `.viz-root` rules in `pages/statistics/statistics.css` (`.axis text` 12px, `--ink2` = `--muted`) |
| Document-format exception | `components/documents/resumesheet.css`, `pages/resume/print.css` |
| Design record | `DESIGN.md` (frontmatter tokens, Do's and Don'ts) |

## 5. Checklist for any new screen

Run all of these before calling it done.

1. Desktop (1120px and wider): content in the 1120px column, 16px gutter, 64px between sections, one Display heading, one Primary button at most.
2. 390px phone: nothing clips; every control is 44px high; inputs are 16px so iOS does not zoom; the header nav stays on one row at 520px and below; tables become stacked blocks (or get a card that scrolls, with the open panel pinned); no horizontal overflow (`document.documentElement.scrollWidth <= innerWidth`, check by eye and in devtools).
3. Dark mode: switch `data-theme="dark"` and the system setting; no hard-coded light colours, no invisible borders (inputs use `--field-line`), text meets 4.5:1 and graphics 3:1.
4. All finish settings: accent bronze, forest, clay; compact density; sharp corners. Nothing hard-codes a radius or colour.
5. Keyboard only: tab order follows reading order; every control shows the 2px ink ring; Enter and Space work on custom controls; focus moves to the right place after a step change or result; skip link works.
6. Screen reader: icon-only buttons have `aria-label`; state is in words (`aria-current`, `aria-expanded`, `aria-sort`, `aria-busy`); decorative icons are `aria-hidden`.
7. Text: sentence case, 12px minimum, weights 400/500/700 only, no underlined links, no tabular figures, no all caps.
8. Honest interaction: hover and pointer cursor only on things that act; standalone controls scale on press, items inside a container use a tone.
9. Icons: Lucide, 24 or 16, stroke 2 rendered, `currentColor`.
10. Reduced motion: transitions sit inside `prefers-reduced-motion: no-preference`.
11. Grep the new CSS for `#[0-9a-f]{3,6}`, `uppercase`, `tabular-nums`, `text-decoration: underline`, literal `border-radius: ` px values, `font-weight: 600`; each hit needs a reason.

## 6. Worked examples from this app

### 6.1 Setup row (`web/src/components/setup/setuprow.css`)
A hairline-divided list inside one card. Each row is `display: flex; gap: 14px; padding: 20px 0; border-top: 1px solid var(--line)`; the first row has no top border or padding. The leading mark is a 24px circle (`--r-pill`): not done = a 2px `--field-line` ring with muted ink; done = filled `--ink` with `--bg` tick (`.setup-row.done .setup-mark`). The title is `font: 500 1rem/1.4 var(--font-ui)`; beside it a 0.875rem word ("Connected", "Not set up") that is muted when open and ink at 500 when done. State therefore reads from the mark shape and the word, not colour. Help text sits below at 12px spacing. No hover, because the row itself does not act; the buttons inside do.

### 6.2 Step strip (`web/src/pages/resume/steps.css`)
A wrapping flex list (`gap: 8px 24px`) of four items, each `min-height: var(--tap)`. The 24px mark is an outlined circle with a number (`box-shadow: inset 0 0 0 1px var(--field-line)`, 0.75rem/500) for steps not reached; the current step fills it with `--accent` and `--accent-ink` and sets the label to ink at 500; a finished step takes `--fog` fill with a tick. Finished steps collapse to hairline-divided one-line rows in a card with a small "Change" button (`--tap-sm`, 0.875rem) at the end (`margin-left: auto`). The open step's heading is `--section` 1.25rem with a 28px accent number chip, and it takes a visible `:focus-visible` ring (`outline: 2px solid var(--ink); outline-offset: 3px`) because focus moves to it on each step change.

### 6.3 Card (`.card` in `web/src/styles/base.css`)
`background: var(--surface); box-shadow: var(--raise); border-radius: var(--r-lg); padding: var(--pad); margin-bottom: var(--section)`. No border, no hover, no pointer cursor. The "Finish setting up" card (`components/setup/setupcard.css`) reuses it as a flex row (`justify-content: space-between; gap: var(--gap)`) with a 500 1rem title, a muted next-step line, and a button group that gets `min-height: var(--tap)` at 600px and below. Groups inside a card use dividers or a `--linen` panel, never a second raised card.

### 6.4 Button set (`button`, `.btn`, `button.primary`, `button.quiet`, `button.danger` in `base.css`)
In a form: one Primary (the Save), Secondary for alternatives, Quiet for low-weight actions such as Delete on a history row, and Danger as a Secondary whose label is `--rejected`. Shared: pill, `border: none`, `min-height: var(--tap)`, `padding: 0 24px`, 500 1rem. Primary is `linear-gradient(180deg, var(--accent), var(--accent-end))` with the glass inner strokes and `0 4px 12px var(--btn-drop)`; Secondary is `--surface` with `--raise-btn`, hover `--surface-hover`; Quiet is `linear-gradient(180deg, var(--hover), var(--fog))` and no shadow. All scale to 0.97 on `:active`, 50% opacity when disabled. When a Primary appears (Save in an open Add form), the other action steps down to Secondary. A section action ("Add application", "See all") is always Secondary, in the header row.

### 6.5 Chart text (`web/src/pages/statistics/statistics.css`, root class `.viz-root`)
Tokens are re-mapped once at the chart root: `--viz-surface: var(--surface)`, `--ink2: var(--muted)`, `--hair: var(--line)`. Axis and tick text is `fill: var(--ink2); font-size: 12px` (never a series colour); direct labels are `fill: var(--ink); 14px; weight 500` with a 4px halo in the surface colour (`paint-order: stroke`) so they stay readable over marks; sub-labels are 13px `--ink2`. The tooltip is a `--viz-surface` box with `--raise`, `--r` radius, `padding: 10px 14px`, 0.875rem, `z-index: var(--z-tip)`. Headline numbers are `font: 700 clamp(2rem, 4vw, 2.5rem)/1.2` at -0.8px with a muted 0.9375rem label and 0.875rem context line, no box. Stage fills come from `--stage-*` so a stage is the same colour as on the list, and every chart has a Table view so the data never depends on colour or hover.

## 7. Verified against the code (and known deviations)

Greps run over `web/src/**/*.css` when this file was written:

- `uppercase`: three hits, all in the resume document format (rule 17): `resumesheet.css` lines 11 and 15 (name and section headings of the classic sheet) and `pageeditor.css` line 36 (the editable field inside one). No UI uses it.
- `tabular-nums`: none, in CSS or TSX.
- `text-decoration: underline`: one hit, `components/documents/review.css` `.tailor-changed`, a dotted underline that marks changed words in a tailored resume. It is a change mark, not a link, but it does break the letter of rule 3. Every anchor sets `text-decoration: none`.
- Font sizes under 12px: none. Sizes in use are 0.75, 0.875, 0.9375, 1, 1.25rem and the display clamps, plus 0.8125rem (13px) in 11 places, 12px and 13px chart text, and print point sizes (10.5, 11 and 18pt). 0.8125rem is not on the type ramp; prefer 0.875rem.
- Notice padding is `14px 20px` in `base.css` and the frontmatter; both agree.

Re-run these greps before each release (checklist item 11).
