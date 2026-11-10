/** The number in a `:id` route segment, or NaN when it is not a plain whole number ("abc", "1e2", "-1", "0x10"). Queries treat NaN as "no such item". */
export function routeId(part: string | undefined): number {
  if (part === undefined || !/^\d+$/.test(part)) return NaN;
  const n = Number(part);
  return Number.isSafeInteger(n) ? n : NaN;
}
