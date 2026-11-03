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
Wealthsimple's aesthetic, as read from third-party style references (unofficial): warm near-monochrome, editorial, graphite ink on paper and linen, display serif over a clean sans, pill buttons, hairline borders, no shadows, no gradients, no brand accent colors. Wealthsimple's name, logo, and proprietary typefaces are not used; Source Serif 4 and Figtree stand in.

## Direction contract

THESIS: A calm editorial ledger for an anxious, personal moment. The app speaks in sentences and serif headlines, not dashboard widgets, and refuses the metric-card grid and the colored-accent SaaS look.

OWN-WORLD: Linen ground (#faf8f5) with paper-white (#fdfdfc) surfaces, graphite ink (#32302f), pebble secondary text (#686664), stone hairlines (#e4e2e1), charcoal/graphite filled pill buttons, outlined graphite pills for secondary actions. Stage badges are quiet tonal pills on fog (#f1f0f0) with muted earthy text colors. Source Serif 4 for headlines, company names, and the Flow sentence; Figtree for everything else. Radii: pills for buttons, badges, inputs, tabs; 24px cards; no shadows. Dark theme is bronze-black (#12110e) with warm surfaces, not blue-grey. Sankey ramp is a warm sand-to-bronze ordinal scale with muted green (offer) and brick (rejected).

STORY: The visitor sees at a glance where their search stands and trusts that every status traces to a real email. Everything is legible and quiet; nothing shouts.

FIRST VIEWPORT: Applications page. Top bar: serif "Job Tracker" left, text nav right with the current page in a fog pill. Below: a large serif page headline, then a row of pill filter tabs (All, Applied, Heard back, Assessment, Interview, Offer, Rejected) each with its count, then the labeled search/stage/account row with a filled graphite "Apply filters" pill, then the result line, then the table on a paper card with hairline row dividers, serif company names, and tonal stage pills. Primary action sits at the end of the filter row.

FORM: Standard Operate shell (top bar, tabs-as-filters, sortable table, forms). Signature move: the serif editorial voice, shown as page headlines, company names, and the Flow page's sentence summary in place of a stat-card row. Pinned by the brief (not rolled); seed key: pinned-wealthsimple.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
