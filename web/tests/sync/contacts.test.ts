// Port of the data-level parts of tests/test_contacts.py.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as contacts from "../../src/sync/contacts";
import { ContactKeyError } from "../../src/sync/contacts";
import { createApplication, upsertAccount } from "../../src/db/repo";
import { closeAll, freshDb } from "./helpers";

afterEach(closeAll);

let db: ReturnType<typeof freshDb>;
let acct: number;
let app1: number;
let app2: number;
let n = 0;

beforeEach(async () => {
  db = freshDb();
  acct = await upsertAccount(db, "gmail", "me@gmail.com");
  app1 = await createApplication(db, { company: "DoorDash", companyKey: "doordash", role: "Analyst", roleKey: "analyst", stage: "Interview", when: "2026-10-01T09:00:00Z" });
  app2 = await createApplication(db, { company: "Deel", companyKey: "deel", role: "Manager", roleKey: "manager", stage: "Applied", when: "2026-10-02T09:00:00Z" });
});

async function add(sender: string, body: string, app: number, when = "2026-10-05T10:00:00Z", subject = "Hello", review = false) {
  await db.emails.add({
    accountId: acct, providerMsgId: `m${n++}`, threadId: "t", receivedAt: when, sender, subject, body, related: true, event: "interview",
    confidence: "high", applicationId: review ? null : app, needsReview: review, webLink: null, bulk: false, hold: false, reason: null,
  });
}
const byName = async (appId?: number) => Object.fromEntries((await contacts.derive(db, appId)).map((c) => [c.name, c]));

describe("titles in signatures", () => {
  const cases: [string, string, string][] = [
    ["Sofia Hart <sofia.hart@doordash.com>", "Thanks!\nSara\nSofia Hart\nSales Sourcer\nDoorDash / Wolt\nsofia.hart@doordash.com\n", "Sales Sourcer"],
    ["Jocelyn Ford <jocelyn.ford@doordash.com>", "Best,\nJocelyn Ford Senior Business Recruiter DoorDash / Wolt jocelyn.ford@doordash.com", "Senior Business Recruiter"],
    ["Samuel Okafor <sam.okafor@deel.com>", "Talk soon,\nSam Senior Talent Acquisition Specialist @ Deel 650 2nd Street, San Francisco, CA 94107", "Senior Talent Acquisition Specialist"],
    ["Nadia De La Cruz <nadia.delacruz@deel.com>", "Regards!\n--\nNadia De La Cruz People Operations Specialist\nnadia.delacruz@deel.com", "People Operations Specialist"],
    ["Camila Reyes <camila.reyes@ext.doordash.com>", "Camila Reyes Contingent Worker DoorDash / Wolt camila.reyes@ext.doordash.com", "Contingent Worker"],
  ];
  it.each(cases)("reads %s", async (sender, body, title) => {
    await add(sender, body, app1);
    const people = await contacts.derive(db);
    expect(people).toHaveLength(1);
    expect(people[0].title).toBe(title);
    expect(people[0].email).toBe(sender.split("<")[1].replace(">", ""));
    expect(people[0].appId).toBe(app1);
  });

  it("does not take a sentence after a name for a title", async () => {
    await add("Pat Lee <pat@acme.com>", "Pat Lee has invited you to attend: DoorDash Zoom Interview. Hi Pat, thanks for the update!", app1);
    expect((await byName())["Pat Lee"].title).toBe("");
  });

  it("takes a title from 'I'm on the team'", async () => {
    await add("Nadia Cruz <nadia@deel.com>", "Hi Jordan, Nice to e-meet you! I'm Nadia, from the People OPS team. Just reaching out.", app2);
    expect((await byName())["Nadia Cruz"].title).toBe("People OPS team");
  });

  it("groups kinds", () => {
    expect(contacts.kindOf("Senior Business Recruiter")).toBe("recruiter");
    expect(contacts.kindOf("Sales Sourcer")).toBe("recruiter");
    expect(contacts.kindOf("Director, New Verticals")).toBe("hiring");
    expect(contacts.kindOf("General Manager, Rapid Retail Canada")).toBe("hiring");
    expect(contacts.kindOf("People Operations Specialist")).toBe("people");
    expect(contacts.kindOf("Contingent Worker")).toBe("");
  });
});

describe("people named in invites", () => {
  it("finds them with their titles", async () => {
    await add("Camila Reyes <camila.reyes@ext.doordash.com>",
      "Schedule - Thu Oct 15 - 10:00AM (EDT)\n10:00AM (EDT) - 10:45AM (EDT): Brandon Doyle (Senior Manager, Strategy and Operations)\n" +
      "Ben Hallett-Berry (Manager, Strategy & Operations - DashMart Canada)\nDoorDash Zoom Interview (EDT) | 30 minutes", app1);
    const people = await byName();
    expect(people["Brandon Doyle"].title).toBe("Senior Manager, Strategy and Operations");
    expect(people["Brandon Doyle"].mentionedOnly).toBe(true);
    expect(people["Brandon Doyle"].email).toBe("");
    expect(people["Ben Hallett-Berry"].title).toBe("Manager, Strategy & Operations");
    expect(people["Brandon Doyle"].company).toBe("DoorDash");
    expect(people["DoorDash Zoom Interview"]).toBeUndefined();
    expect(people["Brandon Doyle"].compose).toBeNull();
  });

  it("does not glue a sender's first name onto a named person", async () => {
    await add("Jocelyn Ford <jocelyn.ford@doordash.com>", "Best,\nJocelyn\nKatie Ellison (Director, New Verticals) | 30 minutes", app1);
    const names = new Set(Object.keys(await byName()));
    expect(names.has("Katie Ellison")).toBe(true);
    expect(names.has("Jocelyn Katie Ellison")).toBe(false);
  });

  it("treats a sender who is also named in an invite as one person", async () => {
    await add("Sofia Hart <sofia.hart@doordash.com>", "Sofia Hart Sales Sourcer DoorDash", app1, "2026-10-04T00:00:00Z");
    await add("Camila Reyes <camila.reyes@ext.doordash.com>", "10:00AM: Sofia Hart (Sales Sourcer)", app1, "2026-10-06T00:00:00Z");
    const people = await contacts.derive(db);
    expect(people.filter((c) => c.name === "Sofia Hart")).toHaveLength(1);
    const s = people.find((c) => c.name === "Sofia Hart")!;
    expect([s.email, s.emails]).toEqual(["sofia.hart@doordash.com", 1]);
    expect(s.last.startsWith("2026-10-06")).toBe(true);
  });
});

describe("one application at a time", () => {
  it("lists the same person separately with each application's title", async () => {
    await add("Sam Lee <sam@staffing.com>", "Best,\nSam Lee Senior Recruiter Staffing Co sam@staffing.com", app1, "2026-10-04T00:00:00Z");
    await add("Sam Lee <sam@staffing.com>", "Cheers,\nSam Lee Hiring Manager Staffing Co sam@staffing.com", app2, "2026-10-06T00:00:00Z");
    const people = await contacts.derive(db);
    expect(people).toHaveLength(2);
    expect(new Set(people.map((c) => `${c.appId}:${c.title}`))).toEqual(new Set([`${app1}:Senior Recruiter`, `${app2}:Hiring Manager`]));
    expect(await contacts.titles(db, app2)).toEqual({ "sam@staffing.com": "Hiring Manager" });
  });

  it("lists nobody for mail waiting in review, and never your own addresses", async () => {
    await add("Gabe Barros <gabe.barros@deel.com>", "See you then.", app2, undefined, "Hello", true);
    await add("Jordan Lee <me@gmail.com>", "Jordan Lee Senior Analyst", app1);
    expect(await contacts.derive(db)).toEqual([]);
  });

  it.each([
    "Deel HQ Hiring Team <no-reply@deel.com>", "Shopify Hiring Team <recruiting@talent.shopify.com>", "people.team@deel.com <people.team@deel.com>",
    "LinkedIn <jobs-noreply@linkedin.com>", "Instacart <no-reply@instacart.com>", "Pat <pat@acme.com>", "clio@myworkday.com <clio@myworkday.com>",
  ])("does not list %s as a person", async (sender) => {
    await add(sender, "Thanks for applying. Regards, The Recruiting Team", app1);
    expect(await contacts.derive(db)).toEqual([]);
  });
});

describe("corrections", () => {
  it("apply to one application and survive new mail", async () => {
    await add("Dana Whitfield <dw@deel.com>", "Confirmed. Your event has been scheduled.", app2);
    await add("Dana Whitfield <dw@deel.com>", "Confirmed. Your event has been scheduled.", app1);
    await contacts.saveEdit(db, `${app2}|dw@deel.com`, "Danielle Whitfield", "  Hiring   Manager ");
    await add("Dana Whitfield <dw@deel.com>", "Dana Whitfield Head of Strategy dw@deel.com", app2, "2026-10-09T00:00:00Z");
    const here = (await contacts.derive(db, app2))[0];
    expect([here.name, here.title, here.kind, here.edited]).toEqual(["Danielle Whitfield", "Hiring Manager", "hiring", true]);
    const other = (await contacts.derive(db, app1))[0];
    expect([other.name, other.title, other.edited]).toEqual(["Dana Whitfield", "", false]);
  });

  it("keep a hidden name hidden", async () => {
    await add("Gabe Barros <gabe.barros@deel.com>", "See you then.", app2);
    await contacts.hide(db, `${app2}|gabe.barros@deel.com`);
    await add("Gabe Barros <gabe.barros@deel.com>", "Another.", app2, "2026-10-09T00:00:00Z");
    expect(await contacts.derive(db)).toEqual([]);
  });

  it.each(["", "not a key", "dw@deel.com", "name:abc", "x|dw@deel.com", "1|a b@c.d", "1|name:UPPER", "1|name:", "1|x@y@z"])("refuse the key %j", async (key) => {
    await expect(contacts.saveEdit(db, key, "x", "x")).rejects.toBeInstanceOf(ContactKeyError);
    await expect(contacts.hide(db, key)).rejects.toBeInstanceOf(ContactKeyError);
    expect(await db.contactEdits.count()).toBe(0);
  });
});

describe("the emails connected to each person", () => {
  it("lists them newest first, from this application only", async () => {
    await add("Sofia Hart <sofia.hart@doordash.com>", "Sofia Hart Sales Sourcer DoorDash", app1, "2026-10-03T10:00:00Z", "Intro call");
    await add("Sofia Hart <sofia.hart@doordash.com>", "Following up.", app1, "2026-10-07T10:00:00Z", "Next steps");
    await add("Camila Reyes <camila.reyes@ext.doordash.com>", "10:00AM: Sofia Hart (Sales Sourcer) joins", app1, "2026-10-05T10:00:00Z", "Zoom invite");
    await add("Sofia Hart <sofia.hart@doordash.com>", "A different job entirely.", app2, undefined, "Other application");
    const s = (await byName(app1))["Sofia Hart"];
    expect(s.mails.map((m) => [m.subject, m.how])).toEqual([["Next steps", "from"], ["Zoom invite", "mentions"], ["Intro call", "from"]]);
    expect([s.mailCount, s.latestMail?.subject]).toEqual([3, "Next steps"]);
  });

  it("builds a compose link in the mailbox their latest email reached", async () => {
    await add("Pat Lee <pat@acme.com>", "Pat Lee Senior Recruiter", app1, "2026-10-03T10:00:00Z", "Hello");
    await add("Pat Lee <pat@acme.com>", "Pat Lee Senior Recruiter", app1, "2026-10-06T10:00:00Z", "Interview times");
    const [pat] = await contacts.derive(db);
    expect(pat.compose?.label).toBe("Reply in Gmail");
    expect(pat.compose?.url.startsWith("https://mail.google.com/mail/?authuser=me%40gmail.com&view=cm")).toBe(true);
    expect(pat.compose?.url).toContain("to=pat%40acme.com");
    expect(pat.compose?.url).toContain("su=Re%3A%20Interview%20times");
  });

  it("caps the list at MAX_MAILS but counts them all", async () => {
    for (let i = 0; i < contacts.MAX_MAILS + 5; i++) {
      const hour = String(i % 24).padStart(2, "0");
      await add("Pat Lee <pat@acme.com>", "Pat Lee Senior Recruiter", app1, `2026-10-${String(1 + Math.floor(i / 24)).padStart(2, "0")}T${hour}:00:00Z`, `Message ${i}`);
    }
    const [pat] = await contacts.derive(db);
    expect([pat.mails.length, pat.mailCount]).toEqual([contacts.MAX_MAILS, contacts.MAX_MAILS + 5]);
  });
});
