// The signed-in shell: it erases what has waited 30 days in Recently deleted when the app starts, and shows the line with Restore after a delete.
import "fake-indexeddb/auto";
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import { defaultLoaders } from "../../src/app/pages";
import { act } from "react";
import { TrashHost } from "../../src/components/trash/TrashHost";
import { announceDeleted, dismissNotice } from "../../src/components/trash/deletedNotice";
import { createApplication, upsertAccount } from "../../src/db/repo";
import { DAY_MS } from "../../src/db/time";
import { deleteApplication } from "../../src/sync/actions";
import { byText, cleanupRendered, click, closeDbs, freshDb, go, q, render, settle, waitFor } from "./helpers";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  dismissNotice();
});
afterEach(() => {
  cleanupRendered();
  dismissNotice();
  closeDbs();
});

async function seed() {
  const db = freshDb();
  const account = await upsertAccount(db, "gmail", "me@gmail.com");
  const make = (company: string) => createApplication(db, { company, companyKey: company.toLowerCase(), role: "Analyst", roleKey: "analyst", stage: "Applied", when: "2026-10-01T09:00:00Z" });
  const [acme, old, recent] = [await make("Acme"), await make("Oldco"), await make("Recentco")];
  await db.emails.add({
    accountId: account, providerMsgId: "m", threadId: "t", receivedAt: "2026-10-02T09:00:00Z", sender: "A <a@oldco.com>", subject: "Hello", body: "Body",
    related: true, event: "applied", confidence: "high", applicationId: old, needsReview: false, webLink: null, bulk: false, hold: false, reason: null,
  });
  await deleteApplication(db, old, "clear", new Date(Date.now() - 31 * DAY_MS));
  await deleteApplication(db, recent, "clear", new Date(Date.now() - 29 * DAY_MS));
  return { db, acme, old, recent };
}
const start = (db: ReturnType<typeof freshDb>) => render(h(App, { local: true, loaders: defaultLoaders, openDb: () => db }));

describe("when the app starts", () => {
  it("erases what has waited 31 days and keeps what has waited 29, once per session", async () => {
    const { db, old, recent } = await seed();
    await start(db);
    await waitFor(async () => (await db.applications.get(old)) === undefined);
    expect((await db.applications.get(recent))?.deletedAt).toBeDefined();
    const mail = (await db.emails.toArray())[0];
    expect([mail.applicationId, mail.subject, mail.body, mail.related]).toEqual([null, null, null, false]);
  });
});

describe("after a delete", () => {
  it("the detail page sends you to the list, where the line has Restore, which puts it back", async () => {
    const { db, acme } = await seed();
    await start(db);
    await go(`#/app/${acme}`);
    await waitFor(() => q("h1.detail-title"));
    await click(q("button[aria-label='More actions']")!);
    await click(byText("Delete application", "[role=menuitem]")!);
    await click(byText("Delete application", "button", q(".inline-confirm")!)!);
    await waitFor(() => q(".trash-notice"));
    expect(window.location.hash).toBe("#/");
    expect(q(".trash-notice .notice")!.textContent).toBe("Deleted Acme. It stays in Recently deleted for 30 days.");
    await waitFor(() => q("h1.page")?.textContent === "Applications");
    expect(byText("Acme", "a")).toBeNull();
    await click(byText("Restore", "button", q(".trash-notice")!)!);
    await waitFor(() => q(".trash-notice .notice")?.textContent === "Restored Acme.");
    await waitFor(() => byText("Acme", "a"));
  });
});

describe("the Restore line", () => {
  const stateOf = (db: ReturnType<typeof freshDb>, id: number) => db.applications.get(id).then((a) => (a ? (a.deletedAt ? "deleted" : "live") : "gone"));

  /** Two applications deleted together, as a bulk delete leaves them, with the line announcing it. */
  async function deletedPair() {
    const { db, acme } = await seed();
    const other = await createApplication(db, { company: "Other", companyKey: "other", role: "Analyst", roleKey: "analyst", stage: "Applied", when: "2026-10-01T09:00:00Z" });
    await deleteApplication(db, acme);
    await deleteApplication(db, other);
    announceDeleted("2 applications", [acme, other]);
    return { db, acme, other };
  }

  it("moves focus to the result once Restore has been pressed, because the button that had it is gone", async () => {
    const { db, acme } = await seed();
    await deleteApplication(db, acme);
    announceDeleted("Acme", [acme]);
    await render(h(TrashHost, { db }));
    const restore = byText("Restore", "button")!;
    restore.focus();
    await click(restore);
    await waitFor(() => q(".trash-notice .notice")?.textContent === "Restored Acme.");
    await waitFor(() => document.activeElement === q(".trash-notice .notice"));
    expect(q(".trash-restore")).toBeNull();
    expect(await stateOf(db, acme)).toBe("live");
  });

  it("holds the button while it works, like every other action", async () => {
    const { db, acme } = await seed();
    await deleteApplication(db, acme);
    announceDeleted("Acme", [acme]);
    await render(h(TrashHost, { db }));
    const restore = byText("Restore", "button") as HTMLButtonElement;
    // a synchronous click: the database answers on a later turn, so the button is still held when this returns
    act(() => { restore.click(); });
    expect(restore.disabled).toBe(true);
    expect(restore.getAttribute("aria-busy")).toBe("true");
    await waitFor(() => q(".trash-notice .notice")?.textContent === "Restored Acme.");
  });

  it("brings several applications back in one go, or none when one fails", async () => {
    const { db, acme, other } = await deletedPair();
    await render(h(TrashHost, { db }));
    const real = db.applications.update.bind(db.applications);
    let calls = 0;
    vi.spyOn(db.applications, "update").mockImplementation(((...args: Parameters<typeof real>) => {
      if (++calls === 2) throw new Error("disk full");
      return real(...args);
    }) as never);
    await click(byText("Restore", "button")!);
    await waitFor(() => q(".trash-notice .notice")?.textContent === "Couldn't finish that. Try again.");
    expect(q(".trash-notice .notice")!.classList.contains("err")).toBe(true);   // a problem is read out at once and stays
    expect(q(".trash-notice .notice")!.getAttribute("role")).toBe("alert");
    expect([await stateOf(db, acme), await stateOf(db, other)]).toEqual(["deleted", "deleted"]);
    vi.restoreAllMocks();
    dismissNotice();
    announceDeleted("2 applications", [acme, other]);
    await waitFor(() => byText("Restore", "button"));
    await click(byText("Restore", "button")!);
    await waitFor(() => q(".trash-notice .notice")?.textContent === "Restored 2 applications.");
    expect([await stateOf(db, acme), await stateOf(db, other)]).toEqual(["live", "live"]);
  });

  it("says so when everything was already restored in the meantime", async () => {
    const { db, acme } = await seed();
    await deleteApplication(db, acme);
    announceDeleted("Acme", [acme]);
    await render(h(TrashHost, { db }));
    await db.applications.update(acme, { deletedAt: undefined });
    await click(byText("Restore", "button")!);
    await waitFor(() => q(".trash-notice .notice")?.textContent === "It was already restored.");
  });

  it("is dropped when the account's shell goes away, so its Restore can't run against the next account's database", async () => {
    const { db, acme } = await seed();
    await deleteApplication(db, acme);
    announceDeleted("Acme", [acme]);
    const first = await render(h(TrashHost, { db }));
    await waitFor(() => q(".trash-notice"));
    first.unmount();
    const next = freshDb();
    await render(h(TrashHost, { db: next }));
    await settle(30);
    expect(q(".trash-notice")).toBeNull();
    expect(await next.applications.count()).toBe(0);
  });
});

