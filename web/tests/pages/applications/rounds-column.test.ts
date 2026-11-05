import { afterEach, describe, expect, it } from "vitest";
import { $, $$, addApp, addMail, cleanup, freshDb, mountPage, text, waitFor } from "./harness";
import ApplicationsPage from "../../../src/pages/applications";
import { upsertAccount } from "../../../src/db/repo";
import { setInterviewRounds } from "../../../src/sync/actions";
import { listApplications, SORT_COLUMNS } from "../../../src/sync/queries";
import { COLUMNS, DEFAULTS, loadSettings, sanitize, saveSettings } from "../../../src/sync/settings";

afterEach(cleanup);

/** Alpha has 2 interview emails on different days, Bravo has a number you typed (5), Charlie has no interviews. */
async function seed() {
  const db = freshDb();
  const account = await upsertAccount(db, "gmail", "me@gmail.com");
  const alpha = await addApp(db, "Alpha", { stage: "Interview", last: 1 });
  const bravo = await addApp(db, "Bravo", { stage: "Interview", last: 2 });
  const charlie = await addApp(db, "Charlie", { stage: "Applied", last: 3 });
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  await addMail(db, account, alpha, { event: "interview", threadId: "a1", subject: "Phone screen", body: `Let's talk on ${day(2)}.` });
  await addMail(db, account, alpha, { event: "interview", threadId: "a2", subject: "Panel", body: `Panel on ${day(5)}.` });
  await addMail(db, account, charlie, { event: "applied", threadId: "c1" });
  await setInterviewRounds(db, bravo, 5);
  return { db, alpha, bravo, charlie };
}

describe("rounds on the list rows", () => {
  it("counts from the emails, your own number, and null when there is nothing", async () => {
    const { db } = await seed();
    const rows = await listApplications(db, { sort: "company", dir: "asc" });
    expect(rows.map((r) => [r.company, r.rounds])).toEqual([["Alpha", 2], ["Bravo", 5], ["Charlie", null]]);
  });

  it("counts rounds and the interview day for the rows that survive a filter, same as unfiltered", async () => {
    const { db } = await seed();
    const all = await listApplications(db, { sort: "company", dir: "asc" });
    const interviews = await listApplications(db, { stage: "Interview", sort: "company", dir: "asc" });
    expect(interviews.map((r) => [r.company, r.rounds])).toEqual([["Alpha", 2], ["Bravo", 5]]);
    expect(interviews).toEqual(all.filter((r) => r.stage === "Interview"));
    expect(interviews[0].nextInterview).not.toBeNull();
  });

  it("counts logged interview steps too", async () => {
    const { db, charlie } = await seed();
    await db.activity.add({ applicationId: charlie, kind: "step", label: "Phone screen", body: "", occurredAt: "2026-10-01T00:00:00Z", createdAt: "2026-10-01T00:00:00Z" });
    await db.activity.add({ applicationId: charlie, kind: "step", label: "Take-home", body: "", occurredAt: "2026-10-02T00:00:00Z", createdAt: "2026-10-02T00:00:00Z" });
    await db.activity.add({ applicationId: charlie, kind: "note", label: "Interview", body: "", occurredAt: "2026-10-03T00:00:00Z", createdAt: "2026-10-03T00:00:00Z" });
    const rows = await listApplications(db);
    expect(rows.find((r) => r.company === "Charlie")?.rounds).toBe(1);
  });

  it("sorts by rounds with empty last, whichever way", async () => {
    const { db } = await seed();
    const order = async (dir: string) => (await listApplications(db, { sort: "rounds", dir })).map((r) => r.company);
    expect(await order("desc")).toEqual(["Bravo", "Alpha", "Charlie"]);
    expect(await order("asc")).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(SORT_COLUMNS).toContain("rounds");
  });
});

describe("the Rounds column setting", () => {
  it("is off by default but offered with the other columns", () => {
    expect(DEFAULTS.appearance.columns).toEqual(["company", "role", "stage", "applied", "lastActivity"]);
    expect(COLUMNS.rounds).toBe("Rounds");
    expect(Object.keys(COLUMNS)).toContain("rounds");
  });

  it("is kept when asked for, and bad ids are still dropped", async () => {
    expect(sanitize("appearance", { columns: ["rounds", "bogus"] }).columns).toEqual(["company", "stage", "rounds"]);
    const db = freshDb();
    expect((await loadSettings(db)).appearance.columns).not.toContain("rounds");
    await saveSettings(db, "appearance", { columns: ["role", "rounds"] });
    expect((await loadSettings(db)).appearance.columns).toEqual(["company", "role", "stage", "rounds"]);
  });
});

describe("the Rounds column on the page", () => {
  it("does not show until you turn it on", async () => {
    const { db } = await seed();
    const { container } = await mountPage(ApplicationsPage, db, "/");
    await waitFor(() => $(container, "tr.app-row") !== null);
    expect($(container, "th[data-col=rounds]")).toBeNull();
  });

  it("shows the number only, an empty cell for none, and sorts from its header", async () => {
    const { db } = await seed();
    await saveSettings(db, "appearance", { columns: ["role", "rounds"] });
    const { container } = await mountPage(ApplicationsPage, db, "/?sort=company&dir=asc");
    await waitFor(() => $(container, "td[data-col=rounds]") !== null);
    expect(text($(container, "th[data-col=rounds]"))).toBe("Rounds");
    expect($$(container, "td[data-col=rounds]").map((td) => td.textContent)).toEqual(["2", "5", ""]);
    expect($(container, "th[data-col=rounds] a.sort")?.getAttribute("href")).toBe("#/?sort=rounds&dir=desc");
  });

  it("shows 0 for a count you set to 0, sorts as numbers, and breaks ties by id with the empty ones last", async () => {
    const db = freshDb();
    await addApp(db, "Empty1");
    const ten = await addApp(db, "Ten");
    const zero = await addApp(db, "Zero");
    const twoB = await addApp(db, "TwoB");
    const twoA = await addApp(db, "TwoA");
    await addApp(db, "Empty2");
    for (const [id, n] of [[ten, 10], [zero, 0], [twoB, 2], [twoA, 2]] as const) await setInterviewRounds(db, id, n);
    await saveSettings(db, "appearance", { columns: ["rounds"] });
    const shown = (container: HTMLElement) => $$(container, "tr.app-row").map((r) => [text($(r, "td[data-col=company] strong")), $(r, "td[data-col=rounds]")?.textContent]);

    const asc = await mountPage(ApplicationsPage, db, "/?sort=rounds&dir=asc");
    await waitFor(() => $(asc.container, "td[data-col=rounds]") !== null);
    // 10 comes after 2 (a text sort would put it first); TwoB was saved before TwoA, so it goes first
    expect(shown(asc.container)).toEqual([["Zero", "0"], ["TwoB", "2"], ["TwoA", "2"], ["Ten", "10"], ["Empty1", ""], ["Empty2", ""]]);

    const desc = await mountPage(ApplicationsPage, db, "/?sort=rounds&dir=desc");
    await waitFor(() => $(desc.container, "td[data-col=rounds]") !== null);
    expect(shown(desc.container)).toEqual([["Ten", "10"], ["TwoB", "2"], ["TwoA", "2"], ["Zero", "0"], ["Empty1", ""], ["Empty2", ""]]);
  });

  it("sorts by rounds from the address", async () => {
    const { db } = await seed();
    await saveSettings(db, "appearance", { columns: ["rounds"] });
    const { container } = await mountPage(ApplicationsPage, db, "/?sort=rounds");
    await waitFor(() => $(container, "td[data-col=rounds]") !== null);
    expect($$(container, "td[data-col=company] strong").map((s) => s.textContent)).toEqual(["Bravo", "Alpha", "Charlie"]);
    expect($(container, "th[data-col=rounds]")?.getAttribute("aria-sort")).toBe("descending");
  });
});

// vitest blanks stylesheets on import, so read the file itself. (No @types/node here, hence the computed specifier.)
async function read(rel: string): Promise<string> {
  const fs = await import(/* @vite-ignore */ "node" + ":fs");
  return fs.readFileSync(`${(globalThis as unknown as { process: { cwd(): string } }).process.cwd()}/${rel}`, "utf8");
}

describe("the phone layout", () => {
  it("hides the Rounds column and its header with role, applied and emails", async () => {
    const css = await read("src/styles/base.css");
    expect(css).toMatch(/th\[data-col="rounds"\]/);
    expect(css).toMatch(/td\[data-col="rounds"\][^}]*display: none/);
  });
});
