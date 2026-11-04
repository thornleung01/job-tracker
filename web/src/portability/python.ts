// Reads the file scripts/export_json.py writes from the local edition's SQLite database and turns it into export data.
import { iso } from "../db/time";
import { EXPORT_FORMAT, EXPORT_VERSION, ImportError, PYTHON_FORMAT, PYTHON_VERSION, type ExportEnvelope } from "./format";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const FLAGS = new Set(["active", "locked", "manual", "related", "needsReview", "bulk", "hold", "hidden"]);
// Local-edition columns the hosted edition does not have (replying is not in it yet).
const DROPPED = new Set(["canReply"]);
const TABLES: [string, string][] = [
  ["accounts", "accounts"], ["applications", "applications"], ["emails", "emails"], ["activity", "activity"],
  ["feedback", "feedback"], ["ignored_mail", "ignoredMail"], ["learned_rules", "learnedRules"], ["contact_edits", "contactEdits"],
];

function convertRow(row: unknown): unknown {
  if (!isRec(row)) return row;
  const out: Rec = {};
  for (const [key, value] of Object.entries(row)) {
    const k = camel(key);
    if (DROPPED.has(k)) continue;
    out[k] = FLAGS.has(k) && (value === 0 || value === 1) ? value === 1 : value;
  }
  return out;
}

function convertSettings(raw: unknown): Rec {
  if (!isRec(raw)) return {};
  const out: Rec = {};
  if (isRec(raw.appearance)) {
    const a = raw.appearance;
    const columns = Array.isArray(a.columns) ? a.columns.map((c) => (c === "last_activity" ? "lastActivity" : c)) : undefined;
    out.appearance = { theme: a.theme, accent: a.accent, density: a.density, corners: a.corners, columns, flowDays: a.flow_days };
  }
  if (isRec(raw.sync)) out.sync = { lookbackDays: raw.sync.lookback_days };
  return out;
}

/** Converts the Python file into the same envelope this app exports, ready for validation. */
export function convertPythonExport(raw: unknown): ExportEnvelope {
  if (!isRec(raw) || raw.format !== PYTHON_FORMAT) throw new ImportError(["This is not a file from scripts/export_json.py."]);
  if (typeof raw.version !== "number" || raw.version < 1 || raw.version > PYTHON_VERSION) {
    throw new ImportError([`The file is version ${String(raw.version)}, and this app reads version ${PYTHON_VERSION}.`]);
  }
  if (!isRec(raw.tables)) throw new ImportError(['The file has no "tables".']);
  const data: Rec = {};
  for (const [from, to] of TABLES) {
    const rows = raw.tables[from];
    data[to] = Array.isArray(rows) ? rows.map(convertRow) : rows === undefined ? [] : rows;
  }
  data.settings = convertSettings(raw.settings);
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : iso(new Date()),
    source: "python",
    data: data as unknown as ExportEnvelope["data"],
  };
}
