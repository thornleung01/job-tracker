import type { DocSection } from "../../db/schema";
import { layoutResume } from "./layout";
import { renderPdf, type PdfLib, type PdfResult } from "./render";

/** The resume in the classic template. Fed pdf-lib by index.ts. */
export function renderResume(lib: PdfLib, sections: readonly DocSection[], opts: { title?: string } = {}): Promise<PdfResult> {
  return renderPdf(lib, sections, (clean, measure, title) => layoutResume(clean, measure, { title }), opts);
}
