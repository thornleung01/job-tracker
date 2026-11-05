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

// --- Markup churn: the same sites with every class name and test id changed or removed. Only tags, hrefs and text remain. ---

export const linkedinRenamed: Fixture = {
  name: "LinkedIn pane with hashed class names, a company link and a location line",
  url: "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4011122233",
  html: `<html><head><title>Jobs | LinkedIn</title></head><body>
    <header class="a1x"><nav class="a2y"><a href="/company/linkedin-corp/">LinkedIn</a><a href="/jobs/">Jobs</a></nav></header>
    <div class="promo-9f"><a href="/company/decoy-one/">Decoy One</a></div>
    <main class="k3f9"><div class="q1z"><div class="q2z">
      <h1 class="t9x"><a href="/jobs/view/4011122233/">Senior Product Designer</a></h1>
      <div class="q3z"><a class="zz1" href="https://www.linkedin.com/company/acme-corp/"><img alt="Acme Corp logo"></a>
        <a class="zz2" href="https://www.linkedin.com/company/acme-corp/life"><span aria-hidden="true">Acme Corp</span><span class="vh7">Acme Corp</span></a>
        <button class="b8">Follow</button></div>
      <div class="q4z"><span class="w1k">Toronto, Ontario, Canada (Hybrid)</span><span> · </span><span>3 days ago</span><span> · </span><span>Over 100 applicants</span></div>
    </div></div>
    <ul class="rel"><li><a href="/company/globex/">Globex</a><span>Vancouver, BC</span></li></ul></main>
    <footer><a href="/company/linkedin/">About LinkedIn</a></footer></body></html>`,
};

export const indeedRenamed: Fixture = {
  name: "Indeed pane with hashed class names and a differently named location test id",
  url: "https://ca.indeed.com/jobs?q=analyst&l=Ottawa&vjk=ffeeddcc00112233",
  html: `<html><head><title>Analyst jobs in Ottawa</title></head><body><div class="css-1a2b">
    <nav><a href="/cmp/Indeed-Inc">Indeed</a></nav>
    <form><div id="text-input-location-label">Ottawa, ON</div></form>
    <div class="zx9"><h1 class="r1q"><span>Data Analyst</span><span> - job post</span></h1>
      <div class="r2q"><div class="r3q"><a class="r4q" href="https://ca.indeed.com/cmp/Acme-Corp?campaignid=mobvjcmp">Acme Corp</a></div>
      <div data-testid="hdr-v9-LOCATION-line"><span>Toronto, ON</span></div></div></div>
    <aside><a href="/cmp/Other">Other</a></aside></div></body></html>`,
};

export const indeedSlug: Fixture = {
  name: "Indeed pane whose company link is only a logo, location only in an aria-label element",
  url: "https://www.indeed.com/viewjob?jk=0123abcd4567ef89",
  html: `<html><head><title>x</title></head><body><main>
    <h1>Backend Engineer - job post</h1>
    <a href="/cmp/Acme-Corp"><img alt="logo"></a>
    <div aria-label="Job location"><div>Location</div><div>Remote</div></div>
  </main></body></html>`,
};

export const linkedinDecoys: Fixture = {
  name: "several /company/ links (nav, related, footer): the one beside the heading wins",
  url: "https://www.linkedin.com/jobs/view/senior-designer-at-acme-corp-3999000111/?trackingId=zz",
  html: `<html><head><title>Senior Designer | LinkedIn</title></head><body>
    <nav><a href="/company/nav-co/">Nav Co</a></nav>
    <section><a href="/company/early-decoy/">Early Decoy</a></section>
    <div><div><div><h1>Senior Designer</h1><p><a href="/company/acme-corp/">Acme Corp</a></p><p>Calgary, Alberta, Canada</p></div></div></div>
    <aside><a href="/company/aside-co/">Aside Co</a></aside>
    <ul><li><a href="/company/related-co/">Related Co</a><span>Halifax, NS</span></li></ul>
    <footer><a href="/company/footer-co/">Footer Co</a></footer></body></html>`,
};

export const companyFallback: Fixture = {
  name: "no heading: first company link outside nav, footer, aside and lists",
  url: "https://www.linkedin.com/jobs/view/3999000222",
  html: `<html><head><title>Staff Engineer - Acme | LinkedIn</title></head><body>
    <nav><a href="/company/nav-co/">Nav Co</a></nav>
    <ul><li><a href="/company/related-co/">Related Co</a></li></ul>
    <footer><a href="/company/footer-co/">Footer Co</a></footer>
    <div><a href="/company/acme-corp-ltd/">Acme Corp Ltd</a></div></body></html>`,
};

export const linkedinHidden: Fixture = {
  name: "hidden duplicates are ignored (hidden, aria-hidden, display:none)",
  url: "https://www.linkedin.com/jobs/view/4000000001",
  html: `<html><head><title>Jobs | LinkedIn</title></head><body><main>
    <div hidden><h1>Wrong Role</h1><a href="/company/wrong-co/">Wrong Co</a><span>Calgary, Alberta</span></div>
    <div aria-hidden="true"><h1>Wrong Role Two</h1></div>
    <div style="color: red; display: none"><a href="/company/wrong-two/">Wrong Two</a></div>
    <section><h1>Platform Engineer</h1>
      <a href="/company/wrong-three/"><span hidden>Wrong Three</span></a>
      <a href="/company/initech/">Initech<span style="display:none"> Secret</span></a>
      <div><span style="display: none">Montreal, Quebec</span><span>Waterloo, Ontario</span></div>
    </section></main></body></html>`,
};

export const classHidden: Fixture = {
  name: "site class rules skip hidden duplicates too",
  url: "https://ca.indeed.com/viewjob?jk=abc123",
  html: `<html><head><title>x</title></head><body>
    <div style="display:none"><div data-testid="inlineHeader-companyName">Wrong</div><div data-testid="inlineHeader-companyLocation">Nowhere</div></div>
    <div data-testid="inlineHeader-companyName">Globex</div><div data-testid="inlineHeader-companyLocation">Toronto, ON</div>
  </body></html>`,
};

export const genericCompanyLink: Fixture = {
  name: "an unknown site's /company/ link is not a company",
  url: "https://careers.initech.example/jobs/9",
  html: `<html><head><title>Staff Engineer | Initech</title></head><body><h1>Staff Engineer</h1><a href="/company/about">About us</a></body></html>`,
};

export const driftedLinkedin: Fixture = {
  name: "LinkedIn page with nothing recognisable",
  url: "https://www.linkedin.com/jobs/search/?currentJobId=4022233344",
  html: `<html><head><title>LinkedIn</title></head><body><div><div>Loading</div></div></body></html>`,
};

const titleOnly = (name: string, url: string, title: string): Fixture => ({ name, url, html: `<html><head><title>${title}</title></head><body><div>x</div></body></html>` });
export const titleLinkedinHiring = titleOnly("title: Company hiring Role in Location | LinkedIn", "https://www.linkedin.com/jobs/view/senior-designer-at-acme-corp-3999000111", "(2) Acme Corp hiring Senior Designer in Toronto, Ontario, Canada | LinkedIn");
export const titleLinkedinHiringNoLoc = titleOnly("title: Company hiring Role in Training | LinkedIn (no location)", "https://www.linkedin.com/jobs/view/3999000333", "Acme hiring Analyst in Training | LinkedIn");
export const titleLinkedinAt = titleOnly("title: Role at Company | LinkedIn", "https://www.linkedin.com/jobs/view/3999000444", "Senior Designer at Acme Corp | LinkedIn");
export const titleIndeedThree = titleOnly("title: Role - Company - Location | Indeed.com", "https://ca.indeed.com/viewjob?jk=aabbccdd11223344", "Data Analyst - Globex - Toronto, ON | Indeed.com");
export const titleIndeedJobPost = titleOnly("title: Role - job post - Company", "https://ca.indeed.com/viewjob?jk=aabbccdd11223355", "Data Analyst - job post - Globex");
export const titlePipe = titleOnly("title: Role | Company", "https://jobs.example.org/a", "Product Designer | Globex");
export const titleDash = titleOnly("title: Role - Company", "https://jobs.example.org/b", "Product Designer - Globex");
export const titleAt = titleOnly("title: Role at Company", "https://jobs.example.org/c", "Product Designer at Globex");

export const ALL: Fixture[] = [linkedin, indeed, workday, jsonLd, jsonLdRemote, jsonLdBroken, ogOnly, ogWithH1, bare, hostile,
  linkedinRenamed, indeedRenamed, indeedSlug, linkedinDecoys, companyFallback, linkedinHidden, classHidden, genericCompanyLink, driftedLinkedin,
  titleLinkedinHiring, titleLinkedinHiringNoLoc, titleLinkedinAt, titleIndeedThree, titleIndeedJobPost, titlePipe, titleDash, titleAt,
];

export const parse = (html: string): Document => new DOMParser().parseFromString(html, "text/html");
