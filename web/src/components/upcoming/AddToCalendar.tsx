import { downloadText } from "../../app/download";
import { icsFilename, icsForInterviews, type IcsEvent } from "../../sync/ics";
import { useSavedNotice } from "./useSavedNotice";
import "./upcoming.css";

/** The type the browser needs to offer a calendar file to the calendar app. */
export const ICS_TYPE = "text/calendar;charset=utf-8";

interface Props {
  /** the interview day to save; the file is made here, on this device, when the button is pressed */
  event: IcsEvent;
  /** names the interview for screen readers ("Add Acme interview to calendar") */
  label?: string;
}

/** Saves one interview day as a calendar file. The app only writes the file: nothing is sent anywhere. */
export function AddToCalendar({ event, label }: Props) {
  const [notice, saved] = useSavedNotice();
  const save = () => {
    downloadText(icsFilename(event.day), icsForInterviews([event], new Date()), ICS_TYPE);
    saved();
  };
  return (
    <>
      <button type="button" className="small add-to-calendar" aria-label={label} onClick={save}>Add to calendar</button>
      <span className="sr" role="status">{notice}</span>
    </>
  );
}
