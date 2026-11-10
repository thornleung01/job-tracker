// Typed resume lines to positioned text runs. Pure: no pdf-lib and no DOM, only a function that measures text, so it is testable on its own.
// It mirrors components/documents/resumesheet.css, the classic template: US letter, half-inch margins, a 10.5pt serif on a 1.25 line height,
// a centred bold name and contact line, ruled capital headings, org and school rows with the location on the right, italic titles with the dates
// on the right, and solid bullets with a bold label. Spacing between blocks collapses to the larger margin, as it does in CSS.
// One difference: bullets are left-aligned here, where the sheet justifies them.
import { isHeaderHeading } from "../../db/documentShape";
import type { DocItem, DocSection } from "../../db/schema";

export type FontKey = "regular" | "bold" | "italic";
export type Measure = (font: FontKey, size: number, text: string) => number;

/** One piece of text on one line: `x` from the page's left edge and `y` the baseline up from its bottom, both in points. */
export interface Run { text: string; font: FontKey; size: number; x: number; y: number }
export interface Rule { x1: number; x2: number; y: number; thickness: number }
export interface PageLayout { runs: Run[]; rules: Rule[] }
export interface Layout { width: number; height: number; pages: PageLayout[] }

export const LETTER = { width: 612, height: 792 } as const;
export const RESUME_STYLE = { margin: 36, size: 10.5, lineHeight: 1.25 } as const;
export const LETTER_STYLE = { margin: 72, size: 11, lineHeight: 1.4 } as const;

interface Piece { text: string; font: FontKey }

/**
 * Greedy word wrap of mixed-font segments into lines of pieces. Words are joined by one space, so a piece after the first on a line starts with
 * the space that joins it to the last. A single word wider than the line is broken by characters.
 */
export function wrapSegments(segs: readonly Piece[], width: number, size: number, measure: Measure): Piece[][] {
  const words = segs.flatMap((s) => s.text.split(/ +/).filter(Boolean).map((text) => ({ text, font: s.font })));
  const w = (font: FontKey, t: string) => measure(font, size, t);
  const space = w("regular", " ");
  const lines: Piece[][] = [];
  let line: Piece[] = [];
  let used = 0;
  const add = (text: string, font: FontKey, joined: boolean) => {
    const t = joined ? ` ${text}` : text;
    const last = line[line.length - 1];
    if (last && last.font === font) last.text += t;
    else line.push({ text: t, font });
    used += (joined ? space : 0) + w(font, text);
  };
  const flush = () => {
    lines.push(line);
    line = [];
    used = 0;
  };
  for (const word of words) {
    let { text } = word;
    if (line.length && used + space + w(word.font, text) > width) flush();
    while (text.length > 1 && w(word.font, text) > width) {
      if (line.length) flush();
      let n = text.length - 1;
      while (n > 1 && w(word.font, text.slice(0, n)) > width) n--;
      add(text.slice(0, n), word.font, false);
      flush();
      text = text.slice(n);
    }
    add(text, word.font, line.length > 0);
  }
  if (line.length) flush();
  return lines.length ? lines : [[]];
}

/** Wraps text that may hold newlines: a paragraph's own line breaks stay, and a blank line stays blank. */
function wrapText(text: string, font: FontKey, width: number, size: number, measure: Measure): Piece[][] {
  return text.split("\n").flatMap((p) => (p.trim() ? wrapSegments([{ text: p.trim(), font }], width, size, measure) : [[]]));
}

/** The vertical cursor and the pages built so far. */
class Flow {
  readonly pages: PageLayout[] = [{ runs: [], rules: [] }];
  top: number;
  private gap = 0;
  constructor(readonly width: number, readonly height: number, readonly margin: number) {
    this.top = margin;
  }
  get bottom(): number { return this.height - this.margin; }
  get page(): PageLayout { return this.pages[this.pages.length - 1]; }
  get atTop(): boolean { return this.top === this.margin; }
  /** A margin before the next line; two in a row collapse to the larger, and none counts at the top of a page. */
  space(pt: number): void { this.gap = Math.max(this.gap, pt); }
  /** Starts a new page unless `h` more points fit below the pending margin. */
  ensure(h: number): void {
    if (!this.atTop && this.top + this.gap + h > this.bottom + 0.01) this.newPage();
  }
  newPage(): void {
    this.pages.push({ runs: [], rules: [] });
    this.top = this.margin;
    this.gap = 0;
  }
  /** Moves down past the pending margin (starting a page if the line does not fit) and returns the top of the line box that starts there. */
  begin(h: number): number {
    this.ensure(h);
    if (!this.atTop) this.top += this.gap;
    this.gap = 0;
    const t = this.top;
    this.top += h;
    return t;
  }
  /** The PDF y of a baseline for a line box of height `lh` whose top is `t`. Times has about 0.683 ascent and 0.217 descent. */
  baseline(t: number, lh: number, size: number): number {
    return this.height - (t + (lh - 0.9 * size) / 2 + 0.683 * size);
  }
  run(text: string, font: FontKey, size: number, x: number, t: number, lh: number): void {
    if (text) this.page.runs.push({ text, font, size, x, y: this.baseline(t, lh, size) });
  }
}

const upper = (s: string) => s.toLocaleUpperCase("en");

/** Draws wrapped lines at `x`, or centred in the content width. `keep` is the height the first line must have room for, with what follows it. */
function drawLines(f: Flow, lines: Piece[][], x: number, size: number, lh: number, measure: Measure, centre = false, keep = 0): number[] {
  return lines.map((pieces, idx) => {
    if (idx === 0 && keep) f.ensure(keep);
    const t = f.begin(lh);
    let cx = x;
    if (centre) {
      const total = pieces.reduce((s, p) => s + measure(p.font, size, p.text), 0);
      cx = f.margin + (f.width - 2 * f.margin - total) / 2;
    }
    for (const p of pieces) {
      f.run(p.text, p.font, size, cx, t, lh);
      cx += measure(p.font, size, p.text);
    }
    return t;
  });
}

const labelled = (label: string | undefined, text: string): Piece[] =>
  label ? [{ text: `${label}:`, font: "bold" }, { text, font: "regular" }] : [{ text, font: "regular" }];

/** An org, school or title row: bold or italic text, the right-hand value flush right on the first line. */
function row(f: Flow, item: DocItem, font: FontKey, size: number, lh: number, measure: Measure, keep: number): void {
  const cw = f.width - 2 * f.margin;
  const right = item.right ?? "";
  const rw = right ? measure(font, size, right) : 0;
  const left = Math.max(cw * 0.3, cw - (right ? rw + 12 : 0));
  const tops = drawLines(f, wrapText(item.text, font, left, size, measure), f.margin, size, lh, measure, false, keep);
  if (right) f.run(right, font, size, f.margin + cw - rw, tops[0], lh);
}

interface Bullet { label?: string; text: string }

function bullets(f: Flow, list: readonly Bullet[], size: number, lh: number, measure: Measure): void {
  const indent = 1.5 * size;
  const cw = f.width - 2 * f.margin - indent;
  f.space(1);
  for (const b of list) {
    const tops = drawLines(f, wrapSegments(labelled(b.label, b.text), cw, size, measure), f.margin + indent, size, lh, measure);
    f.run("•", "regular", size, f.margin + 0.35 * size, tops[0], lh);
    f.space(1);
  }
}

function sectionLines(f: Flow, items: readonly DocItem[], size: number, lh: number, measure: Measure): void {
  const cw = f.width - 2 * f.margin;
  // a section of several plain lines and nothing else (a resume from before kinds) is a plain bullet list
  const legacy = items.length > 1 && items.every((i) => !i.kind);
  let run: Bullet[] = [];
  /** Draws the bullets gathered so far; true if there were any. */
  const flush = (): boolean => {
    const any = run.length > 0;
    if (any) bullets(f, run, size, lh, measure);
    run = [];
    return any;
  };
  items.forEach((i, idx) => {
    if (legacy) {
      run.push({ text: i.text });
      return;
    }
    switch (i.kind) {
      case "bullet":
        run.push({ label: i.label || undefined, text: i.text });
        return;
      case "org":
        if (flush()) f.space(4);
        row(f, i, "bold", size, lh, measure, items[idx + 1]?.kind === "title" ? 2 * lh : 0);
        return;
      case "title":
        if (flush()) f.space(4);
        row(f, i, "italic", size, lh, measure, 0);
        return;
      case "school":
        flush();
        row(f, i, "bold", size, lh, measure, 0);
        return;
      case "skill":
        flush();
        drawLines(f, wrapSegments(labelled(i.label, i.text), cw, size, measure), f.margin, size, lh, measure);
        f.space(2);
        return;
      default:
        flush();
        drawLines(f, wrapText(i.text, "regular", cw, size, measure), f.margin, size, lh, measure);
        f.space(2);
    }
  });
  flush();
}

/**
 * The classic one-page resume as positioned runs. The name and contact lines come from the Header section (or `title` when there is none),
 * then each section under a ruled capital heading. A resume that runs past the page continues on the next. Never throws.
 */
export function layoutResume(sections: readonly DocSection[], measure: Measure, opts: { title?: string } = {}): Layout {
  const { margin, size, lineHeight } = RESUME_STYLE;
  const lh = size * lineHeight;
  const f = new Flow(LETTER.width, LETTER.height, margin);
  const cw = f.width - 2 * margin;
  const header = sections.find((s) => isHeaderHeading(s.heading) && s.items.length);
  const name = (header ? header.items[0].text : opts.title ?? "").trim();
  if (name) {
    const nameSize = size * 1.6;
    drawLines(f, wrapSegments([{ text: upper(name), font: "bold" }], cw, nameSize, measure), margin, nameSize, nameSize * 1.2, measure, true);
    f.space(2);
  }
  if (header) {
    for (const i of header.items.slice(1)) drawLines(f, wrapText(i.text, "regular", cw, size, measure), margin, size, lh, measure, true);
    f.space(8);
  }
  for (const s of sections) {
    if (s === header) continue;
    if (s.heading) {
      f.space(10);
      // the heading never ends a page: it needs its rule and the first line under it
      f.ensure(lh + 1.75 + 3 + lh);
      const t = f.begin(lh);
      f.run(upper(s.heading), "bold", size, margin, t, lh);
      f.top += 1;
      f.page.rules.push({ x1: margin, x2: margin + cw, y: f.height - f.top - 0.375, thickness: 0.75 });
      f.top += 0.75;
      f.space(3);
    }
    sectionLines(f, s.items, size, lh, measure);
    f.space(7);
  }
  return { width: f.width, height: f.height, pages: f.pages };
}

/** A cover letter: Times 11pt, one-inch margins, each line of the document a paragraph (its own line breaks kept), a blank line between. */
export function layoutLetter(sections: readonly DocSection[], measure: Measure): Layout {
  const { margin, size, lineHeight } = LETTER_STYLE;
  const lh = size * lineHeight;
  const f = new Flow(LETTER.width, LETTER.height, margin);
  const cw = f.width - 2 * margin;
  for (const s of sections) {
    if (s.heading) {
      drawLines(f, wrapText(s.heading, "bold", cw, size, measure), margin, size, lh, measure);
      f.space(size);
    }
    for (const i of s.items) {
      if (!i.text.trim()) continue;
      drawLines(f, wrapText(i.text, "regular", cw, size, measure), margin, size, lh, measure);
      f.space(size);
    }
  }
  return { width: f.width, height: f.height, pages: f.pages };
}
