import { afterEach, describe, expect, it } from "vitest";
import { addApp, cleanup, freshDb } from "../pages/applications/harness";
import { ActionError, mergeApplications, setOfferDetails } from "../../src/sync/actions";
import { exportAll, importAll } from "../../src/portability";
import { OFFER_SALARY_MAX, safeOfferDeadline, safeOfferSalary } from "../../src/db/offer";

afterEach(cleanup);

describe("setOfferDetails", () => {
  it("saves the salary and the deadline, tidying the spaces", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme", { stage: "Offer" });
    await setOfferDetails(db, id, { salary: "  $120,000   + equity ", deadline: "2026-10-15" });
    const app = await db.applications.get(id);
    expect(app?.offerSalary).toBe("$120,000 + equity");
    expect(app?.offerDeadline).toBe("2026-10-15");
  });

  it("accepts either one alone, and clears both with empty values", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme", { stage: "Offer" });
    await setOfferDetails(db, id, { salary: "", deadline: "2026-10-15" });
    expect(await db.applications.get(id)).toMatchObject({ offerDeadline: "2026-10-15" });
    expect((await db.applications.get(id))?.offerSalary).toBeUndefined();
    await setOfferDetails(db, id, { salary: "", deadline: "" });
    const cleared = await db.applications.get(id);
    expect("offerSalary" in cleared!).toBe(false);
    expect("offerDeadline" in cleared!).toBe(false);
  });

  it("treats a salary of only spaces as none, so it clears with an empty deadline", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme", { stage: "Offer" });
    await setOfferDetails(db, id, { salary: "$1", deadline: "" });
    await setOfferDetails(db, id, { salary: " \t  ", deadline: "" });
    expect("offerSalary" in (await db.applications.get(id))!).toBe(false);
  });

  it("allows a deadline in the past", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme", { stage: "Offer" });
    await setOfferDetails(db, id, { salary: "", deadline: "2020-01-02" });
    expect((await db.applications.get(id))?.offerDeadline).toBe("2020-01-02");
  });

  it.each(["next friday", "2026-13-01", "2026-02-30", "10/15/2026", "2026-1-5"])("refuses the deadline %j", async (deadline) => {
    const db = freshDb();
    const id = await addApp(db, "Acme", { stage: "Offer" });
    await expect(setOfferDetails(db, id, { salary: "$1", deadline })).rejects.toBeInstanceOf(ActionError);
    const app = await db.applications.get(id);
    expect(app?.offerSalary).toBeUndefined();     // nothing was half-saved
  });

  it("refuses salary text over the limit but takes exactly the limit", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme", { stage: "Offer" });
    await expect(setOfferDetails(db, id, { salary: "x".repeat(OFFER_SALARY_MAX + 1), deadline: "" })).rejects.toThrow(/60 characters/);
    await setOfferDetails(db, id, { salary: "x".repeat(OFFER_SALARY_MAX), deadline: "" });
    expect((await db.applications.get(id))?.offerSalary).toHaveLength(OFFER_SALARY_MAX);
  });

  it("does not touch the stage or lock the application", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme", { stage: "Offer" });
    await setOfferDetails(db, id, { salary: "$1", deadline: "" });
    expect(await db.applications.get(id)).toMatchObject({ stage: "Offer", locked: false });
  });

  it("says so when the application is gone", async () => {
    await expect(setOfferDetails(freshDb(), 999, { salary: "$1", deadline: "" })).rejects.toThrow(/No application/);
  });
});

describe("the offer checks", () => {
  it("drop what isn't a plain salary or a real day", () => {
    expect(safeOfferSalary("$120,000")).toBe("$120,000");
    expect(safeOfferSalary("")).toBeUndefined();
    expect(safeOfferSalary(5)).toBeUndefined();
    expect(safeOfferSalary("x".repeat(61))).toBeUndefined();
    expect(safeOfferSalary("a\u0000b")).toBeUndefined();
    expect(safeOfferDeadline("2026-10-15")).toBe("2026-10-15");
    expect(safeOfferDeadline("2026-02-30")).toBeUndefined();
    expect(safeOfferDeadline(20261015)).toBeUndefined();
  });
});

describe("importing offer details", () => {
  async function exported() {
    const db = freshDb();
    const id = await addApp(db, "Acme", { stage: "Offer" });
    await setOfferDetails(db, id, { salary: "$120,000 + equity", deadline: "2026-10-15" });
    return { id, copy: JSON.parse(JSON.stringify(await exportAll(db))) };
  }

  it("round-trips good values", async () => {
    const { id, copy } = await exported();
    const fresh = freshDb();
    await importAll(fresh, JSON.stringify(copy));
    expect(await fresh.applications.get(id)).toMatchObject({ offerSalary: "$120,000 + equity", offerDeadline: "2026-10-15" });
  });

  it("drops bad values instead of failing", async () => {
    const { id, copy } = await exported();
    copy.data.applications[0].offerSalary = "x".repeat(500);
    copy.data.applications[0].offerDeadline = "2026-02-30";
    const fresh = freshDb();
    await importAll(fresh, JSON.stringify(copy));
    const app = await fresh.applications.get(id);
    expect(app?.company).toBe("Acme");
    expect(app?.offerSalary).toBeUndefined();
    expect(app?.offerDeadline).toBeUndefined();
  });

  it.each([[{ a: 1 }], [42], [true], [["x"]]])("drops a value of the wrong type (%j)", async (bad) => {
    const { id, copy } = await exported();
    copy.data.applications[0].offerSalary = bad;
    copy.data.applications[0].offerDeadline = bad;
    const fresh = freshDb();
    await importAll(fresh, JSON.stringify(copy));
    const app = await fresh.applications.get(id);
    expect(app?.offerSalary).toBeUndefined();
    expect(app?.offerDeadline).toBeUndefined();
  });

  it("reads an older file with no offer fields", async () => {
    const { id, copy } = await exported();
    delete copy.data.applications[0].offerSalary;
    delete copy.data.applications[0].offerDeadline;
    const fresh = freshDb();
    await importAll(fresh, JSON.stringify(copy));
    expect((await fresh.applications.get(id))?.offerSalary).toBeUndefined();
  });
});

describe("merging applications", () => {
  it("carries offer details across when the target has none", async () => {
    const db = freshDb();
    const from = await addApp(db, "Acme", { stage: "Offer" });
    const into = await addApp(db, "Acme Inc");
    await setOfferDetails(db, from, { salary: "$130k", deadline: "2026-11-30" });
    await mergeApplications(db, from, into);
    expect(await db.applications.get(into)).toMatchObject({ offerSalary: "$130k", offerDeadline: "2026-11-30" });
  });

  it("keeps the target's own details", async () => {
    const db = freshDb();
    const from = await addApp(db, "Acme");
    const into = await addApp(db, "Acme Inc", { stage: "Offer" });
    await setOfferDetails(db, from, { salary: "$130k", deadline: "2026-11-30" });
    await setOfferDetails(db, into, { salary: "$140k", deadline: "" });
    await mergeApplications(db, from, into);
    // the target's salary stays, and the deadline it lacked comes across
    expect(await db.applications.get(into)).toMatchObject({ offerSalary: "$140k", offerDeadline: "2026-11-30" });
  });
});
