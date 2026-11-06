import { Fragment, memo, type KeyboardEvent, type MouseEvent } from "react";
import { ApplicationPanel } from "../../components/ApplicationPanel";
import { RowSelect } from "../../components/bulk/SelectBoxes";
import { FollowUpTag } from "../../components/followup/FollowUpTag";
import { GhostedTag } from "../../components/ghosted/GhostedTag";
import { OfferDeadline } from "../../components/offer/OfferDeadline";
import { QuickDate } from "../../components/quickedit/QuickDate";
import { QuickRole } from "../../components/quickedit/QuickRole";
import { QuickStage } from "../../components/quickedit/QuickStage";
import { LastActivity } from "../../components/TimeText";
import { InterviewLine } from "../../components/upcoming/InterviewLine";
import type { JobTrackerDB } from "../../db/schema";
import type { ApplicationListRow } from "../../sync/queries";
import { whyMatched } from "../../sync/search";
import type { ColumnId } from "../../sync/settings";

interface Props {
  db: JobTrackerDB;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
  r: ApplicationListRow;
  columns: readonly ColumnId[];
  isOpen: boolean;
  selected: boolean;
  /** the keyboard is on this row (j and k move it): it is highlighted and marked for screen readers */
  current: boolean;
  /** the viewer's calendar day, the same for every row */
  today: string;
  /** the address of the list with this row opened or closed, for the company link */
  href: string;
  /** must be stable: it is how a row stays memoised while someone types or ticks a box */
  onToggleOpen: (id: number) => void;
  onToggleSelect: (id: number) => void;
}

/**
 * One application in the list, plus the panel under it. Everything it needs comes in as plain values and stable callbacks, and the
 * component is memoised, so ticking a box or typing in the add form redraws one row at most, not the whole table.
 */
export const AppRow = memo(function AppRow({ db, navigate, r, columns, isOpen, selected, current, today, href, onToggleOpen, onToggleSelect }: Props) {
  const onRowClick = (e: MouseEvent<HTMLTableRowElement>) => {
    // Clicking empty space in a row opens it too.
    if ((e.target as Element).closest("a, button, input, select, textarea, label, form")) return;
    onToggleOpen(r.id);
  };
  const onExpanderKey = (e: KeyboardEvent<HTMLAnchorElement>) => {
    if (e.key === " ") {
      e.preventDefault(); // role=button also answers to Space
      onToggleOpen(r.id);
    }
  };

  const why = whyMatched(r.match);
  const cell = (c: ColumnId) => {
    switch (c) {
      case "company":
        return (
          <td role="cell" data-col="company" key={c}>
            <a className="expander" href={href} role="button" data-id={r.id} aria-expanded={isOpen} aria-controls={`panel-${r.id}`}
               onClick={(e) => { e.preventDefault(); onToggleOpen(r.id); }} onKeyDown={onExpanderKey}>
              <span className="chev" aria-hidden="true"></span><strong>{r.company}</strong>
            </a>
            <span className="role-sub">{r.role}</span>
            {why ? <span className="match-why small muted">{why}</span> : null}
          </td>
        );
      case "role": return <td role="cell" data-col="role" key={c}><QuickRole db={db} appId={r.id} company={r.company} role={r.role} /></td>;
      case "stage":
        return (
          <td role="cell" data-col="stage" key={c} id={`stage-${r.id}`}>
            <QuickStage db={db} appId={r.id} company={r.company} stage={r.stage} stageAt={r.stageAt} locked={r.locked} />
            <InterviewLine day={r.nextInterview} today={today} />
            <OfferDeadline stage={r.stage} deadline={r.offerDeadline} />
          </td>
        );
      case "applied": return <td role="cell" data-col="applied" key={c} className="small muted"><QuickDate db={db} appId={r.id} company={r.company} appliedAt={r.appliedAt} /></td>;
      case "lastActivity":
        return <td role="cell" data-col="last_activity" key={c} id={`last-${r.id}`} className="small muted"><LastActivity iso={r.lastActivity} idleDays={r.idleDays} />{r.ghosted ? <> <GhostedTag /></> : r.followUp ? <> <FollowUpTag /></> : null}</td>;
      case "emails": return <td role="cell" data-col="emails" key={c} className="small muted">{r.nEmails}</td>;
      case "rounds": return <td role="cell" data-col="rounds" key={c} className="small muted">{r.rounds ?? ""}</td>;
    }
  };

  return (
    <Fragment>
      <tr className={`app-row${isOpen ? " is-open" : ""}${selected ? " is-selected" : ""}${current ? " is-current" : ""}`} role="row" data-id={r.id}
          aria-current={current ? "true" : undefined} onClick={onRowClick}>
        <td role="cell" data-col="select"><RowSelect id={r.id} company={r.company} checked={selected} onToggle={onToggleSelect} /></td>
        {columns.map(cell)}
      </tr>
      <tr className="panel-row" role="row" id={`panel-${r.id}`} data-id={r.id} hidden={!isOpen}>
        <td role="cell" colSpan={columns.length + 1}>
          {isOpen ? <div className="panel"><ApplicationPanel db={db} appId={r.id} company={r.company} includeEmails navigate={navigate} /></div> : null}
        </td>
      </tr>
    </Fragment>
  );
});
