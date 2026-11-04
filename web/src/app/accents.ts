// Accent colours as light/dark pairs (the same values as jobtracker/settings.py and DESIGN.md).
// sync/settings.ts only knows the names; these are written to <html> as --accent-l and --accent-d.
import type { Accent } from "../sync/settings";

export const ACCENT_COLORS: Record<Accent, { light: string; dark: string }> = {
  graphite: { light: "#000000", dark: "#ffffff" },
  bronze: { light: "#5c4b24", dark: "#d9c28a" },
  forest: { light: "#2f5d46", dark: "#8cc7a6" },
  clay: { light: "#8f4a32", dark: "#e0a184" },
};
