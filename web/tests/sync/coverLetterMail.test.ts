// A cover letter opens as an unsent Gmail or Outlook message to the person a follow-up would go to.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { createApplication, upsertAccount } from "../../src/db/repo";
import type { JobTrackerDB } from "../../src/db/schema";
import { coverLetterMail } from "../../src/sync/applicationActions";
import { MAX_DRAFT_BODY_CHARS, coverLetterDraft, draftLink, followUpDraft } from "../../src/sync/followUpDraft";
import { closeAll, freshDb } from "./helpers";

afterEach(closeAll);

const query = (url: string) => new URL(url).searchParams;
let n = 0;

async function app(db: JobTrackerDB, company = "Acme", role = "Data Analyst"): Promise<number> {
  return createApplication(db, { company, companyKey: company.toLowerCase(), role, roleKey: role.toLowerCase(), stage: "Applied", when: "2026-10-14T12:00:00Z" });
}
async function mail(db: JobTrackerDB, accountId: number, appId: number, sender: string) {
  await db.emails.add({
    accountId, providerMsgId: `m${n++}`, threadId: `t${n}`, receivedAt: "2026-10-15T10:00:00Z", sender, subject: "Hello", body: "Thanks.", related: true,
    event: "applied", confidence: "high", applicationId: appId, needsReview: false, webLink: null, bulk: false, hold: false, reason: null,
  });
}

describe("coverLetterDraft", () => {
  it("has the subject 'Application for <role>' and the letter as the text", () => {
    expect(coverLetterDraft({ company: "Acme", role: "Data Analyst" }, { name: "Nadia Khan", email: "nadia@acme.com" }, "Dear Nadia,\n\nHello.")).toEqual({
      to: "nadia@acme.com", subject: "Application for Data Analyst", body: "Dear Nadia,\n\nHello.",
    });
  });

  it("falls back to the company when the role isn't known, and to no recipient", () => {
    expect(coverLetterDraft({ company: "Acme", role: "Unknown role" }, null, "x")).toMatchObject({ to: "", subject: "Application to Acme" });
    expect(coverLetterDraft({ company: "", role: "" }, null, "x").subject).toBe("Application");
  });

  it("keeps a company or role from adding a header or a tag", () => {
    const d = coverLetterDraft({ company: "Acme", role: "Analyst\r\nBcc: x@evil.test <b>" }, null, "x");
    expect(d.subject).not.toMatch(/[\r\n<>]/);
  });
});

describe("draftLink labels", () => {
  const draft = followUpDraft({ company: "Acme", role: "Analyst", appliedAt: null }, { name: "Sam", email: "sam@acme.com" }, "2026-11-05");

  it("keeps the follow-up labels by default", () => {
    expect(draftLink("gmail", "me@gmail.com", draft)?.label).toBe("Draft follow-up in Gmail");
    expect(draftLink("outlook", "me@contoso.com", draft)?.label).toBe("Draft follow-up in Outlook");
  });

  it("names a cover letter draft without the follow-up wording", () => {
    expect(draftLink("gmail", "me@gmail.com", draft, null, "")?.label).toBe("Draft in Gmail");
    expect(draftLink("outlook", "me@outlook.com", draft, null, "")?.label).toBe("Draft in Outlook");
  });

  it("cuts a long text to the limit and leaves a short one whole", () => {
    const long = { ...draft, body: "a".repeat(MAX_DRAFT_BODY_CHARS + 500) };
    expect(query(draftLink("gmail", "me@gmail.com", long)!.url).get("body")).toHaveLength(MAX_DRAFT_BODY_CHARS);
    expect(query(draftLink("gmail", "me@gmail.com", draft)!.url).get("body")).toBe(draft.body);
  });
});

describe("coverLetterMail", () => {
  it("opens a Gmail compose link to the recruiter, from the mailbox that got their email", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const id = await app(db);
    await mail(db, account, id, "Nadia Khan <nadia@acme.com>");
    const out = (await coverLetterMail(db, id, "Dear Nadia,\n\nI'd love to join."))!;
    expect(out.link?.label).toBe("Draft in Gmail");
    expect(out.to).toBe("nadia@acme.com");
    expect(out.cut).toBe(false);
    const q = query(out.link!.url);
    expect(new URL(out.link!.url).hostname).toBe("mail.google.com");
    expect(q.get("to")).toBe("nadia@acme.com");
    expect(q.get("su")).toBe("Application for Data Analyst");
    expect(q.get("body")).toBe("Dear Nadia,\n\nI'd love to join.");
  });

  it("uses Outlook for an Outlook mailbox", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "outlook", "me@outlook.com");
    const id = await app(db);
    await mail(db, account, id, "Sam Lee <sam@acme.com>");
    const out = (await coverLetterMail(db, id, "Hello"))!;
    expect(out.link?.label).toBe("Draft in Outlook");
    expect(new URL(out.link!.url).hostname).toBe("outlook.live.com");
  });

  it("says when the letter is longer than the link can carry", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const id = await app(db);
    await mail(db, account, id, "Sam Lee <sam@acme.com>");
    const out = (await coverLetterMail(db, id, "word ".repeat(1000)))!;
    expect(out.cut).toBe(true);
    expect(query(out.link!.url).get("body")!.length).toBeLessThanOrEqual(MAX_DRAFT_BODY_CHARS);
  });

  it("keeps a letter with an emoji and & = # intact, and the link encoded, for a recruiter with accents in their name", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const id = await app(db);
    await mail(db, account, id, "José Müller <jose.muller@acme.com>");
    const letter = "Dear José,\n\nR&D = my #1 passion 🚀 (Q&A, a=b)";
    const out = (await coverLetterMail(db, id, letter))!;
    expect(out.to).toBe("jose.muller@acme.com");
    expect(out.cut).toBe(false);
    const q = query(out.link!.url);
    expect(q.get("to")).toBe("jose.muller@acme.com");
    expect(q.get("body")).toBe(letter);
    const raw = out.link!.url;
    expect(raw).toMatch(/^[\x21-\x7e]+$/); // printable ASCII only: no spaces, no accents, no emoji
    expect(raw).not.toContain("#");
    expect(raw).toContain("%26");
    expect(raw).toContain("%3D");
    expect(raw).toContain("%23");
    expect(raw).toContain("%F0%9F%9A%80");
  });

  it("cuts the letter by character, so an emoji at the limit is kept whole and never half", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const id = await app(db);
    await mail(db, account, id, "Sam Lee <sam@acme.com>");
    const out = (await coverLetterMail(db, id, `${"a".repeat(MAX_DRAFT_BODY_CHARS - 1)}🚀 and more text after`))!;
    const body = query(out.link!.url).get("body")!;
    expect(Array.from(body)).toHaveLength(MAX_DRAFT_BODY_CHARS);
    expect(body.endsWith("🚀")).toBe(true);
    expect(body).not.toContain("�");
    expect(body).not.toContain("and more");
    expect(out.cut).toBe(true);
  });

  it("drops an emoji that starts past the limit rather than splitting it", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const id = await app(db);
    await mail(db, account, id, "Sam Lee <sam@acme.com>");
    const body = query((await coverLetterMail(db, id, `${"a".repeat(MAX_DRAFT_BODY_CHARS)}🚀`))!.link!.url).get("body")!;
    expect(body).toBe("a".repeat(MAX_DRAFT_BODY_CHARS));
  });

  it("has no link without a connected mailbox, and nothing for an application that is gone", async () => {
    const db = freshDb();
    const id = await app(db);
    expect(await coverLetterMail(db, id, "Hello")).toEqual({ link: null, to: "", cut: false });
    expect(await coverLetterMail(db, 999, "Hello")).toBeNull();
  });

  it("never uses a mailbox you have disconnected", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const id = await app(db);
    await mail(db, account, id, "Sam Lee <sam@acme.com>");
    await db.accounts.update(account, { active: false });
    expect((await coverLetterMail(db, id, "Hello"))!.link).toBeNull();
  });
});
