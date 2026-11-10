// A .docx whose document part says it unzips to more than 20 MB is refused before it is inflated.
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { MESSAGES, ReadError } from "../../src/documents/read";
import { readDocx } from "../../src/documents/read/docx";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const docx = (xml: string) => zipSync({ "word/document.xml": new TextEncoder().encode(xml) });

describe("readDocx size guard", () => {
  it("reads a normal document part", () => {
    const xml = `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>`;
    expect(readDocx(docx(xml))).toBe("Hello");
  });

  it("refuses a part that declares more than 20 MB, as a zip bomb would", () => {
    // 21 MB of one repeated character compresses to a few kilobytes, so the file itself is tiny.
    const bomb = docx(`<w:document xmlns:w="${W}"><w:body>${"a".repeat(21 * 1024 * 1024)}</w:body></w:document>`);
    expect(bomb.length).toBeLessThan(1024 * 1024);
    let thrown: unknown;
    try {
      readDocx(bomb);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ReadError);
    expect((thrown as Error).message).toBe(MESSAGES.unreadable);
  });
});
