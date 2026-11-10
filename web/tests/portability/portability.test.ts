// The fixtures python-export.json (a snapshot of scripts/seed_demo.py through scripts/export_json.py) and
// python-export.golden.json (what the Python code computes from it) are described in scripts/export_fixtures.py, whose
// --check fails when the golden stops matching the snapshot.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  EXPORT_FORMAT, EXPORT_VERSION, ImportError, clearAll, convertPythonExport, exportAll, exportAllAsJson, importAll, importFromPythonExport,
} from "../../src/portability";
import { addStep } from "../../src/sync/activity";
import { saveSettings, loadSettings } from "../../src/sync/settings";
import { processMessages, processMessage } from "../../src/sync/sync";
import { mergeApplications } from "../../src/sync/actions";
import { createApplication } from "../../src/db/repo";
import { createVersion, saveCoverLetter, saveMaster, setApplicationResume, setPostingText } from "../../src/sync/documents";
import * as contacts from "../../src/sync/contacts";
import { sankey } from "../../src/sync/stats";
import { statistics } from "../../src/sync/statistics";
import { closeAll, dbWithAccount, freshDb, mk, seedNote } from "../sync/helpers";
import fixture from "../fixtures/python-export.json";
import golden from "../fixtures/python-export.golden.json";
import { MAX_COMPANY_CHARS, MAX_ROLE_CHARS } from "../../src/db/limits";
import { pinClock } from "../support/clock";

pinClock();
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
  await seedNote(db, 1, "remember <b>this</b>");
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

  it("keeps the Statistics page's default period and gives the same statistics after a round trip", async () => {
    const { db } = await populated();
    await saveSettings(db, "appearance", { flowDays: 90 });
    const copy = freshDb();
    await importAll(copy, JSON.parse(await exportAllAsJson(db)));
    expect((await loadSettings(copy)).appearance.flowDays).toBe(90);
    const opts = { now: new Date("2026-11-05T19:00:00Z"), timeZone: "UTC" };
    expect(await statistics(copy, opts)).toEqual(await statistics(db, opts));
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
    const summary = await importAll(copy, await exportAll(db));
    expect([summary.applications, summary.emails]).toEqual([1, 5]);
    const appIds = new Set((await copy.applications.toArray()).map((a) => a.id));
    const pointers = [...(await copy.emails.toArray()), ...(await copy.activity.toArray())].map((r) => r.applicationId).filter((id) => id !== null);
    expect(pointers.length).toBeGreaterThan(0);
    expect(pointers.filter((id) => !appIds.has(id as number))).toEqual([]);
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

describe("what an imported file may contain", () => {
  async function valid() {
    const { db } = await populated();
    return JSON.parse(await exportAllAsJson(db));
  }
  const importedRow = async (x: any, table: "emails" | "ignoredMail") => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const db = freshDb();
    await importAll(db, x);
    return (await db[table].toArray())[0];
  };

  it("keeps an Open in Outlook link that points at Outlook, and drops any other", async () => {
    const x = await valid();
    const hosts: [string, boolean][] = [
      ["https://outlook.office365.com/owa/?ItemID=abc", true], ["https://outlook.office.com/mail/id/abc", true], ["https://outlook.live.com/owa/?ItemID=abc", true],
      ["https://evil.example/login", false], ["https://outlook.office365.com.evil.example/owa", false], ["http://outlook.live.com/owa", false],
      ["https://user:pw@outlook.live.com/owa", false], ["javascript:alert(1)", false], ["https://mail.google.com/mail/u/0/#all/abc", false],
    ];
    for (const [link, kept] of hosts) {
      x.data.emails[0].webLink = link;
      x.data.ignoredMail[0].webLink = link;
      expect((await importedRow(x, "emails")).webLink, link).toBe(kept ? link : null);
      expect((await importedRow(x, "ignoredMail")).webLink, link).toBe(kept ? link : null);
    }
  });

  it("cuts a company and a role to the lengths saving uses, so what imports can be saved again as it is", async () => {
    const x = await valid();
    x.data.applications[0].company = "C".repeat(150);
    x.data.applications[0].companyKey = "c".repeat(150);
    x.data.applications[0].role = "R".repeat(250);
    x.data.applications[0].roleKey = "r".repeat(250);
    const db = freshDb();
    await importAll(db, x);
    const app = (await db.applications.toArray()).find((a) => a.id === x.data.applications[0].id)!;
    expect([app.company.length, app.companyKey.length, app.role.length, app.roleKey.length]).toEqual([MAX_COMPANY_CHARS, MAX_COMPANY_CHARS, MAX_ROLE_CHARS, MAX_ROLE_CHARS]);
  });

  it("refuses a person key the app could never reach", async () => {
    for (const key of ["1|name:Sam Lee", "1|a b@c.co", "x|a@b.co", "1|", "1|name:"]) {
      const x = await valid();
      x.data.contactEdits[0].key = key;
      await expect(importAll(freshDb(), x), key).rejects.toThrow(/not a person key/);
    }
    const ok = await valid();
    ok.data.contactEdits[0].key = "1|name:samlee";
    await expect(importAll(freshDb(), ok)).resolves.toBeDefined();
  });

  it("refuses a confidence or a rule kind that is not on the list, and a name like 'toString' for an event", async () => {
    for (const [mutate, message] of [
      [(x: any) => (x.data.emails[0].confidence = "certain"), /confidence must be/], // eslint-disable-line @typescript-eslint/no-explicit-any
      [(x: any) => (x.data.learnedRules[0].kind = "block_everything"), /not a known rule kind/], // eslint-disable-line @typescript-eslint/no-explicit-any
      [(x: any) => (x.data.emails[0].event = "toString"), /event is not a known event/], // eslint-disable-line @typescript-eslint/no-explicit-any
    ] as const) {
      const x = await valid();
      mutate(x);
      await expect(importAll(freshDb(), x)).rejects.toThrow(message);
    }
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
      documents: 0,
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

describe("documents in the export", () => {
  it("round-trips resumes, a cover letter, the posting text and the resume an application points at", async () => {
    const from = freshDb();
    const lines = [{ id: "s1", heading: "Skills", items: [{ id: "i1", text: "SQL" }] }];
    await saveMaster(from, lines, "paste");
    const v = await createVersion(from, { title: "Data roles", sections: lines });
    const appId = await createApplication(from, { company: "Acme", companyKey: "acme", role: "Analyst", roleKey: "analyst", stage: "Applied", when: "2026-11-01T12:00:00Z" });
    await setApplicationResume(from, appId, v);
    await setPostingText(from, appId, "The posting");
    await saveCoverLetter(from, appId, lines, "paste");
    const file = JSON.parse(await exportAllAsJson(from));
    expect(file.version).toBe(3);
    const to = freshDb();
    const summary = await importAll(to, file);
    expect(summary.documents).toBe(3);
    expect(await to.documents.toArray()).toEqual(await from.documents.toArray());
    expect(await to.applications.toArray()).toEqual(await from.applications.toArray());
  });

  it("round-trips a master made from the blank template, and drops a source it does not know", async () => {
    const from = freshDb();
    await saveMaster(from, [
      { id: "h", heading: "Header", items: [{ id: "n", text: "Jordan Lee" }, { id: "c", text: "Toronto, ON" }] },
      { id: "w", heading: "Work experience", items: [{ id: "o", text: "Acme", kind: "org", right: "Toronto, ON" }] },
    ], "template");
    const file = JSON.parse(await exportAllAsJson(from));
    expect(file.data.documents[0].source).toBe("template");
    expect(file.version).toBe(3);
    const to = freshDb();
    await importAll(to, file);
    expect(await to.documents.toArray()).toEqual(await from.documents.toArray());
    expect((await to.documents.toArray())[0].source).toBe("template");
    file.data.documents[0].source = "other";
    const again = freshDb();
    await importAll(again, file);
    expect((await again.documents.toArray())[0].source).toBeUndefined();
  });

  it("still reads a version 2 file, which has no documents", async () => {
    const to = freshDb();
    const summary = await importAll(to, { format: "jobtracker-export", version: 2, exportedAt: "2026-11-01T00:00:00Z", source: "web", data: { applications: [] } });
    expect(summary.documents).toBe(0);
  });

  it("still reads a version 2 file with applications: posting links stay, nothing has a resume, and there are no documents", async () => {
    const to = freshDb();
    const row = { company: "A", companyKey: "a", role: "R", roleKey: "r", stage: "Applied", stageAt: null, appliedAt: null, lastActivity: null, locked: false, manual: false };
    const applications = [{ ...row, id: 1, postingUrl: "https://example.com/a" }, { ...row, id: 2, company: "B", companyKey: "b" }, { ...row, id: 3, company: "C", companyKey: "c", postingUrl: "https://example.com/c" }];
    const summary = await importAll(to, { format: "jobtracker-export", version: 2, exportedAt: "2026-10-01T00:00:00Z", source: "web", data: { applications } });
    expect([summary.applications, summary.documents]).toEqual([3, 0]);
    const rows = await to.applications.orderBy("id").toArray();
    expect(rows.map((a) => [a.company, a.postingUrl])).toEqual([["A", "https://example.com/a"], ["B", undefined], ["C", "https://example.com/c"]]);
    expect(rows.some((a) => "resumeId" in a || "postingText" in a)).toBe(false);
    expect(await to.documents.count()).toBe(0);
  });

  const at = "2026-11-01T00:00:00Z";
  const file = (data: object) => ({ format: "jobtracker-export", version: 3, exportedAt: at, source: "web", data });
  const resume = { id: 1, kind: "resume", master: true, applicationId: null, title: "x", createdAt: at, updatedAt: at };

  it("drops a resume pointer to a document that isn't in the file and keeps the application", async () => {
    const to = freshDb();
    const app = { id: 1, company: "A", companyKey: "a", role: "R", roleKey: "r", stage: "Applied", stageAt: null, appliedAt: null, lastActivity: null, locked: false, manual: false, resumeId: 9 };
    expect((await importAll(to, file({ applications: [app] }))).applications).toBe(1);
    expect("resumeId" in (await to.applications.get(1))!).toBe(false);
  });

  it("refuses a cover letter for an application that isn't in the file", async () => {
    const letter = { ...resume, kind: "cover", master: false, applicationId: 7, sections: [] };
    await expect(importAll(freshDb(), file({ documents: [letter] }))).rejects.toThrow(/documents #1: applicationId 7 is not in applications/);
  });

  it("cuts the text of a resume item to the limit", async () => {
    const to = freshDb();
    await importAll(to, file({ documents: [{ ...resume, sections: [{ heading: "H", items: [{ text: "y".repeat(5000) }] }] }] }));
    expect((await to.documents.get(1))!.sections[0].items[0].text).toHaveLength(1000);
  });

  it("refuses two master resumes", async () => {
    const two = [{ ...resume, sections: [] }, { ...resume, id: 2, sections: [] }];
    await expect(importAll(freshDb(), file({ documents: two }))).rejects.toThrow(/more than one master resume/);
  });

  it("refuses a cover letter without an application", async () => {
    const letter = { ...resume, id: 3, kind: "cover", master: false, sections: [] };
    await expect(importAll(freshDb(), file({ documents: [letter] }))).rejects.toThrow(/a cover letter needs an application/);
  });

  it("replaces the documents a database already has", async () => {
    const db = freshDb();
    await saveMaster(db, [{ id: "", heading: "Old", items: [{ id: "", text: "old text" }] }], "paste");
    await createVersion(db, { title: "Old version", sections: [{ id: "", heading: "Old", items: [{ id: "", text: "old" }] }] });
    expect(await db.documents.count()).toBe(2);
    const summary = await importAll(db, file({ documents: [{ ...resume, id: 7, title: "Imported", sections: [] }] }));
    expect(summary.documents).toBe(1);
    expect((await db.documents.toArray()).map((d) => [d.id, d.title])).toEqual([[7, "Imported"]]);
  });
});
