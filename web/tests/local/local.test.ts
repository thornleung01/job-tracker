import "fake-indexeddb/auto";
import { createElement as h } from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import { isLocalUser, LOCAL_USER } from "../../src/app/localUser";
import { LOCAL_DB_NAME, isLocalMode, loadConfig } from "../../src/config";
import { deleteDatabase, openDatabase, type JobTrackerDB } from "../../src/db/schema";
import { hasData, loadDemoData } from "../../src/demo/loadDemo";
import { SettingsView } from "../../src/pages/settings/SettingsPage";
import type { ShellAuth } from "../../src/app/authApi";
import { ada, byText, click, cleanupRendered, closeDbs, go, fakeAuth, freshDb, q, render, settle, waitFor } from "../app/helpers";

/** An auth stand-in that fails the test the moment anything touches it. */
function untouchableAuth(): ShellAuth {
  return new Proxy({} as ShellAuth, {
    get: (_t, key) => {
      throw new Error(`auth.${String(key)} was used in a local build`);
    },
  });
}

let opened: string[] = [];
let dbs: JobTrackerDB[] = [];
const openDb = (name: string) => {
  opened.push(name);
  const db = openDatabase(name);
  dbs.push(db);
  return db;
};
const currentDb = () => dbs[dbs.length - 1];

const scripts = () => Array.from(document.querySelectorAll("script")).map((s) => s.src);

beforeEach(() => {
  opened = [];
  dbs = [];
  window.history.replaceState(null, "", "/");
  window.sessionStorage.clear();
});

afterEach(async () => {
  cleanupRendered();
  closeDbs();
  for (const db of dbs) db.close();
  await deleteDatabase(LOCAL_DB_NAME);
});

async function openLocalApp() {
  const before = scripts();
  await render(h(App, { local: true, auth: untouchableAuth(), openDb }));
  await waitFor(() => q("header.top"));
  await waitFor(() => q("h1"));
  expect(scripts()).toEqual(before);
}

describe("local mode (no client IDs)", () => {
  it("opens straight into the app on the local database without touching auth", async () => {
    await openLocalApp();
    expect(opened).toEqual([LOCAL_DB_NAME]);
    expect(q("h1")!.textContent).toBe("Applications");
    expect(document.body.textContent).not.toMatch(/Log in|Log out|Sign in|Sign out|VITE_/);
    expect(byText("Log out")).toBeNull();
  });

  it("shows a quiet one-line banner with plain copy, and dismissing it lasts for the session", async () => {
    await openLocalApp();
    const banner = q(".local-banner")!;
    expect(banner.getAttribute("role")).toBe("status");
    expect(banner.classList.contains("notice")).toBe(false);
    expect(banner.textContent).toContain("Demo mode: not logged in, data stays in this browser.");
    expect(banner.textContent!.length).toBeLessThanOrEqual(90);
    expect(banner.textContent).not.toMatch(/[–—]|VITE_|Google|Microsoft/);
    await click(byText("Dismiss")!);
    expect(q(".local-banner")).toBeNull();
    expect(window.sessionStorage.getItem("jobtracker:local-banner-dismissed")).toBe("1");
    cleanupRendered();
    await openLocalApp();
    expect(q(".local-banner")).toBeNull();
  });

  it("has no primary button in the banner, so the page keeps the only primary", async () => {
    await openLocalApp();
    const banner = q(".local-banner")!;
    const buttons = Array.from(banner.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["Load demo data", "Dismiss"]);
    for (const b of buttons) {
      expect(b.classList.contains("primary")).toBe(false);
      expect(b.getAttribute("type")).toBe("button");
    }
  });

  it("offers the load action only while the database has no applications, and drops it as soon as data exists", async () => {
    await openLocalApp();
    const banner = q(".local-banner")!;
    expect(byText("Load demo data", "button", banner)).not.toBeNull();
    await act(async () => {
      await currentDb().applications.add({ company: "Mine", companyKey: "mine", role: "Dev", roleKey: "dev", stage: "Applied", stageAt: null, appliedAt: null, lastActivity: null, locked: false, manual: true });
    });
    await waitFor(() => byText("Load demo data", "button", banner) === null);
    expect(byText("Dismiss", "button", banner)).not.toBeNull();
    await act(async () => {
      await currentDb().applications.clear();
    });
    await waitFor(() => byText("Load demo data", "button", banner));
  });

  it("loads demo data from the banner without asking when the database is empty, then shows Applications", async () => {
    await openLocalApp();
    await go("#/statistics");
    await waitFor(() => q("h1")?.textContent === "Statistics");
    expect(await hasData(currentDb())).toBe(false);
    await click(byText("Load demo data")!);
    expect(q(".inline-confirm")).toBeNull();
    await waitFor(() => q("h1")?.textContent === "Applications");
    expect(window.location.hash).toBe("#/");
    await waitFor(() => q("tr.app-row"));
    expect(await currentDb().applications.count()).toBe(39);
    expect(document.body.textContent).toContain("Tyrell");
  });

  it("never offers to replace existing data from the banner, and loading hides the action", async () => {
    await openLocalApp();
    await click(byText("Load demo data", "button", q(".local-banner")!)!);
    await waitFor(async () => (await currentDb().applications.count()) === 39);
    await waitFor(() => byText("Load demo data", "button", q(".local-banner")!) === null);
    expect(q(".inline-confirm")).toBeNull();
    expect(byText("Replace with demo data")).toBeNull();
    expect(await currentDb().applications.count()).toBe(39);
  });

  it("makes every page usable from the demo data: Applications, Statistics, People, Review", async () => {
    await openLocalApp();
    await click(byText("Load demo data")!);
    await waitFor(() => q("tr.app-row"));
    await go("#/statistics");
    await waitFor(() => q("h1")?.textContent === "Statistics");
    await waitFor(() => (q("svg") && document.querySelectorAll("table tbody tr").length > 0) || null);
    await go("#/people");
    await waitFor(() => q("h1")?.textContent === "People");
    await waitFor(() => q(".result-line"));
    expect(q(".result-line")!.textContent).toContain("12 people across 12 applications");
    await go("#/review");
    await waitFor(() => q("h1")?.textContent === "Needs review");
    await settle(100);
    expect(q("main")!.textContent).toContain("Pat Lee");
    expect(q("[role=alert]")).toBeNull();
    expect(await currentDb().emails.count()).toBe(83);   // the 80 imported plus 3 demo interview invitations (see loadDemo.ts)
  });

  it("dates the demo data relative to today so period filters still show it", async () => {
    const db = freshDb();
    const now = new Date("2030-05-01T12:00:00Z");
    await loadDemoData(db, now);
    const latest = (await db.applications.toArray()).map((a) => a.lastActivity ?? "").sort().pop()!;
    expect(latest).toBe("2030-05-01T12:00:00Z");
    const received = (await db.emails.toArray()).map((e) => e.receivedAt).sort().pop()!;
    expect(received <= "2030-05-01T12:00:00Z").toBe(true);
  });

  it("keeps the person's own look when demo data is loaded", async () => {
    const db = freshDb();
    const { saveSettings, loadSettings } = await import("../../src/sync/settings");
    await saveSettings(db, "appearance", { theme: "light", accent: "clay", density: "comfortable", corners: "soft" });
    await loadDemoData(db);
    const a = (await loadSettings(db)).appearance;
    expect([a.theme, a.accent, a.density, a.corners]).toEqual(["light", "clay", "comfortable", "soft"]);
  });

  async function openLocalSettings(section: "mail" | "appearance" | "data" = "mail") {
    await openLocalApp();
    await go(`#/settings/${section}`);
    await waitFor(() => q("h1")?.textContent === "Settings");
    await waitFor(() => q(section === "mail" ? "#accounts" : section === "appearance" ? "#appearance input[type=radio]" : "#data"));
  }

  it("keeps Appearance and Your data in Settings, replaces mail sync with one plain line, and has no sign-out", async () => {
    await openLocalSettings();
    expect(q("#sync")).toBeNull();
    expect(q("#account")).toBeNull();
    expect(q("#accounts")!.textContent).toContain("Mail sync isn't set up on this site.");
    expect(q("#accounts a")?.getAttribute("href")).toBe("#/setup");
    expect(q("#accounts a")?.textContent).toBe("Set it up");
    expect(byText("Connect Gmail")).toBeNull();
    expect(byText("Connect Outlook")).toBeNull();
    expect(byText("Log out")).toBeNull();
    expect(document.body.textContent).not.toMatch(/VITE_/);
    await go("#/settings/appearance");
    await waitFor(() => q("#h-appearance"));
    expect(q("#appearance input[type=radio]")).not.toBeNull();
    await go("#/settings/data");
    await waitFor(() => q("#h-data"));
    expect(q("#account")).toBeNull();
    for (const label of ["Export data", "Import data", "Delete all my data", "Load demo data"]) expect(byText(label)).not.toBeNull();
    expect(byText("Log out")).toBeNull();
    expect(document.body.textContent).not.toMatch(/VITE_/);
  });

  it("loads demo data and then deletes everything from Settings", async () => {
    await openLocalSettings("data");
    const banner = q(".local-banner")!;
    await click(byText("Dismiss", "button", banner)!);
    await click(byText("Load demo data", "button", q(".demo-line")!)!);
    await waitFor(() => q(".notice")?.textContent?.startsWith("Imported 39 applications and 80 emails"));
    expect(await currentDb().applications.count()).toBe(39);
    await click(byText("Delete all my data")!);
    await click(byText("Delete everything")!);
    await waitFor(() => q(".notice")?.textContent === "All your data was deleted from this device.");
    expect(await hasData(currentDb())).toBe(false);
    expect(await currentDb().applications.count()).toBe(0);
  });

  it("asks before replacing data when loading demo data from Settings", async () => {
    await openLocalSettings("data");
    await click(byText("Dismiss")!);
    await click(byText("Load demo data", "button", q(".demo-line")!)!);
    await waitFor(() => q(".notice")?.textContent?.startsWith("Imported"));
    await click(byText("Load demo data", "button", q(".demo-line")!)!);
    const confirm = await waitFor(() => q(".inline-confirm"));
    expect(confirm.textContent).toContain("Replace everything in this browser with the demo data?");
    await click(byText("Cancel", "button", confirm)!);
    expect(q(".inline-confirm")).toBeNull();
  });

  it("settings in local mode never reads the auth module", async () => {
    const db = freshDb();
    const auth = untouchableAuth() as unknown as never;
    await render(h(SettingsView, { db, user: LOCAL_USER, params: {}, query: new URLSearchParams(), navigate: () => undefined, deps: { auth } }));
    await waitFor(() => q("#accounts"));
    expect(q("#accounts")!.textContent).toContain("Mail sync isn't set up");
  });
});

describe("builds with client IDs", () => {
  it("require sign-in and never open the local database", async () => {
    const { auth, set } = fakeAuth();
    await render(h(App, { local: false, auth, openDb }));
    expect(q("h1")!.textContent).toBe("Log in");
    expect(q(".local-banner")).toBeNull();
    expect(opened).toEqual([]);
    await set({ status: "signed-in", user: ada });
    await waitFor(() => q("header.top"));
    expect(opened).toHaveLength(1);
    expect(opened[0]).toBe("jobtracker:https://accounts.google.com:111");
    expect(opened).not.toContain(LOCAL_DB_NAME);
    expect(q(".local-banner")).toBeNull();
  });

  it("cannot be switched to local mode from the URL or storage", async () => {
    window.history.replaceState(null, "", "/?local=1#/?local=1");
    window.sessionStorage.setItem("local", "1");
    window.localStorage.setItem("local", "1");
    const { auth } = fakeAuth();
    await render(h(App, { local: false, auth, openDb }));
    expect(q("h1")!.textContent).toBe("Log in");
    expect(opened).toEqual([]);
    window.localStorage.clear();
  });

  it("is decided by the build's client IDs only", () => {
    const origin = "https://example.test";
    expect(isLocalMode(loadConfig({}, origin))).toBe(true);
    expect(isLocalMode(loadConfig({ VITE_GOOGLE_CLIENT_ID: "g" }, origin))).toBe(false);
    expect(isLocalMode(loadConfig({ VITE_MS_CLIENT_ID: "m" }, origin))).toBe(false);
    expect(isLocalMode(loadConfig({ VITE_GOOGLE_CLIENT_ID: "g", VITE_MS_CLIENT_ID: "m" }, origin))).toBe(false);
    // A valid ID in the committed site-config.json also turns local mode off, an invalid one does not.
    expect(isLocalMode(loadConfig({}, origin, { googleClientId: "1-a.apps.googleusercontent.com" }))).toBe(false);
    expect(isLocalMode(loadConfig({}, origin, { googleClientId: "nope" }))).toBe(true);
  });

  it("does not take client IDs from the URL or storage", () => {
    window.history.replaceState(null, "", "/?VITE_GOOGLE_CLIENT_ID=1-a.apps.googleusercontent.com#/?VITE_MS_CLIENT_ID=0a1b2c3d-4e5f-6789-abcd-ef0123456789");
    window.localStorage.setItem("VITE_GOOGLE_CLIENT_ID", "1-a.apps.googleusercontent.com");
    expect(isLocalMode(loadConfig({}, window.location.origin))).toBe(true);
    window.localStorage.clear();
  });

  it("only a local user maps to the local database", () => {
    expect(isLocalUser(LOCAL_USER)).toBe(true);
    expect(isLocalUser(ada)).toBe(false);
  });
});
