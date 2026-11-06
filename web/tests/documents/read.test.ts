import { describe, expect, it } from "vitest";
import { extractText, MAX_FILE_BYTES, MESSAGES, readFileSections, readPastedSections, ReadError } from "../../src/documents/read";
import { joinItems, pdfText, readPdf, type PdfDocumentLike } from "../../src/documents/read/pdf";
import { file, makeDocx, makePdf, RESUME_LINES } from "./fixtures";

const fails = async (p: Promise<unknown>, message: string) => {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ReadError);
  expect((err as Error).message).toBe(message);
};

describe("text files", () => {
  it("reads UTF-8 and splits it into sections", async () => {
    const sections = await readFileSections(file("resume.txt", RESUME_LINES.join("\n")));
    expect(sections.map((s) => s.heading)).toEqual(["Summary", "EXPERIENCE"]); // no contact line, so the name is not a header
    expect(sections[1].items.map((i) => i.text)).toEqual(["Built a weekly reporting model", "Cut close time by two days"]);
  });

  it("reads accented text", async () => {
    expect(await extractText(file("cv.txt", "Éloïse Tremblay, analyste à Montréal. Café, crème, déjà vu."))).toContain("Montréal");
  });

  it("says a file with almost no text looks scanned", async () => {
    await fails(extractText(file("tiny.txt", "Jane")), MESSAGES.scanned);
  });

  it("refuses other file types and files over 5 MB", async () => {
    await fails(extractText(file("resume.doc", "x".repeat(100))), MESSAGES.type);
    await fails(extractText(file("resume", "x".repeat(100))), MESSAGES.type);
    await fails(extractText(file("big.txt", new Uint8Array(MAX_FILE_BYTES + 1))), MESSAGES.size);
  });
});

describe("pasted text", () => {
  it("splits like a file", () => {
    expect(readPastedSections("SKILLS\nwrites SQL").map((s) => s.heading)).toEqual(["SKILLS"]);
  });
  it("asks for text when the box is empty, and accepts a short paste", () => {
    expect(() => readPastedSections("  \n ")).toThrow(MESSAGES.empty);
    expect(readPastedSections("SQL")).toHaveLength(1);
  });
});

describe("Word files", () => {
  it("reads paragraphs and table cells, and ignores headers", async () => {
    const text = await extractText(file("resume.docx", makeDocx(RESUME_LINES, [["Skills", "SQL, Python"], ["Languages", "English"]])));
    expect(text.split("\n")).toEqual([...RESUME_LINES, "Skills", "SQL, Python", "Languages", "English"]);
    expect(text).not.toContain("HEADER JUNK");
  });

  it("keeps ampersands and angle brackets as text", async () => {
    const text = await extractText(file("r.docx", makeDocx(["R&D analyst, A < B comparisons and long enough to count as text"])));
    expect(text).toContain("R&D analyst, A < B");
  });

  it("says so when the file isn't a Word file", async () => {
    await fails(extractText(file("r.docx", "this is not a zip file at all, just words")), MESSAGES.unreadable);
  });

  it("says a document with no words looks scanned", async () => {
    await fails(extractText(file("r.docx", makeDocx(["", " "]))), MESSAGES.scanned);
  });
});

describe("PDF text joining (a stand-in for pdf.js)", () => {
  const item = (str: string, y: number, hasEOL = false) => ({ str, hasEOL, transform: [1, 0, 0, 1, 0, y] });
  const doc = (pages: string[][], seen: number[] = []): PdfDocumentLike => ({
    numPages: pages.length,
    getPage: async (n) => {
      seen.push(n);
      return { getTextContent: async () => ({ items: pages[n - 1].map((s, i) => item(s, 700 - i * 14)) }) };
    },
  });

  it("starts a new line when the text moves down the page, and joins words on one line", () => {
    expect(joinItems([item("Built", 700), item("a model", 700), item("Cut close time", 686)])).toBe("Built a model\nCut close time");
    expect(joinItems([item("One", 700, true), item("Two", 700)])).toBe("One\nTwo");
  });

  it("reads the first 12 pages only", async () => {
    const seen: number[] = [];
    const text = await pdfText(doc(Array.from({ length: 20 }, (_, i) => [`Page ${i + 1}`]), seen));
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(text).toContain("Page 12");
    expect(text).not.toContain("Page 13");
  });

  it("closes the document, and passes an opener's refusal on", async () => {
    let closed = false;
    const d = { ...doc([["Hello there"]]), destroy: async () => { closed = true; } };
    expect(await readPdf(new Uint8Array(), async () => d)).toBe("Hello there");
    expect(closed).toBe(true);
    await expect(readPdf(new Uint8Array(), async () => { throw new ReadError(MESSAGES.encrypted); })).rejects.toThrow(MESSAGES.encrypted);
  });
});

describe("PDF fixtures", () => {
  // pdf.js can't start a worker under jsdom, so the real-file PDF tests are in read-pdf.test.ts, which runs in Node. Here only the builder is checked.
  it("builds a PDF that starts like one", () => {
    expect(new TextDecoder().decode(makePdf([["Hello"]]).slice(0, 8))).toBe("%PDF-1.4");
  });
});
