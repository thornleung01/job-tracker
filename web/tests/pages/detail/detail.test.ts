import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $, $$, addApp, addMail, button, cleanup, click, daysAgo, freshDb, mountPage, submitForm, text, type, waitFor } from "../applications/harness";
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
    await type($(container, "select[aria-label='Set stage']"), "Interview");
    await click(button(container, "Set stage"));
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

describe("merge and delete", () => {
  it("merges into another application and goes to it", async () => {
    const { db, account, acme, other } = await setup();
    await addMail(db, account, acme, { subject: "Moves across" });
    const m = await open(db, acme);
    const select = $(m.container, "select[aria-label='Merge into']") as HTMLSelectElement;
    expect($$(select, "option").map(text)).toEqual(["Beta · Engineer"]);
    await click(button(m.container, "Merge into…"));
    expect(window.confirm).toHaveBeenCalled();
    expect(m.visited.at(-1)).toBe(`/app/${other}`);
    expect(await db.applications.get(acme)).toBeUndefined();
    expect((await db.emails.toArray())[0].applicationId).toBe(other);
  });

  it("offers no merge when it is the only application", async () => {
    const db = freshDb();
    const only = await addApp(db, "Solo");
    const { container } = await open(db, only);
    expect($(container, "select[aria-label='Merge into']")).toBeNull();
  });

  it("deletes with its emails and returns to the list", async () => {
    const { db, account, acme } = await setup();
    await addMail(db, account, acme);
    const m = await open(db, acme);
    await click(button(m.container, "Delete"));
    expect(m.visited.at(-1)).toBe("/");
    expect(await db.applications.get(acme)).toBeUndefined();
    const [kept] = await db.emails.toArray();   // the row stays so a sync does not read it again, but its content is erased
    expect([kept.applicationId, kept.subject, kept.body]).toEqual([null, null, null]);
  });

  it("deletes but keeps the emails for review", async () => {
    const { db, account, acme } = await setup();
    await addMail(db, account, acme);
    const m = await open(db, acme);
    await click(button(m.container, "Delete, keep emails for review"));
    expect(m.visited.at(-1)).toBe("/");
    const [mail] = await db.emails.toArray();
    expect([mail.applicationId, mail.needsReview, mail.hold]).toEqual([null, true, true]);
  });

  it("does nothing when you decline", async () => {
    const { db, acme } = await setup();
    window.confirm = vi.fn(() => false);
    const m = await open(db, acme);
    await click(button(m.container, "Delete"));
    expect(m.visited).toEqual([]);
    expect(await db.applications.get(acme)).toBeDefined();
  });

  it("removes it as not an application and carries the message to Needs review", async () => {
    const { db, account, acme } = await setup();
    await addMail(db, account, acme);
    const m = await open(db, acme);
    await click(button(m.container, "Not an application"));
    expect(m.visited.at(-1)).toBe("/review");
    expect(peekFlash()).toContain("Removed Acme.");
    expect(await db.applications.get(acme)).toBeUndefined();
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
