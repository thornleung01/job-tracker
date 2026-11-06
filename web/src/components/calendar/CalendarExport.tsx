import { downloadText } from "../../pages/settings/actions";
import type { CalendarEvent } from "../../sync/calendar";
import { icsForInterviews, type IcsEvent } from "../../sync/ics";
import { ICS_TYPE } from "../upcoming/AddToCalendar";
import { useSavedNotice } from "../upcoming/useSavedNotice";

/** The interviews among a set of events, in the shape the calendar file wants. */
export const interviewsOf = (events: readonly CalendarEvent[]): IcsEvent[] =>
  events.filter((e) => e.kind === "interview").map((e) => ({ appId: e.appId, company: e.company, role: e.role, stage: e.stage, day: e.day }));

interface Props {
  /** the events to look in: only the interviews go into the file */
  events: readonly CalendarEvent[];
  /** a YYYY-MM-DD for one day's file, a YYYY-MM for the month's */
  period: string;
  label: string;
}

/** Saves interview days as a calendar file, made on this device when the button is pressed. Renders nothing when there are no interviews. */
export function CalendarExport({ events, period, label }: Props) {
  const [notice, saved] = useSavedNotice();
  const interviews = interviewsOf(events);
  if (!interviews.length) return null;
  const save = () => {
    downloadText(`job-tracker-interviews-${period}.ics`, icsForInterviews(interviews, new Date()), ICS_TYPE);
    saved();
  };
  return (
    <>
      <button type="button" className="cal-export" onClick={save}>{label}</button>
      <span className="cal-sr" role="status">{notice}</span>
    </>
  );
}
