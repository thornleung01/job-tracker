import type { DocSection } from "../../db/schema";
import { layoutLetter } from "./layout";
import { renderPdf, type PdfLib, type PdfResult } from "./render";

/** The cover letter: Times 11pt on one-inch margins. Fed pdf-lib by index.ts. */
export function renderLetter(lib: PdfLib, sections: readonly DocSection[], opts: { title?: string } = {}): Promise<PdfResult> {
  return renderPdf(lib, sections, (clean, measure) => layoutLetter(clean, measure), opts);
}
