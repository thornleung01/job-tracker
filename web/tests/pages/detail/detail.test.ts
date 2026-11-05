import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $, $$, addApp, addMail, button, cleanup, click, daysAgo, freshDb, key, mountPage, submitForm, text, type, waitFor } from "../applications/harness";
import DetailPage from "../../../src/pages/detail";
import { peekFlash, clearFlash } from "../../../src/components/flash";
import { upsertAccount } from "../../../src/db/repo";

afterEach(cleanup);
beforeEach(() => {
  window.confirm = vi.fn(() => true);
  clearFlash();
});

async function setup() {
  const db = freshDb();
  const account = await upsertAccount(db, "gmail", "me@gmail.com");
  const acme = await addApp(db, "Acme", { role: "Analyst", stage: "Applied" });
  const other = await addApp(db, "Beta", { role: "Engineer", stage: "Applied" });
  return { db, account, acme, other };
}
const menu = (c: ParentNode) => $(c, "button[aria-label='More actions']")!;
const openMenu = async (c: ParentNode) => click(menu(c));
const item = (c: ParentNode, label: string) => $$(c, "[role=menuitem]").find((b) => text(b) === label) ?? null;
const open = (db: ReturnType<typeof freshDb>, id: number, query = "") => mountPage(DetailPage, db, `/app/${id}${query}`, { id: String(id) });

describe("the application page", () => {
  it("has a back link with a chevron and the facts of the application", async () => {
    const { db, acme } = await setup();
    const { container } = await open(db, acme);
    const back = $(container, "a.back")!;
    expect(back.getAttribute("href")).toBe("#/");
    expect($(back, ".chev")).not.toBeNull();
    expect(text(back)).toBe("All applications");
    expect(text($(container, "h1.page"))).toBe("Acme");
    expect(text($(container, ".card .badge"))).toBe("Applied");
    expect(text($(container, ".detail-facts"))).toMatch(/Applied \d{4}-\d{2}-\d{2} · last activity \d{4}-\d{2}-\d{2}$/);
    expect(text($(container, "#h-notes"))).toBe("Notes and steps");
    expect(text($(container, "h2.section.spaced"))).toContain("Email timeline newest first");
    expect($$(container, ".card:not(article)")).toHaveLength(1);   // one card for the header and its actions; People and Notes are plain sections
    expect($(container, "section.detail-section[aria-labelledby=h-people] h2.section")).not.toBeNull();
    expect($(container, "section.detail-section[aria-labelledby=h-notes] h2.section")).not.toBeNull();
  });

  it("says when there is no such application", async () => {
    const { db } = await setup();
    const { container } = await open(db, 999);
    expect(text($(container, "h1"))).toBe("Application not found");
    expect($(container, "a.back")).not.toBeNull();
  });

  it("edits the company and role and marks it as yours", async () => {
    const { db, acme } = await setup();
    const { container } = await open(db, acme);
    await type($(container, "#ed-company"), "Acme Corp");
    await type($(container, "#ed-role"), "Lead analyst");
    await click(button($(container, "details.more")!, "Save"));
    await waitFor(() => text($(container, "h1.page")) === "Acme Corp");
    expect(text($(container, ".card .muted"))).toBe("Lead analyst");
    expect((await db.applications.get(acme))!.manual).toBe(true);
    expect(text($(container, ".notice"))).toBe("Saved.");
  });

  it("will not save an empty company", async () => {
    const { db, acme } = await setup();
    const { container } = await open(db, acme);
    await type($(container, "#ed-company"), "   ");
    await submitForm($(container, "details.more form"));
    expect($(container, ".notice.err")?.getAttribute("role")).toBe("alert");
    expect(text($(container, ".notice.err"))).toBe("The company cannot be empty.");
    expect((await db.applications.get(acme))!.company).toBe("Acme");
  });
});

describe("stage and lock", () => {
  it("sets the stage by hand, locks it, and unlocks", async () => {
    const { db, acme } = await setup();
    const { container } = await open(db, acme);
    expect(button(container, "Unlock")).toBeNull();
    expect(button(container, "Set stage")).toBeNull();
    await type($(container, "select[aria-label='Set stage']"), "Interview");
    await waitFor(() => text($(container, ".card .badge")) === "Interview");
    expect((await db.applications.get(acme))!.locked).toBe(true);
    expect(text($(container, ".detail-facts"))).toContain("Stage set by you. Syncs won't change it.");
    expect(text($(container, ".notice"))).toBe("Stage set to Interview. Syncs won't change it.");
    await click(button(container, "Unlock"));
    await waitFor(() => !button(container, "Unlock"));
    expect((await db.applications.get(acme))!.locked).toBe(false);
    expect(text($(container, ".detail-facts"))).not.toContain("Stage set by you");
  });

  it("logs a step with a note in the panel and shows it in the history", async () => {
    const { db, acme } = await setup();
    const { container } = await open(db, acme);
    const panel = $(container, "#h-notes")!.parentElement!;
    await type($(panel, "select[name=label]"), "Phone screen");
    await type($(panel, "textarea"), "Call Monday <b>9am</b>");
    await click(button(panel, "Log step"));
    await waitFor(() => $$(panel, "ol.hist li").length === 1);
    expect(text($(panel, ".panel-status"))).toBe("Step logged.");
    expect(text(panel)).toContain("Call Monday <b>9am</b>");
    expect($(panel, ".hist-body b")).toBeNull();
    expect(button(panel, "Not an application")).toBeNull();   // the detail page keeps those controls in its own card
  });
});

describe("the action row", () => {
  it("holds one stage select and one More button, with no per-select buttons", async () => {
    const { db, acme } = await setup();
    const { container } = await open(db, acme);
    const row = $(container, ".detail-controls")!;
    expect($$(row, "select, button").map((el) => el.getAttribute("aria-label") ?? text(el))).toEqual(["Set stage", "More actions"]);
    const more = menu(container);
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect($(container, "[role=menu]")).toBeNull();
    for (const label of ["Delete", "Not an application", "Merge into…", "Delete, keep emails for review"]) expect(button(container, label)).toBeNull();
  });

  it("keeps Unlock beside the select while the stage is locked", async () => {
    const db = freshDb();
    const id = await addApp(db, "Locked", { locked: true });
    const { container } = await open(db, id);
    expect($$($(container, ".detail-controls")!, "select, button").map((el) => el.getAttribute("aria-label") ?? text(el))).toEqual(["Set stage", "Unlock", "More actions"]);
  });

  it("lists merge, not an application and delete as menu items", async () => {
    const { db, acme } = await setup();
    const { container } = await open(db, acme);
    await openMenu(container);
    expect(menu(container).getAttribute("aria-expanded")).toBe("true");
    expect($$(container, "[role=menu] [role=menuitem]").map(text)).toEqual(["Merge into…", "Not an application", "Delete"]);
    expect($$(container, "[role=menuitem]").every((b) => b.tagName === "BUTTON")).toBe(true);
    expect($$(container, "[role=menuitem].danger")).toHaveLength(0);
  });

  it("leaves merge out of the menu when it is the only application", async () => {
    const db = freshDb();
    const only = await addApp(db, "Solo");
    const { container } = await open(db, only);
    await openMenu(container);
    expect($$(container, "[role=menuitem]").map(text)).toEqual(["Not an application", "Delete"]);
  });
});

describe("merge and delete", () => {
  it("merges into another application from an inline step and goes to it", async () => {
    const { db, account, acme, other } = await setup();
    await addMail(db, account, acme, { subject: "Moves across" });
    const m = await open(db, acme);
    expect($(m.container, "select[aria-label='Merge into']")).toBeNull();   // not on the page until asked for
    await openMenu(m.container);
    await click(item(m.container, "Merge into…"));
    expect($(m.container, "[role=menu]")).toBeNull();
    const select = $(m.container, "select[aria-label='Merge into']") as HTMLSelectElement;
    expect($$(select, "option").map(text)).toEqual(["Beta · Engineer"]);
    expect(document.activeElement).toBe(select);
    expect(button(m.container, "Cancel")).not.toBeNull();
    expect(text($(m.container, ".detail-step .help")!)).toContain("move across");
    await click(button(m.container, "Merge"));
    expect(window.confirm).not.toHaveBeenCalled();   // the inline step is the confirmation
    expect(m.visited.at(-1)).toBe(`/app/${other}`);
    expect(await db.applications.get(acme)).toBeUndefined();
    expect((await db.emails.toArray())[0].applicationId).toBe(other);
  });

  it("cancels the merge step without merging, and returns focus to More", async () => {
    const { db, acme } = await setup();
    const m = await open(db, acme);
    await openMenu(m.container);
    await click(item(m.container, "Merge into…"));
    await click(button(m.container, "Cancel"));
    expect($(m.container, "select[aria-label='Merge into']")).toBeNull();
    expect(document.activeElement).toBe(menu(m.container));
    expect(m.visited).toEqual([]);
    expect(await db.applications.get(acme)).toBeDefined();
  });

  it("asks which delete, in the page rather than a browser dialog", async () => {
    const { db, acme } = await setup();
    const m = await open(db, acme);
    await openMenu(m.container);
    await click(item(m.container, "Delete"));
    const step = $(m.container, ".detail-step")!;
    expect($$(step, "button").map(text)).toEqual(["Delete the application and its emails", "Delete the application, keep emails for review", "Cancel"]);
    expect($$(step, "button.danger")).toHaveLength(2);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(await db.applications.get(acme)).toBeDefined();
  });

  it("deletes with its emails and returns to the list", async () => {
    const { db, account, acme } = await setup();
    await addMail(db, account, acme);
    const m = await open(db, acme);
    await openMenu(m.container);
    await click(item(m.container, "Delete"));
    await click(button(m.container, "Delete the application and its emails"));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(m.visited.at(-1)).toBe("/");
    expect(await db.applications.get(acme)).toBeUndefined();
    const [kept] = await db.emails.toArray();   // the row stays so a sync does not read it again, but its content is erased
    expect([kept.applicationId, kept.subject, kept.body]).toEqual([null, null, null]);
  });

  it("deletes but keeps the emails for review", async () => {
    const { db, account, acme } = await setup();
    await addMail(db, account, acme);
    const m = await open(db, acme);
    await openMenu(m.container);
    await click(item(m.container, "Delete"));
    await click(button(m.container, "Delete the application, keep emails for review"));
    expect(m.visited.at(-1)).toBe("/");
    const [mail] = await db.emails.toArray();
    expect([mail.applicationId, mail.needsReview, mail.hold]).toEqual([null, true, true]);
  });

  it("does nothing when you cancel the delete step, and Escape closes it", async () => {
    const { db, acme } = await setup();
    const m = await open(db, acme);
    await openMenu(m.container);
    await click(item(m.container, "Delete"));
    await click(button(m.container, "Cancel"));
    expect($(m.container, ".detail-step")).toBeNull();
    expect(m.visited).toEqual([]);
    expect(await db.applications.get(acme)).toBeDefined();
    await openMenu(m.container);
    await click(item(m.container, "Delete"));
    await key($(m.container, ".detail-step")!.querySelector("button"), "Escape");
    expect($(m.container, ".detail-step")).toBeNull();
    expect(document.activeElement).toBe(menu(m.container));
  });

  it("removes it as not an application and carries the message to Needs review", async () => {
    const { db, account, acme } = await setup();
    await addMail(db, account, acme);
    const m = await open(db, acme);
    await openMenu(m.container);
    await click(item(m.container, "Not an application"));
    expect(window.confirm).toHaveBeenCalled();
    expect(m.visited.at(-1)).toBe("/review");
    expect(peekFlash()).toContain("Removed Acme.");
    expect(await db.applications.get(acme)).toBeUndefined();
  });

  it("keeps the application when the not-an-application confirm is declined", async () => {
    const { db, acme } = await setup();
    window.confirm = vi.fn(() => false);
    const m = await open(db, acme);
    await openMenu(m.container);
    await click(item(m.container, "Not an application"));
    expect(m.visited).toEqual([]);
    expect(await db.applications.get(acme)).toBeDefined();
  });
});

describe("the page layout", () => {
  it("sets the emails in a tight list of cards", async () => {
    const { db, account, acme } = await setup();
    await addMail(db, account, acme, { subject: "One", when: daysAgo(2) });
    await addMail(db, account, acme, { subject: "Two", when: daysAgo(1) });
    const { container } = await open(db, acme);
    const list = $(container, "ul.timeline")!;
    expect($$(list, ":scope > li > article.card")).toHaveLength(2);
  });
});

describe("people and emails", () => {
  it("groups the people under the application, with their kind and title", async () => {
    const { db, account, acme, other } = await setup();
    await addMail(db, account, acme, { sender: "Pat Lee <pat@acme.com>", body: "Pat Lee Senior Recruiter Acme", subject: "Hello" });
    await addMail(db, account, other, { sender: "Sam Roe <sam@beta.com>", body: "Sam Roe Hiring Manager Beta", subject: "Other" });
    const { container } = await open(db, acme);
    const people = $$(container, "section[aria-labelledby=h-people] ul.people > li");
    expect(people).toHaveLength(1);
    expect(text($(people[0], ".person-name, .person-head strong"))).toBe("Pat Lee");
    expect(text($(people[0], ".tag"))).toBe("Recruiter");
    expect(text($(people[0], ".person-title"))).toBe("Senior Recruiter");
    const email = $(people[0], "a.btn.primary")!;
    expect(text(email)).toBe("Email Pat");
    expect(email.getAttribute("target")).toBe("_blank");
    expect(email.getAttribute("rel")).toBe("noopener noreferrer");
    expect(email.getAttribute("href")).toContain("https://mail.google.com/mail/");
    expect(text(container)).not.toContain("Sam Roe");
  });

  it("says when there are no people", async () => {
    const { db, acme } = await setup();
    const { container } = await open(db, acme);
    expect(text($(container, "section[aria-labelledby=h-people]"))).toContain("No people yet.");
  });

  it("edits a person in place", async () => {
    const { db, account, acme } = await setup();
    await addMail(db, account, acme, { sender: "Pat Lee <pat@acme.com>", body: "Pat Lee Senior Recruiter Acme" });
    const { container } = await open(db, acme);
    await type($(container, "input[name=title]"), "Hiring manager");
    await click(button($$(container, ".person details.action").at(-1)!, "Save"));
    await waitFor(() => text($(container, ".person-title")) === "Hiring manager");
    expect(text($(container, ".person .tag:nth-of-type(1)"))).toBe("Hiring side");
    expect($$(container, ".person .tag").map(text)).toContain("Edited by you");
    expect(text($(container, ".notice"))).toBe("Saved.");
  });

  it("lists emails newest first with the latest marked and no clickable links in the text", async () => {
    const { db, account, acme } = await setup();
    await addMail(db, account, acme, { subject: "Older", when: daysAgo(5), body: "Old news." });
    await addMail(db, account, acme, { subject: "Newer", when: daysAgo(1), body: "Visit https://careers.acme.com/jobs/1?x=2 now.", event: "interview" });
    const { container } = await open(db, acme);
    const cards = $$(container, "article.card");
    expect(cards.map((c) => text($(c, ".mail-subject")))).toEqual(["Newer", "Older"]);
    expect(cards.map((c) => c.id)).toEqual([expect.stringMatching(/^email-\d+$/), expect.stringMatching(/^email-\d+$/)]);
    expect($$(cards[0], ".tag.latest")).toHaveLength(1);
    expect($$(cards[1], ".tag.latest")).toHaveLength(0);
    expect(text($(cards[0], ".mail-guess"))).toBe("Read as Interview (high confidence)");
    const url = $(cards[0], ".mail-text .url")!;
    expect(url.tagName).toBe("SPAN");
    expect(url.textContent).toBe("careers.acme.com");
    expect($$(cards[0], ".mail-text a")).toHaveLength(0);
    expect(text($(cards[0], ".mail-meta .when"))).toMatch(/Latest .* · yesterday · Gmail me@gmail.com|Latest .* ago · Gmail me@gmail.com|Latest .*Gmail me@gmail.com/);
    expect(text($(cards[0], "a.btn:not(.primary)"))).toBe("Open in Gmail");
  });

  it("says when no emails are linked, and that it was added by hand", async () => {
    const db = freshDb();
    const id = await addApp(db, "Hand");
    await db.applications.update(id, { manual: true });
    const { container } = await open(db, id);
    expect(text(container)).toContain("No emails linked (added manually).");
  });

  it("renders a hostile subject, sender and body as plain text", async () => {
    const { db, account, acme } = await setup();
    await addMail(db, account, acme, {
      subject: "<script>alert(1)</script> Offer", sender: "<img src=x onerror=alert(1)> <evil@x.com>", body: "<script>alert(2)</script> hello <a href=\"javascript:alert(3)\">click</a>",
    });
    const { container } = await open(db, acme);
    expect($(container, "script")).toBeNull();
    expect($(container, "article img")).toBeNull();
    expect($$(container, "article a").map((a) => a.getAttribute("href") ?? "").every((h) => h.startsWith("https://"))).toBe(true);
    expect(text($(container, "article .mail-subject"))).toBe("<script>alert(1)</script> Offer");
    expect(text($(container, "article .mail-text"))).toContain("<script>alert(2)</script> hello");
  });

  it("brings the email named in ?email= into view", async () => {
    const { db, account, acme } = await setup();
    await addMail(db, account, acme, { subject: "First" });
    const wanted = await addMail(db, account, acme, { subject: "Second", when: daysAgo(3) });
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    try {
      await open(db, acme, `?email=${wanted}`);
      expect(scrolled).toEqual([`email-${wanted}`]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});

describe("the posting link", () => {
  const link = (c: ParentNode) => $$(c, "a").find((a) => text(a) === "Open posting") ?? null;

  it("is an Open posting link that opens safely in a new tab, with the host as its title", async () => {
    const { db, acme } = await setup();
    await db.applications.update(acme, { postingUrl: "https://boards.greenhouse.io/acme/jobs/1" });
    const { container } = await open(db, acme);
    const a = link(container)!;
    expect(a).not.toBeNull();
    expect(a.getAttribute("href")).toBe("https://boards.greenhouse.io/acme/jobs/1");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.getAttribute("title")).toBe("boards.greenhouse.io");
    const icon = $(a, "svg")!;
    expect([icon.getAttribute("width"), icon.getAttribute("height"), icon.getAttribute("stroke-width")]).toEqual(["16", "16", "3"]);
    expect(a.classList.contains("primary")).toBe(false);
    expect($$(container, ".card:not(article)")).toHaveLength(1);
  });

  it("is not there when there is no link", async () => {
    const { db, acme } = await setup();
    const { container } = await open(db, acme);
    expect(link(container)).toBeNull();
    expect($$(container, "a[target=_blank]")).toHaveLength(0);
  });

  it.each([
    ["javascript:alert(1)"], ["data:text/html,<b>x</b>"], ["https://user:pw@example.com/x"], ["ftp://example.com/x"], ["not a link"], [""],
  ])("does not render %s as a link even if it is in the database", async (bad) => {
    const { db, acme } = await setup();
    await db.applications.update(acme, { postingUrl: bad });
    const { container } = await open(db, acme);
    expect(link(container)).toBeNull();
    expect($$(container, "a").some((a) => /^(javascript|data|ftp):/i.test(a.getAttribute("href") ?? ""))).toBe(false);
  });

  it("shows markup-looking text as text, never as elements", async () => {
    const { db, acme } = await setup();
    const evil = "https://example.com/\"><img src=x onerror=alert(1)>";
    await db.applications.update(acme, { postingUrl: evil });
    const { container } = await open(db, acme);
    expect($(container, "img")).toBeNull();
    for (const a of $$(container, "a")) expect(a.getAttribute("href") ?? "").not.toContain("<");
    // the value is only ever put in a field as its value, not as markup
    const input = $(container, "#ed-url") as HTMLInputElement;
    expect(input.value).toBe(evil);
  });

  it("is edited in the company and role disclosure, and can be cleared", async () => {
    const { db, acme } = await setup();
    const { container } = await open(db, acme);
    const details = $(container, "details.more")!;
    expect($(details, "label[for=ed-url]")!.textContent).toBe("Posting link (optional)");
    await type($(container, "#ed-url"), " https://example.com/job#top ");
    await click(button(details, "Save"));
    await waitFor(() => link(container) !== null);
    expect(link(container)!.getAttribute("href")).toBe("https://example.com/job");
    expect((await db.applications.get(acme))!.postingUrl).toBe("https://example.com/job");
    await type($(container, "#ed-url"), "");
    await click(button(details, "Save"));
    await waitFor(() => link(container) === null);
    expect("postingUrl" in (await db.applications.get(acme))!).toBe(false);
  });

  it("explains a bad link and keeps the old one", async () => {
    const { db, acme } = await setup();
    await db.applications.update(acme, { postingUrl: "https://example.com/keep" });
    const { container } = await open(db, acme);
    await type($(container, "#ed-url"), "javascript:alert(1)");
    await click(button($(container, "details.more")!, "Save"));
    await waitFor(() => /does not look right/.test(text($(container, ".notice.err, .notice"))));
    expect(text($(container, ".notice.err, .notice"))).toBe("That link does not look right. Use a web address that starts with https://.");
    expect((await db.applications.get(acme))!.postingUrl).toBe("https://example.com/keep");
    expect(link(container)!.getAttribute("href")).toBe("https://example.com/keep");
  });
});
