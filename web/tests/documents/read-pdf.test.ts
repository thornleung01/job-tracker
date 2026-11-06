// @vitest-environment node
// Real PDF files through pdf.js. Node runs pdf.js in this thread, which jsdom can't do without a worker.
import { describe, expect, it } from "vitest";
import { extractText, MAX_PDF_PAGES, MESSAGES, readFileSections, ReadError } from "../../src/documents/read";
import { file, makePdf, RESUME_LINES, TEMPLATE_RESUME_LINES } from "./fixtures";

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

  it("keeps a tab where text sits far to the right on the same line, and reads the template into jobs and schools", async () => {
    // The test PDF's font has only plain letters, so the bullet, en dash and middle dot are swapped for ones it has.
    const ascii = TEMPLATE_RESUME_LINES.map((l) => l.replace(/●/g, "-").replace(/–/g, "-").replace(/·/g, ","));
    const pdf = file("template.pdf", makePdf([ascii]));
    const text = await extractText(pdf);
    expect(text.split("\n")).toContain("Northwind Traders\tToronto, ON");
    expect(text.split("\n")).toContain("Senior Analyst, Planning\tAug 2024 - Present");
    const sections = await readFileSections(pdf);
    const work = sections.find((s) => s.heading === "WORK EXPERIENCE")!;
    expect(work.items.slice(0, 2).map(({ id: _id, ...rest }) => rest)).toEqual([
      { kind: "org", text: "Northwind Traders", right: "Toronto, ON" },
      { kind: "title", text: "Senior Analyst, Planning", right: "Aug 2024 - Present" },
    ]);
    expect(work.items.filter((i) => i.kind === "bullet")).toHaveLength(5);
    const education = sections.find((s) => s.heading === "EDUCATION")!;
    expect(education.items.filter((i) => i.kind === "school").map((i) => [i.text, i.right])).toEqual([
      ["City University | School of Business", "Kingston, ON"],
      ["Lakeside College", "Ottawa, ON"],
    ]);
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
