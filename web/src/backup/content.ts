// What a backup holds, so a write to the backup file can tell a good backup from an empty one before it replaces anything.
import { EXPORT_FORMAT, type ExportEnvelope } from "../portability/format";

export interface BackupContent {
  /** the file's text: the whole export */
  text: string;
  /** applications in it, deleted ones included (they are in the file, and can be restored from it) */
  applications: number;
  /** true when it holds something the person made, so it is worth keeping: an application, or a learned rule, a correction to a contact, feedback on an email, or a resume or cover letter */
  worthSaving: boolean;
}

/** The export as a file's text, with what it holds. */
export function backupContent(envelope: ExportEnvelope): BackupContent {
  const d = envelope.data;
  return {
    text: JSON.stringify(envelope, null, 2),
    applications: d.applications.length,
    worthSaving: d.applications.length > 0 || d.learnedRules.length > 0 || d.contactEdits.length > 0 || d.feedback.length > 0 || d.documents.length > 0,
  };
}

/** How many applications an earlier backup file holds, or null when its text isn't a Job Tracker export (empty, or someone else's file). */
export function applicationsInBackup(text: string): number | null {
  try {
    const v = JSON.parse(text) as { format?: unknown; data?: { applications?: unknown } } | null;
    return v?.format === EXPORT_FORMAT && Array.isArray(v.data?.applications) ? v.data.applications.length : null;
  } catch {
    return null;
  }
}
