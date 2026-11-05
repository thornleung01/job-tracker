// The one salary rule and the deadline and rounds checks, seen from both doors: saving refuses, importing drops.
import { afterEach, describe, expect, it } from "vitest";
import { addApp, cleanup, freshDb } from "../pages/applications/harness";
import { ActionError, setOfferDetails } from "../../src/sync/actions";
import { exportAll, importAll } from "../../src/portability";
import { OFFER_SALARY_MAX, safeOfferDeadline, safeOfferSalary } from "../../src/db/offer";

afterEach(cleanup);

type Field = Record<string, unknown>;

/** Saves an application, exports it, lets `change` rewrite its exported row, imports that into a fresh database and returns the app. */
async function imported(change: (row: Field) => void) {
  const db = freshDb();
  const id = await addApp(db, "Acme", { stage: "Offer" });
  const copy = JSON.parse(JSON.stringify(await exportAll(db)));
  change(copy.data.applications[0]);
  const fresh = freshDb();
  await importAll(fresh, JSON.stringify(copy));
  return (await fresh.applications.get(id))!;
}

const savedSalary = async (salary: string) => {
  const db = freshDb();
  const id = await addApp(db, "Acme", { stage: "Offer" });
  await setOfferDetails(db, id, { salary, deadline: "" });
  return (await db.applications.get(id))?.offerSalary;
};

describe("the salary length", () => {
  const sixty = "x".repeat(OFFER_SALARY_MAX);

  it("keeps exactly 60 characters, on save and on import", async () => {
    expect(OFFER_SALARY_MAX).toBe(60);
    expect(await savedSalary(sixty)).toBe(sixty);
    expect((await imported((r) => { r.offerSalary = sixty; })).offerSalary).toBe(sixty);
    expect(safeOfferSalary(sixty)).toBe(sixty);
  });

  it("refuses 61 on save and drops it on import", async () => {
    const sixtyOne = `${sixty}x`;
    const db = freshDb();
    const id = await addApp(db, "Acme", { stage: "Offer" });
    await expect(setOfferDetails(db, id, { salary: sixtyOne, deadline: "" })).rejects.toThrow("Keep the salary to 60 characters or fewer.");
    expect((await db.applications.get(id))?.offerSalary).toBeUndefined();
    expect((await imported((r) => { r.offerSalary = sixtyOne; })).offerSalary).toBeUndefined();
    expect(safeOfferSalary(sixtyOne)).toBeUndefined();
  });

  it("counts the length after spaces are tidied: padding that collapses to 60 or fewer is kept", async () => {
    const padded = `  ${"a".repeat(30)}${" ".repeat(40)}${"b".repeat(29)}   `;      // 104 characters, 60 once tidied
    const tidy = `${"a".repeat(30)} ${"b".repeat(29)}`;
    expect(padded.length).toBeGreaterThan(OFFER_SALARY_MAX);
    expect(tidy).toHaveLength(60);
    expect(await savedSalary(padded)).toBe(tidy);
    expect((await imported((r) => { r.offerSalary = padded; })).offerSalary).toBe(tidy);
    // padding around a full 60 is trimmed away
    expect(await savedSalary(`   ${sixty}   `)).toBe(sixty);
  });

  it("still refuses a value that is over 60 after tidying", async () => {
    const wordy = `${"a".repeat(30)}${" ".repeat(40)}${"b".repeat(30)}`;      // 61 once tidied
    await expect(savedSalary(wordy)).rejects.toBeInstanceOf(ActionError);
    expect(safeOfferSalary(wordy)).toBeUndefined();
  });
});

describe("whitespace and unsafe characters in the salary", () => {
  it("turns tabs and line breaks into one space, on save and on import", async () => {
    expect(await savedSalary("$100k\t+\r\nequity\n")).toBe("$100k + equity");
    expect((await imported((r) => { r.offerSalary = "$100k\t+\nequity"; })).offerSalary).toBe("$100k + equity");
  });

  it.each([
    ["NUL", "\u0000"],
    ["BEL", "\u0007"],
    ["DEL", "\u007f"],
    ["right-to-left override", "‮"],
    ["left-to-right embedding", "‪"],
    ["right-to-left isolate", "⁧"],
    ["pop directional isolate", "⁩"],
  ])("refuses %s on save and drops it on import", async (_name, bad) => {
    const salary = `$100k${bad}000`;
    const db = freshDb();
    const id = await addApp(db, "Acme", { stage: "Offer" });
    const refused = setOfferDetails(db, id, { salary, deadline: "2026-10-15" });
    await expect(refused).rejects.toBeInstanceOf(ActionError);
    await expect(refused).rejects.toThrow("The salary has characters that can't be saved. Use plain text.");
    expect(await db.applications.get(id)).not.toHaveProperty("offerDeadline");      // nothing was half-saved
    expect(safeOfferSalary(salary)).toBeUndefined();
    expect((await imported((r) => { r.offerSalary = salary; })).offerSalary).toBeUndefined();
  });

  it("keeps ordinary non-ASCII text", async () => {
    expect(await savedSalary("€90 000 – 100 000")).toBe("€90 000 – 100 000");
  });
});

describe("a bad value never takes the other one with it on import", () => {
  it("keeps a good deadline when the salary is bad", async () => {
    const app = await imported((r) => { r.offerSalary = "x".repeat(500); r.offerDeadline = "2026-10-15"; });
    expect(app.offerSalary).toBeUndefined();
    expect(app.offerDeadline).toBe("2026-10-15");
  });

  it("keeps a good salary when the deadline is bad", async () => {
    const app = await imported((r) => { r.offerSalary = "$120,000"; r.offerDeadline = "2026-02-30"; });
    expect(app.offerSalary).toBe("$120,000");
    expect(app.offerDeadline).toBeUndefined();
  });
});

describe("the deadline on import", () => {
  it.each([["a time", "2026-10-15T09:00:00Z"], ["leading space", " 2026-10-15"], ["trailing space", "2026-10-15 "], ["a number", 20261015], ["null", null], ["an object", { day: "2026-10-15" }]])(
    "drops %s",
    async (_name, bad) => {
      expect(safeOfferDeadline(bad)).toBeUndefined();
      expect((await imported((r) => { r.offerDeadline = bad; })).offerDeadline).toBeUndefined();
    },
  );

  it("saving trims the spaces around a real day", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme", { stage: "Offer" });
    await setOfferDetails(db, id, { salary: "", deadline: " 2026-10-15 " });
    expect((await db.applications.get(id))?.offerDeadline).toBe("2026-10-15");
  });
});

describe("interview rounds on import", () => {
  it.each([[-1], [1.5], [21], ["3"], [null], [true]])("drops %j", async (bad) => {
    const app = await imported((r) => { r.interviewRounds = bad; });
    expect(app.interviewRounds).toBeUndefined();
  });

  it.each([[0], [20], [7]])("keeps %j", async (good) => {
    const app = await imported((r) => { r.interviewRounds = good; });
    expect(app.interviewRounds).toBe(good);
  });

  it("does not lose the application when the count is bad", async () => {
    const app = await imported((r) => { r.interviewRounds = 99; });
    expect(app.company).toBe("Acme");
  });
});
