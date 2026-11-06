// The shape of a document's text: sections and lines, with a stable id on each. Saving, importing and reading an uploaded file all
// pass through here, so a document that one path accepts is one the others accept too.
import type { DocSection } from "./schema";
import { MAX_DOC_HEADING_CHARS, MAX_DOC_ITEM_CHARS, MAX_DOC_ITEMS, MAX_DOC_SECTIONS } from "./limits";

let counter = 0;
/** A short id that is unique within this document: enough to tie a line to its source, not meant to be secret. */
export function newItemId(): string {
  counter = (counter + 1) % 1_000_000;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const clean = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim().slice(0, max) : "");

/**
 * Turns anything into valid sections. Text is trimmed and cut to the limits, empty lines and sections without a heading or lines
 * are dropped, and a missing or repeated id is replaced, so ids are unique across the whole document. Never throws.
 */
export function normalizeSections(raw: unknown): DocSection[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const unique = (id: unknown): string => {
    let out = typeof id === "string" && id && id.length <= 64 && !seen.has(id) ? id : newItemId();
    while (seen.has(out)) out = newItemId();
    seen.add(out);
    return out;
  };
  const sections: DocSection[] = [];
  for (const s of raw.slice(0, MAX_DOC_SECTIONS)) {
    if (typeof s !== "object" || s === null) continue;
    const rec = s as Record<string, unknown>;
    const heading = clean(rec.heading, MAX_DOC_HEADING_CHARS);
    const items = (Array.isArray(rec.items) ? rec.items : [])
      .slice(0, MAX_DOC_ITEMS)
      .flatMap((i) => {
        const text = clean(typeof i === "object" && i !== null ? (i as Record<string, unknown>).text : "", MAX_DOC_ITEM_CHARS);
        return text ? [{ id: unique(typeof i === "object" && i !== null ? (i as Record<string, unknown>).id : undefined), text }] : [];
      });
    if (!heading && !items.length) continue;
    sections.push({ id: unique(rec.id), heading, items });
  }
  return sections;
}

/** The document as plain text: each heading on its own line, then its lines, a blank line between sections. */
export function sectionsToText(sections: readonly DocSection[]): string {
  return sections
    .map((s) => [s.heading, ...s.items.map((i) => i.text)].filter(Boolean).join("\n"))
    .join("\n\n");
}
