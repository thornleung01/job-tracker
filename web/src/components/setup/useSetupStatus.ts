// The setup status as a live read: the Setup tab and the "Finish setting up" card both use it. The database part
// (accounts, the master resume, the skips, the dismissal) re-runs on every write. The AI key and the backup times live
// outside the database, so the backup times are watched here and a screen that changes the key passes a new `version`.
import { useRef } from "react";
import { realAiDeps, type AiDeps } from "../../ai";
import { useQuery } from "../../app/useQuery";
import { realBackupDeps, type BackupDeps } from "../../backup/deps";
import { backupFileName } from "../../backup/fileBackup";
import { readBackupState, useBackupState } from "../../backup/state";
import { isLocalMode } from "../../config";
import type { JobTrackerDB } from "../../db/schema";
import { isSetupCardDismissed, setupStatus, type SetupDeps, type SetupStatus } from "../../sync/setupStatus";

/** The real vault and backup bookkeeping, with any part replaced (tests, and the Settings page, which gets its own AI and backup deps). */
export function realSetupDeps(parts: { ai?: AiDeps; backup?: BackupDeps; mailAvailable?: () => boolean } = {}): SetupDeps {
  const ai = parts.ai ?? realAiDeps;
  const backup = parts.backup ?? realBackupDeps();
  return {
    aiState: (dbName) => ai.vault.status(dbName).state,
    aiLast4: (dbName) => {
      const s = ai.vault.status(dbName);
      return s.state === "none" ? null : s.last4;
    },
    lastBackupAt: (dbName) => readBackupState(dbName).lastBackupAt,
    backupFile: (dbName) => backupFileName(dbName, backup.file),
    mailAvailable: parts.mailAvailable ?? (() => !isLocalMode()),
  };
}

/**
 * `status` is null while it loads. `dismissed` is whether the card was closed (false while loading, so a card never flashes
 * away). `version` is bumped by a screen after it changes something the database doesn't show (the AI key).
 */
export function useSetupStatus(db: JobTrackerDB, deps: SetupDeps = realSetupDeps(), version = 0): { status: SetupStatus | null; dismissed: boolean } {
  // Callers may build `deps` on every render; the read only needs the latest one, not a new subscription for each.
  const latest = useRef(deps);
  latest.current = deps;
  const { lastBackupAt } = useBackupState(db.name);
  const result = useQuery(async () => ({ status: await setupStatus(db, latest.current), dismissed: await isSetupCardDismissed(db) }), [db, version, lastBackupAt], { keepPrevious: true });
  return { status: result?.status ?? null, dismissed: result?.dismissed ?? false };
}
