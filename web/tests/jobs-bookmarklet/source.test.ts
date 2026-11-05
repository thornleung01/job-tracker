import { describe, expect, it, vi } from "vitest";
import { buildBookmarkletSource, composeBookmarklet, draftFromHash, extract } from "../../src/jobs/bookmarklet";
import { ALL, bare, driftedLinkedin, linkedin, parse } from "./fixtures";

const APP = "https://thornleung01.github.io/job-tracker/";
const source = buildBookmarkletSource(APP);

// What production ships: Vite minifies the bundle with esbuild, so Function.toString() returns the minified functions there.
// (The project has no Node type definitions, so Node's modules are loaded through a variable specifier.)
const nodeModule = "node:child_process";
const { execFileSync } = (await import(/* @vite-ignore */ nodeModule)) as { execFileSync(cmd: string, args: string[], opts: object): string };
const proc = (globalThis as unknown as { process: { cwd(): string; execPath: string } }).process;
const minifiedFns = (): [Function, Function] => {
  const file = proc.cwd() + "/src/jobs/bookmarklet/extract.ts"; // vitest runs from web/
  // esbuild refuses to load inside the jsdom environment (TextEncoder), so minify in a child process.
  const script = `const {transformSync}=require("esbuild");process.stdout.write(transformSync(require("fs").readFileSync(process.argv[1],"utf8"),{loader:"ts",minify:true,format:"esm",target:"es2022"}).code)`;
  const js = execFileSync(proc.execPath, ["-e", script, file], { cwd: proc.cwd(), encoding: "utf8" }).replace(/export\{(\w+) as extract,(\w+) as launch\};?\s*$/, "return {extract:$1,launch:$2};");
  const fns = new Function(js)() as { extract: Function; launch: Function };
  return [fns.launch, fns.extract];
};
const minified = composeBookmarklet(...minifiedFns(), APP);

/** Runs the bookmarklet the way a browser does: percent-decode, then evaluate with this page's document, window and location. */
function click(src: string, html: string, url: string, open: (u: string) => unknown = () => ({})) {
  const doc = parse(html);
  const win = { open: vi.fn((u: string) => open(u)), setTimeout: vi.fn((fn: () => void, ms: number) => { timers.push({ fn, ms }); return 1; }) };
  const timers: { fn: () => void; ms: number }[] = [];
  const code = decodeURIComponent(src.slice("javascript:".length));
  new Function("document", "window", "location", code)(doc, win, { href: url });
  return { doc, win, timers };
}

describe("buildBookmarkletSource", () => {
  it("is a javascript: URL, under 6 KB in production, under 8 KB unminified", () => {
    expect(source.startsWith("javascript:")).toBe(true);
    expect(minified.startsWith("javascript:")).toBe(true);
    // Ceilings, so a change cannot silently bloat the bookmarklet. The production size is printed for the build summary.
    console.info(`bookmarklet size: ${minified.length} bytes minified, ${source.length} bytes unminified`);
    expect(minified.length).toBeLessThan(6000);
    expect(source.length).toBeLessThan(8000);
  });

  it("contains nothing that could send data off the page or run dynamic code", () => {
    for (const src of [source, minified]) for (const bad of ["eval", "Function(", "fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "importScripts", "innerHTML", "document.write", "location.href=", "location.assign"]) {
      expect(src, bad).not.toContain(bad);
    }
  });

  it("has no raw '#', no stray '%', no non-ASCII, no comments and no newlines (browsers treat them specially in javascript: URLs)", () => {
    for (const src of [buildBookmarkletSource("https://x.test/app/"), composeBookmarklet(...minifiedFns(), "https://x.test/app/")]) {
      expect(src).not.toContain("#");
      expect(src).not.toContain("\n");
      expect(src).toMatch(/^[\x20-\x7e]+$/);
      expect(src.replace("https://x.test/app/", "")).not.toContain("//");
      expect(src.replace(/%25/g, "")).not.toContain("%");
    }
  });

  it("escapes a percent sign in the app URL so the browser's decoding gives it back", () => {
    const odd = buildBookmarkletSource("https://x.test/a%20b/");
    const { win } = click(odd, "<html></html>", "https://example.com/p");
    expect(win.open.mock.calls[0][0].startsWith("https://x.test/a%20b/#/?add=1")).toBe(true);
  });

  it("does not let an app URL break out of the script", () => {
    const evil = buildBookmarkletSource('https://x.test/"</script>;alert(1)//');
    const { win } = click(evil, "<html></html>", "https://example.com/p");
    expect(win.open).toHaveBeenCalledTimes(1);
  });

  describe("produces the same answer as the readable extractor on every fixture", () => {
    for (const [variant, src] of [["unminified", source], ["minified", minified]] as const) for (const f of ALL) {
      it(`${f.name} (${variant})`, () => {
        const { win } = click(src, f.html, f.url);
        expect(win.open).toHaveBeenCalledTimes(1);
        const [opened, target] = win.open.mock.calls[0] as unknown as [string, string];
        expect(target).toBe("_blank");
        expect(opened.startsWith(APP + "#/?")).toBe(true);
        const q = new URLSearchParams(opened.slice((APP + "#/?").length));
        const want = extract(parse(f.html), f.url);
        expect(q.get("add")).toBe("1");
        expect(q.get("s")).toBe("bm");
        expect(q.get("c") ?? "").toBe(want.c);
        expect(q.get("r") ?? "").toBe(want.r);
        expect(q.get("l") ?? "").toBe(want.l);
        expect(q.get("u") ?? "").toBe(want.u);
        expect(q.get("g") ?? "0").toBe(String(want.g));
      });
    }
  });

  it("round-trips through draftFromHash", () => {
    const f = ALL[0];
    const { win } = click(source, f.html, f.url);
    const opened = win.open.mock.calls[0][0] as string;
    const draft = draftFromHash(new URLSearchParams(opened.slice(opened.indexOf("?") + 1)));
    expect(draft).toMatchObject({ company: "Acme Corp", role: "Senior Product Designer", location: "Toronto, ON", source: "bookmarklet", guessed: { company: false, role: false } });
  });

  it("detaches the new tab from the page it came from", () => {
    const tab: { opener: unknown } = { opener: "page" };
    click(source, "<html></html>", "https://example.com/p", () => tab);
    expect(tab.opener).toBeNull();
  });

  it("shows a plain-text toast for four seconds when pop-ups are blocked, and opens nothing else", () => {
    const { doc, timers, win } = click(source, "<html><body></body></html>", "https://example.com/p", () => null);
    expect(win.open).toHaveBeenCalledTimes(1);
    const toast = doc.body.lastElementChild!;
    expect(toast.textContent).toBe("Allow pop-ups to save this job");
    expect(toast.children).toHaveLength(0);
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(4000);
    timers[0].fn();
    expect(doc.body.contains(toast)).toBe(false);
  });

  it("opens the app and says so, as plain text for four seconds, when nothing could be read", () => {
    for (const src of [source, minified]) for (const f of [bare, driftedLinkedin]) {
      const { doc, timers, win } = click(src, f.html, f.url);
      expect(win.open).toHaveBeenCalledTimes(1);
      const q = new URLSearchParams((win.open.mock.calls[0][0] as string).slice((APP + "#/?").length));
      expect(q.get("u")).toBeTruthy();
      const toast = doc.body.lastElementChild!;
      expect(toast.textContent).toBe("Couldn't read this page. Add the details by hand.");
      expect(toast.children).toHaveLength(0);
      expect(timers.map((t) => t.ms)).toEqual([4000]);
      timers[0].fn();
      expect(doc.body.contains(toast)).toBe(false);
    }
  });

  it("shows no toast when at least a company or a role was read", () => {
    for (const src of [source, minified]) {
      const { doc, timers } = click(src, linkedin.html, linkedin.url);
      expect(doc.body.textContent).not.toContain("Couldn't read");
      expect(timers).toHaveLength(0);
    }
  });

  it("prefers the pop-up message when the pop-up was blocked and nothing was read", () => {
    const { doc } = click(source, bare.html, bare.url, () => null);
    expect(doc.body.lastElementChild!.textContent).toBe("Allow pop-ups to save this job");
  });

  it("never throws into the page, even when window.open does", () => {
    const doc = parse("<html></html>");
    const code = decodeURIComponent(source.slice("javascript:".length));
    const win = { open: () => { throw new Error("blocked"); }, setTimeout: () => 0 };
    expect(() => new Function("document", "window", "location", code)(doc, win, { href: "https://example.com/p" })).not.toThrow();
  });
});
