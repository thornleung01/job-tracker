// Ported from tests/test_email_links.py (the link helpers) plus the reply-link rules in links.py.
import { describe, expect, it } from "vitest";
import { mailboxLink, replyLink } from "../../src/pipeline";

describe("mailboxLink", () => {
  it("gmail uses the account and the thread", () => {
    expect(mailboxLink("gmail", "me@gmail.com", "18c2f0a1b2c3d4e5", null)).toEqual([
      "Open in Gmail",
      "https://mail.google.com/mail/?authuser=me%40gmail.com#all/18c2f0a1b2c3d4e5",
    ]);
  });
  it("outlook comes from the stored web link", () => {
    const link = "https://outlook.live.com/owa/?ItemID=AAMk&exvsurl=1&viewmodel=ReadMessageItem";
    expect(mailboxLink("outlook", "me@outlook.com", "conv", link)).toEqual(["Open in Outlook", link]);
  });
  it.each([null, "", "javascript:alert(1)", "http://insecure.example.com/x", "data:text/html,hi"])("outlook without a safe link gives null: %j", (w) => {
    expect(mailboxLink("outlook", "me@outlook.com", "conv", w)).toBeNull();
  });
  it("no link when there is nothing to link to", () => {
    expect(mailboxLink("gmail", "me@gmail.com", null, null)).toBeNull();
    expect(mailboxLink("yahoo", "x@y.com", "t", "https://x")).toBeNull();
  });
});

describe("replyLink", () => {
  it("opens a reply in Gmail with Re: and the subject", () => {
    expect(replyLink("gmail", "me@gmail.com", "Pat Lee <pat@acme.com>", "Interview")).toEqual([
      "Reply in Gmail",
      "https://mail.google.com/mail/?authuser=me%40gmail.com&view=cm&fs=1&to=pat%40acme.com&su=Re%3A%20Interview",
    ]);
  });
  it("does not double the Re:", () => {
    expect(replyLink("gmail", "me@gmail.com", "pat@acme.com", "RE: Hi")![1]).toContain("su=RE%3A%20Hi");
  });
  it("personal outlook accounts and work accounts use different hosts", () => {
    expect(replyLink("outlook", "me@outlook.com", "pat@acme.com", "Hi")![1]).toBe("https://outlook.live.com/mail/0/deeplink/compose?to=pat%40acme.com&subject=Re%3A%20Hi");
    expect(replyLink("outlook", "me@work.example.com", "pat@acme.com", "Hi")![1]).toMatch(/^https:\/\/outlook\.office\.com\/mail\/deeplink\/compose/);
  });
  it.each(["no-reply@acme.com", "Acme <do-not-reply@acme.com>", "A <donotreply@acme.com>", "A <mailer-daemon@acme.com>", "A <notifications@acme.com>", "Pat <not an address>", "", "Pat"])(
    "senders that cannot be replied to get none: %j",
    (s) => expect(replyLink("gmail", "me@gmail.com", s, "x")).toBeNull(),
  );
});

describe("replyLink: which Outlook an account belongs to", () => {
  const host = (account: string) => replyLink("outlook", account, "pat@acme.com", "Hi")![1].split("/deeplink")[0];
  it.each([
    ["me@outlook.com", "https://outlook.live.com/mail/0"],
    ["me@hotmail.co.uk", "https://outlook.live.com/mail/0"],
    ["me@live.ca", "https://outlook.live.com/mail/0"],
    ["me@hotmail.com.au", "https://outlook.live.com/mail/0"],
    ["me@Outlook.COM", "https://outlook.live.com/mail/0"],
    ["pat@olive.com", "https://outlook.office.com/mail"],
    ["pat@alive.com", "https://outlook.office.com/mail"],
    ["pat@acme-outlook.com", "https://outlook.office.com/mail"],
    ["pat@acme.com", "https://outlook.office.com/mail"],
  ])("%s", (account, expected) => expect(host(account)).toBe(expected));
});
