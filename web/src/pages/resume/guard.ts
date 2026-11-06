import { ActionError } from "../../db/errors";
import { DocumentError } from "../../sync/documents";

/** Runs a document action so a refusal (DocumentError) reaches the page with its own sentence instead of the generic one. */
export async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw e instanceof DocumentError ? new ActionError(e.message) : e;
  }
}
