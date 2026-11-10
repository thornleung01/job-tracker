import { realAiDeps, type AiDeps } from "../../../ai";
import { downloadPdfs } from "../../../app/download";
import { letterPdf, pdfFilename, resumePdf } from "../../../documents/pdf";
import { enrichJobDraft } from "../../../jobs";
import { readJob } from "../../../sync/readJob";
import { draftFromBaseline, tailorForJob } from "../../../sync/tailor";
import { existingDocs, jobMatches, saveTailoredJob } from "../../../sync/tailorFlow";

/** What the page's sections reach outside the page for, so tests pass fakes. */
export interface SectionDeps {
  ai: AiDeps;
  readJob: typeof readJob;
  enrichJobDraft: typeof enrichJobDraft;
  tailorForJob: typeof tailorForJob;
  draftFromBaseline: typeof draftFromBaseline;
  jobMatches: typeof jobMatches;
  existingDocs: typeof existingDocs;
  saveTailoredJob: typeof saveTailoredJob;
  /** the PDF makers and the saver (pdf-lib loads inside them, on the first Download) */
  resumePdf: typeof resumePdf;
  letterPdf: typeof letterPdf;
  pdfFilename: typeof pdfFilename;
  downloadPdfs: typeof downloadPdfs;
}

export const realSectionDeps: SectionDeps = {
  ai: realAiDeps, readJob, enrichJobDraft, tailorForJob, draftFromBaseline, jobMatches, existingDocs, saveTailoredJob,
  resumePdf, letterPdf, pdfFilename, downloadPdfs,
};
