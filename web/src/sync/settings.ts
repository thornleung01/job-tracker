// Appearance, columns, flow period and sync settings with defaults and sanitising (jobtracker/settings.py).
// The accent values (colours) live with the UI; only the names are kept here.
import type { JobTrackerDB } from "../db/schema";
import { getSetting, setSetting } from "../db/repo";

export const THEMES = ["system", "light", "dark"] as const;
export const DENSITIES = ["comfortable", "compact"] as const;
export const CORNERS = ["soft", "sharp"] as const;
export const ACCENTS = ["graphite", "bronze", "forest", "clay"] as const;
export const COLUMNS = {
  company: "Company",
  role: "Role",
  stage: "Stage",
  applied: "Applied",
  lastActivity: "Last activity",
  emails: "Emails",
  rounds: "Rounds",
} as const;
export type ColumnId = keyof typeof COLUMNS;
/** 0 means all time */
export const FLOW_PERIODS = [0, 30, 90, 180] as const;
export const LOOKBACKS = [30, 60, 90, 180, 365] as const;
/** Labelled periods for the Flow page and Settings. */
export const PERIODS: readonly { days: number; label: string }[] = [
  { days: 0, label: "All time" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: 180, label: "Last 180 days" },
];
/** What a sync reads: new mail only, or the last 30/90/180 days. */
export const SCAN_CHOICES: readonly { days: number; label: string }[] = [
  { days: 0, label: "New emails since last sync" },
  ...PERIODS.slice(1),
];

export type Theme = (typeof THEMES)[number];
export type Density = (typeof DENSITIES)[number];
export type Corners = (typeof CORNERS)[number];
export type Accent = (typeof ACCENTS)[number];

export interface AppearanceSettings {
  theme: Theme;
  accent: Accent;
  density: Density;
  corners: Corners;
  columns: ColumnId[];
  flowDays: number;
}
export interface SyncSettings {
  lookbackDays: number;
}
export interface Settings {
  appearance: AppearanceSettings;
  sync: SyncSettings;
}
export type Section = keyof Settings;

export const DEFAULTS: Settings = {
  appearance: {
    theme: "system",
    accent: "graphite",
    density: "comfortable",
    corners: "soft",
    columns: ["company", "role", "stage", "applied", "lastActivity"],
    flowDays: 0,
  },
  sync: { lookbackDays: 30 },
};

type Raw = Record<string, unknown>;

function choiceInt(value: unknown, allowed: readonly number[], fallback: number): number {
  let n: number;
  if (typeof value === "number") n = Number.isInteger(value) ? value : NaN;
  else if (typeof value === "string" && /^\s*[+-]?\d+\s*$/.test(value)) n = Number(value);
  else return fallback;
  return allowed.includes(n) ? n : fallback;
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function sanitizeAppearance(values: Raw): AppearanceSettings {
  const base = DEFAULTS.appearance;
  const wanted: unknown[] = Array.isArray(values.columns) ? values.columns : values.columns === undefined ? base.columns : [values.columns];
  const ids = Object.keys(COLUMNS) as ColumnId[];
  // Company and Stage are what the list is for, so they can't be hidden.
  const columns = ids.filter((c) => wanted.includes(c) || c === "company" || c === "stage");
  return {
    theme: oneOf(THEMES, values.theme, base.theme),
    accent: oneOf(ACCENTS, values.accent, base.accent),
    density: oneOf(DENSITIES, values.density, base.density),
    corners: oneOf(CORNERS, values.corners, base.corners),
    columns,
    flowDays: choiceInt(values.flowDays, FLOW_PERIODS, base.flowDays),
  };
}

export function sanitizeSync(values: Raw): SyncSettings {
  return { lookbackDays: choiceInt(values.lookbackDays, LOOKBACKS, DEFAULTS.sync.lookbackDays) };
}

export function sanitize(section: "appearance", values: Raw): AppearanceSettings;
export function sanitize(section: "sync", values: Raw): SyncSettings;
export function sanitize(section: Section, values: Raw): AppearanceSettings | SyncSettings {
  if (section === "appearance") return sanitizeAppearance(values);
  if (section === "sync") return sanitizeSync(values);
  throw new Error(`Unknown settings section: ${String(section)}`);
}

function asRecord(value: unknown): Raw {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {};
}

export async function loadSettings(db: JobTrackerDB): Promise<Settings> {
  const [appearance, sync] = await Promise.all([getSetting(db, "appearance"), getSetting(db, "sync")]);
  return {
    appearance: sanitizeAppearance({ ...DEFAULTS.appearance, ...asRecord(appearance) }),
    sync: sanitizeSync({ ...DEFAULTS.sync, ...asRecord(sync) }),
  };
}

export async function saveSettings(db: JobTrackerDB, section: "appearance", values: Raw): Promise<AppearanceSettings>;
export async function saveSettings(db: JobTrackerDB, section: "sync", values: Raw): Promise<SyncSettings>;
export async function saveSettings(db: JobTrackerDB, section: Section, values: Raw): Promise<AppearanceSettings | SyncSettings> {
  const clean = section === "appearance" ? sanitizeAppearance(values) : sanitizeSync(values);
  await setSetting(db, section, clean);
  return clean;
}
