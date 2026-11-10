import { Ellipsis } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { SAVED_VIEW_NAME_MAX } from "../../db/limits";
import type { JobTrackerDB } from "../../db/schema";
import { deleteView, describeFilters, renameView, type SavedView } from "../../sync/savedViews";
import { InlineConfirm } from "../InlineConfirm";
import { Notice } from "../Notice";
import { useAction } from "../useAction";
import "./savedviews.css";

interface Props {
  db: JobTrackerDB;
  views: readonly SavedView[];
  /** the list's address (the filters and the sort, never the open rows) as it is now, to mark the chip that is showing */
  currentUrl: string;
  /** the address a view stands for */
  urlFor(view: SavedView): string;
  navigate(to: string): void;
  accountName(id: number): string | undefined;
  /** the title of a resume version, for the chip's tooltip */
  resumeName?(id: string): string | undefined;
}

/**
 * The saved views as chips above the list. A chip is a link to the view's address (so the back button and a reload work). Each
 * has an options button that opens Rename and Delete in place; Delete asks first.
 */
export function ViewChips({ db, views, currentUrl, urlFor, navigate, accountName, resumeName }: Props) {
  const [menu, setMenu] = useState<number | null>(null);
  // What was just deleted, said in the status line under the chips, and the place focus goes (a chip's options button or the line itself).
  const [deleted, setDeleted] = useState("");
  const [focusAt, setFocusAt] = useState<{ n: number; id: string } | null>(null);
  const statusId = useId();
  useEffect(() => {
    if (focusAt) document.getElementById(focusAt.id)?.focus();
  }, [focusAt]);
  // A view saved after that makes the line stale.
  const count = useRef(views.length);
  useEffect(() => {
    if (views.length > count.current) setDeleted("");
    count.current = views.length;
  }, [views.length]);
  if (!views.length && !deleted) return null;
  const onChoose = (e: MouseEvent<HTMLAnchorElement>, view: SavedView) => {
    // a click with a modifier (open in a new tab) is left to the browser
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(urlFor(view));
  };
  const open = views.find((v) => v.id === menu);
  // The deleted chip's focused button goes with it: focus moves to the chip after it (or before it), or to the status line when it was the last.
  const afterDelete = (view: SavedView) => {
    const i = views.findIndex((v) => v.id === view.id);
    const neighbour = views[i + 1] ?? views[i - 1];
    setDeleted(`Deleted the view "${view.name}".`);
    setMenu(null);
    setFocusAt((was) => ({ n: (was?.n ?? 0) + 1, id: neighbour ? `view-menu-${neighbour.id}` : statusId }));
  };
  return (
    <>
      {views.length ? (
        <nav className="view-chips" aria-label="Saved views">
          <ul className="view-chip-list">
            {views.map((v) => {
              const active = urlFor(v) === currentUrl;
              return (
                <li className="view-chip" key={v.id}>
                  <a className="view-chip-link" href={"#" + urlFor(v)} aria-current={active ? "true" : undefined} title={describeFilters(v, accountName(v.account), resumeName?.(v.resume ?? ""))} onClick={(e) => onChoose(e, v)}>{v.name}</a>
                  <button type="button" className="view-chip-menu" id={`view-menu-${v.id}`} aria-label={`Options for ${v.name}`} aria-expanded={menu === v.id} aria-controls={`view-options-${v.id}`}
                          onClick={() => { setDeleted(""); setMenu(menu === v.id ? null : v.id); }}>
                    <Ellipsis size={16} strokeWidth={3} aria-hidden="true" focusable="false" />
                  </button>
                </li>
              );
            })}
          </ul>
          {open ? <ViewOptions key={open.id} db={db} view={open} onClose={() => setMenu(null)} onDeleted={afterDelete} /> : null}
        </nav>
      ) : null}
      <p className="view-chips-status small muted" id={statusId} role="status" tabIndex={-1}>{deleted}</p>
    </>
  );
}

function ViewOptions({ db, view, onClose, onDeleted }: { db: JobTrackerDB; view: SavedView; onClose(): void; onDeleted(view: SavedView): void }) {
  const act = useAction();
  const [name, setName] = useState(view.name);
  const [asking, setAsking] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const del = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => field.current?.focus(), []);
  // Close it and put focus back on the chip's options button.
  const close = () => {
    onClose();
    queueMicrotask(() => document.getElementById(`view-menu-${view.id}`)?.focus());
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !e.defaultPrevented && act.busy === null) {
      e.preventDefault();
      close();
    }
  };
  const rename = (e: FormEvent) => {
    e.preventDefault();
    void act.run("rename-view", async () => {
      await renameView(db, view.id, name);
    }).then((ok) => ok && close());
  };
  const remove = () => {
    void act.run("delete-view", async () => {
      await deleteView(db, view.id);
    }).then((ok) => ok && onDeleted(view));
  };
  return (
    <div className="view-options" role="group" id={`view-options-${view.id}`} aria-label={`Options for ${view.name}`} onKeyDown={onKey}>
      {act.error ? <Notice tone="err">{act.error}</Notice> : null}
      <form className="row" onSubmit={rename}>
        <div className="fgroup f-grow">
          <label htmlFor={id}>Name</label>
          <input id={id} ref={field} name="view_name" value={name} maxLength={SAVED_VIEW_NAME_MAX} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </div>
        <button type="submit" {...act.button("rename-view")}>Rename</button>
        <button type="button" className="danger" ref={del} disabled={act.busy !== null} onClick={() => setAsking(true)}>Delete view</button>
        <button type="button" onClick={close} disabled={act.busy !== null}>Close</button>
      </form>
      {asking ? (
        <InlineConfirm title={`Delete the view "${view.name}"?`} help="Your applications aren't touched." confirmLabel="Delete view" act={act} actionKey="delete-view"
                       opener={del.current} onConfirm={remove} onCancel={() => setAsking(false)} />
      ) : null}
    </div>
  );
}
