import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { createApplication, upsertAccount } from "../../src/db/repo";
import type { JobTrackerDB } from "../../src/db/schema";
import { applicationActions, pickRecipient, upcomingInterviewEvents } from "../../src/sync/applicationActions";
import { closeAll, freshDb } from "./helpers";

afterEach(closeAll);

const NOW = new Date("2026-11-05T12:00:00");
let n = 0;

async function app(db: JobTrackerDB, company: string, o: { stage?: "Applied" | "Interview" | "Rejected" | "Offer"; last?: string; role?: string } = {}): Promise<number> {
  const id = await createApplication(db, { company, companyKey: company.toLowerCase(), role: o.role ?? "Analyst", roleKey: "analyst", stage: o.stage ?? "Applied", when: "2026-10-14T12:00:00Z" });
  await db.applications.update(id, { lastActivity: o.last ?? "2026-10-20T12:00:00Z" });
  return id;
}
async function mail(db: JobTrackerDB, accountId: number, appId: number, o: { sender?: string; body?: string; subject?: string; when?: string; event?: "applied" | "interview"; thread?: string } = {}) {
  await db.emails.add({
    accountId, providerMsgId: `m${n++}`, threadId: o.thread ?? `t${n}`, receivedAt: o.when ?? "2026-10-15T10:00:00Z", sender: o.sender ?? "Acme Careers <careers@acme.com>",
    subject: o.subject ?? "Hello", body: o.body ?? "Thanks.", related: true, event: o.event ?? "applied", confidence: "high", applicationId: appId, needsReview: false,
    webLink: null, bulk: false, hold: false, reason: null,
  });
}

describe("pickRecipient", () => {
  const person = (name: string, email: string, kind: "recruiter" | "hiring" | "people" | "" = "", mentionedOnly = false) => ({ name, email, kind, mentionedOnly });
  const none = new Set<string>();

  it("takes the newest recruiter or hiring contact with an address over a newer person of unknown kind", () => {
    const people = [person("Sam Lee", "sam@acme.com"), person("Nadia Khan", "nadia@acme.com", "recruiter"), person("Old Hire", "old@acme.com", "hiring")];
    expect(pickRecipient(people, [], none)).toEqual({ name: "Nadia Khan", email: "nadia@acme.com" });
  });

  it("falls back to the newest person with an address, skipping people only named in an invite and your own address", () => {
    const people = [person("Named Only", "", "recruiter", true), person("Me Myself", "me@gmail.com", "recruiter"), person("Sam Lee", "sam@acme.com")];
    expect(pickRecipient(people, [], new Set(["me@gmail.com"]))).toEqual({ name: "Sam Lee", email: "sam@acme.com" });
  });

  it("falls back to the sender of the newest email that takes replies, greeting only a real name", () => {
    const mails = [{ sender: "Acme <no-reply@acme.com>" }, { sender: "Sam Lee <sam@acme.com>" }];
    expect(pickRecipient([], mails, none)).toEqual({ name: "Sam Lee", email: "sam@acme.com" });
    expect(pickRecipient([], [{ sender: "Acme Careers <careers@acme.com>" }], none)).toEqual({ name: "", email: "careers@acme.com" });
  });

  it("is null when nobody can be written to", () => {
    expect(pickRecipient([], [], none)).toBeNull();
    expect(pickRecipient([], [{ sender: "Acme <no-reply@acme.com>" }, { sender: "me@gmail.com" }, { sender: null }], new Set(["me@gmail.com"]))).toBeNull();
  });
});

describe("applicationActions", () => {
  it("opens a Gmail draft to the recruiter from the mailbox that got their email", async () => {
    const db = freshDb();
    const first = await upsertAccount(db, "gmail", "first@gmail.com");
    const second = await upsertAccount(db, "outlook", "me@contoso.com");
    const id = await app(db, "Acme");
    await mail(db, first, id, { sender: "Other Person <other@acme.com>", when: "2026-10-16T10:00:00Z", body: "Hi" });
    await mail(db, second, id, { sender: "Nadia Khan <nadia@acme.com>", when: "2026-10-15T10:00:00Z", body: "Thanks for applying!\nNadia Khan\nSenior Technical Recruiter\nAcme" });
    const a = (await applicationActions(db, id, NOW))!;
    expect(a.to).toBe("nadia@acme.com");
    expect(a.draft!.url.startsWith("https://outlook.office.com/mail/deeplink/compose?")).toBe(true);
    expect(new URL(a.draft!.url).searchParams.get("body")).toMatch(/^Hi Nadia,\n/);
    expect(a.needsFollowUp).toBe(true);
    expect(a.interviews).toEqual([]);
  });

  it("has a draft without a recipient for a manual application, in the first connected mailbox", async () => {
    const db = freshDb();
    await upsertAccount(db, "gmail", "me@gmail.com");
    const id = await app(db, "Acme");
    const a = (await applicationActions(db, id, NOW))!;
    expect(a.to).toBe("");
    expect(a.draft!.url).toContain("https://mail.google.com/mail/?authuser=me%40gmail.com&view=cm&fs=1&su=");
    expect(a.draft!.url).not.toContain("&to=");
  });

  it("has no draft when there is no connected account", async () => {
    const db = freshDb();
    const id = await app(db, "Acme");
    expect((await applicationActions(db, id, NOW))!.draft).toBeNull();
  });

  it("has no draft when the only mailbox is switched off and there is no email to say which one", async () => {
    const db = freshDb();
    const acct = await upsertAccount(db, "gmail", "me@gmail.com");
    await db.accounts.update(acct, { active: false });
    const id = await app(db, "Acme");
    expect((await applicationActions(db, id, NOW))!.draft).toBeNull();
  });

  it("never opens the draft in a mailbox that has been disconnected, even the one that got the recruiter's email", async () => {
    const db = freshDb();
    const gone = await upsertAccount(db, "gmail", "old@gmail.com");
    await upsertAccount(db, "outlook", "me@contoso.com");
    const id = await app(db, "Acme");
    await mail(db, gone, id, { sender: "Nadia Khan <nadia@acme.com>", when: "2026-10-16T10:00:00Z", body: "Hi" });
    await db.accounts.update(gone, { active: false });
    const a = (await applicationActions(db, id, NOW))!;
    expect(a.to).toBe("nadia@acme.com");
    expect(a.draft!.url.startsWith("https://outlook.office.com/mail/deeplink/compose?")).toBe(true);
    expect(a.draft!.url).not.toContain("old%40gmail.com");
  });

  it("has no draft when the only mailbox that got email on this application has been disconnected", async () => {
    const db = freshDb();
    const acct = await upsertAccount(db, "gmail", "me@gmail.com");
    const id = await app(db, "Acme");
    await mail(db, acct, id, { sender: "Nadia Khan <nadia@acme.com>", body: "Hi" });
    await db.accounts.update(acct, { active: false });
    expect((await applicationActions(db, id, NOW))!.draft).toBeNull();
  });

  it("never writes to a disconnected mailbox's own address either", async () => {
    const db = freshDb();
    const gone = await upsertAccount(db, "gmail", "old@gmail.com");
    await upsertAccount(db, "outlook", "me@contoso.com");
    const id = await app(db, "Acme");
    await mail(db, gone, id, { sender: "Me Again <old@gmail.com>", body: "A note to myself" });
    await db.accounts.update(gone, { active: false });
    expect((await applicationActions(db, id, NOW))!.to).toBe("");
  });

  it("is null for an application that isn't there or has been deleted", async () => {
    const db = freshDb();
    await upsertAccount(db, "gmail", "me@gmail.com");
    const id = await app(db, "Acme");
    expect(await applicationActions(db, 999, NOW)).toBeNull();
    await db.applications.update(id, { deletedAt: "2026-11-01T00:00:00Z" });
    expect(await applicationActions(db, id, NOW)).toBeNull();
  });

  it("marks only a quiet Applied or Heard back application as needing a follow-up", async () => {
    const db = freshDb();
    await upsertAccount(db, "gmail", "me@gmail.com");
    const fresh = await app(db, "Fresh", { last: "2026-11-03T12:00:00Z" });
    const quiet = await app(db, "Quiet", { last: "2026-10-25T12:00:00Z" });
    const busy = await app(db, "Busy", { stage: "Interview", last: "2026-10-25T12:00:00Z" });
    expect((await applicationActions(db, fresh, NOW))!.needsFollowUp).toBe(false);
    expect((await applicationActions(db, quiet, NOW))!.needsFollowUp).toBe(true);
    expect((await applicationActions(db, busy, NOW))!.needsFollowUp).toBe(false);
  });

  it("lists the upcoming interview days with the company, role and stage, and follows a reschedule", async () => {
    const db = freshDb();
    const acct = await upsertAccount(db, "gmail", "me@gmail.com");
    const id = await app(db, "Acme", { stage: "Interview", role: "Data Analyst" });
    await mail(db, acct, id, { event: "interview", thread: "a", when: "2026-11-01T10:00:00Z", subject: "Interview", body: "We will meet on Nov 10." });
    await mail(db, acct, id, { event: "interview", thread: "b", when: "2026-11-02T10:00:00Z", subject: "Final round", body: "Meet on Nov 20." });
    await mail(db, acct, id, { event: "interview", thread: "b", when: "2026-11-03T10:00:00Z", subject: "Rescheduled: Final round", body: "Moved to Nov 23." });
    await mail(db, acct, id, { event: "interview", thread: "c", when: "2026-10-20T10:00:00Z", subject: "Screen", body: "Meet on Oct 28." });
    const a = (await applicationActions(db, id, NOW))!;
    expect(a.interviews).toEqual([
      { appId: id, company: "Acme", role: "Data Analyst", stage: "Interview", day: "2026-11-10" },
      { appId: id, company: "Acme", role: "Data Analyst", stage: "Interview", day: "2026-11-23" },
    ]);
  });

  it("shows no interview days for a rejected application or an offer", async () => {
    const db = freshDb();
    const acct = await upsertAccount(db, "gmail", "me@gmail.com");
    for (const stage of ["Rejected", "Offer"] as const) {
      const id = await app(db, stage, { stage });
      await mail(db, acct, id, { event: "interview", when: "2026-11-01T10:00:00Z", body: "We will meet on Nov 10." });
      expect((await applicationActions(db, id, NOW))!.interviews).toEqual([]);
    }
  });
});

describe("upcomingInterviewEvents", () => {
  it("collects every upcoming day of every live application, earliest first, leaving out closed and deleted ones", async () => {
    const db = freshDb();
    const acct = await upsertAccount(db, "gmail", "me@gmail.com");
    const a = await app(db, "Acme", { stage: "Interview" });
    const b = await app(db, "Beta", { stage: "Interview" });
    const rejected = await app(db, "Rejected", { stage: "Rejected" });
    const deleted = await app(db, "Gone", { stage: "Interview" });
    await db.applications.update(deleted, { deletedAt: "2026-11-01T00:00:00Z" });
    await mail(db, acct, a, { event: "interview", thread: "a1", when: "2026-11-01T10:00:00Z", body: "Meet on Nov 20." });
    await mail(db, acct, a, { event: "interview", thread: "a2", when: "2026-11-01T11:00:00Z", body: "Meet on Nov 9." });
    await mail(db, acct, b, { event: "interview", thread: "b1", when: "2026-11-01T10:00:00Z", body: "Meet on Nov 9." });
    await mail(db, acct, b, { event: "interview", thread: "b2", when: "2026-10-01T10:00:00Z", body: "Meet on Oct 9." });
    await mail(db, acct, rejected, { event: "interview", when: "2026-11-01T10:00:00Z", body: "Meet on Nov 12." });
    await mail(db, acct, deleted, { event: "interview", when: "2026-11-01T10:00:00Z", body: "Meet on Nov 12." });
    const events = await upcomingInterviewEvents(db, NOW);
    expect(events.map((e) => `${e.day} ${e.company}`)).toEqual(["2026-11-09 Acme", "2026-11-09 Beta", "2026-11-20 Acme"]);
    expect(await upcomingInterviewEvents(freshDb(), NOW)).toEqual([]);
  });
});
