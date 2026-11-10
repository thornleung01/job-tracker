// PDF making, on the device. pdf-lib is loaded by `await import()` inside these functions, so it is its own chunk and never part of the app's entry.
import type { DocSection } from "../../db/schema";
import { renderLetter } from "./letterPdf";
import type { PdfResult } from "./render";
import { renderResume } from "./resumePdf";

export type { PdfResult } from "./render";

/** The resume in the classic one-page template; it continues on a second page if it runs over. */
export async function resumePdf(sections: readonly DocSection[], opts: { title?: string } = {}): Promise<PdfResult> {
  return renderResume(await import("pdf-lib"), sections, opts);
}

/** The cover letter, Times 11pt on one-inch margins. */
export async function letterPdf(sections: readonly DocSection[], opts: { title?: string } = {}): Promise<PdfResult> {
  return renderLetter(await import("pdf-lib"), sections, opts);
}

/** A name that every file system takes: no slashes, colons or other reserved characters, no control characters, one space between words. */
function cleanPart(s: string): string {
  return s
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[ .]+|[ .]+$/g, "")
    .slice(0, 60)
    .trim();
}

/** "Resume – Gringotts – Product Analyst.pdf". A missing company or an empty or unknown role is left out. */
export function pdfFilename(kind: "Resume" | "Cover letter", company: string, role: string): string {
  const parts = [company, role].map(cleanPart).filter((p) => p && p.toLowerCase() !== "unknown");
  return `${[kind, ...parts].join(" – ")}.pdf`;
}
