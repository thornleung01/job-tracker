import { describe, expect, it } from "vitest";
import { extract } from "../../src/jobs/bookmarklet";
import {
  bare, classHidden, companyFallback, driftedLinkedin, genericCompanyLink, hostile, indeed, indeedRenamed, indeedSlug, jsonLd, jsonLdBroken, jsonLdRemote, linkedin, linkedinDecoys,
  linkedinHidden, linkedinRenamed, ogOnly, ogWithH1, parse, titleAt, titleDash, titleIndeedJobPost, titleIndeedThree, titleLinkedinAt, titleLinkedinHiring, titleLinkedinHiringNoLoc,
  titlePipe, workday,
} from "./fixtures";

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
    expect(run(bare)).toEqual({ c: "", r: "", l: "", u: "https://example.com/some/page", g: 0 });
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

  describe("survives markup churn (no class names, no test ids)", () => {
    it("LinkedIn: the heading, the company link and the location line are enough", () => {
      expect(run(linkedinRenamed)).toEqual({
        c: "Acme Corp",
        r: "Senior Product Designer",
        l: "Toronto, Ontario, Canada (Hybrid)",
        u: "https://www.linkedin.com/jobs/view/4011122233",
        g: 0,
      });
    });

    it("Indeed: the heading, the /cmp/ link and any element with 'location' in its test id (not the search form's)", () => {
      expect(run(indeedRenamed)).toEqual({ c: "Acme Corp", r: "Data Analyst", l: "Toronto, ON", u: "https://ca.indeed.com/viewjob?jk=ffeeddcc00112233", g: 0 });
    });

    it("a company link with no readable text gives the slug, flagged as a guess; 'Location' labels are dropped", () => {
      expect(run(indeedSlug)).toEqual({ c: "Acme Corp", r: "Backend Engineer", l: "Remote", u: "https://www.indeed.com/viewjob?jk=0123abcd4567ef89", g: 1 });
    });

    it("picks the company link beside the heading, not the nav, an earlier section, the aside, a related list or the footer", () => {
      expect(run(linkedinDecoys)).toEqual({ c: "Acme Corp", r: "Senior Designer", l: "Calgary, Alberta, Canada", u: "https://www.linkedin.com/jobs/view/3999000111", g: 0 });
    });

    it("without a heading, takes the first company link outside nav, footer, aside and lists; the role stays a guess", () => {
      expect(run(companyFallback)).toEqual({ c: "Acme Corp Ltd", r: "Staff Engineer", l: "", u: "https://www.linkedin.com/jobs/view/3999000222", g: 2 });
    });

    it("ignores hidden, aria-hidden and display:none duplicates, in text as well as in whole blocks", () => {
      expect(run(linkedinHidden)).toEqual({ c: "Initech", r: "Platform Engineer", l: "Waterloo, Ontario", u: "https://www.linkedin.com/jobs/view/4000000001", g: 0 });
    });

    it("skips hidden duplicates when falling back to the site class names", () => {
      expect(run(classHidden)).toMatchObject({ c: "Globex", l: "Toronto, ON" });
    });

    it("does not treat an unknown site's /company/ link as the company", () => {
      expect(run(genericCompanyLink)).toMatchObject({ c: "Initech", r: "Staff Engineer", g: 3 });
    });

    it("reads nothing from a page it cannot read, but still returns the posting's address", () => {
      expect(run(driftedLinkedin)).toEqual({ c: "", r: "", l: "", u: "https://www.linkedin.com/jobs/view/4022233344", g: 0 });
    });

    it("keeps the site class names working when the structure is absent", () => {
      expect(run(linkedin)).toMatchObject({ c: "Acme Corp", l: "Toronto, ON", g: 0 });
    });
  });

  describe("title patterns (all guesses)", () => {
    it("LinkedIn 'Company hiring Role in Location | LinkedIn', with the unread-count prefix removed", () => {
      expect(run(titleLinkedinHiring)).toEqual({ c: "Acme Corp", r: "Senior Designer", l: "Toronto, Ontario, Canada", u: "https://www.linkedin.com/jobs/view/3999000111", g: 3 });
    });

    it("LinkedIn: ' in ' that is not followed by a place stays part of the role", () => {
      expect(run(titleLinkedinHiringNoLoc)).toMatchObject({ c: "Acme", r: "Analyst in Training", l: "", g: 3 });
    });

    it("LinkedIn 'Role at Company | LinkedIn'", () => {
      expect(run(titleLinkedinAt)).toMatchObject({ c: "Acme Corp", r: "Senior Designer", l: "", g: 3 });
    });

    it("Indeed 'Role - Company - Location | Indeed.com'", () => {
      expect(run(titleIndeedThree)).toEqual({ c: "Globex", r: "Data Analyst", l: "Toronto, ON", u: "https://ca.indeed.com/viewjob?jk=aabbccdd11223344", g: 3 });
    });

    it("Indeed 'Role - job post - Company'", () => {
      expect(run(titleIndeedJobPost)).toMatchObject({ c: "Globex", r: "Data Analyst", l: "", g: 3 });
    });

    it.each([["pipe", titlePipe], ["dash", titleDash], ["at", titleAt]])("generic 'Role %s Company'", (_n, f) => {
      expect(run(f)).toMatchObject({ c: "Globex", r: "Product Designer", l: "", g: 3 });
    });
  });

  describe("the saved address", () => {
    const at = (url: string) => run({ html: bare.html, url }).u;
    it("drops the query and fragment of a page, so a session or token never travels", () => {
      expect(at("https://example.com/some/page?sid=SECRET&token=abc#access=1")).toBe("https://example.com/some/page");
    });
    it("keeps a job-id parameter and nothing else", () => {
      expect(at("https://careers.example.com/open?gh_jid=4012345&utm_source=x&session=SECRET")).toBe("https://careers.example.com/open?gh_jid=4012345");
    });
  });
});
