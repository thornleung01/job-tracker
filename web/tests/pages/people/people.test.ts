import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $, $$, addApp, addMail, button, cleanup, click, freshDb, mountPage, text, type, waitFor } from "../applications/harness";
import PeoplePage from "../../../src/pages/people";
import { upsertAccount } from "../../../src/db/repo";

afterEach(cleanup);
beforeEach(() => {
  window.confirm = vi.fn(() => true);
});

async function setup() {
  const db = freshDb();
  const account = await upsertAccount(db, "gmail", "me@gmail.com");
  const deel = await addApp(db, "Deel", { role: "Manager" });
  const door = await addApp(db, "DoorDash", { role: "Unknown role" });
  await addMail(db, account, door, { sender: "Jocelyn Ford <jocelyn.ford@doordash.com>", body: "Jocelyn Ford Senior Business Recruiter DoorDash", subject: "Intro", when: new Date(Date.now() - 5 * 86_400_000) });
  await addMail(db, account, deel, { sender: "Samuel Okafor <sam.okafor@deel.com>", body: "Sam Senior Talent Acquisition Specialist @ Deel 650 2nd Street", subject: "Next steps", when: new Date(Date.now() - 86_400_000) });
  await addMail(db, account, deel, { sender: "Nadia Cruz <nadia@deel.com>", body: "Hi Jordan, I'm Nadia, from the People OPS team. Just reaching out.", subject: "Hello", when: new Date(Date.now() - 3 * 86_400_000) });
  return { db, account, deel, door };
}
const names = (c: HTMLElement) => $$(c, "details.company").map((d) => text($(d, ".company-name")));

describe("the People page", () => {
  it("groups people under their application, the one you spoke to last first", async () => {
    const { db } = await setup();
    const { container } = await mountPage(PeoplePage, db, "/people");
    expect(text($(container, "h1.page"))).toBe("People");
    expect(names(container)).toEqual(["Deel", "DoorDash"]);
    expect(text($(container, ".result-line"))).toBe("3 people across 2 applications");
    const deel = $$(container, "details.company")[0];
    expect(text($(deel, "summary .company-count"))).toBe("2 people");
    expect(text($(deel, ".company-role"))).toBe("Manager");
    expect($$(container, "details.company")[1].querySelector(".company-role")).toBeNull();   // "Unknown role" is not shown
    expect($$(deel, "ul.people > li")).toHaveLength(2);
    expect(text($(deel, ".person-title"))).toBe("Senior Talent Acquisition Specialist");
    expect(text($(deel, "p a"))).toBe("Open this application");
    expect(deel.querySelector("p a")?.getAttribute("href")).toMatch(/^#\/app\/\d+$/);
  });

  it("makes every company a dropdown, closed with several and open with one", async () => {
    const { db } = await setup();
    const many = await mountPage(PeoplePage, db, "/people");
    expect($$(many.container, "details.company").map((d) => (d as HTMLDetailsElement).open)).toEqual([false, false]);
    expect($$(many.container, "details.company > summary.disclosure .chev")).toHaveLength(2);
    const one = await mountPage(PeoplePage, db, "/people?q=jocelyn");
    const last = $$(one.container, "details.company").at(-1) as HTMLDetailsElement;
    expect(last.open).toBe(true);
    expect(text($(last, ".company-name"))).toBe("DoorDash");
  });

  it("expands and collapses them all", async () => {
    const { db } = await setup();
    const { container } = await mountPage(PeoplePage, db, "/people");
    const open = () => $$(container, "details.company").map((d) => (d as HTMLDetailsElement).open);
    await click(button(container, "Expand all"));
    expect(open()).toEqual([true, true]);
    await click(button(container, "Collapse all"));
    expect(open()).toEqual([false, false]);
  });

  it("has no fold buttons with only one company", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const app = await addApp(db, "Solo");
    await addMail(db, account, app, { sender: "Pat Lee <pat@solo.com>", body: "Pat Lee Senior Recruiter" });
    const { container } = await mountPage(PeoplePage, db, "/people");
    expect(button(container, "Expand all")).toBeNull();
    expect(text($(container, ".result-line"))).toBe("1 person across 1 application");
    expect((container.querySelector("details.company") as HTMLDetailsElement).open).toBe(true);
  });

  it("searches names, titles, companies and roles through the address", async () => {
    const { db } = await setup();
    const m = await mountPage(PeoplePage, db, "/people");
    await type($(m.container, "#c-q"), "recruiter");
    await click(button(m.container, "Search"));
    expect(m.visited.at(-1)).toBe("/people?q=recruiter");
    expect(names(m.container)).toEqual(["DoorDash"]);
    expect(text($(m.container, ".result-line"))).toBe("1 of 3 people across 1 application");
    expect(text($(m.container, "a.clear-search"))).toBe("Clear");
    const byCompany = await mountPage(PeoplePage, db, "/people?q=DEEL");
    expect(names(byCompany.container)).toEqual(["Deel"]);
    const none = await mountPage(PeoplePage, db, "/people?q=zzz");
    expect(text(none.container)).toContain('Nobody matches "zzz".');
  });

  it("tells you when there is nobody yet", async () => {
    const { container } = await mountPage(PeoplePage, freshDb(), "/people");
    expect(text(container)).toContain("No people yet.");
    expect(text($(container, ".result-line"))).toBe("0 people across 0 applications");
  });

  it("shows the person with their kind, title, address, last contact and actions", async () => {
    const { db } = await setup();
    const { container } = await mountPage(PeoplePage, db, "/people?q=jocelyn");
    const person = $(container, ".person")!;
    expect(text($(person, ".person-head strong"))).toBe("Jocelyn Ford");
    expect(text($(person, ".tag"))).toBe("Recruiter");
    expect(text($(person, ".person-meta"))).toMatch(/^jocelyn\.ford@doordash\.com · last .* 5 days ago$/);
    const email = $(person, "a.btn.primary")!;
    expect(text(email)).toBe("Email Jocelyn");
    expect([email.getAttribute("target"), email.getAttribute("rel")]).toEqual(["_blank", "noopener noreferrer"]);
    expect(email.getAttribute("href")).toContain("to=jocelyn.ford%40doordash.com");
    const emails = $(person, "details.action")!;
    expect(text($(emails, "summary"))).toBe("1 email");
    expect(text($(emails, "ul.thread li"))).toContain("Intro");
    expect($(emails, "ul.thread a")?.getAttribute("href")).toMatch(/^#\/app\/\d+\?email=\d+$/);
    expect($$(person, "details.action > summary").map(text)).toEqual(["1 email", "Edit"]);
  });

  it("saves an edit and says so", async () => {
    const { db } = await setup();
    const { container } = await mountPage(PeoplePage, db, "/people?q=jocelyn");
    await type($(container, "input[name=name]"), "Jo Ford");
    await type($(container, "input[name=title]"), "Hiring manager");
    await click(button($(container, ".person")!, "Save"));
    await waitFor(() => text($(container, ".person-head strong")) === "Jo Ford");
    expect(text($(container, ".person-title"))).toBe("Hiring manager");
    expect($$(container, ".person .tag").map(text)).toEqual(["Hiring side", "Edited by you"]);
    expect(text($(container, ".notice"))).toBe("Saved.");
    expect((await db.contactEdits.toArray())[0]).toMatchObject({ name: "Jo Ford", title: "Hiring manager", hidden: false });
  });

  it("removes someone who is not a person, after you confirm", async () => {
    const { db } = await setup();
    const { container } = await mountPage(PeoplePage, db, "/people?q=jocelyn");
    await click(button($(container, ".person")!, "Not a person"));
    expect(window.confirm).toHaveBeenCalledWith("Remove Jocelyn Ford from this application?");
    await waitFor(() => !$(container, ".person"));
    expect(text($(container, ".notice"))).toContain("Removed from this application.");
    expect((await db.contactEdits.toArray())[0].hidden).toBe(true);
  });

  it("draws a hostile name and title as text", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const app = await addApp(db, "<script>alert(1)</script>");
    await addMail(db, account, app, { sender: "Pat Lee <pat@acme.com>", subject: "<script>alert(2)</script>", body: "Pat Lee Senior Recruiter" });
    const { container } = await mountPage(PeoplePage, db, "/people");
    expect($(container, "script")).toBeNull();
    expect(text($(container, ".company-name"))).toBe("<script>alert(1)</script>");
    expect(text($(container, "ul.thread a"))).toBe("<script>alert(2)</script>");
  });
});
