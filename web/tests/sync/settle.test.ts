// Ports of tests/test_settle.py and tests/test_delete.py, plus the application actions from web.py.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ActionError, addApplication, deleteApplication, editApplication, mergeApplications, resolveReview, setStage, unlockStage,
} from "../../src/sync/actions";
import { fillMissingRoles, recheck, settleReview } from "../../src/sync/recheck";
import { processMessage, processMessages } from "../../src/sync/sync";
import { createApplication, upsertAccount } from "../../src/db/repo";
import { sameRole } from "../../src/sync/match";
import { localToday } from "../../src/db/time";
import { classify, extractCompanyRole } from "../../src/pipeline";
import { closeAll, dbWithAccount, freshDb, mail, seedNote } from "./helpers";
import { pinClock } from "../support/clock";

pinClock();
afterEach(closeAll);

const reviewCount = async (db: ReturnType<typeof freshDb>) => (await db.emails.toArray()).filter((e) => e.needsReview).length;

describe("wording from real emails", () => {
  it("recognises curly apostrophes in a confirmation", () => {
    const cls = classify(mail("Good move", "Hey Jordan ! This is just a note to confirm that we’ve received your application, and we think it’s pretty awesome.", "Shopify Hiring Team <recruiting@talent.shopify.com>"));
    expect([cls.related, cls.event]).toEqual([true, "applied"]);
  });

  it.each([
    ["Recruiter Screen interview - Jordan Lee - Operations Manager | NAM", "Confirmed Your event has been scheduled"],
    ["Reminder - DoorDash Zoom Interview | JORDAN LEE", "Reminder! Sara has invited you to attend: DoorDash Zoom Interview | JORDAN LEE"],
    ["DoorDash | Next Steps", "I’m excited to share that the team would love to move you forward to the next stage of the interview process!"],
  ])("reads %s as an interview", (subject, body) => {
    const cls = classify(mail(subject, body, "Pat Lee <pat@doordash.com>"));
    expect([cls.related, cls.event]).toEqual([true, "interview"]);
  });

  it("names the employer from a Workday sender", () => {
    const msg = mail("Clio - Thank you for your application",
      "Update On Your Application Hi Jordan Thank you for taking the time to consider the Senior Strategy & Operations Associate position at Clio! regrettably, we have decided not to move forward", "clio@myworkday.com");
    expect(extractCompanyRole(msg)).toEqual(["Clio", "Senior Strategy & Operations Associate"]);
  });

  it("treats the same job with a team or place added as the same job", () => {
    expect(sameRole("operationsmanager", "operationsmanagernam", "Operations Manager", "Operations Manager | NAM")).toBe(true);
    expect(sameRole("dataanalyst", "operationsmanager", "Data Analyst", "Operations Manager")).toBe(false);
    expect(sameRole("", "operationsmanager", "", "Operations Manager")).toBe(false);
  });
});

describe("weak mail and settling", () => {
  it("attaches weak mail in a conversation you already follow", async () => {
    const { db, acct } = await dbWithAccount();
    expect(await processMessage(db, acct, mail("Thank you for applying to Deel", "We received your application for the Operations Manager | NAM position.", "Deel Hiring <no-reply@deel.com>", "a", 1))).toBe("applied-to-application");
    const weak = mail("Update From Deel", "Hi Jordan, Thank so much for taking the time to meet with Dan and complete the interview process for the Operations Manager role here at Deel! I have an exciting update I'd love to share with you, do you have time for a quick video", "Sam Lee <sam@deel.com>", "b", 5, "other");
    expect(classify(weak).confidence).toBe("low");
    expect(await processMessage(db, acct, weak)).toBe("applied-to-application");
    expect(await db.applications.count()).toBe(1);
  });

  it("leaves weak mail about an unknown company for you", async () => {
    const { db, acct } = await dbWithAccount();
    const weak = mail("Update", "Hi Jordan, I have an update on the interview process for the role. Do you have a few minutes to chat?", "Sam Lee <sam@unknown-co.com>");
    expect(await processMessage(db, acct, weak)).toBe("review");
  });

  it("settles early mail once its application exists, and not twice", async () => {
    const { db, acct } = await dbWithAccount();
    const early = mail("Next steps", "We would like to schedule an interview with you for the Analyst role at Acme.", "Pat Lee <pat@acme.com>", "early", 1);
    expect(await processMessage(db, acct, early)).toBe("review");
    const later = mail("Thank you for applying to Acme", "We received your application for the Analyst role.", "Acme <jobs@acme.com>", "later", 3);
    expect(await processMessage(db, acct, later)).toBe("applied-to-application");
    expect(await reviewCount(db)).toBe(1);
    expect(await settleReview(db)).toBe(1);
    expect(await reviewCount(db)).toBe(0);
    expect(await db.applications.count()).toBe(1);
    expect((await recheck(db)).settled).toBe(0);
  });

  it("never touches mail that is still unsure", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessage(db, acct, mail("Reminder: Survey on student financing", "Hello, you were invited to a survey about your application experience.", "survey@esdc.gc.ca"));
    const before = await reviewCount(db);
    expect(await settleReview(db)).toBe(0);
    expect(await reviewCount(db)).toBe(before);
  });

  it("does not write a waiting email again when nothing about it changed", async () => {
    const { db, acct } = await dbWithAccount();
    const weak = mail("Update", "Hi Jordan, I have an update on the interview process for the role. Do you have a few minutes to chat?", "Sam Lee <sam@unknown-co.com>");
    expect(await processMessage(db, acct, weak)).toBe("review");
    const write = vi.spyOn(db.emails, "update");
    expect(await settleReview(db)).toBe(0);
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });

  it("fills a missing role from the saved emails", async () => {
    const { db, acct } = await dbWithAccount();
    const app = await createApplication(db, { company: "Acme", companyKey: "acme", role: "Unknown role", roleKey: "", stage: "Applied", when: "2026-10-01T09:00:00Z" });
    await db.emails.add({
      accountId: acct, providerMsgId: "r", threadId: "t", receivedAt: "2026-10-01T09:00:00Z", sender: "Acme <jobs@acme.com>", subject: "Thank you for applying to Acme",
      body: "We received your application for the Data Analyst position.", related: true, event: "applied", confidence: "high", applicationId: app,
      needsReview: false, webLink: null, bulk: false, hold: false, reason: null,
    });
    expect(await fillMissingRoles(db)).toBe(1);
    expect((await db.applications.get(app))!.role).toBe("Data Analyst");
  });
});

async function deleteEnv() {
  const { db, acct } = await dbWithAccount();
  await processMessages(db, acct, [
    mail("Thank you for applying to Acme", "We received your application for the Analyst role.", "Acme <jobs@acme.com>", "a", 1, "t1"),
    mail("Interview times", "We would like to schedule an interview with you for the Analyst role at Acme.", "Pat Lee <pat@acme.com>", "b", 3, "t1"),
  ]);
  return { db, acct };
}

describe("deleting an application", () => {
  it("sticks through rechecks and later syncs", async () => {
    const { db, acct } = await deleteEnv();
    expect(await db.applications.count()).toBe(1);
    await deleteApplication(db, 1);
    expect(await db.applications.count()).toBe(0);
    expect((await db.emails.toArray()).filter((e) => e.related)).toHaveLength(0);
    expect(await reviewCount(db)).toBe(0);
    expect(await settleReview(db)).toBe(0);
    expect((await recheck(db)).settled).toBe(0);
    expect(await processMessage(db, acct, mail("Thank you for applying to Acme", "We received your application.", "Acme <jobs@acme.com>", "a"))).toBe("duplicate");
    expect(await db.applications.count()).toBe(0);
  });

  it("can send its emails to review, held there so a sync does not re-attach them", async () => {
    const { db } = await deleteEnv();
    await deleteApplication(db, 1, "review");
    expect(await db.applications.count()).toBe(0);
    expect((await db.emails.toArray()).filter((e) => e.needsReview && e.hold)).toHaveLength(2);
    expect(await settleReview(db)).toBe(0);
    expect((await recheck(db)).settled).toBe(0);
    expect(await reviewCount(db)).toBe(2);
  });

  it("releases a held email when you place it yourself", async () => {
    const { db } = await deleteEnv();
    await deleteApplication(db, 1, "review");
    const first = (await db.emails.orderBy("receivedAt").toArray())[0];
    await resolveReview(db, first.id, { action: "new", company: "Acme", role: "Analyst", stage: "Applied" });
    const row = (await db.emails.get(first.id))!;
    expect([row.needsReview, row.hold, row.applicationId !== null]).toEqual([false, false, true]);
  });

  it("deletes a hand-made application with notes, and its people corrections", async () => {
    const { db } = await deleteEnv();
    const app = await addApplication(db, { company: "Mine", role: "R" });
    await seedNote(db, app, "x");
    await db.contactEdits.put({ key: `${app}|a@b.co`, name: "A", title: "T", hidden: false });
    await deleteApplication(db, app);
    expect(await db.applications.get(app)).toBeUndefined();
    expect(await db.activity.count()).toBe(0);
    expect(await db.contactEdits.count()).toBe(0);
  });

  it("rejects an unknown mode", async () => {
    const { db } = await deleteEnv();
    await expect(deleteApplication(db, 1, "everything" as never)).rejects.toBeInstanceOf(ActionError);
    expect(await db.applications.count()).toBe(1);
  });
});

describe("recheck", () => {
  it("removes an application only a newsletter made, and keeps one you touched", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessage(db, acct, mail("Quick note", "We would like to schedule an interview prep session with you for the analyst role.", "Coach <hi@coachco.io>", "x"));
    const email = (await db.emails.toArray())[0];
    const app = await createApplication(db, { company: "CoachCo", companyKey: "coachco", role: "Analyst", roleKey: "analyst", stage: "Interview", when: email.receivedAt });
    await db.emails.update(email.id, { needsReview: false, applicationId: app });
    const mine = await createApplication(db, { company: "Mine", companyKey: "mine", role: "R", roleKey: "r", stage: "Applied", when: "2026-10-01T00:00:00Z" });
    await db.emails.add({ accountId: acct, providerMsgId: "y", threadId: "t", receivedAt: "2026-10-02T00:00:00Z", sender: "Coach <hi@coachco.io>", subject: "Hi", body: "Newsletter. Unsubscribe here.", related: true, event: "interview", confidence: "low", applicationId: mine, needsReview: false, webLink: null, bulk: true, hold: false, reason: null });
    await db.applications.update(mine, { manual: true });
    await db.learnedRules.add({ kind: "block_sender", value: "hi@coachco.io", evidence: 1, active: true, createdAt: "2026-10-01T00:00:00Z" });
    const r = await recheck(db);
    expect(r.cleared).toBe(1);
    expect(r.removed).toBe(1);
    expect(await db.applications.get(app)).toBeUndefined();
    expect(await db.applications.get(mine)).toBeDefined();
  });
});

describe("application actions", () => {
  it("logs an application by hand with the day you applied, locked and manual", async () => {
    const db = freshDb();
    const id = await addApplication(db, { company: "  Acme   Corp ", role: "Data Analyst", stage: "Interview", appliedOn: "2026-10-10" });
    const row = (await db.applications.get(id))!;
    expect([row.company, row.role, row.stage, row.manual, row.locked]).toEqual(["Acme Corp", "Data Analyst", "Interview", true, true]);
    expect(row.stageAt!.startsWith("2026-10-10") && row.lastActivity!.startsWith("2026-10-10")).toBe(true);
  });

  it("accepts today's date at any hour, without stamping a time still ahead", async () => {
    const db = freshDb();
    for (const hour of [0, 1, 6, 11, 23]) {
      const now = new Date(2026, 10, 3, hour, 30);            // 3 Nov, local time: the day the form fills in is the same day
      const id = await addApplication(db, { company: `Co${hour}`, appliedOn: localToday(now) }, now);
      expect(new Date((await db.applications.get(id))!.stageAt!).getTime()).toBeLessThanOrEqual(now.getTime());
    }
    const now = new Date(2026, 10, 3, 9, 0);
    const tomorrow = new Date(2026, 10, 4, 9, 0);
    await expect(addApplication(db, { company: "Late", appliedOn: localToday(tomorrow) }, now)).rejects.toThrow(/future/);
  });

  it("makes the date optional and refuses bad dates", async () => {
    const db = freshDb();
    await addApplication(db, { company: "A" });
    await expect(addApplication(db, { company: "B", appliedOn: "next week" })).rejects.toBeInstanceOf(ActionError);
    await expect(addApplication(db, { company: "C", appliedOn: "2999-01-01" })).rejects.toBeInstanceOf(ActionError);
    await expect(addApplication(db, { company: "  " })).rejects.toBeInstanceOf(ActionError);
    expect(await db.applications.count()).toBe(1);
  });

  it("locks a hand-set stage, which mail then leaves alone, until you unlock it", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessage(db, acct, mail("Thank you for applying to Acme", "", "Acme <no-reply@greenhouse.io>", "1", 1, "T"));
    await setStage(db, 1, "Interview");
    await processMessage(db, acct, mail("Offer", "We are pleased to offer you the role.", "Acme <no-reply@greenhouse.io>", "2", 9, "T"));
    expect((await db.applications.get(1))!.stage).toBe("Interview");
    await unlockStage(db, 1);
    expect((await db.applications.get(1))!.locked).toBe(false);
  });

  it("edits company and role, and marks the application as yours", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessage(db, acct, mail("Thank you for applying to Acme", "", "Acme <no-reply@greenhouse.io>"));
    await editApplication(db, 1, " Acme  Inc ", "");
    const row = (await db.applications.get(1))!;
    expect([row.company, row.role, row.roleKey, row.manual]).toEqual(["Acme Inc", "Unknown role", "", true]);
    await expect(editApplication(db, 1, "  ", "x")).rejects.toBeInstanceOf(ActionError);
  });

  it("merges: emails, people corrections and the later or hand-set stage move across", async () => {
    const db = freshDb();
    const acct = await upsertAccount(db, "gmail", "me@gmail.com");
    const a = await createApplication(db, { company: "Acme", companyKey: "acme", role: "A", roleKey: "a", stage: "Interview", when: "2026-10-05T00:00:00Z" });
    const b = await createApplication(db, { company: "Acme Inc", companyKey: "acme", role: "A", roleKey: "a", stage: "Applied", when: "2026-10-02T00:00:00Z" });
    await db.emails.add({ accountId: acct, providerMsgId: "m", threadId: null, receivedAt: "2026-10-05T00:00:00Z", sender: null, subject: null, body: null, related: true, event: "interview", confidence: "high", applicationId: a, needsReview: false, webLink: null, bulk: false, hold: false, reason: null });
    await db.contactEdits.put({ key: `${a}|x@y.co`, name: "X", title: "T", hidden: false });
    await mergeApplications(db, a, b);
    const merged = (await db.applications.get(b))!;
    expect([merged.stage, merged.appliedAt]).toEqual(["Interview", "2026-10-02T00:00:00Z"]);
    expect(await db.applications.get(a)).toBeUndefined();
    expect((await db.emails.toArray())[0].applicationId).toBe(b);
    expect((await db.contactEdits.toArray()).map((e) => e.key)).toEqual([`${b}|x@y.co`]);
    await expect(mergeApplications(db, b, b)).rejects.toBeInstanceOf(ActionError);
  });
});
