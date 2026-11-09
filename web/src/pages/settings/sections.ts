// The four sections of Settings, shown one at a time at #/settings/:section. `#/settings` is the first one.
export const SECTIONS = [
  { id: "mail", label: "Mail" },
  { id: "appearance", label: "Appearance" },
  { id: "ai", label: "AI" },
  { id: "data", label: "Data" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

/** The section a route asks for; a missing or unknown name is Mail. */
export function sectionFor(name: string | undefined): SectionId {
  return SECTIONS.find((s) => s.id === name)?.id ?? "mail";
}

export const sectionPath = (id: SectionId) => (id === "mail" ? "/settings" : `/settings/${id}`);
