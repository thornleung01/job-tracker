import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { ActionError, addApplication, editApplication, mergeApplications } from "../../src/sync/actions";
import { applicationDetail, listApplications } from "../../src/sync/queries";
import { closeAll, freshDb } from "./helpers";

afterEach(closeAll);

const NOW = new Date("2026-10-10T15:00:00Z");
const add = (db: ReturnType<typeof freshDb>, company: string, url?: string) => addApplication(db, { company, role: "Analyst", url }, NOW);

describe("addApplication with a posting link", () => {
  it("saves a valid link, cleaned", async () => {
    const db = freshDb();
    const id = await add(db, "Acme", " https://boards.greenhouse.io/acme/jobs/1#apply ");
    expect((await db.applications.get(id))!.postingUrl).toBe("https://boards.greenhouse.io/acme/jobs/1");
  });
  it("stores no field for a missing or empty link", async () => {
    const db = freshDb();
    const a = await add(db, "Acme");
    const b = await add(db, "Beta", "");
    const c = await add(db, "Gamma", "   ");
    for (const id of [a, b, c]) expect("postingUrl" in (await db.applications.get(id))!).toBe(false);
  });
  it.each([
    ["javascript:alert(1)"], ["data:text/html;base64,PHNjcmlwdD4="], ["https://me:secret@example.com/job"], ["ftp://example.com/job"],
    ["https://example.com/" + "a".repeat(600)], ["acme.com/careers"],
  ])("refuses %s and saves nothing", async (url) => {
    const db = freshDb();
    await expect(add(db, "Acme", url)).rejects.toThrow(ActionError);
    await expect(add(db, "Acme", url)).rejects.toThrow("That link doesn't look right. Use a web address that starts with https://.");
    expect(await db.applications.count()).toBe(0);
  });
});

describe("editApplication with a posting link", () => {
  it("sets, replaces and clears the link", async () => {
    const db = freshDb();
    const id = await add(db, "Acme");
    await editApplication(db, id, "Acme", "Analyst", "https://example.com/a");
    expect((await db.applications.get(id))!.postingUrl).toBe("https://example.com/a");
    await editApplication(db, id, "Acme", "Analyst", "https://example.com/b#x");
    expect((await db.applications.get(id))!.postingUrl).toBe("https://example.com/b");
    await editApplication(db, id, "Acme", "Analyst", "");
    expect("postingUrl" in (await db.applications.get(id))!).toBe(false);
  });
  it("leaves the link alone when no url is passed", async () => {
    const db = freshDb();
    const id = await add(db, "Acme", "https://example.com/a");
    await editApplication(db, id, "Acme Corp", "Lead");
    const row = (await db.applications.get(id))!;
    expect([row.company, row.postingUrl]).toEqual(["Acme Corp", "https://example.com/a"]);
  });
  it("refuses a bad link and changes nothing", async () => {
    const db = freshDb();
    const id = await add(db, "Acme", "https://example.com/a");
    await expect(editApplication(db, id, "Other", "Role", "javascript:alert(1)")).rejects.toThrow(ActionError);
    const row = (await db.applications.get(id))!;
    expect([row.company, row.postingUrl]).toEqual(["Acme", "https://example.com/a"]);
  });
});

describe("mergeApplications and posting links", () => {
  it("keeps the target's link", async () => {
    const db = freshDb();
    const src = await add(db, "Acme", "https://example.com/src");
    const dst = await add(db, "Acme Inc", "https://example.com/dst");
    await mergeApplications(db, src, dst);
    expect((await db.applications.get(dst))!.postingUrl).toBe("https://example.com/dst");
  });
  it("takes the source's link when the target has none", async () => {
    const db = freshDb();
    const src = await add(db, "Acme", "https://example.com/src");
    const dst = await add(db, "Acme Inc");
    await mergeApplications(db, src, dst);
    expect((await db.applications.get(dst))!.postingUrl).toBe("https://example.com/src");
  });
  it("leaves the target without one when neither has a link", async () => {
    const db = freshDb();
    const src = await add(db, "Acme");
    const dst = await add(db, "Acme Inc");
    await mergeApplications(db, src, dst);
    expect("postingUrl" in (await db.applications.get(dst))!).toBe(false);
  });
});

describe("queries carry the link", () => {
  it("lists it on rows and on the detail", async () => {
    const db = freshDb();
    const withUrl = await add(db, "Acme", "https://example.com/a");
    const without = await add(db, "Beta");
    const rows = await listApplications(db, { now: NOW });
    expect(rows.find((r) => r.id === withUrl)!.postingUrl).toBe("https://example.com/a");
    expect(rows.find((r) => r.id === without)!.postingUrl).toBeUndefined();
    expect((await applicationDetail(db, withUrl, NOW))!.application.postingUrl).toBe("https://example.com/a");
    expect((await applicationDetail(db, without, NOW))!.application.postingUrl).toBeUndefined();
  });
});
