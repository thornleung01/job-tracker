// Tiny documents built in code, so the reader tests need no binary files.
import { strToU8, zipSync } from "fflate";

const esc = (s: string) => s.replace(/[\\()]/g, (c) => "\\" + c);

/** A valid PDF with one page per entry. A page is its lines of text, or null for a page with no text (a scan has only a picture). */
export function makePdf(pages: (string[] | null)[], extra: { encrypt?: boolean } = {}): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) && objects.length;
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];
  const pagesId = objects.length + 1 + pages.length * 2;
  for (const lines of pages) {
    const stream = lines ? `BT /F1 12 Tf 14 TL 72 720 Td ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET` : "q 10 0 0 10 0 0 cm Q";
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  add(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let encrypt = "";
  if (extra.encrypt) {
    const hex = "00".repeat(32);
    const id = add(`<< /Filter /Standard /V 1 /R 2 /O <${hex}> /U <${hex}> /P -4 >>`);
    encrypt = ` /Encrypt ${id} 0 R /ID [<${"11".repeat(16)}> <${"11".repeat(16)}>]`;
  }
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${encrypt} >>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(out);
}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const para = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${t.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</w:t></w:r></w:p>`;

/** A .docx: paragraphs, then a table whose cells each hold a paragraph. Anything else in the package is junk the reader must ignore. */
export function makeDocx(paragraphs: string[], table: string[][] = []): Uint8Array {
  const rows = table.map((r) => `<w:tr>${r.map((c) => `<w:tc>${para(c)}</w:tc>`).join("")}</w:tr>`).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body>${paragraphs.map(para).join("")}${table.length ? `<w:tbl>${rows}</w:tbl>` : ""}</w:body></w:document>`;
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(xml),
    "word/header1.xml": strToU8(`<w:hdr xmlns:w="${W}">${para("HEADER JUNK")}</w:hdr>`),
  });
}

/** jsdom's File has no arrayBuffer(), which every browser has, so it is added here. */
export function file(name: string, data: Uint8Array | string): File {
  const f = new File([data as BlobPart], name);
  if (typeof f.arrayBuffer !== "function") {
    const bytes = typeof data === "string" ? strToU8(data) : data;
    Object.defineProperty(f, "arrayBuffer", { value: async () => bytes.slice().buffer });
  }
  return f;
}

export const RESUME_LINES = ["Jane Smith", "Analyst with five years in finance and data work.", "EXPERIENCE", "- Built a weekly reporting model", "- Cut close time by two days"];
