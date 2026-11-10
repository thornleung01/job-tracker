// Whether Your documents is open, kept in session storage per database so it is still open when the Print view's Back link returns to the page.
// It starts closed, and a reload in the same tab keeps what you chose. With no storage it simply starts closed each time.
import { docsOpenKey as key } from "../../app/resumeFlowStorage";

export function readDocsOpen(dbName: string): boolean {
  try {
    return sessionStorage.getItem(key(dbName)) === "1";
  } catch {
    return false;
  }
}

export function rememberDocsOpen(dbName: string, open: boolean): void {
  try {
    if (open) sessionStorage.setItem(key(dbName), "1");
    else sessionStorage.removeItem(key(dbName));
  } catch {
    // no storage: it lasts until the page is left
  }
}
