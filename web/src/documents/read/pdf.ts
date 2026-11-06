// PDF text. pdf.js 6 has no eval path left (the isEvalSupported option is gone), so there is nothing to switch off. It is big, so it is loaded only when a PDF is chosen and ends up in its own chunk. Its worker is served from our own origin.
import { MAX_PDF_PAGES, MESSAGES, ReadError } from "./errors";

/** What pdf.js gives for a piece of text (marked-content markers come in the same list and have none of these). */
interface TextItem {
  str?: string;
  hasEOL?: boolean;
  transform?: readonly number[];
}
export interface PdfPageLike {
  getTextContent(): Promise<{ items: readonly object[] }>;
}
export interface PdfDocumentLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
  destroy?(): Promise<void>;
}
/** The one place pdf.js is touched, so a test can hand in a small stand-in. */
export type PdfOpener = (data: Uint8Array) => Promise<PdfDocumentLike>;

/** One page's text items as lines: a new line where pdf.js says the line ends or the text moves down the page. */
export function joinItems(items: readonly object[]): string {
  let out = "";
  let lastY: number | null = null;
  for (const item of items as readonly TextItem[]) {
    const y = item.transform?.[5];
    if (out && y !== undefined && lastY !== null && Math.abs(y - lastY) > 2 && !out.endsWith("\n")) out += "\n";
    if (y !== undefined) lastY = y;
    const str = item.str ?? "";
    out += str;
    if (item.hasEOL) out += "\n";
    else if (str && !str.endsWith(" ")) out += " ";
  }
  return out.split("\n").map((l) => l.trim()).join("\n");
}

/** The text of the first MAX_PDF_PAGES pages, a blank line between pages. */
export async function pdfText(doc: PdfDocumentLike): Promise<string> {
  const pages: string[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES); n++) {
    const page = await doc.getPage(n);
    pages.push(joinItems((await page.getTextContent()).items));
  }
  return pages.join("\n\n");
}

/** Opens the bytes with pdf.js: no scripts from the file, and a password-protected file refused. */
export const openWithPdfjs: PdfOpener = async (data) => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // A browser needs a worker file, and it comes from our own origin. Without Worker (a test in Node) pdf.js runs in this thread.
  if (typeof Worker !== "undefined") {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
  }
  try {
    return await pdfjs.getDocument({ data, enableXfa: false, verbosity: 0 }).promise;
  } catch (e) {
    if (e instanceof Error && e.name === "PasswordException") throw new ReadError(MESSAGES.encrypted);
    throw e;
  }
};

export async function readPdf(data: Uint8Array, open: PdfOpener = openWithPdfjs): Promise<string> {
  const doc = await open(data);
  try {
    return await pdfText(doc);
  } finally {
    void doc.destroy?.();
  }
}
