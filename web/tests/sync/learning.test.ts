// Port of tests/test_learning.py: flag what isn't an application and the app learns rules from it.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import * as learn from "../../src/sync/learn";
import { Learned } from "../../src/sync/learn";
import { classify } from "../../src/pipeline";
import { ignoredIsReal, notAnApplication, resolveReview, undoRule } from "../../src/sync/actions";
import { processMessage } from "../../src/sync/sync";
import { recheck } from "../../src/sync/recheck";
import { closeAll, dbWithAccount, mail } from "./helpers";

afterEach(closeAll);

// An email that the built-in rules take for an interview invitation, but is really a course advert.
const ADVERT = "We would like to schedule an interview prep session with you for the analyst role.";

async function feedback(db: Awaited<ReturnType<typeof dbWithAccount>>["db"], verdict: "job" | "not_job", sender: string, reason = "", when = "2026-10-01T00:00:00Z") {
  await db.feedback.add({ createdAt: when, verdict, senderEmail: sender, senderDomain: sender.split("@")[1] ?? "", subject: "s", reason, applicationId: null });
}
const kinds = async (db: Awaited<ReturnType<typeof dbWithAccount>>["db"], active = true) =>
  new Set((await db.learnedRules.toArray()).filter((r) => !active || r.active).map((r) => `${r.kind}:${r.value}`));
async function block(db: Awaited<ReturnType<typeof dbWithAccount>>["db"], sender: string) {
  await db.learnedRules.add({ kind: "block_sender", value: sender, evidence: 1, active: true, createdAt: "2026-10-01T00:00:00Z" });
}

describe("the whole loop", () => {
  it("removes a flagged application, learns the sender, and blocks the next one", async () => {
    const { db, acct } = await dbWithAccount();
    const sender = "Career Coach <hi@coachco.io>";
    const first = mail("Re: your application", ADVERT, sender, "a");
    expect(classify(first).related).toBe(true); // the built-in rules are fooled
    await processMessage(db, acct, first);
    const app = await db.applications.add({ company: "CoachCo", companyKey: "coachco", role: "Analyst", roleKey: "analyst", stage: "Interview", stageAt: null, appliedAt: null, lastActivity: null, locked: false, manual: false });
    await db.emails.toCollection().modify({ needsReview: false, applicationId: app });

    const out = await notAnApplication(db, app);
    expect(out.company).toBe("CoachCo");
    expect(out.rules.join(" ")).toContain("Ignoring mail from hi@coachco.io");
    expect(await db.applications.count()).toBe(0);
    const row = (await db.emails.toArray())[0];
    expect([row.related, row.subject, row.body]).toEqual([false, null, null]); // content erased

    const again = mail("Re: your application", ADVERT, sender, "b", 5);
    expect(await processMessage(db, acct, again)).toBe("ignored");
    expect(await db.applications.count()).toBe(0);
    expect(classify(again, await learn.loadLearned(db)).reason).toContain("learned: ignoring");
  });

  it("keeps the feedback fingerprint after erasing", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessage(db, acct, mail("Re: your application", ADVERT, "Coach <hi@coachco.io>"));
    const email = (await db.emails.toArray())[0];
    await resolveReview(db, email.id, { action: "dismiss" });
    const fb = (await db.feedback.toArray())[0];
    expect([fb.verdict, fb.senderEmail, fb.senderDomain, fb.subject]).toEqual(["not_job", "hi@coachco.io", "coachco.io", "Re: your application"]);
    expect(fb.reason.startsWith("body:")).toBe(true);
  });
});

describe("Needs review teaches it too", () => {
  it("learns from dismissals and clears similar queued mail", async () => {
    const { db, acct } = await dbWithAccount();
    for (const [i, who] of ["a@coachco.io", "b@coachco.io", "c@coachco.io"].entries()) {
      await processMessage(db, acct, mail("Re: your application", ADVERT, `Coach <${who}>`, `m${i}`, 1 + i));
    }
    const queued = (await db.emails.orderBy("id").toArray()).filter((e) => e.needsReview).map((e) => e.id);
    expect(queued).toHaveLength(3);
    await resolveReview(db, queued[0], { action: "dismiss" });
    await resolveReview(db, queued[1], { action: "dismiss" }); // a second address on the domain
    expect(await kinds(db, false)).toEqual(new Set(["block_sender:a@coachco.io", "block_sender:b@coachco.io", "block_domain:coachco.io"]));
    expect((await db.emails.toArray()).filter((e) => e.needsReview)).toHaveLength(0); // the third cleared itself
    expect(await processMessage(db, acct, mail("Re: your application", ADVERT, "Coach <d@coachco.io>", "new", 9))).toBe("ignored");
  });

  it("makes a confirmed sender trusted and beats a domain block", async () => {
    const { db } = await dbWithAccount();
    await feedback(db, "not_job", "a@acme.io");
    await feedback(db, "not_job", "b@acme.io");
    await feedback(db, "job", "pat@acme.io", "", "2026-10-02T00:00:00Z");
    await learn.rebuild(db);
    const k = await kinds(db);
    expect(k.has("allow_sender:pat@acme.io") && k.has("block_sender:a@acme.io")).toBe(true);
    expect(k.has("block_domain:acme.io")).toBe(false);
    const learned = await learn.loadLearned(db);
    const msg = mail("Hello", "Great news about your candidacy, we would like to schedule an interview.", "Pat <pat@acme.io>");
    const cls = classify(msg, learned);
    expect([cls.related, cls.confidence]).toEqual([true, "high"]); // trusted like a hiring system
  });

  it("records a job verdict when you assign", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessage(db, acct, mail("Re: your application", ADVERT, "Pat <pat@acme.io>"));
    const email = (await db.emails.toArray())[0];
    await resolveReview(db, email.id, { action: "new", company: "Acme", role: "Analyst", stage: "Interview" });
    const fb = (await db.feedback.toArray())[0];
    expect([fb.verdict, fb.senderEmail]).toEqual(["job", "pat@acme.io"]);
    const rule = (await db.learnedRules.toArray())[0];
    expect([rule.kind, rule.value]).toEqual(["allow_sender", "pat@acme.io"]);
  });
});

describe("limits on what it will learn", () => {
  it.each(["x@gmail.com", "y@gmail.com", "z@gmail.com"])("never blocks a personal domain whole (%s)", async (sender) => {
    const { db } = await dbWithAccount();
    await feedback(db, "not_job", sender);
    await learn.rebuild(db);
    expect((await kinds(db, false)).has("block_domain:gmail.com")).toBe(false);
  });

  it("never blocks hiring systems", async () => {
    const { db } = await dbWithAccount();
    await feedback(db, "not_job", "a@greenhouse.io");
    await feedback(db, "not_job", "b@greenhouse.io");
    expect(await learn.rebuild(db)).toEqual([]);
  });

  it("blocks one hiring-system address after two flags, never its whole domain", async () => {
    const { db } = await dbWithAccount();
    await feedback(db, "not_job", "wealthsimple@myworkday.com");
    expect(await learn.rebuild(db)).toEqual([]); // one flag is not enough
    await feedback(db, "not_job", "wealthsimple@myworkday.com");
    await feedback(db, "not_job", "otherco@myworkday.com");
    await learn.rebuild(db);
    const k = await kinds(db);
    expect(k.has("block_sender:wealthsimple@myworkday.com")).toBe(true);
    expect(k.has("block_sender:otherco@myworkday.com")).toBe(false);
    expect([...k].some((x) => x.startsWith("block_domain"))).toBe(false);
  });

  it("distrusts a wording that keeps being wrong, and sends its matches to review", async () => {
    const { db } = await dbWithAccount();
    for (let i = 0; i < 3; i++) await feedback(db, "not_job", `s${i}@x${i}.io`, "body: wording");
    const rules = await learn.rebuild(db);
    expect(rules.some((r) => r.includes("wording"))).toBe(true);
    const learned = await learn.loadLearned(db);
    expect(learned.distrust.has("body: wording")).toBe(true);
    const fooled = classify(mail("Hi", ADVERT, "Someone <someone@else.io>"));
    expect(fooled.confidence).toBe("medium");
    const cls = classify(mail("Hi", ADVERT, "Someone <someone@else.io>"), new Learned(undefined, undefined, undefined, new Set([fooled.reason])));
    expect([cls.related, cls.confidence]).toEqual([true, "low"]);
  });

  it("does not distrust a wording after two wrong flags", async () => {
    const { db } = await dbWithAccount();
    for (let i = 0; i < 2; i++) await feedback(db, "not_job", `s${i}@x${i}.io`, "body: wording");
    await learn.rebuild(db);
    expect((await learn.loadLearned(db)).distrust.size).toBe(0);
  });
});

describe("undo", () => {
  it("removes a rule that stays undone until there is new evidence", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessage(db, acct, mail("Re: your application", ADVERT, "Coach <hi@coachco.io>"));
    await resolveReview(db, (await db.emails.toArray())[0].id, { action: "dismiss" });
    const rule = (await db.learnedRules.toArray())[0];
    expect(await undoRule(db, rule.id)).toContain("Rule removed");
    expect((await learn.loadLearned(db)).blockSenders.size).toBe(0);
    expect(await learn.rebuild(db)).toEqual([]); // same evidence: stays undone
    expect((await learn.loadLearned(db)).blockSenders.size).toBe(0);
    await processMessage(db, acct, mail("Re: your application", ADVERT, "Coach <hi@coachco.io>", "again", 4));
    const again = (await db.emails.toArray()).find((e) => e.needsReview)!;
    await resolveReview(db, again.id, { action: "dismiss" }); // a second flag is new evidence
    expect([...(await learn.loadLearned(db)).blockSenders]).toEqual(["hi@coachco.io"]);
    await expect(undoRule(db, 9999)).rejects.toThrow();
  });
});

describe("safety", () => {
  it("does not touch other applications and fails for an unknown id", async () => {
    const { db } = await dbWithAccount();
    const keep = await db.applications.add({ company: "Keep", companyKey: "keep", role: "R", roleKey: "r", stage: "Applied", stageAt: null, appliedAt: null, lastActivity: null, locked: false, manual: false });
    await expect(notAnApplication(db, 999)).rejects.toThrow();
    expect(await db.applications.get(keep)).toBeDefined();
  });

  it("just removes a hand-made application with no emails", async () => {
    const { db } = await dbWithAccount();
    const app = await db.applications.add({ company: "Mine", companyKey: "mine", role: "R", roleKey: "r", stage: "Applied", stageAt: null, appliedAt: null, lastActivity: null, locked: false, manual: true });
    expect((await notAnApplication(db, app)).company).toBe("Mine");
    expect(await db.learnedRules.count()).toBe(0);
  });
});

describe("a mistaken flag must not hide a real job", () => {
  it("sends a blocked sender's application-subject mail to review, not the bin", async () => {
    const { db, acct } = await dbWithAccount();
    await block(db, "pat@acme.io");
    const msg = mail("Thank you for applying to Acme", "We received your application for the Data Analyst role.", "Pat <pat@acme.io>");
    const cls = classify(msg, await learn.loadLearned(db));
    expect([cls.related, cls.confidence, cls.reason.includes("overridden")]).toEqual([true, "low", true]);
    expect(await processMessage(db, acct, msg)).toBe("review");
    expect(await db.ignoredMail.count()).toBe(0);
  });

  it("still ignores a blocked sender's mail that is not about an application", async () => {
    const { db, acct } = await dbWithAccount();
    await block(db, "hi@coachco.io");
    expect(await processMessage(db, acct, mail("This week's tips", ADVERT, "Coach <hi@coachco.io>"))).toBe("ignored");
  });
});

describe("the ignored list and the appeal", () => {
  it("lists ignored mail and restores it with one click", async () => {
    const { db, acct } = await dbWithAccount();
    await block(db, "pat@acme.io");
    const msg = mail("Quick note", "We would like to schedule an interview with you for the analyst role at Acme.", "Pat Lee <pat@acme.io>", "real");
    expect(await processMessage(db, acct, msg)).toBe("ignored");
    const row = (await db.ignoredMail.toArray())[0];
    expect([row.sender, row.subject]).toEqual(["Pat Lee <pat@acme.io>", "Quick note"]);
    expect(row.body).toContain("interview");

    const result = await ignoredIsReal(db, row.id);
    expect(result.message).toContain("Restored");
    expect(await db.ignoredMail.count()).toBe(0);
    const rules = (await db.learnedRules.toArray()).map((r) => `${r.kind}:${r.active}`);
    expect(rules).toContain("block_sender:false");
    expect(rules).toContain("allow_sender:true"); // the block is off, the sender trusted
    const restored = (await db.emails.toArray())[0];
    expect([restored.related, restored.subject]).toEqual([true, "Quick note"]);
    expect(await processMessage(db, acct, mail("Another", ADVERT, "Pat <pat@acme.io>", "next", 7))).not.toBe("ignored");
  });

  it("lands any restored mail from that sender in review for you to judge", async () => {
    const { db, acct } = await dbWithAccount();
    await block(db, "hi@coachco.io");
    await processMessage(db, acct, mail("Weekly tips", "Ten habits of highly effective people.", "Coach <hi@coachco.io>", "tips"));
    const r = await ignoredIsReal(db, (await db.ignoredMail.toArray())[0].id);
    expect(r.message).toContain("Restored. It's in Needs review");
    expect((await db.emails.toArray())[0].needsReview).toBe(true);
  });

  it("keeps what a recheck clears restorable", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessage(db, acct, mail("Quick note", ADVERT, "Coach <hi@coachco.io>", "x"));
    expect((await db.emails.toArray()).filter((e) => e.related)).toHaveLength(1);
    await block(db, "hi@coachco.io");
    expect((await recheck(db)).cleared).toBe(1);
    expect((await db.ignoredMail.toArray())[0].subject).toBe("Quick note");
  });

  it("drops ignored mail after 30 days", async () => {
    const { db, acct } = await dbWithAccount();
    await block(db, "hi@coachco.io");
    await processMessage(db, acct, mail("Old", ADVERT, "Coach <hi@coachco.io>", "old"));
    await db.ignoredMail.toCollection().modify({ createdAt: "2026-01-01T00:00:00Z" });
    await processMessage(db, acct, mail("New", ADVERT, "Coach <hi@coachco.io>", "new", 3));
    expect((await db.ignoredMail.toArray()).map((r) => r.subject)).toEqual(["New"]);
  });

  it("fails for a missing ignored mail", async () => {
    const { db } = await dbWithAccount();
    await expect(ignoredIsReal(db, 999)).rejects.toThrow();
  });
});
