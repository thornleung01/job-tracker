import { useState } from "react";
import { useQuery } from "../../app/useQuery";
import type { JobTrackerDB } from "../../db/schema";
import { dayText } from "../../db/dayText";
import { deadlineWords, loadOffers } from "../../sync/offersView";
import "./offers.css";

const openKey = (dbName: string) => `jobtracker:offers-open:${dbName}`;

/** Whether the card was open earlier in this session. Closed when there is no record or storage is blocked. */
function readOpen(dbName: string): boolean {
  try {
    return sessionStorage.getItem(openKey(dbName)) === "1";
  } catch {
    return false;
  }
}
function writeOpen(dbName: string, open: boolean): void {
  try {
    sessionStorage.setItem(openKey(dbName), open ? "1" : "0");
  } catch {
    // blocked or full: it starts closed next time
  }
}

/**
 * "Compare offers": when two or more applications have an offer, a table of company, role, salary, decision deadline and stage date
 * above the list. Closed until opened, and it stays as you left it for the rest of the session (this tab). Salary is shown as typed.
 */
export function CompareOffers({ db }: { db: JobTrackerDB }) {
  const offers = useQuery(() => loadOffers(db), [db]);
  const [open, setOpen] = useState(() => readOpen(db.name));
  if (!offers?.length) return null;
  const toggle = () => {
    writeOpen(db.name, !open);
    setOpen(!open);
  };
  return (
    <section className="card compare-offers" aria-labelledby="compare-offers-title">
      <h2 className="compare-offers-title" id="compare-offers-title">
        <button type="button" className="compare-offers-toggle" aria-expanded={open} aria-controls="compare-offers-body" onClick={toggle}>
          <span className="chev" aria-hidden="true"></span>
          Compare offers <span className="muted small">{offers.length}</span>
        </button>
      </h2>
      <div id="compare-offers-body" hidden={!open}>
        {open ? (
          <div className="compare-offers-scroll">
            <table className="compare-offers-table">
              <thead>
                <tr><th scope="col">Company</th><th scope="col">Role</th><th scope="col">Salary</th><th scope="col">Decision deadline</th><th scope="col">Stage date</th></tr>
              </thead>
              <tbody>
                {offers.map((o) => (
                  <tr key={o.id}>
                    <th scope="row"><a href={`#/app/${o.id}`}>{o.company}</a></th>
                    <td>{o.role}</td>
                    <td>{o.salary || <span className="muted">Not set</span>}</td>
                    <td>
                      {o.deadline ? <>{dayText(o.deadline, "short")} <span className="muted small">{deadlineWords(o.daysLeft)}</span></> : <span className="muted">No deadline</span>}
                    </td>
                    <td className="small muted">{o.stageDay ? `${o.stage}, ${dayText(o.stageDay, "short")}` : o.stage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}
