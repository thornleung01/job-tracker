import { ActionError } from "../../db/errors";
import { DocumentError } from "../../sync/documents";

/**
 * Runs a document action so that a DocumentError's own sentence ("You can keep 5 resume versions. Delete one to make another.")
 * reaches the page's notice: useAction only shows the message of an ActionError, and says "Couldn't finish that" for the rest.
 */
export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw e instanceof DocumentError ? new ActionError(e.message) : e;
  }
}
