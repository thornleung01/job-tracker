// Recently deleted: a delete hides an application for 30 days and keeps its emails and notes; restoring brings it all back;
// mail for it never resurrects it or starts a duplicate; purging erases what has waited 30 days.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionError, MissingRecordError, deleteApplication, editApplication, mergeApplications, notAnApplication, resolveReview, setStage } from "../../src/sync/actions";
import { addStep } from "../../src/sync/activity";
import { bulkDelete, bulkRestore } from "../../src/sync/bulk";
import * as contacts from "../../src/sync/contacts";
import { findDuplicates } from "../../src/sync/duplicates";
import { listApplications, reviewCount, reviewPage, stageCounts, suggestions, applicationDetail } from "../../src/sync/queries";
import { fillMissingRoles, settleReview, recheck } from "../../src/sync/recheck";
import { sankey } from "../../src/sync/stats";
import { decide } from "../../src/sync/decide";
import { processMessage, processMessages } from "../../src/sync/sync";
import { comingUp } from "../../src/sync/upcoming";
import {
  TRASH_DAYS, TRASH_MS, deleteForever, deletedApplication, emptyTrash, listDeleted, purgeExpired, purgeOncePerSession, restoreApplication, restoreApplications,
} from "../../src/sync/trash";
import { createApplication } from "../../src/db/repo";
import { DAY_MS, iso } from "../../src/db/time";
import { exportAll, importAll } from "../../src/portability";
import { closeAll, dbWithAccount, freshDb, mail, seedNote } from "./helpers";

afterEach(async () => {
  vi.restoreAllMocks();
  await closeAll();
});

const NOW = new Date("2026-10-12T16:00:00Z");

/** Acme (with an interview mail naming a day, a person, a note and a step) and Beta, both live. */
async function seed() {
  const { db, acct } = await dbWithAccount();
  const acme = await createApplication(db, { company: "Acme", companyKey: "acme", role: "Analyst", roleKey: "analyst", stage: "Interview", when: "2026-10-01T09:00:00Z" });
  const beta = await createApplication(db, { company: "Beta", companyKey: "beta", role: "Engineer", roleKey: "engineer", stage: "Applied", when: "2026-10-02T09:00:00Z" });
  await db.emails.add({
    accountId: acct, providerMsgId: "m1", threadId: "t1", receivedAt: "2026-10-10T14:00:00Z", sender: "Pat Lee <pat@acme.com>", subject: "Interview",
    body: "Your interview is on Oct 14.\n\nPat Lee\nSenior Recruiter\npat@acme.com", related: true, event: "interview", confidence: "high", applicationId: acme,
    needsReview: false, webLink: null, bulk: false, hold: false, reason: null,
  });
  await seedNote(db, acme, "Called the recruiter");
  await addStep(db, acme, "Phone screen", "2026-10-09", "", NOW);
  await db.contactEdits.put({ key: `${acme}|pat@acme.com`, name: "Patricia Lee", title: "Head of Talent", hidden: false });
  return { db, acct, acme, beta };
}

describe("a deleted application is hidden from every query", () => {
  const queries: [string, (db: Awaited<ReturnType<typeof seed>>["db"], acme: number) => Promise<unknown>, (live: unknown, gone: unknown) => void][] = [
    ["listApplications", (db) => listApplications(db, { now: NOW }), (live, gone) => {
      expect((live as { company: string }[]).map((r) => r.company).sort()).toEqual(["Acme", "Beta"]);
      expect((gone as { company: string }[]).map((r) => r.company)).toEqual(["Beta"]);
    }],
    ["listApplications by search and stage", (db) => listApplications(db, { q: "acme", stage: "Interview", now: NOW }), (live, gone) => {
      expect(live).toHaveLength(1);
      expect(gone).toHaveLength(0);
    }],
    ["stageCounts", (db) => stageCounts(db), (live, gone) => {
      expect((live as Record<string, number>).Interview).toBe(1);
      expect((gone as Record<string, number>).Interview).toBe(0);
    }],
    ["suggestions", (db) => suggestions(db), (live, gone) => {
      expect((live as { text: string }[]).map((s) => s.text)).toContain("Acme");
      expect((gone as { text: string }[]).map((s) => s.text)).not.toContain("Acme");
      expect((gone as { text: string }[]).map((s) => s.text)).not.toContain("Analyst");
    }],
    ["applicationDetail", (db, acme) => applicationDetail(db, acme, NOW), (live, gone) => {
      expect(live).not.toBeNull();
      expect(gone).toBeNull();
    }],
    ["applicationDetail of another application lists no deleted merge target", (db, acme) => applicationDetail(db, acme + 1, NOW), (live, gone) => {
      expect((live as { others: { company: string }[] }).others.map((o) => o.company)).toEqual(["Acme"]);
      expect((gone as { others: unknown[] }).others).toEqual([]);
    }],
    ["people (contacts.derive)", (db) => contacts.derive(db), (live, gone) => {
      expect((live as { name: string }[]).map((c) => c.name)).toEqual(["Patricia Lee"]);
      expect(gone).toEqual([]);
    }],
    ["people of one application", (db, acme) => contacts.derive(db, acme), (live, gone) => {
      expect(live).toHaveLength(1);
      expect(gone).toEqual([]);
    }],
    ["flow (sankey)", (db) => sankey(db), (live, gone) => {
      expect((live as { total: number }).total).toBe(2);
      expect((gone as { total: number; interviews: number }).total).toBe(1);
      expect((gone as { interviews: number }).interviews).toBe(0);
    }],
    ["coming up", async (db) => comingUp(await listApplications(db, { now: NOW }), "2026-10-12"), (live, gone) => {
      expect((live as { company: string }[]).map((r) => r.company)).toEqual(["Acme"]);
      expect(gone).toEqual([]);
    }],
    ["follow-ups", async (db, acme) => {
      await db.applications.update(acme, { stage: "Applied" });   // Interview is never chased; Applied and quiet for 7 to 29 days is
      return listApplications(db, { followUp: true, now: NOW });
    }, (live, gone) => {
      expect((live as unknown[]).length).toBeGreaterThan(0);
      expect((gone as { company: string }[]).map((r) => r.company)).not.toContain("Acme");
    }],
    ["the assign list in Needs review", async (db) => (await reviewPage(db, NOW)).apps, (live, gone) => {
      expect((live as { company: string }[]).map((a) => a.company)).toEqual(["Acme", "Beta"]);
      expect((gone as { company: string }[]).map((a) => a.company)).toEqual(["Beta"]);
    }],
    ["the duplicates warning", (db) => findDuplicates(db, "Acme", "Analyst"), (live, gone) => {
      expect(live).toHaveLength(1);
      expect(gone).toEqual([]);
    }],
  ];

  it.each(queries)("%s", async (_name, run, check) => {
    const { db, acme } = await seed();
    const live = await run(db, acme);
    await deleteApplication(db, acme);
    check(live, await run(db, acme));
  });

  it("keeps the emails, notes, steps and people corrections of a deleted application", async () => {
    const { db, acme } = await seed();
    await deleteApplication(db, acme, "clear", NOW);
    expect(await db.emails.where("applicationId").equals(acme).count()).toBe(1);
    expect((await db.emails.toArray())[0].subject).toBe("Interview");
    expect(await db.activity.where("applicationId").equals(acme).count()).toBe(2);
    expect(await db.contactEdits.count()).toBe(1);
    expect(await reviewCount(db)).toBe(0);
  });
});

describe("restoring", () => {
  it("brings the application back with the same id, its emails, notes, steps and people corrections", async () => {
    const { db, acme } = await seed();
    const before = await applicationDetail(db, acme, NOW);
    await deleteApplication(db, acme, "clear", NOW);
    expect(await restoreApplication(db, acme)).toBe(true);
    const after = await applicationDetail(db, acme, NOW);
    expect(after?.application.id).toBe(acme);
    expect(after).toEqual(before);
    expect(after?.emails).toHaveLength(1);
    expect(after?.notes.map((n) => n.body || n.title).sort()).toEqual(["Called the recruiter", "Phone screen"]);
    expect(after?.people[0].name).toBe("Patricia Lee");
    // the field is gone, not just empty, so an export of it is the same as before the delete
    expect(await db.applications.get(acme)).not.toHaveProperty("deletedAt");
  });

  it("says false for one that is not deleted and throws for one that is gone", async () => {
    const { db, acme } = await seed();
    expect(await restoreApplication(db, acme)).toBe(false);
    await expect(restoreApplication(db, 999)).rejects.toBeInstanceOf(MissingRecordError);
  });

  it("brings several back in one transaction, and none when one of them was erased meanwhile", async () => {
    const { db, acme, beta } = await seed();
    await deleteApplication(db, acme, undefined, NOW);
    await deleteApplication(db, beta, undefined, NOW);
    await expect(restoreApplications(db, [acme, 999, beta])).rejects.toBeInstanceOf(MissingRecordError);
    expect((await db.applications.get(acme))?.deletedAt).toBeDefined();   // all or none
    expect(await restoreApplications(db, [acme, beta])).toBe(2);
    expect(await restoreApplications(db, [acme, beta])).toBe(0);   // already live
  });

  it("is what Undo does after a bulk delete", async () => {
    const { db, acme, beta } = await seed();
    expect(await bulkDelete(db, [acme, beta])).toBe(2);
    expect(await listApplications(db)).toHaveLength(0);
    expect(await bulkRestore(db, [acme, beta])).toBe(2);
    expect((await listApplications(db)).map((r) => r.id).sort()).toEqual([acme, beta]);
    expect((await applicationDetail(db, acme))?.emails).toHaveLength(1);
  });
});

describe("actions on a deleted application behave as no such application", () => {
  it("refuses single-row actions with MissingRecordError, and deleting twice", async () => {
    const { db, acme } = await seed();
    await deleteApplication(db, acme);
    await expect(setStage(db, acme, "Offer")).rejects.toBeInstanceOf(MissingRecordError);
    await expect(editApplication(db, acme, "Acme 2", "Role")).rejects.toBeInstanceOf(MissingRecordError);
    await expect(addStep(db, acme, "Phone screen")).rejects.toBeInstanceOf(MissingRecordError);
    await expect(deleteApplication(db, acme)).rejects.toBeInstanceOf(MissingRecordError);
    await expect(deleteApplication(db, acme, "review")).rejects.toBeInstanceOf(MissingRecordError);
    await expect(notAnApplication(db, acme)).rejects.toBeInstanceOf(MissingRecordError);
    expect((await db.applications.get(acme))?.stage).toBe("Interview");
    expect(await db.emails.where("applicationId").equals(acme).count()).toBe(1);
  });

  it("refuses to merge into a deleted application, or to merge a deleted one", async () => {
    const { db, acme, beta } = await seed();
    await deleteApplication(db, beta);
    await expect(mergeApplications(db, acme, beta)).rejects.toBeInstanceOf(ActionError);
    await expect(mergeApplications(db, beta, acme)).rejects.toBeInstanceOf(ActionError);
    expect(await db.emails.where("applicationId").equals(acme).count()).toBe(1);
    expect(await db.applications.get(acme)).toBeDefined();
  });

  it("cannot be chosen in Needs review", async () => {
    const { db, acct, acme } = await seed();
    const review = await db.emails.add({
      accountId: acct, providerMsgId: "r1", threadId: "tr", receivedAt: "2026-10-11T10:00:00Z", sender: "x <x@y.com>", subject: "s", body: "b", related: true,
      event: "heard_back", confidence: "low", applicationId: null, needsReview: true, webLink: null, bulk: false, hold: false, reason: null,
    });
    await deleteApplication(db, acme);
    await expect(resolveReview(db, review, { action: "assign", appId: acme })).rejects.toBeInstanceOf(ActionError);
    expect((await db.emails.get(review))?.needsReview).toBe(true);
  });
});

describe("mail for a deleted application", () => {
  const applied = (id: string, thread = "t1", day = 1) =>
    mail("Thank you for applying to Acme", "We received your application for the Analyst role.", "Acme <jobs@acme.com>", id, day, thread);
  const interview = (id: string, thread: string, day: number) =>
    mail("Interview times", "We would like to schedule an interview with you for the Analyst role at Acme.", "Pat Lee <pat@acme.com>", id, day, thread);

  async function acmeDeleted() {
    const { db, acct } = await dbWithAccount();
    await processMessages(db, acct, [applied("a"), interview("b", "t1", 3)]);
    const [acme] = await db.applications.toArray();
    await deleteApplication(db, acme.id, "clear", NOW);
    return { db, acct, id: acme.id };
  }

  it("is kept with it, in the same thread or at the same company, and neither resurrects it nor starts a duplicate", async () => {
    const { db, acct, id } = await acmeDeleted();
    expect(await processMessage(db, acct, interview("c", "t1", 5))).toBe("applied-to-application");   // same thread
    expect(await processMessage(db, acct, interview("d", "t9", 6))).toBe("applied-to-application");   // a new thread, same company and role
    expect(await db.applications.count()).toBe(1);
    expect(await listApplications(db)).toHaveLength(0);
    expect((await db.emails.where("applicationId").equals(id).toArray()).map((e) => e.providerMsgId).sort()).toEqual(["a", "b", "c", "d"]);
    expect(await reviewCount(db)).toBe(0);
    // and it is all there when you restore it
    await restoreApplication(db, id);
    expect((await applicationDetail(db, id))?.emails).toHaveLength(4);
  });

  const emailsOf = async (db: Awaited<ReturnType<typeof acmeDeleted>>["db"], id: number) =>
    (await db.emails.where("applicationId").equals(id).toArray()).map((e) => e.providerMsgId).sort();

  it("a new 'applied' email starts a new application, leaves the deleted one deleted, and survives its erasing", async () => {
    const { db, acct, id } = await acmeDeleted();
    expect(await processMessage(db, acct, applied("n", "t10", 15))).toBe("applied-to-application");
    const live = await listApplications(db);
    expect(live.map((r) => [r.company, r.role, r.stage, r.nEmails])).toEqual([["Acme", "Analyst", "Applied", 1]]);
    expect(live[0].id).not.toBe(id);
    expect((await db.applications.get(id))?.deletedAt).toBeDefined();
    expect(await emailsOf(db, id)).toEqual(["a", "b"]);
    expect(await reviewCount(db)).toBe(0);
    // the old one is erased at day 30; the new application and its email are not touched
    expect(await purgeExpired(db, new Date(NOW.getTime() + 31 * DAY_MS))).toBe(1);
    expect(await db.applications.get(id)).toBeUndefined();
    expect((await listApplications(db)).map((r) => r.id)).toEqual([live[0].id]);
    expect((await applicationDetail(db, live[0].id))?.emails[0].subject).toBe("Thank you for applying to Acme");
  });

  it("an 'applied' email in the deleted application's own thread also starts a new one, and later mail in that thread follows the new one", async () => {
    const { db, acct, id } = await acmeDeleted();
    expect(await processMessage(db, acct, applied("n", "t1", 15))).toBe("applied-to-application");
    const [fresh] = await listApplications(db);
    expect(fresh.id).not.toBe(id);
    expect(await emailsOf(db, id)).toEqual(["a", "b"]);
    expect(await processMessage(db, acct, interview("c", "t1", 20))).toBe("applied-to-application");
    expect(await emailsOf(db, fresh.id)).toEqual(["c", "n"]);
    expect(await emailsOf(db, id)).toEqual(["a", "b"]);
    // restoring the old one brings back both Acme applications, each with its own emails
    await restoreApplication(db, id);
    expect((await listApplications(db)).map((r) => r.nEmails).sort()).toEqual([2, 2]);
  });

  it.each([
    ["a rejection", "Your application to Acme", "Unfortunately, we have decided not to move forward with your application for the Analyst role at Acme.", "Rejected"],
    ["an offer", "Your offer from Acme", "We are pleased to offer you the Analyst position at Acme. Please find your offer letter attached.", "Offer"],
  ])("%s is kept with the deleted application: no live row, nothing in Needs review, and a restore brings it all back", async (_name, subject, body, stage) => {
    const { db, acct, id } = await acmeDeleted();
    expect(await processMessage(db, acct, mail(subject, body, "Acme <jobs@acme.com>", "r1", 14, "t11"))).toBe("applied-to-application");
    expect(await listApplications(db)).toEqual([]);
    expect(await db.applications.count()).toBe(1);
    expect(await reviewCount(db)).toBe(0);
    expect(await emailsOf(db, id)).toEqual(["a", "b", "r1"]);
    expect((await db.applications.get(id))?.stage).toBe(stage);
    await restoreApplication(db, id);
    const [back] = await listApplications(db);
    expect([back.id, back.stage, back.nEmails]).toEqual([id, stage, 3]);
  });

  it("a reply in the deleted application's own thread stays with it, though another application at the company is open", async () => {
    const { db, acct, id } = await acmeDeleted();
    const other = await createApplication(db, { company: "Acme", companyKey: "acme", role: "Designer", roleKey: "designer", stage: "Applied", when: "2026-10-04T09:00:00Z" });
    // it names no role, so by company alone the open Designer application would take it: the thread says it is the Analyst one
    expect(await processMessage(db, acct, mail("Interview times", "We would like to schedule an interview with you at Acme.", "Pat Lee <pat@acme.com>", "g", 9, "t1"))).toBe("applied-to-application");
    expect(await emailsOf(db, id)).toEqual(["a", "b", "g"]);
    const [designer] = await listApplications(db);
    expect([designer.id, designer.stage, designer.nEmails]).toEqual([other, "Applied", 0]);
    expect(await reviewCount(db)).toBe(0);
  });

  describe("weak mail", () => {
    const weak = { related: true, event: "interview", confidence: "low", reason: "weak: schedule" } as const;
    const decideFor = async (db: Awaited<ReturnType<typeof acmeDeleted>>["db"], acct: number, cls: Parameters<typeof decide>[3]) => {
      const msg = interview("z", "t1", 9);
      return decide(db, acct, msg, cls, iso(msg.receivedAt));
    };

    it("for a deleted application goes to Needs review like any other, and doesn't move the hidden application", async () => {
      const { db, acct, id } = await acmeDeleted();
      const stage = (await db.applications.get(id))?.stage;
      expect(await decideFor(db, acct, weak)).toEqual({ appId: null, needsReview: true });
      expect((await db.applications.get(id))?.stage).toBe(stage);
      // the same mail with strong wording is kept with it, silently
      expect(await decideFor(db, acct, { ...weak, confidence: "medium" })).toEqual({ appId: id, needsReview: false });
    });

    it("that is only 'heard back' is still kept with the deleted application, as it is with a live one", async () => {
      const { db, acct, id } = await acmeDeleted();
      expect(await decideFor(db, acct, { ...weak, event: "heard_back" })).toEqual({ appId: id, needsReview: false });
    });
  });

  it("is not matched to a live application", async () => {
    const { db, acct, id } = await acmeDeleted();
    const other = await createApplication(db, { company: "Acme", companyKey: "acme", role: "Designer", roleKey: "designer", stage: "Applied", when: "2026-10-04T09:00:00Z" });
    const where = async (msgId: string) => (await db.emails.toArray()).find((e) => e.providerMsgId === msgId)?.applicationId;
    // it names the deleted role, so it goes with the deleted application, not to the only open live one
    await processMessage(db, acct, interview("e", "t8", 7));
    expect(await where("e")).toBe(id);
    // it names no role, so the only open live application at Acme takes it, as it always did
    await processMessage(db, acct, mail("Interview times", "We would like to schedule an interview with you at Acme.", "Pat Lee <pat@acme.com>", "g", 9, "t6"));
    expect(await where("g")).toBe(other);
    expect((await listApplications(db)).map((r) => [r.id, r.nEmails])).toEqual([[other, 1]]);
  });

  it("still starts a new application for a different job at the same company", async () => {
    const { db, acct } = await acmeDeleted();
    const outcome = await processMessage(db, acct, mail("Thank you for applying to Acme", "We received your application for the Designer role.", "Acme <jobs@acme.com>", "f", 8, "t7"));
    expect(outcome).toBe("applied-to-application");
    expect((await listApplications(db)).map((r) => r.role)).toEqual(["Designer"]);
  });

  it("is left alone by a recheck that no longer believes it, though a live one would have been cleared", async () => {
    const hello = () => mail("Hello", "Thank you for applying to Acme for the Analyst role. We received your application.", "Acme Careers <jobs@acme.com>", "h", 1, "th");
    const rule = { kind: "block_sender", value: "jobs@acme.com", evidence: 3, active: true, createdAt: "2026-10-02T00:00:00Z" } as const;
    // the control: the same mail on a live application is cleared and the application removed
    const control = await dbWithAccount();
    await processMessage(control.db, control.acct, hello());
    await control.db.learnedRules.add(rule);
    expect(await recheck(control.db)).toMatchObject({ cleared: 1, removed: 1 });
    // deleted: nothing is cleared or removed, so a restore still has everything
    const { db, acct } = await dbWithAccount();
    await processMessage(db, acct, hello());
    const [app] = await db.applications.toArray();
    await deleteApplication(db, app.id);
    await db.learnedRules.add(rule);
    expect(await recheck(db)).toMatchObject({ cleared: 0, removed: 0 });
    expect(await settleReview(db)).toBe(0);
    expect(await db.applications.get(app.id)).toBeDefined();
    expect((await db.emails.where("applicationId").equals(app.id).toArray())[0].subject).toBe("Hello");
  });
});

describe("filling in missing roles", () => {
  /** An application made without a role, with a saved email that names one. */
  async function withoutRole() {
    const { db, acct } = await dbWithAccount();
    const id = await createApplication(db, { company: "Acme", companyKey: "acme", role: "", roleKey: "", stage: "Applied", when: "2026-10-01T09:00:00Z" });
    const m = mail("Thank you for applying to Acme", "We received your application for the Analyst role.", "Acme <jobs@acme.com>", "r", 1, "tr");
    await db.emails.add({
      accountId: acct, providerMsgId: m.id, threadId: m.threadId, receivedAt: m.receivedAt, sender: "Acme <jobs@acme.com>", subject: m.subject, body: m.body,
      related: true, event: "applied", confidence: "high", applicationId: id, needsReview: false, webLink: null, bulk: false, hold: false, reason: null,
    });
    return { db, id };
  }

  it("fills the role of a live application", async () => {
    const { db, id } = await withoutRole();
    expect(await fillMissingRoles(db)).toBe(1);
    expect((await db.applications.get(id))?.role).toBe("Analyst");
  });

  it("leaves a deleted application as it was, so a restore brings back what was deleted", async () => {
    const { db, id } = await withoutRole();
    await deleteApplication(db, id);
    expect(await fillMissingRoles(db)).toBe(0);
    expect((await db.applications.get(id))?.role).toBe("");
  });
});

describe("erasing for good", () => {
  async function trashed() {
    const { db, acct, acme, beta } = await seed();
    await deleteApplication(db, acme, "clear", NOW);
    return { db, acct, acme, beta };
  }

  it("Delete now clears every email's content and removes the application, its notes and corrections", async () => {
    const { db, acme, beta } = await trashed();
    expect(await deleteForever(db, acme)).toBe(true);
    expect(await db.applications.get(acme)).toBeUndefined();
    const mail1 = (await db.emails.toArray())[0];
    expect([mail1.applicationId, mail1.subject, mail1.body, mail1.sender, mail1.related]).toEqual([null, null, null, null, false]);
    expect(await db.activity.count()).toBe(0);
    expect(await db.contactEdits.count()).toBe(0);
    expect(await db.applications.get(beta)).toBeDefined();
  });

  it("never erases a live application, and says false for one that is already gone", async () => {
    const { db, beta } = await trashed();
    expect(await deleteForever(db, beta)).toBe(false);
    expect(await deleteForever(db, 999)).toBe(false);
    expect(await db.applications.get(beta)).toBeDefined();
  });

  it("Empty recently deleted erases only the deleted ones", async () => {
    const { db, beta } = await trashed();
    await deleteApplication(db, beta, "clear", NOW);
    const live = await createApplication(db, { company: "Live", companyKey: "live", role: "R", roleKey: "r", stage: "Applied", when: "2026-10-03T09:00:00Z" });
    expect(await emptyTrash(db)).toBe(2);
    expect((await db.applications.toArray()).map((a) => a.id)).toEqual([live]);
    expect(await listDeleted(db, NOW)).toEqual([]);
    expect(await emptyTrash(db)).toBe(0);
  });

  it("'Delete, keep emails for review' still removes the row now and sends the emails to Needs review, held", async () => {
    const { db, acme } = await seed();
    await deleteApplication(db, acme, "review");
    expect(await db.applications.get(acme)).toBeUndefined();
    expect((await db.emails.toArray())[0]).toMatchObject({ applicationId: null, needsReview: true, hold: true, subject: "Interview" });
    expect(await listDeleted(db)).toEqual([]);
  });

  it("'Not an application' still removes it now and clears its emails", async () => {
    const { db, acme } = await seed();
    await notAnApplication(db, acme);
    expect(await db.applications.get(acme)).toBeUndefined();
    expect((await db.emails.toArray())[0]).toMatchObject({ applicationId: null, subject: null, related: false });
  });
});

describe("the list of deleted applications", () => {
  it("shows company, role, stage, days ago and days left, most recently deleted first", async () => {
    const { db, acme, beta } = await seed();
    await deleteApplication(db, acme, "clear", new Date(NOW.getTime() - 3 * DAY_MS));
    await deleteApplication(db, beta, "clear", new Date(NOW.getTime() - 29.5 * DAY_MS));
    const list = await listDeleted(db, NOW);
    expect(list.map((e) => [e.company, e.role, e.stage, e.daysAgo, e.daysLeft])).toEqual([["Acme", "Analyst", "Interview", 3, 27], ["Beta", "Engineer", "Applied", 29, 1]]);
    expect(await deletedApplication(db, acme, NOW)).toMatchObject({ company: "Acme", daysLeft: 27 });
    expect(await deletedApplication(db, 999)).toBeNull();
  });

  it("does not list a live application, and deletedApplication says null for it", async () => {
    const { db, acme } = await seed();
    expect(await listDeleted(db)).toEqual([]);
    expect(await deletedApplication(db, acme)).toBeNull();
  });
});

describe("purging after 30 days", () => {
  const T0 = new Date("2026-03-01T05:00:00Z");

  async function deletedAt(when: Date) {
    const { db, acme, beta } = await seed();
    await deleteApplication(db, acme, "clear", when);
    return { db, acme, beta };
  }

  it("keeps an application at day 29 and erases it at day 31", async () => {
    const { db, acme } = await deletedAt(T0);
    expect(await purgeExpired(db, new Date(T0.getTime() + 29 * DAY_MS))).toBe(0);
    expect((await db.applications.get(acme))?.deletedAt).toBeDefined();
    expect((await db.emails.toArray())[0].subject).toBe("Interview");
    expect(await purgeExpired(db, new Date(T0.getTime() + 31 * DAY_MS))).toBe(1);
    expect(await db.applications.get(acme)).toBeUndefined();
    expect((await db.emails.toArray())[0]).toMatchObject({ applicationId: null, subject: null, body: null, related: false });
    expect(await db.activity.count()).toBe(0);
  });

  it("counts 30 x 24 hours on the timestamp: the second before is kept, the exact moment erases", async () => {
    expect(TRASH_DAYS * DAY_MS).toBe(TRASH_MS);
    const { db, acme } = await deletedAt(T0);
    expect(await purgeExpired(db, new Date(T0.getTime() + TRASH_MS - 1000))).toBe(0);
    expect(await db.applications.get(acme)).toBeDefined();
    expect(await purgeExpired(db, new Date(T0.getTime() + TRASH_MS))).toBe(1);
  });

  it("never touches a live application or one deleted more recently", async () => {
    const { db, acme, beta } = await deletedAt(T0);
    await deleteApplication(db, beta, "clear", new Date(T0.getTime() + 20 * DAY_MS));
    const live = await createApplication(db, { company: "Live", companyKey: "live", role: "R", roleKey: "r", stage: "Applied", when: "2026-02-01T09:00:00Z" });
    expect(await purgeExpired(db, new Date(T0.getTime() + 40 * DAY_MS))).toBe(1);
    expect(await db.applications.get(acme)).toBeUndefined();
    expect(await db.applications.get(beta)).toBeDefined();
    expect(await db.applications.get(live)).toBeDefined();
  });

  // The same instants in every zone: the cut-off is on the timestamp, so a clock change or a time zone can't move it.
  // Deleted just before the spring and autumn clock changes of Toronto, Auckland and Kiritimati's neighbours.
  it.each([
    ["Toronto spring forward", "2026-03-07T12:00:00Z"],
    ["Toronto fall back", "2026-10-31T12:00:00Z"],
    ["Auckland spring forward", "2026-09-25T10:00:00Z"],
    ["London autumn", "2026-10-10T23:30:00Z"],
    ["the leap day", "2028-02-29T00:00:00Z"],
    ["the new year", "2026-12-31T23:59:59Z"],
  ])("is exactly 30 x 24 hours across %s", async (_name, start) => {
    const t0 = new Date(start);
    const { db, acme } = await deletedAt(t0);
    const at = (days: number, extraMs = 0) => new Date(t0.getTime() + days * 24 * 3600_000 + extraMs);
    expect(await purgeExpired(db, at(29, 23 * 3600_000))).toBe(0);
    expect((await listDeleted(db, at(29, 23 * 3600_000)))[0]).toMatchObject({ daysAgo: 29, daysLeft: 1 });
    expect(await purgeExpired(db, at(30, -1))).toBe(0);
    expect(await purgeExpired(db, at(30))).toBe(1);
    expect(await db.applications.get(acme)).toBeUndefined();
  });

  it("runs once per session however often it is asked, and survives a failure", async () => {
    const { db, acme } = await deletedAt(T0);
    const later = new Date(T0.getTime() + 40 * DAY_MS);
    await purgeOncePerSession(db, new Date(T0.getTime() + DAY_MS));
    expect(await db.applications.get(acme)).toBeDefined();
    await purgeOncePerSession(db, later);   // already ran for this database in this session
    expect(await db.applications.get(acme)).toBeDefined();
    const other = await deletedAt(T0);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(other.db.applications, "toArray").mockRejectedValue(new Error("disk full"));
    await expect(purgeOncePerSession(other.db, later)).resolves.toBeUndefined();
  });

  it("erases each application in a transaction of its own: one that fails is left whole and doesn't hold back the others", async () => {
    const { db, acme, beta } = await deletedAt(T0);   // acme holds an email, notes, steps and a contact edit
    await deleteApplication(db, beta, "clear", T0);
    const gamma = await createApplication(db, { company: "Gamma", companyKey: "gamma", role: "R", roleKey: "r", stage: "Applied", when: "2026-02-01T09:00:00Z" });
    await deleteApplication(db, gamma, "clear", T0);
    const real = db.applications.delete.bind(db.applications);
    let calls = 0;
    vi.spyOn(db.applications, "delete").mockImplementation(((...args: Parameters<typeof real>) => {
      if (++calls === 1) throw new Error("disk full");   // acme, the first one listed, fails after its emails were cleared inside its transaction
      return real(...args);
    }) as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(purgeExpired(db, new Date(T0.getTime() + 40 * DAY_MS))).rejects.toThrow("disk full");
    vi.restoreAllMocks();
    expect(await db.applications.get(beta)).toBeUndefined();
    expect(await db.applications.get(gamma)).toBeUndefined();
    // the one that failed is whole: still deleted, with its email text, notes, steps and contact edit
    expect((await db.applications.get(acme))?.deletedAt).toBeDefined();
    expect((await db.emails.toArray())[0]).toMatchObject({ applicationId: acme, subject: "Interview", related: true });
    expect(await db.activity.where("applicationId").equals(acme).count()).toBe(2);
    expect(await db.contactEdits.count()).toBe(1);
    // and the next purge takes it
    expect(await purgeExpired(db, new Date(T0.getTime() + 41 * DAY_MS))).toBe(1);
    expect(await db.applications.get(acme)).toBeUndefined();
    expect((await db.emails.toArray())[0]).toMatchObject({ applicationId: null, subject: null });
  });

  it("starts the 30 days now for a deletedAt in the future, so it can't stay forever", async () => {
    const { db, acme } = await deletedAt(new Date(T0.getTime() + 400 * DAY_MS));   // a hand-edited file, or a clock that was ahead
    expect(await purgeExpired(db, new Date(T0.getTime() + 40 * DAY_MS))).toBe(0);
    expect((await db.applications.get(acme))?.deletedAt).toBe(iso(new Date(T0.getTime() + 40 * DAY_MS)));
    expect((await db.emails.toArray())[0].subject).toBe("Interview");
    expect(await purgeExpired(db, new Date(T0.getTime() + 69 * DAY_MS))).toBe(0);
    expect(await purgeExpired(db, new Date(T0.getTime() + 71 * DAY_MS))).toBe(1);
    expect(await db.applications.get(acme)).toBeUndefined();
  });

  it("leaves one that was restored while the purge ran", async () => {
    const { db, acme } = await deletedAt(T0);
    const realToArray = db.applications.toArray.bind(db.applications);
    vi.spyOn(db.applications, "toArray").mockImplementationOnce((async () => {
      const rows = await realToArray();
      await restoreApplication(db, acme);   // the person restores it just after the purge listed it
      return rows;
    }) as never);
    expect(await purgeExpired(db, new Date(T0.getTime() + 40 * DAY_MS))).toBe(0);
    expect(await db.applications.get(acme)).toBeDefined();
    expect((await db.emails.toArray())[0].subject).toBe("Interview");
  });
});

describe("export and import", () => {
  it("carries deletedAt through a round trip and keeps the application hidden", async () => {
    const { db, acme } = await seed();
    await deleteApplication(db, acme, "clear", NOW);
    const file = JSON.parse(JSON.stringify(await exportAll(db, NOW)));
    expect(file.data.applications.find((a: { id: number }) => a.id === acme).deletedAt).toBe(iso(NOW));
    const other = freshDb();
    await importAll(other, file);
    expect((await other.applications.get(acme))?.deletedAt).toBe(iso(NOW));
    expect((await listApplications(other)).map((r) => r.company)).toEqual(["Beta"]);
    expect((await listDeleted(other, NOW)).map((e) => e.company)).toEqual(["Acme"]);
    expect(await restoreApplication(other, acme)).toBe(true);
    expect((await listApplications(other)).map((r) => r.company).sort()).toEqual(["Acme", "Beta"]);
  });

  it("drops a deletedAt that is not a time, so the application stays live, and never fails the import", async () => {
    const { db } = await seed();
    const file = JSON.parse(JSON.stringify(await exportAll(db, NOW)));
    for (const [i, bad] of [42, "yesterday", "", null, {}].entries()) {
      file.data.applications[i % 2].deletedAt = bad;
      const target = freshDb();
      await importAll(target, file);
      expect((await target.applications.toArray()).every((a) => !("deletedAt" in a))).toBe(true);
    }
  });

  it("leaves deleted applications out of the CSV and keeps them in the JSON", async () => {
    const { applicationsToCsv } = await import("../../src/portability/csv");
    const { db, acme } = await seed();
    await deleteApplication(db, acme);
    expect(applicationsToCsv(await listApplications(db))).not.toContain("Acme");
    expect((await exportAll(db)).data.applications.map((a) => a.company).sort()).toEqual(["Acme", "Beta"]);
  });
});
