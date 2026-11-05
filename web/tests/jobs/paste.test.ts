import { describe, expect, it } from "vitest";
import { parsePastedText } from "../../src/jobs";

const guessed = { company: true, role: true };

describe("parsePastedText", () => {
  it("reads a LinkedIn-style copy: title, company, location, noise around it", () => {
    const text = ["Skip to main content", "Sign in", "Senior Software Engineer", "Acme Corp", "Toronto, ON \u00b7 Reposted 2 weeks ago \u00b7 100 applicants", "Easy Apply", "Save", "About the job", "We are looking for an engineer."].join("\n");
    expect(parsePastedText(text)).toEqual({
      company: "Acme Corp", role: "Senior Software Engineer", location: "Toronto, ON", url: "", source: "paste", guessed,
    });
  });

  it("reads '{role} at {company}'", () => {
    const d = parsePastedText("Product Designer at Big Co\nRemote\nApply");
    expect(d).toMatchObject({ role: "Product Designer", company: "Big Co", location: "Remote", source: "paste", guessed });
  });

  it("reads '{company} is hiring'", () => {
    expect(parsePastedText("Acme Labs is hiring a Data Scientist\nVancouver, BC")).toMatchObject({ company: "Acme Labs", role: "Data Scientist", location: "Vancouver, BC" });
    expect(parsePastedText("Acme Labs is hiring")).toMatchObject({ company: "Acme Labs", role: "" });
  });

  it("reads labelled lines", () => {
    const d = parsePastedText("Job title: Support Lead\nCompany: Widgets Inc\nLocation: Hybrid - Ottawa, ON");
    expect(d).toMatchObject({ role: "Support Lead", company: "Widgets Inc", location: "Hybrid - Ottawa, ON" });
  });

  it("reads '{role} - {company}' and '{role} | {company}' titles, dropping job-board names", () => {
    expect(parsePastedText("Backend Engineer - Acme Corp - Greenhouse")).toMatchObject({ role: "Backend Engineer", company: "Acme Corp" });
    expect(parsePastedText("Backend Engineer | Acme Corp | Careers")).toMatchObject({ role: "Backend Engineer", company: "Acme Corp" });
    expect(parsePastedText("Backend Engineer \u2013 Acme Corp \u2013 Calgary, AB")).toMatchObject({ role: "Backend Engineer", company: "Acme Corp", location: "Calgary, AB" });
  });

  it("reads 'About {company}' but not 'About us'", () => {
    const d = parsePastedText("Senior Accountant\nRemote\nAbout the job\nlots of text here that is long enough to be a sentence.\nAbout Northwind Traders\nWe make things.");
    expect(d).toMatchObject({ role: "Senior Accountant", company: "Northwind Traders" });
    expect(parsePastedText("Senior Accountant\nAbout us\nWe are great.")?.company).toBe("");
  });

  it("'Careers at {company}' gives only the company", () => {
    expect(parsePastedText("Careers at Acme\nStaff Engineer\nRemote")).toMatchObject({ company: "Acme", role: "Staff Engineer" });
  });

  it("finds countries and remote variants as locations", () => {
    expect(parsePastedText("QA Analyst\nAcme\nLondon, United Kingdom")?.location).toBe("London, United Kingdom");
    expect(parsePastedText("QA Analyst\nAcme\nRemote - Canada")?.location).toBe("Remote - Canada");
    expect(parsePastedText("QA Analyst\nAcme\nHybrid")?.location).toBe("Hybrid");
    expect(parsePastedText("QA Analyst\nAcme\nToronto, Ontario, Canada (Remote)")?.location).toBe("Toronto, Ontario, Canada (Remote)");
  });

  it("does not take a comma title or a paragraph for a location, company or role", () => {
    const d = parsePastedText("Senior Engineer, Platform\nWe build payment tools for small teams.\nSan Francisco, CA");
    expect(d).toMatchObject({ role: "Senior Engineer, Platform", location: "San Francisco, CA" });
    expect(d?.company).toBe("");
  });

  it("uses JSON-LD when the text has it, and trusts it", () => {
    const ld = JSON.stringify({ "@type": "JobPosting", title: "Analyst", hiringOrganization: { name: "Acme" }, jobLocationType: "TELECOMMUTE" });
    const html = `<script type="application/ld+json">${ld}</script><p>Other text</p>`;
    expect(parsePastedText(html, "https://acme.com/jobs/1?utm_source=x")).toEqual({
      company: "Acme", role: "Analyst", location: "Remote", url: "https://acme.com/jobs/1", source: "paste", guessed: { company: false, role: false },
    });
    expect(parsePastedText(ld)).toMatchObject({ company: "Acme", role: "Analyst", guessed: { company: false, role: false } });
  });

  it("fills gaps from the link and always returns the cleaned link", () => {
    const d = parsePastedText("Remote", "https://jobs.lever.co/acme-co/5f8a1c2e-1234-4abc-9def-0123456789ab?lever-source=x");
    expect(d).toEqual({
      company: "Acme Co", role: "", location: "Remote", url: "https://jobs.lever.co/acme-co/5f8a1c2e-1234-4abc-9def-0123456789ab",
      source: "paste", guessed: { company: true, role: false },
    });
  });

  it("text beats the link for company and role", () => {
    const d = parsePastedText("Platform Engineer at Real Name", "https://careers.acme.com/jobs/senior-product-manager");
    expect(d).toMatchObject({ role: "Platform Engineer", company: "Real Name", url: "https://careers.acme.com/jobs/senior-product-manager" });
  });

  it("returns a link-only draft when the text is empty but a url is given", () => {
    expect(parsePastedText("", "https://careers.acme.com/jobs/senior-product-manager")).toMatchObject({ company: "Acme", role: "Senior Product Manager" });
  });

  it("returns null when nothing can be derived", () => {
    expect(parsePastedText("")).toBeNull();
    expect(parsePastedText("   \n\n  ")).toBeNull();
    expect(parsePastedText("Apply\nSave\nShare\nEasy Apply\nSkip to main content\nSign in")).toBeNull();
    expect(parsePastedText("x", "javascript:alert(1)")).toBeNull();
    expect(parsePastedText(undefined as unknown as string)).toBeNull();
  });

  it("strips markup and control characters", () => {
    const d = parsePastedText("<div><h1>Data Analyst\u0000</h1><p>Acme Corp</p><p>Toronto, ON</p></div>");
    expect(d).toMatchObject({ role: "Data Analyst", company: "Acme Corp", location: "Toronto, ON" });
  });

  it("caps its input at 200 KB and stays fast", () => {
    const filler = "lorem ipsum dolor sit amet\n".repeat(20000);
    const started = Date.now();
    const d = parsePastedText("Role Name Here\nAcme\n" + filler + "Company: Late Co");
    expect(Date.now() - started).toBeLessThan(2000);
    expect(d?.company).toBe("Acme");
    const late = parsePastedText("x\n".repeat(150_000) + "Company: Late Co");
    expect(late?.company ?? "").not.toBe("Late Co");
  });

  it("never returns an em-dash or markup in a field", () => {
    const d = parsePastedText("Engineer \u2014 Acme\nRemote");
    for (const v of [d?.company, d?.role, d?.location]) expect(v ?? "").not.toMatch(/[<>\u2014]/);
  });
});
