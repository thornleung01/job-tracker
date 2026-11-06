# Plan: calendar view on the Applications page

Status: **Built** (2026-11-05, branch `quality-of-life`). Written from a read-only design pass over the code, then built to this plan with one change: weeks start on Monday (see Decisions). The user-facing description is in `web/README.md`, "Calendar view".

## What it is

A **List | Calendar** toggle on the Applications page. The calendar is a month grid showing interviews, applied dates, offer decision deadlines, follow-up due dates and the steps you logged. It uses the same filters as the list, so "Interview stage, this search" narrows both views. Choosing a day opens a panel under the grid listing that day's events, each linking to its application. On a phone it becomes an agenda list instead of a grid.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Separate page or a toggle? | A toggle on the Applications page. State lives in the address (`view=calendar`, `month=YYYY-MM`, `day=YYYY-MM-DD`). | The filters, add form, stage tabs and "Coming up" strip are all in that page. The address already holds every filter, so reload and Back work. |
| History | Toggling and filter changes add history entries. Moving between months and days replaces the entry. | Back leaves the page instead of stepping through months. |
| Where does the data come from? | The page's existing list query (already filtered), plus one small read of logged steps for the visible range. No second email load. | Switching view or month never re-reads emails. |
| Interview days | Every interview day per application (`interviewDays`), computed in the same single pass that today computes the next one. `nextInterviewDay` keeps its behaviour. | One parse per application, no regression. |
| Week start | **Monday, final.** `WEEK_START` in `db/time.ts` is 1 (0 is Sunday). (The plan said the browser's locale, falling back to Sunday. That was dropped: there is no locale lookup.) | It matches the weekly goal, which runs Monday to Sunday, so a week looks the same on both. No new setting. The goal and the calendar both read the one constant, so changing that line moves both together (`tests/sync/weekStart.test.ts`). |
| Phone | At 720 px wide or less, render an agenda list for the month instead of a grid (never both). | A seven-column grid doesn't fit a phone. |

## What appears on a day

| Kind | When | Label |
|---|---|---|
| Interview | Every interview day. Future days are hidden for Rejected and Offer applications. | Interview |
| Applied | The day you applied. | Applied |
| Offer | At Offer stage with a decision deadline. A past deadline is shown. | Offer decision due |
| Follow-up | Applied or Heard back applications: last activity plus 7 days. | Follow up due, or Follow up was due when it's past and the tag shows |
| Step | A step you logged (not "Applied", and not "Interview" on a day that already has an interview). | The step's name |

Each kind has its own icon and a visible text label, so nothing relies on colour alone. Stage colour appears only through the existing stage dot and word. Past events show a "Past" label.

## Grid behaviour and accessibility

- `role="grid"` with a roving tab stop. Arrow keys move by day or week, Home and End go to the row ends, Page Up and Page Down change month, Enter or Space opens the day, Escape returns from the panel to the cell.
- Today has `aria-current="date"` and a ring. Each cell's label gives the date and the event count and kinds, for example "Thursday, October 15, 2026. 2 events: interview, follow up due".
- Previous, Next and Today buttons. The month heading is a live region.
- Forced-colors and reduced-motion rules, no underlines, 44 px-class tap targets for controls.
- All days are viewer-local `YYYY-MM-DD` values from the shared day helpers in `db/time.ts` (never a sliced ISO string). Events carry a day, not a time.

## Files, in build order

1. `db/time.ts` (add `shiftDay`, `daysInMonth`, and later the shared week: `WEEK_START`, `weekdayOf`, `startOfWeek`), `db/dayText.ts` (export `MONTHS` and `WEEKDAY_NAMES`), `sync/upcoming.ts` (add `meetingDays`, export `WEEKDAYS`; `nextInterviewDay` built on it).
2. `sync/queries.ts`: `interviewDays` on `ApplicationListRow`, computed in the existing pass.
3. `sync/calendarGrid.ts`: `monthGrid`, `gridRange`, `shiftMonth`. The week itself (`WEEK_START`, `weekdayOf`, `startOfWeek`) lives in `db/time.ts`, shared with the weekly goal.
4. `sync/calendar.ts`: `calendarEvents(rows, steps, today, range)`, `calendarSteps(db, from, to)`.
5. `pages/applications/index.tsx`: `view`, `month`, `day` in the address state, one `keep` object spread at every navigation call so no link can drop the view, the toggle, and the conditional render.
6. `components/calendar/`: `CalendarGrid`, `DayCell`, `CalendarDayPanel`, `CalendarAgenda`, `eventMeta`, `useMediaQuery`, and `calendar.css`.
7. `CalendarExport.tsx`: "Download interviews (.ics)" on a day with interviews and "Download this month's interviews", using the `.ics` builder from the quality-of-life work.
8. Docs: README, DESIGN.md and PRODUCT.md entries.

Steps 1 to 4 need no UI and can be built and tested first. Steps 6 and 7 can run in parallel against the types from step 4.

## Tests

- Grid maths: February in a common and a leap year, December to January, every first weekday, month shifts across years.
- Events: each kind on its day, the hidden-future rule, follow-up day and "was due", offer only at Offer, step de-duplication, inclusive range edges, deterministic order, and a 1,000-application performance guard.
- Time zones: a sweep over every whole-hour zone plus Toronto, Sydney and Lord Howe around daylight-saving changes, month boundaries and the grid's first and last days.
- Page: the grid renders with today marked, month moves change the address, filters carry across the toggle, keyboard navigation, reload restores the day, "Coming up" is hidden in calendar view, the phone agenda replaces the grid, event counts in cell labels.
- Export: the download button appears only for days with interviews.

## Risks

- A navigation call that forgets `view` drops you back to the list. The shared `keep` object plus a test per navigation covers it.
- Adding `interviewDays` to the row type can break exact-equality tests. Six test files touch `listApplications`, so run them first.
- Interview days are guessed from email text and can be wrong or missing, so they are labelled "Interview" (not confirmed) and link to the application.

## As built

- The files are as listed above, with `EventRow.tsx` and `CalendarView.tsx` added in `components/calendar/` (the view puts the heading, grid, day panel and agenda together) and the export button in `CalendarExport.tsx`. The grid keeps one tab stop and uses the keys in the table above, with Home and End going to the ends of the week.
- Coming up and Compare offers are hidden in the calendar view. The weekly goal shows in both views.
- The `.ics` files are named `job-tracker-interviews-YYYY-MM-DD.ics` for a day and `job-tracker-interviews-YYYY-MM.ics` for a month. Only interviews go in them. They are all-day events and are made on the device.
- The demo data gets 3 demo interview invitations (2, 6 and 11 days from today) so a new visitor sees interviews on the calendar.
- Interview days are still guessed from email text and can be wrong or missing. The grid labels them "Interview" and links to the application.
- Tests: `tests/sync/calendar.test.ts`, `tests/sync/calendarGrid.test.ts`, `tests/components/calendar/`, `tests/pages/applications/calendar.test.ts` and `calendar-demo.test.ts`.

## Out of scope

Time-of-day events, week or timeline views, Google or Outlook Calendar sync, drag-and-drop rescheduling, creating events from the calendar, a week-start setting, a new database index, and notifications.
