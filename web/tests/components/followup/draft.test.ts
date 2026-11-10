import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $, $$, addApp, addMail, click, cleanup, freshDb, mountPage, row, text } from "../../pages/applications/harness";
import ApplicationsPage from "../../../src/pages/applications";
import DetailPage from "../../../src/pages/detail";
import { upsertAccount } from "../../../src/db/repo";
import type { JobTrackerDB } from "../../../src/db/schema";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T12:00:00"));
});
afterEach(async () => {
  await cleanup();
  vi.useRealTimers();
});

const NADIA = "Nadia Khan <nadia@acme.com>";
const SIGNATURE = "Thanks for applying!\nNadia Khan\nSenior Technical Recruiter\nAcme";
const draftButton = (root: ParentNode) => $$(root, "a.btn").find((a) => text(a) === "Draft follow-up") as HTMLAnchorElement | undefined;

async function seed(provider: "gmail" | "outlook" | null = "gmail", o: { last?: number; stage?: "Applied" | "Interview" } = {}) {
  const db = freshDb();
  const account = provider ? await upsertAccount(db, provider, provider === "gmail" ? "me@gmail.com" : "me@contoso.com") : 0;
  const id = await addApp(db, "Acme", { role: "Data Analyst", stage: o.stage ?? "Applied", applied: 22, last: o.last ?? 10 });
  if (provider) await addMail(db, account, id, { sender: NADIA, body: SIGNATURE, event: "applied" });
  return { db, id, account };
}
const openRow = async (db: JobTrackerDB) => {
  const { container } = await mountPage(ApplicationsPage, db);
  await click($(row(container, "Acme"), "a.expander"));
  return container;
};

describe("Draft follow-up", () => {
  it("opens a Gmail compose window in a new tab, to the recruiter, with the draft written", async () => {
    const { db, id } = await seed("gmail");
    const container = await openRow(db);
    const link = draftButton($(container, `#panel-${id}`)!)!;
    expect(link).toBeDefined();
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(link.getAttribute("aria-label")).toBe("Draft follow-up in Gmail (opens in a new tab)");
    expect(link.title).toBe("Opens a new message to nadia@acme.com in Gmail");
    const url = new URL(link.href);
    expect(url.origin + url.pathname).toBe("https://mail.google.com/mail/");
    expect(url.searchParams.get("authuser")).toBe("me@gmail.com");
    expect(url.searchParams.get("to")).toBe("nadia@acme.com");
    expect(url.searchParams.get("su")).toBe("Following up on my application for Data Analyst at Acme");
    expect(url.searchParams.get("body")).toMatch(/^Hi Nadia,\n\nI applied for the Data Analyst role at Acme on October 14 and wanted to follow up\./);
  });

  it("is the main action for an application that has gone quiet, and a plain button for one that hasn't", async () => {
    const quiet = await seed("gmail", { last: 10 });
    expect(draftButton(await openRow(quiet.db))!.className).toContain("primary");
    await cleanup();
    const fresh = await seed("gmail", { last: 2 });
    expect(draftButton(await openRow(fresh.db))!.className).not.toContain("primary");
  });

  it("opens an Outlook deeplink for an Outlook account", async () => {
    const { db, id } = await seed("outlook");
    const container = await openRow(db);
    const link = draftButton($(container, `#panel-${id}`)!)!;
    expect(link.href.startsWith("https://outlook.office.com/mail/deeplink/compose?")).toBe(true);
    expect(link.getAttribute("aria-label")).toBe("Draft follow-up in Outlook (opens in a new tab)");
  });

  it("is on the application page too, in the facts card, once", async () => {
    const { db, id } = await seed("gmail");
    const { container } = await mountPage(DetailPage, db, `/app/${id}`, { id: String(id) });
    expect($$(container, "a.btn").filter((a) => text(a) === "Draft follow-up")).toHaveLength(1);
    expect(draftButton($(container, ".card .app-actions")!)).toBeDefined();
  });

  it("is offered on an application that doesn't need one", async () => {
    const { db, id } = await seed("gmail", { stage: "Interview", last: 1 });
    const { container } = await mountPage(DetailPage, db, `/app/${id}`, { id: String(id) });
    expect(draftButton(container)).toBeDefined();
  });

  it("is replaced by one muted line when no mail account is connected", async () => {
    const { db, id } = await seed(null);
    const container = await openRow(db);
    const panel = $(container, `#panel-${id}`)!;
    expect(draftButton(panel)).toBeUndefined();
    expect(text($(panel, ".app-actions .muted"))).toBe("Connect your mailbox to draft this in Gmail or Outlook.");
    const page = await mountPage(DetailPage, db, `/app/${id}`, { id: String(id) });
    expect(draftButton(page.container)).toBeUndefined();
    expect(text($(page.container, ".app-actions .muted"))).toBe("Connect your mailbox to draft this in Gmail or Outlook.");
  });

  it("still opens a draft, with no recipient, for an application with no emails", async () => {
    const db = freshDb();
    await upsertAccount(db, "gmail", "me@gmail.com");
    const id = await addApp(db, "Acme", { role: "Analyst" });
    const { container } = await mountPage(DetailPage, db, `/app/${id}`, { id: String(id) });
    const link = draftButton(container)!;
    expect(new URL(link.href).searchParams.has("to")).toBe(false);
    expect(link.title).toBe("Opens a new message in Gmail");
    expect(new URL(link.href).searchParams.get("body")).toMatch(/^Hello,\n/);
  });

  it("never turns a hostile company into extra recipients or headers", async () => {
    const db = freshDb();
    await upsertAccount(db, "gmail", "me@gmail.com");
    const id = await addApp(db, "Acme\r\nBcc: spy@evil.com&to=spy@evil.com", { role: "Analyst" });
    const { container } = await mountPage(DetailPage, db, `/app/${id}`, { id: String(id) });
    const url = new URL(draftButton(container)!.href);
    expect(url.searchParams.getAll("to")).toEqual([]);
    expect(url.searchParams.get("su")).toBe("Following up on my application for Analyst at Acme Bcc: spy@evil.com&to=spy@evil.com");
    expect(url.search).not.toContain("&to=spy");
    expect(url.search).not.toMatch(/%0D/i);
  });
});
