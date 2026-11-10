// readJobFromPaste: a pasted posting as the Resume page's job (company, role, link, posting text), with "" for anything it can't read.
import { describe, expect, it } from "vitest";
import { readJobFromPaste } from "../../src/jobs";

const LINKEDIN = [
  "Skip to main content",
  "Sign in",
  "Product Analyst",
  "Gringotts",
  "London, United Kingdom · Reposted 3 days ago · 84 applicants",
  "Easy Apply",
  "Save",
  "About the job",
  "Gringotts is looking for a Product Analyst to join the vaults team. You will own the weekly reporting on withdrawals, partner with",
  "the goblin operations leads, and build dashboards in SQL and Tableau. Three years of analytics experience is a plus.",
].join("\n");

describe("readJobFromPaste", () => {
  it("reads company and role from a LinkedIn-style copy and keeps the whole paste as the posting text", () => {
    const job = readJobFromPaste(LINKEDIN);
    expect(job).toMatchObject({ company: "Gringotts", role: "Product Analyst" });
    expect(job.url).toBeUndefined();
    expect(job.description).toContain("build dashboards in SQL and Tableau");
    expect(job.description).toContain("Product Analyst");
  });

  it("reads a JSON-LD JobPosting and uses its description", () => {
    const ld = JSON.stringify({
      "@context": "https://schema.org", "@type": "JobPosting", title: "Data Engineer", hiringOrganization: { "@type": "Organization", name: "Hooli" },
      description: "<p>Hooli is hiring a <b>Data Engineer</b> to build the pipelines behind search.</p><ul><li>Python</li><li>Airflow</li></ul>",
      url: "https://hooli.example/jobs/42",
    });
    const job = readJobFromPaste(`<html><script type="application/ld+json">${ld}</script><body>Menu</body></html>`);
    expect(job.company).toBe("Hooli");
    expect(job.role).toBe("Data Engineer");
    expect(job.description).toContain("Data Engineer to build the pipelines behind search.");
    expect(job.description).not.toMatch(/<|Menu/);
  });

  it("returns empty strings when it can't read a company or a role, and still keeps a short posting", () => {
    const text = "we're looking for someone to help us grow. you'll work with sales and support every day.";
    expect(readJobFromPaste(text)).toEqual({ company: "", role: "", description: text });
  });

  it("returns empty strings for an empty paste", () => {
    expect(readJobFromPaste("")).toEqual({ company: "", role: "", description: "" });
    expect(readJobFromPaste("  \n ")).toEqual({ company: "", role: "", description: "" });
    expect(readJobFromPaste(undefined as unknown as string)).toEqual({ company: "", role: "", description: "" });
  });

  it("cleans the link, fills gaps from it, and drops one that isn't a web address", () => {
    const job = readJobFromPaste("Remote\nWe build tools for small shops.", "https://jobs.lever.co/acme-co/5f8a1c2e-1234-4abc-9def-0123456789ab?utm_source=x");
    expect(job).toMatchObject({ company: "Acme Co", url: "https://jobs.lever.co/acme-co/5f8a1c2e-1234-4abc-9def-0123456789ab" });
    expect(readJobFromPaste(LINKEDIN, "javascript:alert(1)").url).toBeUndefined();
  });

  it("keeps no posting text for a bare link, and strips markup and control characters from the posting", () => {
    expect(readJobFromPaste("https://careers.acme.com/jobs/senior-product-manager").description).toBe("");
    const job = readJobFromPaste("<div><h1>Data Analyst\u0000</h1><p>Acme Corp</p><p>Toronto, ON</p><p>Build reports.</p></div>");
    expect(job).toMatchObject({ company: "Acme Corp", role: "Data Analyst" });
    expect(job.description).not.toMatch(/[<>\u0000]/);
    expect(job.description).toContain("Build reports.");
  });
});
