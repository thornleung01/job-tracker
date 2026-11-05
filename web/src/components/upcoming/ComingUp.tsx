import { comingUp, dayWhen, type UpcomingRow } from "../../sync/upcoming";
import "./upcoming.css";

/** Interviews in the next week, soonest first. Renders nothing when there are none. */
export function ComingUp({ rows, today }: { rows: readonly UpcomingRow[]; today: string }) {
  const soon = comingUp(rows, today);
  if (!soon.length) return null;
  return (
    <section className="coming-up" aria-labelledby="coming-up-title">
      <h2 className="coming-up-title" id="coming-up-title">Coming up</h2>
      <ul className="coming-up-list">
        {soon.map((r) => (
          <li key={r.id}>
            <a className="coming-up-row" href={`#/app/${r.id}`}>
              <strong className="coming-up-company">{r.company}</strong>{" "}
              {r.role ? <><span className="coming-up-role muted">{r.role}</span>{" "}</> : null}
              <span className="coming-up-day">{dayWhen(r.nextInterview!, today).text}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
