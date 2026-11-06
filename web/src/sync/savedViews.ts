// Saved views: a named set of the Applications page's filters and sort, kept per account database in the settings table
// (key "savedViews"), so Export and Import carry them. A view is only ever turned into an address (the hash query), never run.
import { ActionError } from "../db/errors";
import { isRecord } from "../db/isRecord";
import { SAVED_VIEWS_MAX, SAVED_VIEW_NAME_MAX, SEARCH_MAX_CHARS } from "../db/limits";
import { getSetting } from "../db/repo";
import { tx, type JobTrackerDB } from "../db/schema";
import { STAGES } from "../db/stages";
import { SORT_COLUMNS } from "./queries";
import { COLUMNS, type ColumnId } from "./settings";
import { hasUnsafeChars } from "./safeText";
import { foldText } from "./search";
import { cpLength, squeeze } from "./text";

export const SAVED_VIEWS_KEY = "savedViews";

/** What a view keeps: the filters and the sort, in the same words as the address (see listUrl on the page). */
export interface ViewFilters {
  stage: string;
  q: string;
  account: number;
  followUp: boolean;
  ghosted: boolean;
  /** a resume version's id as text, "none" for no resume set, or "" or missing for any (views saved before resumes have no value) */
  resume?: string;
  sort: string;
  dir: string;
}
export interface SavedView extends ViewFilters {
  id: number;
  name: string;
}

const NAME_EMPTY = "Give the view a name.";
const nameTooLong = `Keep the name to ${SAVED_VIEW_NAME_MAX} characters or fewer.`;

/** The name, tidied. Throws ActionError for one that is empty, too long or has characters that can't be shown. */
export function cleanViewName(raw: string): string {
  const name = squeeze(raw);
  if (!name) throw new ActionError(NAME_EMPTY);
  if (hasUnsafeChars(name)) throw new ActionError("The name has characters that can't be saved. Use plain text.");
  if (cpLength(name) > SAVED_VIEW_NAME_MAX) throw new ActionError(nameTooLong);
  return name;
}

/** The filters as they may be stored: anything that isn't a known value becomes empty. */
export function cleanFilters(raw: unknown): ViewFilters {
  const r = isRecord(raw) ? raw : {};
  const sort = typeof r.sort === "string" && (SORT_COLUMNS as readonly string[]).includes(r.sort) ? r.sort : "";
  return {
    stage: typeof r.stage === "string" && (STAGES as readonly string[]).includes(r.stage) ? r.stage : "",
    q: typeof r.q === "string" ? squeeze(r.q).slice(0, SEARCH_MAX_CHARS) : "",
    account: typeof r.account === "number" && Number.isInteger(r.account) && r.account > 0 ? r.account : 0,
    followUp: r.followUp === true,
    ghosted: r.ghosted === true,
    resume: cleanResume(r.resume),
    sort,
    dir: sort && (r.dir === "asc" || r.dir === "desc") ? r.dir : "",
  };
}

/** "none", or a resume id written as a whole number above 0; anything else is no filter. */
const cleanResume = (raw: unknown): string =>
  raw === "none" ? "none" : typeof raw === "string" && /^[1-9]\d{0,15}$/.test(raw) ? raw : typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? String(raw) : "";

const isEmpty = (f: ViewFilters) => !f.stage && !f.q && !f.account && !f.followUp && !f.ghosted && !f.resume && !f.sort;

/** The stored list, checked: bad entries, repeated ids and anything past SAVED_VIEWS_MAX are dropped. Used when reading and when importing. */
export function sanitizeSavedViews(raw: unknown): SavedView[] {
  const list = isRecord(raw) && Array.isArray(raw.views) ? raw.views : Array.isArray(raw) ? raw : [];
  const out: SavedView[] = [];
  const ids = new Set<number>();
  for (const item of list) {
    if (out.length >= SAVED_VIEWS_MAX) break;
    if (!isRecord(item) || typeof item.id !== "number" || !Number.isInteger(item.id) || item.id < 1 || ids.has(item.id)) continue;
    let name: string;
    try {
      name = cleanViewName(typeof item.name === "string" ? item.name : "");
    } catch {
      continue;
    }
    ids.add(item.id);
    out.push({ id: item.id, name, ...cleanFilters(item) });
  }
  return out;
}

export async function loadSavedViews(db: JobTrackerDB): Promise<SavedView[]> {
  return sanitizeSavedViews(await getSetting(db, SAVED_VIEWS_KEY));
}

const write = (db: JobTrackerDB, views: SavedView[]) => db.settings.put({ key: SAVED_VIEWS_KEY, value: { views } });
const sameName = (a: string, b: string) => foldText(a) === foldText(b);

/** Saves the current filters under a name. Throws ActionError when the name is bad or taken, there is nothing to save, or 12 views are kept already. */
export async function saveView(db: JobTrackerDB, rawName: string, filters: ViewFilters): Promise<SavedView> {
  const name = cleanViewName(rawName);
  const f = cleanFilters(filters);
  if (isEmpty(f)) throw new ActionError("Choose a stage, search or other filter first, so there is something to save.");
  return tx(db, async () => {
    const views = await loadSavedViews(db);
    if (views.length >= SAVED_VIEWS_MAX) throw new ActionError(`You can keep ${SAVED_VIEWS_MAX} saved views. Delete one to save another.`);
    if (views.some((v) => sameName(v.name, name))) throw new ActionError("You already have a view with that name.");
    const view: SavedView = { id: Math.max(0, ...views.map((v) => v.id)) + 1, name, ...f };
    await write(db, [...views, view]);
    return view;
  });
}

/** Renames a view. Throws ActionError for a bad or taken name; a view that is gone (deleted in another tab) is a plain message. */
export async function renameView(db: JobTrackerDB, id: number, rawName: string): Promise<void> {
  const name = cleanViewName(rawName);
  await tx(db, async () => {
    const views = await loadSavedViews(db);
    if (!views.some((v) => v.id === id)) throw new ActionError("That view is gone.");
    if (views.some((v) => v.id !== id && sameName(v.name, name))) throw new ActionError("You already have a view with that name.");
    await write(db, views.map((v) => (v.id === id ? { ...v, name } : v)));
  });
}

export async function deleteView(db: JobTrackerDB, id: number): Promise<void> {
  await tx(db, async () => {
    const views = await loadSavedViews(db);
    if (views.some((v) => v.id === id)) await write(db, views.filter((v) => v.id !== id));
  });
}

/** "Stage: Interview, Search: acme, Needs follow-up": what a view keeps, for the save form and a chip's tooltip. */
export function describeFilters(f: ViewFilters, accountName?: string, resumeName?: string): string {
  const parts: string[] = [];
  if (f.stage) parts.push(`Stage: ${f.stage}`);
  if (f.q) parts.push(`Search: ${f.q}`);
  if (f.account) parts.push(`Account: ${accountName ?? f.account}`);
  if (f.followUp) parts.push("Needs follow-up");
  if (f.ghosted) parts.push("No reply");
  if (f.resume) parts.push(`Resume: ${f.resume === "none" ? "none set" : resumeName ?? "(deleted)"}`);
  if (f.sort) parts.push(`Sorted by ${COLUMNS[f.sort as ColumnId].toLowerCase()}`);
  return parts.join(", ");
}
