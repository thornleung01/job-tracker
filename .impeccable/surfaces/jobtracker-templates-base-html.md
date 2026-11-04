---
version: 1
slug: "jobtracker-templates-base-html"
primary_target: "jobtracker/templates/base.html"
related_targets: ["jobtracker/templates/index.html","jobtracker/templates/flow.html","jobtracker/templates/settings.html","jobtracker/templates/detail.html","jobtracker/templates/review.html"]
---

# Surface brief: Job Tracker (whole app)

## Scope and mode
Operate. Every page: Applications list (rows expand in place), Flow (Sankey), Needs review, Application detail, Settings. Visual restyle only; behavior, URLs, copy facts, and data do not change.

## Audience, job, constraints
One person tracking their own job search on a local PC, who also shows the app to others. Job: see where each application stands, log notes and steps, read the emails behind a status. Works offline, so type is self-hosted. WCAG AA in light and dark. Settings (theme, accent, density, corners, columns) keep working, re-skinned.

## Direction (brief-pinned, not rolled)
Wealthsimple's styling from the `use-ws-styling` prototype primer: light grey ground, raised near-white surfaces, true black text, one sans typeface, pill controls, Lucide icons, soft raised strokes and shadows, no uppercase. Wealthsimple's name, logo and proprietary typeface files are not used; Figtree stands in, with Wealthsimple Sans Display named first for devices that have it.

## Direction contract

THESIS: A calm ledger for an anxious, personal moment. The app speaks in plain sentences and one sans typeface, not dashboard widgets, and refuses the metric-card grid and the colored-accent SaaS look.

OWN-WORLD: Background #f2f2f2 with raised #fafafa surfaces (white inner stroke, 5% black outer stroke, soft drop shadow), true black text, 55% black secondary text, 8% black outlines, black glass gradient primary pills, raised secondary pills, grey rounded-rectangle selected tabs. Stage badges are quiet tonal pills with the primer's strong semantic text colors. Figtree (Wealthsimple Sans Display when installed) at weights 400, 500 and 700; 16px gutter; 20px cards with 16px padding; 32px between sections on a phone and 64px on the web. Dark theme is pure black with #171717 surfaces. The Sankey takes the data-viz palette in numeric order with green for an offer and red for a rejection. Lucide icons only.

STORY: The visitor sees at a glance where their search stands and trusts that every status traces to a real email. Everything is legible and quiet; nothing shouts.

FIRST VIEWPORT: Applications page. Top bar: bold "Job Tracker" left, text nav right with the current page in a grey pill. Below: a large sans page headline, then a row of filter tabs (All, Applied, Heard back, Assessment, Interview, Offer, Rejected) each with its count, then the labeled search/stage/account row with a black glass "Apply filters" pill, then the result line, then the table on a raised card with hairline row dividers, 500-weight company names, and tonal stage pills. Primary action sits at the end of the filter row.

FORM: Standard Operate shell (top bar, tabs-as-filters, sortable table, forms). Signature move: raised surfaces and glass pills over a quiet grey ground, with the Flow page's sentence summary in place of a stat-card row. Pinned by the brief (not rolled); seed key: pinned-wealthsimple.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
