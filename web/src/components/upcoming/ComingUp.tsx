import type { JobTrackerDB } from "../../db/schema";
import { localToday } from "../../db/time";
import { upcomingInterviewEvents } from "../../sync/applicationActions";
import { icsForInterviews } from "../../sync/ics";
import { plural } from "../../sync/text";
import { comingUp, dayWhen, resumeTitlesByApp, type UpcomingRow } from "../../sync/upcoming";
import { useQuery } from "../../app/useQuery";
import { downloadText } from "../../pages/settings/actions";
import { useAction } from "../useAction";
import { Notice } from "../Notice";
import { AddToCalendar, ICS_TYPE } from "./AddToCalendar";
import "./upcoming.css";

/**
 * Interviews in the next week, soonest first, each with an Add to calendar button, and one button under them that saves every
 * upcoming interview day. Renders nothing when there are none. Without `db` there is no download-all button.
 */
export function ComingUp({ rows, today, db }: { rows: readonly UpcomingRow[]; today: string; db?: JobTrackerDB }) {
  const act = useAction();
  const soon = comingUp(rows, today);
  // The resume sent comes from the database, so the list rows don't have to carry it; a row's own resumeTitle wins.
  const titles = useQuery(() => (db ? resumeTitlesByApp(db) : new Map<number, string>()), [db]);
  if (!soon.length) return null;

  const downloadAll = () => {
    if (!db) return;
    void act.run("all", async () => {
      const now = new Date();
      const events = await upcomingInterviewEvents(db, now);
      if (!events.length) return "No upcoming interviews to add.";
      downloadText(`job-tracker-interviews-${localToday(now)}.ics`, icsForInterviews(events, now), ICS_TYPE);
      return `Saved a calendar file with ${plural(new Set(events.map((e) => e.day)).size, "interview day")}.`;
    });
  };

  return (
    <section className="coming-up" aria-labelledby="coming-up-title">
      <h2 className="coming-up-title" id="coming-up-title">Coming up</h2>
      <ul className="coming-up-list">
        {soon.map((r) => {
          const sent = r.resumeTitle ?? titles?.get(r.id);
          return (
          <li key={r.id}>
            <a className="coming-up-row" href={`#/app/${r.id}`}>
              <strong className="coming-up-company">{r.company}</strong>{" "}
              {r.role ? <><span className="coming-up-role muted">{r.role}</span>{" "}</> : null}
              <span className="coming-up-day">{dayWhen(r.nextInterview!, today).text}</span>
              {sent ? <span className="coming-up-sent small muted">Sent: {sent}</span> : null}
            </a>
            <AddToCalendar
              label={`Add ${r.company} interview to calendar`}
              event={{ appId: r.id, company: r.company, role: r.role, stage: r.stage ?? "", day: r.nextInterview! }}
            />
          </li>
          );
        })}
      </ul>
      {db ? (
        <div className="coming-up-all">
          <button type="button" className="small" onClick={downloadAll} {...act.button("all")}>Download all upcoming interviews</button>
          <span className="small muted" role="status">{act.status ?? ""}</span>
          {act.error ? <Notice tone="err">{act.error}</Notice> : null}
        </div>
      ) : null}
    </section>
  );
}
