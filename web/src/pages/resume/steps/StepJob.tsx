// Step 2, The job: the posting pasted in, an optional link, the company and role (read from the posting, marked to check until touched), the
// posting's words, then a draft written with AI or a copy of the baseline to edit by hand. Nothing is saved here.
import { useEffect, useId, useRef, useState } from "react";
import { PostingTerms } from "../../../components/documents/PostingTerms";
import { TailorAi, type WriteOptions } from "../../../components/documents/TailorAi";
import { InlineConfirm } from "../../../components/InlineConfirm";
import { Notice } from "../../../components/Notice";
import { useAction } from "../../../components/useAction";
import { MAX_COMPANY_CHARS, MAX_POSTING_CHARS, MAX_ROLE_CHARS, MAX_URL_CHARS } from "../../../db/limits";
import type { DocumentRow, JobTrackerDB } from "../../../db/schema";
import { parseJobUrl } from "../../../jobs";
import { readJobFromPaste } from "../../../jobs/readJob";
import { EMPTY_DRAFT } from "../../../jobs/types";
import type { FlowAction, FlowState } from "../flowState";
import type { StepsDeps } from "./deps";

interface Props {
  db: JobTrackerDB;
  flow: FlowState;
  dispatch(a: FlowAction): void;
  deps: StepsDeps;
  baseline: DocumentRow;
  /** writes the draft with AI (TailorAi runs it, so Stop works) */
  write(opts: WriteOptions): Promise<void>;
  /** copies the baseline to edit by hand */
  byHand(): Promise<void>;
  onBackToReview(): void;
}

export function StepJob({ db, flow, dispatch, deps, baseline, write, byHand, onBackToReview }: Props) {
  const base = useId();
  const act = useAction();
  const reading = useRef<AbortController | null>(null);
  const pasted = useRef(false);
  const [readingAi, setReadingAi] = useState(false);
  const [replacing, setReplacing] = useState(false);
  useEffect(() => () => reading.current?.abort(), []);

  const company = flow.company.trim();
  const posting = flow.posting.trim();
  const noKey = deps.ai.vault.status(db.name).state === "none";
  const busy = act.busy !== null;
  const guessed = flow.guessed.company || flow.guessed.role;
  const checkId = `${base}-check`;
  const whyId = `${base}-why`;
  const why = !company ? "Add the company to continue." : !posting ? "Paste the job description to write with AI." : "";

  /** After a paste, the full read: the device's rules first, and one small AI call only when they found neither the company nor the role. */
  const readPaste = async (text: string, found: { company: string; role: string }) => {
    reading.current?.abort();
    const ask = new AbortController();
    reading.current = ask;
    const mayAsk = !found.company && !found.role && !flow.company.trim() && !flow.role.trim() && deps.ai.vault.status(db.name).state === "unlocked";
    if (mayAsk) setReadingAi(true);
    try {
      const read = await deps.readJob(text, flow.url.trim() || undefined, { ai: deps.ai, db: db.name }, ask.signal);
      if (!ask.signal.aborted) dispatch({ type: "fill", company: read.company, role: read.role });
    } catch {
      // the fields stay as they are: the person types them
    } finally {
      if (!ask.signal.aborted) setReadingAi(false);
    }
  };

  const onPosting = (value: string) => {
    const found = readJobFromPaste(value, flow.url.trim() || undefined);
    dispatch({ type: "posting", value, found: { company: found.company, role: found.role } });
    if (pasted.current) {
      pasted.current = false;
      void readPaste(value, found);
    }
  };

  const fillFromLink = () =>
    void act.run("link", async () => {
      const url = flow.url.trim();
      const fromLink = parseJobUrl(url) ?? { ...EMPTY_DRAFT, url };
      const read = await deps.enrichJobDraft(fromLink);
      dispatch({ type: "fill", company: read.company, role: read.role, posting: read.description });
      if (!read.description && !read.company && !read.role) return "Nothing could be read from that link. Paste the job description.";
      return read.description ? "Filled from the link." : "Filled the company and role. Paste the job description.";
    });

  const startByHand = () => {
    if (flow.draft && flow.edited) setReplacing(true);
    else void act.run("hand", byHand);
  };

  return (
    <>
      <div className="fgroup steps-posting">
        <label htmlFor={`${base}-posting`}>Paste the job description</label>
        <textarea
          id={`${base}-posting`} rows={10} value={flow.posting} maxLength={MAX_POSTING_CHARS}
          onPaste={() => { pasted.current = true; }} onChange={(e) => onPosting(e.target.value)}
        />
      </div>
      <PostingTerms posting={flow.posting} sections={baseline.sections} company={flow.company} />

      <div className="row steps-link">
        <div className="fgroup">
          <label htmlFor={`${base}-url`}>Job link (optional)</label>
          <input id={`${base}-url`} type="url" inputMode="url" value={flow.url} maxLength={MAX_URL_CHARS} onChange={(e) => dispatch({ type: "field", name: "url", value: e.target.value })} />
        </div>
        <button type="button" onClick={fillFromLink} disabled={busy || !flow.url.trim()} aria-busy={act.busy === "link" || undefined}>Fill from link</button>
      </div>

      <div className="steps-fields">
        <div className="fgroup">
          <label htmlFor={`${base}-company`}>Company</label>
          <input id={`${base}-company`} type="text" value={flow.company} maxLength={MAX_COMPANY_CHARS} autoComplete="off"
                 aria-describedby={flow.guessed.company ? checkId : undefined} onChange={(e) => dispatch({ type: "field", name: "company", value: e.target.value })} />
        </div>
        <div className="fgroup">
          <label htmlFor={`${base}-role`}>Role</label>
          <input id={`${base}-role`} type="text" value={flow.role} maxLength={MAX_ROLE_CHARS} autoComplete="off"
                 aria-describedby={flow.guessed.role ? checkId : undefined} onChange={(e) => dispatch({ type: "field", name: "role", value: e.target.value })} />
        </div>
      </div>
      <p className="muted small steps-check" id={checkId} role="status">{readingAi ? "Reading the company and role" : guessed ? "Check these" : ""}</p>

      {act.error ? <Notice tone="err">{act.error}</Notice> : null}
      {act.status ? <p className="muted small" role="status">{act.status}</p> : null}

      <TailorAi dbName={db.name} ai={deps.ai} run={write} edited={flow.draft !== null && flow.edited} disabled={busy || !company || !posting} writeLabel="Write my resume and letter" />
      <div className="row steps-actions">
        <button type="button" className={noKey ? "primary" : undefined} onClick={startByHand} disabled={busy || !company || replacing}
                aria-describedby={!company ? whyId : undefined} aria-busy={act.busy === "hand" || undefined}>Start by hand</button>
        {flow.draft ? <button type="button" onClick={onBackToReview} disabled={busy}>Back to review</button> : null}
      </div>
      {why ? <p className="muted small steps-why" id={whyId}>{why}</p> : null}
      {replacing ? (
        <InlineConfirm title="Replace your edits?" help="Your draft will be replaced by a copy of your resume." confirmLabel="Replace my edits" act={act} actionKey="hand"
                       onConfirm={() => { setReplacing(false); void act.run("hand", byHand); }} onCancel={() => setReplacing(false)} />
      ) : null}
    </>
  );
}
