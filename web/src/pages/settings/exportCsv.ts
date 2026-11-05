// The Export CSV button: the list's rows (with rounds counted the same way) as a spreadsheet file.
import type { JobTrackerDB } from "../../db/schema";
import { applicationsToCsv, csvFilename } from "../../portability/csv";
import { listApplications } from "../../sync/queries";
import { downloadText } from "./actions";

export { csvFilename };

export async function exportApplicationsCsv(db: JobTrackerDB): Promise<string> {
  return applicationsToCsv(await listApplications(db));
}

export const downloadCsv = (filename: string, text: string): void => downloadText(filename, text, "text/csv;charset=utf-8");
