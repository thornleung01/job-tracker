// The blank resume template, and the scaffolding the edit screens add around a saved resume. Pure: nothing here reads or writes the database.
import { HEADER_HEADING, isHeaderHeading, newItemId, normalizeSections } from "../db/documentShape";
import type { DocItem, DocItemKind, DocSection } from "../db/schema";

/** The headings of the template, in order. */
export const TEMPLATE_HEADINGS = {
  summary: "Professional summary",
  skills: "Skills and qualifications",
  experience: "Work experience",
  education: "Education",
} as const;

type TemplateKey = keyof typeof TEMPLATE_HEADINGS;

/**
 * What the editor shows in an empty field. These are the field's native placeholder: they are never saved, never printed and never
 * counted as text, and every field also has an accessible name of its own.
 */
export const PLACEHOLDERS = {
  name: "Your name",
  contact: "City, Province | Phone | LinkedIn | Email",
  summary: "Two or three sentences about what you do",
  skill: { label: "Category", text: "Tools and skills, separated by commas" },
  org: { text: "Company", right: "City, Province" },
  title: { text: "Job title", right: "Start – End" },
  bullet: { label: "What it was", text: "What you did and what changed, with a number if you have one" },
  school: { text: "School", right: "City, Province" },
  degree: "Degree",
} as const;

export type ItemField = "text" | "label" | "right";

const lower = (s: string) => s.trim().toLowerCase();

/** Which template section a heading is, by the words a resume uses for it ("Summary", "Profile", "Experience", "Employment history"), or null. */
export function templateSectionOf(heading: string): TemplateKey | null {
  const h = lower(heading);
  if (/\b(summary|objective|profile)\b/.test(h)) return "summary";
  if (/\b(skills?|qualifications)\b/.test(h)) return "skills";
  if (/\b(experience|employment)\b/.test(h)) return "experience";
  if (/\beducation\b/.test(h)) return "education";
  return null;
}

/**
 * The placeholder for one field of one line, or "" when the field has none. A typed line is looked up by its kind and field. A plain line
 * is looked up by its section: the first two lines of the header are the name and the contact line, a summary line is a summary, and any
 * other plain line in Education is a degree.
 */
export function placeholderFor(heading: string, kind: DocItemKind | undefined, field: ItemField, index = 0): string {
  if (kind) return (PLACEHOLDERS[kind] as { text: string; label?: string; right?: string })[field] ?? "";
  if (field !== "text") return "";
  if (isHeaderHeading(heading)) return index === 0 ? PLACEHOLDERS.name : index === 1 ? PLACEHOLDERS.contact : "";
  const section = templateSectionOf(heading);
  if (section === "summary") return PLACEHOLDERS.summary;
  if (section === "education") return PLACEHOLDERS.degree;
  return "";
}

const emptyLine = (kind?: DocItemKind): DocItem => ({ id: newItemId(), text: "", ...(kind ? { kind } : {}) });
const emptySection = (heading: string, kinds: (DocItemKind | undefined)[]): DocSection => ({ id: newItemId(), heading, items: kinds.map(emptyLine) });

const headerSection = () => emptySection(HEADER_HEADING, [undefined, undefined]);
const TEMPLATE: { key: TemplateKey; make: () => DocSection }[] = [
  { key: "summary", make: () => emptySection(TEMPLATE_HEADINGS.summary, [undefined]) },
  { key: "skills", make: () => emptySection(TEMPLATE_HEADINGS.skills, ["skill"]) },
  { key: "experience", make: () => emptySection(TEMPLATE_HEADINGS.experience, ["org", "title", "bullet"]) },
  { key: "education", make: () => emptySection(TEMPLATE_HEADINGS.education, ["school", undefined]) },
];

/** A blank copy of the template, with new ids on every call and every field empty. */
export function blankResume(): DocSection[] {
  return [headerSection(), ...TEMPLATE.map((t) => t.make())];
}

/**
 * For edit screens only: the sections with whatever the template has and they lack added back, so every field is there to click. The
 * header goes first. A missing section goes after the nearest earlier template section that is present. A section counts as present when
 * its heading is that of the template or a usual alternative ("Summary", "Skills", "Experience"), whatever its case. The sections you
 * have are never changed or reordered, and nothing is duplicated. The added lines are empty, so saving drops them again.
 */
export function withScaffold(sections: readonly DocSection[]): DocSection[] {
  const out = [...sections];
  if (!out.some((s) => isHeaderHeading(s.heading))) out.unshift(headerSection());
  /** 0 for the header, 1 to 4 for the template sections, null for any other section. */
  const order = (s: DocSection): number | null => {
    if (isHeaderHeading(s.heading)) return 0;
    const key = templateSectionOf(s.heading);
    return key ? TEMPLATE.findIndex((t) => t.key === key) + 1 : null;
  };
  TEMPLATE.forEach((t, n) => {
    if (out.some((s) => order(s) === n + 1)) return;
    let at = 0;
    out.forEach((s, i) => {
      const o = order(s);
      if (o !== null && o <= n) at = i + 1;
    });
    out.splice(at, 0, t.make());
  });
  return out;
}

/**
 * For saving from an edit screen: the sections of `normalizeSections` without the ones that have no lines left. normalizeSections drops
 * empty lines but keeps a section that has a heading, so an untouched template section would otherwise be saved as a lone heading.
 */
export const withoutEmptySections = (sections: readonly DocSection[]): DocSection[] => sections.filter((s) => s.items.length > 0);

/** What every edit screen stores: normalised, with no section left without lines. */
export const cleanForSave = (sections: readonly DocSection[]): DocSection[] => withoutEmptySections(normalizeSections(sections));

/** True when nothing has any text, so there is nothing to save. */
export function isBlankTemplate(sections: readonly DocSection[]): boolean {
  return sections.every((s) => s.items.every((i) => !(i.text.trim() || i.label?.trim() || i.right?.trim())));
}
