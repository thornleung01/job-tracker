import { afterEach, describe, expect, it, vi } from "vitest";
import { $, $$, button, cleanup, click, freshDb, mountPage, text, type, waitFor } from "./harness";
import { deferred, draft, openForm, withFakes } from "./paste-helpers";
import { addApplication } from "../../../src/sync/actions";
import type { JobDraft } from "../../../src/jobs/types";

afterEach(cleanup);

const GUESS = { company: true, role: true };
/** "https://jobs.example/<company>/<role>" reads as that company and role. Anything else can't be read. */
const read = (raw: string): JobDraft | null => {
  const m = /^https:\/\/jobs\.example\/([a-z]+)\/([a-z-]+)/.exec(raw);
  return m ? draft({ company: m[1][0].toUpperCase() + m[1].slice(1), role: m[2].replace(/-/g, " "), url: raw, guessed: GUESS }) : null;
};
const box = (c: HTMLElement) => $(c, "textarea[name=job_links]") as HTMLTextAreaElement;
const status = (c: HTMLElement) => text($(c, ".bulk-add-progress"));
const lines = (c: HTMLElement) => $$(c, ".bulk-add-results li").map((li) => text(li));

async function open(deps: Parameters<typeof withFakes>[0] = {}) {
  const db = freshDb();
  const { Page, deps: fakes } = withFakes({ parseJobUrl: vi.fn(read), ...deps });
  const m = await mountPage(Page, db);
  await openForm(m.container);
  return { ...m, db, fakes };
}

describe("add several links", () => {
  it("is a quiet disclosure in the add form, closed at first", async () => {
    const { container } = await open();
    const toggle = button(container, "Add several links")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(box(container)).toBeNull();
    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(text($(container, ".bulk-add-box label"))).toBe("Job links, one on each line (up to 10)");
  });

  it("adds each link as an application and reports every line, skipping what is saved and naming what can't be read", async () => {
    const { container, db } = await open();
    await addApplication(db, { company: "Beta", role: "designer" });
    await click(button(container, "Add several links"));
    await type(box(container), [
      "https://jobs.example/acme/data-analyst", "https://jobs.example/beta/designer", "https://jobs.example/cora/writer", "https://jobs.example/dana/pilot",
      "https://jobs.example/eve/chef", "https://nowhere.example/x",
    ].join("\n"));
    await click(button(container, "Add these"));
    await waitFor(() => lines(container).length === 6);
    expect(status(container)).toBe("Added 4. Skipped 1 already saved. 1 couldn't be read: https://nowhere.example/x.");
    expect(lines(container)[0]).toContain("Added Acme, data analyst.");
    expect(lines(container)[0]).toContain("The company and role are a guess from the link. Check them.");
    expect(lines(container)[1]).toContain("Skipped. Already saved as Beta, designer.");
    expect(lines(container)[5]).toContain("Couldn't be read.");
    expect((await db.applications.toArray()).map((a) => a.company).sort()).toEqual(["Acme", "Beta", "Cora", "Dana", "Eve"]);
    // what was added leaves the box, and only the link that couldn't be read stays to fix
    expect(box(container).value).toBe("https://nowhere.example/x");
  });

  it("reads each link with the page's job-link library: offline first, then the board", async () => {
    const enrich = vi.fn(async (d: JobDraft) => ({ ...d, company: "Acme Corporation", guessed: { company: false, role: true } }));
    const { container, db, fakes } = await open({ enrichJobDraft: enrich });
    await click(button(container, "Add several links"));
    await type(box(container), "https://jobs.example/acme/data-analyst");
    await click(button(container, "Add these"));
    await waitFor(() => lines(container).length === 1);
    expect(fakes.parseJobUrl).toHaveBeenCalledWith("https://jobs.example/acme/data-analyst");
    expect(enrich).toHaveBeenCalledTimes(1);
    expect((await db.applications.toArray())[0].company).toBe("Acme Corporation");
    expect(lines(container)[0]).toContain("The role is a guess from the link. Check it.");
  });

  it("refuses more than 10 links, and an empty box, before anything runs", async () => {
    const { container, db, fakes } = await open();
    await click(button(container, "Add several links"));
    await click(button(container, "Add these"));
    expect(text($(container, ".bulk-add-box [role=alert]"))).toBe("Paste at least one link, one on each line.");
    await type(box(container), Array.from({ length: 11 }, (_, i) => `https://jobs.example/co${"abcdefghijk"[i]}/x`).join("\n"));
    await click(button(container, "Add these"));
    expect(text($(container, ".bulk-add-box [role=alert]"))).toBe("Add up to 10 links at a time. You pasted 11.");
    expect(fakes.parseJobUrl).not.toHaveBeenCalled();
    expect(await db.applications.count()).toBe(0);
  });

  it("never blocks the page: it shows progress, the rest of the form still works, and Stop ends it", async () => {
    const hold = deferred<JobDraft>();
    const enrich = vi.fn((d: JobDraft, o?: { signal?: AbortSignal }) => new Promise<JobDraft>((resolve) => {
      o?.signal?.addEventListener("abort", () => resolve(d));
      void hold.promise.then(resolve);
    }));
    const { container, db } = await open({ enrichJobDraft: enrich });
    await click(button(container, "Add several links"));
    await type(box(container), ["https://jobs.example/acme/a", "https://jobs.example/beta/b", "https://jobs.example/cora/c"].join("\n"));
    await click(button(container, "Add these"));
    expect(status(container)).toBe("Adding 0 of 3");
    expect(box(container).disabled).toBe(true);
    expect((button(container, "Add these") as HTMLButtonElement).disabled).toBe(true);
    expect(enrich).toHaveBeenCalledTimes(2);   // two at a time
    // the single-add form beside it is still usable
    await type($(container, "#add-company"), "Typed Co");
    expect(($(container, "#add-company") as HTMLInputElement).value).toBe("Typed Co");
    await click(button(container, "Stop"));
    await waitFor(() => lines(container).length === 3);
    expect(status(container)).toBe("Stopped before 3 links.");
    expect(lines(container).every((l) => l.includes("Not added"))).toBe(true);
    expect(await db.applications.count()).toBe(0);
    expect(box(container).disabled).toBe(false);
    expect(box(container).value.split("\n")).toHaveLength(3);
  });

  it("shows link text as text, never as markup or a link", async () => {
    const { container } = await open();
    await click(button(container, "Add several links"));
    await type(box(container), "https://jobs.example/<img src=x onerror=alert(1)>");
    await click(button(container, "Add these"));
    await waitFor(() => lines(container).length === 1);
    expect($(container, ".bulk-add-results img")).toBeNull();
    expect($(container, ".bulk-add-results a")).toBeNull();
    expect(lines(container)[0]).toContain("<img src=x onerror=alert(1)>");
  });

  it("announces progress and the result in a live region", async () => {
    const { container } = await open();
    await click(button(container, "Add several links"));
    expect($(container, ".bulk-add-progress")!.getAttribute("role")).toBe("status");
    expect(box(container).getAttribute("aria-describedby")).toBe($(container, ".bulk-add-progress")!.id);
  });
});
