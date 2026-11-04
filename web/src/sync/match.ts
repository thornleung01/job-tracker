// Which application an email belongs to (jobtracker/match.py).
import type { JobTrackerDB } from "../db/schema";
import { allApplicationsFor, threadApplication } from "../db/repo";
import type { EventName } from "../db/stages";
import { pipeline } from "./pipeline";

export interface Match {
  kind: "matched" | "new" | "ambiguous";
  applicationId: number | null;
}

export const sameRole = (aKey: string, bKey: string, aRole = "", bRole = ""): boolean => pipeline().sameRole(aKey, bKey, aRole, bRole);

export async function findApplication(
  db: JobTrackerDB, accountId: number, threadId: string, ckey: string, rkey: string,
  event: EventName | null = null, role = "",
): Promise<Match> {
  // 1. Same email thread.
  const byThread = await threadApplication(db, accountId, threadId);
  if (byThread) return { kind: "matched", applicationId: byThread };

  if (!ckey) return { kind: "ambiguous", applicationId: null };

  // 2. Same company and role.
  const apps = await allApplicationsFor(db, ckey);
  // A fresh "applied" mail after a rejection or offer is a re-application.
  const closed: string[] = event === "applied" ? ["Rejected", "Offer"] : ["Rejected"];
  if (rkey) {
    let sameRoleApps = apps.filter((a) => sameRole(a.roleKey, rkey, a.role, role));
    if (event === "applied") {
      const live = sameRoleApps.filter((a) => !closed.includes(a.stage));
      if (sameRoleApps.length && !live.length) return { kind: "new", applicationId: null };
      sameRoleApps = live;
    }
    if (sameRoleApps.length) return { kind: "matched", applicationId: sameRoleApps[sameRoleApps.length - 1].id };
  }

  // 3. Same company, exactly one open application.
  const openApps = apps.filter((a) => !closed.includes(a.stage));
  if (openApps.length === 1) {
    const only = openApps[0];
    // A named role that differs from the open application's role is a different job.
    if (!rkey || !only.roleKey || sameRole(only.roleKey, rkey, only.role, role)) return { kind: "matched", applicationId: only.id };
    return { kind: "new", applicationId: null };
  }
  if (openApps.length > 1) {
    // A confirmation that names a role none of them have is a new application, not a puzzle.
    return event === "applied" && rkey ? { kind: "new", applicationId: null } : { kind: "ambiguous", applicationId: null };
  }

  // 4. Nothing open at this company.
  return { kind: "new", applicationId: null };
}
