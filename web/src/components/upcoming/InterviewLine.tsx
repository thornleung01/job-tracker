import { dayLabel } from "../../sync/upcoming";
import "./upcoming.css";

/** The quiet line under a stage in the list: "Interview Thu, Oct 15", or "Interview today" and "Interview tomorrow". */
export function InterviewLine({ day, today }: { day: string | null; today: string }) {
  if (!day) return null;
  const label = dayLabel(day, today);
  const when = label === "Today" || label === "Tomorrow" ? label.toLowerCase() : label;
  return <span className="interview-line small muted">Interview {when}</span>;
}
