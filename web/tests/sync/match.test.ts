// The app finds an email's application through sync/match.ts over the database. Run every golden findApplication case
// (made by the Python matcher) through that exact path, so the algorithm the app runs is the one the fixtures guard.
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, dbWithAccount } from "./helpers"; // first: it installs the fake IndexedDB before Dexie loads
import goldenText from "../fixtures/pipeline-golden.json?raw";
import { findApplication } from "../../src/sync/match";

afterEach(closeAll);

interface GoldenCase {
  input: {
    threadId: string; threadApplicationId: number | null; ckey: string; rkey: string; event: string | null; role: string;
    applications: { id: number; role: string; roleKey: string; stage: string }[];
  };
  expected: { kind: string; applicationId: number | null };
}
const cases = (JSON.parse(goldenText) as { cases: { findApplication: GoldenCase[] } }).cases.findApplication;

describe("findApplication over the database", () => {
  it(`gives the Python answer for all ${cases.length} golden cases`, async () => {
    expect(cases.length).toBeGreaterThan(0);
    const { db, acct } = await dbWithAccount();
    const bad: unknown[] = [];
    for (const { input: i, expected } of cases) {
      await db.applications.clear();
      await db.emails.clear();
      for (const a of i.applications) {
        await db.applications.add({
          id: a.id, company: "c", companyKey: i.ckey, role: a.role, roleKey: a.roleKey, stage: a.stage as never,
          stageAt: null, appliedAt: null, lastActivity: null, locked: false, manual: false,
        });
      }
      if (i.threadId && i.threadApplicationId) {
        await db.emails.add({
          accountId: acct, providerMsgId: "x", threadId: i.threadId, receivedAt: "2026-10-01T00:00:00Z", applicationId: i.threadApplicationId,
          related: true, needsReview: false,
        } as never);
      }
      const got = await findApplication(db, acct, i.threadId, i.ckey, i.rkey, i.event as never, i.role);
      if (got.kind !== expected.kind || got.applicationId !== expected.applicationId) bad.push({ input: i, got, expected });
    }
    expect(bad.slice(0, 3)).toEqual([]);
  });
});
