// PLACEHOLDER: replaced by the convert agent. Turns a resume's text into the template's sections with AI, then checks the result against the text.
import { AiError, type AiDeps, type AiModel } from "../ai";
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
  _text: string, _deps: AiDeps, _options: { db: string; model?: AiModel; signal?: AbortSignal },
): Promise<ConvertResult> {
  throw new AiError("badReply");
}
