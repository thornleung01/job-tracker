// Parsing and checking a tailor reply: ids, placement, caps, flags, the cover letter, and prompt injection from a posting.
import { describe, expect, it } from "vitest";
import { AiError, checkTailored, parseTailorReply } from "../../src/ai";
import { MAX_DOC_ITEM_CHARS } from "../../src/db/limits";
import { CTX, PARTS, goodReply } from "./tailorFixture";

const check = (reply = goodReply()) => checkTailored(PARTS, reply, CTX);

describe("parseTailorReply", () => {
  it("accepts a good reply and ignores extra properties (a model can't smuggle in a header)", () => {
    const parsed = parseTailorReply({ ...goodReply(), header: { name: "Evil" }, jobs: goodReply().jobs.map((j) => ({ ...j, title: "CEO" })) });
    expect(parsed).toEqual(goodReply());
    expect(parsed).not.toHaveProperty("header");
  });

  it("rejects a reply of the wrong shape", () => {
    for (const bad of [null, "x", [], {}, { ...goodReply(), skills: "SQL" }, { ...goodReply(), jobs: [1] }, { ...goodReply(), summary: 4 }, { ...goodReply(), cover: { paragraphs: [3] } }, { ...goodReply(), cover: { paragraphs: [] } }]) {
      expect(() => parseTailorReply(bad)).toThrow(AiError);
    }
    expect(() => parseTailorReply({})).toThrow(expect.objectContaining({ code: "badReply" }));
  });

  it("cuts long text and long lists", () => {
    const long = "x".repeat(MAX_DOC_ITEM_CHARS + 50);
    const parsed = parseTailorReply({ ...goodReply(), summary: long, cover: { paragraphs: Array(9).fill("A paragraph.") } });
    expect(parsed.summary).toHaveLength(MAX_DOC_ITEM_CHARS);
    expect(parsed.cover.paragraphs).toHaveLength(5);
  });
});

describe("checkTailored: a good reply", () => {
  it("keeps order, marks what changed, and flags nothing", () => {
    const out = check();
    expect(out.skills.map((s) => s.sourceId)).toEqual(["k2", "k1"]);
    expect(out.skills[0]).toMatchObject({ label: "Programming", changed: false });
    expect(out.skills[1]).toMatchObject({ text: "Excel, Tableau", changed: true });
    expect(out.jobs.map((j) => j.bullets.map((b) => b.sourceId))).toEqual([["b2", "b1"], ["b4"]]);
    expect(out.jobs[0].dropped.map((b) => b.id)).toEqual(["b3"]);
    expect(out.summary).toMatchObject({ sourceId: "sum1", changed: true, flags: [] });
    expect([...out.skills, ...out.jobs.flatMap((j) => j.bullets)].flatMap((l) => l.flags)).toEqual([]);
    expect(out.cover.flags).toEqual([]);
  });
});

describe("checkTailored: ids and placement", () => {
  it("drops unknown ids, repeats and bullets placed under the wrong job", () => {
    const r = goodReply();
    r.jobs[0].bullets.push({ sourceId: "nope", label: "X", text: "Made up." }, { sourceId: "b4", label: "Forecasting", text: "Cut stock-outs by 12% with a weekly review." }, { sourceId: "b2", label: "Reporting", text: "Again." });
    r.skills.push({ sourceId: "b1", text: "A bullet as a skill" }, { sourceId: "k1", text: "Repeat" });
    r.jobs.push({ orgId: "ghost", bullets: [{ sourceId: "b1", label: "", text: "Moved." }] });
    const out = check(r);
    expect(out.jobs[0].bullets.map((b) => b.sourceId)).toEqual(["b2", "b1"]);
    expect(out.skills.map((s) => s.sourceId)).toEqual(["k2", "k1"]);
    expect(out.jobs).toHaveLength(2);
  });

  it("caps each job's bullets at the master's count", () => {
    const r = goodReply();
    r.jobs[1].bullets = [{ sourceId: "b4", label: "Forecasting", text: "Cut stock-outs by 12%." }, { sourceId: "b4", label: "Forecasting", text: "Again." }];
    r.jobs[0].bullets = ["b1", "b2", "b3"].map((id) => ({ sourceId: id, label: "", text: "Owned the plan." }));
    const out = check(r);
    expect(out.jobs[0].bullets).toHaveLength(3);
    expect(out.jobs[1].bullets).toHaveLength(1);
  });

  it("keeps the master's own bullets for a job the model left empty or left out, and its skills when none are valid", () => {
    const r = goodReply();
    r.jobs = [{ orgId: "o1", bullets: [{ sourceId: "zzz", label: "", text: "Nothing real." }] }];
    r.skills = [{ sourceId: "zzz", text: "Fake" }];
    const out = check(r);
    expect(out.jobs[0].bullets.map((b) => b.sourceId)).toEqual(["b1", "b2", "b3"]);
    expect(out.jobs[1].bullets.map((b) => b.sourceId)).toEqual(["b4"]);
    expect(out.jobs.every((j) => j.bullets.every((b) => !b.changed && !b.flags.length))).toBe(true);
    expect(out.skills.map((s) => s.sourceId)).toEqual(["k1", "k2"]);
  });

  it("takes a skill's label from the master, not the model", () => {
    const r = goodReply();
    r.skills = [{ sourceId: "k1", text: "Excel" }];
    expect(check(r).skills[0].label).toBe("Analytics");
  });

  it("keeps the master's summary when the model sends none, and adds none when the master has none", () => {
    const r = goodReply();
    r.summary = "";
    expect(check(r).summary).toMatchObject({ changed: false, flags: [] });
    expect(checkTailored({ ...PARTS, summaryId: "", summary: "" }, goodReply(), CTX).summary).toBeNull();
  });
});

describe("checkTailored: flags", () => {
  it("flags a number, date, money, percentage, tool or name the master doesn't have", () => {
    const cases = [
      ["Grew revenue by 45% across the region.", "45"],
      ["Saved $2,000,000 in 2023.", "2023"],
      ["Reported weekly using Snowflake.", "Snowflake"],
      ["Worked closely with Margaret on the plan.", "Margaret"],
    ];
    for (const [text, missing] of cases) {
      const r = goodReply();
      r.jobs[0].bullets[0] = { sourceId: "b2", label: "Reporting", text };
      const line = check(r).jobs[0].bullets[0];
      expect(line.flags[0], text).toContain(missing);
      expect(line.changed).toBe(true);
    }
  });

  it("does not flag a number or name the master has, or a capitalised first word", () => {
    const r = goodReply();
    r.jobs[0].bullets[0] = { sourceId: "b2", label: "Reporting", text: "Led the weekly report at Northwind Traders and saved 500 hours." };
    expect(check(r).jobs[0].bullets[0].flags).toEqual([]);
  });

  it("flags a skill value and a summary that add something new", () => {
    const r = goodReply();
    r.skills[0] = { sourceId: "k2", text: "SQL, Python, Rust" };
    r.summary = "Analyst with 10 years of experience.";
    const out = check(r);
    expect(out.skills[0].flags[0]).toContain("Rust");
    expect(out.summary?.flags[0]).toContain("10");
  });

  it("flags a bullet label the model made up", () => {
    const r = goodReply();
    r.jobs[0].bullets[0] = { sourceId: "b2", label: "Blockchain strategy", text: "Automated the weekly report." };
    expect(check(r).jobs[0].bullets[0].flags).toContain("Label added by AI");
  });
});

describe("checkTailored: the cover letter", () => {
  it("flags a paragraph with a number or name that is in neither the master nor the job's company and role", () => {
    const r = goodReply();
    r.cover.paragraphs[1] = "I grew sales by 80% at Globex.";
    const { cover } = check(r);
    expect(cover.flags).toHaveLength(1);
    expect(cover.flags[0]).toMatch(/^Paragraph 2 .*80.*Globex/);
  });

  it("accepts the company and role from the job", () => {
    expect(check().cover.flags).toEqual([]);
  });

  it("drops a greeting and a sign-off the model wrote anyway", () => {
    const r = goodReply();
    r.cover.paragraphs = ["Dear Hiring Manager,", ...r.cover.paragraphs, "Sincerely, Jordan"];
    expect(check(r).cover.paragraphs).toEqual(goodReply().cover.paragraphs);
  });

  it("is a bad reply when nothing is left", () => {
    const r = goodReply();
    r.cover.paragraphs = ["Dear team,"];
    expect(() => check(r)).toThrow(expect.objectContaining({ code: "badReply" }));
  });
});

describe("checkTailored: prompt injection from the posting", () => {
  it("flags a credential the model was talked into adding, in a bullet, the summary and the letter", () => {
    const r = goodReply();
    r.summary = "Analyst with a PhD in statistics.";
    r.jobs[0].bullets[0] = { sourceId: "b2", label: "Reporting", text: "Earned a doctorate while automating the weekly report." };
    r.jobs[1].bullets[0] = { sourceId: "b4", label: "Forecasting", text: "PhD level forecasting that cut stock-outs by 12%." };
    r.cover.paragraphs[1] = "I hold a PhD and an MBA.";
    const out = check(r);
    expect(out.summary?.flags.join()).toMatch(/PhD/);
    expect(out.jobs[0].bullets[0].flags.join()).toMatch(/doctorate/);
    expect(out.jobs[1].bullets[0].flags.join()).toMatch(/PhD/);
    expect(out.cover.flags.join()).toMatch(/PhD/);
  });

  it("drops a made-up bullet or a bullet moved to another job, however it is worded", () => {
    const r = goodReply();
    r.jobs[0].bullets.push({ sourceId: "injected", label: "Education", text: "Added a PhD as the posting asked." });
    const out = check(r);
    expect(out.jobs[0].bullets.map((b) => b.text).join(" ")).not.toMatch(/PhD/);
  });

  it("never lets a reply alter the header, a company, a title or a school", () => {
    const r = { ...goodReply(), header: { name: "Evil" }, orgs: [{ id: "o1", text: "Evil Inc" }], titles: ["CEO"], schools: ["Hogwarts"] };
    expect(JSON.stringify(check(parseTailorReply(r)))).not.toMatch(/Evil|CEO|Hogwarts/);
  });
});
