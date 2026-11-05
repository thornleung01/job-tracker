import { afterEach, describe, expect, it } from "vitest";
import { $, $$, addApp, cleanup, click, freshDb, mountPage, text, waitFor } from "./harness";
import ApplicationsPage from "../../../src/pages/applications";

afterEach(cleanup);

const row = (container: HTMLElement, company: string) =>
  [...container.querySelectorAll("tr.app-row")].find((r) => text(r).includes(company)) as HTMLElement;
const names = (container: HTMLElement) => $$(container, "tr.app-row [data-col=company] strong").map((e) => text(e));

async function seed() {
  const db = freshDb();
  await addApp(db, "Quiet", { stage: "Applied", last: 8 });
  await addApp(db, "Fresh", { stage: "Applied", last: 6 });
  await addApp(db, "Waiting", { stage: "Heard back", last: 12 });
  await addApp(db, "Busy", { stage: "Interview", last: 30 });
  await addApp(db, "Closed", { stage: "Rejected", last: 30 });
  return db;
}

describe("follow-up nudges in the list", () => {
  it("tags only the rows that need one, in the last-activity cell", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed());
    const tagged = $$(container, "tr.app-row").filter((r) => $(r, ".followup-tag")).map((r) => text($(r, "[data-col=company] strong")));
    expect(tagged.sort()).toEqual(["Quiet", "Waiting"]);
    const cell = $(row(container, "Quiet"), "[data-col=last_activity]")!;
    expect(text(cell)).toBe("8 days ago Follow up?");
    expect(text($(row(container, "Fresh"), "[data-col=last_activity]"))).toBe("6 days ago");
  });

  it("has a checkbox with a real label, off by default", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed());
    const box = $(container, "#f-followup") as HTMLInputElement;
    expect(box.type).toBe("checkbox");
    expect(box.checked).toBe(false);
    expect(text($(container, "label[for=f-followup]"))).toBe("Needs follow-up");
    expect(names(container).length).toBe(5);
  });

  it("filters on Apply filters and puts followUp=1 in the address", async () => {
    const m = await mountPage(ApplicationsPage, await seed());
    await click($(m.container, "#f-followup"));
    expect(m.visited).toEqual([]);
    await click($$(m.container, "button").find((b) => text(b) === "Apply filters")!);
    expect(m.location()).toBe("/?followUp=1");
    await waitFor(() => names(m.container).length === 2);
    expect(names(m.container).sort()).toEqual(["Quiet", "Waiting"]);
    expect(text($(m.container, ".result-line"))).toContain("Showing 2 of 5 applications");
    expect(text($(m.container, ".result-line"))).toContain("Needs follow-up");
    expect(($(m.container, "#f-followup") as HTMLInputElement).checked).toBe(true);
  });

  it("starts filtered from the address, so a reload lands on the same view", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed(), "/?followUp=1");
    expect(names(container).sort()).toEqual(["Quiet", "Waiting"]);
    expect(($(container, "#f-followup") as HTMLInputElement).checked).toBe(true);
  });

  it("keeps the stage tabs counting every application, and narrows within a stage", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed(), "/?followUp=1&stage=Applied");
    expect(text($(container, "#count-Applied"))).toBe("2");
    expect(text($(container, "#count-Heard\\ back"))).toBe("1");
    expect(text($(container, "#count-Interview"))).toBe("1");
    expect(names(container)).toEqual(["Quiet"]);
  });

  it("keeps the filter when you sort or open a row", async () => {
    const m = await mountPage(ApplicationsPage, await seed(), "/?followUp=1");
    expect($(m.container, "th a.sort")!.getAttribute("href")).toContain("followUp=1");
    await click($(row(m.container, "Quiet"), "a.expander"));
    expect(m.location()).toContain("followUp=1");
    expect(m.location()).toContain("open=");
  });

  it("says nothing matches, and Clear filters brings everything back", async () => {
    const db = freshDb();
    await addApp(db, "Fresh", { stage: "Applied", last: 2 });
    const { container } = await mountPage(ApplicationsPage, db, "/?followUp=1");
    expect(text($(container, "td.list-empty"))).toBe("No applications match these filters.");
    const clear = $$(container, ".result-line a").at(-1)!;
    expect(text(clear)).toBe("Clear filters");
    expect(clear.getAttribute("href")).toBe("#/");
  });

  it("ignores a follow-up value that is not 1", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed(), "/?followUp=yes");
    expect(names(container).length).toBe(5);
    expect(($(container, "#f-followup") as HTMLInputElement).checked).toBe(false);
  });
});
