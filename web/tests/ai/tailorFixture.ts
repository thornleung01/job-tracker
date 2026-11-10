// A small master resume with fixed ids, and the replies a model might send for it. Shared by the tailoring tests.
import { masterText, readMaster } from "../../src/ai";
import type { TailorReply } from "../../src/ai";
import type { DocSection } from "../../src/db/schema";

const it = (id: string, text: string, extra: { kind?: "org" | "title" | "bullet" | "skill" | "school"; label?: string; right?: string } = {}) => ({ id, text, ...extra });

export const MASTER: DocSection[] = [
  { id: "sec-h", heading: "Header", items: [it("h1", "Jordan Lee"), it("h2", "Toronto, Ontario | jordan.lee@example.com")] },
  { id: "sec-s", heading: "Professional summary", items: [it("sum1", "Operations analyst with 3 years in retail. Leads reporting and planning work.")] },
  {
    id: "sec-k", heading: "Skills and qualifications",
    items: [it("k1", "Excel, Tableau, Power BI", { kind: "skill", label: "Analytics" }), it("k2", "SQL, Python", { kind: "skill", label: "Programming" })],
  },
  {
    id: "sec-w", heading: "Work experience",
    items: [
      it("o1", "Northwind Traders", { kind: "org", right: "Toronto, ON" }),
      it("t1", "Senior Analyst", { kind: "title", right: "Aug 2024 - Present" }),
      it("b1", "Owned the seasonal plan for 60 brands across 70 stores.", { kind: "bullet", label: "Planning" }),
      it("b2", "Automated the weekly report and saved 500 hours a year.", { kind: "bullet", label: "Reporting" }),
      it("b3", "Built reconciliations for the finance team.", { kind: "bullet", label: "Controls" }),
      it("o2", "Contoso Retail", { kind: "org", right: "New York, NY" }),
      it("t2", "Planner", { kind: "title", right: "2019 - 2022" }),
      it("b4", "Cut stock-outs by 12% with a weekly review.", { kind: "bullet", label: "Forecasting" }),
    ],
  },
  { id: "sec-e", heading: "Education", items: [it("s1", "Lakeside College", { kind: "school", right: "Ottawa, ON" }), it("d1", "Bachelor of Commerce")] },
];

export const PARTS = readMaster(MASTER);
export const MASTER_SOURCE = masterText(MASTER);
export const CTX = { masterSource: MASTER_SOURCE, company: "Acme Corp", role: "Data Analyst" };

/** A good reply: reordered, lightly reworded, nothing new. */
export function goodReply(): TailorReply {
  return {
    summary: "Operations analyst with 3 years in retail who leads reporting work.",
    skills: [{ sourceId: "k2", text: "SQL, Python" }, { sourceId: "k1", text: "Excel, Tableau" }],
    jobs: [
      { orgId: "o1", bullets: [{ sourceId: "b2", label: "Reporting", text: "Automated the weekly report and saved 500 hours a year." }, { sourceId: "b1", label: "Planning", text: "Owned the seasonal plan for 60 brands across 70 stores." }] },
      { orgId: "o2", bullets: [{ sourceId: "b4", label: "Forecasting", text: "Cut stock-outs by 12% with a weekly review." }] },
    ],
    cover: {
      paragraphs: [
        "I am excited to apply for the Data Analyst role at Acme Corp.",
        "At Northwind Traders I automated the weekly report and saved 500 hours a year.",
        "Thank you for your time. I would welcome a chat.",
      ],
    },
  };
}
