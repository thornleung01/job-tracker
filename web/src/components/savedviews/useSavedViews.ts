import { useQuery } from "../../app/useQuery";
import type { JobTrackerDB } from "../../db/schema";
import { loadSavedViews, type SavedView } from "../../sync/savedViews";

/** This account's saved views, or undefined while they load. They change live when another tab saves one. */
export function useSavedViews(db: JobTrackerDB): SavedView[] | undefined {
  return useQuery(() => loadSavedViews(db), [db]);
}
