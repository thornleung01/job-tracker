// Word text: a .docx is a zip, and the words are in word/document.xml. Paragraphs and table cells are read, everything else is ignored.
import { unzipSync } from "fflate";
import { MESSAGES, ReadError } from "./errors";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
/** The document part may not unzip to more than this, so a zip bomb can't fill memory. */
const MAX_XML_BYTES = 20 * 1024 * 1024;

/** The text of one paragraph. A nested paragraph (a text box) is read on its own, not twice. */
function paragraphText(p: Element): string {
  let out = "";
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (child.namespaceURI !== W || child.localName === "p") continue;
      if (child.localName === "t") out += child.textContent ?? "";
      else if (child.localName === "tab") out += "\t";
      else if (child.localName === "br" || child.localName === "cr") out += " ";
      else walk(child);
    }
  };
  walk(p);
  return out;
}

export function readDocx(data: Uint8Array): string {
  let xml: string;
  try {
    const files = unzipSync(data, { filter: (f) => f.name === "word/document.xml" && f.originalSize <= MAX_XML_BYTES });
    const part = files["word/document.xml"];
    if (!part) throw new Error("no document part");
    xml = new TextDecoder("utf-8").decode(part);
  } catch {
    throw new ReadError(MESSAGES.unreadable);
  }
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new ReadError(MESSAGES.unreadable);
  return Array.from(doc.getElementsByTagNameNS(W, "p")).map(paragraphText).join("\n");
}
