// Linear-time tag scanning for text that may be hostile. The obvious regexes (`<p\b[^>]*>`) rescan to the end of the text from
// every "<p " when there is no ">", which is quadratic: 200,000 characters of "<p <p <p" froze a tab for seconds. These helpers
// find the tag name with a regex that cannot run on, then look for the closing ">" by index, so each part of the text is read once.

/** Whether a tag named by `head` (a pattern such as `<\/?(?:p|div)\b`, no flags) opens and later closes with ">". */
export function hasTag(text: string, head: RegExp): boolean {
  const lastGt = text.lastIndexOf(">");
  if (lastGt < 0) return false;
  const m = new RegExp(head.source, "i").exec(text);
  // Later matches start later still, so if the first one has no ">" after it none does.
  return m !== null && lastGt >= m.index + m[0].length;
}

/** `text` with every `head` tag, up to its next ">", replaced. Same result as `/head[^>]*>/gi` without the rescans. */
export function replaceTags(text: string, head: RegExp, replacement: string): string {
  const re = new RegExp(head.source, "gi");
  let out = "";
  let from = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const end = text.indexOf(">", m.index + m[0].length);
    if (end < 0) break;
    out += text.slice(from, m.index) + replacement;
    from = end + 1;
    re.lastIndex = from;
  }
  return out + text.slice(from);
}

/** `text` with every `<...>` span replaced. Same result as `/<[^>]*>/g` without the rescans. */
export function stripTags(text: string, replacement: string): string {
  let out = "";
  let from = 0;
  for (let open = text.indexOf("<"); open >= 0; open = text.indexOf("<", from)) {
    const end = text.indexOf(">", open + 1);
    if (end < 0) break;
    out += text.slice(from, open) + replacement;
    from = end + 1;
  }
  return out + text.slice(from);
}

/** `text` with each `<script>` or `<style>` block, up to the first closing script or style tag, replaced. */
export function stripScriptBlocks(text: string, replacement: string): string {
  const open = /<(?:script|style)/gi;
  const close = /<\/(?:script|style)>/gi;
  let out = "";
  let from = 0;
  for (let m = open.exec(text); m; m = open.exec(text)) {
    close.lastIndex = m.index + m[0].length;
    const c = close.exec(text);
    if (!c) break;
    out += text.slice(from, m.index) + replacement;
    from = c.index + c[0].length;
    open.lastIndex = from;
  }
  return out + text.slice(from);
}
