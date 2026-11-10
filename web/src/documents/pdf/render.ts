// Draws a Layout with pdf-lib's built-in Times fonts (nothing is embedded, so no font files ship). `lib` is the module, passed in so that
// only index.ts imports pdf-lib, and does it lazily.
import type { PDFFont } from "pdf-lib";
import type { DocSection } from "../../db/schema";
import { sanitiseSections } from "./encode";
import type { FontKey, Layout, Measure } from "./layout";

export type PdfLib = typeof import("pdf-lib");

export interface PdfResult { bytes: Uint8Array; pages: number; replacedChars: boolean }

/** Sanitises the sections, lays them out with real font metrics, and draws the result. */
export async function renderPdf(
  lib: PdfLib,
  sections: readonly DocSection[],
  layout: (clean: DocSection[], measure: Measure, title: string) => Layout,
  opts: { title?: string },
): Promise<PdfResult> {
  const { PDFDocument, StandardFonts, rgb } = lib;
  const doc = await PDFDocument.create();
  const fonts: Record<FontKey, PDFFont> = {
    regular: await doc.embedFont(StandardFonts.TimesRoman),
    bold: await doc.embedFont(StandardFonts.TimesRomanBold),
    italic: await doc.embedFont(StandardFonts.TimesRomanItalic),
  };
  // the title rides along as a heading so it is sanitised the same way
  const all = sanitiseSections([...sections, { id: "title", heading: opts.title ?? "", items: [] }]);
  const clean = all.sections.slice(0, -1);
  const title = all.sections[all.sections.length - 1].heading;
  const replacedChars = all.replacedChars;
  const laid = layout(clean, (font, size, text) => fonts[font].widthOfTextAtSize(text, size), title);
  if (title) doc.setTitle(title);
  doc.setProducer("Job Tracker");
  doc.setCreator("Job Tracker");
  for (const p of laid.pages) {
    const page = doc.addPage([laid.width, laid.height]);
    for (const r of p.rules) page.drawLine({ start: { x: r.x1, y: r.y }, end: { x: r.x2, y: r.y }, thickness: r.thickness, color: rgb(0, 0, 0) });
    for (const r of p.runs) page.drawText(r.text, { x: r.x, y: r.y, size: r.size, font: fonts[r.font], color: rgb(0, 0, 0) });
  }
  return { bytes: await doc.save(), pages: laid.pages.length, replacedChars };
}
