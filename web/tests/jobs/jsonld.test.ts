import { describe, expect, it } from "vitest";
import { extractJobPostingFromJsonLd, parseLenientJson } from "../../src/jobs";

const page = (...blocks: string[]) =>
  `<!doctype html><html><head><title>x</title>${blocks.map((b) => `<script type="application/ld+json">${b}</script>`).join("")}</head><body><h1>Hi</h1></body></html>`;

const POSTING = {
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Senior Software Engineer",
  hiringOrganization: { "@type": "Organization", name: "Acme Corp", sameAs: "https://acme.com" },
  jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Toronto", addressRegion: "ON", addressCountry: "CA" } },
  url: "https://acme.com/careers/123?utm_source=x#apply",
};

describe("extractJobPostingFromJsonLd", () => {
  it("reads a single JobPosting from HTML", () => {
    expect(extractJobPostingFromJsonLd(page(JSON.stringify(POSTING)))).toEqual({
      company: "Acme Corp", role: "Senior Software Engineer", location: "Toronto, ON, CA", url: "https://acme.com/careers/123",
      source: "paste", guessed: { company: false, role: false },
    });
  });

  it("finds it in an array of objects", () => {
    const d = extractJobPostingFromJsonLd(page(JSON.stringify([{ "@type": "Organization", name: "Acme" }, POSTING])));
    expect(d?.role).toBe("Senior Software Engineer");
  });

  it("finds it in @graph", () => {
    const graph = { "@context": "https://schema.org", "@graph": [{ "@type": "WebSite", name: "Acme" }, { "@type": ["Thing", "JobPosting"], title: "Designer", hiringOrganization: "Acme Inc" }] };
    const d = extractJobPostingFromJsonLd(page(JSON.stringify(graph)));
    expect(d).toMatchObject({ role: "Designer", company: "Acme Inc" });
  });

  it("finds it nested in a list", () => {
    const list = { "@type": "ItemList", itemListElement: [{ "@type": "ListItem", item: { "@type": "https://schema.org/JobPosting", title: "Analyst", hiringOrganization: { name: "Acme" } } }] };
    expect(extractJobPostingFromJsonLd(page(JSON.stringify(list)))).toMatchObject({ role: "Analyst", company: "Acme" });
  });

  it("uses the first JobPosting across several script blocks", () => {
    const html = page("{\"@type\":\"Organization\",\"name\":\"Acme\"}", "{ broken", JSON.stringify({ ...POSTING, title: "First" }), JSON.stringify({ ...POSTING, title: "Second" }));
    expect(extractJobPostingFromJsonLd(html)?.role).toBe("First");
  });

  it("says Remote for TELECOMMUTE", () => {
    const remote = { "@type": "JobPosting", title: "Engineer", hiringOrganization: { name: "Acme" }, jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: "Canada" } };
    expect(extractJobPostingFromJsonLd(page(JSON.stringify(remote)))?.location).toBe("Remote (Canada)");
    const bare = { ...remote, applicantLocationRequirements: undefined };
    expect(extractJobPostingFromJsonLd(page(JSON.stringify(bare)))?.location).toBe("Remote");
  });

  it("handles a list of places and string addresses", () => {
    const multi = { ...POSTING, jobLocation: [{ address: { addressLocality: "Toronto", addressRegion: "ON" } }, { address: "Vancouver, BC" }] };
    expect(extractJobPostingFromJsonLd(page(JSON.stringify(multi)))?.location).toBe("Toronto, ON; Vancouver, BC");
    const named = { ...POSTING, jobLocation: { "@type": "Place", name: "HQ Office" } };
    expect(extractJobPostingFromJsonLd(page(JSON.stringify(named)))?.location).toBe("HQ Office");
  });

  it("tolerates trailing junk, comments and raw newlines in strings", () => {
    const junk = JSON.stringify(POSTING) + "\n;;; trailing junk {";
    expect(extractJobPostingFromJsonLd(page(junk))?.company).toBe("Acme Corp");
    const cdata = "//<![CDATA[\n" + JSON.stringify(POSTING) + "\n//]]>";
    expect(extractJobPostingFromJsonLd(page(cdata))?.company).toBe("Acme Corp");
    const newline = '{"@type":"JobPosting","title":"Senior\nEngineer","hiringOrganization":{"name":"Acme"}}';
    expect(extractJobPostingFromJsonLd(page(newline))).toMatchObject({ role: "Senior Engineer", company: "Acme" });
  });

  it("returns null for malformed JSON, no JobPosting, empty input and non-posting pages", () => {
    expect(extractJobPostingFromJsonLd(page("{ not json"))).toBeNull();
    expect(extractJobPostingFromJsonLd(page('{"@type":"Organization","name":"Acme"}'))).toBeNull();
    expect(extractJobPostingFromJsonLd(page('{"@type":"JobPosting"}'))).toBeNull();
    expect(extractJobPostingFromJsonLd("")).toBeNull();
    expect(extractJobPostingFromJsonLd("<html><body>No data</body></html>")).toBeNull();
    expect(extractJobPostingFromJsonLd(undefined as unknown as string)).toBeNull();
  });

  it("cleans untrusted strings and ignores non-http urls", () => {
    const evil = { ...POSTING, title: "<img src=x onerror=alert(1)>Staff &amp; Lead\u0000", hiringOrganization: { name: "A".repeat(200) }, url: "javascript:alert(1)" };
    const d = extractJobPostingFromJsonLd(page(JSON.stringify(evil)));
    expect(d?.role).toBe("Staff & Lead");
    expect(d?.company).toHaveLength(60);
    expect(d?.url).toBe("");
    expect(extractJobPostingFromJsonLd(page(JSON.stringify(evil)), "https://acme.com/jobs/9?utm_source=x")?.url).toBe("https://acme.com/jobs/9");
  });

  it("never runs scripts or loads resources from pasted HTML", () => {
    (globalThis as { __ran?: boolean }).__ran = false;
    const html = `<img src=x onerror="globalThis.__ran=true"><script>globalThis.__ran=true</script>` + page(JSON.stringify(POSTING));
    expect(extractJobPostingFromJsonLd(html)?.role).toBe("Senior Software Engineer");
    expect((globalThis as { __ran?: boolean }).__ran).toBe(false);
  });

  it("accepts a Document", () => {
    const doc = new DOMParser().parseFromString(page(JSON.stringify(POSTING)), "text/html");
    expect(extractJobPostingFromJsonLd(doc)).toMatchObject({ role: "Senior Software Engineer", source: "bookmarklet" });
  });
});

describe("parseLenientJson", () => {
  it("parses plain, junk-suffixed and unterminated input", () => {
    expect(parseLenientJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseLenientJson('xx {"a":"}{"} yy')).toEqual({ a: "}{" });
    expect(parseLenientJson('{"a":')).toBeUndefined();
    expect(parseLenientJson("nothing here")).toBeUndefined();
  });
});
