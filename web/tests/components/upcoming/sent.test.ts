// @vitest-environment jsdom
// "Sent: <resume>" under an interview on Coming up and in the calendar's rows, and nothing for a deleted or missing resume.
import { createElement, createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { $, $$, addApp, cleanup, freshDb, mountPage, text, waitFor } from "../../pages/applications/harness";
import type { PageProps } from "../../../src/app/pageProps";
import { CalendarAgenda } from "../../../src/components/calendar/CalendarAgenda";
import { CalendarDayPanel } from "../../../src/components/calendar/CalendarDayPanel";
import { ComingUp } from "../../../src/components/upcoming/ComingUp";
import { calendarEvents, type CalendarRow } from "../../../src/sync/calendar";
import { createVersion, deleteDocument, restoreDocument, setApplicationResume } from "../../../src/sync/documents";
import type { UpcomingRow } from "../../../src/sync/upcoming";

afterEach(cleanup);

const TODAY = "2026-11-05";
const body = [{ id: "", heading: "Experience", items: [{ id: "", text: "Built a thing" }] }];

const upcoming = (id: number, company: string, o: Partial<UpcomingRow> = {}): UpcomingRow => ({ id, company, role: "Analyst", nextInterview: "2026-11-06", stage: "Interview", ...o });
const Page = (rows: UpcomingRow[]) => (p: PageProps) => createElement(ComingUp, { rows, today: TODAY, db: p.db });
const sentOf = (c: HTMLElement) => $$(c, ".coming-up-row").map((r) => text($(r, ".coming-up-sent")));

describe("Coming up", () => {
  it("shows Sent: and the resume's title inside the one link for an application with a live resume", async () => {
    const db = freshDb();
    const acme = await addApp(db, "Acme", { stage: "Interview" });
    const beta = await addApp(db, "Beta", { stage: "Interview" });
    const v2 = await createVersion(db, { title: "Analyst v2", sections: body });
    await setApplicationResume(db, acme, v2);
    const { container } = await mountPage(Page([upcoming(acme, "Acme"), upcoming(beta, "Beta")]), db);
    await waitFor(() => sentOf(container)[0] !== "", "the resume title");
    expect(sentOf(container)).toEqual(["Sent: Analyst v2", ""]);
    // one link per row, and nothing nested in it
    for (const r of $$(container, ".coming-up-row")) {
      expect(r.tagName).toBe("A");
      expect($$(r, "a, button")).toHaveLength(0);
    }
    expect($$(container, ".coming-up-row")).toHaveLength(2);
  });

  it("hides it when the resume is deleted, though the application still points at it, and shows it again after Restore", async () => {
    const db = freshDb();
    const acme = await addApp(db, "Acme", { stage: "Interview" });
    const v2 = await createVersion(db, { title: "Analyst v2", sections: body });
    await setApplicationResume(db, acme, v2);
    const { container } = await mountPage(Page([upcoming(acme, "Acme")]), db);
    await waitFor(() => sentOf(container)[0] === "Sent: Analyst v2", "the resume title");
    await deleteDocument(db, v2);
    await waitFor(() => sentOf(container)[0] === "", "the title to go");
    expect((await db.applications.get(acme))?.resumeId).toBe(v2);
    expect(text(container)).not.toContain("Sent");
    await restoreDocument(db, v2);
    await waitFor(() => sentOf(container)[0] === "Sent: Analyst v2", "the title to return");
  });

  it("hides it when the id points at no resume at all", async () => {
    const db = freshDb();
    const acme = await addApp(db, "Acme", { stage: "Interview" });
    await db.applications.update(acme, { resumeId: 404 });
    const { container } = await mountPage(Page([upcoming(acme, "Acme")]), db);
    expect(text($(container, ".coming-up-row"))).toContain("Acme");
    expect($(container, ".coming-up-sent")).toBeNull();
  });

  it("uses a row's own resumeTitle, and works without a database", async () => {
    const db = freshDb();
    const { container } = await mountPage((p: PageProps) => createElement(ComingUp, { rows: [upcoming(1, "Acme", { resumeTitle: "Analyst v2" })], today: TODAY }), db);
    expect(sentOf(container)).toEqual(["Sent: Analyst v2"]);
  });
});

describe("the calendar's event rows", () => {
  const row: CalendarRow = { id: 1, company: "Acme", role: "Analyst", stage: "Interview", appliedAt: "2026-11-01T12:00:00Z", lastActivity: null, followUp: false, interviewDays: ["2026-11-06"] };
  const events = (titles?: ReadonlyMap<number, string>) => calendarEvents([row], [], TODAY, { from: "2026-11-01", to: "2026-11-30" }, titles);

  it("shows Sent: on the interview in the agenda, and not on the applied event", async () => {
    const db = freshDb();
    const { container } = await mountPage((p: PageProps) => createElement(CalendarAgenda, { month: "2026-11", today: TODAY, events: events(new Map([[1, "Analyst v2"]])) }), db);
    const rows = $$(container, ".cal-event");
    const byKind = Object.fromEntries(rows.map((r) => [text($(r, ".cal-event-kind")), text($(r, ".cal-event-sent"))]));
    expect(byKind).toEqual({ Interview: "Sent: Analyst v2", Applied: "" });
    for (const r of rows) {
      expect(r.tagName).toBe("A");
      expect(r.getAttribute("href")).toBe("#/app/1");
      expect($$(r, "a")).toHaveLength(0);
    }
  });

  it("shows it in the day panel too, and nothing when the application has no resume title", async () => {
    const db = freshDb();
    const panel = (titles?: ReadonlyMap<number, string>) => (p: PageProps) =>
      createElement(CalendarDayPanel, { day: "2026-11-06", events: events(titles).get("2026-11-06") ?? [], headingRef: createRef<HTMLHeadingElement>(), onEscape: () => {} });
    const withTitle = await mountPage(panel(new Map([[1, "Analyst v2"]])), db);
    expect(text($(withTitle.container, ".cal-event-sent"))).toBe("Sent: Analyst v2");
    await cleanup();
    const without = await mountPage(panel(), freshDb());
    expect($(without.container, ".cal-event-sent")).toBeNull();
    expect(text($(without.container, ".cal-event"))).toContain("Acme");
  });
});
