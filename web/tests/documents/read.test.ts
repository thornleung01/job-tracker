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

  describe("gaps", () => {
    /** A text item at an x position with a width of 6 per character (an average character is 6). */
    const at = (str: string, x: number, y = 700, width = str.length * 6) => ({ str, width, transform: [12, 0, 0, 12, x, y] });

    it("keeps a tab where two items on a line are more than 3 characters apart", () => {
      expect(joinItems([at("Northwind Traders", 72), at("Toronto, ON", 400)])).toBe("Northwind Traders\tToronto, ON");
      // items that touch, or sit a word apart, stay joined by a space
      expect(joinItems([at("Built", 72), at("a model", 72 + 30 + 6)])).toBe("Built a model");
      // exactly 3 characters (18) is not yet a gap, a little more is
      expect(joinItems([at("Ab", 0), at("cd", 12 + 18)])).toBe("Ab cd");
      expect(joinItems([at("Ab", 0), at("cd", 12 + 19)])).toBe("Ab\tcd");
    });

    it("ignores the spaces between items when it measures a gap, and puts no tab on a new line", () => {
      expect(joinItems([at("Left", 72), at(" ", 96), at("Right", 100)]).replace(/ +/g, " ")).toBe("Left Right");
      expect(joinItems([at("Left", 72), at(" ", 96), at("Right", 400)])).toBe("Left\tRight");
      expect(joinItems([at("Left", 72, 700), at("Right", 400, 686)])).toBe("Left\nRight");
    });

    it("falls back to half the font size when an item has no width, and adds no tab without positions", () => {
      const noWidth = (str: string, x: number) => ({ str, transform: [12, 0, 0, 12, x, 700] });
      expect(joinItems([noWidth("One", 72), noWidth("Two", 400)])).toBe("One Two");
      expect(joinItems([{ str: "One", width: 18, transform: [12, 0, 0, 12, 72, 700] }, noWidth("Two", 400)])).toBe("One\tTwo");
      expect(joinItems([{ str: "One" }, { str: "Two" }])).toBe("One Two");
    });

    it("hands the gap on as text: through a fake document, tidy and the splitter", async () => {
      const page = [at("Northwind Traders", 72, 700), at("Toronto, ON", 400, 700), at("Senior Analyst", 72, 686), at("Aug 2024 – Present", 400, 686), at("Plans the season for the stores", 72, 672)];
      const d: PdfDocumentLike = { numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: page }) }) };
      const text = await readPdf(new Uint8Array(), async () => d);
      expect(text).toBe("Northwind Traders\tToronto, ON\nSenior Analyst\tAug 2024 – Present\nPlans the season for the stores");
      const sections = readPastedSections(`WORK EXPERIENCE\n${text}`);
      expect(sections[0].items.map(({ id: _id, ...rest }) => rest)).toEqual([
        { kind: "org", text: "Northwind Traders", right: "Toronto, ON" },
        { kind: "title", text: "Senior Analyst", right: "Aug 2024 – Present" },
        { text: "Plans the season for the stores" },
      ]);
    });

    it("keeps one tab for a gap in pasted text, and turns 3 or more spaces into one", () => {
      const pasted = (t: string) => readPastedSections(`WORK EXPERIENCE\n${t}`)[0].items.map(({ id: _id, ...rest }) => rest);
      expect(pasted("Acme \t\t Toronto, ON")).toEqual([{ kind: "org", text: "Acme", right: "Toronto, ON" }]);
      expect(pasted("Acme      Toronto, ON")).toEqual([{ kind: "org", text: "Acme", right: "Toronto, ON" }]);
      expect(pasted("Ran  the   desk")).toEqual([{ text: "Ran the desk" }]);
    });

    it("counts a gap as one character in the scanned check and keeps a plain TXT file the same", async () => {
      await expect(extractText(file("a.txt", "a\tb"))).rejects.toThrow(MESSAGES.scanned);
      expect(await extractText(file("a.txt", "Plain words on one line, nothing to split here at all"))).toBe("Plain words on one line, nothing to split here at all");
    });
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
