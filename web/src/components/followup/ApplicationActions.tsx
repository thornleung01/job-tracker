import type { JobTrackerDB } from "../../db/schema";
import { useQuery } from "../../app/useQuery";
import { applicationActions } from "../../sync/applicationActions";
import { dayWhen } from "../../sync/upcoming";
import { localToday } from "../../db/time";
import { AddToCalendar } from "../upcoming/AddToCalendar";
import { DraftFollowUp } from "./DraftFollowUp";
import "./followup.css";
import "../upcoming/upcoming.css";

/**
 * What an application offers outside the app: one line per upcoming interview day with Add to calendar, and Draft follow-up,
 * which opens a new unsent message in the account's own mail service. Shows nothing it can't do (no mail service means no
 * draft button, no interview means no line).
 */
export function ApplicationActions({ db, appId }: { db: JobTrackerDB; appId: number }) {
  // No keepPrevious: when `appId` changes, the other application's draft link (its recipient and text) must not stay on the page while this one loads.
  const data = useQuery(() => applicationActions(db, appId), [db, appId]);
  if (!data || (!data.draft && !data.interviews.length)) return null;
  const today = localToday();
  return (
    <div className="app-actions">
      {data.interviews.map((e) => {
        const { when, text } = dayWhen(e.day, today);
        return (
          <div className="app-interview" key={e.day}>
            <span className="small muted">Interview {when === "later" ? text : when}</span>
            <AddToCalendar event={e} label={`Add interview on ${text} to calendar`} />
          </div>
        );
      })}
      {data.draft ? <DraftFollowUp link={data.draft} to={data.to} primary={data.needsFollowUp} /> : null}
    </div>
  );
}
