// Data-loss guards: what a recheck, a restore, a merge, a sync error and a bulk add must never do to something you made.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { roleKey } from "../../src/pipeline";
import { MissingRecordError } from "../../src/db/errors";
import { createApplication } from "../../src/db/repo";
import type { JobTrackerDB } from "../../src/db/schema";
import { EMPTY_DRAFT, type JobDraft } from "../../src/jobs/types";
import { ignoredIsReal, mergeApplications, setInterviewRounds, setOfferDetails } from "../../src/sync/actions";
import { bulkAdd } from "../../src/sync/bulkAdd";
import * as contacts from "../../src/sync/contacts";
import { fillRole } from "../../src/sync/decide";
import { recheck } from "../../src/sync/recheck";
import { processMessage, processMessages } from "../../src/sync/sync";
import type { LearnedView } from "../../src/sync/pipelineTypes";
import { closeAll, dbWithAccount, freshDb, mail } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
  return closeAll();
});

const HELLO = () => mail("Hello", "Thank you for applying to Acme for the Analyst role. We received your application.", "Acme Careers <jobs@acme.com>", "h", 1, "th");
const BLOCK = { kind: "block_sender", value: "jobs@acme.com", evidence: 3, active: true, createdAt: "2026-10-02T00:00:00Z" } as const;

async function syncMade() {
  const { db, acct } = await dbWithAccount();
  await processMessage(db, acct, HELLO());
  const [app] = await db.applications.toArray();
  return { db, acct, id: app.id };
}

describe("recheck leaves an application you filled in", () => {
  it("removes an untouched one (the control)", async () => {
    const { db } = await syncMade();
    await db.learnedRules.add(BLOCK);
    expect(await recheck(db)).toMatchObject({ cleared: 1, removed: 1 });
  });

  it.each([
    ["interview rounds", (db: JobTrackerDB, id: number) => setInterviewRounds(db, id, 2)],
    ["an offer salary and deadline", (db: JobTrackerDB, id: number) => setOfferDetails(db, id, { salary: "$100,000", deadline: "2026-11-30" })],
    ["a people correction", (db: JobTrackerDB, id: number) => contacts.saveEdit(db, `${id}|sam@acme.com`, "Sam Example", "Recruiter")],
  ])("keeps one with %s", async (_what, edit) => {
    const { db, id } = await syncMade();
    await edit(db, id);
    await db.learnedRules.add(BLOCK);
    expect(await recheck(db)).toMatchObject({ cleared: 0, removed: 0 });
    expect(await db.applications.get(id)).toBeDefined();
    expect(await db.emails.count()).toBe(1);
  });
});

describe("ignoredIsReal is all or nothing", () => {
  it("keeps the ignored email and the rules when reading it again fails", async () => {
    const { db, acct } = await dbWithAccount();
    await db.learnedRules.add({ kind: "block_sender", value: "pat@acme.io", evidence: 3, active: true, createdAt: "2026-10-02T00:00:00Z" });
    await processMessage(db, acct, mail("Quick note", "We would like to schedule an interview with you for the analyst role at Acme.", "Pat Lee <pat@acme.io>", "real"));
    const [row] = await db.ignoredMail.toArray();
    const rules = await db.learnedRules.toArray();
    vi.spyOn(db.emails, "add").mockRejectedValue(new Error("QuotaExceededError"));
    await expect(ignoredIsReal(db, row.id)).rejects.toThrow(/Quota/);
    vi.restoreAllMocks();
    expect(await db.ignoredMail.get(row.id)).toMatchObject({ body: row.body });
    expect(await db.learnedRules.toArray()).toEqual(rules);
    expect(await db.feedback.count()).toBe(0);
  });
});

describe("bulk add", () => {
  const guess = { company: true, role: true };
  const deps = {
    parseJobUrl: (u: string): JobDraft | null => {
      const m = /^https:\/\/jobs\.example\/([a-z]+)(?:\/([a-z-]+))?/.exec(u);
      return m ? { ...EMPTY_DRAFT, company: m[1][0].toUpperCase() + m[1].slice(1), role: m[2]?.replace(/-/g, " ") ?? "", url: u, guessed: guess } : null;
    },
    enrichJobDraft: async (d: JobDraft) => d,
  };

  it("adds a link whose role could not be read, even when the company has another application", async () => {
    const db = freshDb();
    await createApplication(db, { company: "Acme", companyKey: "acme", role: "Designer", roleKey: "designer", stage: "Applied", when: "2026-10-01T00:00:00Z" });
    const [r] = await bulkAdd(db, ["https://jobs.example/acme"], deps);
    expect(r.outcome.status).toBe("added");
    expect(await db.applications.count()).toBe(2);
  });

  it("still skips the same company and role", async () => {
    const db = freshDb();
    await createApplication(db, { company: "Acme", companyKey: "acme", role: "data analyst", roleKey: roleKey("data analyst"), stage: "Applied", when: "2026-10-01T00:00:00Z" });
    const [r] = await bulkAdd(db, ["https://jobs.example/acme/data-analyst"], deps);
    expect(r.outcome.status).toBe("skipped");
  });
});

describe("fillRole", () => {
  async function appWithoutRole(manual: boolean) {
    const db = freshDb();
    const id = await createApplication(db, { company: "Acme", companyKey: "acme", role: "Unknown role", roleKey: "", stage: "Applied", when: "2026-10-01T00:00:00Z" });
    if (manual) await db.applications.update(id, { manual: true });
    await fillRole(db, id, "Designer", "designer");
    return (await db.applications.get(id))!;
  }
  it("fills a role an email names on a sync-made application", async () => expect((await appWithoutRole(false)).role).toBe("Designer"));
  it("leaves a hand-made application without a role as it is", async () => expect((await appWithoutRole(true)).role).toBe("Unknown role"));
});

describe("mergeApplications", () => {
  async function two(srcManual = false) {
    const db = freshDb();
    const mk = (company: string) => createApplication(db, { company, companyKey: company.toLowerCase(), role: "A", roleKey: "a", stage: "Applied", when: "2026-10-01T00:00:00Z" });
    const src = await mk("Acme");
    const dst = await mk("Acme Two");
    if (srcManual) await db.applications.update(src, { manual: true });
    return { db, src, dst };
  }

  it("keeps the target's correction for the same person, and drops the source's", async () => {
    const { db, src, dst } = await two();
    await contacts.saveEdit(db, `${src}|sam@acme.com`, "Source Name", "Source Title");
    await contacts.saveEdit(db, `${dst}|sam@acme.com`, "Target Name", "Target Title");
    await contacts.saveEdit(db, `${src}|pat@acme.com`, "Pat", "Lead");
    await mergeApplications(db, src, dst);
    const rows = (await db.contactEdits.toArray()).sort((a, b) => (a.key < b.key ? -1 : 1));
    expect(rows.map((r) => [r.key, r.name])).toEqual([[`${dst}|pat@acme.com`, "Pat"], [`${dst}|sam@acme.com`, "Target Name"]]);
  });

  it("points the source's feedback at the target", async () => {
    const { db, src, dst } = await two();
    await db.feedback.add({ createdAt: "2026-10-01T00:00:00Z", verdict: "job", senderEmail: "a@acme.com", senderDomain: "acme.com", subject: "s", reason: "", applicationId: src });
    await mergeApplications(db, src, dst);
    expect((await db.feedback.toArray()).map((f) => f.applicationId)).toEqual([dst]);
  });

  it("carries the source's hand-made flag, so the merged row is not 'untouched'", async () => {
    const { db, src, dst } = await two(true);
    await mergeApplications(db, src, dst);
    expect((await db.applications.get(dst))!.manual).toBe(true);
  });
});

describe("people corrections need an application", () => {
  it("refuses to save or hide one for an application that is gone, and writes nothing", async () => {
    const db = freshDb();
    await expect(contacts.saveEdit(db, "99|sam@acme.com", "Sam", "Lead")).rejects.toBeInstanceOf(MissingRecordError);
    await expect(contacts.hide(db, "99|sam@acme.com")).rejects.toBeInstanceOf(MissingRecordError);
    expect(await db.contactEdits.count()).toBe(0);
  });
});

describe("a sync error never blanks an email for good", () => {
  it("leaves it unmarked ('retry') when storing it fails, so the next sync reads it again", async () => {
    const { db, acct } = await dbWithAccount();
    vi.spyOn(db.emails, "add").mockRejectedValueOnce(new Error("a bug while filing it"));
    expect(await processMessages(db, acct, [HELLO()])).toEqual({ retry: 1 });
    expect(await db.emails.count()).toBe(0);
    expect(await processMessage(db, acct, HELLO())).toBe("applied-to-application");
  });

  it("marks an email seen only when reading it throws", async () => {
    const { db, acct } = await dbWithAccount();
    const broken = { blockSenders: new Set(), blockDomains: new Set(), allowSenders: new Set(), distrust: new Set(), blocks: () => { throw new Error("bad rule"); } } as LearnedView;
    await expect(processMessage(db, acct, HELLO(), broken)).rejects.toThrow(/could not be read/);
    expect(await db.emails.count()).toBe(0);
  });

  it("answers 'duplicate' for a job alert another tab saved while this one was deciding", async () => {
    const { db, acct } = await dbWithAccount();
    const alert = mail("New jobs for you: Analyst", "Analyst at Acme", "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>", "alert");
    const outcomes = await Promise.all([processMessage(db, acct, alert), processMessage(db, acct, alert)]);
    expect([...outcomes].sort()).toEqual(["duplicate", "job-alert"]);
  });
});
