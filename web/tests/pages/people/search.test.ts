import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { $, $$, addApp, addMail, cleanup, freshDb, key, mountPage, submitForm, text, type } from "../applications/harness";
import PeoplePage from "../../../src/pages/people";
import { upsertAccount } from "../../../src/db/repo";
import { peopleSuggestions } from "../../../src/sync/contacts";

afterEach(cleanup);

async function seed() {
  const db = freshDb();
  const account = await upsertAccount(db, "gmail", "me@gmail.com");
  const deel = await addApp(db, "Deel", { role: "Manager" });
  const door = await addApp(db, "DoorDash", { role: "Unknown role" });
  await addMail(db, account, door, { sender: "Jocelyn Ford <jocelyn.ford@doordash.com>", body: "Jocelyn Ford Senior Business Recruiter DoorDash", subject: "Intro", when: new Date(Date.now() - 5 * 86_400_000) });
  await addMail(db, account, deel, { sender: "Samuel Okafor <sam.okafor@deel.com>", body: "Sam Senior Talent Acquisition Specialist @ Deel 650 2nd Street", subject: "Next steps", when: new Date(Date.now() - 86_400_000) });
  await addMail(db, account, deel, { sender: "Nadia Cruz <nadia@deel.com>", body: "Hi Jordan, I'm Nadia, from the People OPS team. Just reaching out.", subject: "Hello", when: new Date(Date.now() - 3 * 86_400_000) });
  return db;
}

async function mount(to = "/people") {
  const m = await mountPage(PeoplePage, await seed(), to);
  return { ...m, input: $(m.container, "#c-q") as HTMLInputElement, list: $(m.container, "#c-q-list") as HTMLElement };
}

describe("People search suggestions", () => {
  it("is a labelled combobox with the same placeholder, closed until you focus it", async () => {
    const { container, input, list } = await mount();
    expect(text($(container, "label[for=c-q]"))).toBe("Search");
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-controls")).toBe("c-q-list");
    expect(input.placeholder).toBe("Name, title, company or role");
    expect(list.hidden).toBe(true);
    expect($(container, "form.people-search button[type=submit]")).toBeNull();
  });

  it("lists people, companies, roles and titles, with counts and companies", async () => {
    const { input, list } = await mount();
    await act(async () => input.focus());
    expect(list.hidden).toBe(false);
    expect($$(list, ".combo-group").map(text)).toEqual(["People", "Companies", "Roles", "Titles"]);
    const options = $$(list, "[role=option]").map((o) => o.getAttribute("aria-label"));
    expect(options).toContain("Samuel Okafor, person, Deel");
    expect(options).toContain("Deel, company, 2 people");
    expect(options).toContain("DoorDash, company, 1 person");
    expect(options).toContain("Manager, role, 2 people");
    expect(options.some((o) => o?.startsWith("Senior Business Recruiter, title, 1 person"))).toBe(true);
    expect(options.some((o) => o?.startsWith("Unknown role"))).toBe(false);
  });

  it("filters as you type and moves with the arrow keys", async () => {
    const { input, list } = await mount();
    await act(async () => input.focus());
    await type(input, "jo");
    expect($$(list, ".combo-group").map(text)).toEqual(["People"]);
    expect($$(list, "[role=option]").map((o) => o.getAttribute("aria-label"))).toEqual(["Jocelyn Ford, person, DoorDash"]);
    await type(input, "door");
    const options = $$(list, "[role=option]");
    expect(options.map((o) => o.getAttribute("aria-label"))).toEqual(["DoorDash, company, 1 person"]);
    expect($(options[0], "b")?.textContent).toBe("Door");
    await key(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0].id);
    await key(input, "Escape");
    expect(list.hidden).toBe(true);
  });

  it("searches for the suggestion you pick with Enter or the mouse", async () => {
    const { input, list, visited } = await mount();
    await type(input, "nad");
    await key(input, "ArrowDown");
    await key(input, "Enter");
    expect(visited.at(-1)).toBe("/people?q=Nadia%20Cruz");
    await type(input, "deel");
    const company = $$(list, "[role=option]").find((o) => text(o).startsWith("Deel"))!;
    await act(async () => company.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })));
    expect(visited.at(-1)).toBe("/people?q=Deel");
    expect(input.value).toBe("Deel");
  });

  it("searches for the text you typed when you press Enter with nothing highlighted", async () => {
    const { container, input, visited } = await mount();
    await type(input, "  recruiter ");
    await key(input, "Enter");
    expect(visited).toHaveLength(0);   // the field leaves plain Enter to the form
    await submitForm($(container, "form.people-search"));
    expect(visited.at(-1)).toBe("/people?q=recruiter");
    await type(input, "");
    await submitForm($(container, "form.people-search"));
    expect(visited.at(-1)).toBe("/people");
  });

  it("says when nothing matches, and draws a hostile name as text", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const app = await addApp(db, "<img src=x onerror=alert(1)>");
    await addMail(db, account, app, { sender: "Pat Lee <pat@acme.com>", body: "Pat Lee Senior Recruiter" });
    const { container } = await mountPage(PeoplePage, db, "/people");
    const input = $(container, "#c-q") as HTMLInputElement;
    await type(input, "<");
    expect($$(container, "#c-q-list [role=option]").map((o) => text(o.firstElementChild))).toEqual(["<img src=x onerror=alert(1)>"]);
    expect($(container, "#c-q-list img")).toBeNull();
    await type(input, "qqqq");
    expect(text($(container, ".combo-empty"))).toBe('Nothing matches "qqqq". Press Enter to search anyway.');
  });

  it("keeps the search in the field and offers Clear search", async () => {
    const { container, input } = await mount("/people?q=deel");
    expect(input.value).toBe("deel");
    const clear = $(container, "a.clear-search")!;
    expect(text(clear)).toBe("Clear search");
    expect(clear.getAttribute("href")).toBe("#/people");
    const none = await mountPage(PeoplePage, await seed(), "/people");
    expect($(none.container, "a.clear-search")).toBeNull();
  });

  it("has nothing to suggest with no people, and says so", async () => {
    const m = await mountPage(PeoplePage, freshDb(), "/people");
    const input = $(m.container, "#c-q") as HTMLInputElement;
    await act(async () => input.focus());
    expect($$(m.container, "#c-q-list [role=option]")).toHaveLength(0);
    expect(text($(m.container, ".combo-empty"))).toBe("No people yet.");
    expect(await peopleSuggestions(freshDb())).toEqual([]);
  });

  it("builds the same suggestions from the database", async () => {
    const s = await peopleSuggestions(await seed());
    expect(s.filter((x) => x.kind === "Person").map((x) => [x.text, x.note])).toEqual([["Samuel Okafor", "Deel"], ["Nadia Cruz", "Deel"], ["Jocelyn Ford", "DoorDash"]]);
    expect(s.filter((x) => x.kind === "Company").map((x) => [x.text, x.n, x.note])).toEqual([["Deel", 2, "2 people"], ["DoorDash", 1, "1 person"]]);
  });
});
