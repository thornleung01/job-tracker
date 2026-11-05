// Page shapes the extractor has to cope with. Trimmed copies of what each kind of site puts in the DOM.

export interface Fixture {
  name: string;
  url: string;
  html: string;
}

const ld = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

export const linkedin: Fixture = {
  name: "LinkedIn job pane in search",
  url: "https://www.linkedin.com/jobs/search/?currentJobId=3912345678&keywords=designer&utm_source=x",
  html: `<html><head><title>(3) Jobs | LinkedIn</title><link rel="canonical" href="https://www.linkedin.com/jobs/search/"></head><body>
    <div class="job-details-jobs-unified-top-card__job-title"><h1>
      Senior   Product Designer
    </h1></div>
    <div class="job-details-jobs-unified-top-card__company-name"><a>Acme Corp</a></div>
    <div class="job-details-jobs-unified-top-card__primary-description-container">Toronto, ON · 2 weeks ago · Over 100 applicants</div>
  </body></html>`,
};

export const indeed: Fixture = {
  name: "Indeed job pane in search",
  url: "https://ca.indeed.com/jobs?q=analyst&l=Toronto&vjk=abcdef0123456789",
  html: `<html><head><title>Analyst jobs in Toronto</title></head><body>
    <h1 data-testid="jobsearch-JobInfoHeader-title"><span>Data Analyst - job post</span></h1>
    <div data-testid="inlineHeader-companyName"><a>Globex</a></div>
    <div data-testid="inlineHeader-companyLocation">Toronto, ON</div>
  </body></html>`,
};

export const workday: Fixture = {
  name: "Workday posting",
  url: "https://initech.wd5.myworkdayjobs.com/en-US/External/job/Toronto/Data-Engineer_R-1234",
  html: `<html><head><title>Data Engineer</title></head><body>
    <h2 data-automation-id="jobPostingHeader">Data Engineer</h2>
    <div data-automation-id="locations">Toronto, ON</div>
  </body></html>`,
};

export const jsonLd: Fixture = {
  name: "JSON-LD JobPosting in an @graph",
  url: "https://careers.example.com/jobs/42?utm_campaign=abc",
  html: `<html><head><title>Ignored | Example</title>
    ${ld({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", name: "Example" },
        {
          "@type": ["JobPosting"],
          title: "Staff Engineer &amp; Tech Lead",
          hiringOrganization: { "@type": "Organization", name: "Example Inc." },
          jobLocation: [{ "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Vancouver", addressRegion: "BC", addressCountry: "CA" } }],
        },
      ],
    })}
    <link rel="canonical" href="https://careers.example.com/jobs/42"></head><body><h1>Something else</h1></body></html>`,
};

export const jsonLdRemote: Fixture = {
  name: "JSON-LD remote posting with a string organization",
  url: "https://jobs.example.org/p/7",
  html: `<html><head>${ld([
    { "@type": "BreadcrumbList" },
    { "@type": "JobPosting", title: "Backend Developer", hiringOrganization: "Initrode", jobLocationType: "TELECOMMUTE", jobLocation: { address: { addressCountry: { name: "Canada" } } } },
  ])}</head><body></body></html>`,
};

export const jsonLdBroken: Fixture = {
  name: "invalid JSON-LD falls back to the page",
  url: "https://example.com/careers/9",
  html: `<html><head><title>Support Lead at Umbrella | Careers</title><script type="application/ld+json">{not json</script></head><body></body></html>`,
};

export const ogOnly: Fixture = {
  name: "page with only Open Graph tags",
  url: "https://careers.globex.com/open/12",
  html: `<html><head><title>whatever</title>
    <meta property="og:title" content="Product Designer at Globex | Careers">
    <meta property="og:site_name" content="Globex Careers">
    <meta property="og:url" content="https://careers.globex.com/open/12"></head><body></body></html>`,
};

export const ogWithH1: Fixture = {
  name: "og:site_name and an h1",
  url: "https://acme.example/jobs/qa",
  html: `<html><head><title>Acme Jobs</title><meta property="og:site_name" content="Acme"></head><body><h1>QA Engineer</h1></body></html>`,
};

export const bare: Fixture = {
  name: "bare page",
  url: "https://example.com/some/page?x=1",
  html: `<html><head></head><body><p>Nothing here</p></body></html>`,
};

export const hostile: Fixture = {
  name: "page with control characters and a huge title",
  url: "https://example.com/p",
  html: `<html><head><title>${"A".repeat(500)}\u0000 at ${"B".repeat(500)}</title></head><body></body></html>`,
};

export const ALL: Fixture[] = [linkedin, indeed, workday, jsonLd, jsonLdRemote, jsonLdBroken, ogOnly, ogWithH1, bare, hostile];

export const parse = (html: string): Document => new DOMParser().parseFromString(html, "text/html");
