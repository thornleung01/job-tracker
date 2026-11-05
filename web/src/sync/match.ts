// Which application an email belongs to. The rules themselves are the golden-tested ones in pipeline/match.ts (the same
// function the fixtures run); this file only reads the database for them.
import type { JobTrackerDB } from "../db/schema";
import { allApplicationsFor, threadApplication } from "../db/repo";
import type { EventName } from "../db/stages";
import { pipeline } from "./pipeline";
import type { Match } from "./pipelineTypes";

export type { Match };

export const sameRole = (aKey: string, bKey: string, aRole = "", bRole = ""): boolean => pipeline().sameRole(aKey, bKey, aRole, bRole);

export function findApplication(
  db: JobTrackerDB, accountId: number, threadId: string, ckey: string, rkey: string,
  event: EventName | null = null, role = "",
): Promise<Match<number>> {
  return pipeline().findApplication(
    { threadApplication: (id) => threadApplication(db, accountId, id), applicationsFor: (key) => allApplicationsFor(db, key) },
    threadId, ckey, rkey, event, role,
  );
}
