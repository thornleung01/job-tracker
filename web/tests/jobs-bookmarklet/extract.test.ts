import { describe, expect, it } from "vitest";
import { extract } from "../../src/jobs/bookmarklet";
import { bare, hostile, indeed, jsonLd, jsonLdBroken, jsonLdRemote, linkedin, ogOnly, ogWithH1, parse, workday } from "./fixtures";

const run = (f: { html: string; url: string }) => extract(parse(f.html), f.url);

describe("extract", () => {
  it("reads the LinkedIn top card, collapses whitespace, and rebuilds the direct link from currentJobId", () => {
    expect(run(linkedin)).toEqual({
      c: "Acme Corp",
      r: "Senior Product Designer",
      l: "Toronto, ON",
      u: "https://www.linkedin.com/jobs/view/3912345678",
      g: 0,
    });
  });

  it("reads the Indeed header, drops the '- job post' suffix, and rebuilds the viewjob link", () => {
    expect(run(indeed)).toEqual({ c: "Globex", r: "Data Analyst", l: "Toronto, ON", u: "https://ca.indeed.com/viewjob?jk=abcdef0123456789", g: 0 });
  });

  it("reads Workday's header and location; the company is left blank when the page does not say", () => {
    expect(run(workday)).toEqual({ c: "", r: "Data Engineer", l: "Toronto, ON", u: workday.url, g: 0 });
  });

  it("prefers JobPosting JSON-LD (in @graph, array @type, entities decoded) and the canonical URL on the same host", () => {
    expect(run(jsonLd)).toEqual({ c: "Example Inc.", r: "Staff Engineer & Tech Lead", l: "Vancouver, BC", u: "https://careers.example.com/jobs/42", g: 0 });
  });

  it("handles a top-level JSON-LD array, a string organization, and TELECOMMUTE as Remote", () => {
    expect(run(jsonLdRemote)).toEqual({ c: "Initrode", r: "Backend Developer", l: "Remote", u: jsonLdRemote.url, g: 0 });
  });

  it("ignores broken JSON-LD and falls back to the title, flagging both fields as guesses", () => {
    expect(run(jsonLdBroken)).toEqual({ c: "Umbrella", r: "Support Lead", l: "", u: jsonLdBroken.url, g: 3 });
  });

  it("uses og:title when that is all there is, dropping 'Careers' and flagging both as guesses", () => {
    expect(run(ogOnly)).toEqual({ c: "Globex", r: "Product Designer", l: "", u: ogOnly.url, g: 3 });
  });

  it("uses the first h1 as a guessed role and og:site_name as a guessed company", () => {
    expect(run(ogWithH1)).toEqual({ c: "Acme", r: "QA Engineer", l: "", u: ogWithH1.url, g: 3 });
  });

  it("returns little but never throws on a bare page", () => {
    expect(run(bare)).toEqual({ c: "", r: "", l: "", u: bare.url, g: 0 });
  });

  it("strips control characters and caps every field", () => {
    const out = run(hostile);
    expect(out.r).toBe("A".repeat(90));
    expect(out.c).toBe("B".repeat(60));
    expect(out.r + out.c).not.toMatch(/\u0000/);
  });

  it("caps the URL at 500 characters by dropping a long query string", () => {
    const url = "https://example.com/job/1?" + "q=".padEnd(900, "x");
    expect(extract(parse("<html></html>"), url).u).toBe("https://example.com/job/1");
  });

  it("does not trust a canonical link on another host", () => {
    const doc = parse('<html><head><link rel="canonical" href="https://evil.example/x"></head></html>');
    expect(extract(doc, "https://good.example/job/1").u).toBe("https://good.example/job/1");
  });

  it("survives a document that throws on every query", () => {
    const broken = { querySelector: () => { throw new Error("boom"); }, querySelectorAll: () => { throw new Error("boom"); }, title: "" } as unknown as Document;
    expect(extract(broken, "https://example.com/a")).toEqual({ c: "", r: "", l: "", u: "https://example.com/a", g: 0 });
  });
});
