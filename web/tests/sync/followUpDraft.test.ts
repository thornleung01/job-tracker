import { describe, expect, it, vi } from "vitest";
import { draftLink, followUpDraft, type DraftApp } from "../../src/sync/followUpDraft";
import { replyLink } from "../../src/sync/links";

const TODAY = "2026-11-05";
const app = (o: Partial<DraftApp> = {}): DraftApp => ({ company: "Acme", role: "Data Analyst", appliedAt: "2026-10-14T12:00:00Z", ...o });
const nadia = { name: "Nadia Khan", email: "nadia@acme.com" };

describe("followUpDraft", () => {
  it("writes the subject and a short body to the contact, greeting them by first name", () => {
    expect(followUpDraft(app(), nadia, TODAY)).toEqual({
      to: "nadia@acme.com",
      subject: "Following up on my application for Data Analyst at Acme",
      body: [
        "Hi Nadia,",
        "",
        "I applied for the Data Analyst role at Acme on October 14 and wanted to follow up. Is there any update on my application?",
        "",
        "Thank you for your time.",
      ].join("\n"),
    });
  });

  it("leaves the role out when it is unknown or empty", () => {
    for (const role of ["Unknown role", "", "   "]) {
      const d = followUpDraft(app({ role }), nadia, TODAY);
      expect(d.subject).toBe("Following up on my application at Acme");
      expect(d.body).toContain("I applied to Acme on October 14 and wanted to follow up.");
      expect(d.body).not.toMatch(/Unknown|role/);
    }
  });

  it("has no recipient and a plain greeting when nobody is known", () => {
    const d = followUpDraft(app(), null, TODAY);
    expect(d.to).toBe("");
    expect(d.body.startsWith("Hello,\n")).toBe(true);
  });

  it("greets plainly when the contact has no usable name", () => {
    for (const name of ["", "   ", "nadia@acme.com", "12345", "<<>>"]) {
      expect(followUpDraft(app(), { name, email: "nadia@acme.com" }, TODAY).body.startsWith("Hello,\n")).toBe(true);
    }
  });

  it("doesn't greet by an email address and uses the first word of a name", () => {
    expect(followUpDraft(app(), { name: "Jean-Luc de la Cruz", email: "j@acme.com" }, TODAY).body.startsWith("Hi Jean-Luc,\n")).toBe(true);
  });

  it("names the day without a year this year and with one in another year", () => {
    expect(followUpDraft(app({ appliedAt: "2026-01-03T12:00:00Z" }), nadia, TODAY).body).toContain(" on January 3 and");
    expect(followUpDraft(app({ appliedAt: "2025-12-31T12:00:00Z" }), nadia, TODAY).body).toContain(" on December 31, 2025 and");
    expect(followUpDraft(app({ appliedAt: "2026-10-14" }), nadia, TODAY).body).toContain(" on October 14 and");
  });

  it("leaves the date out when it is unknown or in the future", () => {
    for (const appliedAt of [null, "", "nonsense", "2026-12-01T12:00:00Z"]) {
      const d = followUpDraft(app({ appliedAt }), nadia, TODAY);
      expect(d.body).toContain("I applied for the Data Analyst role at Acme and wanted to follow up.");
    }
  });

  it("reads a stored day the same way in every time zone", () => {
    try {
      const bodies = ["UTC", "America/Toronto", "Pacific/Kiritimati", "Pacific/Pago_Pago"].map((tz) => {
        vi.stubEnv("TZ", tz);
        return followUpDraft(app({ appliedAt: "2026-10-14T12:00:00Z" }), nadia, TODAY).body;
      });
      expect(new Set(bodies).size).toBe(1);
      expect(bodies[0]).toContain("on October 14 ");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("cuts long names to the limits the app saves", () => {
    const d = followUpDraft(app({ company: "C".repeat(500), role: "R".repeat(500) }), { name: "N".repeat(500), email: "n@acme.com" }, TODAY);
    expect(d.subject).toBe(`Following up on my application for ${"R".repeat(100)} at ${"C".repeat(80)}`);
    expect(d.body.split("\n")[0]).toBe(`Hi ${"N".repeat(80)},`);
    expect(d.body).toContain(`${"R".repeat(100)} role at ${"C".repeat(80)} on`);
  });

  it("never splits an emoji when it cuts", () => {
    const d = followUpDraft(app({ company: "\u{1F600}".repeat(200) }), nadia, TODAY);
    expect(d.subject).toContain("\u{1F600}".repeat(80));
    expect(d.subject).not.toContain("\ufffd");
    expect(Array.from(d.subject).every((c) => c !== "\ud83d")).toBe(true);
  });

  it("strips line breaks from the recipient, subject and names, so nothing can add a header", () => {
    const d = followUpDraft(
      app({ company: "Acme\r\nBcc: spy@evil.com", role: "Analyst\nCc: spy@evil.com" }),
      { name: "Nadia\r\nBcc: x@y.z Khan", email: "nadia@acme.com\r\nBcc: spy@evil.com" },
      TODAY,
    );
    expect(d.to).toBe("");               // "nadia@acme.comBcc: spy@evil.com" is not an address
    expect(d.subject).not.toMatch(/[\r\n]/);
    expect(d.subject).toBe("Following up on my application for Analyst Cc: spy@evil.com at Acme Bcc: spy@evil.com");
    expect(d.body.split("\n")[0]).toBe("Hi Nadia,");
    expect(d.body).not.toMatch(/\r/);
    expect(d.body.split("\n")).toHaveLength(5);
  });

  it("removes the line break from an address that is otherwise fine", () => {
    expect(followUpDraft(app(), { name: "Nadia Khan", email: "nad\nia@acme.com" }, TODAY).to).toBe("nadia@acme.com");
  });

  it("uses only an address that passes the address check", () => {
    const bad = ["not an address", "a@b", "a@b.com, c@d.com", "a@b.com;c@d.com", "Nadia <nadia@acme.com>", "a@@b.com", "a b@c.com", "", "no-reply@acme.com", "x".repeat(300) + "@acme.com"];
    for (const email of bad) expect(followUpDraft(app(), { name: "Nadia Khan", email }, TODAY).to, email).toBe("");
    expect(followUpDraft(app(), { name: "Nadia Khan", email: "nadia+jobs@mail.acme.co.uk" }, TODAY).to).toBe("nadia+jobs@mail.acme.co.uk");
  });
});

describe("draftLink", () => {
  const draft = followUpDraft(app(), nadia, TODAY);
  const params = (url: string) => new URL(url).searchParams;

  it("opens a Gmail compose window with the draft in the address", () => {
    const link = draftLink("gmail", "me@gmail.com", draft)!;
    expect(link.label).toBe("Draft follow-up in Gmail");
    const u = new URL(link.url);
    expect(u.origin + u.pathname).toBe("https://mail.google.com/mail/");
    expect(params(link.url).get("authuser")).toBe("me@gmail.com");
    expect(params(link.url).get("view")).toBe("cm");
    expect(params(link.url).get("to")).toBe("nadia@acme.com");
    expect(params(link.url).get("su")).toBe(draft.subject);
    expect(params(link.url).get("body")).toBe(draft.body);
    expect(link.url).toContain("body=Hi%20Nadia%2C%0A%0AI%20applied");
  });

  it("opens an Outlook deeplink: work accounts on outlook.office.com, personal ones on outlook.live.com", () => {
    expect(draftLink("outlook", "me@contoso.com", draft)!.url.startsWith("https://outlook.office.com/mail/deeplink/compose?")).toBe(true);
    expect(draftLink("outlook", "me@outlook.com", draft)!.url.startsWith("https://outlook.live.com/mail/0/deeplink/compose?")).toBe(true);
    expect(draftLink("outlook", "me@hotmail.com", draft)!.url.startsWith("https://outlook.live.com/")).toBe(true);
    expect(draftLink("outlook", null, draft)!.url.startsWith("https://outlook.live.com/")).toBe(true);
    expect(draftLink("outlook", "me@outlook.com", draft, "https://outlook.office.com/owa/?ItemID=1")!.url.startsWith("https://outlook.office.com/")).toBe(true);
    const link = draftLink("outlook", "me@outlook.com", draft)!;
    expect(link.label).toBe("Draft follow-up in Outlook");
    expect(params(link.url).get("to")).toBe("nadia@acme.com");
    expect(params(link.url).get("subject")).toBe(draft.subject);
    expect(params(link.url).get("body")).toBe(draft.body);
  });

  it("picks the same host as a reply link for the same account", () => {
    const sender = "Nadia Khan <nadia@acme.com>";
    const cases: [string, string | null, string | null][] = [
      ["outlook", "me@outlook.com", null], ["outlook", "me@contoso.com", null], ["outlook", "me@live.com", null], ["outlook", "me@msn.com", null],
      ["outlook", null, null], ["outlook", "me@outlook.com", "https://outlook.office.com/x"], ["outlook", "me@outlook.com", "https://outlook.live.com/x"],
      ["gmail", "me@gmail.com", null], ["gmail", "me@work-domain.com", null],
    ];
    for (const [provider, account, webLink] of cases) {
      const reply = replyLink(provider, account, sender, "Hi", webLink)!;
      const mine = draftLink(provider, account, draft, webLink)!;
      expect(new URL(mine.url).host + new URL(mine.url).pathname, `${provider} ${account} ${webLink}`).toBe(new URL(reply.url).host + new URL(reply.url).pathname);
    }
  });

  it("leaves out the recipient when there is none, and still opens a draft", () => {
    const none = followUpDraft(app(), null, TODAY);
    for (const [provider, account] of [["gmail", "me@gmail.com"], ["outlook", "me@contoso.com"]] as const) {
      const link = draftLink(provider, account, none)!;
      expect(params(link.url).has("to")).toBe(false);
      expect(params(link.url).get(provider === "gmail" ? "su" : "subject")).toBe(none.subject);
      expect(link.url).not.toContain("?&");
    }
  });

  it("percent-encodes special characters so they can't end a value or add a parameter", () => {
    const nasty = followUpDraft(app({ company: "A&B #1 100% ?x=y+z 'q' (r) \"s\" é/中\u{1F600}", role: "R\\S" }), nadia, TODAY);
    for (const provider of ["gmail", "outlook"] as const) {
      const link = draftLink(provider, "me@gmail.com", nasty)!;
      const key = provider === "gmail" ? "su" : "subject";
      expect(params(link.url).get(key)).toBe(nasty.subject);
      expect(params(link.url).get("body")).toBe(nasty.body);
      const query = link.url.split("?")[1];
      expect(query).not.toMatch(/[ #"'()<>\\\n\r]/);
      expect(query.split("&").map((p) => p.split("=")[0]).filter((k) => !["authuser", "view", "fs", "to", "su", "subject", "body"].includes(k))).toEqual([]);
      expect(link.url).toContain("A%26B%20%231%20100%25%20%3Fx%3Dy%2Bz");
    }
  });

  it("leaves tags out of the message: a name, company or role from an email can't carry markup into a mail service that shows it", () => {
    const d = followUpDraft(
      app({ company: 'Acme <img src="https://evil.example/x.gif">', role: "Analyst <b>Lead</b>" }),
      { name: "<img/src=//evil.example/p.gif>", email: "nadia@acme.com" },
      TODAY,
    );
    expect(d.subject + d.body).not.toMatch(/[<>]/);
    expect(d.body.startsWith("Hello,\n")).toBe(true);   // that is no name to greet by
    expect(d.subject).toContain("Acme img src=");
    for (const provider of ["gmail", "outlook"] as const) {
      expect(draftLink(provider, "me@gmail.com", d)!.url).not.toMatch(/%3C|%3E/i);
    }
  });

  it("greets by a first name made of letters, and not by anything else", () => {
    const greet = (name: string) => followUpDraft(app(), { name, email: "n@acme.com" }, TODAY).body.split("\n")[0];
    expect(greet("Nadia Khan")).toBe("Hi Nadia,");
    expect(greet("José García")).toBe("Hi José,");
    expect(greet("Siobhán O'Brien")).toBe("Hi Siobhán,");
    expect(greet("Jean-Luc Picard")).toBe("Hi Jean-Luc,");
    expect(greet("太郎 山田")).toBe("Hi 太郎,");
    for (const bad of ["<b>Nadia</b>", "Nad<ia", "Pat&amp;", "x=1", "[Nadia]", "Nadia\u2060"]) expect(greet(bad), bad).toBe(bad === "Nadia\u2060" ? "Hi Nadia," : "Hello,");
  });

  it("strips line breaks from a draft handed in by hand", () => {
    const link = draftLink("gmail", "me@gmail.com", { to: "a@b.com\r\nBcc: x@y.com", subject: "Hi\r\nBcc: x@y.com", body: "one\r\ntwo\rthree\u0000" })!;
    expect(params(link.url).get("to")).toBeNull();
    expect(params(link.url).get("su")).toBe("Hi Bcc: x@y.com");
    expect(params(link.url).get("body")).toBe("one\ntwo\nthree ");
    expect(link.url).not.toMatch(/%0D|%00/);
  });

  it("returns nothing when the mail service is unknown", () => {
    expect(draftLink("yahoo", "me@yahoo.com", draft)).toBeNull();
    expect(draftLink("", "me@gmail.com", draft)).toBeNull();
    expect(draftLink("gmail", null, draft)).toBeNull();
    expect(draftLink("gmail", "", draft)).toBeNull();
  });

  it("only ever returns an https link to Gmail or Outlook", () => {
    for (const [provider, account, web] of [["gmail", "me@gmail.com", null], ["outlook", "me@contoso.com", null], ["outlook", "javascript:alert(1)", "javascript:alert(1)"], ["outlook", "evil.com/@x", null]] as const) {
      const link = draftLink(provider, account, draft, web);
      if (!link) continue;
      const u = new URL(link.url);
      expect(u.protocol).toBe("https:");
      expect(["mail.google.com", "outlook.office.com", "outlook.live.com"]).toContain(u.hostname);
    }
  });
});
