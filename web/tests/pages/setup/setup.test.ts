import { afterEach, describe, expect, it, vi } from "vitest";
import { $, $$, button, cleanup, click, freshDb, mountPage, text, type } from "../applications/harness";
import { configJsonText } from "../../../src/config";
import SetupGuide from "../../../src/pages/setup/SetupGuide";
import Setup from "../../../src/pages/setup";
import { editConfigUrl, actionsUrl, GITHUB_REPO } from "../../../src/site";
import { googleLinks, inviteText, microsoftLinks, setupValues } from "../../../src/pages/setup/steps";

const GOOGLE_ID = "1234567890-abc123def456.apps.googleusercontent.com";
const MS_ID = "0a1b2c3d-4e5f-6789-abcd-ef0123456789";

const siteUrl = () => window.location.origin + import.meta.env.BASE_URL;

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await cleanup();
});

async function mount() {
  const { container } = await mountPage(SetupGuide, freshDb(), "/setup");
  return container;
}

function mockClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

describe("setupValues", () => {
  it("derives every value from the origin and the base path", () => {
    const v = setupValues("https://me.github.io", "/job-tracker/");
    expect(v.origin).toBe("https://me.github.io");
    expect(v.redirectUri).toBe("https://me.github.io/job-tracker/");
    expect(v.privacyUrl).toBe("https://me.github.io/job-tracker/privacy.html");
    expect(v.googleScopes).toBe("openid email profile https://www.googleapis.com/auth/gmail.readonly");
    expect(v.msScopes).toBe("openid profile email Mail.Read");
  });

  it("works for a site served from the root", () => {
    const v = setupValues("http://localhost:5173", "/");
    expect(v.redirectUri).toBe("http://localhost:5173/");
    expect(v.privacyUrl).toBe("http://localhost:5173/privacy.html");
  });

  it("only links to https pages on the expected hosts", () => {
    const hosts = new Map<string, string>([
      ...Object.values(googleLinks).map((u): [string, string] => [u, "console.cloud.google.com"]),
      [microsoftLinks.appRegistrations, "entra.microsoft.com"],
      [microsoftLinks.freeAzure, "azure.microsoft.com"],
      [editConfigUrl, "github.com"],
      [actionsUrl, "github.com"],
    ]);
    for (const [href, host] of hosts) {
      const u = new URL(href);
      expect(u.protocol).toBe("https:");
      expect(u.hostname).toBe(host);
    }
    expect(googleLinks.clients).toBe("https://console.cloud.google.com/auth/clients");
    expect(googleLinks.audience).toBe("https://console.cloud.google.com/auth/audience");
  });
});

describe("site links", () => {
  it("are fixed constants", () => {
    expect(GITHUB_REPO).toBe("thornleung01/job-tracker");
    expect(editConfigUrl).toBe("https://github.com/thornleung01/job-tracker/edit/main/web/site-config.json");
    expect(actionsUrl).toBe("https://github.com/thornleung01/job-tracker/actions/workflows/pages.yml");
  });

  it("do not change when the page URL asks for another repo", async () => {
    window.history.replaceState(null, "", "/?repo=evil/repo#/setup?repo=evil/repo");
    const c = await mount();
    const link = $$(c, "a").find((a) => text(a).startsWith("Open site-config.json on GitHub"));
    expect(link?.getAttribute("href")).toBe("https://github.com/thornleung01/job-tracker/edit/main/web/site-config.json");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(c.innerHTML).not.toContain("evil");
    window.history.replaceState(null, "", "/");
  });
});

describe("the setup guide", () => {
  it("is the default export of the setup route and takes no props", async () => {
    const { container } = await mountPage(Setup, freshDb(), "/setup");
    expect(text($(container, "h1"))).toBe("Set up mail sync");
  });

  it("shows the values for this site and no build variable names", async () => {
    const c = await mount();
    const v = setupValues(window.location.origin, import.meta.env.BASE_URL);
    const codes = $$(c, "code").map(text);
    expect(codes).toContain(v.origin);
    expect(codes).toContain(v.redirectUri);
    expect(codes).toContain(v.googleScopes);
    expect(codes).toContain(v.msScopes);
    expect(codes).toContain(v.privacyUrl);
    expect(c.textContent).not.toMatch(/VITE_/);
    expect(c.textContent).not.toContain(";");
  });

  it("has the Google and Microsoft sections with numbered steps", async () => {
    const c = await mount();
    expect($$(c, "h2").map(text)).toEqual(["This site now", "Google", "Microsoft", "Paste your IDs", "Invite someone"]);
    expect($$(c, "ol")).toHaveLength(2);
    expect($$(c, "ol")[0].querySelectorAll("li")).toHaveLength(6);
    expect($$(c, "ol")[1].querySelectorAll("li")).toHaveLength(5);
    expect(c.textContent).toContain("Single-page application");
    expect(c.textContent).toContain("Mail.Read");
    expect(c.textContent).toContain("Don't create a new one");
  });

  it("opens every outside link in a new tab without leaking the opener", async () => {
    const c = await mount();
    const outside = $$(c, "a[href^='http']");
    expect(outside.length).toBeGreaterThan(8);
    for (const a of outside) {
      expect(a.getAttribute("href")).toMatch(/^https:\/\//);
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("says Google and Microsoft login aren't set up yet in the test build", async () => {
    const c = await mount();
    const status = text($(c, ".notice"));
    expect(status).toContain("Google login isn't set up yet.");
    expect(status).toContain("Microsoft login isn't set up yet.");
  });

  it("makes no network call and loads no scripts", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const open = vi.spyOn(XMLHttpRequest.prototype, "open");
    const before = $$(document, "script").length;
    const c = await mount();
    await click(button(c, "Copy") ?? $(c, "button"));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect($$(document, "script")).toHaveLength(before);
    expect($$(document, "iframe")).toHaveLength(0);
    expect($$(document, "script[src]")).toHaveLength(0);
  });
});

describe("pasting IDs", () => {
  const googleField = (c: HTMLElement) => $(c, "#setup-google-id") as HTMLInputElement;
  const msField = (c: HTMLElement) => $(c, "#setup-ms-id") as HTMLInputElement;
  const json = (c: HTMLElement) => $(c, "pre[aria-label='Contents of site-config.json']")!.textContent;

  it("labels both fields and starts with empty JSON", async () => {
    const c = await mount();
    expect($(c, "label[for='setup-google-id']")?.textContent).toBe("Google client ID");
    expect($(c, "label[for='setup-ms-id']")?.textContent).toBe("Microsoft client ID");
    expect(json(c)).toBe(configJsonText({ googleClientId: "", msClientId: "" }));
    expect(json(c)).toBe('{\n  "googleClientId": "",\n  "msClientId": ""\n}\n');
  });

  it("checks a Google ID as you type", async () => {
    const c = await mount();
    await type(googleField(c), "hello");
    expect(googleField(c).getAttribute("aria-invalid")).toBe("true");
    expect(text($(c, "#setup-google-id-note"))).toContain("doesn't look like a Google client ID");
    await type(googleField(c), GOOGLE_ID);
    expect(googleField(c).getAttribute("aria-invalid")).toBe("false");
    expect(text($(c, "#setup-google-id-note"))).toBe("Looks right.");
  });

  it("checks a Microsoft ID as you type", async () => {
    const c = await mount();
    await type(msField(c), GOOGLE_ID);
    expect(msField(c).getAttribute("aria-invalid")).toBe("true");
    expect(text($(c, "#setup-ms-id-note"))).toContain("doesn't look like a Microsoft client ID");
    await type(msField(c), `  ${MS_ID}  `);
    expect(text($(c, "#setup-ms-id-note"))).toBe("Looks right.");
  });

  it("writes the exact JSON for valid IDs, and either may stay empty", async () => {
    const c = await mount();
    await type(googleField(c), GOOGLE_ID);
    expect(json(c)).toBe(configJsonText({ googleClientId: GOOGLE_ID, msClientId: "" }));
    await type(msField(c), MS_ID);
    expect(json(c)).toBe(`{\n  "googleClientId": "${GOOGLE_ID}",\n  "msClientId": "${MS_ID}"\n}\n`);
  });

  it("keeps an invalid value out of the JSON and turns the JSON Copy off", async () => {
    const c = await mount();
    await type(googleField(c), "oops");
    expect(json(c)).not.toContain("oops");
    expect(($(c, "button[aria-label='Copy site-config.json']") as HTMLButtonElement).disabled).toBe(true);
    await type(googleField(c), "");
    expect(($(c, "button[aria-label='Copy site-config.json']") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("copying", () => {
  it("writes each value to the clipboard and says so", async () => {
    const writeText = mockClipboard();
    const c = await mount();
    const origin = $(c, "button[aria-label='Copy Authorized JavaScript origin']");
    await click(origin);
    expect(writeText).toHaveBeenCalledWith(window.location.origin);
    expect(text(origin!.parentElement!.querySelector("[role=status]"))).toBe("Copied.");
    await click($(c, "button[aria-label='Copy Redirect URI']"));
    expect(writeText).toHaveBeenLastCalledWith(siteUrl());
    await click($(c, "button[aria-label='Copy Google scopes']"));
    expect(writeText).toHaveBeenLastCalledWith("openid email profile https://www.googleapis.com/auth/gmail.readonly");
  });

  it("copies the generated JSON", async () => {
    const writeText = mockClipboard();
    const c = await mount();
    await type($(c, "#setup-google-id"), GOOGLE_ID);
    await click($(c, "button[aria-label='Copy site-config.json']"));
    expect(writeText).toHaveBeenCalledWith(configJsonText({ googleClientId: GOOGLE_ID, msClientId: "" }));
  });

  it("has a Copy button for every value", async () => {
    const c = await mount();
    for (const value of $$(c, ".setup-value")) expect(value.querySelector("button")).not.toBeNull();
  });

  it("says when the browser won't copy", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }, configurable: true });
    const c = await mount();
    const b = $(c, "button[aria-label='Copy Redirect URI']");
    await click(b);
    expect(text(b!.parentElement!.querySelector("[role=status]"))).toContain("Couldn't copy");
  });
});

describe("inviting someone", () => {
  it("shows a message with the site link and the Google notice steps", async () => {
    const writeText = mockClipboard();
    const c = await mount();
    const message = $(c, "pre[aria-label='Invite message']")!.textContent!;
    expect(message).toBe(inviteText(siteUrl()));
    expect(message).toContain(siteUrl());
    expect(message).toContain("Continue with Google");
    expect(message).toContain("Advanced");
    expect(message).toContain("Go to Job Tracker");
    expect(message).toContain("Outlook needs nothing extra");
    await click($(c, "button[aria-label='Copy invite message']"));
    expect(writeText).toHaveBeenCalledWith(message);
  });

  it("links to the Google test users page", async () => {
    const c = await mount();
    const link = $$(c, "a").find((a) => text(a).startsWith("Open the Google test users page"));
    expect(link?.getAttribute("href")).toBe(googleLinks.audience);
  });
});
