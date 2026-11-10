import { afterEach, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { $, $$, button, cleanup, click, freshDb, mountPage, settle, text, waitFor } from "./harness";
import ApplicationsPage from "../../../src/pages/applications";
import { LOCAL_USER } from "../../../src/app/localUser";
import { dismissSetupCard, isSetupCardDismissed, skipStep } from "../../../src/sync/setupStatus";
import { render } from "../../app/helpers";

const deps = { setup: { aiState: () => "none" as const, aiLast4: () => null, lastBackupAt: () => null, backupFile: async () => null, mailAvailable: () => true } };
const page = (db: Parameters<typeof mountPage>[1]) => mountPage((p) => h(ApplicationsPage, { ...p, deps }), db);
const card = (c: HTMLElement) => $(c, ".setup-card");

afterEach(cleanup);

describe("the Finish setting up card", () => {
  it("says how far along and names the next missing step, with Continue and Dismiss", async () => {
    const { container } = await page(freshDb());
    expect(text($(container, ".setup-card-title"))).toBe("Finish setting up · 0 of 4");
    expect(text($(container, ".setup-card-next"))).toBe("Next: connect your mailbox");
    const go = $(container, ".setup-card a.btn") as HTMLAnchorElement;
    expect(text(go)).toBe("Continue");
    expect(go.getAttribute("href")).toBe("#/settings");
    expect(button(card(container) as HTMLElement, "Dismiss")).not.toBeNull();
    expect(card(container)!.getAttribute("aria-labelledby")).toBe("setup-card-title");
  });

  it("moves on to the next step when one is done by choice", async () => {
    const db = freshDb();
    await skipStep(db, "mailbox");
    const { container } = await page(db);
    expect(text($(container, ".setup-card-title"))).toBe("Finish setting up · 1 of 4");
    expect(text($(container, ".setup-card-next"))).toBe("Next: add your resume");
  });

  it("goes away on Dismiss, is stored in this database, and stays dismissed on a new visit", async () => {
    const db = freshDb();
    const first = await page(db);
    await click(button(first.container, "Dismiss"));
    expect(card(first.container)).toBeNull();
    expect(await isSetupCardDismissed(db)).toBe(true);
    await cleanup();
    const again = await page(db);
    expect(card(again.container)).toBeNull();
  });

  it("is per database: dismissing in one leaves another's card", async () => {
    const mine = freshDb();
    const other = freshDb();
    await dismissSetupCard(mine);
    expect(card((await page(mine)).container)).toBeNull();
    expect(card((await page(other)).container)).not.toBeNull();
  });

  it("no longer shows the old two mail sentences", async () => {
    const { container } = await page(freshDb());
    expect(text(container)).not.toContain("No email account connected yet");
    expect(text(container)).not.toContain("Sync your mailbox in Settings");
  });
});

describe("the empty table row", () => {
  it("points an ordinary user to finish setting up", async () => {
    const { container } = await page(freshDb());
    const cell = $(container, "td.list-empty")!;
    expect(text(cell)).toBe('No applications yet. Choose "Add application", or finish setting up to find them in your email.');
    expect(cell.querySelector("a")!.getAttribute("href")).toBe("#/settings");
  });

  it("offers the demo data as a button in the demo build, and loads it", async () => {
    const db = freshDb();
    await render(h(ApplicationsPage, { db, user: LOCAL_USER, params: {}, query: new URLSearchParams(), navigate: () => undefined, deps }));
    await settle(60);
    const cell = $(document.body, "td.list-empty")!;
    expect(text(cell)).toBe('No applications yet. Choose "Add application", or load the demo data.');
    expect(cell.querySelector("a")).toBeNull();
    const load = button(cell as HTMLElement, "load the demo data")!;
    await click(load);
    await settle(200);
    expect($$(document.body, "tr.app-row").length).toBeGreaterThan(5);
    expect(await db.applications.count()).toBeGreaterThan(5);
  });
});

describe("the owner's guide is not shown to ordinary users in the demo build", () => {
  it("has no link to #/setup on Applications, card and empty row included", async () => {
    const db = freshDb();
    await render(h(ApplicationsPage, { db, user: LOCAL_USER, params: {}, query: new URLSearchParams(), navigate: () => undefined, deps }));
    await waitFor(() => $(document.body, ".setup-card") !== null, "the card");
    expect($$(document.body, "a").filter((a) => (a.getAttribute("href") ?? "").includes("#/setup")).map((a) => a.getAttribute("href"))).toEqual([]);
    expect(text(document.body)).not.toContain("site owner");
  });
});
