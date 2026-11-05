// Sorting by a text key (ISO times sort correctly as text). `||` the comparators together to break ties.

/** Newest or largest first. */
export const byDesc = <T>(key: (item: T) => string) => (a: T, b: T): number => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0);

/** Oldest or smallest first. */
export const byAsc = <T>(key: (item: T) => string) => (a: T, b: T): number => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
