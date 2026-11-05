import { afterEach, describe, expect, it } from "vitest";
import { cleanup, freshDb } from "../pages/applications/harness";
import { addApplication } from "../../src/sync/actions";
import { DUPLICATES_MAX, findDuplicates } from "../../src/sync/duplicates";

afterEach(cleanup);

describe("findDuplicates", () => {
  it("matches the same company and role however they are written", async () => {
    const db = freshDb();
    const id = await addApplication(db, { company: "Acme Inc.", role: "Data  Analyst", stage: "Interview" });
    expect(await findDuplicates(db, "acme", "data analyst")).toEqual([{ id, company: "Acme Inc.", role: "Data Analyst", stage: "Interview" }]);
    expect(await findDuplicates(db, "  ACME, Inc ", "DATA ANALYST")).toHaveLength(1);
  });

  it("does not match another role or another company", async () => {
    const db = freshDb();
    await addApplication(db, { company: "Acme", role: "Analyst" });
    expect(await findDuplicates(db, "Acme", "Designer")).toEqual([]);
    expect(await findDuplicates(db, "Acme Labs", "Analyst")).toEqual([]);
  });

  it("matches on the company alone only when no role is typed", async () => {
    const db = freshDb();
    const a = await addApplication(db, { company: "Acme", role: "Analyst" });
    const b = await addApplication(db, { company: "Acme" });
    expect((await findDuplicates(db, "Acme", "")).map((m) => m.id)).toEqual([b, a]);
    expect((await findDuplicates(db, "Acme", "   ")).map((m) => m.id)).toEqual([b, a]);
    expect((await findDuplicates(db, "Acme", "Unknown role")).map((m) => m.id)).toEqual([b, a]);
    // with a role typed, an application with no known role is not the same job
    expect((await findDuplicates(db, "Acme", "Analyst")).map((m) => m.id)).toEqual([a]);
  });

  it("returns nothing for a blank company and no link", async () => {
    const db = freshDb();
    await addApplication(db, { company: "Acme" });
    expect(await findDuplicates(db, "", "")).toEqual([]);
    expect(await findDuplicates(db, "   ", "Analyst", "")).toEqual([]);
  });

  it("returns at most three, newest first", async () => {
    const db = freshDb();
    const ids: number[] = [];
    for (let i = 0; i < DUPLICATES_MAX + 2; i++) ids.push(await addApplication(db, { company: "Acme", role: "Analyst" }));
    expect((await findDuplicates(db, "Acme", "Analyst")).map((m) => m.id)).toEqual(ids.slice(-DUPLICATES_MAX).reverse());
  });

  it("matches the same posting link, cleaned the way a link is saved, whatever the company", async () => {
    const db = freshDb();
    const id = await addApplication(db, { company: "Acme", role: "Analyst", url: "https://jobs.example.com/acme/123" });
    expect((await findDuplicates(db, "Other", "Else", "  https://jobs.example.com/acme/123#apply "))).toEqual([{ id, company: "Acme", role: "Analyst", stage: "Applied" }]);
    expect(await findDuplicates(db, "", "", "https://jobs.example.com/acme/124")).toEqual([]);
  });

  it("lists a link match once, first, even when the company matches too", async () => {
    const db = freshDb();
    const older = await addApplication(db, { company: "Acme", role: "Analyst" });
    const linked = await addApplication(db, { company: "Acme", role: "Analyst", url: "https://jobs.example.com/acme/1" });
    expect((await findDuplicates(db, "Acme", "Analyst", "https://jobs.example.com/acme/1")).map((m) => m.id)).toEqual([linked, older]);
  });

  it("ignores a link that is not a web address", async () => {
    const db = freshDb();
    await addApplication(db, { company: "Acme" });
    expect(await findDuplicates(db, "", "", "not a link")).toEqual([]);
    expect(await findDuplicates(db, "", "", "javascript:alert(1)")).toEqual([]);
  });
});
