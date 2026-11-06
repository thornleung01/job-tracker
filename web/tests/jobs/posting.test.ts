// The posting text the job intake keeps: from JSON-LD, the four boards' APIs and a paste. Text only, cut to the limit.
import { describe, expect, it } from "vitest";
import { MAX_POSTING_CHARS } from "../../src/db/limits";
import { enrichJobDraft, extractJobPostingFromJsonLd, parseJobUrl, parsePastedText } from "../../src/jobs";
import type { JobDraft } from "../../src/jobs";
import { joinPostingParts, postingText } from "../../src/jobs/posting";

const UUID = "5f8a1c2e-1234-4abc-9def-0123456789ab";
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const draftOf = (url: string): JobDraft => parseJobUrl(url)!;
/** A fetch that answers from a map of exact URLs. */
const fakeFetch = (routes: Record<string, () => Response>) =>
  (async (input: RequestInfo | URL) => (routes[String(input)] ? routes[String(input)]() : new Response("no", { status: 404 }))) as typeof fetch;

const noMarkup = (text: string | undefined) => expect(text).not.toMatch(/<\/?[a-z][^>]*>/i);

describe("postingText", () => {
  it("turns HTML into lines and keeps inline words together", () => {
    const text = postingText("<p>We use <b>Python</b> and <a href='https://x.test'>SQL</a>.</p><ul><li>Build things</li><li>Ship them</li></ul>");
    expect(text).toBe("We use Python and SQL.\nBuild things\nShip them");
  });

  it("decodes HTML that was escaped again, the way Greenhouse sends it", () => {
    const text = postingText("&lt;p&gt;Join us &amp;amp; grow&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Own a roadmap&lt;/li&gt;&lt;/ul&gt;");
    expect(text).toBe("Join us & grow\nOwn a roadmap");
    noMarkup(text);
  });

  it("drops scripts and styles, and never keeps a tag", () => {
    const text = postingText("<style>p{color:red}</style><p>Hello</p><script>alert(1)</script><img src=x onerror=alert(1)>");
    expect(text).toBe("Hello");
  });

  it("leaves plain text alone and removes control and zero-width characters", () => {
    expect(postingText("Line one\r\nLine​ two\u0007\n\n\n\nLine three")).toBe("Line one\nLine two\n\nLine three");
  });

  it("is empty for anything that isn't text", () => {
    for (const v of [undefined, null, 5, {}, [], "", "   ", "<p></p>"]) expect(postingText(v)).toBe("");
  });

  it("is cut to the limit", () => {
    expect(postingText("a".repeat(MAX_POSTING_CHARS + 500))).toHaveLength(MAX_POSTING_CHARS);
    expect(postingText(`<p>${"word ".repeat(MAX_POSTING_CHARS)}</p>`).length).toBeLessThanOrEqual(MAX_POSTING_CHARS);
  });

  it("joins parts with a blank line and skips empty ones", () => {
    expect(joinPostingParts(["<p>One</p>", "", undefined, "Two"])).toBe("One\n\nTwo");
  });
});

describe("posting text from JSON-LD", () => {
  const page = (job: object) => `<html><head><script type="application/ld+json">${JSON.stringify(job)}</script></head><body></body></html>`;
  const job = { "@type": "JobPosting", title: "Analyst", hiringOrganization: { name: "Acme" } };

  it("keeps the description as text, whatever markup it came in", () => {
    const d = extractJobPostingFromJsonLd(page({ ...job, description: "<p>Analyse <strong>data</strong>.</p><ul><li>SQL</li></ul>" }));
    expect(d?.description).toBe("Analyse data.\nSQL");
    noMarkup(d?.description);
  });

  it("has no description when the posting has none", () => {
    expect(extractJobPostingFromJsonLd(page(job))).not.toHaveProperty("description");
    expect(extractJobPostingFromJsonLd(page({ ...job, description: 42 }))).not.toHaveProperty("description");
  });

  it("cuts a very long description to the limit", () => {
    const d = extractJobPostingFromJsonLd(page({ ...job, description: `<p>${"x ".repeat(MAX_POSTING_CHARS)}</p>` }));
    expect(d!.description!.length).toBeLessThanOrEqual(MAX_POSTING_CHARS);
  });
});

describe("posting text from the boards", () => {
  it("Greenhouse: the content field, escaped HTML", async () => {
    const url = "https://boards.greenhouse.io/acme/jobs/4012345005";
    const fetch = fakeFetch({
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs/4012345005": () =>
        json({ id: 4012345005, title: "Data Analyst", company_name: "Acme", content: "&lt;p&gt;Make &lt;em&gt;dashboards&lt;/em&gt;&lt;/p&gt;&lt;p&gt;Tell stories&lt;/p&gt;" }),
    });
    const d = await enrichJobDraft(draftOf(url), { fetch });
    expect(d.source).toBe("api");
    expect(d.description).toBe("Make dashboards\nTell stories");
  });

  it("Lever: the plain description, the lists and the closing text, in order", async () => {
    const fetch = fakeFetch({
      [`https://api.lever.co/v0/postings/acme/${UUID}`]: () =>
        json({
          text: "Designer", descriptionPlain: "About the job", description: "<p>About the job</p>",
          lists: [{ text: "Requirements", content: "<li>Figma</li><li>Empathy</li>" }], additionalPlain: "We hire everyone.", categories: { location: "Remote" },
        }),
    });
    const d = await enrichJobDraft(draftOf(`https://jobs.lever.co/acme/${UUID}`), { fetch });
    expect(d.description).toBe("About the job\n\nRequirements\n\nFigma\nEmpathy\n\nWe hire everyone.");
  });

  it("Ashby: the hosted page's description, and the board listing as the fallback", async () => {
    const url = `https://jobs.ashbyhq.com/acme/${UUID}`;
    // The two GraphQL calls share a URL but differ in `op`.
    const viaGraphql = async (input: RequestInfo | URL, init?: RequestInit) => {
      const op = String(input).split("op=")[1];
      const body = JSON.parse(String(init?.body));
      expect(body.query).toContain("descriptionHtml");
      return op === "ApiJobPosting"
        ? json({ data: { jobPosting: { id: UUID, title: "Engineer", locationName: "Toronto", descriptionHtml: "<h2>The role</h2><p>Build <b>APIs</b></p>" } } })
        : json({ data: { organization: { name: "Acme" } } });
    };
    const first = await enrichJobDraft(draftOf(url), { fetch: viaGraphql as typeof fetch });
    expect(first.description).toBe("The role\nBuild APIs");

    const listing = fakeFetch({
      "https://api.ashbyhq.com/posting-api/job-board/acme": () =>
        json({ organizationName: "Acme", jobs: [{ id: UUID, title: "Engineer", location: "Toronto", descriptionHtml: "<p>From the <i>listing</i></p>" }] }),
    });
    const second = await enrichJobDraft(draftOf(url), { fetch: listing });
    expect(second.description).toBe("From the listing");
  });

  it("SmartRecruiters: the sections of the job ad", async () => {
    const fetch = fakeFetch({
      "https://api.smartrecruiters.com/v1/companies/Bosch/postings/743999876543210": () =>
        json({
          name: "Technician", company: { name: "Bosch" }, location: { city: "Waterloo", country: "ca" },
          jobAd: { sections: { jobDescription: { text: "<p>Fix machines</p>" }, qualifications: { text: "<ul><li>Diploma</li></ul>" }, companyDescription: { text: "We make things." } } },
        }),
    });
    const d = await enrichJobDraft(draftOf("https://jobs.smartrecruiters.com/Bosch/743999876543210-technician"), { fetch });
    expect(d.description).toBe("We make things.\n\nFix machines\n\nDiploma");
  });

  it("keeps no description when the API sends none, and keeps the rest of the draft", async () => {
    const fetch = fakeFetch({ "https://boards-api.greenhouse.io/v1/boards/acme/jobs/4012345005": () => json({ id: 4012345005, title: "Data Analyst", company_name: "Acme" }) });
    const d = await enrichJobDraft(draftOf("https://boards.greenhouse.io/acme/jobs/4012345005"), { fetch });
    expect(d).not.toHaveProperty("description");
    expect(d.role).toBe("Data Analyst");
  });

  it("never keeps markup from a board", async () => {
    const fetch = fakeFetch({
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs/4012345005": () =>
        json({ id: 4012345005, title: "Data Analyst", content: "&lt;p onclick=&quot;x()&quot;&gt;Hi&lt;script&gt;alert(1)&lt;/script&gt;&lt;/p&gt;" }),
    });
    const d = await enrichJobDraft(draftOf("https://boards.greenhouse.io/acme/jobs/4012345005"), { fetch });
    noMarkup(d.description);
    expect(d.description).toBe("Hi");
  });
});

describe("posting text from a paste", () => {
  const POSTING = [
    "Data Analyst at Acme Corp", "Toronto, ON", "",
    "About the role", "You will turn messy data into clear answers for the product team. You will own dashboards, run analyses and explain what they mean.", "",
    "Requirements", "Three years of SQL. Comfort with spreadsheets and a chart library. Plain writing.",
  ].join("\n");

  it("keeps a pasted posting as the posting text", () => {
    const d = parsePastedText(POSTING);
    expect(d?.role).toBe("Data Analyst");
    expect(d?.description).toBe(POSTING);
  });

  it("converts pasted HTML to text", () => {
    const d = parsePastedText(`<h1>Data Analyst at Acme Corp</h1><p>${"Turn data into answers. ".repeat(12)}</p>`);
    expect(d?.description?.startsWith("Data Analyst at Acme Corp\nTurn data into answers.")).toBe(true);
    noMarkup(d?.description);
  });

  it("keeps nothing from a link, or from a title or place on its own", () => {
    expect(parsePastedText("https://boards.greenhouse.io/acme/jobs/4012345005")).not.toHaveProperty("description");
    expect(parsePastedText("Remote", "https://jobs.lever.co/acme-co/" + UUID)).not.toHaveProperty("description");
    expect(parsePastedText("Data Analyst at Acme Corp\nToronto, ON")).not.toHaveProperty("description");
  });

  it("takes the JSON-LD description when the paste is a page with structured data", () => {
    const ld = JSON.stringify({ "@type": "JobPosting", title: "Analyst", hiringOrganization: { name: "Acme" }, description: "<p>From the page data</p>" });
    const d = parsePastedText(`<html><script type="application/ld+json">${ld}</script><body>${"nav ".repeat(100)}</body></html>`);
    expect(d?.description).toBe("From the page data");
  });

  it("is cut to the limit", () => {
    const d = parsePastedText(`Data Analyst at Acme Corp\n${"word ".repeat(MAX_POSTING_CHARS)}`);
    expect(d!.description!.length).toBeLessThanOrEqual(MAX_POSTING_CHARS);
  });
});
