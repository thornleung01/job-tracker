// Port of tests/test_stats.py, plus the sentence summary and the Python golden numbers.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { addStep } from "../../src/sync/activity";
import { applicationPath, flowSummary, sankey } from "../../src/sync/stats";
import { processMessages } from "../../src/sync/sync";
import { upsertAccount, createApplication } from "../../src/db/repo";
import { resolveReview } from "../../src/sync/actions";
import { closeAll, dbWithAccount, freshDb, mk } from "./helpers";
import { importFromPythonExport } from "../../src/portability";
import fixture from "../fixtures/python-export.json";
import golden from "../fixtures/python-export.golden.json";

afterEach(closeAll);

describe("application paths", () => {
  it("builds the path an application took", () => {
    expect(applicationPath("Applied", ["Applied"])).toEqual(["Applied", "No response yet"]);
    expect(applicationPath("Heard back", ["Applied", "Heard back"])).toEqual(["Applied", "Heard back", "Still open"]);
    expect(applicationPath("Rejected", ["Applied", "Rejected"])).toEqual(["Applied", "Heard back", "Rejected"]);
    // Skipping assessment is allowed; it is only shown when actually reached.
    expect(applicationPath("Offer", ["Applied", "Interview", "Offer"])).toEqual(["Applied", "Heard back", "Interview", "Offer"]);
    expect(applicationPath("Rejected", ["Applied", "Assessment", "Interview", "Rejected"])).toEqual(
      ["Applied", "Heard back", "Assessment", "Interview", "Rejected"]);
    // A hand-set stage with no emails still produces a sensible path.
    expect(applicationPath("Interview", [])).toEqual(["Applied", "Heard back", "Interview", "Still open"]);
  });
});

async function seed() {
  const { db, acct } = await dbWithAccount();
  await processMessages(db, acct, [
    mk("a1", "Thank you for applying to Acme", "", undefined, "A", 1),
    mk("a2", "Interview", "Please select a time for your interview.", undefined, "A", 4),
    mk("a3", "Offer", "We are pleased to offer you the role.", undefined, "A", 9),
    mk("b1", "Thank you for applying to Initech", "", "Initech <no-reply@lever.co>", "B", 2),
    mk("b2", "Update", "We will not be moving forward with your application.", "Initech <no-reply@lever.co>", "B", 6),
    mk("c1", "Thank you for applying to Hooli", "", "Hooli <no-reply@lever.co>", "C", 3),
  ]);
  return { db, acct };
}

describe("sankey", () => {
  it("counts and conserves flow", async () => {
    const { db } = await seed();
    const d = await sankey(db);
    expect(d.total).toBe(3);
    expect(Object.fromEntries(d.nodes.map((n) => [n.id, n.value]))).toEqual(
      { Applied: 3, "Heard back": 2, "No response yet": 1, Interview: 1, Offer: 1, Rejected: 1 });
    const link = (s: string, t: string) => d.links.find((l) => l.source === s && l.target === t)?.value;
    expect(link("Applied", "Heard back")).toBe(2);
    expect(link("Heard back", "Interview")).toBe(1);
    expect(link("Heard back", "Rejected")).toBe(1);
    expect(link("Interview", "Offer")).toBe(1);
    for (const n of d.nodes) {
      const out = d.links.filter((l) => l.source === n.id).reduce((t, l) => t + l.value, 0);
      const inn = d.links.filter((l) => l.target === n.id).reduce((t, l) => t + l.value, 0);
      if (n.id !== "Applied" && out) expect(inn).toBe(out);
    }
    expect([d.heardBack, d.interviews, d.offers, d.rejected]).toEqual([2, 1, 1, 1]);
    expect(d.outcomes).toEqual({ offer: 1, rejected: 1, noOutcomeYet: 1 });
  });

  it("is empty with no applications", async () => {
    const d = await sankey(freshDb());
    expect([d.total, d.nodes, d.links]).toEqual([0, [], []]);
    expect(flowSummary(d)).toBeNull();
  });

  it("filters by account", async () => {
    const { db } = await seed();
    const other = await upsertAccount(db, "outlook", "me@outlook.com");
    expect((await sankey(db, { account: other })).total).toBe(0);
    expect((await sankey(db, { account: 1 })).total).toBe(3);
  });

  it("filters by period using the applied date, falling back to last activity", async () => {
    const db = freshDb();
    const now = new Date("2026-11-01T00:00:00Z");
    const make = (company: string, when: string) => createApplication(db, { company, companyKey: company, role: "R", roleKey: "r", stage: "Applied", when });
    await make("Old", "2026-06-01T00:00:00Z");
    await make("Recent", "2026-10-25T00:00:00Z");
    const noApplied = await make("NoApplied", "2026-10-28T00:00:00Z");
    await db.applications.update(noApplied, { appliedAt: null });
    expect((await sankey(db, { days: 30, now })).total).toBe(2);
    expect((await sankey(db, { days: 0, now })).total).toBe(3);
    expect((await sankey(db, { days: 180, now })).total).toBe(3);
  });

  it("counts a review decision and a logged stage step but not a custom step", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessages(db, acct, [
      mk("1", "Thank you for applying to Acme", "", undefined, "A", 1),
      mk("r", "Re: your application", "Quick question about your CV.", "Sam <sam@zzz.com>", undefined, 3),
    ]);
    const review = (await db.emails.toArray()).find((e) => e.needsReview)!;
    await resolveReview(db, review.id, { action: "assign", appId: 1, stage: "Assessment" });
    expect((await sankey(db)).nodes.map((n) => n.id)).toContain("Assessment");

    const db2 = freshDb();
    const app = await createApplication(db2, { company: "Acme", companyKey: "acme", role: "A", roleKey: "a", stage: "Applied", when: new Date().toISOString() });
    await addStep(db2, app, "Phone screen", null);
    expect(new Set((await sankey(db2)).nodes.map((n) => n.id))).toEqual(new Set(["Applied", "No response yet"]));
    await addStep(db2, app, "Interview", null);
    expect((await sankey(db2)).nodes.map((n) => n.id)).toEqual(expect.arrayContaining(["Heard back", "Interview"]));
  });
});

describe("sentence summary", () => {
  it("builds the lede from the numbers", async () => {
    const { db } = await seed();
    const s = flowSummary(await sankey(db))!;
    expect(s.text).toBe("Of 3 applications, 2 heard back (67%), 1 reached an interview, 1 led to an offer and 1 was rejected.");
    expect(s.parts.filter((p) => p.strong).map((p) => p.text)).toEqual(["3", "2", "1", "1", "1"]);
  });

  it("pluralises and rounds halves to even, like Python", () => {
    const base = { nodes: [], links: [], interviews: 0, offers: 2, rejected: 3, outcomes: { offer: 2, rejected: 3, noOutcomeYet: 0 } };
    expect(flowSummary({ ...base, total: 1, heardBack: 1 })!.text).toBe("Of 1 application, 1 heard back (100%), 0 reached an interview, 2 led to offers and 3 were rejected.");
    expect(flowSummary({ ...base, total: 8, heardBack: 1 })!.heardBackPct).toBe(12); // 12.5 -> 12
    expect(flowSummary({ ...base, total: 8, heardBack: 3 })!.heardBackPct).toBe(38); // 37.5 -> 38
  });
});

describe("numbers match stats.py on the demo export", () => {
  it("gives identical flow data for every account and period", async () => {
    const db = freshDb();
    await importFromPythonExport(db, fixture);
    const now = new Date(golden.now);
    const camel = (g: (typeof golden.sankey)[keyof typeof golden.sankey]) => ({
      total: g.total, nodes: g.nodes, links: g.links, heardBack: g.heard_back, interviews: g.interviews, offers: g.offers, rejected: g.rejected,
    });
    for (const [key, expected] of Object.entries(golden.sankey)) {
      const [account, days] = key.split(":").map(Number);
      const got = await sankey(db, { account, days, now });
      const { outcomes: _outcomes, ...rest } = got;
      expect(rest, key).toEqual(camel(expected));
    }
  });
});
