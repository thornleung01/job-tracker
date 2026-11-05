import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  EXPORT_FORMAT, EXPORT_VERSION, ImportError, clearAll, convertPythonExport, exportAll, exportAllAsJson, importAll, importFromPythonExport,
} from "../../src/portability";
import { addNote, addStep } from "../../src/sync/activity";
import { saveSettings, loadSettings } from "../../src/sync/settings";
import { processMessages, processMessage } from "../../src/sync/sync";
import { mergeApplications } from "../../src/sync/actions";
import * as contacts from "../../src/sync/contacts";
import { sankey } from "../../src/sync/stats";
import { closeAll, dbWithAccount, freshDb, mk } from "../sync/helpers";
import fixture from "../fixtures/python-export.json";
import golden from "../fixtures/python-export.golden.json";

afterEach(closeAll);

async function populated() {
  const { db, acct } = await dbWithAccount();
  await processMessages(db, acct, [
    mk("1", "Thank you for applying to Acme", "", undefined, "A", 1),
    mk("2", "Interview", "Please select a time for your interview.", undefined, "A", 4),
    mk("3", "Thank you for applying to Initech", "", "Initech <no-reply@lever.co>", "B", 2),
    mk("4", "Re: your application", "Quick question about your CV.", "Sam <sam@zzz.com>", undefined, 5),
    mk("5", "Your receipt", "thanks", "Shop <a@shop.com>", undefined, 6),
  ]);
  await addNote(db, 1, "remember <b>this</b>");
  await addStep(db, 1, "Phone screen", "2026-10-02", "30 min");
  await contacts.saveEdit(db, "1|sam@acme.com", "Sam Example", "Recruiter");
  await db.feedback.add({ createdAt: "2026-10-01T00:00:00Z", verdict: "not_job", senderEmail: "a@coachco.io", senderDomain: "coachco.io", subject: "s", reason: "body: x", applicationId: null });
  await db.learnedRules.add({ kind: "block_sender", value: "a@coachco.io", evidence: 1, active: true, createdAt: "2026-10-01T00:00:00Z" });
  await db.ignoredMail.add({ accountId: acct, providerMsgId: "ign", threadId: null, receivedAt: "2026-10-03T00:00:00Z", sender: "x <x@y.co>", subject: "s", body: "b", webLink: null, reason: "learned: x", createdAt: "2026-10-03T00:00:00Z", bulk: false });
  await saveSettings(db, "appearance", { theme: "dark", accent: "forest", columns: ["company", "stage"] });
  return { db, acct };
}

describe("export and import", () => {
  it("round-trips everything through JSON text", async () => {
    const { db } = await populated();
    const text = await exportAllAsJson(db);
    const copy = freshDb();
    const summary = await importAll(copy, text);
    expect(summary.applications).toBe(2);
    expect(summary.emails).toBe(5);
    const a = await exportAll(db, new Date(0));
    const b = await exportAll(copy, new Date(0));
    expect(b).toEqual(a);
    expect(a.format).toBe(EXPORT_FORMAT);
    expect(a.version).toBe(EXPORT_VERSION);
  });

  it("gives the same numbers after a round trip", async () => {
    const { db } = await populated();
    const copy = freshDb();
    await importAll(copy, JSON.parse(await exportAllAsJson(db)));
    expect(await sankey(copy)).toEqual(await sankey(db));
    expect(await loadSettings(copy)).toEqual(await loadSettings(db));
  });

  it("replaces what was there, and carries on with fresh ids after", async () => {
    const { db } = await populated();
    const target = freshDb();
    await target.accounts.add({ provider: "gmail", address: "old@gmail.com", lastSync: null, lastError: null, active: true });
    await importAll(target, await exportAll(db));
    expect((await target.accounts.toArray()).map((a) => a.address)).toEqual(["me@gmail.com"]);
    const maxApp = Math.max(...(await target.applications.toArray()).map((a) => a.id));
    await processMessage(target, 1, mk("n", "Thank you for applying to Hooli", "", "Hooli <no-reply@lever.co>", "H", 8));
    expect(Math.max(...(await target.applications.toArray()).map((a) => a.id))).toBeGreaterThan(maxApp);
  });

  it("keeps text from the file as data", async () => {
    const { db } = await populated();
    const copy = freshDb();
    await importAll(copy, await exportAll(db));
    expect((await copy.activity.toArray()).some((r) => r.body === "remember <b>this</b>")).toBe(true);
  });

  it("clears everything", async () => {
    const { db } = await populated();
    await clearAll(db);
    expect(await Promise.all(db.tables.map((t) => t.count()))).toEqual(db.tables.map(() => 0));
  });

  it("carries merges through: nothing points at a deleted application", async () => {
    const { db } = await populated();
    await mergeApplications(db, 1, 2);
    const copy = freshDb();
    await expect(importAll(copy, await exportAll(db))).resolves.toBeDefined();
  });
});

describe("validation", () => {
  async function valid() {
    const { db } = await populated();
    return JSON.parse(await exportAllAsJson(db));
  }
  const bad = async (mutate: (x: any) => void, message: RegExp) => {
    const x = await valid();
    mutate(x);
    const target = freshDb();
    await target.accounts.add({ provider: "gmail", address: "keep@gmail.com", lastSync: null, lastError: null, active: true });
    await expect(importAll(target, x)).rejects.toThrow(message);
    await expect(importAll(target, x)).rejects.toBeInstanceOf(ImportError);
    // nothing was changed
    expect((await target.accounts.toArray()).map((a) => a.address)).toEqual(["keep@gmail.com"]);
    expect(await target.applications.count()).toBe(0);
  };

  it("refuses text that is not JSON, or not an export", async () => {
    const db = freshDb();
    await expect(importAll(db, "{nope")).rejects.toThrow(/isn't valid JSON/);
    await expect(importAll(db, { hello: 1 })).rejects.toThrow(/isn't a Job Tracker export/);
    await expect(importAll(db, null)).rejects.toBeInstanceOf(ImportError);
    await expect(importAll(db, [])).rejects.toBeInstanceOf(ImportError);
  });

  it("refuses a newer version", () => bad((x) => (x.version = 99), /version 99/));
  it("refuses an unknown stage", () => bad((x) => (x.data.applications[0].stage = "Hired"), /stage is not one of/));
  it("refuses an unknown event", () => bad((x) => (x.data.emails[0].event = "wat"), /event is not a known event/));
  it("refuses an email for an account that is not there", () => bad((x) => (x.data.emails[0].accountId = 42), /accountId 42 is not in accounts/));
  it("refuses an email for an application that is not there", () => bad((x) => (x.data.emails[0].applicationId = 777), /applicationId 777/));
  it("refuses a note for an application that is not there", () => bad((x) => (x.data.activity[0].applicationId = 777), /applicationId 777/));
  it("refuses a duplicate id", () => bad((x) => x.data.applications.push({ ...x.data.applications[0] }), /id \d+ twice/));
  it("refuses a duplicate email in one mailbox", () => bad((x) => x.data.emails.push({ ...x.data.emails[0], id: 9999 }), /duplicate entry/));
  it("refuses a date that is not a date", () => bad((x) => (x.data.emails[0].receivedAt = "yesterday"), /receivedAt is not a date/));
  it("refuses a table that is not a list", () => bad((x) => (x.data.emails = { a: 1 }), /must be a list/));
  it("refuses a row that is not an object", () => bad((x) => x.data.accounts.push(5), /is not an object/));
  it("refuses a bad provider", () => bad((x) => (x.data.accounts[0].provider = "yahoo"), /provider must be gmail or outlook/));
  it("refuses a bad person key", () => bad((x) => (x.data.contactEdits[0].key = "oops"), /not a person key/));

  it("reports several problems together", async () => {
    const x = await valid();
    x.data.applications[0].stage = "Hired";
    x.data.emails[0].event = "wat";
    try {
      await importAll(freshDb(), x);
      expect.unreachable();
    } catch (e) {
      expect((e as ImportError).problems.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("truncates an oversized body and normalises the times", async () => {
    const x = await valid();
    x.data.emails[0].body = "y".repeat(10_000);
    x.data.emails[0].receivedAt = "2026-10-01T09:00:00.999Z";
    const db = freshDb();
    await importAll(db, x);
    const row = (await db.emails.toArray()).find((e) => e.id === x.data.emails[0].id)!;
    expect(row.body).toHaveLength(4096);
    expect(row.receivedAt).toBe("2026-10-01T09:00:00Z");
  });

  it("sanitises settings from the file", async () => {
    const x = await valid();
    x.data.settings.appearance = { theme: "neon", accent: "<script>", columns: ["role"] };
    const db = freshDb();
    await importAll(db, x);
    const s = await loadSettings(db);
    expect([s.appearance.theme, s.appearance.accent, s.appearance.columns]).toEqual(["system", "graphite", ["company", "role", "stage"]]);
  });
});

describe("importing the local edition's file", () => {
  it("reads the demo export made by scripts/export_json.py", async () => {
    const db = freshDb();
    const summary = await importFromPythonExport(db, fixture);
    expect(summary).toEqual({
      accounts: golden.counts.accounts, applications: golden.counts.applications, emails: golden.counts.emails, activity: golden.counts.activity,
      feedback: golden.counts.feedback, ignoredMail: golden.counts.ignored_mail, learnedRules: golden.counts.learned_rules,
      contactEdits: golden.counts.contact_edits,
    });
    // text from the file, with flags turned into booleans and snake_case into camelCase
    const hand = (await db.applications.toArray()).find((a) => a.company === "Hand Made Co")!;
    expect([hand.locked, hand.manual, hand.stage, hand.companyKey]).toEqual([true, true, "Interview", "handmadeco"]);
    const review = (await db.emails.toArray()).find((e) => e.providerMsgId === "review-1")!;
    expect([review.needsReview, review.related, review.event, review.applicationId]).toEqual([true, true, "interview", null]);
    expect((await db.ignoredMail.toArray())[0].reason).toBe("learned: ignoring hi@coachco.io");
    expect((await db.learnedRules.toArray()).some((r) => r.kind === "block_domain" && r.value === "coachco.io" && r.active)).toBe(true);
    expect((await db.contactEdits.toArray())[0].name).toBe("Sam Example");
  });

  it("brings the appearance settings across but never the job-search profile", async () => {
    const db = freshDb();
    await importFromPythonExport(db, fixture);
    const s = await loadSettings(db);
    expect(s.appearance).toEqual({ theme: "dark", accent: "forest", density: "compact", corners: "sharp", columns: ["company", "stage", "lastActivity"], flowDays: 90 });
    expect(s.sync.lookbackDays).toBe(90);
    expect(JSON.stringify(await exportAll(db))).not.toContain("SECRET");
    expect((await db.settings.toArray()).map((r) => r.key).sort()).toEqual(["appearance", "sync"]);
  });

  it("matches the local edition's list of people and keeps working after the import", async () => {
    const db = freshDb();
    await importFromPythonExport(db, fixture);
    expect((await contacts.derive(db)).map((c) => c.key)).toEqual((golden.contacts as { key: string }[]).map((c) => c.key));
    const { upsertAccount } = await import("../../src/db/repo");
    expect(await upsertAccount(db, "gmail", "demo@gmail.com")).toBe(1); // the imported mailbox, not a new one
  });

  it("is also readable from text, and the converter rejects other files", async () => {
    const db = freshDb();
    await importFromPythonExport(db, JSON.stringify(fixture));
    expect(await db.applications.count()).toBe(golden.counts.applications);
    expect(() => convertPythonExport({ format: "something else" })).toThrow(ImportError);
    expect(() => convertPythonExport({ ...fixture, version: 7 })).toThrow(/version 7/);
    await expect(importFromPythonExport(db, await exportAll(db))).rejects.toThrow(/scripts\/export_json\.py/);
  });
});
