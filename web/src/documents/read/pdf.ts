// PDF text. pdf.js 6 has no eval path left (the isEvalSupported option is gone), so there is nothing to switch off. It is big, so it is loaded only when a PDF is chosen and ends up in its own chunk. Its worker is served from our own origin.
import { MAX_PDF_PAGES, MESSAGES, ReadError } from "./errors";

/** What pdf.js gives for a piece of text (marked-content markers come in the same list and have none of these). */
interface TextItem {
  str?: string;
  hasEOL?: boolean;
  width?: number;
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

/** A gap wider than this many average characters between two items on a line is where text was right-aligned or put in a column. */
const GAP_CHARS = 3;

/**
 * One page's text items as lines: a new line where pdf.js says the line ends or the text moves down the page. Where two items on the same
 * line are far apart, a tab is kept between them, so right-aligned text (a location, dates) can be told from the text beside it.
 */
export function joinItems(items: readonly object[]): string {
  let out = "";
  let lastY: number | null = null;
  let lastEnd: number | null = null; // where the previous item on this line stopped
  let charWidth = 0; // the average character width of the last item that had text
  for (const item of items as readonly TextItem[]) {
    const y = item.transform?.[5];
    const x = item.transform?.[4];
    const str = item.str ?? "";
    if (out && y !== undefined && lastY !== null && Math.abs(y - lastY) > 2 && !out.endsWith("\n")) out += "\n";
    if (out.endsWith("\n")) lastEnd = null;
    if (y !== undefined) lastY = y;
    const blank = str.trim() === "";
    if (!blank && x !== undefined && lastEnd !== null && charWidth > 0 && x - lastEnd > GAP_CHARS * charWidth && out && !out.endsWith("\n")) {
      out = `${out.replace(/ +$/, "")}\t`;
    }
    // pdf.js puts a space item across a wide gap, so a gap is measured from the end of the last item with text, not from the space.
    if (!blank) lastEnd = x !== undefined && item.width !== undefined ? x + item.width : null;
    if (!blank) {
      if (item.width && item.width > 0) charWidth = item.width / str.length;
      else if (item.transform?.[0]) charWidth = Math.abs(item.transform[0]) * 0.5; // no width given: half the font size is a typical character
    }
    out += str;
    if (item.hasEOL) {
      out += "\n";
      lastEnd = null;
    } else if (str && !str.endsWith(" ")) out += " ";
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
    void doc.destroy?.().catch(() => {}); // a failed clean-up isn't the reader's problem, and mustn't surface as an unhandled rejection
  }
}
