import { realAiDeps, type AiDeps } from "../../../ai";
import { enrichJobDraft } from "../../../jobs";
import { readJob } from "../../../sync/readJob";
import { draftFromBaseline, tailorForJob } from "../../../sync/tailor";
import { existingDocs, jobMatches, saveTailoredJob } from "../../../sync/tailorFlow";

/** What the four steps reach outside the page for, so tests pass fakes. */
export interface StepsDeps {
  ai: AiDeps;
  readJob: typeof readJob;
  enrichJobDraft: typeof enrichJobDraft;
  tailorForJob: typeof tailorForJob;
  draftFromBaseline: typeof draftFromBaseline;
  jobMatches: typeof jobMatches;
  existingDocs: typeof existingDocs;
  saveTailoredJob: typeof saveTailoredJob;
}

export const realStepsDeps: StepsDeps = { ai: realAiDeps, readJob, enrichJobDraft, tailorForJob, draftFromBaseline, jobMatches, existingDocs, saveTailoredJob };
