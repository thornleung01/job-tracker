// Turns a resume's text into the template's sections with AI, then checks the result against the text. Nothing here saves anything: the
// person reviews the result first, and saving is the page's job. This code has no database access, only the database's name (for the vault).
import { convertRequest } from "../ai/prompts";
import { buildSections, checkAgainstSource, parseConvertReply } from "../ai/verify";
import { AiError, DEFAULT_MODEL, type AiDeps, type AiModel } from "../ai";
import { ActionError } from "../db/errors";
import { MAX_AI_INPUT_CHARS } from "../db/limits";
import type { DocSection } from "../db/schema";

/** A line the person should look at before saving: `detail` is a number, date or name that isn't in the source text, `label` a made-up bullet label. */
export interface ConvertFlag {
  itemId: string;
  kind: "detail" | "label";
  note: string;
}

export interface ConvertResult {
  /** the template's sections, already through normalizeSections */
  sections: DocSection[];
  flags: ConvertFlag[];
  /** words from the source text that appear nowhere in the result, so nothing disappears silently */
  unused: string[];
}

export async function convertResume(
  text: string, deps: AiDeps, options: { db: string; model?: AiModel; signal?: AbortSignal },
): Promise<ConvertResult> {
  if (!text.trim()) throw new ActionError("There's no text to convert.");
  if (text.length > MAX_AI_INPUT_CHARS) throw new AiError("tooLong");
  const { db, signal } = options;
  const key = deps.vault.key(db);
  const status = deps.vault.status(db);
  if (key === null) throw new AiError(status.state === "none" ? "noKey" : "locked");
  const model = options.model ?? (status.state === "none" ? undefined : status.model) ?? DEFAULT_MODEL;
  const reply = await deps.complete(key, convertRequest(text, model), { signal });
  const sections = buildSections(parseConvertReply(reply.json));
  return { sections, ...checkAgainstSource(text, sections) };
}
