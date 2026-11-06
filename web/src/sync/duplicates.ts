// Is the application you are adding one you already have? Used by the Add application form to say so. It never blocks a save.
import { MAX_COMPANY_CHARS, MAX_ROLE_CHARS } from "../db/limits";
import { parsePostingUrl } from "../db/postingUrl";
import type { JobTrackerDB } from "../db/schema";
import type { Stage } from "../db/stages";
import { isLive } from "./live";
import { pipeline } from "./pipeline";
import { squeeze } from "./text";

export interface DuplicateMatch {
  id: number;
  company: string;
  role: string;
  stage: Stage;
}

/** The most matches shown. */
export const DUPLICATES_MAX = 3;

/**
 * Applications that look like the one being typed, at most DUPLICATES_MAX:
 * - the same posting link (compared the way a link is saved), then
 * - the same company and the same role, both compared by the pipeline's own keys, so "Acme Inc." and "acme" match, or
 * - the same company, when no role has been typed.
 * Newest first within each. A link that is not a web address matches nothing.
 */
export async function findDuplicates(db: JobTrackerDB, company: string, role: string, url = ""): Promise<DuplicateMatch[]> {
  const p = pipeline();
  const ckey = p.companyKey(squeeze(company).slice(0, MAX_COMPANY_CHARS));
  const rkey = p.roleKey(squeeze(role).slice(0, MAX_ROLE_CHARS));
  const link = parsePostingUrl(url) ?? "";
  if (!ckey && !link) return [];

  const found = new Map<number, DuplicateMatch>();
  const keep = (a: DuplicateMatch) => found.set(a.id, { id: a.id, company: a.company, role: a.role, stage: a.stage });

  if (link) {
    // The link is not indexed, so this reads every application. The list is small and the lookup is debounced.
    const same = await db.applications.filter((a) => isLive(a) && a.postingUrl === link).toArray();
    for (const a of same.sort((x, y) => y.id - x.id)) keep(a);
  }
  if (ckey) {
    const ofCompany = (await db.applications.where("companyKey").equals(ckey).toArray()).filter(isLive);
    for (const a of ofCompany.sort((x, y) => y.id - x.id)) if (!rkey || a.roleKey === rkey) keep(a);
  }
  return [...found.values()].slice(0, DUPLICATES_MAX);
}
