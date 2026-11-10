import { afterEach, describe, expect, it } from "vitest";
import { $, button, cleanup, click, freshDb, mountPage, text, waitFor } from "../applications/harness";
import { MailRulesSection } from "../../../src/pages/settings/MailRulesSection";
import { upsertAccount } from "../../../src/db/repo";
import type { JobTrackerDB } from "../../../src/db/schema";
import { iso } from "../../../src/db/time";

afterEach(cleanup);

const open = (db: JobTrackerDB) => mountPage(MailRulesSection, db, "/settings/mail");

describe("Settings > Mail rules", () => {
  it("says so when nothing has been learned yet", async () => {
    const { container } = await open(freshDb());
    expect(text($(container, "#learned h2.sec"))).toBe("What the app has learned");
    expect(text($(container, "#learned"))).toContain("Nothing yet.");
    expect($(container, "#ignored")).toBeNull();
  });

  it("lists learned rules and undoes one", async () => {
    const db = freshDb();
    await db.learnedRules.add({ kind: "block_domain", value: "coachco.io", evidence: 3, active: true, createdAt: iso(new Date()) });
    const { container } = await open(db);
    const line = $(container, "#learned .review-line")!;
    expect(text(line)).toContain("coachco.io");
    await click(button(line, "Undo"));
    await waitFor(() => !$(container, "#learned .review-line"));
    expect(text($(container, ".notice"))).toBe("Rule removed. New emails are judged without it. Emails it already cleared stay cleared.");
    expect(document.activeElement).toBe($(container, ".notice"));
    expect((await db.learnedRules.toArray())[0].active).toBe(false);
  });

  it("restores ignored mail that was a real job email", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    await db.ignoredMail.add({
      accountId: account, providerMsgId: "ign-1", threadId: "t9", receivedAt: iso(new Date(Date.now() - 86_400_000)), sender: "Hiring <hr@initech.com>",
      subject: "Your application to Initech", body: "Thank you for applying to Initech. We received your application for the Data Analyst role.", webLink: null,
      reason: "learned: ignoring hr@initech.com", createdAt: iso(new Date()), bulk: false,
    });
    const { container } = await open(db);
    const section = $(container, "#ignored")!;
    expect(text($(section, "h2"))).toBe("Ignored because of what the app learned");
    expect(text($(section, ".review-line"))).toContain("Your application to Initech");
    expect(text($(section, ".review-line"))).toContain("hr@initech.com");
    expect($(section, "button")?.getAttribute("aria-label")).toBe("Restore email: Your application to Initech");
    await click(button(section, "Restore email"));
    await waitFor(() => !$(container, "#ignored") && !!$(container, ".notice"));
    expect(await db.ignoredMail.count()).toBe(0);
  });

  it("draws a hostile ignored subject as plain text", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    await db.ignoredMail.add({
      accountId: account, providerMsgId: "i2", threadId: null, receivedAt: iso(new Date()), sender: "<b>x</b> <x@y.com>", subject: "<script>alert(4)</script>",
      body: "", webLink: null, reason: "", createdAt: iso(new Date()), bulk: false,
    });
    const { container } = await open(db);
    expect($(container, "script")).toBeNull();
    expect(text($(container, "#ignored"))).toContain("<script>alert(4)</script>");
  });
});
