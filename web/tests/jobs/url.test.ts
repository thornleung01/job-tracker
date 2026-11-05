import { describe, expect, it } from "vitest";
import { cleanJobUrl, detectBoard, isSafeId, isSafeSlug, parseJobUrl, roleFromSlug, slugToName } from "../../src/jobs";

const UUID = "5f8a1c2e-1234-4abc-9def-0123456789ab";

// [input, cleaned url, company, role]
type Row = [string, string, string, string];

const TABLE: Row[] = [
  // Greenhouse
  ["https://boards.greenhouse.io/acme/jobs/4012345005", "https://boards.greenhouse.io/acme/jobs/4012345005", "Acme", ""],
  ["https://job-boards.greenhouse.io/my-company/jobs/123?gh_src=abc&utm_source=x", "https://job-boards.greenhouse.io/my-company/jobs/123", "My Company", ""],
  ["boards.greenhouse.io/acme/jobs/123", "https://boards.greenhouse.io/acme/jobs/123", "Acme", ""],
  ["https://boards.eu.greenhouse.io/acme/jobs/55", "https://boards.eu.greenhouse.io/acme/jobs/55", "Acme", ""],
  ["https://acme.com/careers/openings/senior-product-designer?gh_jid=4567890&utm_medium=email", "https://acme.com/careers/openings/senior-product-designer?gh_jid=4567890", "Acme", "Senior Product Designer"],
  ["https://boards.greenhouse.io/embed/job_app?for=acme&token=123", "https://boards.greenhouse.io/embed/job_app?for=acme&token=123", "Acme", ""],
  ["https://boards.greenhouse.io/acme", "https://boards.greenhouse.io/acme", "Acme", ""],
  ["HTTPS://BOARDS.GREENHOUSE.IO/Acme/jobs/123", "https://boards.greenhouse.io/Acme/jobs/123", "Acme", ""],
  // Lever
  [`https://jobs.lever.co/acme/${UUID}`, `https://jobs.lever.co/acme/${UUID}`, "Acme", ""],
  [`https://jobs.lever.co/acme/${UUID}/apply?lever-source=LinkedIn`, `https://jobs.lever.co/acme/${UUID}`, "Acme", ""],
  [`https://jobs.eu.lever.co/acme-co/${UUID}/`, `https://jobs.eu.lever.co/acme-co/${UUID}`, "Acme Co", ""],
  [`https://jobs.lever.co/acme/${UUID}?lever-source=Twitter&utm_campaign=x&keep=1`, `https://jobs.lever.co/acme/${UUID}?keep=1`, "Acme", ""],
  // Ashby
  [`https://jobs.ashbyhq.com/acme/${UUID}`, `https://jobs.ashbyhq.com/acme/${UUID}`, "Acme", ""],
  [`https://jobs.ashbyhq.com/acme/${UUID}/application?utm_source=x`, `https://jobs.ashbyhq.com/acme/${UUID}`, "Acme", ""],
  // SmartRecruiters
  ["https://jobs.smartrecruiters.com/Bosch/743999876543210-senior-software-engineer", "https://jobs.smartrecruiters.com/Bosch/743999876543210-senior-software-engineer", "Bosch", "Senior Software Engineer"],
  ["https://jobs.smartrecruiters.com/BoschGroup/7439998765-data-analyst?trid=abc&utm_source=x", "https://jobs.smartrecruiters.com/BoschGroup/7439998765-data-analyst?trid=abc", "BoschGroup", "Data Analyst"],
  [`https://jobs.smartrecruiters.com/oneclick-ui/company/AcmeCorp/publication/${UUID}`, `https://jobs.smartrecruiters.com/oneclick-ui/company/AcmeCorp/publication/${UUID}`, "AcmeCorp", ""],
  // Workable
  ["https://apply.workable.com/acme/j/ABC123DEF4/", "https://apply.workable.com/acme/j/ABC123DEF4", "Acme", ""],
  ["https://apply.workable.com/big-co/j/ABC123DEF4/apply/", "https://apply.workable.com/big-co/j/ABC123DEF4/apply", "Big Co", ""],
  // Workday
  ["https://acme.wd5.myworkdayjobs.com/en-US/External/job/Toronto-ON/Senior-Software-Engineer_R-12345", "https://acme.wd5.myworkdayjobs.com/en-US/External/job/Toronto-ON/Senior-Software-Engineer_R-12345", "Acme", "Senior Software Engineer"],
  ["https://rbc.wd3.myworkdayjobs.com/RBCGLOBAL1/job/Toronto/Data-Analyst_R0012345-1?source=Linkedin", "https://rbc.wd3.myworkdayjobs.com/RBCGLOBAL1/job/Toronto/Data-Analyst_R0012345-1", "Rbc", "Data Analyst"],
  ["https://acme.wd1.myworkdayjobs.com/Careers/job/Remote/Product-Manager_JR-9/apply", "https://acme.wd1.myworkdayjobs.com/Careers/job/Remote/Product-Manager_JR-9/apply", "Acme", "Product Manager"],
  ["https://acme.wd1.myworkdayjobs.com/Careers/job/Remote/Opening", "https://acme.wd1.myworkdayjobs.com/Careers/job/Remote/Opening", "Acme", ""],
  // LinkedIn
  ["https://www.linkedin.com/jobs/view/senior-software-engineer-at-acme-corp-3812345678?trk=public_jobs&refId=abc%3D&trackingId=xyz", "https://www.linkedin.com/jobs/view/senior-software-engineer-at-acme-corp-3812345678", "Acme Corp", "Senior Software Engineer"],
  ["https://ca.linkedin.com/jobs/view/product-designer-at-the-trade-desk-3800000001", "https://ca.linkedin.com/jobs/view/product-designer-at-the-trade-desk-3800000001", "The Trade Desk", "Product Designer"],
  ["https://www.linkedin.com/jobs/view/3812345678/", "https://www.linkedin.com/jobs/view/3812345678", "", ""],
  ["https://www.linkedin.com/jobs/view/3812345678?refId=x&trackingId=y", "https://www.linkedin.com/jobs/view/3812345678", "", ""],
  ["https://www.linkedin.com/jobs/collections/recommended/?currentJobId=3812345678&lipi=urn", "https://www.linkedin.com/jobs/collections/recommended?currentJobId=3812345678", "", ""],
  ["https://www.linkedin.com/jobs/search/?currentJobId=3812345678&keywords=engineer&geoId=1", "https://www.linkedin.com/jobs/search?currentJobId=3812345678", "", ""],
  ["https://www.linkedin.com/jobs/view/data-analyst-3812345678", "https://www.linkedin.com/jobs/view/data-analyst-3812345678", "", "Data Analyst"],
  ["https://www.linkedin.com/comm/jobs/view/qa-engineer-at-acme-3812345678", "https://www.linkedin.com/comm/jobs/view/qa-engineer-at-acme-3812345678", "Acme", "QA Engineer"],
  ["https://www.linkedin.com/company/acme-corp/jobs/", "https://www.linkedin.com/company/acme-corp/jobs", "Acme Corp", ""],
  ["https://www.linkedin.com/jobs/view/senior-software-engineer-at-acme-corp-3812345678/?refId=abc", "https://www.linkedin.com/jobs/view/senior-software-engineer-at-acme-corp-3812345678", "Acme Corp", "Senior Software Engineer"],
  // Indeed
  ["https://ca.indeed.com/viewjob?jk=abc123def456&from=serp&vjs=3&tk=1abc", "https://ca.indeed.com/viewjob?jk=abc123def456", "", ""],
  ["https://www.indeed.com/cmp/Acme-Corp/jobs?jk=abc", "https://www.indeed.com/cmp/Acme-Corp/jobs?jk=abc", "Acme Corp", ""],
  ["https://www.indeed.com/jobs?q=engineer&l=Toronto&vjk=abc123", "https://www.indeed.com/jobs?vjk=abc123", "", ""],
  // Glassdoor
  ["https://www.glassdoor.com/job-listing/senior-software-engineer-acme-JV_IC2281069_KO0,24_KE25,29.htm?jl=1009567890123&utm_source=x", "https://www.glassdoor.com/job-listing/senior-software-engineer-acme-JV_IC2281069_KO0,24_KE25,29.htm?jl=1009567890123", "Acme", "Senior Software Engineer"],
  ["https://www.glassdoor.ca/Overview/Working-at-Acme-Corp-EI_IE12345.11,20.htm", "https://www.glassdoor.ca/Overview/Working-at-Acme-Corp-EI_IE12345.11,20.htm", "Acme Corp", ""],
  ["https://www.glassdoor.com/Job/toronto-software-engineer-jobs-SRCH_IL.0,7_IC2281069_KO8,25.htm?jl=123&src=x", "https://www.glassdoor.com/Job/toronto-software-engineer-jobs-SRCH_IL.0,7_IC2281069_KO8,25.htm?jl=123", "", ""],
  // Wellfound
  ["https://wellfound.com/jobs/3123456-senior-backend-engineer", "https://wellfound.com/jobs/3123456-senior-backend-engineer", "", "Senior Backend Engineer"],
  ["https://wellfound.com/company/acme/jobs/3123456-product-manager?utm_source=x", "https://wellfound.com/company/acme/jobs/3123456-product-manager", "Acme", "Product Manager"],
  ["https://angel.co/company/acme/jobs/123-product-designer", "https://angel.co/company/acme/jobs/123-product-designer", "Acme", "Product Designer"],
  // Small ATSs
  ["https://acme.bamboohr.com/careers/45", "https://acme.bamboohr.com/careers/45", "Acme", ""],
  ["https://acme.bamboohr.com/jobs/view.php?id=45", "https://acme.bamboohr.com/jobs/view.php?id=45", "Acme", ""],
  ["https://acme.breezy.hr/p/0a1b2c3d4e5f-senior-data-engineer", "https://acme.breezy.hr/p/0a1b2c3d4e5f-senior-data-engineer", "Acme", "Senior Data Engineer"],
  ["https://acme.recruitee.com/o/senior-account-executive", "https://acme.recruitee.com/o/senior-account-executive", "Acme", "Senior Account Executive"],
  ["https://acme.recruitee.com/o/senior-account-executive/c/new", "https://acme.recruitee.com/o/senior-account-executive/c/new", "Acme", "Senior Account Executive"],
  ["https://acme.teamtailor.com/jobs/1234567-head-of-marketing?promotion=1", "https://acme.teamtailor.com/jobs/1234567-head-of-marketing?promotion=1", "Acme", "Head of Marketing"],
  ["https://acme.applytojob.com/apply/AbC12dEfGh/Senior-Accountant?source=Indeed", "https://acme.applytojob.com/apply/AbC12dEfGh/Senior-Accountant", "Acme", "Senior Accountant"],
  ["https://careers-acme.icims.com/jobs/1234/senior-technician/job?mobile=false&width=1000", "https://careers-acme.icims.com/jobs/1234/senior-technician/job?mobile=false&width=1000", "Acme", "Senior Technician"],
  ["https://careers-acme.icims.com/jobs/1234/job", "https://careers-acme.icims.com/jobs/1234/job", "Acme", ""],
  ["https://jobs.jobvite.com/acme/job/oAbC123", "https://jobs.jobvite.com/acme/job/oAbC123", "Acme", ""],
  ["https://jobs.jobvite.com/careers/acme/job/oAbC123", "https://jobs.jobvite.com/careers/acme/job/oAbC123", "Acme", ""],
  [`https://ats.rippling.com/acme-careers/jobs/${UUID}`, `https://ats.rippling.com/acme-careers/jobs/${UUID}`, "Acme", ""],
  ["https://jobs.gem.com/acme/abcDEF123", "https://jobs.gem.com/acme/abcDEF123", "Acme", ""],
  ["https://acme.jobs.personio.de/job/123456?language=en", "https://acme.jobs.personio.de/job/123456?language=en", "Acme", ""],
  // Unknown hosts: company from the registrable domain, role from the path
  ["https://careers.acme.com/jobs/senior-product-manager", "https://careers.acme.com/jobs/senior-product-manager", "Acme", "Senior Product Manager"],
  ["https://jobs.acme.com/", "https://jobs.acme.com", "Acme", ""],
  ["https://acme.com/careers/12345", "https://acme.com/careers/12345", "Acme", ""],
  ["https://www.acme.co.uk/careers/data-engineer-london", "https://www.acme.co.uk/careers/data-engineer-london", "Acme", "Data Engineer London"],
  ["https://my-company.io/careers/senior-qa-analyst-8f3a9c21b7d4", "https://my-company.io/careers/senior-qa-analyst-8f3a9c21b7d4", "My Company", "Senior QA Analyst"],
  ["https://acme.com/jobs/4a1c2d3e-1111-2222-3333-444455556666", "https://acme.com/jobs/4a1c2d3e-1111-2222-3333-444455556666", "Acme", ""],
  ["https://acme.com/careers/open-positions", "https://acme.com/careers/open-positions", "Acme", ""],
  ["https://acme.com/about-us", "https://acme.com/about-us", "Acme", ""],
  ["https://acme.com/careers?utm_source=x#apply", "https://acme.com/careers", "Acme", ""],
  ["acme.com:8080/careers/data-scientist", "https://acme.com:8080/careers/data-scientist", "Acme", "Data Scientist"],
  ["http://acme.com/jobs/ux-designer", "http://acme.com/jobs/ux-designer", "Acme", "UX Designer"],
  ["https://acme.com/careers/senior-engineer/apply", "https://acme.com/careers/senior-engineer/apply", "Acme", "Senior Engineer"],
  ["https://acme.com/jobs?id=42&ref=abc&fbclid=zz&gclid=aa", "https://acme.com/jobs?id=42", "Acme", ""],
  ["https://acme.com/job?jobId=77&jid=8&trk=x&trackingId=y&refId=z&lipi=q", "https://acme.com/job?jobId=77&jid=8", "Acme", ""],
  ["https://acme-careers.com/jobs/ux-researcher", "https://acme-careers.com/jobs/ux-researcher", "Acme", "UX Researcher"],
  ["https://acme.com.au/careers/ui-designer", "https://acme.com.au/careers/ui-designer", "Acme", "UI Designer"],
  ["https://acme.com/jobs/senior-engineer-1234567", "https://acme.com/jobs/senior-engineer-1234567", "Acme", "Senior Engineer"],
  ["https://acme.com/careers/Staff_Software_Engineer.html", "https://acme.com/careers/Staff_Software_Engineer.html", "Acme", "Staff Software Engineer"],
  ["https://acme.com/careers/director-of-people-and-culture", "https://acme.com/careers/director-of-people-and-culture", "Acme", "Director of People and Culture"],
  // Skip list and generic hosts
  ["https://www.google.com/about/careers/applications/jobs/results/123-software-engineer", "https://www.google.com/about/careers/applications/jobs/results/123-software-engineer", "", "Software Engineer"],
  ["https://lnkd.in/abc123", "https://lnkd.in/abc123", "", ""],
  ["https://www.ziprecruiter.com/jobs/acme-1234", "https://www.ziprecruiter.com/jobs/acme-1234", "", ""],
  ["https://github.com/acme/jobs", "https://github.com/acme/jobs", "", ""],
  // Hosts and shapes
  ["https://Bücher.example/jobs/store-manager", "https://xn--bcher-kva.example/jobs/store-manager", "", "Store Manager"],
  ["  https://jobs.lever.co/acme/" + UUID + " \n", `https://jobs.lever.co/acme/${UUID}`, "Acme", ""],
  [`<https://jobs.lever.co/acme/${UUID}>`, `https://jobs.lever.co/acme/${UUID}`, "Acme", ""],
  ["//jobs.lever.co/acme/" + UUID, `https://jobs.lever.co/acme/${UUID}`, "Acme", ""],
];

const REJECTED = [
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  "data:text/html,<h1>x</h1>",
  "file:///etc/passwd",
  "ftp://acme.com/jobs",
  "mailto:jobs@acme.com",
  "https://user:pass@acme.com/jobs",
  "https://user@boards.greenhouse.io/acme/jobs/1",
  "https://acme.com@evil.com/jobs",
  "",
  "   ",
  "not a url",
  "https://boards.greenhouse.io/ac me/jobs/1",
  "localhost",
  "http://127.0.0.1/jobs",
  "http://[::1]/jobs",
  "https://acme/jobs",
  "https://",
];

describe("parseJobUrl table", () => {
  it("has at least 60 shapes", () => {
    expect(TABLE.length + REJECTED.length).toBeGreaterThanOrEqual(60);
  });

  it.each(TABLE)("%s", (input, url, company, role) => {
    const d = parseJobUrl(input);
    expect(d).not.toBeNull();
    expect(d).toMatchObject({ url, company, role, location: "", source: "link" });
    expect(d?.guessed).toEqual({ company: company !== "", role: role !== "" });
  });

  it.each(REJECTED)("rejects %j", (input) => {
    expect(parseJobUrl(input)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(parseJobUrl(undefined as unknown as string)).toBeNull();
    expect(parseJobUrl(42 as unknown as string)).toBeNull();
  });

  it("still returns the cleaned url when nothing can be derived", () => {
    expect(parseJobUrl("https://www.linkedin.com/jobs/view/3812345678?trk=x")).toEqual({
      company: "", role: "", location: "", url: "https://www.linkedin.com/jobs/view/3812345678", source: "link",
      guessed: { company: false, role: false },
    });
  });

  it("never puts an em-dash in a derived name", () => {
    for (const [input] of TABLE) {
      const d = parseJobUrl(input);
      expect(`${d?.company}${d?.role}`).not.toMatch(/\u2014/);
    }
  });
});

describe("helpers", () => {
  it("title-cases slugs without inventing capitals", () => {
    expect(slugToName("my-company")).toBe("My Company");
    expect(slugToName("bank-of-montreal")).toBe("Bank of Montreal");
    expect(slugToName("OpenAI")).toBe("OpenAI");
    expect(slugToName("ACME-CORP")).toBe("Acme Corp");
    expect(slugToName("ibm")).toBe("Ibm");
    expect(slugToName("senior-qa-engineer", "role")).toBe("Senior QA Engineer");
  });

  it("derives roles only from title-like slugs", () => {
    expect(roleFromSlug("senior-engineer")).toBe("Senior Engineer");
    expect(roleFromSlug("engineer")).toBe("");
    expect(roleFromSlug("12345")).toBe("");
    expect(roleFromSlug("a-b-c-d-e-f-g-h-i-j-k-l")).toBe("");
    expect(roleFromSlug("data-analyst-REQ-12345")).toBe("Data Analyst");
  });

  it("cleanJobUrl returns empty for bad input", () => {
    expect(cleanJobUrl("javascript:alert(1)")).toBe("");
    expect(cleanJobUrl("https://acme.com/jobs/1?utm_source=x")).toBe("https://acme.com/jobs/1");
  });

  it("validates slugs and ids", () => {
    expect(isSafeSlug("acme-co.io_1")).toBe(true);
    for (const bad of ["..", ".", "a/b", "a b", "a?b", "a#b", "a%2fb", "", "x".repeat(81), "a\\b"]) expect(isSafeSlug(bad)).toBe(false);
    expect(isSafeId("123-abc")).toBe(true);
    for (const bad of ["a.b", "a/b", "", "x".repeat(65), "a%2f"]) expect(isSafeId(bad)).toBe(false);
  });

  it("detects the four boards", () => {
    expect(detectBoard("https://boards.greenhouse.io/acme/jobs/123")).toEqual({ board: "greenhouse", slug: "acme", id: "123" });
    expect(detectBoard(`https://jobs.eu.lever.co/acme/${UUID}`)).toEqual({ board: "lever", slug: "acme", id: UUID, eu: true });
    expect(detectBoard(`https://jobs.ashbyhq.com/acme/${UUID}`)).toEqual({ board: "ashby", slug: "acme", id: UUID });
    expect(detectBoard("https://jobs.smartrecruiters.com/Bosch/743999876543210-senior-engineer")).toEqual({ board: "smartrecruiters", slug: "Bosch", id: "743999876543210" });
    expect(detectBoard("https://careers.acme.com/x?gh_jid=99")).toEqual({ board: "greenhouse", slug: "acme", id: "99" });
    expect(detectBoard("https://www.linkedin.com/jobs/view/123?gh_jid=99")).toBeNull();
    expect(detectBoard("https://acme.wd5.myworkdayjobs.com/en/job/x/y_R1")).toBeNull();
    expect(detectBoard("nonsense")).toBeNull();
  });
});
