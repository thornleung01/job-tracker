// @vitest-environment node
// Real PDF bytes: made with pdf-lib, read back with pdf.js.
import { describe, expect, it } from "vitest";
import { letterPdf, pdfFilename, resumePdf } from "../../../src/documents/pdf";
import { extractText } from "../../../src/documents/read";
import { file } from "../fixtures";
import { DEMO_MASTER, bullet, item, section } from "./fixtures";

const startsWithPdf = (b: Uint8Array) => new TextDecoder().decode(b.slice(0, 5));
const textOf = (b: Uint8Array) => extractText(file("out.pdf", b));

describe("resumePdf", () => {
  it("makes a one-page PDF for the demo master", async () => {
    const r = await resumePdf(DEMO_MASTER, { title: "Jordan Lee resume" });
    expect(startsWithPdf(r.bytes)).toBe("%PDF-");
    expect(r.pages).toBe(1);
    expect(r.replacedChars).toBe(false);
  });

  it("carries the resume's words in reading order", async () => {
    const text = await textOf((await resumePdf(DEMO_MASTER)).bytes);
    const lines = text.split("\n");
    expect(lines[0]).toBe("JORDAN LEE");
    expect(lines).toContain("WORK EXPERIENCE");
    expect(text).toContain("Northfield Bank");
    expect(text).toContain("Toronto, Ontario");
    expect(text).toContain("Analytics: SQL, Python, Tableau, Excel");
    expect(text).toContain("Found and fixed a stock-count error");
  });

  it("runs to two pages for an over-long resume and the page count matches the document", async () => {
    const long = [section("Work", ...Array.from({ length: 90 }, (_, i) => bullet(`Item ${i}`, "Did a thing that was worth writing down in a bullet.")))];
    const r = await resumePdf(long, { title: "Long" });
    expect(r.pages).toBe(2);
    const text = await textOf(r.bytes);
    expect(text).toContain("Item 0");
    expect(text).toContain("Item 89");
  });

  it("replaces characters the standard fonts cannot draw, says so, and still makes a valid PDF", async () => {
    const r = await resumePdf([section("Skills ✓", item("Emoji \u{1F600} and 日本 in a line that is long enough to count as real text"))], { title: "Résumé \u{1F600}" });
    expect(r.replacedChars).toBe(true);
    expect(startsWithPdf(r.bytes)).toBe("%PDF-");
    expect(await textOf(r.bytes)).toContain("Emoji ? and ?? in a line");
  });

  it("makes a PDF from nothing without throwing", async () => {
    const r = await resumePdf([]);
    expect(r.pages).toBe(1);
    expect(startsWithPdf(r.bytes)).toBe("%PDF-");
  });
});

describe("letterPdf", () => {
  const letter = [section("", item("Dear hiring team,"), item("I would like to join you."), item("Sincerely,\nJordan Lee"))];

  it("makes a one-page PDF with the greeting, body and sign-off", async () => {
    const r = await letterPdf(letter, { title: "Cover letter" });
    expect(startsWithPdf(r.bytes)).toBe("%PDF-");
    expect(r.pages).toBe(1);
    expect(r.replacedChars).toBe(false);
    const lines = (await textOf(r.bytes)).split("\n").filter(Boolean);
    expect(lines).toEqual(["Dear hiring team,", "I would like to join you.", "Sincerely,", "Jordan Lee"]);
  });

  it("flags unsupported characters", async () => {
    expect((await letterPdf([section("", item("Hello \u{1F44B}"))])).replacedChars).toBe(true);
  });

  it("runs onto a second page when the letter is long", async () => {
    const long = [section("", ...Array.from({ length: 12 }, () => item("A sentence for the letter that goes on a little. ".repeat(12).trim())))];
    expect((await letterPdf(long)).pages).toBe(2);
  });
});

describe("pdfFilename", () => {
  it("names the file after the kind, company and role with en dashes", () => {
    expect(pdfFilename("Resume", "Gringotts", "Product Analyst")).toBe("Resume – Gringotts – Product Analyst.pdf");
    expect(pdfFilename("Cover letter", "Gringotts", "Product Analyst")).toBe("Cover letter – Gringotts – Product Analyst.pdf");
  });

  it("leaves out an empty or unknown role, or company", () => {
    expect(pdfFilename("Resume", "Gringotts", "")).toBe("Resume – Gringotts.pdf");
    expect(pdfFilename("Resume", "Gringotts", "  ")).toBe("Resume – Gringotts.pdf");
    expect(pdfFilename("Resume", "Gringotts", "Unknown")).toBe("Resume – Gringotts.pdf");
    expect(pdfFilename("Resume", "", "Analyst")).toBe("Resume – Analyst.pdf");
    expect(pdfFilename("Cover letter", "", "")).toBe("Cover letter.pdf");
  });

  it("takes out characters a file system rejects and tidies spaces and dots", () => {
    expect(pdfFilename("Resume", 'A/B: "Co" <x>', "Dev | Ops?\n")).toBe("Resume – A B Co x – Dev Ops.pdf");
    expect(pdfFilename("Resume", "..Hidden..", "Role.")).toBe("Resume – Hidden – Role.pdf");
  });

  it("cuts very long names", () => {
    const name = pdfFilename("Resume", "x".repeat(200), "y".repeat(200));
    expect(name.length).toBeLessThan(160);
    expect(name.endsWith(".pdf")).toBe(true);
  });
});
