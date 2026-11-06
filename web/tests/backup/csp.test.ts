import { describe, expect, it } from "vitest";

// The policy is a <meta> tag (GitHub Pages can't set headers). These checks pin which hosts the page may talk to, so adding one
// is a deliberate change that also reaches the privacy page, and nothing weakens the script policy by accident.
const text = import.meta.glob<string>(["../../index.html", "../../public/privacy.html"], { query: "?raw", import: "default", eager: true });
const html = text["../../index.html"];
const privacy = text["../../public/privacy.html"];

const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)![1];
const directive = (name: string): string[] => {
  const found = csp.split(";").map((d) => d.trim().split(/\s+/)).find(([n]) => n === name);
  return found ? found.slice(1) : [];
};
const connect = directive("connect-src");

describe("the content security policy", () => {
  it("lets the page connect to exactly these hosts", () => {
    expect([...connect].sort()).toEqual(
      [
        "'self'",
        "https://accounts.google.com",
        "https://api.anthropic.com",
        "https://api.ashbyhq.com",
        "https://api.eu.lever.co",
        "https://api.lever.co",
        "https://api.smartrecruiters.com",
        "https://boards-api.greenhouse.io",
        "https://gmail.googleapis.com",
        "https://graph.microsoft.com",
        "https://jobs.ashbyhq.com",
        "https://login.microsoftonline.com",
        "https://oauth2.googleapis.com",
      ].sort(),
    );
  });

  it("allows only the page's own scripts and Google's login script, with no inline or eval", () => {
    const scripts = directive("script-src");
    expect(scripts).toEqual(["'self'", "https://accounts.google.com/gsi/client"]);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts.some((s) => s.startsWith("'nonce-") || s.startsWith("'sha"))).toBe(false);
    expect(directive("default-src")).toEqual(["'self'"]);
  });

  it("has no inline script in the page", () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attrs, body] of scripts) {
      expect(attrs).toMatch(/\bsrc="/);
      expect(body.trim()).toBe("");
    }
    expect(html).not.toMatch(/\son[a-z]+="/i); // no inline event handlers either
  });

  it("names every connect-src host on the privacy page", () => {
    const hosts = connect.filter((c) => c.startsWith("https://")).map((c) => new URL(c).host);
    expect(hosts).toContain("api.anthropic.com");
    for (const host of hosts) expect(privacy, host).toContain(host);
  });
});
