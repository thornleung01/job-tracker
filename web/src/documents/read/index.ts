// Reading a resume from a file or from pasted text. The result is sections to check and edit: nothing is saved here.
import type { DocSection } from "../../db/schema";
import { MAX_FILE_BYTES, MESSAGES, MIN_TEXT_CHARS, ReadError } from "./errors";
import { splitSections, squeezeLine } from "./split";

export { ReadError, MESSAGES, MAX_FILE_BYTES, MAX_PDF_PAGES } from "./errors";
export { splitSections } from "./split";

/** Line breaks as "\n" and no blank space at the ends: the form the text is kept and sent in. */
export const normalizeText = (text: string) => text.replace(/\r\n?/g, "\n").trim();

/** Spaces squeezed, lines trimmed, no runs of blank lines. A gap (a tab, or 3 or more spaces) stays as one tab: it is where text was right-aligned. */
const tidy = (text: string) => normalizeText(text).split("\n").map(squeezeLine).join("\n").replace(/\n{3,}/g, "\n\n").trim();

const extension = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase() ?? "";

/** The plain text of a PDF, Word or text file. Throws a ReadError whose message is safe to show. */
export async function extractText(file: Blob & { name?: string }): Promise<string> {
  const ext = extension(file.name ?? "");
  if (!["pdf", "docx", "txt"].includes(ext)) throw new ReadError(MESSAGES.type);
  if (file.size > MAX_FILE_BYTES) throw new ReadError(MESSAGES.size);
  let text: string;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (ext === "txt") text = new TextDecoder("utf-8").decode(bytes);
    else if (ext === "docx") text = (await import("./docx")).readDocx(bytes);
    else text = await (await import("./pdf")).readPdf(bytes);
  } catch (e) {
    if (e instanceof ReadError) throw e;
    throw new ReadError(MESSAGES.unreadable);
  }
  // A 5 MB file can hold far more text than that once unzipped, so cap it before the per-line work, as pasted text is.
  text = tidy(text.slice(0, MAX_FILE_BYTES));
  if (text.length < MIN_TEXT_CHARS) throw new ReadError(MESSAGES.scanned);
  return text;
}

/** A file as sections. */
export async function readFileSections(file: Blob & { name?: string }): Promise<DocSection[]> {
  return splitSections(await extractText(file));
}

/** Pasted text as sections. */
export function readPastedSections(text: string): DocSection[] {
  // Pasted text is read up to the same size as a file (counted in characters), and the rest is ignored without a message.
  const clean = tidy(text.slice(0, MAX_FILE_BYTES));
  if (!clean) throw new ReadError(MESSAGES.empty);
  return splitSections(clean);
}
