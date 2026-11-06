// What can go wrong reading a file, in one plain line each. A ReadError is always safe to show on the page.

export class ReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadError";
  }
}

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_PAGES = 12;
/** Less text than this means the file is a picture of a page. */
export const MIN_TEXT_CHARS = 40;

export const MESSAGES = {
  type: "Upload a PDF, Word (.docx) or text file.",
  size: "That file is over 5 MB. Export a smaller copy.",
  encrypted: "That PDF is password protected. Export an unlocked copy.",
  unreadable: "Couldn't read that file. Try exporting it again or paste the text instead.",
  scanned: "This looks like a scanned file. Paste the text instead.",
  empty: "Paste some text first.",
} as const;
