import { afterEach, describe, expect, it } from "vitest";
import { $, $$, addApp, addMail, button, cleanup, click, freshDb, mountPage, text, type, waitFor } from "./harness";
import ApplicationsPage from "../../../src/pages/applications";
import { upsertAccount } from "../../../src/db/repo";

afterEach(cleanup);

const names = (c: HTMLElement) => $$(c, "tr.app-row [data-col=company] strong").map((e) => text(e));

async function seed() {
  const db = freshDb();
  const account = await upsertAccount(db, "gmail", "me@gmail.com");
  const acme = await addApp(db, "Acme", { role: "Analyst" });
  const beta = await addApp(db, "Beta", { role: "Designer" });
  const gamma = await addApp(db, "Gamma", { role: "Writer" });
  await addMail(db, account, acme, { subject: "Your interview with the data team", body: "We loved your résumé and want to talk on Friday." });
  await addMail(db, account, gamma, { subject: "<img src=x onerror=alert(1)> Next steps", body: "Please reply." });
  await db.activity.add({ applicationId: beta, kind: "note", label: null, body: "Coffee chat with Dana from recruiting", occurredAt: "2026-10-03T12:00:00Z", createdAt: "2026-10-03T12:00:00Z" });
  return db;
}

describe("search across everything", () => {
  it("finds an application by something in its email and says why, in a muted line under the company", async () => {
    const m = await mountPage(ApplicationsPage, await seed());
    await type($(m.container, "#f-q"), "interview");
    await click(button(m.container, "Apply filters"));
    expect(m.location()).toBe("/?q=interview");
    await waitFor(() => names(m.container).length === 1);
    expect(names(m.container)).toEqual(["Acme"]);
    const why = $(m.container, "tr.app-row .match-why")!;
    expect(text(why)).toContain("Matched in an email:");
    expect(text(why)).toContain("interview with the data team");
    expect(why.classList.contains("muted")).toBe(true);
  });

  it("matches without caring about accents or word order", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed(), "/?q=RESUME+friday");
    expect(names(container)).toEqual(["Acme"]);
    expect(text($(container, ".match-why"))).toContain("résumé");
  });

  it("finds a note", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed(), "/?q=dana");
    expect(names(container)).toEqual(["Beta"]);
    expect(text($(container, ".match-why"))).toContain("Matched in a note:");
  });

  it("shows no reason when the company or role matched, since the row already shows it", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed(), "/?q=acme");
    expect(names(container)).toEqual(["Acme"]);
    expect($(container, ".match-why")).toBeNull();
    const none = await mountPage(ApplicationsPage, await seed());
    expect($(none.container, ".match-why")).toBeNull();
  });

  it("shows email text as text, never as markup", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed(), "/?q=next+steps");
    expect(names(container)).toEqual(["Gamma"]);
    expect(text($(container, ".match-why"))).toContain("<img src=x onerror=alert(1)>");
    expect($(container, ".match-why img")).toBeNull();
  });

  it("matches nothing for words that are not there, and says so", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed(), "/?q=zebra");
    expect(text($(container, "td.list-empty"))).toBe("No applications match these filters.");
  });

  it("does not match text from mail that was erased", async () => {
    const db = await seed();
    const mail = (await db.emails.toArray()).find((e) => e.subject?.includes("interview"))!;
    const { clearEmail } = await import("../../../src/db/repo");
    await clearEmail(db, mail.id);
    const { container } = await mountPage(ApplicationsPage, db, "/?q=interview");
    expect(names(container)).toEqual([]);
  });

  it("says in the box what it looks through", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed());
    expect(($(container, "#f-q") as HTMLInputElement).placeholder).toBe("Company, role, email or note");
  });
});
