// Reads a master resume's sections into the parts tailoring may change (summary, skills, each job's bullets). Pure. Everything else (the
// header, companies, titles, schools, other sections) is never sent for rewriting and never taken from the model.
import { isHeaderHeading } from "../db/documentShape";
import type { DocItem, DocSection } from "../db/schema";

export interface MasterLine {
  id: string;
  label: string;
  text: string;
}
export interface MasterJob {
  /** the id of the job's company line */
  id: string;
  org: string;
  titles: string[];
  bullets: MasterLine[];
}
export interface TailorMaster {
  /** the id of the summary's first line, "" when the master has no summary */
  summaryId: string;
  summary: string;
  skills: MasterLine[];
  jobs: MasterJob[];
}

const SUMMARY_HEADING = /summary|profile|objective/i;

const line = (i: DocItem): MasterLine => ({ id: i.id, label: i.label ?? "", text: i.text });

/** The summary is the plain lines of the section headed "Professional summary" (or Profile, Objective). */
export const isSummarySection = (s: DocSection): boolean => !isHeaderHeading(s.heading) && SUMMARY_HEADING.test(s.heading);

export function readMaster(sections: readonly DocSection[]): TailorMaster {
  const master: TailorMaster = { summaryId: "", summary: "", skills: [], jobs: [] };
  for (const section of sections) {
    if (isHeaderHeading(section.heading)) continue;
    if (isSummarySection(section)) {
      const plain = section.items.filter((i) => !i.kind && i.text);
      master.summaryId = plain[0]?.id ?? "";
      master.summary = plain.map((i) => i.text).join("\n");
      continue;
    }
    let job: MasterJob | null = null;
    for (const item of section.items) {
      if (item.kind === "skill") master.skills.push(line(item));
      else if (item.kind === "org") {
        job = { id: item.id, org: item.text, titles: [], bullets: [] };
        master.jobs.push(job);
      } else if (item.kind === "school") job = null;
      else if (item.kind === "title" && job) job.titles.push(item.right ? `${item.text} ${item.right}` : item.text);
      else if (item.kind === "bullet" && job) job.bullets.push(line(item));
    }
  }
  return master;
}

/** Every text of the master in one string: what a tailored line is compared with. */
export function masterText(sections: readonly DocSection[]): string {
  return sections.flatMap((s) => [s.heading, ...s.items.flatMap((i) => [i.text, i.label ?? "", i.right ?? ""])]).join("\n");
}
