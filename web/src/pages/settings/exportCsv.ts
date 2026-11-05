// Builds the CSV text and the download for Settings.
import type { JobTrackerDB } from "../../db/schema";
import { applicationsToCsv } from "../../portability/csv";
import { listApplications } from "../../sync/queries";
import { downloadText } from "./actions";

export async function exportApplicationsCsv(db: JobTrackerDB): Promise<string> {
  return applicationsToCsv(await listApplications(db));
}

export const downloadCsv = (filename: string, text: string): void => downloadText(filename, text, "text/csv;charset=utf-8");
