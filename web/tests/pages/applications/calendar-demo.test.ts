import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { $$, cleanup, freshDb, mountPage } from "./harness";
import ApplicationsPage from "../../../src/pages/applications";
import { loadDemoData } from "../../../src/demo/loadDemo";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T12:00:00"));
});
afterEach(async () => {
  await cleanup();
  vi.useRealTimers();
});

it("the demo data has interview days soon after today, so the calendar and Coming up have something to show", async () => {
  const db = freshDb();
  await loadDemoData(db);
  const { container } = await mountPage(ApplicationsPage, db, "/?view=calendar&month=2026-11");
  const withInterview = $$(container, "[role=gridcell]").map((c) => c.getAttribute("aria-label") ?? "").filter((l) => l.includes("interview"));
  expect(withInterview.map((l) => l.slice(0, l.indexOf(".")))).toEqual(["Saturday, November 7, 2026", "Wednesday, November 11, 2026", "Monday, November 16, 2026"]);
});
