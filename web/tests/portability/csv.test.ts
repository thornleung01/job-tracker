import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { applicationsToCsv, csvField, csvFilename, CSV_HEADERS, type CsvRow } from "../../src/portability/csv";
import { exportApplicationsCsv } from "../../src/pages/settings/exportCsv";
import { upsertAccount } from "../../src/db/repo";
import { setInterviewRounds, setOfferDetails } from "../../src/sync/actions";
import { addApp, addMail, cleanup, freshDb } from "../pages/applications/harness";

afterEach(cleanup);

const row = (over: Partial<CsvRow> = {}): CsvRow => ({
  company: "Acme", role: "Analyst", stage: "Applied", appliedAt: "2026-10-01T12:00:00Z", lastActivity: "2026-10-05T12:00:00Z",      // noon UTC is a picked day, so it reads as the same date in every time zone
  nEmails: 3, rounds: null, ...over,
});
const lines = (csv: string) => csv.replace(/^﻿/, "").split("\r\n");
/** One CSV line as its fields: commas inside quotes stay in the field, and "" is a quote. */
function fieldsOf(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c !== '"') current += c;
      else if (line[i + 1] === '"') { current += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(current); current = ""; }
    else current += c;
  }
  return [...out, current];
}

describe("csvField", () => {
  it("leaves plain text alone and writes empty for nothing", () => {
    expect(csvField("Acme")).toBe("Acme");
    expect(csvField(undefined)).toBe("");
    expect(csvField(null)).toBe("");
    expect(csvField(0)).toBe("0");
  });

  it("quotes a field with a comma, a quote, a CR or a LF, and doubles the quotes", () => {
    expect(csvField("Acme, Inc")).toBe('"Acme, Inc"');
    expect(csvField('The "best" role')).toBe('"The ""best"" role"');
    expect(csvField("line one\nline two")).toBe('"line one\nline two"');
    expect(csvField("a\rb")).toBe('"a\rb"');
  });

  it.each([
    ["=SUM(A1:A9)", "'=SUM(A1:A9)"],
    ["+1+1", "'+1+1"],
    ["-2+3", "'-2+3"],
    ["@cmd", "'@cmd"],
    ["\tcmd", "'\tcmd"],
    ["\rcmd", `"'\rcmd"`],               // a CR also forces quoting
    ["\n=1+1", `"'\n=1+1"`],             // a line break, then a formula
    ["\u00a0=1+1", "'\u00a0=1+1"],       // a no-break space counts as padding too
    ["\u00a0\u00a0@SUM(A1)", "'\u00a0\u00a0@SUM(A1)"],
  ])("defuses a formula that starts %j", (value, expected) => {
    expect(csvField(value)).toBe(expected);
  });

  it("only quotes, and does not add an apostrophe to, text that starts with a line break and no formula", () => {
    expect(csvField("\ncmd")).toBe('"\ncmd"');
  });

  it("quotes after the apostrophe goes on, so a formula with a comma stays one safe field", () => {
    expect(csvField('=HYPERLINK("http://evil.example","click")')).toBe(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
  });

  it("only touches the first character", () => {
    expect(csvField("A-B = C @ D")).toBe("A-B = C @ D");
    expect(csvField("'=already")).toBe("'=already");
  });
});

describe("applicationsToCsv", () => {
  it("starts with a UTF-8 byte order mark and ends every line, the last too, with CRLF", () => {
    const csv = applicationsToCsv([row()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.replace(/\r\n/g, "").includes("\n")).toBe(false);
    expect(Array.from(new TextEncoder().encode(csv).slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("writes the header and one row per application, with days as YYYY-MM-DD", () => {
    const csv = applicationsToCsv([
      row({ rounds: 2, postingUrl: "https://acme.example/jobs/1", offerSalary: "$120,000 + equity", offerDeadline: "2026-10-15" }),
      row({ company: "Beta", appliedAt: null, lastActivity: null, nEmails: 0 }),
    ]);
    expect(lines(csv)).toEqual([
      CSV_HEADERS.join(","),
      'Acme,Analyst,Applied,2026-10-01,2026-10-05,3,2,https://acme.example/jobs/1,"$120,000 + equity",2026-10-15',
      "Beta,Analyst,Applied,,,0,,,,",
      "",
    ]);
    expect(CSV_HEADERS.join(",")).toBe("Company,Role,Stage,Applied,Last activity,Emails,Interview rounds,Posting link,Offer salary,Offer deadline");
  });

  it("keeps a company with an accent and a comma in one field", () => {
    const csv = applicationsToCsv([row({ company: "Café, Ltd" })]);
    expect(lines(csv)[1].startsWith('"Café, Ltd",')).toBe(true);
  });

  it("stops formula injection in company, role and the link and the salary", () => {
    const csv = applicationsToCsv([row({ company: "=cmd|' /C calc'!A0", role: "+1", postingUrl: "@evil", offerSalary: "-5" })]);
    const [, data] = lines(csv);
    expect(data.startsWith(`'=cmd|' /C calc'!A0,'+1,Applied,`)).toBe(true);
    expect(data).toContain(",'@evil,'-5,");
    expect(fieldsOf(data)).toEqual(["'=cmd|' /C calc'!A0", "'+1", "Applied", "2026-10-01", "2026-10-05", "3", "", "'@evil", "'-5", ""]);
  });

  it("is only the header for an empty database", async () => {
    expect(applicationsToCsv([])).toBe(`﻿${CSV_HEADERS.join(",")}\r\n`);
    expect(await exportApplicationsCsv(freshDb())).toBe(`﻿${CSV_HEADERS.join(",")}\r\n`);
  });
});

describe("exportApplicationsCsv", () => {
  it("counts rounds the way the list does and carries the offer details", async () => {
    const db = freshDb();
    const account = await upsertAccount(db, "gmail", "me@gmail.com");
    await addApp(db, "Plain", { stage: "Applied" });
    const counted = await addApp(db, "Counted", { stage: "Offer", last: 1 });
    await addMail(db, account, counted, { event: "interview", threadId: "t1", subject: "Interview with Counted" });
    const yours = await addApp(db, "Yours", { stage: "Interview", last: 2 });
    await setInterviewRounds(db, yours, 4);
    await setOfferDetails(db, counted, { salary: "$100k", deadline: "2026-12-01" });

    const rows = lines(await exportApplicationsCsv(db)).slice(1, -1).map((l) => l.split(","));
    const by = (company: string) => rows.find((r) => r[0] === company)!;
    expect(by("Counted").slice(6)).toEqual(["1", "", "$100k", "2026-12-01"]);
    expect(by("Yours")[6]).toBe("4");
    expect(by("Plain")[6]).toBe("");
  });
});

describe("csvFilename", () => {
  it("is job-tracker-applications-YYYY-MM-DD.csv", () => {
    // Local noon: the name carries the viewer's own calendar day, in any time zone.
    expect(csvFilename(new Date(2026, 10, 5, 12, 0))).toBe("job-tracker-applications-2026-11-05.csv");
  });
});

describe("formula injection with leading spaces", () => {
  it("defuses a field that starts with spaces before the formula character", () => {
    expect(csvField("  =HYPERLINK(\"x\")")).toBe(`"'  =HYPERLINK(""x"")"`);
    expect(csvField(" @SUM(A1)")).toBe("' @SUM(A1)");
    expect(csvField("Acme")).toBe("Acme");
  });
});
