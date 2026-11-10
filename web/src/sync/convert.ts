// Turns a resume's text into the template's sections with AI, then checks the result against the text. Nothing here saves anything: the
// person reviews the result first, and saving is the page's job. This code has no database access, only the database's name (for the vault).
import {
  AiError, DEFAULT_MODEL, buildSections, checkAgainstSource, convertRequest, parseConvertReply,
  type AiDeps, type AiModel, type ConvertFlag, type VaultStatus,
} from "../ai";
import { ActionError } from "../db/errors";
import { convertTooLong } from "../db/limits";
import type { DocSection } from "../db/schema";

// The page imports the flag type from here.
export type { ConvertFlag };

export interface ConvertResult {
  /** the template's sections, already through normalizeSections */
  sections: DocSection[];
  flags: ConvertFlag[];
  /** words from the source text that appear nowhere in the result, so nothing disappears silently */
  unused: string[];
}

/** The model asked for, else the one saved with the key, else the default. */
function modelFor(status: VaultStatus, requested: AiModel | undefined): AiModel {
  if (requested) return requested;
  return status.state === "none" ? DEFAULT_MODEL : status.model;
}

/**
 * Converts `text` (a resume's extracted text) into the template's sections with the person's own key, and compares the result with the text.
 * Throws an ActionError for empty text and an AiError for everything the AI side can say (no key, locked, a refusal, a reply that can't be
 * read), or the caller's own abort unchanged. `options.db` is only the database's name, to find the key.
 */
export async function convertResume(
  text: string, deps: AiDeps, options: { db: string; model?: AiModel; signal?: AbortSignal },
): Promise<ConvertResult> {
  if (!text.trim()) throw new ActionError("There's no text to convert.");
  // This is the check the person sees, before anything is billed: the client's own limit is the backstop.
  if (convertTooLong(text)) throw new AiError("convertTooLong");
  const { db, signal } = options;
  const key = deps.vault.key(db);
  const status = deps.vault.status(db);
  if (key === null) throw new AiError(status.state === "none" ? "noKey" : "locked");
  const reply = await deps.complete(key, convertRequest(text, modelFor(status, options.model)), { signal });
  const sections = buildSections(parseConvertReply(reply.json));
  return { sections, ...checkAgainstSource(text, sections) };
}
