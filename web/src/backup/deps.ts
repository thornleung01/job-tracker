// What the backup features reach outside the app for, so tests can hand in fakes.
import { realFileBackupDeps, type FileBackupDeps } from "./fileBackup";
import { storageStatus, type StorageStatus } from "./storage";

export interface BackupDeps {
  file: FileBackupDeps;
  storage(): Promise<StorageStatus>;
}

export function realBackupDeps(): BackupDeps {
  return { file: realFileBackupDeps(), storage: () => storageStatus() };
}
