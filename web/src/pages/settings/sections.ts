// The five sections of Settings, shown one at a time at #/settings/:section, in the order things depend on each other.
// `#/settings` and `#/settings/setup` are the first one, Setup.
export const SECTIONS = [
  { id: "setup", label: "Setup" },
  { id: "mail", label: "Mail" },
  { id: "ai", label: "AI" },
  { id: "data", label: "Data" },
  { id: "appearance", label: "Appearance" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

/** The section a route asks for; a missing or unknown name is Setup. */
export function sectionFor(name: string | undefined): SectionId {
  return SECTIONS.find((s) => s.id === name)?.id ?? "setup";
}

export const sectionPath = (id: SectionId) => (id === "setup" ? "/settings" : `/settings/${id}`);
