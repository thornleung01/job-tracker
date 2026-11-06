// A recheck removes an application only when nothing of yours is attached. A cover letter, a chosen resume or a saved posting are yours.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { deleteDocument, saveCoverLetter, saveMaster, setApplicationResume, setPostingText } from "../../src/sync/documents";
import { recheck } from "../../src/sync/recheck";
import { processMessage } from "../../src/sync/sync";
import { closeAll, dbWithAccount, mail } from "./helpers";

afterEach(closeAll);

const SECTIONS = [{ id: "", heading: "Experience", items: [{ id: "", text: "Built dashboards" }] }];

/** An application a sync made from one email, then a rule says that sender was never a job. */
async function newsletterApplication() {
  const { db, acct } = await dbWithAccount();
  await processMessage(db, acct, mail("Hello", "Thank you for applying to Acme for the Analyst role. We received your application.", "Acme Careers <jobs@acme.com>", "a", 1, "t1"));
  const app = (await db.applications.toArray())[0];
  expect([app.manual, app.locked, await db.activity.count()]).toEqual([false, false, 0]);
  await db.learnedRules.add({ kind: "block_sender", value: "jobs@acme.com", evidence: 3, active: true, createdAt: "2026-10-02T00:00:00Z" });
  return { db, id: app.id };
}

describe("recheck and documents", () => {
  it("removes an application with no documents (the control)", async () => {
    const { db } = await newsletterApplication();
    expect(await recheck(db)).toMatchObject({ cleared: 1, removed: 1 });
    expect(await db.applications.count()).toBe(0);
  });

  it("keeps an application that has a cover letter", async () => {
    const { db, id } = await newsletterApplication();
    await saveCoverLetter(db, id, SECTIONS);
    expect(await recheck(db)).toMatchObject({ cleared: 0, removed: 0 });
    expect(await db.applications.count()).toBe(1);
    expect(await db.documents.count()).toBe(1);
  });

  it("keeps an application that has a resume chosen", async () => {
    const { db, id } = await newsletterApplication();
    await setApplicationResume(db, id, await saveMaster(db, SECTIONS, "paste"));
    expect(await recheck(db)).toMatchObject({ cleared: 0, removed: 0 });
    expect(await db.applications.count()).toBe(1);
  });

  it("keeps an application that has posting text", async () => {
    const { db, id } = await newsletterApplication();
    await setPostingText(db, id, "We are hiring an analyst.");
    expect(await recheck(db)).toMatchObject({ cleared: 0, removed: 0 });
    expect((await db.applications.get(id))!.postingText).toBe("We are hiring an analyst.");
  });

  // Erasing the application would erase its cover letter row, and that is the letter Recently deleted can still restore.
  it("keeps an application whose only cover letter is in Recently deleted", async () => {
    const { db, id } = await newsletterApplication();
    await deleteDocument(db, await saveCoverLetter(db, id, SECTIONS));
    expect(await recheck(db)).toMatchObject({ cleared: 0, removed: 0 });
    expect(await db.applications.count()).toBe(1);
    expect(await db.documents.count()).toBe(1);
  });
});
