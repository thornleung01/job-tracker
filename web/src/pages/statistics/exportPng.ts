// Draws the sentence and the chart into one PNG, in the page, so nothing is uploaded anywhere. Ported from renderPng in flow.html.
import fontUrl from "../../assets/fonts/Figtree-latin-wght.woff2?url";

export interface SummaryPart {
  text: string;
  strong: boolean;
}

export interface PngInput {
  /** the rendered chart */
  svg: SVGSVGElement;
  /** the .viz-root element, for the resolved color tokens */
  viz: HTMLElement;
  /** the sentence, with the numbers flagged bold */
  parts: SummaryPart[];
  /** "All time", "Last 30 days", ... for the footer */
  period: string;
}

export class ImageUnsupportedError extends Error {}

async function fontAsDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((done, fail) => {
    const r = new FileReader();
    r.onload = () => done(String(r.result));
    r.onerror = () => fail(r.error);
    r.readAsDataURL(blob);
  });
}

/** Split the sentence into words and spaces, each carrying its weight, so it can wrap on the canvas. */
export function sentenceRuns(parts: SummaryPart[]): { t: string; w: number }[] {
  const runs: { t: string; w: number }[] = [];
  for (const p of parts) for (const t of p.text.split(/(\s+)/).filter(Boolean)) runs.push({ t, w: p.strong ? 700 : 400 });
  return runs;
}

export async function renderPng({ svg, viz, parts, period }: PngInput): Promise<Blob> {
  // jsdom and some embedded browsers have no canvas. Say so before doing any work.
  const probe = document.createElement("canvas").getContext?.("2d");
  if (!probe) throw new ImageUnsupportedError("canvas");

  const cs = getComputedStyle(viz);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  const ink = v("--ink");
  const muted = v("--ink2");
  const surface = v("--viz-surface");
  if (document.fonts?.load) {
    await Promise.all([document.fonts.load("400 30px Figtree"), document.fonts.load("700 30px Figtree"), document.fonts.load("400 15px Figtree")]);
  }

  // The chart: a standalone copy of the SVG with colors resolved and the font embedded.
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll(".hit").forEach((n) => n.remove());
  ["role", "aria-label", "tabindex", "class"].forEach((a) => clone.removeAttribute(a));
  clone.querySelectorAll("[tabindex],[role],[aria-label]").forEach((n) => ["tabindex", "role", "aria-label"].forEach((a) => n.removeAttribute(a)));
  const [, , vbW, vbH] = (svg.getAttribute("viewBox") ?? "0 0 1000 490").split(" ").map(Number);
  clone.setAttribute("width", String(vbW));
  clone.setAttribute("height", String(vbH));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const font = await fontAsDataUrl(fontUrl);
  const style = `<style>@font-face{font-family:"Figtree";src:url(${font}) format("woff2");font-weight:300 900}
      text{font-family:"Figtree",sans-serif}
      .lbl{fill:${ink};font-size:14px;font-weight:500;paint-order:stroke;stroke:${surface};stroke-width:4px;stroke-linejoin:round}
      .sub{fill:${muted};font-size:13px;font-weight:400}
      .link{fill:none;stroke-opacity:.38}
      .ico{fill:none;stroke:${ink};stroke-width:3;stroke-linecap:round;stroke-linejoin:round}</style>`;
  let markup = new XMLSerializer().serializeToString(clone).replace(/var\((--[\w-]+)\)/g, (_, name: string) => v(name));
  markup = markup.replace(/(<svg[^>]*>)/, `$1${style}`);
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup);
  await img.decode();

  // The sentence, wrapped, with the numbers in the heavier weight.
  const W = 1200, PAD = 56, SIZE = 30, LH = 44, SCALE = 2, FOOT = 40;
  const face = (w: number) => `${w} ${SIZE}px Figtree, system-ui, sans-serif`;
  const lines: { t: string; w: number; width: number }[][] = [[]];
  let x = 0;
  for (const r of sentenceRuns(parts)) {
    probe.font = face(r.w);
    const width = probe.measureText(r.t).width;
    const blank = /^\s+$/.test(r.t);
    if (x + width > W - 2 * PAD && !blank && lines[lines.length - 1].length) {
      lines.push([]);
      x = 0;
    }
    if (blank && x === 0) continue;
    lines[lines.length - 1].push({ ...r, width });
    x += width;
  }
  const chartW = W - 2 * PAD;
  const chartH = Math.round((chartW * vbH) / vbW);
  const H = PAD + lines.length * LH + 28 + chartH + FOOT + PAD / 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageUnsupportedError("canvas");
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = surface;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = ink;
  ctx.textBaseline = "alphabetic";
  lines.forEach((line, i) => {
    let px = PAD;
    for (const r of line) {
      ctx.font = face(r.w);
      ctx.fillText(r.t, px, PAD + (i + 1) * LH - 12);
      px += r.width;
    }
  });
  const top = PAD + lines.length * LH + 28;
  ctx.drawImage(img, PAD, top, chartW, chartH);
  const date = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  ctx.font = "400 15px Figtree, system-ui, sans-serif";
  ctx.fillStyle = muted;
  ctx.fillText(["Job Tracker", period, date].filter(Boolean).join("  ·  "), PAD, top + chartH + 28);
  return new Promise((done, fail) => canvas.toBlob((b) => (b ? done(b) : fail(new Error("no image"))), "image/png"));
}

/** Your local date, the same one the image footer shows. */
export function imageFileName(d: Date = new Date()): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `job-search-statistics-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}.png`;
}
