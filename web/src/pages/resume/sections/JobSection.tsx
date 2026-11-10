// Job, the second section: the posting pasted in (left), then on the right an optional link, the company and role (read from the posting, marked to
// check until touched) and the posting's words; under both, a draft written with AI or a copy of the baseline to edit by hand. Nothing is saved here.
// Before there is a master it is one muted line that links to the way in.
import { useEffect, useId, useRef, useState } from "react";
import { PostingTerms } from "../../../components/documents/PostingTerms";
import { TailorAi, type WriteOptions } from "../../../components/documents/TailorAi";
import { useUnlock } from "../../../components/documents/useUnlock";
import { Gate } from "../../../components/Gate";
import { InlineConfirm } from "../../../components/InlineConfirm";
import { Notice } from "../../../components/Notice";
import { GATES } from "../../../app/gates";
import { useAction } from "../../../components/useAction";
import { parsePostingUrl, POSTING_URL_MESSAGE } from "../../../db/postingUrl";
import { MAX_COMPANY_CHARS, MAX_POSTING_CHARS, MAX_ROLE_CHARS, MAX_URL_CHARS } from "../../../db/limits";
import type { DocumentRow, JobTrackerDB } from "../../../db/schema";
import { parseJobUrl } from "../../../jobs";
import { readJobFromPaste } from "../../../jobs/readJob";
import { EMPTY_DRAFT } from "../../../jobs/types";
import type { FlowAction, FlowState } from "../flowState";
import type { SectionDeps } from "./deps";

interface Props {
  db: JobTrackerDB;
  flow: FlowState;
  dispatch(a: FlowAction): void;
  deps: SectionDeps;
  /** the resume the job is tailored from; undefined while there is no master */
  baseline: DocumentRow | undefined;
  /** writes the draft with AI (TailorAi runs it, so Stop works) */
  write(opts: WriteOptions): Promise<void>;
  /** copies the baseline to edit by hand */
  byHand(): Promise<void>;
}

export function JobSection(props: Props) {
  return (
    <section className="rs-section" aria-labelledby="rs-job-h">
      <h2 className="rs-h" id="rs-job-h" tabIndex={-1}>Job</h2>
      {props.baseline ? <JobForm {...props} baseline={props.baseline} /> : <p className="muted small rs-wait"><Gate gate="resume" /></p>}
    </section>
  );
}

function JobForm({ db, flow, dispatch, deps, baseline, write, byHand }: Props & { baseline: DocumentRow }) {
  const base = useId();
  const act = useAction();
  const reading = useRef<AbortController | null>(null);
  const pasted = useRef(false);
  const [readingAi, setReadingAi] = useState(false);
  const [replacing, setReplacing] = useState(false);
  // Unlocking happens beside the fields, so the vault is asked again (and the AI strip below starts over) once it has opened.
  const [unlocks, setUnlocks] = useState(0);
  useEffect(() => () => reading.current?.abort(), []);

  const company = flow.company.trim();
  const posting = flow.posting.trim();
  const keyState = deps.ai.vault.status(db.name).state;
  const noKey = keyState === "none";
  const busy = act.busy !== null;
  const guessed = flow.guessed.company || flow.guessed.role;
  const checkId = `${base}-check`;
  const whyId = `${base}-why`;
  // The same rule as saving an application's link (addApplication), so a bad link is caught here and not at Save.
  const linkBad = flow.url.trim() !== "" && parsePostingUrl(flow.url) === null;
  const linkId = `${base}-linkwhy`;
  const why = linkBad ? "Fix the job link to continue." : !company ? "Add the company to continue." : !posting ? GATES.posting.text : "";

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

  const unlockToRead = useUnlock(deps.ai.vault, db.name, () => {
    setUnlocks((n) => n + 1);
    void readPaste(flow.posting, { company: "", role: "" });
  });
  // The AI read after a paste can't run while the key is locked: say so, and open the key right here.
  const needsUnlockToRead = keyState === "locked" && posting !== "" && !flow.company.trim() && !flow.role.trim();

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
    <div className="card rs-card">
      <div className="rs-job">
        <div className="fgroup rs-posting">
          <label htmlFor={`${base}-posting`}>Paste the job description</label>
          <textarea
            id={`${base}-posting`} rows={10} value={flow.posting} maxLength={MAX_POSTING_CHARS}
            onPaste={() => { pasted.current = true; }} onChange={(e) => onPosting(e.target.value)}
          />
        </div>

        <div className="rs-side">
          <div className="rs-link">
            <div className="fgroup">
              <label htmlFor={`${base}-url`}>Job link (optional)</label>
              <input id={`${base}-url`} type="url" inputMode="url" value={flow.url} maxLength={MAX_URL_CHARS} aria-invalid={linkBad || undefined}
                     aria-describedby={linkBad ? linkId : undefined} onChange={(e) => dispatch({ type: "field", name: "url", value: e.target.value })} />
            </div>
            <button type="button" onClick={fillFromLink} disabled={busy || !flow.url.trim() || linkBad} aria-busy={act.busy === "link" || undefined}>Fill from link</button>
          </div>
          {linkBad ? <p className="muted small rs-why" id={linkId} role="status">{POSTING_URL_MESSAGE}</p> : null}

          <div className="rs-fields">
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
          <p className="muted small rs-check" id={checkId} role="status">{readingAi ? "Reading the company and role" : guessed ? "Check these" : ""}</p>

          <PostingTerms posting={flow.posting} sections={flow.resume ?? baseline.sections} company={flow.company} />
        </div>
      </div>

      {needsUnlockToRead ? (
        <form className="row rs-unlock" onSubmit={(e) => void unlockToRead.submit(e)}>
          <p className="muted small">Unlock your key to read these from the job.</p>
          <div className="fgroup">
            <label htmlFor={`${base}-pass`}>Key passphrase</label>
            <input id={`${base}-pass`} ref={unlockToRead.field} type="password" autoComplete="off" value={unlockToRead.passphrase}
                   onChange={(e) => unlockToRead.setPassphrase(e.target.value)} disabled={unlockToRead.unlocking} />
          </div>
          <button type="submit" disabled={unlockToRead.unlocking || !unlockToRead.passphrase} aria-busy={unlockToRead.unlocking || undefined}>Unlock</button>
        </form>
      ) : null}
      {unlockToRead.error ? <Notice tone="err">{unlockToRead.error}</Notice> : null}
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}
      {act.status ? <p className="muted small" role="status">{act.status}</p> : null}

      {/* once there is a draft, the split's strip has the one Rewrite with AI */}
      {flow.draft ? null : <TailorAi key={unlocks} dbName={db.name} ai={deps.ai} run={write} edited={false} disabled={busy || !company || !posting || linkBad} writeLabel="Write with AI" />}
      <div className="row rs-actions">
        <button type="button" className={noKey ? "primary" : undefined} onClick={startByHand} disabled={busy || !company || replacing || linkBad}
                aria-describedby={why ? whyId : undefined} aria-busy={act.busy === "hand" || undefined}>Start by hand</button>
      </div>
      {why ? <p className="muted small rs-why" id={whyId}>{why}</p> : null}
      {replacing ? (
        <InlineConfirm title="Replace your edits?" help="Your draft will be replaced by a copy of your resume." confirmLabel="Replace my edits" act={act} actionKey="hand"
                       onConfirm={() => { setReplacing(false); void act.run("hand", byHand); }} onCancel={() => setReplacing(false)} />
      ) : null}
    </div>
  );
}
