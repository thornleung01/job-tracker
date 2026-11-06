import { useEffect } from "react";
import { useQuery } from "../app/useQuery";
import type { JobTrackerDB } from "../db/schema";
import { hasData } from "../demo/loadDemo";
import { BackupNudge } from "./BackupNudge";
import { requestPersistence, type StorageManagerLike } from "./storage";

interface Props {
  db: JobTrackerDB;
  /** the nudge belongs to the Applications page */
  page: string;
  /** navigator.storage, or a fake in tests */
  storage?: StorageManagerLike;
}

/**
 * Mounted once in the signed-in and demo shells. It asks the browser to keep the data as soon as there is any (once per
 * session, see storage.ts), and shows the backup nudge on the Applications page. Renders nothing otherwise.
 */
export function BackupGuard({ db, page, storage }: Props) {
  // "Any data" includes Recently deleted applications (hasData counts every row): they are in the database and can be
  // restored, so the browser is asked to keep them too.
  const data = useQuery(() => hasData(db), [db]);
  useEffect(() => {
    if (data) void requestPersistence(true, storage);
  }, [data, storage]);
  return page === "applications" ? <BackupNudge db={db} /> : null;
}
