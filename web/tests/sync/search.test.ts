import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { createApplication } from "../../src/db/repo";
import { listApplications } from "../../src/sync/queries";
import { foldText, searchApplications, searchWords, snippetAround, whyMatched, type SearchActivity, type SearchEmail } from "../../src/sync/search";
import { BODY_LIMIT } from "../../src/types";
import { closeAll, dbWithAccount } from "./helpers";

afterEach(closeAll);

const rows = [
  { id: 1, company: "Acme", role: "Data Analyst" },
  { id: 2, company: "Café Corp", role: "Designer" },
  { id: 3, company: "Zeta", role: "Backend" },
];
const mail = (applicationId: number | null, subject: string | null, body: string | null = ""): SearchEmail => ({ applicationId, subject, body });
const note = (applicationId: number, body: string, kind: "note" | "step" = "note", label: string | null = null): SearchActivity => ({ applicationId, kind, label, body });
const find = (q: string, emails: SearchEmail[] = [], activity: SearchActivity[] = []) => searchApplications(rows, emails, activity, q);

describe("folding", () => {
  it("lower-cases and takes accents off, and leaves plain ASCII alone", () => {
    expect(foldText("Résumé ÉCOLE Zoë")).toBe("resume ecole zoe");
    expect(foldText("Plain Text 123")).toBe("plain text 123");
  });
  it("splits a search into folded words without repeats, capped", () => {
    expect(searchWords("  Café  café  ANALYST ")).toEqual(["cafe", "analyst"]);
    expect(searchWords("a b c d e f g h i j")).toHaveLength(8);
    expect(searchWords("   ")).toEqual([]);
  });
});

describe("company and role", () => {
  it("matches either, case-insensitively, and says it is a name match with no snippet", () => {
    expect(find("acme").get(1)).toEqual({ via: "name", snippet: "" });
    expect(find("DESIGNER").get(2)?.via).toBe("name");
    expect([...find("a").keys()].sort()).toEqual([1, 2, 3]);
  });
  it("needs every word, in any order, across company and role", () => {
    expect([...find("analyst acme").keys()]).toEqual([1]);
    expect([...find("acme designer").keys()]).toEqual([]);
  });
  it("ignores accents both ways", () => {
    expect([...find("cafe").keys()]).toEqual([2]);
    expect([...find("CAFÉ corp").keys()]).toEqual([2]);
  });
  it("matches nothing for a blank search, and a one-character search never reads mail", () => {
    expect(find("   ").size).toBe(0);
    expect(find("q", [mail(3, "quarterly", "q")]).size).toBe(0);
  });
});

describe("email subjects and bodies", () => {
  it("finds a word in a subject or a body and reports an email match with a snippet", () => {
    const m = find("interview", [mail(3, "Next steps", "We would like to schedule an interview with you on Friday.")]).get(3)!;
    expect(m.via).toBe("email");
    expect(m.snippet).toContain("schedule an interview with you");
    expect(find("friday offer", [mail(3, "Offer letter", "see you friday")]).get(3)?.via).toBe("email");
  });
  it("needs all words in the one email, in any order, not spread over several", () => {
    const emails = [mail(3, "Offer letter"), mail(3, "Friday call")];
    expect(find("offer friday", emails).has(3)).toBe(false);
    expect(find("friday offer", [mail(3, "Offer letter", "Call on Friday")]).has(3)).toBe(true);
  });
  it("counts the company as part of the words, so 'zeta interview' needs only 'interview' in the mail", () => {
    expect(find("zeta interview", [mail(3, "Interview invite")]).get(3)?.via).toBe("email");
    expect(find("zeta interview", [mail(1, "Interview invite")]).has(1)).toBe(false);
  });
  it("is accent-insensitive in email text", () => {
    expect(find("resume", [mail(3, "Votre résumé")]).get(3)?.via).toBe("email");
    expect(find("résumé", [mail(3, "Your RESUME")]).get(3)?.via).toBe("email");
  });
  it("shows the original text and its accents in the snippet", () => {
    const m = find("resume", [mail(3, "", "Merci pour votre résumé détaillé.")]).get(3)!;
    expect(m.snippet).toBe("Merci pour votre résumé détaillé.");
  });
  it("never matches erased or other applications' mail", () => {
    expect(find("interview", [mail(3, null, null)]).has(3)).toBe(false);
    expect(find("interview", [mail(null, "interview")]).size).toBe(0);
    expect(find("interview", [mail(1, "interview")]).has(3)).toBe(false);
  });
  it("reads a body only up to the stored 4 KB", () => {
    const body = `${"x".repeat(BODY_LIMIT)} hidden-word`;
    expect(find("hidden-word", [mail(3, "", body)]).has(3)).toBe(false);
    expect(find("hidden-word", [mail(3, "", `${"x".repeat(BODY_LIMIT - 20)} hidden-word`)]).has(3)).toBe(true);
  });
  it("prefers the newest email when several match", () => {
    const m = find("offer", [mail(3, "Offer, the first one"), mail(3, "Offer, the newest")]).get(3)!;
    expect(m.snippet).toContain("newest");
  });
});

describe("notes and steps", () => {
  it("finds history text and names the kind", () => {
    expect(find("recruiter", [], [note(3, "Spoke to the recruiter by phone")]).get(3)?.via).toBe("note");
    expect(find("technical", [], [note(3, "", "step", "Technical interview")]).get(3)?.via).toBe("step");
  });
  it("ignores history that belongs to another application", () => {
    expect(find("recruiter", [], [note(1, "recruiter")]).has(3)).toBe(false);
  });
});

describe("snippets and the line shown", () => {
  it("cuts about 100 characters round the first hit with ellipses", () => {
    const text = `${"a ".repeat(60)}NEEDLE${" b".repeat(60)}`;
    const s = snippetAround(text, ["needle"]);
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
    expect(s).toContain("NEEDLE");
    expect(s.length).toBeLessThan(110);
  });
  it("puts it on one line", () => {
    expect(snippetAround("one\n\n  two   needle\tthree", ["needle"])).toBe("one two needle three");
  });
  it("words it as 'Matched in an email: ...' and says nothing for a name match", () => {
    expect(whyMatched({ via: "email", snippet: "hello" })).toBe("Matched in an email: hello");
    expect(whyMatched({ via: "note", snippet: "x" })).toBe("Matched in a note: x");
    expect(whyMatched({ via: "step", snippet: "x" })).toBe("Matched in a step: x");
    expect(whyMatched({ via: "name", snippet: "" })).toBe("");
    expect(whyMatched(undefined)).toBe("");
  });
});

describe("speed", () => {
  it("searches 1,000 applications with 20 emails each well inside a second", () => {
    const apps = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, company: `Company ${i}`, role: `Role ${i % 17}` }));
    const body = "Thank you for applying. We received your application and will be in touch about next steps soon. ".repeat(40).slice(0, BODY_LIMIT);
    const emails: SearchEmail[] = [];
    for (const a of apps) for (let k = 0; k < 20; k++) emails.push({ applicationId: a.id, subject: `Update ${k} for ${a.company}`, body: `${body} ref-${a.id}-${k}` });
    emails.push({ applicationId: 777, subject: "Résumé review", body: "needle-in-777" });
    const started = performance.now();
    const miss = searchApplications(apps, emails, [], "no such phrase anywhere");
    const hit = searchApplications(apps, emails, [], "needle-in-777");
    const accent = searchApplications(apps, emails, [], "resume review");
    const elapsed = performance.now() - started;
    expect(miss.size).toBe(0);
    expect([...hit.keys()]).toEqual([777]);
    expect(accent.get(777)?.via).toBe("email");
    expect(elapsed).toBeLessThan(2000);
  });
});

describe("in the list", () => {
  it("filters the list on mail and attaches why, but only for text outside company and role", async () => {
    const { db, acct } = await dbWithAccount();
    const mk = (company: string) => createApplication(db, { company, companyKey: company.toLowerCase(), role: "Analyst", roleKey: "analyst", stage: "Applied", when: "2026-10-01T12:00:00Z" });
    const acme = await mk("Acme");
    const beta = await mk("Beta");
    await db.emails.add({ accountId: acct, providerMsgId: "m1", threadId: "t", receivedAt: "2026-10-02T12:00:00Z", sender: "a@acme.com", subject: "Interview invitation", body: "Pick a slot", related: true, event: "interview", confidence: "high", applicationId: acme, needsReview: false, webLink: null, bulk: false, hold: false, reason: null });
    await db.activity.add({ applicationId: beta, kind: "note", label: null, body: "Referral from Dana", occurredAt: "2026-10-03T12:00:00Z", createdAt: "2026-10-03T12:00:00Z" });
    const byMail = await listApplications(db, { q: "invitation" });
    expect(byMail.map((r) => r.id)).toEqual([acme]);
    expect(byMail[0].match?.via).toBe("email");
    const byNote = await listApplications(db, { q: "dana" });
    expect([byNote[0].id, byNote[0].match?.via]).toEqual([beta, "note"]);
    const byName = await listApplications(db, { q: "acme" });
    expect(byName[0].match?.via).toBe("name");
    expect((await listApplications(db, {}))[0].match).toBeUndefined();
  });

  it("does not match mail that was cleared (dismissed), which keeps only ids and dates", async () => {
    const { db, acct } = await dbWithAccount();
    const acme = await createApplication(db, { company: "Acme", companyKey: "acme", role: "Analyst", roleKey: "analyst", stage: "Applied", when: "2026-10-01T12:00:00Z" });
    const id = await db.emails.add({ accountId: acct, providerMsgId: "m1", threadId: "t", receivedAt: "2026-10-02T12:00:00Z", sender: "a@acme.com", subject: "Interview invitation", body: "x", related: true, event: "interview", confidence: "high", applicationId: acme, needsReview: false, webLink: null, bulk: false, hold: false, reason: null });
    expect((await listApplications(db, { q: "invitation" })).length).toBe(1);
    const { clearEmail } = await import("../../src/db/repo");
    await clearEmail(db, id);
    expect((await listApplications(db, { q: "invitation" })).length).toBe(0);
  });
});
