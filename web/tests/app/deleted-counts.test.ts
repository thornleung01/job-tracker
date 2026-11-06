// Readers that count applications: an application in Recently deleted still holds data (it can be restored and is in every export),
// so the checks about not losing data count it, on purpose.
import "fake-indexeddb/auto";
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalBanner } from "../../src/app/LocalBanner";
import { addApp } from "../pages/applications/harness";
import { byText, cleanupRendered, closeDbs, freshDb, q, render, settle, waitFor } from "./helpers";

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  cleanupRendered();
  closeDbs();
});

const banner = () => q(".local-banner")!;
const loadDemo = () => byText("Load demo data", "button", banner());

describe("the local banner's Load demo data", () => {
  it("is offered in an empty database", async () => {
    await render(h(LocalBanner, { db: freshDb() }));
    await waitFor(() => loadDemo());
  });

  it("is not offered when the only application is in Recently deleted, because loading would replace it", async () => {
    const db = freshDb();
    await db.applications.update(await addApp(db, "Acme"), { deletedAt: "2026-11-01T10:00:00Z" });
    await render(h(LocalBanner, { db }));
    await settle(60);
    expect(banner()).not.toBeNull();
    expect(loadDemo()).toBeNull();
  });

  it("comes back once the deleted application is erased", async () => {
    const db = freshDb();
    const id = await addApp(db, "Acme");
    await db.applications.update(id, { deletedAt: "2026-11-01T10:00:00Z" });
    await render(h(LocalBanner, { db }));
    await settle(60);
    expect(loadDemo()).toBeNull();
    await db.applications.delete(id);
    await waitFor(() => loadDemo());
  });
});
