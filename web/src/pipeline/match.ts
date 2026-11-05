// Port of jobtracker/match.py: which application does an email belong to? The app calls findApplication (through
// sync/match.ts, which only reads the database); the golden fixtures check the same function.
import { casefold } from "./pystr";

/** `Id` is the application id type of whoever asks: numbers in the app (Dexie rows), strings or numbers in the fixtures. */
export interface Match<Id extends number | string = number | string> {
  kind: "matched" | "new" | "ambiguous";
  applicationId: Id | null;
}

/** The stored fields of an application that matching looks at. */
export interface MatchCandidate<Id extends number | string = number | string> {
  id: Id;
  role: string;
  roleKey: string;
  stage: string;
}

const LEVEL_WORDS: ReadonlySet<string> = new Set([
  "manager", "director", "head", "vp", "lead", "senior", "junior", "principal", "staff", "chief", "intern", "associate", "assistant",
]);

export function words(role: string | null | undefined): string[] {
  return casefold(role || "").match(/[a-z0-9]+/g) ?? [];
}

/**
 * Do these name the same job? Equal keys do. Otherwise one title must be the other, word for word, with something added
 * on the end that is not a level ("Operations Manager | NAM" is "Operations Manager"; "Senior Engineering Manager" is
 * not "Senior Engineer").
 */
export function sameRole(aKey: string, bKey: string, aRole = "", bRole = ""): boolean {
  if (!aKey || !bKey) return false;
  if (aKey === bKey) return true;
  const a = words(aRole);
  const b = words(bRole);
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 2 && short.every((w, i) => long[i] === w) && !long.slice(short.length).some((w) => LEVEL_WORDS.has(w));
}

const matched = <Id extends number | string>(id: Id): Match<Id> => ({ kind: "matched", applicationId: id });
const NEW: Match<never> = { kind: "new", applicationId: null };
const AMBIGUOUS: Match<never> = { kind: "ambiguous", applicationId: null };

/**
 * The matching rules, on data already loaded. `threadApplicationId` is the application the same email thread already
 * belongs to (if any). `applications` are this company's applications in creation order (oldest first).
 */
export function matchApplication<Id extends number | string>(
  threadApplicationId: Id | null | undefined,
  applications: readonly MatchCandidate<Id>[],
  ckey: string,
  rkey: string,
  event: string | null = null,
  role = "",
): Match<Id> {
  // 1. Same email thread.
  if (threadApplicationId) return matched(threadApplicationId);

  if (!ckey) return AMBIGUOUS;

  // 2. Same company and role. A fresh "applied" mail after a rejection or offer is a re-application.
  const closed = event === "applied" ? ["Rejected", "Offer"] : ["Rejected"];
  if (rkey) {
    let sameRoleApps = applications.filter((a) => sameRole(a.roleKey, rkey, a.role, role));
    if (event === "applied") {
      const live = sameRoleApps.filter((a) => !closed.includes(a.stage));
      if (sameRoleApps.length && !live.length) return NEW;
      sameRoleApps = live;
    }
    if (sameRoleApps.length) return matched(sameRoleApps[sameRoleApps.length - 1].id);
  }

  // 3. Same company, exactly one open application.
  const open = applications.filter((a) => !closed.includes(a.stage));
  if (open.length === 1) {
    const only = open[0];
    // A named role that differs from the open application's role is a different job.
    if (!rkey || !only.roleKey || sameRole(only.roleKey, rkey, only.role, role)) return matched(only.id);
    return NEW;
  }
  if (open.length > 1) {
    // A confirmation that names a role none of them have is a new application, not a puzzle.
    return event === "applied" && rkey ? NEW : AMBIGUOUS;
  }

  // 4. Nothing open at this company.
  return NEW;
}

type Maybe<T> = T | Promise<T>;

/** Where the matcher reads from; sync/match.ts implements it over Dexie. */
export interface MatchStore<Id extends number | string = number | string> {
  /** The newest application any stored email in this thread (for this account) belongs to. */
  threadApplication(threadId: string): Maybe<Id | null | undefined>;
  /** Applications of one company, oldest first. */
  applicationsFor(ckey: string): Maybe<readonly MatchCandidate<Id>[]>;
}

/** The one place the app decides which application an email belongs to (the golden fixtures run this exact function). */
export async function findApplication<Id extends number | string>(
  store: MatchStore<Id>,
  threadId: string,
  ckey: string,
  rkey: string,
  event: string | null = null,
  role = "",
): Promise<Match<Id>> {
  const thread = threadId ? await store.threadApplication(threadId) : null;
  if (thread) return matched(thread);
  if (!ckey) return AMBIGUOUS;
  return matchApplication(null, await store.applicationsFor(ckey), ckey, rkey, event, role);
}
