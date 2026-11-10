// Where the Resume page's job in progress is kept (session storage, one item per database). Here, and not in the page, so Settings and
// log out can clear it without importing a page.
const PREFIX = "jobtracker:resume-steps:";
/** Whether Your documents is open (one item per database); it goes with the saved job, so log out and Delete all my data leave neither behind. */
const DOCS_PREFIX = "jobtracker:resume-docs-open:";

export const flowKey = (dbName: string) => `${PREFIX}${dbName}`;
export const docsOpenKey = (dbName: string) => `${DOCS_PREFIX}${dbName}`;

/** Removes the saved job (and the open state of Your documents) for one database. Never throws: with no storage there is nothing to clear. */
export function clearFlow(dbName: string): void {
  try {
    sessionStorage.removeItem(flowKey(dbName));
    sessionStorage.removeItem(docsOpenKey(dbName));
  } catch {
    // nothing to clear
  }
}

/** Removes the saved job and the open state of Your documents of every database, for log out, where the shell doesn't know which databases were open. */
export function clearAllFlows(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(PREFIX) || key?.startsWith(DOCS_PREFIX)) keys.push(key);
    }
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    // nothing to clear
  }
}
