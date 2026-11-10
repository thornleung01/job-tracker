// Reads the job a person pasted on the Resume page: on the device first, and only when that finds neither the company nor the role, with
// one small AI call that sends the posting text alone (no resume, no names) with the person's own key. Saves nothing.
import { AiError, extractJobRequest, parseExtractReply, verifyExtract, type AiDeps, type Complete, type ExtractedJob } from "../ai";
import { readJobFromPaste, type PastedJob } from "../jobs/readJob";

export interface ReadJobDeps {
  ai?: AiDeps;
  /** replaces `ai.complete`, as in the other use cases */
  complete?: Complete;
  /** the person's database name, to find their key */
  db: string;
}

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === "AbortError";

/**
 * The pasted job, with `fromAi` true when the AI call filled a field. The call is made only when the device read neither the company nor
 * the role, there is posting text, and the key is unlocked; it fills blanks only, and keeps a value only when the posting contains it
 * (verifyExtract). An AI failure is not an error here: the fields stay empty for the person to type. The caller's abort is passed through.
 */
export async function readJob(text: string, url: string | undefined, deps: ReadJobDeps | null, signal?: AbortSignal): Promise<PastedJob & { fromAi: boolean }> {
  const job = readJobFromPaste(text, url);
  const heuristic = { ...job, fromAi: false };
  if (job.company || job.role || !job.description || !deps?.ai) return heuristic;
  const status = deps.ai.vault.status(deps.db);
  const key = deps.ai.vault.key(deps.db);
  if (status.state !== "unlocked" || key === null) return heuristic;

  const complete = deps.complete ?? deps.ai.complete;
  let found: ExtractedJob;
  try {
    const reply = await complete(key, extractJobRequest(job.description, status.model), { signal });
    found = verifyExtract(parseExtractReply(reply.json), job.description);
  } catch (e) {
    if (signal?.aborted || isAbort(e)) throw e;
    if (e instanceof AiError) return heuristic;
    throw e;
  }
  return { ...job, company: found.company, role: found.role, fromAi: Boolean(found.company || found.role) };
}
