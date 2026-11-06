// The shape of a document's text: sections and lines, with a stable id on each. Saving, importing and reading an uploaded file all
// pass through here, so a document that one path accepts is one the others accept too.
import { isDocItemKind, type DocItem, type DocSection } from "./schema";
import { MAX_DOC_HEADING_CHARS, MAX_DOC_ITEM_CHARS, MAX_DOC_ITEMS, MAX_DOC_LABEL_CHARS, MAX_DOC_RIGHT_CHARS, MAX_DOC_SECTIONS } from "./limits";

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
    const items = (Array.isArray(rec.items) ? rec.items : []).slice(0, MAX_DOC_ITEMS).flatMap((i): DocItem[] => {
      if (typeof i !== "object" || i === null) return [];
      const item = i as Record<string, unknown>;
      const text = clean(item.text, MAX_DOC_ITEM_CHARS);
      const label = clean(item.label, MAX_DOC_LABEL_CHARS);
      const right = clean(item.right, MAX_DOC_RIGHT_CHARS);
      // A line is kept when it has any of the three: a job line may be only a location, a bullet only a label.
      if (!text && !label && !right) return [];
      return [{
        id: unique(item.id), text, ...(isDocItemKind(item.kind) ? { kind: item.kind } : {}), ...(label ? { label } : {}), ...(right ? { right } : {}),
      }];
    });
    if (!heading && !items.length) continue;
    sections.push({ id: unique(rec.id), heading, items });
  }
  return sections;
}

/** One line as plain text: a bullet or skill as "Label: text", a job or school with its location, a title with its dates. */
export function itemText(item: DocItem): string {
  const body = item.label ? `${item.label}${item.text ? `: ${item.text}` : ""}` : item.text;
  if (!item.right) return body;
  return body ? `${body}${item.kind === "title" ? " " : ", "}${item.right}` : item.right;
}

/** The document as plain text: each heading on its own line, then its lines, a blank line between sections. */
export function sectionsToText(sections: readonly DocSection[]): string {
  return sections
    .map((s) => [s.heading, ...s.items.map(itemText)].filter(Boolean).join("\n"))
    .join("\n\n");
}

/** The heading of the section that holds a resume's name and contact line. The importer writes it and the print view looks for it. */
export const HEADER_HEADING = "Header";
export const isHeaderHeading = (heading: string): boolean => heading.trim().toLowerCase() === HEADER_HEADING.toLowerCase();
