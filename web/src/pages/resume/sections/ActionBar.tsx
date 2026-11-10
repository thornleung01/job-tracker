// The bar under the split, sticky to the bottom of the screen while the split is on it. One line says where Save goes (an application you already
// have, or a new one: a choice appears only when there is one), Download makes the two PDFs from the draft as it is, and Save stores the
// application, the tailored resume and the letter in one go. Once saved, the bar says so and links onward until the draft is edited again.
import { useEffect, useState } from "react";
import { useQuery } from "../../../app/useQuery";
import { isLocalMode } from "../../../config";
import { DraftNeedsMailbox } from "../../../components/followup/DraftNeedsMailbox";
import { InlineConfirm } from "../../../components/InlineConfirm";
import { Notice } from "../../../components/Notice";
import { useAction } from "../../../components/useAction";
import { dayText } from "../../../db/dayText";
import { normalizeSections } from "../../../db/documentShape";
import type { ApplicationRow, JobTrackerDB } from "../../../db/schema";
import { coverLetterMail } from "../../../sync/applicationActions";
import { letterSections, letterText } from "../../../sync/letter";
import type { FlowAction, FlowState, SavedJob } from "../flowState";
import type { SectionDeps } from "./deps";

interface Props {
  db: JobTrackerDB;
  flow: FlowState & { draft: NonNullable<FlowState["draft"]>; resume: NonNullable<FlowState["resume"]> };
  /** the resume Save records the tailored one as based on: the draft's own, or the master when that one was deleted */
  baselineId: number;
  dispatch(a: FlowAction): void;
  deps: SectionDeps;
}

const nameOf = (company: string, role: string) => [company.trim(), role.trim()].filter(Boolean).join(", ");
/** "Gringotts, Product Analyst (applied Sep 7)", or the stage when there is no applied day. */
const appLine = (a: ApplicationRow) => `${nameOf(a.company, a.role)} (${a.appliedAt ? `applied ${dayText(a.appliedAt, "short")}` : a.stage})`;

export function ActionBar({ db, flow, baselineId, dispatch, deps }: Props) {
  const act = useAction();
  const [confirming, setConfirming] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const { company, role, url, fromApp, saved } = flow;
  const isSaved = saved !== null && !flow.dirty;
  const savedId = saved?.appId ?? null;

  // What a Download said (pages, characters) is about the draft as it was: an edit makes it stale.
  useEffect(() => setNotes([]), [flow.resume, flow.letter]);

  const matches = useQuery(async () => {
    const found = await deps.jobMatches(db, { company: company.trim(), role: role.trim(), ...(url.trim() ? { url: url.trim() } : {}) });
    const extra: ApplicationRow[] = [];
    for (const id of [fromApp, savedId]) {
      const row = id !== null ? await db.applications.get(id) : undefined;
      if (row && !row.deletedAt && !found.some((a) => a.id === row.id) && !extra.some((a) => a.id === row.id)) extra.push(row);
    }
    return [...extra, ...found];
  }, [db, company, role, url, fromApp, savedId]);
  const list = matches ?? [];
  const known = (id: number) => list.some((a) => a.id === id);
  const chosen: number | "new" =
    typeof flow.target === "number" && known(flow.target) ? flow.target
    : flow.target === "new" ? "new"
    : savedId !== null && known(savedId) ? savedId
    : fromApp !== null && known(fromApp) ? fromApp
    : list[0]?.id ?? "new";
  const chosenApp = chosen === "new" ? undefined : list.find((a) => a.id === chosen);
  const existing = useQuery(async () => (chosen === "new" ? null : deps.existingDocs(db, chosen)), [db, chosen]);
  const letter = flow.letter && flow.letter.text.trim() ? letterSections(flow.letter.text, flow.letter.base) : null;
  const replaces = existing ? { tailored: existing.tailored, cover: existing.cover && letter !== null } : null;
  // Saving again to the application this page just saved to is the person's own copy being updated, not something to ask about.
  const asks = replaces !== null && (replaces.tailored || replaces.cover) && chosen !== savedId;

  const save = () =>
    void act.run("save", async () => {
      setConfirming(false);
      const done = await deps.saveTailoredJob(db, {
        draft: { resume: normalizeSections(flow.resume), cover: letter, baselineId, source: flow.byHand ? "copy" : "ai" },
        company: company.trim(), role: role.trim(), ...(url.trim() ? { url: url.trim() } : {}), posting: flow.posting,
        ...(chosen !== "new" ? { useId: chosen } : {}),
      });
      const next: SavedJob = { appId: done.appId, resumeId: done.resumeId, coverId: done.coverId, company: chosenApp?.company ?? company.trim(), letter: letter ? letterText(letter) : "" };
      dispatch({ type: "saved", saved: next });
    });
  const ask = () => (asks ? setConfirming(true) : save());
  const pick = (target: number | "new") => dispatch({ type: "target", target });

  const download = () =>
    void act.run("download", async () => {
      const stem = nameOf(company, role);
      const files: { name: string; bytes: Uint8Array }[] = [];
      const said: string[] = [];
      const resume = await deps.resumePdf(normalizeSections(flow.resume), { title: stem });
      files.push({ name: deps.pdfFilename("Resume", company.trim(), role.trim()), bytes: resume.bytes });
      let replaced = resume.replacedChars;
      if (letter) {
        const cover = await deps.letterPdf(letter, { title: stem });
        files.push({ name: deps.pdfFilename("Cover letter", company.trim(), role.trim()), bytes: cover.bytes });
        replaced = replaced || cover.replacedChars;
      }
      await deps.downloadPdfs(files);
      if (resume.pages > 1) said.push(`Your resume runs to ${resume.pages} pages.`);
      if (replaced) said.push("Some characters couldn't go in the PDF.");
      setNotes(said);
    });

  if (matches === undefined) return null;
  const busy = act.busy !== null;
  const name = nameOf(company, role);

  let where;
  if (isSaved && saved) {
    where = (
      <p className="rs-where" role="status">
        <span>Saved to {saved.company}</span>
        <a href={`#/app/${saved.appId}`}>Open application</a>
        <a href={`#/tailor/${saved.appId}`}>Edit in Tailor</a>
        <button type="button" className="quiet rs-inline" onClick={() => dispatch({ type: "reset" })} disabled={busy}>Tailor another job</button>
      </p>
    );
  } else if (chosenApp && list.length > 1) {
    where = (
      <div className="rs-where rs-pick">
        <label htmlFor="rs-target">Save to</label>
        <select id="rs-target" value={chosen} onChange={(e) => pick(e.target.value === "new" ? "new" : Number(e.target.value))}>
          {list.map((a) => <option key={a.id} value={a.id}>{appLine(a)}</option>)}
          <option value="new">Add as new</option>
        </select>
      </div>
    );
  } else if (chosenApp) {
    where = (
      <p className="rs-where">
        <span>Saves to {nameOf(chosenApp.company, chosenApp.role)} (already in your applications)</span>
        <button type="button" className="quiet rs-inline" onClick={() => pick("new")} disabled={busy}>Add as new instead</button>
      </p>
    );
  } else if (list.length) {
    where = (
      <div className="rs-where rs-pick">
        <label htmlFor="rs-target">Save to</label>
        <select id="rs-target" value="new" onChange={(e) => pick(e.target.value === "new" ? "new" : Number(e.target.value))}>
          <option value="new">Add as new: {name}</option>
          {list.map((a) => <option key={a.id} value={a.id}>{appLine(a)}</option>)}
        </select>
      </div>
    );
  } else {
    where = <p className="rs-where">Adds {name} to your applications</p>;
  }

  return (
    <div className="rs-bar" role="group" aria-label="Save or download">
      {confirming && replaces && chosenApp ? (
        <InlineConfirm title="Replace the saved resume and letter?"
                       help={`${chosenApp.company} already has ${replaces.tailored && replaces.cover ? "a tailored resume and a cover letter" : replaces.tailored ? "a tailored resume" : "a cover letter"}.`}
                       confirmLabel="Replace and save" act={act} actionKey="save" onConfirm={save} onCancel={() => setConfirming(false)} />
      ) : null}
      <div className="rs-bar-row">
        {where}
        <div className="rs-bar-btns">
          <button type="button" onClick={download} disabled={busy} aria-busy={act.busy === "download" || undefined}>Download</button>
          <button type="button" className="primary" onClick={ask} disabled={busy || confirming || isSaved || existing === undefined} aria-busy={act.busy === "save" || undefined}>
            {isSaved ? "Saved" : "Save"}
          </button>
        </div>
      </div>
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}
      {notes.map((n) => <p key={n} className="muted small rs-note" role="status">{n}</p>)}
      {isSaved && saved?.letter ? <SavedMail db={db} appId={saved.appId} letter={saved.letter} /> : null}
    </div>
  );
}

/** "Draft letter in Gmail" (or Outlook): a new message in the same mailbox. With no mailbox to open it in, one muted line (nothing in the demo). */
function SavedMail({ db, appId, letter }: { db: JobTrackerDB; appId: number; letter: string }) {
  const mail = useQuery(() => coverLetterMail(db, appId, letter), [db, appId, letter]);
  const link = mail?.link;
  if (mail && !link) return isLocalMode() ? null : <p className="rs-note"><DraftNeedsMailbox /></p>;
  if (!link || !link.url.startsWith("https://")) return null;
  const service = link.label.replace("Draft in ", "");
  const label = `Draft letter in ${service}`;
  return (
    <p className="rs-note">
      <a className="btn" href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`${label} (opens in a new tab)`}>{label}</a>
    </p>
  );
}
