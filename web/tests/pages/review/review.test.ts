import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $, $$, addApp, addMail, button, cleanup, click, freshDb, mountPage, text, type, waitFor } from "../applications/harness";
import ReviewPage from "../../../src/pages/review";
import { clearFlash, setFlash } from "../../../src/components/flash";
import { upsertAccount } from "../../../src/db/repo";
import type { JobTrackerDB } from "../../../src/db/schema";

afterEach(cleanup);
beforeEach(() => {
  window.confirm = vi.fn(() => true);
  clearFlash();
});

async function setup() {
  const db = freshDb();
  const account = await upsertAccount(db, "gmail", "me@gmail.com");
  const acme = await addApp(db, "Acme", { role: "Analyst" });
  const mail = await addMail(db, account, null, {
    review: true, event: "interview", sender: "Pat Lee <pat@coachco.io>", subject: "Quick chat about the Data Analyst role at Initech",
    body: "Hi, I would love to talk.\n\nBest,\nPat",
  });
  return { db, account, acme, mail };
}
const open = (db: JobTrackerDB) => mountPage(ReviewPage, db, "/review");

describe("the Needs review page", () => {
  it("shows each waiting email with what the tracker guessed and the cleaned text", async () => {
    const { db } = await setup();
    const { container } = await open(db);
    expect(text($(container, "h1.page"))).toBe("Needs review");
    const card = $(container, "article.card")!;
    expect(text($(card, ".mail-subject"))).toBe("Quick chat about the Data Analyst role at Initech");
    // Every card repeats these buttons, so each one names its email (and starts with its visible words).
    expect($$(card, "button[aria-label]").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Not job mail: Quick chat about the Data Analyst role at Initech",
      "Add to application: Quick chat about the Data Analyst role at Initech",
      "Create application from: Quick chat about the Data Analyst role at Initech",
    ]);
    expect(text($(card, ".mail-meta .who"))).toBe("Pat Lee");
    expect(text($(card, ".mail-meta .addr"))).toBe("pat@coachco.io");
    expect(text($(card, ".mail-guess"))).toBe("Looks like Interview, high confidence");
    expect(text($(card, ".mail-text"))).toContain("Hi, I would love to talk.");
    expect($$(card, "p.sig").length).toBeGreaterThan(0);
    const reply = $(card, "a.btn")!;
    expect(text(reply)).toBe("Reply in Gmail");
    expect($(card, "a.btn.primary")).toBeNull();   // the card's one primary action is Create application
    expect([reply.getAttribute("target"), reply.getAttribute("rel")]).toEqual(["_blank", "noopener noreferrer"]);
    expect(text($$(card, "a.btn")[1])).toBe("Open in Gmail");
    expect($$(card, "select[name=stage]").map((s) => (s as HTMLSelectElement).value)).toEqual(["Interview"]);
    expect(($(card, "input[aria-label=Company]") as HTMLInputElement).value).toBe("Coachco");   // the guess comes from the sender, not the subject
    expect($$(card, "select[aria-label='Existing application'] option").map(text)).toEqual(["Existing application…", "Acme · Analyst"]);
  });

  it("says when there is nothing to review", async () => {
    const { container } = await open(freshDb());
    expect(text(container)).toContain("Nothing to review.");
    const link = $(container, "a[href='#/settings/mail']")!;
    expect(text(link)).toBe("Settings");
    expect(text(link.parentElement)).toBe("Rules the app has learned are in Settings.");
    expect($(container, "#learned")).toBeNull();   // the rules live in Settings > Mail now
  });

  it("adds an email to an existing application at the stage you choose", async () => {
    const { db, acme, mail } = await setup();
    const { container } = await open(db);
    await type($(container, "select[aria-label='Existing application']"), String(acme));
    await type($(container, "select[name=stage]"), "Assessment");
    await click(button(container, "Add to application"));
    await waitFor(() => !$(container, "article.card") && text($(container, ".notice")).includes("Added to Acme."));
    expect(text(container)).toContain("Nothing to review.");
    expect(text($(container, ".notice"))).toContain("Added to Acme.");
    expect(document.activeElement).toBe($(container, ".notice"));   // the card and its button are gone, so the result has focus
    const row = (await db.emails.get(mail))!;
    expect([row.applicationId, row.needsReview, row.event]).toEqual([acme, false, "assessment"]);
    expect((await db.applications.get(acme))!.stage).toBe("Assessment");
  });

  it("asks you to choose an application first", async () => {
    const { db, mail } = await setup();
    const { container } = await open(db);
    await click(button(container, "Add to application"));
    expect(text($(container, ".notice.err"))).toBe("Choose an application.");
    expect($(container, ".notice.err")?.getAttribute("role")).toBe("alert");
    expect((await db.emails.get(mail))!.needsReview).toBe(true);
  });

  it("creates a new application from the email", async () => {
    const { db, mail } = await setup();
    const { container } = await open(db);
    await type($(container, "input[aria-label=Company]"), "Initech");
    await type($(container, "input[aria-label=Role]"), "Data Analyst");
    await click(button(container, "Create application"));
    await waitFor(() => !$(container, "article.card"));
    expect(text($(container, ".notice"))).toContain("Created Initech.");
    const created = (await db.applications.toArray()).find((a) => a.company === "Initech")!;
    expect([created.role, created.stage]).toEqual(["Data Analyst", "Interview"]);
    expect((await db.emails.get(mail))!.applicationId).toBe(created.id);
  });

  it("will not create one without a company", async () => {
    const { db } = await setup();
    const { container } = await open(db);
    await type($(container, "input[aria-label=Company]"), "");
    await click(button(container, "Create application"));
    expect($(container, "article.card")).not.toBeNull();   // the form's own required check holds it back
    expect((await db.applications.toArray()).map((a) => a.company)).toEqual(["Acme"]);
  });

  it("dismisses it as not job mail, erases it, and shows what was learned", async () => {
    const { db, account, mail } = await setup();
    for (let i = 0; i < 2; i++) await addMail(db, account, null, { review: true, sender: `Coach ${i} <coach${i}@coachco.io>`, subject: `Join our program ${i}` });
    const { container } = await open(db);
    expect($$(container, "article.card")).toHaveLength(3);
    // Learning from the first answers can clear the rest, so go on until nothing is waiting.
    for (let i = 0; i < 3 && $(container, "article.card"); i++) {
      const before = $$(container, "article.card").length;
      await click(button($$(container, "article.card")[0] as HTMLElement, "Not job mail"));
      await waitFor(() => $$(container, "article.card").length < before);
    }
    expect($(container, "article.card")).toBeNull();
    const erased = (await db.emails.get(mail))!;
    expect([erased.needsReview, erased.related, erased.subject, erased.body]).toEqual([false, false, null, null]);
    expect(await db.feedback.count()).toBeGreaterThanOrEqual(1);
    expect(text($(container, ".notice"))).toMatch(/Marked as not job mail\./);
  });

  it("shows a message carried over from another page", async () => {
    const { db } = await setup();
    setFlash("Removed Acme.");
    const { container } = await open(db);
    expect(text($(container, ".notice"))).toBe("Removed Acme.");
    expect($(container, ".notice")?.getAttribute("role")).toBe("status");
  });

  it("draws a hostile subject, sender and body as plain text", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    await addMail(db, account, null, {
      review: true, subject: "<script>alert(1)</script> hi", sender: "<img src=x onerror=alert(2)> <evil@x.com>", body: "<script>alert(3)</script> see https://evil.example/path",
    });
    const { container } = await open(db);
    expect($(container, "script")).toBeNull();
    expect($(container, "img")).toBeNull();
    expect($(container, "article .mail-text b, article .mail-meta b, article img")).toBeNull();
    expect(text($(container, "article .mail-subject"))).toBe("<script>alert(1)</script> hi");
    expect($(container, "article .mail-text .url")?.textContent).toBe("evil.example");
    expect($$(container, "article .mail-text a")).toHaveLength(0);
  });
});
