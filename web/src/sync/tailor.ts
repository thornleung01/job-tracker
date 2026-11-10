// Tailors the master resume and writes a cover letter for one application with AI, then checks the result against the master. Nothing is
// saved by tailorForApplication: the person reviews the draft first and saveTailorDraft stores it once they accept. Only the job, the posting
// and the master go to the model. The greeting's name is read from the person's own contacts here and never leaves the device.
import {
  AiError, DEFAULT_MODEL, checkTailored, masterText, parseTailorReply, readMaster, tailorRequest,
  type AiDeps, type CheckedLine, type CheckedTailor, type Complete, type TailorMaster, type TailorTone,
} from "../ai";
import { greeting } from "./letter";
import { newItemId, normalizeSections } from "../db/documentShape";
import { ActionError } from "../db/errors";
import { MAX_AI_INPUT_CHARS } from "../db/limits";
import { requireApplication } from "../db/repo";
import { tx, type DocItem, type DocSection, type JobTrackerDB } from "../db/schema";
import { derive } from "./contacts";
import { getMaster, saveCoverLetter, saveTailored } from "./documents";

/** A request the tailoring refuses, with a sentence that is safe to show. */
export class TailorError extends ActionError {
  constructor(message: string) {
    super(message);
    this.name = "TailorError";
  }
}

export interface TailorOptions {
  tone?: TailorTone;
  note?: string;
  signal?: AbortSignal;
}

/** One AI-written line of the resume draft. `id` is the line's id in `draft.resume`, `sourceId` the master line it came from. */
export interface TailorLine {
  id: string;
  sourceId: string;
  /** every master line this one replaces, when more than one (a summary written on several lines) */
  sourceIds?: string[];
  changed: boolean;
  /** what the person should look at: details the master doesn't have. A flagged line starts unticked. */
  flags: string[];
}

export interface TailorDraft {
  resume: DocSection[];
  lines: TailorLine[];
  cover: DocSection[];
  /** notes about cover letter paragraphs that name something not in the master or the job */
  coverFlags: string[];
  /** master bullets the model left out, as text, so nothing disappears silently */
  unused: string[];
}

const textLine = (from: CheckedLine, kind?: "bullet" | "skill"): DocItem => ({
  id: newItemId(), text: from.text, ...(kind ? { kind } : {}), ...(from.label ? { label: from.label } : {}),
});

/** The master's sections with the summary, skills and each job's bullets replaced by the checked ones. Everything else is copied as it is. */
function buildResume(master: readonly DocSection[], parts: TailorMaster, checked: CheckedTailor): { resume: DocSection[]; lines: TailorLine[] } {
  const lines: TailorLine[] = [];
  const add = (from: CheckedLine, kind?: "bullet" | "skill"): DocItem => {
    const item = textLine(from, kind);
    lines.push({ id: item.id, sourceId: from.sourceId, ...(from.sourceIds && from.sourceIds.length > 1 ? { sourceIds: from.sourceIds } : {}), changed: from.changed, flags: from.flags });
    return item;
  };
  const jobs = new Map(checked.jobs.map((j) => [j.orgId, j]));
  let skillsDone = false;
  const resume = master.map((section): DocSection => {
    if (parts.summaryId && section.items.some((i) => i.id === parts.summaryId) && checked.summary) {
      let done = false;
      const items = section.items.flatMap((i): DocItem[] => {
        if (i.kind || !i.text) return [i];
        if (done) return [];
        done = true;
        return [add(checked.summary!)];
      });
      return { ...section, items };
    }
    let job: CheckedTailor["jobs"][number] | undefined;
    let bulletsDone = false;
    const items = section.items.flatMap((i): DocItem[] => {
      if (i.kind === "skill") {
        if (skillsDone) return [];
        skillsDone = true;
        return checked.skills.map((s) => add(s, "skill"));
      }
      if (i.kind === "org") {
        job = jobs.get(i.id);
        bulletsDone = false;
      } else if (i.kind === "school") job = undefined;
      else if (i.kind === "bullet" && job) {
        if (bulletsDone) return [];
        bulletsDone = true;
        return job.bullets.map((b) => add(b, "bullet"));
      }
      return [i];
    });
    return { ...section, items };
  });
  return { resume, lines };
}

/** The letter as the editor keeps it: one section, the greeting first, then a paragraph per line. */
function buildCover(greetingLine: string, paragraphs: readonly string[]): DocSection[] {
  return [{ id: newItemId(), heading: "", items: [greetingLine, ...paragraphs].map((text) => ({ id: newItemId(), text })) }];
}

/**
 * Tailors the master resume and writes a cover letter for application `appId`. Throws a TailorError when there is no master or no posting
 * text, an AiError for everything the AI side can say (no key, locked, a refusal, a reply that can't be read), or the caller's abort unchanged.
 * Saves nothing.
 */
export async function tailorForApplication(
  db: JobTrackerDB, appId: number, deps: { ai: AiDeps; complete?: Complete }, opts: TailorOptions = {},
): Promise<TailorDraft> {
  const app = await requireApplication(db, appId);
  const master = await getMaster(db);
  if (!master) throw new TailorError("Add your master resume first.");
  const posting = app.postingText?.trim() ?? "";
  if (!posting) throw new TailorError("Add the job posting first.");

  const { vault } = deps.ai;
  const complete = deps.complete ?? deps.ai.complete;
  const key = vault.key(db.name);
  const status = vault.status(db.name);
  if (key === null) throw new AiError(status.state === "none" ? "noKey" : "locked");

  const parts = readMaster(master.sections);
  const request = tailorRequest(
    { job: { company: app.company, role: app.role, posting }, master: parts, tone: opts.tone, note: opts.note },
    status.state === "none" ? DEFAULT_MODEL : status.model,
  );
  if (request.user.length > MAX_AI_INPUT_CHARS) throw new AiError("tooLong");

  const reply = await complete(key, request, { signal: opts.signal });
  const checked = checkTailored(parts, parseTailorReply(reply.json), { masterSource: masterText(master.sections), company: app.company, role: app.role });
  const { resume, lines } = buildResume(master.sections, parts, checked);
  const people = await derive(db, appId);
  return {
    resume,
    lines,
    cover: buildCover(greeting(people), checked.cover.paragraphs),
    coverFlags: checked.cover.flags,
    unused: [
      ...checked.droppedSkills.map((s) => (s.label ? `${s.label}: ${s.text}` : s.text)),
      ...checked.jobs.flatMap((j) => j.dropped.map((b) => b.text)),
    ],
  };
}

/** Stores what the person accepted: the application's tailored resume and its cover letter, both marked as made with AI, in one transaction. */
export async function saveTailorDraft(
  db: JobTrackerDB, appId: number, draft: { resume: DocSection[]; cover: DocSection[] }, now: Date = new Date(),
): Promise<{ resumeId: number; coverId: number }> {
  const resume = normalizeSections(draft.resume);
  const cover = normalizeSections(draft.cover);
  return tx(db, async () => ({
    resumeId: await saveTailored(db, appId, resume, "ai", now),
    coverId: await saveCoverLetter(db, appId, cover, "ai", now),
  }));
}
