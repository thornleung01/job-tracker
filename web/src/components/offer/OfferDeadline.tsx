import { safeOfferDeadline } from "../../db/offer";
import type { Stage } from "../../db/stages";
import { dayText } from "../TimeText";
import "./offer.css";

/** The quiet line under the stage in the list: "Decision by Oct 15". Only for an application at Offer that has a deadline. */
export function OfferDeadline({ stage, deadline }: { stage: Stage; deadline: string | undefined }) {
  const day = safeOfferDeadline(deadline);
  if (stage !== "Offer" || !day) return null;
  return <span className="offer-deadline small muted">Decision by {dayText(day, "short")}</span>;
}
