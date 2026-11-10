// Tailors the master resume and writes a cover letter for one job (tailorForJob) or one application (tailorForApplication) with AI, then
// checks the result against the master. Nothing is saved here: the person reviews the draft first, and saveTailorDraft (or saveTailoredJob
// in tailorFlow.ts) stores it once they accept. Only the job, the posting and the master go to the model. The greeting's name is read from the person's own contacts here and never leaves the device.
import {
  AiError, DEFAULT_MODEL, checkTailored, masterText, parseTailorReply, readMaster, tailorRequest,
  type AiDeps, type CheckedLine, type CheckedTailor, type Complete, type TailorMaster, type TailorTone,
} from "../ai";
import { greeting } from "./letter";
import { newItemId, normalizeSections } from "../db/documentShape";
import { ActionError } from "../db/errors";
import { MAX_AI_INPUT_CHARS } from "../db/limits";
import { requireApplication } from "../db/repo";
import { tx, type DocItem, type DocSection, type DocumentRow, type JobTrackerDB } from "../db/schema";
import { derive, type Contact } from "./contacts";
import { getMaster, isTailored, saveCoverLetter, saveTailored } from "./documents";
import { squeeze } from "./text";

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
  /** the live reusable resume to tailor from, instead of the master */
  baselineId?: number;
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
  /** the resume the draft was tailored from: the master, or the version chosen as the baseline */
  baselineId: number;
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
  return keepSourceIds(resume, lines, master);
}

/**
 * A line that maps one-to-one to a baseline line takes that line's id, so the saved copy can be compared with its baseline. Ids stay unique
 * in the document: a baseline id already on a line the copy carried over as it was, or claimed by an earlier line, is not used twice.
 */
function keepSourceIds(resume: DocSection[], lines: TailorLine[], baseline: readonly DocSection[]): { resume: DocSection[]; lines: TailorLine[] } {
  const known = new Set(baseline.flatMap((s) => s.items.map((i) => i.id)));
  const written = new Set(lines.map((l) => l.id));
  const taken = new Set(resume.flatMap((s) => s.items.filter((i) => !written.has(i.id)).map((i) => i.id)));
  const rename = new Map<string, string>();
  for (const line of lines) {
    if ((line.sourceIds?.length ?? 0) > 1 || !known.has(line.sourceId) || taken.has(line.sourceId)) continue;
    taken.add(line.sourceId);
    rename.set(line.id, line.sourceId);
  }
  return {
    resume: resume.map((s) => ({ ...s, items: s.items.map((i) => (rename.has(i.id) ? { ...i, id: rename.get(i.id)! } : i)) })),
    lines: lines.map((l) => (rename.has(l.id) ? { ...l, id: rename.get(l.id)! } : l)),
  };
}

/** The letter as the editor keeps it: one section, the greeting first, then a paragraph per line. */
function buildCover(greetingLine: string, paragraphs: readonly string[]): DocSection[] {
  return [{ id: newItemId(), heading: "", items: [greetingLine, ...paragraphs].map((text) => ({ id: newItemId(), text })) }];
}

/** What tailoring needs from the AI side: the vault and the call, and optionally a call that replaces `ai.complete`. */
export interface TailorDeps {
  ai: AiDeps;
  complete?: Complete;
}

/** The job to tailor for. It needs no application: the Resume page tailors for a pasted job before it is added to Applications. */
export interface JobInput {
  company: string;
  role: string;
  posting: string;
  /** the live reusable resume to tailor from, instead of the master (TailorOptions.baselineId is used when this is left out) */
  baselineId?: number;
  /** the people known at the company, for the greeting. Left out (no application yet), the letter greets the company's hiring team. */
  people?: readonly Pick<Contact, "name" | "kind" | "mentionedOnly">[];
}

/** The letter's first line: the people's greeting when they are known, otherwise "Dear hiring team at {Company},". */
function jobGreeting(company: string, people: JobInput["people"]): string {
  if (people) return greeting(people);
  const name = squeeze(company);
  return name ? `Dear hiring team at ${name},` : greeting([]);
}

/** The resume to start from: the master, or the chosen baseline. Throws a TailorError when it is missing, deleted, or tailored. */
async function readBaseline(db: JobTrackerDB, baselineId: number | undefined): Promise<DocumentRow> {
  const baseline = baselineId === undefined ? await getMaster(db) : await db.documents.get(baselineId);
  if (baselineId === undefined && !baseline) throw new TailorError("Add your master resume first.");
  if (!baseline || baseline.kind !== "resume" || baseline.deletedAt || isTailored(baseline)) throw new TailorError("That resume isn't there any more.");
  return baseline;
}

/**
 * Tailors the master resume (or the chosen baseline) and writes a cover letter for one job. Throws a TailorError when there is no master, no
 * company or no posting text, an AiError for everything the AI side can say (no key, locked, a refusal, a reply that can't be read), or the
 * caller's abort unchanged. Saves nothing.
 */
export async function tailorForJob(db: JobTrackerDB, job: JobInput, deps: TailorDeps, opts: TailorOptions = {}): Promise<TailorDraft> {
  const master = await readBaseline(db, job.baselineId ?? opts.baselineId);
  if (!squeeze(job.company)) throw new TailorError("Enter a company name.");
  const posting = job.posting.trim();
  if (!posting) throw new TailorError("Add the job posting first.");

  const { vault } = deps.ai;
  const complete = deps.complete ?? deps.ai.complete;
  const key = vault.key(db.name);
  const status = vault.status(db.name);
  if (key === null) throw new AiError(status.state === "none" ? "noKey" : "locked");

  const parts = readMaster(master.sections);
  const request = tailorRequest(
    { job: { company: job.company, role: job.role, posting }, master: parts, tone: opts.tone, note: opts.note },
    status.state === "none" ? DEFAULT_MODEL : status.model,
  );
  if (request.user.length > MAX_AI_INPUT_CHARS) throw new AiError("tooLong");

  const reply = await complete(key, request, { signal: opts.signal });
  const checked = checkTailored(parts, parseTailorReply(reply.json), { masterSource: masterText(master.sections), company: job.company, role: job.role });
  const { resume, lines } = buildResume(master.sections, parts, checked);
  return {
    baselineId: master.id,
    resume,
    lines,
    cover: buildCover(jobGreeting(job.company, job.people), checked.cover.paragraphs),
    coverFlags: checked.cover.flags,
    unused: [
      ...checked.droppedSkills.map((s) => (s.label ? `${s.label}: ${s.text}` : s.text)),
      ...checked.jobs.flatMap((j) => j.dropped.map((b) => b.text)),
    ],
  };
}

/**
 * Tailors for application `appId`: its company, role and posting text, and the people in its mail for the greeting. Throws as tailorForJob
 * does, and a MissingRecordError when the application is gone. Saves nothing.
 */
export async function tailorForApplication(db: JobTrackerDB, appId: number, deps: TailorDeps, opts: TailorOptions = {}): Promise<TailorDraft> {
  const app = await requireApplication(db, appId);
  // The baseline is checked before the posting, so a missing master is what the person hears first.
  await readBaseline(db, opts.baselineId);
  const posting = app.postingText?.trim() ?? "";
  if (!posting) throw new TailorError("Add the job posting first.");
  const people = await derive(db, appId);
  return tailorForJob(db, { company: app.company, role: app.role, posting, people }, deps, opts);
}

/**
 * "Start by hand": the baseline's sections as they are (every line keeps its id, so the copy can be compared with it later) and a letter
 * that is only the greeting. No AI and no key. Throws a TailorError when the baseline is missing, deleted, tailored or empty. Saves nothing.
 */
export async function draftFromBaseline(db: JobTrackerDB, baselineId: number, company: string): Promise<TailorDraft> {
  const baseline = await readBaseline(db, baselineId);
  const resume = normalizeSections(baseline.sections);
  if (!resume.length) throw new TailorError("Add some text to the resume first.");
  return { baselineId: baseline.id, resume, lines: [], cover: buildCover(jobGreeting(company, undefined), []), coverFlags: [], unused: [] };
}

/** Stores what the person accepted: the application's tailored resume and its cover letter, both marked as made with AI, in one transaction. */
export async function saveTailorDraft(
  db: JobTrackerDB, appId: number, draft: { resume: DocSection[]; cover: DocSection[]; baselineId?: number }, now: Date = new Date(),
): Promise<{ resumeId: number; coverId: number }> {
  const resume = normalizeSections(draft.resume);
  const cover = normalizeSections(draft.cover);
  return tx(db, async () => ({
    resumeId: await saveTailored(db, appId, resume, "ai", now, draft.baselineId),
    coverId: await saveCoverLetter(db, appId, cover, "ai", now),
  }));
}
