import { useEffect, useState } from "react";
import type { JobTrackerDB } from "../../db/schema";
import { findDuplicates, type DuplicateMatch } from "../../sync/duplicates";

/** How long the fields must sit still before the lookup runs. */
export const DUPLICATES_DEBOUNCE_MS = 300;

/**
 * The applications that match what is typed in the add form. The lookup waits until typing pauses, and an answer that
 * arrives after the fields changed again is dropped. Nothing is looked up while `enabled` is false or the fields are blank.
 */
export function useDuplicates(db: JobTrackerDB, company: string, role: string, url: string, enabled = true): DuplicateMatch[] {
  const [matches, setMatches] = useState<DuplicateMatch[]>([]);
  useEffect(() => {
    if (!enabled || !(company.trim() || url.trim())) {
      setMatches((m) => (m.length ? [] : m));
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      findDuplicates(db, company, role, url).then(
        (found) => {
          if (!stale) setMatches(found);
        },
        () => {
          if (!stale) setMatches([]);   // a lookup that fails is just no notice: saving still works
        },
      );
    }, DUPLICATES_DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [db, company, role, url, enabled]);
  return matches;
}
