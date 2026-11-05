// Dated steps you log on an application, shown alongside its emails (jobtracker/activity.py). Notes only exist as imported
// rows: they are still shown in the history, but there is no way to write one here.
import { BODY_LIMIT } from "../types";
import { ActionError } from "../db/errors";
import { MAX_NOTE_CHARS } from "../db/limits";
import { requireApplication } from "../db/repo";
import { tx, type JobTrackerDB } from "../db/schema";
import { isStage, STAGES } from "../db/stages";
import { iso, stampForDay } from "../db/time";
import { accountLabel } from "./accountLabel";
import { byDesc } from "./compare";
import { mailboxLink, replyLink, type MailLink } from "./links";
import { cpLength, squeeze } from "./text";

/** What you can log as a step. The six stages move the application; the others are history only. */
export const STEP_PRESETS: readonly string[] = [
  "Recruiter call", "Phone screen", "Take-home assignment", "Technical interview", "Final round",
  "Reference check", "Follow-up sent", "Offer negotiation", "Withdrew application",
];
export const STEP_GROUPS: readonly { label: string; steps: readonly string[] }[] = [
  { label: "Moves the application to a stage", steps: STAGES },
  { label: "Other steps", steps: STEP_PRESETS },
];
const ALLOWED_STEPS = new Map<string, string>([...STAGES, ...STEP_PRESETS].map((s) => [s.toLowerCase(), s]));

/** How many history items an application shows at first. */
const HISTORY_SHOWN = 20;

/**
 * Logs a step from the preset list. If it is one of the stages, the application moves to it (when the date isn't older
 * than the current stage). Returns true if the stage changed.
 */
export async function addStep(
  db: JobTrackerDB, appId: number, label: string | null | undefined, day?: string | null, body = "", now: Date = new Date(),
): Promise<boolean> {
  const step = ALLOWED_STEPS.get(squeeze(label).toLowerCase());
  const text = (body ?? "").trim();
  if (!step) throw new ActionError("Choose a step from the list.");
  if (cpLength(text) > MAX_NOTE_CHARS) throw new ActionError(`Notes can be up to ${MAX_NOTE_CHARS} characters.`);
  const chosen = (day ?? "").trim();
  const when = chosen ? stampForDay(chosen, now) : iso(now);
  const stage = isStage(step) ? step : null;
  const created = iso(now);

  return tx(db, async () => {
    const app = await requireApplication(db, appId);
    await db.activity.add({ applicationId: appId, kind: "step", label: step, body: text, occurredAt: when, createdAt: created });
    if (when > (app.lastActivity ?? "")) await db.applications.update(appId, { lastActivity: when });
    if (!stage) return false;
    if (stage === "Applied" && (!app.appliedAt || when < app.appliedAt)) await db.applications.update(appId, { appliedAt: when });
    // Your own entry can move a stage in either direction, but an older date is history only.
    // It never locks the application, so later emails can still move it forward.
    if (stage !== app.stage && when >= (app.stageAt ?? "")) {
      await db.applications.update(appId, { stage, stageAt: when });
      return true;
    }
    return false;
  });
}

/** Removes a note or step. A stage change it caused is not undone. */
export async function deleteEntry(db: JobTrackerDB, appId: number, activityId: number): Promise<boolean> {
  return tx(db, async () => {
    const row = await db.activity.get(activityId);
    if (!row || row.applicationId !== appId) return false;
    await db.activity.delete(activityId);
    return true;
  });
}

export interface HistoryItem {
  kind: "note" | "step" | "email";
  id: number;
  when: string;
  title: string;
  body: string;
  detail: string;
  // email only
  sender?: string;
  account?: string;
  truncated?: boolean;
  open?: MailLink | null;
  reply?: MailLink | null;
  subject?: string;
}

/** Notes, steps, and (optionally) emails for one application, newest first, plus the total count. */
export async function history(
  db: JobTrackerDB, appId: number, limit = HISTORY_SHOWN, includeEmails = true,
): Promise<{ items: HistoryItem[]; total: number }> {
  const items: HistoryItem[] = (await db.activity.where("applicationId").equals(appId).toArray()).map((r) => ({
    kind: r.kind, id: r.id, when: r.occurredAt, title: r.label ?? "", body: r.body, detail: "",
  }));
  if (includeEmails) {
    const accounts = new Map((await db.accounts.toArray()).map((a) => [a.id, a]));
    for (const r of await db.emails.where("applicationId").equals(appId).toArray()) {
      const account = accounts.get(r.accountId);
      if (r.needsReview || !account) continue;
      items.push({
        kind: "email", id: r.id, when: r.receivedAt, title: r.subject || "(no subject)", body: r.body ?? "",
        detail: (r.event ?? "").replace(/_/g, " "), sender: r.sender ?? "",
        account: accountLabel(account),
        truncated: cpLength(r.body ?? "") >= BODY_LIMIT,
        open: mailboxLink(account.provider, account.address, r.threadId, r.webLink),
        reply: replyLink(account.provider, account.address, r.sender ?? "", r.subject, r.webLink),
        subject: r.subject ?? "",
      });
    }
  }
  items.sort((a, b) => byDesc<HistoryItem>((i) => i.when)(a, b) || b.id - a.id);
  return { items: items.slice(0, limit), total: items.length };
}
