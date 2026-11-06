// "Sent: <resume>" on Coming up and the calendar: which applications have a resume title to show, and which events carry it.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { createApplication } from "../../src/db/repo";
import type { JobTrackerDB } from "../../src/db/schema";
import { calendarEvents, type CalendarRow } from "../../src/sync/calendar";
import { createVersion, deleteDocument, eraseDocument, restoreDocument, setApplicationResume } from "../../src/sync/documents";
import { deleteApplication } from "../../src/sync/actions";
import { resumeTitlesByApp } from "../../src/sync/upcoming";
import { closeAll, freshDb } from "./helpers";

afterEach(closeAll);

const NOW = new Date("2026-11-05T15:00:00Z");
const body = [{ id: "", heading: "Experience", items: [{ id: "", text: "Built a thing" }] }];

async function app(db: JobTrackerDB, company: string): Promise<number> {
  return createApplication(db, { company, companyKey: company.toLowerCase(), role: "Analyst", roleKey: "analyst", stage: "Interview", when: "2026-11-01T12:00:00Z" });
}

describe("resumeTitlesByApp", () => {
  it("maps each application to the title of the live resume it was sent with, and leaves out the rest", async () => {
    const db = freshDb();
    const [a, b, none] = [await app(db, "Acme"), await app(db, "Beta"), await app(db, "Gamma")];
    const v2 = await createVersion(db, { title: "Analyst v2", sections: body }, NOW);
    await setApplicationResume(db, a, v2);
    await setApplicationResume(db, b, v2);
    const titles = await resumeTitlesByApp(db);
    expect(titles.get(a)).toBe("Analyst v2");
    expect(titles.get(b)).toBe("Analyst v2");
    expect(titles.has(none)).toBe(false);
  });

  it("shows nothing once the resume is deleted, though the application still points at it, and again after Restore", async () => {
    const db = freshDb();
    const a = await app(db, "Acme");
    const v2 = await createVersion(db, { title: "Analyst v2", sections: body }, NOW);
    await setApplicationResume(db, a, v2);
    await deleteDocument(db, v2, NOW);
    expect((await db.applications.get(a))?.resumeId).toBe(v2);
    expect((await resumeTitlesByApp(db)).size).toBe(0);
    await restoreDocument(db, v2);
    expect((await resumeTitlesByApp(db)).get(a)).toBe("Analyst v2");
  });

  it("shows nothing for a resume id that points at nothing, or at a resume that was erased", async () => {
    const db = freshDb();
    const a = await app(db, "Acme");
    await db.applications.update(a, { resumeId: 999 });
    expect((await resumeTitlesByApp(db)).size).toBe(0);
    const v = await createVersion(db, { title: "Analyst v2", sections: body }, NOW);
    await setApplicationResume(db, a, v);
    await eraseDocument(db, v);   // erasing clears the pointer
    expect((await db.applications.get(a))?.resumeId).toBeUndefined();
    expect((await resumeTitlesByApp(db)).size).toBe(0);
  });

  it("leaves out a deleted application", async () => {
    const db = freshDb();
    const a = await app(db, "Acme");
    const v = await createVersion(db, { title: "Analyst v2", sections: body }, NOW);
    await setApplicationResume(db, a, v);
    await deleteApplication(db, a, "clear", NOW);
    expect((await resumeTitlesByApp(db)).size).toBe(0);
  });
});

describe("calendarEvents with resume titles", () => {
  const row = (o: Partial<CalendarRow>): CalendarRow => ({
    id: 1, company: "Acme", role: "Analyst", stage: "Interview", appliedAt: "2026-11-01T12:00:00Z", lastActivity: null, followUp: false, interviewDays: ["2026-11-12"], ...o,
  });
  const RANGE = { from: "2026-11-01", to: "2026-11-30" };

  it("puts the title on interview events only", () => {
    const events = calendarEvents([row({})], [], "2026-11-05", RANGE, new Map([[1, "Analyst v2"]]));
    const all = [...events.values()].flat();
    expect(all.filter((e) => e.kind === "interview").map((e) => e.resumeTitle)).toEqual(["Analyst v2"]);
    expect(all.filter((e) => e.kind !== "interview").every((e) => !("resumeTitle" in e))).toBe(true);
  });

  it("leaves it off when the application has no entry, and when no map is given", () => {
    const withMap = calendarEvents([row({})], [], "2026-11-05", RANGE, new Map([[2, "Other"]]));
    const without = calendarEvents([row({})], [], "2026-11-05", RANGE);
    for (const events of [withMap, without]) expect([...events.values()].flat().some((e) => "resumeTitle" in e)).toBe(false);
  });
});
