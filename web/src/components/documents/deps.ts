import { realAiDeps, type AiDeps } from "../../ai";
import { enrichJobDraft } from "../../jobs";
import { saveTailorDraft, tailorForApplication } from "../../sync/tailor";

/** What the Documents section reaches outside the database for, so tests pass fakes (the same pattern as JobLinkDeps and SettingsDeps). */
export interface DocumentsDeps {
  ai: AiDeps;
  tailor: typeof tailorForApplication;
  save: typeof saveTailorDraft;
  enrichJobDraft: typeof enrichJobDraft;
}

export const realDocumentsDeps: DocumentsDeps = { ai: realAiDeps, tailor: tailorForApplication, save: saveTailorDraft, enrichJobDraft };
