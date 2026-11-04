// Port of html_to_text in jobtracker/providers/base.py: drop script/style/head, join text nodes with newlines.
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, head").forEach((el) => el.remove());
  const parts: string[] = [];
  const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.nodeValue ?? "");
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
