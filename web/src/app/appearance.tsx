import { useEffect } from "react";
import type { JobTrackerDB } from "../db/schema";
import { DEFAULTS, loadSettings, type AppearanceSettings } from "../sync/settings";
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

/** Keeps <html> in step with the saved settings of this user's database. Renders nothing. */
export function AppearanceSync({ db }: { db: JobTrackerDB }) {
  const settings = useQuery(() => loadSettings(db), [db]);
  const a = settings?.appearance;
  useEffect(() => {
    if (a) applyAppearance(document.documentElement, a);
  }, [a?.theme, a?.density, a?.corners, a?.accent]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** The defaults, for the sign-in screen and after sign-out so one person's look never carries over to the next. */
export function applyDefaultAppearance(): void {
  applyAppearance(document.documentElement, DEFAULTS.appearance);
}
