// @vitest-environment node
// Real PDF files through pdf.js. Node runs pdf.js in this thread, which jsdom can't do without a worker.
import { describe, expect, it } from "vitest";
import { extractText, MAX_PDF_PAGES, MESSAGES, ReadError } from "../../src/documents/read";
import { file, makePdf, RESUME_LINES } from "./fixtures";

const fails = async (p: Promise<unknown>, message: string) => {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ReadError);
  expect((err as Error).message).toBe(message);
};

describe("PDF files", () => {
  it("reads a two-page PDF into lines", async () => {
    const text = await extractText(file("resume.pdf", makePdf([RESUME_LINES, ["SKILLS", "SQL and Python for reporting"]])));
    expect(text.split("\n")).toEqual([...RESUME_LINES, "", "SKILLS", "SQL and Python for reporting"]);
  });

  it("reads only the first 12 pages", async () => {
    const pages = Array.from({ length: MAX_PDF_PAGES + 3 }, (_, i) => [`Page number ${i + 1} of the resume file`]);
    const text = await extractText(file("long.pdf", makePdf(pages)));
    expect(text).toContain(`Page number ${MAX_PDF_PAGES} of`);
    expect(text).not.toContain(`Page number ${MAX_PDF_PAGES + 1} of`);
  });

  it("refuses a password-protected PDF", async () => {
    await fails(extractText(file("locked.pdf", makePdf([RESUME_LINES], { encrypt: true }))), MESSAGES.encrypted);
  });

  it("says a PDF with no text looks scanned", async () => {
    await fails(extractText(file("scan.pdf", makePdf([null, null]))), MESSAGES.scanned);
  });

  it("says so when the file isn't a PDF", async () => {
    await fails(extractText(file("bad.pdf", "this is not a pdf, just some words in a file")), MESSAGES.unreadable);
  });
});
