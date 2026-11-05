import "fake-indexeddb/auto";
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import { readLookHint } from "../../src/app/appearance";
import { LOCAL_DB_NAME } from "../../src/config";
import { deleteDatabase, openDatabase } from "../../src/db/schema";
import { saveSettings } from "../../src/sync/settings";
import { cleanupRendered, closeDbs, freshDb, q, render, waitFor } from "./helpers";

const KEY = `jobtracker:look:${LOCAL_DB_NAME}`;
const root = () => document.documentElement;

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  localStorage.clear();
  root().removeAttribute("style");
  for (const a of ["data-theme", "data-density", "data-corners", "data-accent"]) root().removeAttribute(a);
});
afterEach(() => {
  cleanupRendered();
  closeDbs();
});

describe("the saved look before the database opens", () => {
  it("applies the remembered look before the database is opened, so a dark theme never flashes light", async () => {
    localStorage.setItem(KEY, JSON.stringify({ theme: "dark", density: "compact", corners: "sharp", accent: "forest" }));
    const db = freshDb();
    const seenWhenOpened: (string | null)[] = [];
    await render(h(App, { local: true, openDb: () => { seenWhenOpened.push(root().getAttribute("data-theme")); return db; } }));
    expect(seenWhenOpened[0]).toBe("dark");   // set in a layout effect, before the effect that opens the database
    expect([root().getAttribute("data-density"), root().getAttribute("data-corners"), root().getAttribute("data-accent")]).toEqual(["compact", "sharp", "forest"]);
    expect(root().style.getPropertyValue("--accent-l")).toBe("#2f5d46");
  });

  it("remembers the saved look for next time, and the database stays the source of truth", async () => {
    const db = openDatabase(LOCAL_DB_NAME);   // the hint is kept per database name, as the app names it
    await saveSettings(db, "appearance", { theme: "light", density: "compact", corners: "soft", accent: "clay" });
    localStorage.setItem(KEY, JSON.stringify({ theme: "dark", density: "comfortable", corners: "soft", accent: "graphite" }));   // out of date
    await render(h(App, { local: true, openDb: () => db }));
    await waitFor(() => q("header.top") && root().getAttribute("data-theme") === "light");
    expect(readLookHint(LOCAL_DB_NAME)).toMatchObject({ theme: "light", density: "compact", accent: "clay" });
    cleanupRendered();
    db.close();
    await deleteDatabase(LOCAL_DB_NAME);
  });

  it("ignores a hint it can't read, and one for another database", async () => {
    localStorage.setItem(KEY, "{not json");
    expect(readLookHint(LOCAL_DB_NAME)).toBeNull();
    localStorage.setItem("jobtracker:look:someone-else", JSON.stringify({ theme: "dark" }));
    const db = freshDb();
    await render(h(App, { local: true, openDb: () => db }));
    await waitFor(() => q("header.top"));
    expect(root().getAttribute("data-theme")).toBeNull();
  });

  it("only takes known values from the hint", async () => {
    localStorage.setItem(KEY, JSON.stringify({ theme: "<script>", density: "huge", corners: 7, accent: "neon" }));
    expect(readLookHint(LOCAL_DB_NAME)).toMatchObject({ theme: "system", density: "comfortable", corners: "soft", accent: "graphite" });
  });
});
