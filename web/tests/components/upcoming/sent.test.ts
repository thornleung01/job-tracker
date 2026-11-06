// @vitest-environment jsdom
// "Sent: <resume>" under an interview on Coming up and in the calendar's rows, for the rows that carry a resume title.
import { createElement, createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { $, $$, cleanup, freshDb, mountPage, text } from "../../pages/applications/harness";
import type { PageProps } from "../../../src/app/pageProps";
import { CalendarAgenda } from "../../../src/components/calendar/CalendarAgenda";
import { CalendarDayPanel } from "../../../src/components/calendar/CalendarDayPanel";
import { ComingUp } from "../../../src/components/upcoming/ComingUp";
import { calendarEvents, type CalendarRow } from "../../../src/sync/calendar";
import type { UpcomingRow } from "../../../src/sync/upcoming";

afterEach(cleanup);

const TODAY = "2026-11-05";

const upcoming = (id: number, company: string, o: Partial<UpcomingRow> = {}): UpcomingRow => ({ id, company, role: "Analyst", nextInterview: "2026-11-06", stage: "Interview", ...o });
const Page = (rows: UpcomingRow[]) => (p: PageProps) => createElement(ComingUp, { rows, today: TODAY, db: p.db });
const sentOf = (c: HTMLElement) => $$(c, ".coming-up-row").map((r) => text($(r, ".coming-up-sent")));

describe("Coming up", () => {
  it("shows Sent: and the resume's title inside the one link for a row that carries one", async () => {
    const { container } = await mountPage(Page([upcoming(1, "Acme", { resumeTitle: "Analyst v2" }), upcoming(2, "Beta")]), freshDb());
    expect(sentOf(container)).toEqual(["Sent: Analyst v2", ""]);
    // one link per row, and nothing nested in it
    for (const r of $$(container, ".coming-up-row")) {
      expect(r.tagName).toBe("A");
      expect($$(r, "a, button")).toHaveLength(0);
    }
    expect($$(container, ".coming-up-row")).toHaveLength(2);
  });

  it("shows nothing for a row with a null title (no resume, or one that was deleted)", async () => {
    const { container } = await mountPage(Page([upcoming(1, "Acme", { resumeTitle: null })]), freshDb());
    expect(text($(container, ".coming-up-row"))).toContain("Acme");
    expect($(container, ".coming-up-sent")).toBeNull();
  });

  it("works without a database", async () => {
    const { container } = await mountPage(() => createElement(ComingUp, { rows: [upcoming(1, "Acme", { resumeTitle: "Analyst v2" })], today: TODAY }), freshDb());
    expect(sentOf(container)).toEqual(["Sent: Analyst v2"]);
  });
});

describe("the calendar's event rows", () => {
  const row: CalendarRow = { id: 1, company: "Acme", role: "Analyst", stage: "Interview", appliedAt: "2026-11-01T12:00:00Z", lastActivity: null, followUp: false, interviewDays: ["2026-11-06"] };
  const events = (resumeTitle?: string) => calendarEvents([{ ...row, resumeTitle }], [], TODAY, { from: "2026-11-01", to: "2026-11-30" });

  it("shows Sent: on the interview in the agenda, and not on the applied event", async () => {
    const { container } = await mountPage(() => createElement(CalendarAgenda, { month: "2026-11", today: TODAY, events: events("Analyst v2") }), freshDb());
    const rows = $$(container, ".cal-event");
    const byKind = Object.fromEntries(rows.map((r) => [text($(r, ".cal-event-kind")), text($(r, ".cal-event-sent"))]));
    expect(byKind).toEqual({ Interview: "Sent: Analyst v2", Applied: "" });
    for (const r of rows) {
      expect(r.tagName).toBe("A");
      expect(r.getAttribute("href")).toBe("#/app/1");
      expect($$(r, "a")).toHaveLength(0);
    }
  });

  it("shows it in the day panel too, and nothing when the row has no resume title", async () => {
    const panel = (title?: string) => () =>
      createElement(CalendarDayPanel, { day: "2026-11-06", events: events(title).get("2026-11-06") ?? [], headingRef: createRef<HTMLHeadingElement>(), onEscape: () => {} });
    const withTitle = await mountPage(panel("Analyst v2"), freshDb());
    expect(text($(withTitle.container, ".cal-event-sent"))).toBe("Sent: Analyst v2");
    await cleanup();
    const without = await mountPage(panel(), freshDb());
    expect($(without.container, ".cal-event-sent")).toBeNull();
    expect(text($(without.container, ".cal-event"))).toContain("Acme");
  });
});
