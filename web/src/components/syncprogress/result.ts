// What a finished sync says, shared by the Settings page and the banner so the two cannot word the same problem differently.
import { ActionError } from "../../db/errors";
import { accountLabel } from "../../sync/accountLabel";
import type { SyncReport } from "../../sync/mailbox";
import { NotConnected } from "../../types";

export interface RunResult {
  ok: boolean;
  lines: string[];
  /** the lines are about a mailbox that needs connecting in Settings, so they link to the Mail tab */
  mailLink?: boolean;
}

/** What either screen says when the shared lock is taken. */
export const ALREADY_RUNNING = "A sync is already running.";

/**
 * A sentence that is safe to show for something that went wrong. The app's own errors (ActionError, NotConnected) and the plain `new Error("...")`
 * the sign-in and provider code throw carry hand-written sentences; anything else (a TypeError such as "Failed to fetch", a DOMException,
 * a thrown string) is an engine message, so it gets a plain sentence instead.
 */
export function errorText(e: unknown): string {
  if (e instanceof ActionError || e instanceof NotConnected || (e instanceof Error && e.constructor === Error && e.message)) return e.message;
  return "Something went wrong. Try again.";
}

/** "1 email", "2 emails". */
export const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** The lines that follow the summary, the same for every screen: what to reconnect, what failed, whether it was stopped. */
export function reportProblems(report: SyncReport): string[] {
  return [
    ...report.needConnect.map((a) => `Reconnect ${accountLabel(a)}, then try again.`),
    ...report.failed.map((f) => `${accountLabel(f.account)}: ${f.message}`),
    ...(report.stopped ? ["Sync stopped."] : []),
  ];
}

/** True when every account synced and nothing was stopped. */
export const isCleanReport = (report: SyncReport): boolean => report.needConnect.length === 0 && report.failed.length === 0 && !report.stopped;

/** Emails the sync read and kept: everything except duplicates, errors and retries. */
function readCount(report: SyncReport): number {
  return report.synced.reduce(
    (total, s) => total + Object.entries(s.counts).reduce((sum, [kind, n]) => (kind === "duplicate" || kind === "error" || kind === "retry" ? sum : sum + (n ?? 0)), 0),
    0,
  );
}

/**
 * The banner's plain sentences for what one click did. `problems` are earlier failures (a connect that did not work),
 * `report` is null when no sync ran.
 */
export function describeBannerRun(report: SyncReport | null, problems: string[]): RunResult {
  const lines = [...problems];
  if (report) {
    const read = readCount(report);
    const review = report.synced.reduce((n, s) => n + (s.counts.review ?? 0), 0);
    if (report.synced.length > 0) {
      lines.push(read === 0 ? "Synced. No new emails." : `Synced ${read} new ${plural(read, "email", "emails")}.${review ? ` ${review} ${plural(review, "needs", "need")} review.` : ""}`);
    }
    lines.push(...reportProblems(report));
  }
  if (lines.length === 0) lines.push("There are no accounts to sync.");
  const ok = problems.length === 0 && !!report && isCleanReport(report);
  return { ok, lines };
}
