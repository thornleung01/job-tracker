import { liveQuery } from "dexie";
import { useEffect, useState } from "react";

/**
 * Run a read against the user's database and re-run it whenever the tables it touched change
 * (Dexie liveQuery). `undefined` means still loading; errors are thrown to the nearest error boundary.
 */
export function useQuery<T>(read: () => Promise<T> | T, deps: unknown[]): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    const sub = liveQuery(async () => read()).subscribe({ next: setValue, error: setError });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  if (error) throw error;
  return value;
}
