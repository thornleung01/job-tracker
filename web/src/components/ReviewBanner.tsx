import { Mail } from "lucide-react";
import { useQuery } from "../app/useQuery";
import type { JobTrackerDB } from "../db/schema";
import { reviewCount } from "../sync/queries";
import "./reviewbanner.css";

/** One quiet row above the applications list when mail waits in the review queue. Hidden when nothing waits. */
export function ReviewBanner({ db }: { db: JobTrackerDB }) {
  const n = useQuery(() => reviewCount(db), [db]);
  if (!n) return null;
  const text = n === 1 ? "1 email needs a look" : `${n} emails need a look`;
  return (
    <section className="review-banner">
      <Mail size={16} strokeWidth={3} aria-hidden="true" />
      <p>{text}</p>
      <a className="btn btn-small" href="#/review">Review emails</a>
    </section>
  );
}
