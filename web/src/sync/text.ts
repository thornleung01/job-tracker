// Small text helpers that count characters the way Python's str does (code points, not UTF-16 units).

export function cpLength(s: string): number {
  if (s.length <= 1) return s.length;
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** The first `n` code points. */
export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return Array.from(s).slice(0, n).join("");
}

/** "1 email", "2 emails": the noun in its plural unless `count` is 1 (`many` for the odd ones, e.g. "application" is regular, "person" is not). */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Collapses every run of whitespace to one space and trims, like re.sub(r"\s+", " ", s).strip(). */
export function squeeze(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}
