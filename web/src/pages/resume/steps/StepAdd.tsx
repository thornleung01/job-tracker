// Step 4, Add to applications: one line says where the documents go (an application you already have, chosen by link and then by company
// and role, or a new one), Save stores the application, the tailored resume and the letter in one go, and the done screen links onward.
import { useState } from "react";
import { useQuery } from "../../../app/useQuery";
import { InlineConfirm } from "../../../components/InlineConfirm";
import { Notice } from "../../../components/Notice";
import { useAction } from "../../../components/useAction";
import { dayText } from "../../../db/dayText";
import { normalizeSections } from "../../../db/documentShape";
import type { ApplicationRow, JobTrackerDB } from "../../../db/schema";
import { coverLetterMail } from "../../../sync/applicationActions";
import { letterSections, letterText } from "../../../sync/letter";
import type { FlowAction, FlowState, SavedJob } from "../flowState";
import type { StepsDeps } from "./deps";

interface Props {
  db: JobTrackerDB;
  flow: FlowState & { draft: NonNullable<FlowState["draft"]>; resume: NonNullable<FlowState["resume"]> };
  dispatch(a: FlowAction): void;
  deps: StepsDeps;
  onSaved(saved: SavedJob): void;
  onBack(): void;
}

const nameOf = (company: string, role: string) => [company.trim(), role.trim()].filter(Boolean).join(", ");
/** "Gringotts, Product Analyst (applied Sep 7)", or the stage when there is no applied day. */
const appLine = (a: ApplicationRow) => `${nameOf(a.company, a.role)} (${a.appliedAt ? `applied ${dayText(a.appliedAt, "short")}` : a.stage})`;
const docsLine = (d: { tailored: boolean; cover: boolean }) =>
  d.tailored && d.cover ? "a tailored resume and a cover letter" : d.tailored ? "a tailored resume" : "a cover letter";

export function StepAdd({ db, flow, dispatch, deps, onSaved, onBack }: Props) {
  const act = useAction();
  const [confirming, setConfirming] = useState(false);
  const { company, role, url, fromApp } = flow;
  const matches = useQuery(async () => {
    const found = await deps.jobMatches(db, { company: company.trim(), role: role.trim(), ...(url.trim() ? { url: url.trim() } : {}) });
    const from = fromApp !== null ? await db.applications.get(fromApp) : undefined;
    return from && !from.deletedAt && !found.some((a) => a.id === from.id) ? [from, ...found] : found;
  }, [db, company, role, url, fromApp]);
  const list = matches ?? [];
  const known = (id: number) => list.some((a) => a.id === id);
  const chosen: number | "new" =
    typeof flow.target === "number" && known(flow.target) ? flow.target
    : flow.target === "new" ? "new"
    : fromApp !== null && known(fromApp) ? fromApp
    : list[0]?.id ?? "new";
  const chosenApp = chosen === "new" ? undefined : list.find((a) => a.id === chosen);
  const existing = useQuery(async () => (chosen === "new" ? null : deps.existingDocs(db, chosen)), [db, chosen]);
  const letter = flow.letter && flow.letter.text.trim() ? letterSections(flow.letter.text, flow.letter.base) : null;
  const replaces = existing ? { tailored: existing.tailored, cover: existing.cover && letter !== null } : null;

  const save = () =>
    void act.run("save", async () => {
      setConfirming(false);
      const done = await deps.saveTailoredJob(db, {
        draft: { resume: normalizeSections(flow.resume), cover: letter, baselineId: flow.draft.baselineId, source: flow.byHand ? "copy" : "ai" },
        company: company.trim(), role: role.trim(), ...(url.trim() ? { url: url.trim() } : {}), posting: flow.posting,
        ...(chosen !== "new" ? { useId: chosen } : {}),
      });
      onSaved({ appId: done.appId, resumeId: done.resumeId, coverId: done.coverId, company: chosenApp?.company ?? company.trim(), letter: letter ? letterText(letter) : "" });
    });
  const ask = () => (replaces && (replaces.tailored || replaces.cover) ? setConfirming(true) : save());
  const pick = (target: number | "new") => dispatch({ type: "target", target });

  if (matches === undefined) return null;
  return (
    <>
      {!list.length ? (
        <p className="steps-where">Adds {nameOf(company, role)} to your applications (Applied, today).</p>
      ) : (
        <fieldset className="steps-where">
          <legend>{list.length === 1 ? `Already in your applications: ${appLine(list[0])}` : "Already in your applications:"}</legend>
          {list.length === 1 ? (
            <label className="steps-choice"><input type="radio" name="steps-target" checked={chosen === list[0].id} onChange={() => pick(list[0].id)} /> Use this one</label>
          ) : (
            list.map((a) => (
              <label key={a.id} className="steps-choice"><input type="radio" name="steps-target" checked={chosen === a.id} onChange={() => pick(a.id)} /> {appLine(a)}</label>
            ))
          )}
          <label className="steps-choice"><input type="radio" name="steps-target" checked={chosen === "new"} onChange={() => pick("new")} /> Add as new</label>
        </fieldset>
      )}
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}
      <div className="row steps-actions">
        <button type="button" className="primary" onClick={ask} disabled={act.busy !== null || confirming || existing === undefined} aria-busy={act.busy === "save" || undefined}>Save</button>
        <button type="button" onClick={onBack} disabled={act.busy !== null}>Back</button>
      </div>
      {confirming && replaces && chosenApp ? (
        <InlineConfirm title={`Replace what's saved for ${chosenApp.company}?`} help={`It already has ${docsLine(replaces)}.`} confirmLabel="Replace and save"
                       act={act} actionKey="save" onConfirm={save} onCancel={() => setConfirming(false)} />
      ) : null}
    </>
  );
}

/** After Save: where the documents went, and where to go next. */
export function StepDone({ db, saved, onAnother }: { db: JobTrackerDB; saved: SavedJob; onAnother(): void }) {
  return (
    <div className="row steps-actions">
      <a className="btn primary" href={`#/app/${saved.appId}`}>Open application</a>
      <a className="btn" href={`#/tailor/${saved.appId}`}>Edit in Tailor</a>
      <a className="btn" href={`#/resume/print/${saved.resumeId}`}>Print resume</a>
      {saved.letter ? <LetterDraft db={db} appId={saved.appId} letter={saved.letter} /> : null}
      <button type="button" onClick={onAnother}>Tailor another job</button>
    </div>
  );
}

/** "Draft letter in Gmail" (or Outlook): a new message in the same mailbox. Nothing when there is no mailbox to open it in. */
function LetterDraft({ db, appId, letter }: { db: JobTrackerDB; appId: number; letter: string }) {
  const mail = useQuery(() => coverLetterMail(db, appId, letter), [db, appId, letter]);
  const link = mail?.link;
  if (!link || !link.url.startsWith("https://")) return null;
  const service = link.label.replace("Draft in ", "");
  const label = `Draft letter in ${service}`;
  return (
    <a className="btn" href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`${label} (opens in a new tab)`}>{label}</a>
  );
}
