import { useEffect, useState } from "react";
import { isSyncing } from "../sync/syncLock";

/** How often the lock is looked at. The lock is a plain flag with nothing to subscribe to, and a sync lasts seconds. */
const POLL_MS = 500;

/** True while a mailbox sync runs. */
export function useSyncing(): boolean {
  const [syncing, setSyncing] = useState(isSyncing);
  useEffect(() => {
    setSyncing(isSyncing());
    const timer = setInterval(() => setSyncing(isSyncing()), POLL_MS);
    return () => clearInterval(timer);
  }, []);
  return syncing;
}
