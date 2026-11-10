import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $, $$, addApp, addMail, button, cleanup, click, freshDb, mountPage, row, text } from "../../pages/applications/harness";
import ApplicationsPage from "../../../src/pages/applications";
import DetailPage from "../../../src/pages/detail";
import { upsertAccount } from "../../../src/db/repo";
import type { JobTrackerDB } from "../../../src/db/schema";
import { iso, localToday } from "../../../src/db/time";
import { icsForInterviews } from "../../../src/sync/ics";
import { shortDay } from "../../../src/sync/upcoming";

// Freeze only the clock's date (the harness times itself with performance.now), so "today" can't change under a test at midnight, and
// the file's DTSTAMP (a second apart at most) is the same moment the test expects. NOW is that moment, named once.
const NOW = new Date("2026-11-05T12:00:00");
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete (URL as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
});

const inDays = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localToday(d);
};

/** Stubs what jsdom lacks and what would navigate: records every Blob saved, with the file name the link was given. */
function captureDownloads() {
  const saved: { blob: Blob; name: string; url: string }[] = [];
  const revoked: string[] = [];
  let next = 0;
  Object.assign(URL, {
    createObjectURL: vi.fn((blob: Blob) => {
      const url = `blob:test-${next++}`;
      saved.push({ blob, name: "", url });
      return url;
    }),
    revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
  });
  // Only the file links are caught: any other link (a row's expander) still clicks as usual.
  const realClick = HTMLAnchorElement.prototype.click;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    const entry = saved.find((s) => s.url === this.href);
    if (entry) entry.name = this.download;
    else realClick.call(this);
  });
  return { saved, revoked };
}
const readBlob = (blob: Blob) => new Promise<string>((resolve) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.readAsText(blob);
});

async function interview(db: JobTrackerDB, account: number, company: string, day: string, o: { role?: string; stage?: "Interview" | "Applied" } = {}): Promise<number> {
  const id = await addApp(db, company, { role: o.role ?? "Analyst", stage: o.stage ?? "Interview", last: 1 });
  await addMail(db, account, id, { event: "interview", subject: "Interview invitation", body: `We will meet on ${day} at 10:00.`, threadId: `thread-${company}` });
  return id;
}

describe("Add to calendar on a Coming up row", () => {
  it("saves a calendar file for that row's day with the right name and text, and revokes its link", async () => {
    const downloads = captureDownloads();
    // Catches the one-second timer that revokes the link; every other timer runs as usual.
    const revokeTimers: (() => void)[] = [];
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number, ...args: unknown[]) => {
      if (ms === 1000) {
        revokeTimers.push(fn);
        return 0;
      }
      return realSetTimeout(fn, ms, ...args);
    }) as unknown as typeof setTimeout);
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const id = await interview(db, account, "Acme", inDays(3), { role: "Data Analyst" });
    await interview(db, account, "Beta", inDays(5));
    const { container } = await mountPage(ApplicationsPage, db);
    const buttons = $$(container, "section.coming-up button.add-to-calendar");
    expect(buttons.map((b) => text(b))).toEqual(["Add to calendar", "Add to calendar"]);
    expect(buttons[0].getAttribute("aria-label")).toBe("Add Acme interview to calendar");

    await click(buttons[0]);
    expect(downloads.saved).toHaveLength(1);
    const { blob, name } = downloads.saved[0];
    expect(name).toBe(`job-tracker-interview-${inDays(3)}.ics`);
    expect(blob.type).toBe("text/calendar;charset=utf-8");
    const file = await readBlob(blob);
    expect(file).toBe(icsForInterviews([{ appId: id, company: "Acme", role: "Data Analyst", stage: "Interview", day: inDays(3) }], NOW));
    expect(file).toContain(`DTSTAMP:${iso(NOW).replace(/[-:]/g, "")}\r\n`);
    expect(file).toContain("SUMMARY:Interview: Acme - Data Analyst\r\n");
    expect(file).toContain(`DTSTART;VALUE=DATE:${inDays(3).replaceAll("-", "")}\r\n`);
    expect(text($(container, "section.coming-up [role=status]"))).toBe("Calendar file saved.");
    // The link is revoked a moment later (a timer of one second), not left behind: run that timer by hand instead of waiting for it.
    expect(downloads.revoked).toEqual([]);
    expect(revokeTimers).toHaveLength(1);
    revokeTimers.forEach((run) => run());
    expect(downloads.revoked).toEqual([downloads.saved[0].url]);
  });

  it("is a button beside the row's link, never inside it, and the link still opens the application", async () => {
    captureDownloads();
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const id = await interview(db, account, "Acme", inDays(1));
    const { container } = await mountPage(ApplicationsPage, db);
    expect($(container, "section.coming-up a button")).toBeNull();
    expect($(container, "section.coming-up a.coming-up-row")!.getAttribute("href")).toBe(`#/app/${id}`);
  });
});

describe("Download all upcoming interviews", () => {
  it("saves every upcoming day of every application, past the strip's week, in one file", async () => {
    const downloads = captureDownloads();
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const acme = await interview(db, account, "Acme", inDays(2));
    await addMail(db, account, acme, { event: "interview", subject: "Final round", body: `Final round on ${inDays(20)}.`, threadId: "thread-final" });
    await interview(db, account, "Beta", inDays(4));
    await interview(db, account, "Closed", inDays(3), { stage: "Applied" }).then((id) => db.applications.update(id, { stage: "Rejected" }));
    const { container } = await mountPage(ApplicationsPage, db);
    const all = button($(container, "section.coming-up")!, "Download all upcoming interviews")!;
    expect(all).not.toBeNull();
    await click(all);
    expect(downloads.saved).toHaveLength(1);
    expect(downloads.saved[0].name).toBe(`job-tracker-interviews-${localToday()}.ics`);
    expect(downloads.saved[0].blob.type).toBe("text/calendar;charset=utf-8");
    const file = await readBlob(downloads.saved[0].blob);
    const starts = file.split("\r\n").filter((l) => l.startsWith("DTSTART")).map((l) => l.split(":")[1]);
    expect(starts).toEqual([inDays(2), inDays(4), inDays(20)].map((d) => d.replaceAll("-", "")));
    expect(file).not.toContain("Closed");
    expect(text($(container, "section.coming-up .coming-up-all [role=status]"))).toBe("Saved a calendar file with 3 interview days.");
  });

  it("is not offered when the strip isn't there", async () => {
    const db = freshDb();
    await upsertAccount(db, "gmail", "me@gmail.com");
    await addApp(db, "Plain");
    const { container } = await mountPage(ApplicationsPage, db);
    expect($(container, "section.coming-up")).toBeNull();
    expect(button(container, "Download all upcoming interviews")).toBeNull();
  });
});

describe("Add to calendar on the application", () => {
  it("shows each upcoming interview day under the open row, with a button that saves that day", async () => {
    const downloads = captureDownloads();
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const id = await interview(db, account, "Acme", inDays(2));
    await addMail(db, account, id, { event: "interview", subject: "Final round", body: `Final round on ${inDays(12)}.`, threadId: "thread-final" });
    const { container } = await mountPage(ApplicationsPage, db);
    await click($(row(container, "Acme"), "a.expander"));
    const panel = $(container, `#panel-${id}`)!;
    const lines = $$(panel, ".app-interview");
    expect(lines).toHaveLength(2);
    expect(text($(lines[0], "span"))).toBe(`Interview ${shortDay(inDays(2))}`);
    expect(text($(lines[1], "span"))).toBe(`Interview ${shortDay(inDays(12))}`);
    await click($(lines[1], "button"));
    expect(downloads.saved[0].name).toBe(`job-tracker-interview-${inDays(12)}.ics`);
    expect(await readBlob(downloads.saved[0].blob)).toContain(`DTSTART;VALUE=DATE:${inDays(12).replaceAll("-", "")}`);
  });

  it("shows the same on the application page, once", async () => {
    captureDownloads();
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const id = await interview(db, account, "Acme", inDays(2));
    const { container } = await mountPage(DetailPage, db, `/app/${id}`, { id: String(id) });
    expect($$(container, ".app-interview")).toHaveLength(1);
    expect($$(container, "button.add-to-calendar")).toHaveLength(1);
    expect($(container, ".card .app-actions")).not.toBeNull();     // in the facts card, not down in the notes
  });

  it("shows only the connect-your-mailbox line when there is no interview day and no mail service", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme");
    const { container } = await mountPage(DetailPage, db, `/app/${id}`, { id: String(id) });
    expect($(container, ".app-actions .app-interview")).toBeNull();
    expect($(container, ".app-actions a")).toBeNull();
  });
});
