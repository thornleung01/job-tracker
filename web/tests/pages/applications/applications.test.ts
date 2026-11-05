import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, createElement } from "react";
import { $, $$, addApp, addMail, button, cleanup, click, freshDb, key, mountPage, seedThree, settle, submitForm, text, type, waitFor } from "./harness";
import ApplicationsPage from "../../../src/pages/applications";
import { importFromPythonExport } from "../../../src/portability";
import { saveSettings } from "../../../src/sync/settings";
import { upsertAccount } from "../../../src/db/repo";
import fixture from "../../fixtures/python-export.json";
import { EMPTY_DRAFT, type JobDraft } from "../../../src/jobs/types";
import type { PageProps } from "../../../src/app/pageProps";
import type { JobLinkDeps } from "../../../src/components/joblink/deps";

afterEach(cleanup);
beforeEach(() => {
  window.confirm = vi.fn(() => true);
});

const companies = (c: HTMLElement) => $$(c, "a.expander strong").map(text);
const sortStates = (c: HTMLElement) => $$(c, "th[role=columnheader]").map((th) => th.getAttribute("aria-sort"));

describe("the list", () => {
  it("shows the newest activity first, with table roles kept and one column sorted", async () => {
    const db = freshDb();
    await seedThree(db);
    const { container } = await mountPage(ApplicationsPage, db);
    expect($(container, "h1.page")?.textContent).toBe("Applications");
    expect(companies(container)).toEqual(["Zeta", "Mid", "alpha"]);
    expect($(container, "table.list")?.getAttribute("role")).toBe("table");
    expect($$(container, "tbody tr.app-row[role=row]")).toHaveLength(3);
    expect($$(container, "tr.app-row > td[role=cell]").length).toBeGreaterThan(8);
    expect(sortStates(container)).toEqual(["none", "none", "none", "none", "descending"]);
  });

  it.each([
    ["sort=company&dir=asc", ["alpha", "Mid", "Zeta"]],
    ["sort=company&dir=desc", ["Zeta", "Mid", "alpha"]],
    ["sort=stage&dir=asc", ["Mid", "Zeta", "alpha"]],
    ["sort=emails", ["Zeta", "Mid", "alpha"]],
    ["sort=lastActivity&dir=asc", ["alpha", "Mid", "Zeta"]],
  ])("sorts by the query %s", async (qs, expected) => {
    const db = freshDb();
    await seedThree(db);
    const { container } = await mountPage(ApplicationsPage, db, `/?${qs}`);
    expect(companies(container)).toEqual(expected);
  });

  it("puts an unknown applied date last in both directions", async () => {
    for (const dir of ["asc", "desc"]) {
      const db = freshDb();
      await seedThree(db);
      const { container } = await mountPage(ApplicationsPage, db, `/?sort=applied&dir=${dir}`);
      expect(companies(container).at(-1)).toBe("Mid");
    }
  });

  it("falls back safely on bad sort values", async () => {
    const db = freshDb();
    await seedThree(db);
    const { container } = await mountPage(ApplicationsPage, db, "/?sort=company;DROP&dir=sideways");
    expect(companies(container)).toEqual(["Zeta", "Mid", "alpha"]);
  });

  it("makes header links that flip the sorted column, start others fresh and keep the filters", async () => {
    const db = freshDb();
    await seedThree(db);
    const { container } = await mountPage(ApplicationsPage, db, "/?sort=company&dir=asc&stage=Applied");
    const href = (col: string) => $(container, `th[data-col=${col}] a.sort`)?.getAttribute("href");
    expect($(container, "th[data-col=company]")?.getAttribute("aria-sort")).toBe("ascending");
    expect(href("company")).toBe("#/?stage=Applied&sort=company&dir=desc");
    expect(href("role")).toBe("#/?stage=Applied&sort=role&dir=asc");
    expect(href("last_activity")).toBe("#/?stage=Applied&sort=lastActivity&dir=desc");
    expect($$(container, ".sort-ind").every((s) => s.getAttribute("aria-hidden") === "true")).toBe(true);
  });

  it("follows the columns chosen in Settings", async () => {
    const db = freshDb();
    await seedThree(db);
    await saveSettings(db, "appearance", { columns: ["company", "stage", "emails"] });
    const { container } = await mountPage(ApplicationsPage, db);
    expect($$(container, "th").map((th) => th.getAttribute("data-col"))).toEqual(["company", "stage", "emails"]);
    expect($$(container, "tr.app-row")[0].querySelectorAll("td")).toHaveLength(3);
  });

  it("says how long ago, with the exact date on hover", async () => {
    const db = freshDb();
    await seedThree(db);
    const today = await addApp(db, "Today Inc", { last: 0 });
    const { container } = await mountPage(ApplicationsPage, db);
    const cell = (id: number) => $(container, `#last-${id}`)!;
    expect(text(cell(today))).toBe("Today");
    const labels = $$(container, "td[data-col=last_activity]").map(text);
    expect(labels).toContain("1 day ago");
    expect(labels).toContain("5 days ago");
    expect(labels).toContain("9 days ago");
    const time = $(container, "td[data-col=last_activity] time")!;
    expect(time.getAttribute("title")).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
    expect(text(time)).not.toMatch(/\d{4}/);
    expect(text($$(container, "td[data-col=applied]")[1])).toMatch(/^[A-Z][a-z]{2} \d{1,2}(, \d{4})?$|^Unknown$/);
  });

  it("shows the stage, and a note when you set it yourself", async () => {
    const db = freshDb();
    await addApp(db, "Mine", { stage: "Interview", locked: true });
    await addApp(db, "Theirs", { stage: "Heard back" });
    const { container } = await mountPage(ApplicationsPage, db);
    const rows = $$(container, "tr.app-row");
    const mine = rows.find((r) => text(r).includes("Mine"))!;
    expect($(mine, ".badge")?.className).toBe("badge Interview quick-stage");
    expect(($(mine, "select") as HTMLSelectElement).value).toBe("Interview");
    expect(text(mine)).toContain("set by you");
    const theirs = rows.find((r) => text(r).includes("Theirs"))!;
    expect($(theirs, ".badge")?.className).toBe("badge Heard-back quick-stage");
    expect(text(theirs)).not.toContain("set by you");
  });
});

describe("filters", () => {
  it("counts every stage in the tabs and marks the current one", async () => {
    const db = freshDb();
    await seedThree(db);
    const { container } = await mountPage(ApplicationsPage, db, "/?stage=Rejected");
    const tabs = $$(container, "nav.tabs a.tab");
    expect(tabs.map((t) => text(t))).toEqual(["All 3", "Applied 1", "Heard back 0", "Assessment 0", "Interview 1", "Offer 0", "Rejected 1"]);
    expect($$(container, "nav.tabs [aria-current=true]").map(text)).toEqual(["Rejected 1"]);
    expect($(container, "#count-Interview")?.textContent).toBe("1");
    expect($$(container, "nav.tabs a.tab")[6].getAttribute("href")).toBe("#/");        // click the current one to clear
    expect(tabs[4].getAttribute("href")).toBe("#/?stage=Interview");
    expect(companies(container)).toEqual(["alpha"]);
  });

  it("filters by stage and search, and says so", async () => {
    const db = freshDb();
    await seedThree(db);
    const plain = await mountPage(ApplicationsPage, freshDb());
    expect(text($(plain.container, ".result-line"))).toBe("Showing 0 applications");
    const full = await mountPage(ApplicationsPage, db);
    expect(text($(full.container, ".result-line"))).toBe("Showing 3 applications");
    expect(text(full.container)).not.toContain("Clear filters");
    const { container } = await mountPage(ApplicationsPage, db, "/?stage=Rejected&q=alp");
    const line = text($$(document.body, ".result-line").at(-1) ?? null);
    expect(line).toContain("Showing 1 of 3 application");
    expect(line).toContain("Stage: Rejected");
    expect(line).toContain("Search: alp");
    const clear = $$(container, ".result-line a").at(-1)!;
    expect(clear.getAttribute("href")).toBe("#/");
    expect(text(clear)).toBe("Clear filters");
  });

  it("filters by account, and only offers the choice with more than one", async () => {
    const db = freshDb();
    const { account, zeta } = await seedThree(db);
    const other = await upsertAccount(db, "outlook", "me@outlook.com");
    const solo = await addApp(db, "Solo");
    await addMail(db, other, solo);
    expect(zeta).toBeGreaterThan(0);
    const { container } = await mountPage(ApplicationsPage, db, `/?account=${other}`);
    expect(companies(container)).toEqual(["Solo"]);
    expect(text($(container, ".result-line"))).toContain(`Account: me@outlook.com`);
    expect($$(container, "#f-account option").map(text)).toEqual(["All accounts", "me@gmail.com", "me@outlook.com"]);
    expect(account).toBeGreaterThan(0);
  });

  it("applies the filter form to the address, keeping the sort", async () => {
    const db = freshDb();
    await seedThree(db);
    const m = await mountPage(ApplicationsPage, db, "/?sort=company&dir=asc");
    await type($(m.container, "#f-q"), "zeta");
    await type($(m.container, "#f-stage"), "Interview");
    await click(button(m.container, "Apply filters"));
    expect(m.visited.at(-1)).toBe("/?stage=Interview&q=zeta&sort=company&dir=asc");
    expect(companies(m.container)).toEqual(["Zeta"]);
    expect($(m.container, "#f-q")).toHaveProperty("value", "zeta");
  });

  it("labels every field and never leaves a placeholder as the only name", async () => {
    const db = freshDb();
    await seedThree(db);
    const { container } = await mountPage(ApplicationsPage, db);
    await click(button(container, "Add application"));
    for (const [id, label] of [["f-q", "Search"], ["f-stage", "Stage"], ["add-company", "Company"], ["add-role", "Role (optional)"], ["add-stage", "Stage"], ["add-date", "Date applied"]]) {
      expect(text($(container, `label[for=${id}]`))).toBe(label);
      expect($(container, `#${id}`)).not.toBeNull();
    }
  });

  it("explains the empty states", async () => {
    const db = freshDb();
    const none = await mountPage(ApplicationsPage, db);
    expect(text($(none.container, ".notice"))).toBe("No email account connected yet. Connect one in Settings to start syncing.");
    expect($(none.container, ".notice a")?.getAttribute("href")).toBe("#/settings");
    expect(text($(none.container, "td.list-empty"))).toContain("No applications yet.");
    const full = freshDb();
    await seedThree(full);
    const filtered = await mountPage(ApplicationsPage, full, "/?q=nothing");
    expect(text($(filtered.container, "td.list-empty"))).toBe("No applications match these filters.");
    expect(text($(filtered.container, ".result-line"))).toContain("Showing 0 of 3 applications");
    expect($(filtered.container, ".notice")).toBeNull();
  });

  it("links to Needs review when mail is waiting", async () => {
    const db = freshDb();
    const { account } = await seedThree(db);
    await addMail(db, account, null, { review: true });
    await addMail(db, account, null, { review: true });
    const { container } = await mountPage(ApplicationsPage, db);
    const notice = $(container, ".notice")!;
    expect(text(notice)).toContain("2 emails need review.");
    expect($(notice, "a")?.getAttribute("href")).toBe("#/review");
  });
});

describe("search suggestions", () => {
  const setup = async () => {
    const db = freshDb();
    await seedThree(db);
    await addApp(db, "Zebra Labs", { role: "Backend" });
    const m = await mountPage(ApplicationsPage, db);
    return { db, ...m, input: $(m.container, "#f-q") as HTMLInputElement, list: $(m.container, "#f-q-list") as HTMLElement };
  };

  it("is a combobox over a listbox, closed until you focus the field", async () => {
    const { input, list } = await setup();
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-controls")).toBe("f-q-list");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(list.getAttribute("role")).toBe("listbox");
    expect(list.hidden).toBe(true);
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("filters as you type, grouped, with counts, and moves with the arrow keys", async () => {
    const { input, list, container } = await setup();
    await act(async () => input.focus());
    await type(input, "z");
    expect(list.hidden).toBe(false);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const options = $$(list, "[role=option]");
    expect(options.map((o) => o.getAttribute("aria-label"))).toEqual(["Zeta, company, 1 application", "Zebra Labs, company, 1 application"]);
    expect($$(list, ".combo-group").map(text)).toEqual(["Companies"]);
    expect(text(options[0])).toBe("Zeta1 application");
    expect($(options[0], "b")?.textContent).toBe("Z");

    await key(input, "ArrowDown");
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0].id);
    await key(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1].id);
    await key(input, "ArrowUp");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0].id);
    await key(input, "Escape");
    expect(list.hidden).toBe(true);
    expect(input.getAttribute("aria-activedescendant")).toBeNull();
    expect(container).toBeTruthy();
  });

  it("searches for the choice you pick with Enter or the mouse", async () => {
    const { input, visited, list } = await setup();
    await type(input, "ze");
    await key(input, "ArrowDown");
    await key(input, "Enter");
    expect(visited.at(-1)).toBe("/?q=Zeta");
    await type(input, "back");
    const role = $$(list, "[role=option]").find((o) => text(o).startsWith("Backend"))!;
    expect($$(list, ".combo-group").map(text)).toEqual(["Roles"]);
    await act(async () => role.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })));
    expect(visited.at(-1)).toBe("/?q=Backend");
  });

  it("says when nothing matches and draws a hostile name as text", async () => {
    const db = freshDb();
    await addApp(db, "<img src=x onerror=alert(1)>", { role: "<script>alert(1)</script>" });
    const { container } = await mountPage(ApplicationsPage, db);
    const input = $(container, "#f-q") as HTMLInputElement;
    await type(input, "<");
    expect($$(container, "#f-q-list [role=option]").map((o) => text(o.firstElementChild))).toEqual(["<img src=x onerror=alert(1)>", "<script>alert(1)</script>"]);
    expect($(container, "#f-q-list img, #f-q-list script, table.list img, table.list script")).toBeNull();
    await type(input, "qqqq");
    expect(text($(container, ".combo-empty"))).toBe('Nothing matches "qqqq". Press Enter to search anyway.');
  });
});

describe("expandable rows", () => {
  it("opens a panel in place and remembers it in the address", async () => {
    const db = freshDb();
    const { zeta } = await seedThree(db);
    const m = await mountPage(ApplicationsPage, db);
    const expander = () => $(m.container, `a.expander[data-id="${zeta}"]`)!;
    expect(expander().getAttribute("role")).toBe("button");
    expect(expander().getAttribute("aria-expanded")).toBe("false");
    expect($(m.container, `#panel-${zeta}`)?.hasAttribute("hidden")).toBe(true);
    expect($(m.container, ".panel-inner")).toBeNull();

    await click(expander());
    expect(m.visited.at(-1)).toBe(`/?open=${zeta}`);
    expect(expander().getAttribute("aria-expanded")).toBe("true");
    expect(expander().getAttribute("aria-controls")).toBe(`panel-${zeta}`);
    const panel = $(m.container, `#panel-${zeta}`)!;
    expect(panel.hasAttribute("hidden")).toBe(false);
    expect($(m.container, `tr.app-row.is-open`)).not.toBeNull();
    expect(text($(panel, ".panel-h"))).toBe("Log a step");
    expect($$(panel, "ol.hist > li")).toHaveLength(3);
    expect($$(panel, "details.mail")).toHaveLength(3);
    expect($$(panel, "details.mail .tag.latest")).toHaveLength(1);
    const full = $(panel, "a.open-full")!;
    expect(text(full)).toBe("Open full page");
    expect(full.getAttribute("href")).toBe(`#/app/${zeta}`);
    expect(full.getAttribute("aria-label")).toBe("Open full page for Zeta");
    const icon = $(full, "svg")!;
    expect([icon.getAttribute("width"), icon.getAttribute("stroke-width"), icon.getAttribute("aria-hidden")]).toEqual(["16", "3", "true"]);

    await click(expander());
    expect(m.visited.at(-1)).toBe("/");
    expect($(m.container, ".panel-inner")).toBeNull();
  });

  it("renders rows listed in ?open expanded, and keeps filters in the toggle link", async () => {
    const db = freshDb();
    const { zeta, mid } = await seedThree(db);
    const { container } = await mountPage(ApplicationsPage, db, `/?sort=company&dir=asc&open=${mid}`);
    expect($$(container, "a.expander[aria-expanded=true]").map((a) => a.getAttribute("data-id"))).toEqual([String(mid)]);
    expect($(container, `a.expander[data-id="${zeta}"]`)?.getAttribute("href")).toBe(`#/?sort=company&dir=asc&open=${mid}%2C${zeta}`);
  });

  it("keeps one target per collapsed row and puts the full page inside the panel", async () => {
    const db = freshDb();
    const { zeta } = await seedThree(db);
    const m = await mountPage(ApplicationsPage, db);
    expect($(m.container, "a.open-link")).toBeNull();
    expect(text(m.container)).not.toContain("Open page");
    expect($$(m.container, "tr.app-row a[href^='#/app/']")).toHaveLength(0);
    expect($(m.container, "a.open-full")).toBeNull();
    const row = $$(m.container, "tr.app-row").find((r) => text(r).includes("Zeta"))!;
    await click($(row, "td[data-col=role]"));
    expect(m.visited.at(-1)).toBe(`/?open=${zeta}`);
    expect($$(m.container, "a.open-full")).toHaveLength(1);
  });

  it("opens with the Space key like a button", async () => {
    const db = freshDb();
    const { zeta } = await seedThree(db);
    const m = await mountPage(ApplicationsPage, db);
    await key($(m.container, `a.expander[data-id="${zeta}"]`), " ");
    expect(m.visited.at(-1)).toBe(`/?open=${zeta}`);
  });

  it("logs a step with a note, moves the stage and updates the row and the counts", async () => {
    const db = freshDb();
    const { mid } = await seedThree(db);
    const { container } = await mountPage(ApplicationsPage, db, `/?open=${mid}`);
    const panel = $(container, `#panel-${mid}`)!;
    await type($(panel, "select[name=label]"), "Interview");
    await type($(panel, "textarea"), "Zoom with Sam");
    await click(button(panel, "Log step"));
    await waitFor(() => ($(container, `#stage-${mid} select`) as HTMLSelectElement).value === "Interview");
    expect(text($(panel, ".panel-status"))).toBe("Step logged. The stage was updated.");
    expect($(panel, ".panel-status")?.getAttribute("role")).toBe("status");
    expect(text($(panel, "ol.hist li .hist-text, ol.hist li strong"))).toBeTruthy();
    expect(text(panel)).toContain("Zoom with Sam");
    expect($(container, "#count-Interview")?.textContent).toBe("2");
    expect($(container, "#count-Applied")?.textContent).toBe("0");
    expect(($(panel, "textarea") as HTMLTextAreaElement).value).toBe("");
  });

  it("refuses an empty or future step and keeps what you typed", async () => {
    const db = freshDb();
    const { mid } = await seedThree(db);
    const { container } = await mountPage(ApplicationsPage, db, `/?open=${mid}`);
    const panel = $(container, `#panel-${mid}`)!;
    await type($(panel, "select[name=label]"), "Phone screen");
    await type($(panel, "textarea"), "keep this");
    await type($(panel, "input[type=date]"), "2999-01-01");
    await submitForm($(panel, "form"));
    const alert = $(panel, ".notice.err")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(text(alert)).toBe("The date can't be in the future.");
    expect(($(panel, "textarea") as HTMLTextAreaElement).value).toBe("keep this");
    expect(($(panel, "select[name=label]") as HTMLSelectElement).value).toBe("Phone screen");
  });

  it("deletes a note or step after you confirm, and keeps its stage change", async () => {
    const db = freshDb();
    const { mid } = await seedThree(db);
    const { container } = await mountPage(ApplicationsPage, db, `/?open=${mid}`);
    const panel = $(container, `#panel-${mid}`)!;
    await type($(panel, "select[name=label]"), "Phone screen");
    await click(button(panel, "Log step"));
    const del = $(panel, "button.hist-del")!;
    expect(del.getAttribute("aria-label")).toMatch(/^Delete step from [A-Z][a-z]+ \d{1,2}, \d{4}$/);
    await click(del);
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => !$(panel, "button.hist-del"));
    expect(text($(panel, ".panel-status"))).toBe("Entry deleted.");
  });

  it("deletes the application from its panel", async () => {
    const db = freshDb();
    const { mid } = await seedThree(db);
    const { container } = await mountPage(ApplicationsPage, db, `/?open=${mid}`);
    await click(button($(container, `#panel-${mid}`)!, "Delete application"));
    await waitFor(() => !$(container, `#panel-${mid}`));
    expect(companies(container)).toEqual(["Zeta", "alpha"]);
    expect(await db.emails.where("applicationId").equals(mid).count()).toBe(0);
  });

  it("does nothing when you do not confirm", async () => {
    const db = freshDb();
    const { mid } = await seedThree(db);
    window.confirm = vi.fn(() => false);
    const { container } = await mountPage(ApplicationsPage, db, `/?open=${mid}`);
    await click(button($(container, `#panel-${mid}`)!, "Delete application"));
    expect(companies(container)).toContain("Mid");
  });

  it("teaches the app and goes to Needs review from Not an application", async () => {
    const db = freshDb();
    const { mid } = await seedThree(db);
    const m = await mountPage(ApplicationsPage, db, `/?open=${mid}`);
    await click(button($(m.container, `#panel-${mid}`)!, "Not an application"));
    await waitFor(() => m.visited.at(-1) === "/review");
    expect(m.visited.at(-1)).toBe("/review");
    expect(await db.applications.get(mid)).toBeUndefined();
  });
});

describe("emails in the panel", () => {
  it("shows cleaned text, folds the earlier thread and footer, and shows links as domains that cannot be clicked", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const app = await addApp(db, "Acme");
    const body = [
      "Hi Sam,", "", "Thanks for applying. Book a time at https://calendly.com/acme/screen?x=1 and we will talk.", "",
      "Best,", "Pat", "",
    ].join("\n") + "\n\n" + "Filler text ".repeat(20) + "\n\nYou are receiving this because you applied. Unsubscribe here.";
    await addMail(db, account, app, { body, subject: "Interview plans", sender: "Pat Lee <pat@acme.com>" });
    const { container } = await mountPage(ApplicationsPage, db, `/?open=${app}`);
    const mail = $(container, "details.mail")!;
    expect(text($(mail, "summary"))).toContain("Interview plans");
    expect(text($(mail, ".mail-meta .who"))).toBe("Pat Lee");
    expect(text($(mail, ".mail-meta .addr"))).toBe("pat@acme.com");
    expect(text($(mail, ".mail-meta .when"))).toContain("Gmail me@gmail.com");
    const url = $(mail, ".mail-text .url")!;
    expect(url.tagName).toBe("SPAN");
    expect(url.textContent).toBe("calendly.com");
    expect(url.getAttribute("title")).toContain("https://calendly.com/acme/screen");
    expect($$(mail, ".mail-text a")).toHaveLength(0);
    expect($$(mail, ".mail-fold > summary").map(text)).toEqual(["Footer and links"]);
    expect(text($(mail, ".mail-fold"))).toContain("Unsubscribe here.");
    expect($$(mail, "p.sig").length).toBeGreaterThan(0);
    expect($(mail, "a.btn.primary")?.getAttribute("href")).toContain("view=cm");
    expect($(mail, "a.btn.primary")?.getAttribute("rel")).toBe("noopener noreferrer");
    expect($(mail, "a.btn.primary")?.getAttribute("target")).toBe("_blank");
    expect(text($$(mail, "a.btn")[1])).toBe("Open in Gmail");
  });

  it("folds a reply chain under Earlier in this thread", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const app = await addApp(db, "Acme");
    await addMail(db, account, app, { body: "Sounds good, see you then.\n\nOn Mon, Oct 5, 2026 at 9:00 AM Sam <sam@x.com> wrote:\n> Are you free Friday?" });
    const { container } = await mountPage(ApplicationsPage, db, `/?open=${app}`);
    const fold = $(container, "details.mail details.mail-fold")!;
    expect(text($(fold, "summary"))).toBe("Earlier in this thread");
    expect(fold.hasAttribute("open")).toBe(false);
    expect(text($(container, ".mail-text"))).toContain("Sounds good, see you then.");
  });

  it("renders a subject and body with markup as plain text", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const app = await addApp(db, "Acme");
    await addMail(db, account, app, { subject: "<script>alert(1)</script> Offer", body: "<img src=x onerror=alert(1)> and <b>bold</b> & more", sender: "<script>x</script> <evil@x.com>" });
    const { container } = await mountPage(ApplicationsPage, db, `/?open=${app}`);
    expect($(container, "script")).toBeNull();
    expect($(container, ".mail-text img, .mail-text b")).toBeNull();
    expect(text($(container, "details.mail summary strong"))).toBe("<script>alert(1)</script> Offer");
    expect(text($(container, ".mail-text"))).toContain("<img src=x onerror=alert(1)> and <b>bold</b> & more");
  });

  it("says what is missing when no text was stored", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    const app = await addApp(db, "Acme");
    await addMail(db, account, app, { body: "" });
    const { container } = await mountPage(ApplicationsPage, db, `/?open=${app}`);
    expect(text($(container, ".mail-empty"))).toBe("No text was stored for this email.");
  });
});

describe("adding an application by hand", () => {
  it("has one way in: a secondary button in the filter card, and no form until it is pressed", async () => {
    const db = freshDb();
    await seedThree(db);
    const { container } = await mountPage(ApplicationsPage, db);
    expect($$(container, "button").filter((b) => /add application/i.test(text(b)))).toHaveLength(1);
    expect(text(container)).not.toContain("Add an application manually");
    expect($(container, "details#add-application")).toBeNull();
    expect($(container, "#add-application")).toBeNull();
    const entry = button(container, "Add application")!;
    expect(entry.classList.contains("primary")).toBe(false);
    expect(entry.closest(".filters")).not.toBeNull();
    expect(button(container, "Apply filters")?.classList.contains("primary")).toBe(true);
    expect(entry.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens in place between the filter card and the list, focuses Company and leaves room for a link field above it", async () => {
    const db = freshDb();
    await seedThree(db);
    const { container } = await mountPage(ApplicationsPage, db);
    await click(button(container, "Add application"));
    const form = $(container, "#add-application")!;
    expect(button(container, "Add application")?.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement?.id).toBe("add-company");
    const order = [...container.querySelectorAll(".filters, #add-application, table.list")];
    expect(order.map((n) => n.id || n.className.split(" ")[0] || n.tagName)).toEqual(["row", "add-application", "list"]);
    expect(form.previousElementSibling?.contains($(container, ".filters"))).toBe(true);
    const slot = $(form, "#add-link-slot")!;
    expect(slot.compareDocumentPosition($(form, "#add-company")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("adds it as yours, says so, closes the form and hands focus back to the button", async () => {
    const db = freshDb();
    await seedThree(db);
    const { container } = await mountPage(ApplicationsPage, db);
    await click(button(container, "Add application"));
    await type($(container, "#add-company"), "  Newco ");
    await type($(container, "#add-role"), "Designer");
    await type($(container, "#add-stage"), "Heard back");
    await click(button(container, "Save application"));
    await waitFor(() => companies(container).includes("Newco"));
    await waitFor(() => !$(container, "#add-application"));
    expect(text($(container, ".notice"))).toBe("Added Newco. It stays yours, so a sync never changes it.");
    expect(document.activeElement).toBe(button(container, "Add application"));
    const row = $$(container, "tr.app-row").find((r) => text(r).includes("Newco"))!;
    expect(text(row)).toContain("Designer");
    expect(text(row)).toContain("Heard back");
    expect(text(row)).toContain("set by you");
    expect($(container, "#count-Heard-back, #count-Heard\\ back")).not.toBeNull();
    const added = (await db.applications.toArray()).find((a) => a.company === "Newco")!;
    expect([added.manual, added.locked, added.stage]).toEqual([true, true, "Heard back"]);
    // Opening again starts clean and drops the old message.
    await click(button(container, "Add application"));
    expect(($(container, "#add-company") as HTMLInputElement).value).toBe("");
    expect($(container, ".notice")).toBeNull();
  });

  it("shows a validation problem in an alert and keeps the form open with what you typed", async () => {
    const db = freshDb();
    const { container } = await mountPage(ApplicationsPage, db);
    await click(button(container, "Add application"));
    await type($(container, "#add-company"), "Acme");
    await type($(container, "#add-date"), "2999-01-01");
    await submitForm($(container, "#add-application form"));
    const alert = $(container, "#add-application .notice.err")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(text(alert)).toBe("The date can't be in the future.");
    expect(($(container, "#add-company") as HTMLInputElement).value).toBe("Acme");
    expect(await db.applications.count()).toBe(0);
  });

  it("closes on Cancel and on Escape without adding anything", async () => {
    const db = freshDb();
    const { container } = await mountPage(ApplicationsPage, db);
    await click(button(container, "Add application"));
    await type($(container, "#add-company"), "Acme");
    await click(button(container, "Cancel"));
    expect($(container, "#add-application")).toBeNull();
    expect(document.activeElement).toBe(button(container, "Add application"));
    await click(button(container, "Add application"));
    expect(document.activeElement?.id).toBe("add-company");
    await key($(container, "#add-company"), "Escape");
    expect($(container, "#add-application")).toBeNull();
    expect(await db.applications.count()).toBe(0);
  });

  it("points the empty state at the button by its name", async () => {
    const db = freshDb();
    const { container } = await mountPage(ApplicationsPage, db);
    const empty = text($(container, "td.list-empty"));
    expect(empty).toContain('"Add application"');
    expect(empty).not.toContain("manually");
  });
});

describe("a database imported from the local edition", () => {
  it("lists its applications and counts them by stage", async () => {
    const db = freshDb();
    await importFromPythonExport(db, fixture);
    const { container } = await mountPage(ApplicationsPage, db);
    const n = await db.applications.count();
    expect($$(container, "tr.app-row")).toHaveLength(n);
    expect(text($(container, "nav.tabs a.tab"))).toBe(`All ${n}`);
    expect(companies(container)).toContain("Hand Made Co");
    expect(text($$(container, "tr.app-row").find((r) => text(r).includes("Hand Made Co"))!)).toContain("set by you");
    await settle();
  });
});

// -- paste a job link ----------------------------------------------------------------------------------------------

const draft = (o: Omit<Partial<JobDraft>, "guessed"> & { guessed?: Partial<JobDraft["guessed"]> } = {}): JobDraft => ({
  ...EMPTY_DRAFT, ...o, guessed: { company: false, role: false, ...o.guessed },
});
const GUESS = draft({ company: "Stripe", role: "Software Engineer", url: "https://jobs.example.com/p/1", guessed: { company: true, role: true } });

/** The page with the job-link library replaced by fakes. Every fake can be overridden per test. */
interface Fakes {
  parseJobUrl: Mock<JobLinkDeps["parseJobUrl"]>;
  enrichJobDraft: Mock<JobLinkDeps["enrichJobDraft"]>;
  parsePastedText: Mock<JobLinkDeps["parsePastedText"]>;
  draftFromHash: Mock<JobLinkDeps["draftFromHash"]>;
}
function withFakes(over: Partial<Fakes> = {}) {
  const deps: Fakes = {
    parseJobUrl: vi.fn((_raw: string): JobDraft | null => GUESS),
    enrichJobDraft: vi.fn(async (d: JobDraft) => d),
    parsePastedText: vi.fn((_t: string, _u?: string): JobDraft | null => null),
    draftFromHash: vi.fn((_q: URLSearchParams): JobDraft | null => null),
    ...over,
  };
  const Page = (props: PageProps) => createElement(ApplicationsPage, { ...props, deps });
  return { deps, Page };
}

const field = (c: HTMLElement, id: string) => $(c, `#${id}`) as HTMLInputElement;
const result = (c: HTMLElement) => text($(c, "#add-link-result"));
const paste = async (c: HTMLElement, value: string) => {
  const input = field(c, "add-link");
  await act(async () => {
    input.dispatchEvent(new Event("paste", { bubbles: true }));
  });
  await type(input, value);
};
const openForm = async (c: HTMLElement) => click(button(c, "Add application"));
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe("paste a job link", () => {
  it("shows the field and a quiet Fill in details button, and the form still works with no link", async () => {
    const db = freshDb();
    const { Page, deps } = withFakes();
    const { container } = await mountPage(Page, db);
    await openForm(container);
    const slot = $(container, "#add-link-slot")!;
    expect(text($(slot, "label[for=add-link]"))).toBe("Paste a job link");
    const input = field(container, "add-link");
    expect([input.type, input.getAttribute("inputmode")]).toEqual(["text", "url"]);
    const fill = button(slot, "Fill in details")!;
    expect(fill.classList.contains("primary")).toBe(false);
    expect($$(container, "#add-application button.primary")).toHaveLength(1);
    await type($(container, "#add-company"), "Plain Co");
    await click(button(container, "Save application"));
    await waitFor(() => !$(container, "#add-application"));
    expect((await db.applications.toArray()).map((a) => a.company)).toEqual(["Plain Co"]);
    expect(deps.parseJobUrl).not.toHaveBeenCalled();
  });

  it("fills company, role and the posting link a moment after a paste, not on every keystroke", async () => {
    const db = freshDb();
    const { Page, deps } = withFakes();
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-link"), "https://jobs.example.com/p/1");
    await settle(0);
    expect(deps.parseJobUrl).not.toHaveBeenCalled();
    expect(field(container, "add-company").value).toBe("");
    await paste(container, "https://jobs.example.com/p/1");
    expect(deps.parseJobUrl).not.toHaveBeenCalled();
    await waitFor(() => field(container, "add-company").value === "Stripe");
    expect(deps.parseJobUrl).toHaveBeenCalledTimes(1);
    expect(deps.parseJobUrl).toHaveBeenCalledWith("https://jobs.example.com/p/1");
    expect(field(container, "add-role").value).toBe("Software Engineer");
    expect(field(container, "add-url").value).toBe("https://jobs.example.com/p/1");
    expect(result(container)).toBe("Guessed from the link. Check the company and role.");
  });

  it("fills on the Fill in button and on Enter, and Enter does not submit the form", async () => {
    const db = freshDb();
    const { Page } = withFakes();
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-link"), "https://jobs.example.com/p/1");
    await click(button(container, "Fill in details"));
    expect(field(container, "add-company").value).toBe("Stripe");
    await type(field(container, "add-company"), "");
    await type(field(container, "add-role"), "");
    await key(field(container, "add-link"), "Enter");
    expect(field(container, "add-company").value).toBe("Stripe");
    expect($(container, "#add-application")).not.toBeNull();
    expect(await db.applications.count()).toBe(0);
  });

  it("never overwrites text you typed, and says so", async () => {
    const db = freshDb();
    const { Page } = withFakes();
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-company"), "My own company");
    await type(field(container, "add-link"), "https://jobs.example.com/p/1");
    await click(button(container, "Fill in details"));
    expect(field(container, "add-company").value).toBe("My own company");
    expect(field(container, "add-role").value).toBe("Software Engineer");
    expect($(container, "#add-company-hint")).toBeNull();
    await type(field(container, "add-role"), "Staff designer");
    await click(button(container, "Fill in details"));
    expect(field(container, "add-role").value).toBe("Staff designer");
    expect(result(container)).toBe("Kept what you typed. Check the company and role.");
  });

  it("replaces a value it filled earlier when you press Fill in with a different link", async () => {
    const db = freshDb();
    const next = draft({ company: "Notion", role: "Designer", url: "https://jobs.example.com/p/2" });
    const { Page, deps } = withFakes();
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-link"), "https://jobs.example.com/p/1");
    await click(button(container, "Fill in details"));
    deps.parseJobUrl.mockReturnValueOnce(next);
    await type(field(container, "add-link"), "https://jobs.example.com/p/2");
    await click(button(container, "Fill in details"));
    expect([field(container, "add-company").value, field(container, "add-role").value, field(container, "add-url").value]).toEqual(["Notion", "Designer", "https://jobs.example.com/p/2"]);
    expect($(container, "#add-company-hint")).toBeNull();
    expect(result(container)).toBe("Filled in from the link: Notion, Designer.");
  });

  it("marks guessed fields, ties the hint to the field, and clears it when you edit that field", async () => {
    const db = freshDb();
    const { Page } = withFakes();
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-link"), "https://jobs.example.com/p/1");
    await click(button(container, "Fill in details"));
    const hint = $(container, "#add-company-hint")!;
    expect(text(hint)).toBe("Guessed from the link");
    expect(field(container, "add-company").getAttribute("aria-describedby")).toBe("add-company-hint");
    expect(text($(container, "#add-role-hint"))).toBe("Guessed from the link");
    await type(field(container, "add-company"), "Stripe Inc");
    expect($(container, "#add-company-hint")).toBeNull();
    expect(field(container, "add-company").getAttribute("aria-describedby")).toBeNull();
    expect($(container, "#add-role-hint")).not.toBeNull();
  });

  it("asks the job board in the background, then updates what is still auto-filled but not what you edited", async () => {
    const db = freshDb();
    const gate = deferred<JobDraft>();
    const { Page, deps } = withFakes({ enrichJobDraft: vi.fn((_d: JobDraft, _o?: { signal?: AbortSignal }) => gate.promise) });
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-link"), "https://boards.greenhouse.io/stripe/jobs/1");
    await click(button(container, "Fill in details"));
    const checking = $(container, "#add-link-checking")!;
    expect(checking.getAttribute("role")).toBe("status");
    expect(checking.getAttribute("aria-busy")).toBe("true");
    expect(text(checking)).toBe("Checking the job board");
    expect(deps.enrichJobDraft.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    // The form stays usable meanwhile.
    expect(button(container, "Save application")!.hasAttribute("disabled")).toBe(false);
    await type(field(container, "add-role"), "My title");
    const enriched = draft({ company: "Stripe, Inc.", role: "Software Engineer, Payments", url: "https://boards.greenhouse.io/stripe/jobs/1", source: "api" });
    await act(async () => gate.resolve(enriched));
    await settle();
    expect(field(container, "add-company").value).toBe("Stripe, Inc.");
    expect(field(container, "add-role").value).toBe("My title");
    expect($(container, "#add-company-hint")).toBeNull();
    expect(checking.getAttribute("aria-busy")).toBe("false");
    expect(text(checking)).toBe("");
    expect(result(container)).toBe("Filled in from Greenhouse: Stripe, Inc.");
  });

  it("aborts the check when the form is closed, and a late answer changes nothing", async () => {
    const db = freshDb();
    const gate = deferred<JobDraft>();
    const { Page, deps } = withFakes({ enrichJobDraft: vi.fn((_d: JobDraft, _o?: { signal?: AbortSignal }) => gate.promise) });
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-link"), "https://boards.greenhouse.io/stripe/jobs/1");
    await click(button(container, "Fill in details"));
    const signal = deps.enrichJobDraft.mock.calls[0][1]!.signal!;
    expect(signal.aborted).toBe(false);
    await click(button(container, "Cancel"));
    expect(signal.aborted).toBe(true);
    await act(async () => gate.resolve(draft({ company: "Late Co", role: "Late role", source: "api" })));
    await openForm(container);
    expect(field(container, "add-company").value).toBe("Stripe");
    expect(field(container, "add-link").value).toBe("");
    expect(result(container)).toBe("");
  });

  it("aborts the check when the link changes and when the page goes away", async () => {
    const db = freshDb();
    const gate = deferred<JobDraft>();
    const { Page, deps } = withFakes({ enrichJobDraft: vi.fn((_d: JobDraft, _o?: { signal?: AbortSignal }) => gate.promise) });
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-link"), "https://boards.greenhouse.io/stripe/jobs/1");
    await click(button(container, "Fill in details"));
    const first = deps.enrichJobDraft.mock.calls[0][1]!.signal!;
    await type(field(container, "add-link"), "https://boards.greenhouse.io/stripe/jobs/12");
    expect(first.aborted).toBe(true);
    expect($(container, "#add-link-checking")!.getAttribute("aria-busy")).toBe("false");
    await click(button(container, "Fill in details"));
    const second = deps.enrichJobDraft.mock.calls[1][1]!.signal!;
    expect(second.aborted).toBe(false);
    await cleanup();
    expect(second.aborted).toBe(true);
  });

  it("says plainly when nothing could be read, and points at the bookmarklet in Settings", async () => {
    const db = freshDb();
    const { Page } = withFakes({ parseJobUrl: vi.fn((_raw: string) => draft({ url: "https://www.linkedin.com/jobs/view/1" })) });
    const { container, visited } = await mountPage(Page, db);
    await openForm(container);
    expect(text($(container, "#add-link-slot"))).not.toContain("bookmarklet");
    await type(field(container, "add-link"), "https://www.linkedin.com/jobs/view/1");
    await click(button(container, "Fill in details"));
    expect(result(container)).toBe("We couldn't read details from this link. Add them below.");
    expect(field(container, "add-company").value).toBe("");
    const slot = $(container, "#add-link-slot")!;
    expect(text(slot)).toContain("LinkedIn, Indeed or a company site? Use the Save to Job Tracker bookmarklet in Settings.");
    await click($(slot, "a[href='#/settings']"));
    expect(visited.at(-1)).toBe("/settings");
  });

  it("says so when the text is not a web address at all", async () => {
    const db = freshDb();
    const { Page } = withFakes({ parseJobUrl: vi.fn((_raw: string) => null) });
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-link"), "not a link");
    await click(button(container, "Fill in details"));
    expect(result(container)).toBe("We couldn't read details from this link. Add them below.");
    await type(field(container, "add-link"), "");
    await click(button(container, "Fill in details"));
    expect(result(container)).toBe("Paste a link first.");
  });

  it("reads pasted job text from a collapsed box, with the link as context", async () => {
    const db = freshDb();
    const fromText = draft({ company: "Shopify", role: "Data Scientist", source: "paste", guessed: { company: true, role: true } });
    const { Page, deps } = withFakes({ parsePastedText: vi.fn((_t: string, _u?: string) => fromText) });
    const { container } = await mountPage(Page, db);
    await openForm(container);
    const toggle = button(container, "Or paste the job text instead")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect($(container, "#add-paste")).toBeNull();
    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(text($(container, "label[for=add-paste]"))).toBe("Paste the job posting text");
    const box = $(container, "#add-paste") as HTMLTextAreaElement;
    expect(box.maxLength).toBe(200_000);
    expect(button(container, "Read the text")!.classList.contains("primary")).toBe(false);
    await type(box, "Shopify is hiring a Data Scientist");
    await click(button(container, "Read the text"));
    expect(deps.parsePastedText).toHaveBeenCalledWith("Shopify is hiring a Data Scientist", undefined);
    expect([field(container, "add-company").value, field(container, "add-role").value]).toEqual(["Shopify", "Data Scientist"]);
    expect(text($(container, "#add-company-hint"))).toBe("Guessed from the text");
    expect(result(container)).toBe("Guessed from the text. Check the company and role.");
    await type(box, "nothing here");
    deps.parsePastedText.mockReturnValueOnce(null);
    await click(button(container, "Read the text"));
    expect(result(container)).toBe("We couldn't read details from that text. Add them below.");
  });

  it("shows hostile values as plain text", async () => {
    const db = freshDb();
    const evil = draft({ company: "<img src=x onerror=alert(1)>", role: "<b>Boss</b>", location: "<script>x</script>", url: "https://e.example/p", source: "paste", guessed: { company: true } });
    const { Page } = withFakes({ parseJobUrl: vi.fn((_raw: string) => evil) });
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-link"), "https://e.example/p");
    await click(button(container, "Fill in details"));
    expect(field(container, "add-company").value).toBe("<img src=x onerror=alert(1)>");
    expect($(container, "#add-application img, #add-application script, #add-application b")).toBeNull();
    expect(result(container)).toContain("<script>x</script>");
  });

  it("saves the link with the application, and clears the link field, hints and result afterwards", async () => {
    const db = freshDb();
    const { Page } = withFakes();
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-link"), "https://jobs.example.com/p/1");
    await click(button(container, "Fill in details"));
    await click(button(container, "Save application"));
    await waitFor(() => !$(container, "#add-application"));
    const saved = (await db.applications.toArray()).find((a) => a.company === "Stripe")!;
    expect(saved.postingUrl).toBe("https://jobs.example.com/p/1");
    await openForm(container);
    expect(field(container, "add-link").value).toBe("");
    expect(field(container, "add-url").value).toBe("");
    expect($(container, "#add-company-hint")).toBeNull();
    expect(result(container)).toBe("");
  });

  it("shows a bad posting link in the form's alert and keeps what you typed", async () => {
    const db = freshDb();
    const { Page } = withFakes();
    const { container } = await mountPage(Page, db);
    await openForm(container);
    await type(field(container, "add-company"), "Acme");
    await type(field(container, "add-url"), "javascript:alert(1)");
    await submitForm($(container, "#add-application form"));
    const alert = $(container, "#add-application .notice.err")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(text(alert)).toBe("That link doesn't look right. Use a web address that starts with https://.");
    expect(field(container, "add-company").value).toBe("Acme");
    expect(await db.applications.count()).toBe(0);
  });
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
    await waitFor(() => $(container, "#add-link-checking")?.getAttribute("aria-busy") === "false");
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
