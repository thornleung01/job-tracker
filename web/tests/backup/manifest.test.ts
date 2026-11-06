import { describe, expect, it } from "vitest";

// The files are read through Vite (no Node types in this project): text as ?raw, the PNGs as data URLs, and the list of what
// public/ holds from a glob, so "the path resolves to a file in public/" is checked against the real directory.
const text = import.meta.glob<string>(["../../public/*.webmanifest", "../../public/*.html", "../../index.html"], { query: "?raw", import: "default", eager: true });
const images = import.meta.glob<string>("../../public/icons/*.png", { query: "?inline", import: "default", eager: true });
const publicFiles = Object.keys(import.meta.glob("../../public/**/*", { query: "?url" })).map((k) => k.replace("../../public/", ""));
const manifest = JSON.parse(text["../../public/manifest.webmanifest"]);
const html = text["../../index.html"];
const BASE = "/job-tracker/"; // vite.config.ts base: where the site is served on GitHub Pages
const MANIFEST_URL = new URL("manifest.webmanifest", `https://example.test${BASE}`);

/** The path in public/ that a manifest URL resolves to, or null when it leaves the site's base. */
const fileFor = (url: URL): string | null => (url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : null);

/** Width and height from a PNG's header (the IHDR chunk), from its data URL. */
function pngSize(dataUrl: string): [number, number] {
  const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(",") + 1)), (c) => c.charCodeAt(0));
  expect(String.fromCharCode(...bytes.subarray(1, 4))).toBe("PNG");
  const view = new DataView(bytes.buffer);
  return [view.getUint32(16), view.getUint32(20)];
}
describe("web app manifest", () => {
  it("has what an installable app needs", () => {
    expect(manifest).toMatchObject({ name: "Job Tracker", short_name: "Job Tracker", display: "standalone" });
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.background_color).toBe("#f2f2f2");
    expect(manifest.theme_color).toBe("#f2f2f2");
  });

  it("starts at the site's own base and is scoped to it, whatever the host", () => {
    expect(new URL(manifest.start_url, MANIFEST_URL).pathname).toBe(BASE);
    expect(new URL(manifest.scope, MANIFEST_URL).pathname).toBe(BASE);
    expect(manifest.start_url).not.toMatch(/^\/|^https?:/); // relative, so it follows the base
  });

  it("matches the theme colour and background in index.html and the privacy page", () => {
    expect(html).toContain(`content="${manifest.theme_color}" media="(prefers-color-scheme: light)"`);
    expect(text["../../public/privacy.html"]).toContain(`--bg: ${manifest.background_color}`);
  });

  it("lists a 192 and a 512 icon and a maskable one, and every icon is a PNG of the size it says", () => {
    const sizes = manifest.icons.map((i: { sizes: string; purpose?: string }) => `${i.sizes}:${i.purpose ?? "any"}`);
    expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
    for (const icon of manifest.icons) {
      const file = fileFor(new URL(icon.src, MANIFEST_URL));
      expect(file, icon.src).not.toBeNull();
      expect(publicFiles, icon.src).toContain(file);
      const [w, h] = icon.sizes.split("x").map(Number);
      expect(pngSize(images[`../../public/${file}`]), icon.src).toEqual([w, h]);
      expect(icon.type).toBe("image/png");
    }
  });

  it("is linked from index.html, with the apple touch icon, and both files exist", () => {
    expect(html).toContain('<link rel="manifest" href="%BASE_URL%manifest.webmanifest">');
    const touch = /<link rel="apple-touch-icon" href="%BASE_URL%([^"]+)"/.exec(html)?.[1];
    expect(touch).toBeTruthy();
    expect(publicFiles).toContain(touch);
    expect(pngSize(images[`../../public/${touch}`])).toEqual([180, 180]);
  });

  it("needs no change to the content security policy (the manifest and icons are the site's own)", () => {
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)![1];
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain("manifest-src");
    expect(csp).toContain("img-src 'self'");
  });

  it("has no service worker: the app needs the network for mail, and a cached bundle could go stale", () => {
    expect(html).not.toMatch(/serviceWorker/);
    expect(publicFiles.filter((f) => /^(sw|service-worker)/.test(f))).toEqual([]);
  });
});
