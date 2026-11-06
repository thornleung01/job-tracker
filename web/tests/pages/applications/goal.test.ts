import { afterEach, describe, expect, it } from "vitest";
import { pinClock } from "../../support/clock";
import { $, $$, addApp, button, cleanup, click, freshDb, key, mountPage, submitForm, text, type, waitFor } from "./harness";
import ApplicationsPage from "../../../src/pages/applications";
import { loadGoal, setGoal } from "../../../src/sync/goal";

afterEach(cleanup);
// Thursday 2026-11-05 at noon UTC, so "0 to 2 days ago" is this week in every zone and Monday- or Sunday-first alike, and 10 days ago never is.
pinClock();

const bar = (c: HTMLElement) => $(c, "[role=progressbar]") as HTMLElement | null;

async function seed() {
  const db = freshDb();
  await addApp(db, "Today", { applied: 0, last: 0 });
  await addApp(db, "Wednesday", { applied: 1, last: 1 });
  await addApp(db, "Tuesday", { applied: 2, last: 2 });
  await addApp(db, "Long ago", { applied: 10, last: 10 });
  await addApp(db, "No date", { applied: null, last: 3 });
  return db;
}

describe("the weekly goal", () => {
  it("shows nothing but a quiet 'Set a weekly goal' until one is set", async () => {
    const { container } = await mountPage(ApplicationsPage, await seed());
    expect(bar(container)).toBeNull();
    expect($(container, ".weekly-goal-line")).toBeNull();
    expect(button(container, "Set a weekly goal")?.classList.contains("quiet")).toBe(true);
  });

  it("sets a goal in a small inline form and shows this week's count with a progress bar", async () => {
    const db = await seed();
    const { container } = await mountPage(ApplicationsPage, db);
    await click(button(container, "Set a weekly goal"));
    const input = $(container, "input[name=weekly_goal]") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(text($(container, ".weekly-goal-form label"))).toBe("Applications per week (1 to 50)");
    await type(input, "5");
    await click(button(container, "Save goal"));
    await waitFor(() => bar(container) !== null);
    expect(text($(container, ".weekly-goal-line"))).toContain("This week: 3 of 5 applications");
    const b = bar(container)!;
    expect([b.getAttribute("aria-valuemin"), b.getAttribute("aria-valuemax"), b.getAttribute("aria-valuenow")]).toEqual(["0", "5", "3"]);
    expect(b.getAttribute("aria-valuetext")).toBe("3 of 5 applications this week");
    expect(document.getElementById(b.getAttribute("aria-labelledby")!)).not.toBeNull();
    expect(($(container, ".weekly-goal-fill") as HTMLElement).style.width).toBe("60%");
    expect(await loadGoal(db)).toBe(5);
  });

  it("uses singular for a goal of one and says when it is reached", async () => {
    const db = await seed();
    await setGoal(db, 1);
    const { container } = await mountPage(ApplicationsPage, db);
    expect(text($(container, ".weekly-goal-line"))).toContain("This week: 3 of 1 application");
    expect(text($(container, ".weekly-goal-line"))).toContain("Goal reached.");
    expect(bar(container)!.getAttribute("aria-valuenow")).toBe("1");
    expect(($(container, ".weekly-goal-fill") as HTMLElement).style.width).toBe("100%");
  });

  it("counts all applications, not just the ones the filters show", async () => {
    const db = await seed();
    await setGoal(db, 5);
    const { container } = await mountPage(ApplicationsPage, db, "/?q=long");
    expect($$(container, "tr.app-row").length).toBe(1);
    expect(text($(container, ".weekly-goal-line"))).toContain("This week: 3 of 5");
  });

  it("leaves out deleted applications", async () => {
    const db = await seed();
    await setGoal(db, 5);
    const id = (await db.applications.toArray()).find((a) => a.company === "Today")!.id;
    await db.applications.update(id, { deletedAt: new Date().toISOString() });
    const { container } = await mountPage(ApplicationsPage, db);
    expect(text($(container, ".weekly-goal-line"))).toContain("This week: 2 of 5");
  });

  it("runs Monday to Sunday: the Sunday before doesn't count, the Monday and the Sunday after do", async () => {
    const db = freshDb();
    await setGoal(db, 5);
    // picked days are stored at noon UTC and read back as the same day in every zone
    for (const [company, day] of [["Sunday before", "2026-11-01"], ["Monday", "2026-11-02"], ["Sunday after", "2026-11-08"], ["Monday after", "2026-11-09"]]) {
      const id = await addApp(db, company, { applied: 3, last: 3 });
      await db.applications.update(id, { appliedAt: `${day}T12:00:00Z` });
    }
    const { container } = await mountPage(ApplicationsPage, db);
    expect(text($(container, ".weekly-goal-line"))).toContain("This week: 2 of 5");
  });

  it("refuses a goal outside 1 to 50 with the reason", async () => {
    const db = await seed();
    const { container } = await mountPage(ApplicationsPage, db);
    await click(button(container, "Set a weekly goal"));
    await type($(container, "input[name=weekly_goal]"), "51");
    await submitForm($(container, ".weekly-goal-form"));
    expect(text($(container, "[role=alert]"))).toBe("Enter a whole number from 1 to 50.");
    expect(await loadGoal(db)).toBeNull();
    expect(bar(container)).toBeNull();
  });

  it("changes and removes the goal, and Escape closes the form", async () => {
    const db = await seed();
    await setGoal(db, 5);
    const { container } = await mountPage(ApplicationsPage, db);
    await click(button(container, "Change goal"));
    const input = $(container, "input[name=weekly_goal]") as HTMLInputElement;
    expect(input.value).toBe("5");
    await key(input, "Escape");
    expect($(container, ".weekly-goal-form")).toBeNull();
    expect(document.activeElement).toBe(button(container, "Change goal"));
    await click(button(container, "Change goal"));
    await type($(container, "input[name=weekly_goal]"), "10");
    await click(button(container, "Save goal"));
    await waitFor(() => text($(container, ".weekly-goal-line")).includes("of 10"));
    await click(button(container, "Change goal"));
    await click(button(container, "Remove goal"));
    await waitFor(() => bar(container) === null);
    expect(await loadGoal(db)).toBeNull();
    expect(button(container, "Set a weekly goal")).not.toBeNull();
  });

  it("keeps focus on the goal button after the first save, a change and a removal", async () => {
    const db = await seed();
    const { container } = await mountPage(ApplicationsPage, db);
    await click(button(container, "Set a weekly goal"));
    await type($(container, "input[name=weekly_goal]"), "5");
    await click(button(container, "Save goal"));
    await waitFor(() => bar(container) !== null);
    // the goal arrived after the form closed: focus is on the button that now says Change goal
    expect(document.activeElement).toBe(button(container, "Change goal"));
    await click(button(container, "Change goal"));
    await type($(container, "input[name=weekly_goal]"), "8");
    await click(button(container, "Save goal"));
    await waitFor(() => text($(container, ".weekly-goal-line")).includes("of 8"));
    expect(document.activeElement).toBe(button(container, "Change goal"));
    await click(button(container, "Change goal"));
    await click(button(container, "Remove goal"));
    await waitFor(() => bar(container) === null);
    expect(document.activeElement).toBe(button(container, "Set a weekly goal"));
  });

  it("is one button, not two: it keeps focus when the goal arrives or goes after the form closed", async () => {
    // In a browser the stored goal reaches the page a moment after the form closes, so focus is set while the old button shows.
    const db = await seed();
    const { container } = await mountPage(ApplicationsPage, db);
    const asButton = button(container, "Set a weekly goal") as HTMLElement;
    asButton.focus();
    await setGoal(db, 5);
    await waitFor(() => bar(container) !== null);
    expect(button(container, "Change goal")).toBe(asButton);
    expect(document.activeElement).toBe(asButton);
    await db.settings.delete("weeklyGoal");
    await waitFor(() => bar(container) === null);
    expect(button(container, "Set a weekly goal")).toBe(asButton);
    expect(document.activeElement).toBe(asButton);
  });

  it("says what happened in a status line, and the bar is named by the sentence alone", async () => {
    const db = await seed();
    const { container } = await mountPage(ApplicationsPage, db);
    const status = () => text($(container, ".weekly-goal [role=status]"));
    expect(status()).toBe("");   // already on the page, so what arrives in it is read out
    await click(button(container, "Set a weekly goal"));
    await type($(container, "input[name=weekly_goal]"), "5");
    await click(button(container, "Save goal"));
    await waitFor(() => bar(container) !== null);
    expect(status()).toBe("Weekly goal saved.");
    const name = text(document.getElementById(bar(container)!.getAttribute("aria-labelledby")!));
    expect(name).toBe("This week: 3 of 5 applications");   // not "... Change goal"
    await click(button(container, "Change goal"));
    expect(status()).toBe("");
    await click(button(container, "Remove goal"));
    await waitFor(() => bar(container) === null);
    expect(status()).toBe("Weekly goal removed.");
  });
});
