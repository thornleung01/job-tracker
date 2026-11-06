// Convert a resume's text into the template with a fake model: errors, the model choice, and two full resumes read end to end.
import { describe, expect, it, vi } from "vitest";
import { AiError, DEFAULT_MODEL, type AiDeps, type AiModel, type AiRequest, type Vault, type VaultStatus } from "../../src/ai";
import { ActionError } from "../../src/db/errors";
import { HEADER_HEADING } from "../../src/db/documentShape";
import { MAX_AI_INPUT_CHARS } from "../../src/db/limits";
import { convertResume } from "../../src/sync/convert";
import { TEMPLATE_RESUME_LINES } from "../documents/fixtures";

const it_ = (kind: string, text: string, label = "", right = "") => ({ kind, text, label, right });

function fakeDeps(json: unknown, opts: { key?: string | null; status?: VaultStatus } = {}) {
  const key = opts.key === undefined ? "sk-ant-test" : opts.key;
  const status: VaultStatus = opts.status ?? (key ? { state: "unlocked", last4: "test", model: DEFAULT_MODEL } : { state: "none" });
  const vault = {
    status: () => status,
    key: () => key,
    save: vi.fn(), unlock: vi.fn(), lock: vi.fn(), setModel: vi.fn(), forget: vi.fn(),
  } as unknown as Vault;
  const complete = vi.fn(async (_key: string, _req: AiRequest, _o?: { signal?: AbortSignal }) => ({ json, model: "m" }));
  return { deps: { vault, complete } satisfies AiDeps, complete };
}

const MINIMAL = { header: { name: "Jordan Lee", contact: [] }, sections: [{ heading: "Education", items: [it_("school", "Lakeside College", "", "Ottawa, ON")] }] };
const TEXT = "Jordan Lee\nLakeside College Ottawa, ON";

describe("convertResume: refusals", () => {
  it("refuses empty text with a sentence, without calling the model", async () => {
    const { deps, complete } = fakeDeps(MINIMAL);
    for (const text of ["", "   \n\t "]) {
      const err = await convertResume(text, deps, { db: "d" }).catch((e) => e);
      expect(err).toBeInstanceOf(ActionError);
      expect(err).not.toBeInstanceOf(AiError);
      expect(err.message).toBe("There's no text to convert.");
    }
    expect(complete).not.toHaveBeenCalled();
  });

  it("refuses text over the limit with tooLong, and accepts exactly the limit", async () => {
    const { deps, complete } = fakeDeps(MINIMAL);
    const err = await convertResume("x".repeat(MAX_AI_INPUT_CHARS + 1), deps, { db: "d" }).catch((e) => e);
    expect(err).toMatchObject({ name: "AiError", code: "tooLong" });
    expect(complete).not.toHaveBeenCalled();
    await expect(convertResume("x".repeat(MAX_AI_INPUT_CHARS), deps, { db: "d" })).resolves.toBeTruthy();
  });

  it("says noKey when there is no key, and locked when there is one that isn't unlocked", async () => {
    const none = fakeDeps(MINIMAL, { key: null });
    await expect(convertResume(TEXT, none.deps, { db: "d" })).rejects.toMatchObject({ code: "noKey" });
    const locked = fakeDeps(MINIMAL, { key: null, status: { state: "locked", last4: "abcd", model: DEFAULT_MODEL } });
    await expect(convertResume(TEXT, locked.deps, { db: "d" })).rejects.toMatchObject({ code: "locked" });
    expect(none.complete).not.toHaveBeenCalled();
    expect(locked.complete).not.toHaveBeenCalled();
  });

  it("passes an abort through unchanged, and the signal to the call", async () => {
    const { deps, complete } = fakeDeps(MINIMAL);
    const abort = new DOMException("aborted", "AbortError");
    complete.mockRejectedValueOnce(abort);
    const controller = new AbortController();
    await expect(convertResume(TEXT, deps, { db: "d", signal: controller.signal })).rejects.toBe(abort);
    expect(complete.mock.calls[0][2]?.signal).toBe(controller.signal);
  });

  it("lets the client's own errors through, and rejects a reply of the wrong shape as badReply", async () => {
    const down = fakeDeps(MINIMAL);
    down.complete.mockRejectedValueOnce(new AiError("offline"));
    await expect(convertResume(TEXT, down.deps, { db: "d" })).rejects.toMatchObject({ code: "offline" });
    const odd = fakeDeps({ sections: "no" });
    await expect(convertResume(TEXT, odd.deps, { db: "d" })).rejects.toMatchObject({ code: "badReply" });
  });
});

describe("convertResume: the model", () => {
  it("uses the given model first, then the vault's, then the default", async () => {
    const stored: VaultStatus = { state: "unlocked", last4: "test", model: "claude-opus-5-5" };
    const a = fakeDeps(MINIMAL, { status: stored });
    await convertResume(TEXT, a.deps, { db: "d" });
    expect(a.complete.mock.calls[0][1].model).toBe("claude-opus-5-5");
    const b = fakeDeps(MINIMAL, { status: stored });
    await convertResume(TEXT, b.deps, { db: "d", model: "claude-haiku-5-5" as AiModel });
    expect(b.complete.mock.calls[0][1].model).toBe("claude-haiku-5-5");
    const c = fakeDeps(MINIMAL, { key: "k", status: { state: "none" } });
    await convertResume(TEXT, c.deps, { db: "d" });
    expect(c.complete.mock.calls[0][1].model).toBe(DEFAULT_MODEL);
  });

  it("sends the key and the text as a JSON string, for the right database", async () => {
    const { deps, complete } = fakeDeps(MINIMAL);
    const keySpy = vi.spyOn(deps.vault, "key");
    await convertResume(TEXT, deps, { db: "mine" });
    expect(keySpy).toHaveBeenCalledWith("mine");
    expect(complete.mock.calls[0][0]).toBe("sk-ant-test");
    expect(JSON.parse(complete.mock.calls[0][1].user)).toEqual({ task: "convert", resumeText: TEXT });
  });

  it("has no database access: its only inputs are the text and the deps", async () => {
    // there is no fake-indexeddb in this file and the call still works: it only gets the database's name, never a handle
    expect(typeof (globalThis as { indexedDB?: unknown }).indexedDB).toBe("undefined");
    await expect(convertResume(TEXT, fakeDeps(MINIMAL).deps, { db: "d" })).resolves.toMatchObject({ flags: [], unused: [] });
  });
});

describe("convertResume: the template's own layout", () => {
  const text = TEMPLATE_RESUME_LINES.join("\n");
  const reply = {
    header: { name: "JORDAN LEE", contact: ["Toronto, Ontario | (416) 555-0100 | LinkedIn | jordan@example.com"] },
    sections: [
      { heading: "Professional summary", items: [it_("line", "Operations analyst with 3+ years in retail and logistics. Leads reporting and planning work that reduces manual effort across teams.")] },
      { heading: "Skills and qualifications", items: [
        it_("skill", "SQL (Redshift), Python, R", "Programming/Database"), it_("skill", "Microsoft Excel · Tableau · Power BI", "Analytics"),
        it_("skill", "English, French", "Languages"),
      ] },
      { heading: "Work experience", items: [
        it_("org", "Northwind Traders", "", "Toronto, ON"),
        it_("title", "Senior Analyst, Planning", "", "Aug 2024 – Present"),
        it_("bullet", "Own the seasonal plan for 60+ brands across 70 stores, refining demand forecasts and markdown decisions with category teams.", "Planning"),
        it_("bullet", "Automated the weekly report, reclaiming ~500 hours a year.", "Reporting"),
        it_("title", "Associate, Data and Analytics"),
        it_("bullet", "Built reconciliations for the finance team.", "Controls"),
        it_("title", "Analyst, Reporting", "", "Jan 2020 - Dec 2022"),
        it_("bullet", "Reviewed vendor files before each close.", "Vendor files"),
        it_("org", "Contoso Retail", "", "New York, NY"),
        it_("title", "Planner", "", "2019 – 2022"),
        it_("bullet", "Cut stock-outs by 12% with a weekly review.", "Forecasting"),
      ] },
      { heading: "Education", items: [
        it_("school", "City University | School of Business", "", "Kingston, ON"), it_("line", "Master of Analytics"),
        it_("school", "Lakeside College", "", "Ottawa, ON"), it_("line", "Bachelor of Commerce"),
      ] },
    ],
  };

  it("builds the template, flags nothing, and drops nothing", async () => {
    const { deps } = fakeDeps(reply);
    const result = await convertResume(text, deps, { db: "d" });
    expect(result.sections.map((s) => s.heading)).toEqual([
      HEADER_HEADING, "Professional summary", "Skills and qualifications", "Work experience", "Education",
    ]);
    const work = result.sections[3].items;
    expect(work.map((i) => i.kind)).toEqual([
      "org", "title", "bullet", "bullet", "title", "bullet", "title", "bullet", "org", "title", "bullet",
    ]);
    expect(work[0]).toMatchObject({ text: "Northwind Traders", right: "Toronto, ON" });
    expect(work[1]).toMatchObject({ text: "Senior Analyst, Planning", right: "Aug 2024 – Present" });
    expect(work[2]).toMatchObject({ label: "Planning" });
    expect(result.sections[4].items.map((i) => i.kind)).toEqual(["school", undefined, "school", undefined]);
    expect(result.flags).toEqual([]);
    expect(result.unused).toEqual([]);
  });

  it("flags what the model invented and lists what it dropped", async () => {
    const edited = structuredClone(reply);
    edited.sections[2].items[3] = it_("bullet", "Automated the weekly report, reclaiming ~900 hours a year.", "Impact");
    edited.sections[2].items.splice(10, 1);
    const result = await convertResume(text, fakeDeps(edited).deps, { db: "d" });
    const bullet = result.sections[3].items[3];
    expect(result.flags).toEqual([
      { itemId: bullet.id, kind: "detail", note: "Not in your file: 900" },
      { itemId: bullet.id, kind: "label", note: "Label added by AI" },
    ]);
    expect(result.unused).toEqual(["forecasting", "stock", "outs", "review"]);
  });
});

describe("convertResume: a different layout", () => {
  // Two columns read across: dates and places on the left, jobs on the right, no bullet marks, a heading in capitals.
  const text = [
    "MARIA SANTOS",
    "maria.santos@example.com 514-555-0199 Montréal, QC",
    "PROFILE",
    "Logistics coordinator who keeps carriers on schedule.",
    "EXPERIENCE",
    "2021 - 2024 Brightline Logistics, Montréal",
    "Operations Coordinator",
    "Coordinated 14 carriers across Québec and Ontario",
    "Cut late deliveries by 18% in one year",
    "2018 - 2021 Harbourfront Freight, Halifax",
    "Dispatcher",
    "Scheduled 40 drivers each week",
    "Page 2 of 2",
    "CERTIFICATIONS",
    "Forklift Safety, 2019",
    "TOOLS",
    "SAP, Excel",
  ].join("\n");
  const reply = {
    header: { name: "Maria Santos", contact: ["maria.santos@example.com 514-555-0199 Montréal, QC"] },
    sections: [
      { heading: "Professional summary", items: [it_("line", "Logistics coordinator who keeps carriers on schedule.")] },
      { heading: "Work experience", items: [
        it_("org", "Brightline Logistics", "", "Montréal"),
        it_("title", "Operations Coordinator", "", "2021 - 2024"),
        it_("bullet", "Coordinated 14 carriers across Québec and Ontario", "Carrier coordination"),
        it_("bullet", "Cut late deliveries by 18% in one year", "Late deliveries"),
        it_("org", "Harbourfront Freight", "", "Halifax"),
        it_("title", "Dispatcher", "", "2018 - 2021"),
        it_("bullet", "Scheduled 40 drivers each week", "Scheduled drivers"),
      ] },
      { heading: "Certifications", items: [it_("line", "Forklift Safety, 2019")] },
      { heading: "Skills and qualifications", items: [it_("skill", "SAP, Excel", "Tools")] },
    ],
  };

  it("keeps the person's order, puts dates on titles and keeps the other section under its own heading", async () => {
    const result = await convertResume(text, fakeDeps(reply).deps, { db: "d" });
    expect(result.sections.map((s) => s.heading)).toEqual([HEADER_HEADING, "Professional summary", "Work experience", "Certifications", "Skills and qualifications"]);
    const work = result.sections[2].items;
    expect(work.map((i) => i.kind)).toEqual(["org", "title", "bullet", "bullet", "org", "title", "bullet"]);
    expect(work[1]).toMatchObject({ text: "Operations Coordinator", right: "2021 - 2024" });
    expect(work[4]).toMatchObject({ text: "Harbourfront Freight", right: "Halifax" });
    expect(result.sections[3].items[0].kind).toBeUndefined();
    expect(result.sections[4].items[0]).toMatchObject({ kind: "skill", label: "Tools", text: "SAP, Excel" });
  });

  it("flags only the labels the model wrote itself, and ignores the page number", async () => {
    const result = await convertResume(text, fakeDeps(reply).deps, { db: "d" });
    const work = result.sections[2].items;
    // "Carrier coordination" isn't from the bullet's words ("coordination" isn't in the file) but "Late deliveries" and "Scheduled drivers" are
    expect(result.flags).toEqual([{ itemId: work[2].id, kind: "label", note: "Label added by AI" }]);
    expect(result.unused).not.toContain("page");
    expect(result.unused).toEqual([]);
  });

  it("never saves anything and returns fresh ids", async () => {
    const withIds = { ...reply, sections: reply.sections.map((s) => ({ ...s, id: "x", items: s.items.map((i) => ({ ...i, id: "y" })) })) };
    const result = await convertResume(text, fakeDeps(withIds).deps, { db: "d" });
    const all = result.sections.flatMap((s) => [s.id, ...s.items.map((i) => i.id)]);
    expect(all).not.toContain("x");
    expect(all).not.toContain("y");
    expect(new Set(all).size).toBe(all.length);
  });
});
