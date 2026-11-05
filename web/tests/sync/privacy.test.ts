// What stays on disk about mail that turned out not to be about a job: only its id and date.
// And which links the app is willing to keep for "Open in Outlook".
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { clearEmail } from "../../src/db/repo";
import type { EmailRow } from "../../src/db/schema";
import { safeWebLink } from "../../src/db/mailLink";
import { resolveReview } from "../../src/sync/actions";
import { processMessage } from "../../src/sync/sync";
import { closeAll, dbWithAccount, mk } from "./helpers";

afterEach(closeAll);

const OUTLOOK = "https://outlook.office365.com/owa/?ItemID=abc";

async function waitingForReview() {
  const { db, acct } = await dbWithAccount();
  const id = await db.emails.add({
    accountId: acct, providerMsgId: "r1", threadId: "thread-1", receivedAt: "2026-10-05T09:00:00Z", sender: "Pat <pat@acme.com>", subject: "Maybe a job",
    body: "We might have something.", related: true, event: "interview", confidence: "low", applicationId: null, needsReview: true, webLink: OUTLOOK,
    bulk: true, hold: false, reason: "body: x",
  });
  return { db, id };
}

const onlyIdAndDate = (row: EmailRow) => ({
  threadId: row.threadId, sender: row.sender, subject: row.subject, body: row.body, webLink: row.webLink, reason: row.reason, event: row.event,
  confidence: row.confidence, applicationId: row.applicationId, bulk: row.bulk, related: row.related, needsReview: row.needsReview,
});
const NOTHING = {
  threadId: null, sender: null, subject: null, body: null, webLink: null, reason: null, event: null, confidence: null, applicationId: null,
  bulk: false, related: false, needsReview: false,
};

describe("mail you dismiss from Needs review", () => {
  it("keeps only its id and date: no thread id, no link into your mailbox", async () => {
    const { db, id } = await waitingForReview();
    await resolveReview(db, id, { action: "dismiss" });
    const row = (await db.emails.get(id))!;
    expect(onlyIdAndDate(row)).toEqual(NOTHING);
    expect([row.providerMsgId, row.receivedAt]).toEqual(["r1", "2026-10-05T09:00:00Z"]);
  });

  it("is erased the same way as mail you clear by marking an application as not a job", async () => {
    const { db, id } = await waitingForReview();
    await clearEmail(db, id);
    expect(onlyIdAndDate((await db.emails.get(id))!)).toEqual(NOTHING);
  });
});

describe("the link kept for Open in Outlook", () => {
  it("is the one Microsoft gave, when it is on an Outlook host", () => {
    expect(safeWebLink(OUTLOOK)).toBe(OUTLOOK);
    expect(safeWebLink("https://outlook.live.com/owa/?ItemID=abc")).not.toBeNull();
    expect(safeWebLink("https://evil.example/owa")).toBeNull();
    expect(safeWebLink("https://outlook.office365.com.evil.example/owa")).toBeNull();
    expect(safeWebLink("http://outlook.office365.com/owa")).toBeNull();
    expect(safeWebLink("https://u:p@outlook.office365.com/owa")).toBeNull();
    expect(safeWebLink("not a link")).toBeNull();
    expect(safeWebLink(null)).toBeNull();
    expect(safeWebLink(`${OUTLOOK}${"a".repeat(2000)}`)).toBeNull();
  });

  it("is dropped at sync time when it is anywhere else", async () => {
    const { db, acct } = await dbWithAccount();
    await processMessage(db, acct, { ...mk("a", "Thank you for applying to Acme", "", undefined, "ta"), webLink: "https://evil.example/login" });
    await processMessage(db, acct, { ...mk("b", "Thank you for applying to Beta", "", "Beta <no-reply@lever.co>", "tb"), webLink: OUTLOOK });
    const links = Object.fromEntries((await db.emails.toArray()).map((e) => [e.providerMsgId, e.webLink]));
    expect(links).toEqual({ a: null, b: OUTLOOK });
  });
});
