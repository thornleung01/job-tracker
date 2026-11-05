import { afterEach, describe, expect, it } from "vitest";
import { $, addApp, addMail, button, cleanup, click, daysAgo, freshDb, mountPage, submitForm, text, type, waitFor } from "../applications/harness";
import DetailPage from "../../../src/pages/detail";
import { upsertAccount } from "../../../src/db/repo";
import { importAll, exportAll } from "../../../src/portability";

afterEach(cleanup);
const open = (db: ReturnType<typeof freshDb>, id: number) => mountPage(DetailPage, db, `/app/${id}`, { id: String(id) });

async function interviewApp() {
  const db = freshDb();
  const account = await upsertAccount(db, "gmail", "me@gmail.com");
  const id = await addApp(db, "Acme", { stage: "Interview" });
  const soon = (n: number) => new Date(Date.now() + n * 86_400_000);
  const day = (n: number) => soon(n).toLocaleString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  await addMail(db, account, id, { event: "interview", threadId: "a", when: daysAgo(6), subject: "Phone screen", body: `Let's talk on ${day(-3)}.` });
  await addMail(db, account, id, { event: "interview", threadId: "b", when: daysAgo(2), subject: "Panel interview", body: `Panel on ${day(2)}.` });
  return { db, id };
}

describe("interview rounds on the application page", () => {
  it("shows the estimate from the emails and where it came from", async () => {
    const { db, id } = await interviewApp();
    const { container } = await open(db, id);
    await waitFor(() => text($(container, ".detail-rounds")).includes("Interview rounds 2"));
    expect(text($(container, ".detail-rounds"))).toContain("estimated from your emails");
  });

  it("lets you set the number, keeps it, and can go back to the estimate", async () => {
    const { db, id } = await interviewApp();
    const { container } = await open(db, id);
    await waitFor(() => $(container, ".rounds-edit") !== null);
    await click($(container, ".rounds-edit"));
    await type($(container, ".rounds-form input"), "4");
    await submitForm($(container, ".rounds-form"));
    await waitFor(() => text($(container, ".detail-rounds")).includes("Interview rounds 4"));
    expect(text($(container, ".detail-rounds"))).toContain("set by you");
    expect((await db.applications.get(id))?.interviewRounds).toBe(4);

    await click($(container, ".rounds-edit"));
    await click(button($(container, ".rounds-form")!, "Use estimate"));
    await waitFor(() => text($(container, ".detail-rounds")).includes("Interview rounds 2"));
    expect((await db.applications.get(id))?.interviewRounds).toBeUndefined();
  });

  it("refuses a number that is not a whole number from 0 to 20", async () => {
    const { db, id } = await interviewApp();
    const { container } = await open(db, id);
    await waitFor(() => $(container, ".rounds-edit") !== null);
    await click($(container, ".rounds-edit"));
    await type($(container, ".rounds-form input"), "21");
    await submitForm($(container, ".rounds-form"));
    await waitFor(() => $(container, ".rounds-error") !== null);
    expect(text($(container, ".rounds-error"))).toContain("0 to 20");
    expect((await db.applications.get(id))?.interviewRounds).toBeUndefined();
  });

  it("offers to add a count when the stage is Interview but nothing was found", async () => {
    const db = freshDb();
    const bare = await addApp(db, "Bare", { stage: "Interview" });
    const { container } = await open(db, bare);
    await waitFor(() => text($(container, ".detail-rounds")).includes("not counted yet"));
    expect(text($(container, ".rounds-edit"))).toBe("Add rounds");
  });

  it("stays out of the way on an application that isn't at the interview stage", async () => {
    const db = freshDb();
    const plain = await addApp(db, "Plain", { stage: "Applied" });
    const { container } = await open(db, plain);
    await waitFor(() => $(container, ".detail-facts") !== null);
    expect($(container, ".detail-rounds")).toBeNull();
  });

  it("survives an export and import, and drops a count that is out of range", async () => {
    const { db, id } = await interviewApp();
    await db.applications.update(id, { interviewRounds: 3 });
    const copy = JSON.parse(JSON.stringify(await exportAll(db)));
    const fresh = freshDb();
    await importAll(fresh, JSON.stringify(copy));
    expect((await fresh.applications.get(id))?.interviewRounds).toBe(3);
    copy.data.applications[0].interviewRounds = 99;
    const other = freshDb();
    await importAll(other, JSON.stringify(copy));
    expect((await other.applications.get(id))?.interviewRounds).toBeUndefined();
  });
});
