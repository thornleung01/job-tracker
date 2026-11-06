import { GHOSTED_DAYS } from "../../sync/followUp";
import "./ghosted.css";

/** A quiet note beside the last-activity text, in place of "Follow up?": a month has passed with no reply, so the nudging stops. */
export function GhostedTag() {
  return <span className="ghosted-tag">No reply in {GHOSTED_DAYS} days</span>;
}
