// BP-LOGIC-8 end to end: a failed Junk folder lookup must show up as a failed sync, not as Junk mail turned into applications.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { upsertAccount } from "../../src/db/repo";
import { openDatabase, type JobTrackerDB } from "../../src/db/schema";
import { createGraphProvider } from "../../src/providers/graph";
import { syncAccount } from "../../src/sync/sync";
import { fakeSleep, json, scriptedFetch, token } from "./helpers";

const opened: JobTrackerDB[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (opened.length) opened.pop()!.close();
});

const mail = (id: string, folder: string, subject: string) => ({
  id,
  conversationId: `c-${id}`,
  subject,
  from: { emailAddress: { name: "Careers", address: "no-reply@greenhouse.io" } },
  receivedDateTime: "2026-10-19T09:00:00Z",
  body: { contentType: "text", content: "Thank you for applying." },
  parentFolderId: folder,
});

function outlook(junkLookup: number) {
  return scriptedFetch(({ url }) => {
    if (url.pathname.includes("/me/mailFolders/")) {
      const name = url.pathname.split("/").pop()!;
      return name === "junkemail" && junkLookup !== 200 ? json({}, junkLookup) : json({ id: `F-${name}` });
    }
    return json({ value: [mail("inbox-1", "F-inbox", "Thank you for applying to Acme"), mail("junk-1", "F-junkemail", "Thank you for applying to Beta Corp")] });
  });
}

async function run(junkLookup: number) {
  vi.spyOn(console, "error").mockImplementation(() => {}); // syncAccount logs the failure it records
  const db = openDatabase(`graph-sync-${Date.now()}-${Math.random()}`);
  opened.push(db);
  const acct = await upsertAccount(db, "outlook", "me@outlook.com");
  const { sleep } = fakeSleep();
  const provider = createGraphProvider(token, { fetch: outlook(junkLookup).fetch, sleep });
  const now = new Date("2026-10-20T12:00:00Z");
  const result = await syncAccount(db, acct, provider, { now }).then(() => null, (e: unknown) => e);
  const row = (await db.accounts.get(acct))!;
  return { db, row, result };
}

describe("an Outlook sync whose Junk folder lookup fails", () => {
  it("reads only the inbox when the lookup works", async () => {
    const { db, row, result } = await run(200);
    expect(result).toBeNull();
    expect((await db.applications.toArray()).map((a) => a.company)).toEqual(["Acme"]);
    expect([row.lastSync, row.lastError]).toEqual(["2026-10-20T12:00:00Z", null]);
  });

  it.each([403, 429, 503])("answering %s: the sync fails, records the error, keeps lastSync, and creates no applications", async (status) => {
    const { db, row, result } = await run(status);
    expect(result).not.toBeNull();
    expect(row.lastError).toBeTruthy();
    expect(row.lastSync).toBeNull();
    expect(await db.applications.count()).toBe(0);
    expect(await db.emails.count()).toBe(0);
  });
});
