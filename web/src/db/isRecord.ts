/** A plain object (not null, not a list): what JSON from a file, a web page or an API is checked as before its fields are read. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
