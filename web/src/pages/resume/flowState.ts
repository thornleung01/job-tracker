// The four steps' work in progress: the pasted job, the draft and its ticks, the letter and where it will be saved. A reducer, so every change is
// one plain step, and a copy in session storage per database, so a reload keeps it. Nothing here reaches the database: Save does (StepAdd).
import { useEffect, useReducer } from "react";
import { applyTick } from "../../components/documents/tailorTicks";
import type { DocSection } from "../../db/schema";
import type { TailorDraft } from "../../sync/tailor";

/** The open step once a master resume exists (before that, step 1 is open whatever this says). */
export type FlowStep = "job" | "review" | "add" | "done";

export interface LetterDraft {
  text: string;
  /** the draft's own letter sections, so the saved letter keeps their ids */
  base: DocSection[];
  flags: string[];
}

/** What Save made, for the done screen. */
export interface SavedJob {
  appId: number;
  resumeId: number;
  coverId: number | null;
  company: string;
  /** the letter as saved, for the Gmail or Outlook draft */
  letter: string;
}

/** Where step 4 saves: the default (the application from ?app, else the first match), one application, or a new one. */
export type Target = "default" | "new" | number;

export interface FlowState {
  step: FlowStep;
  /** the resume to tailor from; null is the master */
  baselineId: number | null;
  posting: string;
  url: string;
  company: string;
  role: string;
  /** filled in from the posting or the link and not yet touched, so the page says to check them */
  guessed: { company: boolean; role: boolean };
  draft: TailorDraft | null;
  /** the draft is a copy of the baseline (Start by hand), not written with AI */
  byHand: boolean;
  /** the tailored copy as it is being edited */
  resume: DocSection[] | null;
  ticks: Record<string, boolean>;
  letter: LetterDraft | null;
  /** the person changed the copy or the letter by hand since it was written, so Try again asks first */
  edited: boolean;
  /** which document step 3 shows */
  view: "resume" | "cover";
  target: Target;
  /** the application the flow was opened for (#/resume?app=<id>) */
  fromApp: number | null;
  saved: SavedJob | null;
}

export const emptyFlow = (baselineId: number | null = null): FlowState => ({
  step: "job", baselineId, posting: "", url: "", company: "", role: "", guessed: { company: false, role: false },
  draft: null, byHand: false, resume: null, ticks: {}, letter: null, edited: false, view: "resume", target: "default", fromApp: null, saved: null,
});

/** Something is in progress that Start over would clear. */
export const hasWork = (s: FlowState): boolean => s.step !== "done" && Boolean(s.posting.trim() || s.company.trim() || s.role.trim() || s.url.trim() || s.draft);

export type FlowAction =
  | { type: "field"; name: "company" | "role" | "url"; value: string }
  /** the posting box changed; `found` is what was read from it, which fills the company and role you haven't typed */
  | { type: "posting"; value: string; found?: { company: string; role: string } }
  /** a read of the posting or the link: fills only what is empty or still a guess, and marks it to check */
  | { type: "fill"; company?: string; role?: string; posting?: string }
  | { type: "baseline"; id: number | null }
  | { type: "drafted"; draft: TailorDraft; resume: DocSection[]; ticks: Record<string, boolean>; byHand: boolean }
  | { type: "edit"; resume: DocSection[] }
  | { type: "tick"; id: string; on: boolean; baseline: readonly DocSection[] }
  | { type: "letter"; text: string }
  | { type: "view"; view: FlowState["view"] }
  | { type: "go"; step: FlowStep }
  | { type: "target"; target: Target }
  | { type: "prefill"; appId: number; company: string; role: string; posting: string; url: string }
  | { type: "saved"; saved: SavedJob }
  | { type: "reset" };

const letterOf = (draft: TailorDraft): LetterDraft => ({
  text: draft.cover.flatMap((s) => [s.heading, ...s.items.map((i) => i.text)]).filter(Boolean).join("\n\n"), base: draft.cover, flags: draft.coverFlags,
});

export function flowReducer(s: FlowState, a: FlowAction): FlowState {
  switch (a.type) {
    case "field":
      return a.name === "url" ? { ...s, url: a.value } : { ...s, [a.name]: a.value, guessed: { ...s.guessed, [a.name]: false } };
    case "posting": {
      const next = { ...s, posting: a.value };
      if (!a.found) return next;
      return flowReducer(next, { type: "fill", company: a.found.company, role: a.found.role });
    }
    case "fill": {
      const take = (name: "company" | "role", value: string | undefined) => Boolean(value) && (!s[name].trim() || s.guessed[name]);
      const company = take("company", a.company);
      const role = take("role", a.role);
      return {
        ...s,
        company: company ? a.company! : s.company,
        role: role ? a.role! : s.role,
        posting: a.posting && !s.posting.trim() ? a.posting : s.posting,
        guessed: { company: company || s.guessed.company, role: role || s.guessed.role },
      };
    }
    case "baseline":
      return { ...s, baselineId: a.id };
    case "drafted":
      return { ...s, draft: a.draft, byHand: a.byHand, resume: a.resume, ticks: a.ticks, letter: letterOf(a.draft), edited: false, view: "resume", step: "review" };
    case "edit":
      return { ...s, resume: a.resume, edited: true };
    case "tick":
      if (!s.draft || !s.resume) return s;
      return { ...s, ticks: { ...s.ticks, [a.id]: a.on }, resume: applyTick(s.resume, s.draft, a.baseline, a.id, a.on) };
    case "letter":
      return s.letter ? { ...s, letter: { ...s.letter, text: a.text }, edited: true } : s;
    case "view":
      return { ...s, view: a.view };
    case "go":
      // review and add need a draft; without one the job is where to go
      return { ...s, step: (a.step === "review" || a.step === "add") && !s.draft ? "job" : a.step };
    case "target":
      return { ...s, target: a.target };
    case "prefill":
      return {
        ...emptyFlow(s.baselineId), company: a.company, role: a.role, posting: a.posting, url: a.url, fromApp: a.appId, target: a.appId,
      };
    case "saved":
      return { ...emptyFlow(s.baselineId), step: "done", saved: a.saved };
    case "reset":
      return emptyFlow(s.baselineId);
  }
}

// -- session storage --------------------------------------------------------------------------------------------------

export const flowKey = (dbName: string) => `jobtracker:resume-steps:${dbName}`;

const STEPS: readonly FlowStep[] = ["job", "review", "add", "done"];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** The flow saved for this database, or a fresh one when there is none, storage is off, or what is there doesn't read. */
export function loadFlow(dbName: string): FlowState {
  try {
    const raw = sessionStorage.getItem(flowKey(dbName));
    if (!raw) return emptyFlow();
    const v: unknown = JSON.parse(raw);
    if (!isObj(v)) return emptyFlow();
    const step = STEPS.includes(v.step as FlowStep) && v.step !== "done" ? (v.step as FlowStep) : "job";
    const draft = isObj(v.draft) && Array.isArray(v.draft.resume) && Array.isArray(v.draft.lines) && Array.isArray(v.draft.cover) ? (v.draft as unknown as TailorDraft) : null;
    const resume = draft && Array.isArray(v.resume) ? (v.resume as DocSection[]) : null;
    const letter = draft && isObj(v.letter) && typeof v.letter.text === "string" && Array.isArray(v.letter.base)
      ? { text: v.letter.text, base: v.letter.base as DocSection[], flags: Array.isArray(v.letter.flags) ? (v.letter.flags as unknown[]).filter((f): f is string => typeof f === "string") : [] }
      : null;
    const guessed = isObj(v.guessed) ? { company: v.guessed.company === true, role: v.guessed.role === true } : { company: false, role: false };
    const id = (x: unknown) => (typeof x === "number" && Number.isSafeInteger(x) && x > 0 ? x : null);
    const target: Target = v.target === "new" ? "new" : id(v.target) ?? "default";
    return {
      ...emptyFlow(id(v.baselineId)),
      step: draft && resume ? step : "job",
      posting: str(v.posting), url: str(v.url), company: str(v.company), role: str(v.role), guessed,
      draft: resume ? draft : null, byHand: resume !== null && v.byHand === true, resume,
      ticks: isObj(v.ticks) ? Object.fromEntries(Object.entries(v.ticks).filter(([, on]) => typeof on === "boolean")) as Record<string, boolean> : {},
      letter, edited: v.edited === true, view: v.view === "cover" ? "cover" : "resume", target, fromApp: id(v.fromApp),
    };
  } catch {
    return emptyFlow();
  }
}

/** Keeps the flow for a reload. A finished or empty flow leaves nothing behind. */
export function storeFlow(dbName: string, s: FlowState): void {
  try {
    if (s.step === "done" || !hasWork(s)) {
      if (s.baselineId === null) sessionStorage.removeItem(flowKey(dbName));
      else sessionStorage.setItem(flowKey(dbName), JSON.stringify({ baselineId: s.baselineId }));
      return;
    }
    const { saved: _saved, ...keep } = s;
    void _saved;
    sessionStorage.setItem(flowKey(dbName), JSON.stringify(keep));
  } catch {
    // no storage, or it is full: the flow lasts until the page is left
  }
}

export function clearFlow(dbName: string): void {
  try {
    sessionStorage.removeItem(flowKey(dbName));
  } catch {
    // nothing to clear
  }
}

/** The flow for this database: read once from session storage, written back on every change. */
export function useFlow(dbName: string) {
  const [state, dispatch] = useReducer(flowReducer, dbName, loadFlow);
  useEffect(() => storeFlow(dbName, state), [dbName, state]);
  return [state, dispatch] as const;
}
