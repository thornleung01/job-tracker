import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { ActionError as FromActions } from "../../src/sync/actions";
import { ActionError } from "../../src/db/errors";
import { cleanPostingUrl, postingHost, safePostingUrl } from "../../src/db/postingUrl";
import { openDatabase } from "../../src/db/schema";
import { createApplication } from "../../src/db/repo";
import { closeAll, freshDb } from "../sync/helpers";

afterEach(closeAll);

const MESSAGE = "That link doesn't look right. Use a web address that starts with https://.";

describe("cleanPostingUrl", () => {
  it("keeps a plain https link and trims it", () => {
    expect(cleanPostingUrl("  https://boards.greenhouse.io/acme/jobs/123  ")).toBe("https://boards.greenhouse.io/acme/jobs/123");
    expect(cleanPostingUrl("http://example.com/a?b=c&d=e")).toBe("http://example.com/a?b=c&d=e");
  });
  it("turns empty or blank into an empty string", () => {
    expect(cleanPostingUrl("")).toBe("");
    expect(cleanPostingUrl("   \n")).toBe("");
  });
  it("strips the fragment", () => {
    expect(cleanPostingUrl("https://example.com/job/1#apply")).toBe("https://example.com/job/1");
    expect(cleanPostingUrl("https://example.com/job/1?x=1#")).toBe("https://example.com/job/1?x=1");
  });
  it.each([
    ["javascript:alert(1)"], ["JaVaScRiPt:alert(1)"], ["data:text/html,<script>alert(1)</script>"], ["ftp://example.com/job"],
    ["file:///etc/passwd"], ["//example.com/job"], ["example.com/job"], ["not a url"], ["https://"], ["https:// example.com"],
    ["https://user:pw@example.com/job"], ["https://user@example.com/job"], ["https://:pw@example.com/job"],
    ["https://example.com/" + "a".repeat(500)], ["javascript://example.com/%0Aalert(1)"],
  ])("refuses %s", (raw) => {
    expect(() => cleanPostingUrl(raw)).toThrow(ActionError);
    expect(() => cleanPostingUrl(raw)).toThrow(MESSAGE);
  });
  it("accepts a link of exactly 500 characters and refuses 501", () => {
    const base = "https://example.com/";
    expect(cleanPostingUrl(base + "a".repeat(500 - base.length))).toHaveLength(500);
    expect(() => cleanPostingUrl(base + "a".repeat(501 - base.length))).toThrow(ActionError);
  });
  it("throws the same ActionError class the actions export", () => {
    expect(FromActions).toBe(ActionError);
  });
});

describe("safePostingUrl and postingHost", () => {
  it("never throws and gives an empty string for anything unacceptable", () => {
    for (const v of ["javascript:alert(1)", "data:x", "", null, undefined, 5, {}, ["https://a.com"], "https://u:p@a.com"]) expect(safePostingUrl(v)).toBe("");
    expect(safePostingUrl(" https://a.com/x#y ")).toBe("https://a.com/x");
  });
  it("names the host", () => {
    expect(postingHost("https://boards.greenhouse.io/acme")).toBe("boards.greenhouse.io");
    expect(postingHost("nonsense")).toBe("");
  });
});

describe("database upgrade", () => {
  it("opens a version 1 database, keeps its rows and gives them no posting link", async () => {
    const name = `old-${Date.now()}`;
    const old = new Dexie(name);
    old.version(1).stores({
      accounts: "++id, &[provider+address]",
      applications: "++id, companyKey, stage, lastActivity",
      emails: "++id, &[accountId+providerMsgId], [accountId+threadId], applicationId, receivedAt",
      activity: "++id, applicationId",
      feedback: "++id, applicationId",
      ignoredMail: "++id, &[accountId+providerMsgId], createdAt",
      learnedRules: "++id, &[kind+value]",
      contactEdits: "key",
      settings: "key",
    });
    await old.table("applications").add({
      company: "Acme", companyKey: "acme", role: "Analyst", roleKey: "analyst", stage: "Applied", stageAt: "2026-10-01T09:00:00Z",
      appliedAt: "2026-10-01T09:00:00Z", lastActivity: "2026-10-01T09:00:00Z", locked: false, manual: false,
    });
    old.close();

    const db = openDatabase(name);
    try {
      const rows = await db.applications.toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0].company).toBe("Acme");
      expect("postingUrl" in rows[0]).toBe(false);
      expect(db.verno).toBe(4);
      // and the upgraded database takes a link
      await db.applications.update(rows[0].id, { postingUrl: "https://example.com/j" });
      expect((await db.applications.get(rows[0].id))!.postingUrl).toBe("https://example.com/j");
    } finally {
      db.close();
      await Dexie.delete(name);
    }
  });

  it("only stores a link on createApplication when one is given", async () => {
    const db = freshDb();
    const base = { company: "A", companyKey: "a", role: "R", roleKey: "r", stage: "Applied" as const, when: "2026-10-01T09:00:00Z" };
    const none = await createApplication(db, base);
    const some = await createApplication(db, { ...base, postingUrl: "https://example.com/j" });
    expect("postingUrl" in (await db.applications.get(none))!).toBe(false);
    expect((await db.applications.get(some))!.postingUrl).toBe("https://example.com/j");
  });
});
