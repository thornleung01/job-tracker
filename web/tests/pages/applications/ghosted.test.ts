import { afterEach, describe, expect, it } from "vitest";
import { $, $$, addApp, button, cleanup, click, freshDb, mountPage, row, text, waitFor } from "./harness";
import ApplicationsPage from "../../../src/pages/applications";

afterEach(cleanup);

const names = (c: HTMLElement) => $$(c, "tr.app-row [data-col=company] strong").map((e) => text(e));
const cell = (c: HTMLElement, name: string) => text($(row(c, name), "[data-col=last_activity]"));

async function seed() {
  const db = freshDb();
  await addApp(db, "Nudge", { stage: "Applied", last: 29 });
  await addApp(db, "Ghost", { stage: "Applied", last: 30 });
  await addApp(db, "Old heard", { stage: "Heard back", last: 90 });
  await addApp(db, "Old interview", { stage: "Interview", last: 90 });
  await addApp(db, "Fresh", { stage: "Applied", last: 2 });
  return db;
}

describe("the No reply tag", () => {
  it("shows 'No reply in 30 days' at 30 days instead of 'Follow up?', and keeps 'Follow up?' at 29", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed());
    expect(cell(container, "Nudge")).toBe("29 days ago Follow up?");
    expect(cell(container, "Ghost")).toBe("30 days ago No reply in 30 days");
    expect(cell(container, "Old heard")).toBe("90 days ago No reply in 30 days");
    expect(cell(container, "Old interview")).toBe("90 days ago");
    expect(cell(container, "Fresh")).toBe("2 days ago");
    const tag = $(container, ".ghosted-tag")!;
    expect(tag.classList.contains("followup-tag")).toBe(false);
  });

  it("has a No reply checkbox, off by default, that filters on Apply filters and keeps ghosted=1 in the address", async () => {
    const m = await mountPage(ApplicationsPage, await seed());
    const box = $(m.container, "#f-ghosted") as HTMLInputElement;
    expect([box.type, box.checked, text($(m.container, "label[for=f-ghosted]"))]).toEqual(["checkbox", false, "No reply"]);
    await click(box);
    expect(m.visited).toEqual([]);
    await click(button(m.container, "Apply filters"));
    expect(m.location()).toBe("/?ghosted=1");
    await waitFor(() => names(m.container).length === 2);
    expect(names(m.container).sort()).toEqual(["Ghost", "Old heard"]);
    expect(text($(m.container, ".result-line"))).toContain("No reply");
    expect($(m.container, "th a.sort")!.getAttribute("href")).toContain("ghosted=1");
  });

  it("the Needs follow-up filter no longer includes ghosted rows, and both together show either", async () => {
    const follow = await mountPage(ApplicationsPage, await seed(), "/?followUp=1");
    expect(names(follow.container)).toEqual(["Nudge"]);
    await cleanup();
    const both = await mountPage(ApplicationsPage, await seed(), "/?followUp=1&ghosted=1");
    expect(names(both.container).sort()).toEqual(["Ghost", "Nudge", "Old heard"]);
  });

  it("starts filtered from the address", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed(), "/?ghosted=1");
    expect(($(container, "#f-ghosted") as HTMLInputElement).checked).toBe(true);
  });
});
