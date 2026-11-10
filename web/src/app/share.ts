// Structural sharing for query results: a re-run that read the same data gives back the same objects, so memoised rows and effects keyed on them do nothing.

const isPlain = (x: unknown): x is Record<string, unknown> => {
  if (typeof x !== "object" || x === null) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
};

/**
 * `next`, with every part that equals the same part of `prev` replaced by the one from `prev`. Arrays and plain objects are
 * compared by content; anything else (a Map, a Date, a function) only by identity, so it is never wrongly merged.
 * Returns `prev` itself when nothing changed.
 */
export function share<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return next;
  if (Array.isArray(prev) && Array.isArray(next)) {
    let same = prev.length === next.length;
    const out = next.map((item, i) => {
      const kept = share(prev[i], item);
      if (!Object.is(kept, prev[i])) same = false;
      return kept;
    });
    return (same ? prev : out) as T;
  }
  if (isPlain(prev) && isPlain(next)) {
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(prev).length;
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const kept = k in prev ? share(prev[k], next[k]) : next[k];
      if (!(k in prev) || !Object.is(kept, prev[k])) same = false;
      out[k] = kept;
    }
    return (same ? prev : out) as T;
  }
  return next;
}
