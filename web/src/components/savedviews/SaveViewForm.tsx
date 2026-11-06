import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { SAVED_VIEWS_MAX, SAVED_VIEW_NAME_MAX } from "../../db/limits";
import type { JobTrackerDB } from "../../db/schema";
import { describeFilters, saveView, type ViewFilters } from "../../sync/savedViews";
import { Notice } from "../Notice";
import { useAction } from "../useAction";
import "./savedviews.css";

interface Props {
  db: JobTrackerDB;
  /** what would be saved: the filters as the form shows them and the current sort */
  filters: ViewFilters;
  /** how many views are kept already, so a full list says so before anything is typed */
  count: number;
  accountName?: string;
  resumeName?: string;
  onClose(): void;
}

/** The small form under the filter card that names the current filters and keeps them. Escape or Cancel closes it. */
export function SaveViewForm({ db, filters, count, accountName, resumeName, onClose }: Props) {
  const act = useAction();
  const [name, setName] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => field.current?.focus(), []);
  const summary = describeFilters(filters, accountName, resumeName);
  const full = count >= SAVED_VIEWS_MAX;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void act.run("save-view", async () => {
      await saveView(db, name, filters);
    }).then((ok) => ok && onClose());
  };
  return (
    <section className="card save-view" aria-labelledby={`${id}-title`}
             onKeyDown={(e) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); onClose(); } }}>
      <h2 className="section" id={`${id}-title`}>Save this view</h2>
      <p className="help">{summary ? `Saves: ${summary}.` : "There are no filters to save yet. Choose a stage, search or sort first."}</p>
      {full ? <Notice>You can keep {SAVED_VIEWS_MAX} saved views. Delete one to save another.</Notice> : null}
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}
      <form className="row save-view-form" onSubmit={submit}>
        <div className="fgroup f-grow">
          <label htmlFor={id}>Name</label>
          <input id={id} ref={field} name="view_name" value={name} maxLength={SAVED_VIEW_NAME_MAX} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </div>
        <button type="submit" className="primary" {...act.button("save-view")}>Save view</button>
        <button type="button" onClick={onClose} disabled={act.busy !== null}>Cancel</button>
      </form>
    </section>
  );
}
