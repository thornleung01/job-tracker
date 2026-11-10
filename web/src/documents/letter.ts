// The cover letter as text: its paragraphs as the lines of one document section, the greeting that starts a new one, and the
// text that is copied or put in a mail.
import { newItemId } from "../db/documentShape";
import type { DocSection } from "../db/schema";
import type { Contact } from "../sync/contacts";
import { firstName } from "../sync/followUpDraft";

const GREETED = new Set(["recruiter", "hiring", "people"]);

/** "Dear Jane," for the newest person known to be a recruiter or on the hiring side, otherwise "Dear hiring team,". */
export function greeting(people: readonly Pick<Contact, "name" | "kind" | "mentionedOnly">[]): string {
  for (const p of people) {
    const name = GREETED.has(p.kind) && !p.mentionedOnly ? firstName(p.name) : "";
    if (name) return `Dear ${name},`;
  }
  return "Dear hiring team,";
}

/** The paragraphs of a letter, a blank line between each, for the text box and for copying. */
export function letterText(sections: readonly DocSection[]): string {
  return sections.flatMap((s) => [s.heading, ...s.items.map((i) => i.text)]).filter(Boolean).join("\n\n");
}

/** The letter's sections from the text box: each line is a paragraph, blank lines are dropped. */
export function letterSections(text: string, keep: readonly DocSection[] = []): DocSection[] {
  const old = keep[0];
  const items = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((t, i) => ({ id: old?.items[i]?.id ?? newItemId(), text: t }));
  return [{ id: old?.id ?? newItemId(), heading: "", items }];
}
