// What a backup holds: the numbers the backup file's guard reads.
import { describe, expect, it } from "vitest";
import { applicationsInBackup, backupContent } from "../../src/backup/content";
import type { ExportEnvelope } from "../../src/portability";

const envelope = (data: Partial<ExportEnvelope["data"]> = {}): ExportEnvelope => ({
  format: "jobtracker-export", version: 2, exportedAt: "2026-11-05T12:00:00Z", source: "web",
  data: { accounts: [], applications: [], emails: [], activity: [], feedback: [], ignoredMail: [], learnedRules: [], contactEdits: [], settings: {}, ...data },
});
const app = (id: number, deletedAt?: string) => ({ id, deletedAt }) as ExportEnvelope["data"]["applications"][number];

describe("backupContent", () => {
  it("is not worth saving for a database that holds only accounts, emails and settings", () => {
    const empty = backupContent(envelope({ accounts: [{ id: 1 } as never], emails: [{ id: 1 } as never], settings: { theme: "dark" } }));
    expect(empty.applications).toBe(0);
    expect(empty.worthSaving).toBe(false);
  });

  it("counts applications, deleted ones included, and is worth saving", () => {
    const some = backupContent(envelope({ applications: [app(1), app(2, "2026-11-01T10:00:00Z")] }));
    expect(some.applications).toBe(2);
    expect(some.worthSaving).toBe(true);
  });

  it.each([["learnedRules"], ["contactEdits"], ["feedback"]] as const)("is worth saving when only %s were made by the person", (table) => {
    const content = backupContent(envelope({ [table]: [{ id: 1, key: "k" } as never] }));
    expect(content.applications).toBe(0);
    expect(content.worthSaving).toBe(true);
  });

  it("carries the export as the text of the file", () => {
    const e = envelope({ applications: [app(1)] });
    expect(JSON.parse(backupContent(e).text)).toEqual(JSON.parse(JSON.stringify(e)));
  });
});

describe("applicationsInBackup", () => {
  it("reads the count of an earlier export", () => {
    expect(applicationsInBackup(backupContent(envelope({ applications: [app(1), app(2), app(3)] })).text)).toBe(3);
    expect(applicationsInBackup(backupContent(envelope()).text)).toBe(0);
  });

  it.each([[""], ["not json"], ["null"], ["[]"], ['{"format":"something-else","data":{"applications":[1]}}'], ['{"format":"jobtracker-export"}'], ['{"format":"jobtracker-export","data":{"applications":"many"}}']])(
    "says null for %j, which isn't an export it can count", (text) => {
      expect(applicationsInBackup(text)).toBeNull();
    },
  );
});
