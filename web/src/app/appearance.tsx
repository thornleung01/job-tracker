import { useEffect } from "react";
import type { JobTrackerDB } from "../db/schema";
import { DEFAULTS, loadSettings, sanitizeAppearance, type AppearanceSettings } from "../sync/settings";
import { ACCENT_COLORS } from "./accents";
import { useQuery } from "./useQuery";

/** Writes the look onto <html>, the same attributes the local edition's base.html sets. "system" omits data-theme. */
export function applyAppearance(root: HTMLElement, a: Pick<AppearanceSettings, "theme" | "density" | "corners" | "accent">): void {
  if (a.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", a.theme);
  root.setAttribute("data-density", a.density);
  root.setAttribute("data-corners", a.corners);
  root.setAttribute("data-accent", a.accent);
  const colors = ACCENT_COLORS[a.accent];
  root.style.setProperty("--accent-l", colors.light);
  root.style.setProperty("--accent-d", colors.dark);
}

// The look is saved in the user's database, which opens after the first paint. A copy of the four choices is kept
// per database name so the look can be applied before the database is open and a dark theme doesn't flash light.
// It holds no personal data, and the database stays the source of truth: AppearanceSync corrects it.
const hintKey = (dbName: string) => `jobtracker:look:${dbName}`;

/** The look last saved for this database, or null when there is none (or storage is unavailable). */
export function readLookHint(dbName: string): AppearanceSettings | null {
  try {
    const raw = localStorage.getItem(hintKey(dbName));
    return raw ? sanitizeAppearance(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeLookHint(dbName: string, a: AppearanceSettings): void {
  try {
    localStorage.setItem(hintKey(dbName), JSON.stringify({ theme: a.theme, density: a.density, corners: a.corners, accent: a.accent }));
  } catch {
    // storage is full or blocked: the next visit just paints the default look first
  }
}

/** Keeps <html> in step with the saved settings of this user's database. Renders nothing. */
export function AppearanceSync({ db }: { db: JobTrackerDB }) {
  const settings = useQuery(() => loadSettings(db), [db]);
  const a = settings?.appearance;
  useEffect(() => {
    if (!a) return;
    applyAppearance(document.documentElement, a);
    writeLookHint(db.name, a);
  }, [a?.theme, a?.density, a?.corners, a?.accent]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** The defaults, for the sign-in screen and after sign-out so one person's look never carries over to the next. */
export function applyDefaultAppearance(): void {
  applyAppearance(document.documentElement, DEFAULTS.appearance);
}
