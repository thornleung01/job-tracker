#!/usr/bin/env node
// Renders the app icons in public/icons from public/favicon.svg with headless Chrome. The PNGs are committed, so this only
// needs to run when the favicon changes: `node web/scripts/make-icons.mjs` (Chrome at the macOS default path, or set CHROME).
//
//   icon-192.png, icon-512.png   the favicon on a transparent background (purpose "any")
//   icon-maskable-512.png        a full-bleed black square with the check mark inside the central safe zone, so any mask shape
//                                an OS applies (circle, squircle) keeps the whole mark (purpose "maskable")
//   apple-touch-icon.png         180px, the maskable design: iOS rounds the corners itself and fills transparency with black
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");
const svg = readFileSync(join(publicDir, "favicon.svg"), "utf8");
const mark = /<path[^>]*\/>/.exec(svg)?.[0];
if (!mark) throw new Error("favicon.svg has no check mark path");

// The favicon's own drawing: a 32 x 32 circle with the mark.
const anyIcon = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#000000"/>${mark}</svg>`;
// Scaled by 1.2 around the centre, the farthest tip of the mark is about 37% of the width from the centre, inside the 40% radius of the maskable safe zone.
const maskableIcon = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32"><rect width="32" height="32" fill="#000000"/><g transform="translate(16 16) scale(1.2) translate(-16 -16)">${mark}</g></svg>`;

const icons = [
  ["icon-192.png", anyIcon(192), 192],
  ["icon-512.png", anyIcon(512), 512],
  ["icon-maskable-512.png", maskableIcon(512), 512],
  ["apple-touch-icon.png", maskableIcon(180), 180],
];

const work = mkdtempSync(join(tmpdir(), "jobtracker-icons-"));
try {
  for (const [file, drawing, size] of icons) {
    const page = join(work, `${file}.html`);
    writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block}</style>${drawing}`);
    const out = join(work, file);
    execFileSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000", `--window-size=${size},${size}`, `--screenshot=${out}`, `file://${page}`], { stdio: "ignore" });
    copyFileSync(out, join(publicDir, "icons", file));
    console.log(`public/icons/${file}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
