// Port of the settings tests in tests/test_settings.py, and the sort/filter rules from tests/test_list_ux.py.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { ACCENTS, DEFAULTS, FLOW_PERIODS, loadSettings, sanitize, saveSettings } from "../../src/sync/settings";
import { listApplications, stageCounts, suggestions } from "../../src/sync/queries";
import { createApplication, upsertAccount } from "../../src/db/repo";
import { iso } from "../../src/db/time";
import { closeAll, freshDb } from "./helpers";

afterEach(closeAll);

describe("settings", () => {
  it("has defaults and round-trips", async () => {
    const db = freshDb();
    const s = await loadSettings(db);
    expect([s.appearance.theme, s.sync.lookbackDays, s.appearance.flowDays]).toEqual(["system", 30, 0]);
    expect(s).toEqual(DEFAULTS);
    await saveSettings(db, "appearance", { theme: "dark", accent: "bronze", density: "compact" });
    const again = (await loadSettings(db)).appearance;
    expect([again.theme, again.accent, again.density]).toEqual(["dark", "bronze", "compact"]);
  });

  it("keeps the accent names", () => {
    expect([...ACCENTS]).toEqual(["graphite", "bronze", "forest", "clay"]);
    expect([...FLOW_PERIODS]).toEqual([0, 30, 90, 180]);
  });

  it("falls back to defaults for invalid values", async () => {
    const db = freshDb();
    const out = await saveSettings(db, "appearance", { theme: "neon", accent: "<script>", density: 5, flowDays: "abc" });
    expect([out.theme, out.accent, out.flowDays]).toEqual(["system", "graphite", 0]);
    expect((await saveSettings(db, "sync", { lookbackDays: 7 })).lookbackDays).toBe(30);
    expect((await saveSettings(db, "sync", { lookbackDays: "90" })).lookbackDays).toBe(90);
    expect((await saveSettings(db, "appearance", { flowDays: "90" })).flowDays).toBe(90);
  });

  it("cannot hide the company and stage columns", () => {
    expect(sanitize("appearance", { columns: ["role"] }).columns).toEqual(["company", "role", "stage"]);
    expect(sanitize("appearance", { columns: ["lastActivity", "bogus"] }).columns).toEqual(["company", "stage", "lastActivity"]);
  });

  it("repairs a damaged stored value", async () => {
    const db = freshDb();
    await db.settings.put({ key: "appearance", value: "not an object" });
    expect((await loadSettings(db)).appearance).toEqual(DEFAULTS.appearance);
  });
});

describe("the application list", () => {
  const ago = (days: number) => iso(new Date(Date.now() - days * 86_400_000));

  async function seed() {
    const db = freshDb();
    const acct = await upsertAccount(db, "gmail", "me@gmail.com");
    const add = async (company: string, role: string, stage: "Applied" | "Interview" | "Rejected", applied: number | null, last: number, emails: number) => {
      const id = await createApplication(db, { company, companyKey: company.toLowerCase(), role, roleKey: role.toLowerCase(), stage, when: ago(applied ?? 0) });
      await db.applications.update(id, { lastActivity: ago(last), appliedAt: applied === null ? null : ago(applied) });
      for (let i = 0; i < emails; i++) {
        await db.emails.add({ accountId: acct, providerMsgId: `${company}-${i}`, threadId: null, receivedAt: ago(0), sender: null, subject: null, body: null, related: true, event: null, confidence: null, applicationId: id, needsReview: false, webLink: null, bulk: false, hold: false, reason: null });
      }
    };
    await add("Zeta", "Backend", "Interview", 30, 1, 3);
    await add("alpha", "Data", "Rejected", 20, 9, 1);
    await add("Mid", "Analyst", "Applied", null, 5, 2);
    return db;
  }
  const names = async (db: Awaited<ReturnType<typeof seed>>, q: Parameters<typeof listApplications>[1] = {}) => (await listApplications(db, q)).map((r) => r.company);

  it("defaults to latest activity first", async () => {
    expect(await names(await seed())).toEqual(["Zeta", "Mid", "alpha"]);
  });

  it.each([
    [{ sort: "company", dir: "asc" }, ["alpha", "Mid", "Zeta"]],
    [{ sort: "company", dir: "desc" }, ["Zeta", "Mid", "alpha"]],
    [{ sort: "stage", dir: "asc" }, ["Mid", "Zeta", "alpha"]],
    [{ sort: "emails" }, ["Zeta", "Mid", "alpha"]],
    [{ sort: "lastActivity", dir: "asc" }, ["alpha", "Mid", "Zeta"]],
  ])("sorts by %j", async (query, expected) => {
    expect(await names(await seed(), query)).toEqual(expected);
  });

  it("puts unknown applied dates last in both directions", async () => {
    const db = await seed();
    expect((await names(db, { sort: "applied", dir: "desc" })).at(-1)).toBe("Mid");
    expect((await names(db, { sort: "applied", dir: "asc" })).at(-1)).toBe("Mid");
  });

  it("falls back safely on bad sort values", async () => {
    expect(await names(await seed(), { sort: "company;DROP TABLE applications", dir: "sideways" })).toEqual(["Zeta", "Mid", "alpha"]);
  });

  it("filters by stage, text and account, and counts emails and idle days", async () => {
    const db = await seed();
    expect(await names(db, { stage: "Rejected", q: "alp" })).toEqual(["alpha"]);
    expect(await names(db, { q: "nothing" })).toEqual([]);
    expect(await names(db, { q: "ANALYST" })).toEqual(["Mid"]); // matches the role, any case
    expect(await names(db, { account: 99 })).toEqual([]);
    const zeta = (await listApplications(db)).find((r) => r.company === "Zeta")!;
    expect([zeta.nEmails, zeta.idleDays]).toEqual([3, 1]);
    expect((await stageCounts(db)).Interview).toBe(1);
  });

  it("suggests companies and roles, newest activity first", async () => {
    const s = await suggestions(await seed());
    expect(s.filter((x) => x.kind === "Company").map((x) => x.text)).toEqual(["Zeta", "Mid", "alpha"]);
    expect(s.filter((x) => x.kind === "Role").length).toBe(3);
  });
});
