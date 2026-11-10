// Where the Resume page's job in progress is kept (session storage, one item per database). Here, and not in the page, so Settings and
// log out can clear it without importing a page.
const PREFIX = "jobtracker:resume-steps:";

export const flowKey = (dbName: string) => `${PREFIX}${dbName}`;

/** Removes the saved job for one database. Never throws: with no storage there is nothing to clear. */
export function clearFlow(dbName: string): void {
  try {
    sessionStorage.removeItem(flowKey(dbName));
  } catch {
    // nothing to clear
  }
}

/** Removes the saved job of every database, for log out, where the shell doesn't know which databases were open. */
export function clearAllFlows(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    // nothing to clear
  }
}
