// The job a person pasted on the Resume page: the company and role read from the text (guesses, see paste.ts), the cleaned link, and the
// posting itself as plain text. Pure: nothing here leaves the device.
import { parsePastedText } from "./paste";
import { postingText } from "./posting";
import { cleanJobUrl } from "./url";

export interface PastedJob {
  company: string;
  role: string;
  /** the cleaned posting link, when there is one */
  url?: string;
  /** the posting as plain text, cut to MAX_POSTING_CHARS */
  description: string;
}

const isBareLink = (text: string): boolean => /^https?:\/\/\S+$/i.test(text.trim());

/**
 * Reads a pasted posting. A JSON-LD JobPosting in the text wins (and its description, when it has one); otherwise company and role are
 * guessed from the first lines. A field that can't be read is "". The description is the whole paste as plain text, however short.
 */
export function readJobFromPaste(text: string, url?: string): PastedJob {
  const input = typeof text === "string" ? text : "";
  const draft = parsePastedText(input, url);
  const link = draft?.url || cleanJobUrl(url ?? "");
  const description = draft?.description || (isBareLink(input) ? "" : postingText(input));
  return { company: draft?.company ?? "", role: draft?.role ?? "", ...(link ? { url: link } : {}), description };
}
