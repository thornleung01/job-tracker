// Ported from tests/test_mailtext.py. Samples are the shapes of real mail that looked bad.
import { describe, expect, it } from "vitest";
import { parts, render, splitSender } from "../../src/pipeline";
import { textOf } from "./helpers";

const DEEL =
  "Hi Jordan,\nAt this time we don't provide RRSP match for folks in Canada.\u{a0}\nRegarding our other benefits, please see them below!\n-\n Team Member \n" +
  "Referrals:\n you get a referral bonus if someone you refer is hired.\n- Customer Referral Policy\n: you can send business leads to Sales.\n" +
  "- Flexible Time Off\n: 12 paid holidays\u{a0}+ up to 18 paid personal days\nBest,\nSam\n" +
  "On Fri, Oct 23, 2026 at 4:49 PM Jordan Lee <\njordan.lee@outlook.com\n> wrote:\nEXT SENDER\u{2013} Be cautious \nHi Samantha,\u{a0}\nThanks for sending this over.\n";

const NEWSLETTER =
  "Inside: Tesla SQL challenge, ML vs. AI vs. LLM roles, and AI's hype-vs-numbers problem  " +
  "( https://platform.stratascratch.com/coding?code_type=1&page_size=100&utm_source=newsletter&utm_medium=email&utm_campaign=102026 )  " +
  "*Platform Updates* " + "\u{34f} ".repeat(30) + "\n\nBuild confidence in your interview prep with new questions every week and a cohort of people preparing alongside you.\n\n" +
  "This email was intended for Jordan Lee. Learn why we included this. You are receiving notification emails. Unsubscribe \u{b7} Help \u{a9} 2026 LinkedIn Corporation";

const OUTLOOK_HEADER =
  "Thanks, talk soon!\nBest,\nJordan\nFrom:\nSamuel Okafor <sam.okafor@deel.com>\nSent:\nThursday, October 22, 2026 6:43 PM\n" +
  "To:\njordan.lee@outlook.com\nSubject:\nUpdate From Deel\nHi Jordan,\nThank you for taking the time to meet with Dan!";

it("lines broken mid-sentence are joined and glued punctuation is repaired", () => {
  const [main] = parts(DEEL);
  const joined = main.join(" | ");
  expect(joined).toContain("Team Member Referrals:");
  expect(joined).toContain("Customer Referral Policy: you can send business leads to Sales.");
  expect(joined).toContain("12 paid holidays + up to 18 paid personal days");
  expect(main[0]).toBe("Hi Jordan,");
  expect(main).toContain("Best,");
});

it("the reply chain is folded and the warning banner is dropped", () => {
  const [main, thread] = parts(DEEL);
  expect(main.some((b) => b.includes("wrote:"))).toBe(false);
  expect(thread[0].endsWith("wrote:")).toBe(true);
  expect(thread[0]).toBe("On Fri, Oct 23, 2026 at 4:49 PM Jordan Lee < jordan.lee@outlook.com > wrote:");
  expect([...main, ...thread].every((b) => !b.includes("EXT SENDER"))).toBe(true);
  const html = render(DEEL);
  expect(html.split("<details").length - 1).toBe(1);
  expect(html.indexOf("Earlier in this thread")).toBeGreaterThan(html.indexOf("Flexible Time Off"));
});

it("list items become a list", () => {
  const html = render(DEEL);
  expect(html.split("<ul>").length - 1).toBe(1);
  expect(html.split("<li>").length - 1).toBe(3);
});

it("links show their domain and are never clickable", () => {
  const html = render(NEWSLETTER);
  expect(html).toContain('class="url" title="https://platform.stratascratch.com/coding?');
  expect(html).toContain(">platform.stratascratch.com</span>");
  expect(html).not.toContain("<a ");
  expect(html).not.toContain("href=");
  expect(textOf(html)).not.toContain("utm_source");
});

it("invisible padding and the footer are cleaned up", () => {
  const [main, , footer] = parts(NEWSLETTER);
  expect((main.join("") + footer.join("")).includes("\u{34f}")).toBe(false);
  expect(main.some((b) => b.includes("Build confidence"))).toBe(true);
  expect(main.some((b) => b.includes("Unsubscribe"))).toBe(false);
  expect(footer.join(" ")).toContain("Unsubscribe");
  expect(render(NEWSLETTER)).toContain("Footer and links");
});

it("a 'view online' line at the top is not mistaken for a footer", () => {
  const [main, , footer] = parts("Having trouble viewing? View this email online.\n\nWe would like to invite you to interview for the analyst role at Acme next week.");
  expect(footer).toEqual([]);
  expect(main.length).toBe(2);
});

it("everything is escaped", () => {
  const html = render("<script>alert(1)</script> hello\n\nSee https://evil.example.com/?x=\"><img src=x onerror=alert(1)> now");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;script&gt;");
  expect(html.replaceAll("&gt;", "")).not.toContain("onerror=alert(1)>");
});

it("a message that is only a quote is not folded away", () => {
  const [main, thread] = parts("> Hi there\n> thanks for applying");
  expect(main.length).toBeGreaterThan(0);
  expect(thread).toEqual([]);
});

it.each(["", null, undefined, "   \n  "])("empty and missing text say so: %j", (empty) => {
  expect(render(empty)).toContain("No text was stored");
});

it.each([
  ["Pat Lee <pat@acme.com>", "Pat Lee", "pat@acme.com"],
  ['"Lee, Pat" <pat@acme.com>', "Lee, Pat", "pat@acme.com"],
  ["pat@acme.com <pat@acme.com>", "pat@acme.com", "pat@acme.com"],
  ["pat@acme.com", "", "pat@acme.com"],
  ["", "", ""],
])("senders split into name and address: %s", (raw, name, addr) => {
  expect(splitSender(raw)).toEqual([name, addr]);
});

it("an Outlook header block reads one field per line", () => {
  const [, thread] = parts(
    "Thanks, talk soon!\nBest,\nJordan\nOn Thu, Oct 22, 2026 at 6:30 PM Jordan Lee <\njordan.lee@outlook.com\n> wrote:\n" +
      "Hi Sam,\nSee you then.\nBest,\nJordan\nFrom:\nSamuel Okafor <sam.okafor@deel.com>\nSent:\nThursday, October 22, 2026 6:43 PM\n" +
      "To:\njordan.lee@outlook.com\nSubject:\nUpdate From Deel\nHi Jordan,\nThank you!",
  );
  expect(thread).toContain("From: Samuel Okafor <sam.okafor@deel.com>");
  expect(thread).toContain("Sent: Thursday, October 22, 2026 6:43 PM");
  expect(thread).toContain("To: jordan.lee@outlook.com");
  expect(thread).toContain("Subject: Update From Deel");
  expect(thread).toContain("Jordan");
  expect(thread.some((b) => b.endsWith(" From:"))).toBe(false);
  expect(parts(OUTLOOK_HEADER)[0][0]).toBe("Thanks, talk soon!");
});

describe("link domains", () => {
  it("shows www-less hosts and keeps the full address in the tooltip", () => {
    expect(render("See https://www.example.com/a?b=c now")).toContain('<span class="url" title="https://www.example.com/a?b=c">example.com</span>');
  });
  it("leaves trailing punctuation outside the link", () => {
    expect(render("Visit https://example.com/path.")).toContain('</span>.</p>');
  });
  it("unwraps a bracketed link", () => {
    expect(render("Details ( https://example.com/x ) here")).toContain(">example.com</span> here");
  });
  it("a malformed host is shown as a plain link instead of failing", () => {
    expect(render("Open http://[abc/x now")).toContain(">link</span>");
  });
});

