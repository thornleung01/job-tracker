// Compares a tailored resume with its baseline (the master or a version) line by line, and moves single lines back toward the baseline.
// Lines are matched by item id: a tailored copy keeps the ids of the lines it came from, and ids only need to be unique inside one document.
// Pure: no React and no database.
import type { DocItem, DocSection } from "../db/schema";

/** A word from a line, `changed` when the other line doesn't have it in that place. */
export interface WordPart {
  text: string;
  changed: boolean;
}

const words = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/** The words of `before` and of `after`, each marked where the two differ (the longest run of words they share is left unmarked). */
export function diffWords(before: string, after: string): { before: WordPart[]; after: WordPart[] } {
  const a = words(before);
  const b = words(after);
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const left: WordPart[] = [];
  const right: WordPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      left.push({ text: a[i++], changed: false });
      right.push({ text: b[j++], changed: false });
    } else if (j >= b.length || (i < a.length && table[i + 1][j] >= table[i][j + 1])) left.push({ text: a[i++], changed: true });
    else right.push({ text: b[j++], changed: true });
  }
  return { before: left, after: right };
}

export type LineStatus = "same" | "changed" | "new";

export interface LineCompare {
  status: LineStatus;
  /** the baseline's text for a changed line */
  baselineText?: string;
  /** the word diff of a changed line: `before` is the baseline's words, `after` the tailored line's */
  diff?: { before: WordPart[]; after: WordPart[] };
}

/** A baseline line the tailored copy doesn't have. `heading` is the baseline section it sat in. */
export interface LeftOutLine {
  id: string;
  sectionId: string;
  heading: string;
  item: DocItem;
}

/**
 * `lines` is keyed by the tailored item's id. A section heading that differs from its baseline section is keyed by the section's id
 * (status "changed", or "new" for a section the baseline doesn't have). `leftOut` is the baseline's lines the copy no longer holds, in baseline order.
 */
export interface BaselineCompare {
  lines: Record<string, LineCompare>;
  leftOut: LeftOutLine[];
}

/** The line as one string for the word diff: label, text, then the right-hand value. */
const textOf = (item: Pick<DocItem, "label" | "text" | "right">): string =>
  [item.label ? `${item.label}${item.text ? ":" : ""}` : "", item.text, item.right ?? ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

const sameLine = (a: DocItem, b: DocItem): boolean =>
  (a.kind ?? "") === (b.kind ?? "") && (a.label ?? "") === (b.label ?? "") && a.text === b.text && (a.right ?? "") === (b.right ?? "");

export function compareToBaseline(tailored: readonly DocSection[], baseline: readonly DocSection[]): BaselineCompare {
  const home = new Map<string, DocItem>();
  for (const section of baseline) for (const item of section.items) home.set(item.id, item);
  const baseSections = new Map(baseline.map((s) => [s.id, s]));
  const lines: Record<string, LineCompare> = {};
  const kept = new Set<string>();
  for (const section of tailored) {
    const base = baseSections.get(section.id);
    // a heading cleared to "" against a baseline heading is a change; a blank heading with no baseline section is nothing to mark
    if (base ? base.heading !== section.heading : section.heading) {
      lines[section.id] = base
        ? { status: "changed", baselineText: base.heading, diff: diffWords(base.heading, section.heading) }
        : { status: "new" };
    }
    for (const item of section.items) {
      const from = home.get(item.id);
      if (!from) {
        lines[item.id] = { status: "new" };
        continue;
      }
      kept.add(item.id);
      if (sameLine(item, from)) lines[item.id] = { status: "same" };
      else {
        const before = textOf(from);
        lines[item.id] = { status: "changed", baselineText: before, diff: diffWords(before, textOf(item)) };
      }
    }
  }
  const leftOut = baseline.flatMap((s) =>
    s.items.filter((i) => !kept.has(i.id)).map((item): LeftOutLine => ({ id: item.id, sectionId: s.id, heading: s.heading, item: { ...item } })));
  return { lines, leftOut };
}

const sameHeading = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Puts a baseline line back into the tailored copy: after the nearest line before it in the baseline that the copy still has, otherwise
 * at the start of the copy's matching section (same id, else same heading), otherwise in a new section with the baseline's heading.
 * Returns the sections unchanged when the copy already has the line or the baseline doesn't.
 */
export function addBackLine(tailored: readonly DocSection[], baseline: readonly DocSection[], id: string): DocSection[] {
  const sections = tailored.map((s) => ({ ...s, items: s.items.slice() }));
  if (sections.some((s) => s.items.some((i) => i.id === id))) return sections;
  const at = baseline.findIndex((s) => s.items.some((i) => i.id === id));
  if (at < 0) return sections;
  const section = baseline[at];
  const position = section.items.findIndex((i) => i.id === id);
  const item: DocItem = { ...section.items[position] };

  for (let k = position - 1; k >= 0; k--) {
    const before = section.items[k].id;
    const target = sections.find((s) => s.items.some((i) => i.id === before));
    if (!target) continue;
    target.items.splice(target.items.findIndex((i) => i.id === before) + 1, 0, item);
    return sections;
  }
  const match = sections.find((s) => s.id === section.id) ?? sections.find((s) => sameHeading(s.heading, section.heading));
  if (match) {
    match.items.unshift(item);
    return sections;
  }
  // a new section goes after the nearest earlier baseline section the copy has, else first
  let index = 0;
  for (let k = at - 1; k >= 0; k--) {
    const prior = sections.findIndex((s) => s.id === baseline[k].id || sameHeading(s.heading, baseline[k].heading));
    if (prior >= 0) {
      index = prior + 1;
      break;
    }
  }
  sections.splice(index, 0, { id: section.id, heading: section.heading, items: [item] });
  return sections;
}

/** Sets a line of the tailored copy back to the baseline's text, label, right-hand value and kind. Unchanged when either side doesn't have it. */
export function resetLine(tailored: readonly DocSection[], baseline: readonly DocSection[], id: string): DocSection[] {
  const base = baseline.flatMap((s) => s.items).find((i) => i.id === id);
  return tailored.map((s) => ({ ...s, items: s.items.map((i) => (i.id === id && base ? { ...base } : i)) }));
}
