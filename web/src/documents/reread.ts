// Reading an old resume again: one saved before lines had types, as plain text, so the importer can rebuild the jobs, titles, bullets and schools.
import { HEADER_HEADING, isHeaderHeading, itemText, newItemId } from "../db/documentShape";
import type { DocSection } from "../db/schema";
import { templateSectionOf } from "./blankResume";
import { readPastedSections } from "./read";

const words = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const flat = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * The sections as text the importer understands: a heading in capitals on its own line, then one line per row. A summary becomes one
 * paragraph. A line in `bullets` gets a bullet glyph, which is how the importer is told it is a bullet (it keeps a plain line plain).
 */
function asImportText(sections: readonly DocSection[], bullets: ReadonlySet<string>): string {
  return sections
    .map((s) => {
      const lines = s.items.map(itemText).filter(Boolean);
      if (isHeaderHeading(s.heading)) return lines.join("\n");
      const body = templateSectionOf(s.heading) === "summary" ? [lines.join(" ")] : lines.map((l) => (bullets.has(flat(l)) ? `• ${l}` : l));
      return [s.heading.toLocaleUpperCase(), ...body].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

const readText = (text: string): DocSection[] | null => {
  try {
    return readPastedSections(text);
  } catch {
    return null;
  }
};

/**
 * The plain lines the first reading left in a section that has job titles, after a job or title line: the bullets of a job. A section
 * with no title (Education, Skills) has none, so a degree is never taken for a bullet.
 */
function bulletsOf(read: readonly DocSection[]): Set<string> {
  const out = new Set<string>();
  for (const s of read) {
    if (!s.items.some((i) => i.kind === "title")) continue;
    let inJob = false;
    for (const i of s.items) {
      if (i.kind === "org" || i.kind === "title") inJob = true;
      else if (!i.kind && inJob) out.add(flat(i.text));
    }
  }
  return out;
}

/**
 * A resume saved before typed lines, read again with the importer. Returns the new sections, or null when the sections already have a typed
 * line, when there is nothing to read, or when the reading found no typed line (it is then no better than what is saved). It also returns
 * null if the result holds a word the saved resume did not have: the output is only ever made from the input's words.
 * The importer is run twice: the second time the plain lines under a job title are given a bullet glyph so they come back as bullets.
 */
export function rereadAsTemplate(sections: DocSection[]): DocSection[] | null {
  if (sections.some((s) => s.items.some((i) => i.kind))) return null;
  const first = readText(asImportText(sections, new Set()));
  if (!first || !first.some((s) => s.items.some((i) => i.kind))) return null;
  const read = readText(asImportText(sections, bulletsOf(first))) ?? first;
  // The reader saw the headings in capitals: each gets its original spelling back.
  const spelled = new Map(sections.map((s) => [s.heading.trim().toLowerCase(), s.heading.trim()]));
  const out = read.map((s) => ({ ...s, id: newItemId(), heading: s.heading === HEADER_HEADING ? s.heading : spelled.get(s.heading.toLowerCase()) ?? s.heading }));
  const had = new Set(sections.flatMap((s) => [...words(s.heading), ...s.items.flatMap((i) => words(itemText(i)))]));
  const invented = out.some((s) => [s.heading, ...s.items.map(itemText)].some((t) => words(t).some((w) => w !== "header" && !had.has(w))));
  return invented ? null : out;
}
