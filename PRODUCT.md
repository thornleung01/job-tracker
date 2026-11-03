# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
One person running a job search, on their own Windows PC. They open the app daily or weekly to see where each application stands (applied, heard back, assessment, interview, offer, rejected), log notes and steps, and read the Flow chart. They also show it to other people (screenshots, demos), so it has to hold up as a presentation piece as well as a daily tool.

## Product Purpose
A local, private job-application tracker. It reads Gmail and Outlook (read-only by default; sending a reply is an opt-in permission per account, used only when the user writes and sends one), recognises application emails with editable rules (no AI), and turns them into a list of applications with a stage, a history, and a Sankey flow of where applications went. Success is that the user never has to search an inbox to know the status of an application.

## Positioning
Everything comes from the user's own email and stays on their machine: no account, no cloud, no AI reading the mail. Each application's history is the real emails behind it, and every email can be opened.

## Operating Context
FastAPI + SQLite + server-rendered Jinja templates, no JavaScript framework, bound to 127.0.0.1. Used on desktop mostly, sometimes on a phone-width window. Works offline (no CDNs), so any typeface must be served from the project.

## Capabilities and Constraints
- Pages: Applications (sortable, filterable list; rows expand in place to log notes and dated steps and to read emails), Flow (Sankey chart with a table equivalent), Needs review (emails the rules were unsure about), Application detail, Settings (accounts and sync, appearance; deliberately kept simple, with no email-filter rules).
- Appearance settings are user-facing and must keep working: theme (system/light/dark), accent color, density (comfortable/compact), corners (soft/sharp), list columns, default Flow period.
- Behavior, copy facts, URLs, form names, and data are not changing. This is a visual restyle.
- No em-dashes in UI copy.

## Brand Commitments
- Visual direction is pinned by the user: **Wealthsimple's aesthetic** (warm, near-monochrome, editorial; display serif over a clean sans; graphite ink on paper/linen; pill buttons; hairline borders; no shadows or gradients).
- The app keeps its own name, "Job Tracker". It does not use Wealthsimple's name, logo, wordmark, or proprietary typefaces; look-alike free typefaces are used instead.

## Evidence on Hand
Reference reading of Wealthsimple's visual system came from third-party style references (graphite #32302f, paper #fcfcfc, linen #faf8f5, stone #e4e2e1, pebble #686664, charcoal #09090a, bronze #3a3525; Tiempos display serif over The Future sans; pill buttons; no shadows). These are unofficial and were not checked against Wealthsimple's own brand files. No imagery assets exist.

## Product Principles
1. Facts first: a status, a date, and a source email are always one click apart.
2. Calm over clever: the user checks this while anxious about outcomes; nothing should shout.
3. Private by construction: local, read-only unless the user turns replying on, no external services.
4. Everything is reversible and visible: filters show, manual stages say they were set by the user.

## Accessibility & Inclusion
WCAG AA contrast in light and dark, visible keyboard focus, color never the only signal, full keyboard operation, text that follows browser text size, 44px touch targets on touch screens.
