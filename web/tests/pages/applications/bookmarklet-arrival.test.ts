import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $, button, cleanup, click, freshDb, mountPage, seedThree, settle, text, type, waitFor } from "./harness";
import { draft, field, openForm, result, withFakes } from "./paste-helpers";
import ApplicationsPage from "../../../src/pages/applications";

afterEach(cleanup);
beforeEach(() => {
  window.confirm = vi.fn(() => true);
});

describe("arriving from the Save to Job Tracker bookmarklet", () => {
  const arrival = draft({ company: "Acme", role: "Engineer", location: "Toronto", url: "https://jobs.acme.example/1", source: "bookmarklet", guessed: { role: true } });
  const to = "/?add=1&c=Acme&r=Engineer&l=Toronto&u=https%3A%2F%2Fjobs.acme.example%2F1&s=bm&g=2&stage=Applied";

  it("opens the filled form, focuses Save, never saves, and takes the parameters out of the address", async () => {
    const db = freshDb();
    await seedThree(db);
    const { Page, deps } = withFakes({ draftFromHash: vi.fn((_q: URLSearchParams) => arrival) });
    const { container, visited, location } = await mountPage(Page, db, to);
    await waitFor(() => $(container, "#add-application") !== null);
    expect(deps.draftFromHash).toHaveBeenCalledTimes(1);
    expect(deps.draftFromHash.mock.calls[0][0].get("add")).toBe("1");
    expect([field(container, "add-company").value, field(container, "add-role").value, field(container, "add-url").value]).toEqual(["Acme", "Engineer", "https://jobs.acme.example/1"]);
    expect(text($(container, "#add-role-hint"))).toBe("Guessed from the page");
    expect($(container, "#add-company-hint")).toBeNull();
    expect(result(container)).toBe("Filled in from the page you were viewing. Check it, then save. Location: Toronto.");
    expect(button(container, "Add application")!.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(button(container, "Save application"));
    expect(location()).toBe("/?stage=Applied");
    expect(visited).toEqual(["/?stage=Applied"]);
    await settle();
    expect(await db.applications.count()).toBe(3);
  });

  it("focuses Company when the page gave no role", async () => {
    const db = freshDb();
    const { Page } = withFakes({ draftFromHash: vi.fn((_q: URLSearchParams) => draft({ ...arrival, role: "", guessed: { company: false, role: false } })) });
    const { container } = await mountPage(Page, db, to);
    await waitFor(() => $(container, "#add-application") !== null);
    expect(document.activeElement).toBe(field(container, "add-company"));
  });

  it("saves only when you press Save, with the link", async () => {
    const db = freshDb();
    const { Page } = withFakes({ draftFromHash: vi.fn((_q: URLSearchParams) => arrival) });
    const { container } = await mountPage(Page, db, to);
    await waitFor(() => $(container, "#add-application") !== null);
    expect(await db.applications.count()).toBe(0);
    await click(button(container, "Save application"));
    await waitFor(() => !$(container, "#add-application"));
    const [saved] = await db.applications.toArray();
    expect([saved.company, saved.role, saved.postingUrl]).toEqual(["Acme", "Engineer", "https://jobs.acme.example/1"]);
  });

  it("shows hostile bookmarklet values as plain text", async () => {
    const db = freshDb();
    const evil = draft({ ...arrival, company: "<img src=x onerror=alert(1)>", location: "<b>x</b>" });
    const { Page } = withFakes({ draftFromHash: vi.fn((_q: URLSearchParams) => evil) });
    const { container } = await mountPage(Page, db, to);
    await waitFor(() => $(container, "#add-application") !== null);
    expect(field(container, "add-company").value).toBe("<img src=x onerror=alert(1)>");
    expect($(container, "#add-application img, #add-application b")).toBeNull();
    expect(result(container)).toContain("<b>x</b>");
  });

  it("opens nothing for an invalid hash, but still clears the parameters", async () => {
    const db = freshDb();
    const { Page } = withFakes();
    const { container, location } = await mountPage(Page, db, "/?add=1&c=&stage=Applied");
    await settle();
    expect($(container, "#add-application")).toBeNull();
    expect(location()).toBe("/?stage=Applied");
  });
});

describe("with the real job-link library", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads a Greenhouse link offline, keeps it when the board cannot be reached, and saves with the link", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    const db = freshDb();
    const { container } = await mountPage(ApplicationsPage, db);
    await openForm(container);
    await type(field(container, "add-link"), "https://boards.greenhouse.io/stripe/jobs/12345?gh_src=abc");
    await click(button(container, "Fill in details"));
    await waitFor(() => field(container, "add-company").value !== "");
    await waitFor(() => $(container, "#add-link-checking")?.textContent === "");
    expect(field(container, "add-company").value.toLowerCase()).toContain("stripe");
    expect(field(container, "add-url").value).toMatch(/^https:\/\/boards\.greenhouse\.io\/stripe\/jobs\/12345/);
    expect(field(container, "add-url").value).not.toContain("gh_src");
    expect(result(container)).not.toBe("");
    await click(button(container, "Save application"));
    await waitFor(() => !$(container, "#add-application"));
    const [saved] = await db.applications.toArray();
    expect(saved.postingUrl).toMatch(/^https:\/\/boards\.greenhouse\.io\/stripe\/jobs\/12345/);
  });

  it("says it could not read a LinkedIn link and leaves the form empty", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    const db = freshDb();
    const { container } = await mountPage(ApplicationsPage, db);
    await openForm(container);
    await type(field(container, "add-link"), "https://www.linkedin.com/jobs/view/3912345678/");
    await click(button(container, "Fill in details"));
    expect(result(container)).toBe("We couldn't read details from this link. Add them below.");
    expect(field(container, "add-company").value).toBe("");
  });

  it("opens a filled form from a real bookmarklet hash and never saves", async () => {
    const db = freshDb();
    const { container, location } = await mountPage(ApplicationsPage, db, "/?add=1&c=Acme&r=Engineer&l=Toronto&u=https%3A%2F%2Fjobs.acme.example%2F1&s=bm&g=2");
    await waitFor(() => $(container, "#add-application") !== null);
    expect([field(container, "add-company").value, field(container, "add-role").value, field(container, "add-url").value]).toEqual(["Acme", "Engineer", "https://jobs.acme.example/1"]);
    expect(text($(container, "#add-role-hint"))).toBe("Guessed from the page");
    expect(result(container)).toBe("Filled in from the page you were viewing. Check it, then save. Location: Toronto.");
    expect(location()).toBe("/");
    expect(await db.applications.count()).toBe(0);
  });

  it("reads pasted text with the real parser", async () => {
    const db = freshDb();
    const { container } = await mountPage(ApplicationsPage, db);
    await openForm(container);
    await click(button(container, "Or paste the job text instead"));
    await type($(container, "#add-paste"), "Senior Data Analyst\nNorthwind Traders\nToronto, ON\nWe are hiring a Senior Data Analyst to join our team.");
    await click(button(container, "Read the text"));
    expect(result(container)).not.toBe("");
    expect(result(container)).not.toContain("Paste the posting text first");
  });
});
