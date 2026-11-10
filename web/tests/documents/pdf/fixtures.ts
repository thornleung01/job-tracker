import type { DocItem, DocItemKind, DocSection } from "../../../src/db/schema";
import type { Layout, Run } from "../../../src/documents/pdf/layout";

let n = 0;
export const item = (text: string, extra: Partial<DocItem> = {}): DocItem => ({ id: `i${++n}`, text, ...extra });
export const section = (heading: string, ...items: DocItem[]): DocSection => ({ id: `s${++n}`, heading, items });
export const org = (text: string, right?: string) => item(text, { kind: "org", right });
export const title = (text: string, right?: string) => item(text, { kind: "title", right });
export const bullet = (label: string, text: string) => item(text, { kind: "bullet", label });
export const skill = (label: string, text: string) => item(text, { kind: "skill", label });
export const school = (text: string, right?: string) => item(text, { kind: "school", right });

/** Every character is half the font size wide, bold or not: easy to count by hand. */
export const fakeMeasure = (_font: string, size: number, text: string): number => text.length * size * 0.5;

/** The runs of one page grouped into lines (same baseline), left to right, as text. */
export function pageLines(layout: Layout, page = 0): string[] {
  const rows = new Map<number, Run[]>();
  for (const r of layout.pages[page].runs) rows.set(r.y, [...(rows.get(r.y) ?? []), r]);
  return [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, rs]) => rs.sort((a, b) => a.x - b.x).map((r) => r.text).join(""));
}
export const runsOf = (layout: Layout, text: string, page = 0): Run[] => layout.pages[page].runs.filter((r) => r.text === text);

const lines = (...texts: string[]) => texts.map((text) => item(text));

/** The demo master from src/demo/loadDemo.ts: the header, a summary, skills, two employers and a school. */
export const DEMO_MASTER: DocSection[] = [
  section("Header", ...lines("JORDAN LEE", "Toronto, Ontario | (416) 555-0100 | LinkedIn | jordan.lee@example.com")),
  section("Professional summary", ...lines("Analyst with several years of experience turning messy data into decisions for finance and product teams. Comfortable owning a metric from the first query to the last slide.")),
  section(
    "Skills and qualifications",
    skill("Analytics", "SQL, Python, Tableau, Excel"),
    skill("Methods", "Experiment design, forecasting, stakeholder reporting"),
    skill("Languages", "English (native), French (conversational)"),
  ),
  section(
    "Work experience",
    org("Northfield Bank", "Toronto, Ontario"),
    title("Senior Analyst", "Feb 2025 – Present"),
    bullet("Reporting automation", "Built a weekly reporting model that cut month-end close time by 2 days."),
    bullet("Dashboards", "Led a dashboard rollout used by 40 people across 3 teams."),
    bullet("Experimentation", "Ran A/B tests on the onboarding flow and shared the results with product."),
    title("Analyst", "Mar 2023 – Jan 2025"),
    bullet("Data pipelines", "Wrote SQL pipelines that replaced 12 hours of manual spreadsheet work each week."),
    org("Harbour Retail", "Mississauga, Ontario"),
    title("Business Analyst", "Sep 2021 – Feb 2023"),
    bullet("Sales reporting", "Maintained 15 weekly sales reports for 6 store regions."),
    bullet("Data quality", "Found and fixed a stock-count error that was overstating inventory by 4%."),
  ),
  section("Education", school("Demo University", "Toronto, Ontario"), item("Bachelor of Commerce in Economics, 2021")),
];

export type { DocItemKind };
