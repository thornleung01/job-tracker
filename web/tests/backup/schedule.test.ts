import { describe, expect, it } from "vitest";
import { BACKUP_STALE_DAYS, SNOOZE_DAYS, NO_BACKUP_STATE, describeLastBackup, isBackupStale, isSnoozed, nudgeDue, stampNow } from "../../src/backup/schedule";
import { DAY_MS, iso, localDay } from "../../src/db/time";

// The rules take a clock and a zone, so they are checked in zones a day or more apart rather than only the machine's own.
const ZONES = ["America/Toronto", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Europe/London", "Asia/Kolkata", "Pacific/Auckland"];
const NOW = new Date("2026-11-05T15:30:00Z");
/** An instant in the middle of the local day that is `days` calendar days before NOW's day in `zone`. */
function midDay(days: number, zone: string): string {
  const [y, m, d] = localDay(NOW, zone).split("-").map(Number);
  const target = localDay(new Date(Date.UTC(y, m - 1, d - days, 12)), "UTC");
  const hits: Date[] = [];
  for (let h = -36; h <= 36; h++) {
    const probe = new Date(Date.UTC(y, m - 1, d - days, 12) + h * 3_600_000);
    if (localDay(probe, zone) === target) hits.push(probe);
  }
  return iso(hits[Math.floor(hits.length / 2)]);
}

describe("isBackupStale", () => {
  it("is stale when there has never been a backup", () => {
    for (const zone of ZONES) expect(isBackupStale(null, NOW, zone)).toBe(true);
  });

  it.each(ZONES)("is stale after more than 14 days, not on the 14th day (%s)", (zone) => {
    expect(isBackupStale(midDay(0, zone), NOW, zone)).toBe(false);
    expect(isBackupStale(midDay(BACKUP_STALE_DAYS, zone), NOW, zone)).toBe(false);
    expect(isBackupStale(midDay(BACKUP_STALE_DAYS + 1, zone), NOW, zone)).toBe(true);
  });

  it("counts calendar days, not 24-hour spans: 23 hours across midnight is already a day", () => {
    // Under 14 days of elapsed time in both cases, but the first is on Oct 21 in Toronto (15 calendar days back), the second on Oct 22 (14).
    expect(isBackupStale("2026-10-22T03:00:00Z", NOW, "America/Toronto")).toBe(true);
    expect(isBackupStale("2026-10-22T05:00:00Z", NOW, "America/Toronto")).toBe(false);
  });

  it("is not stale for a time in the future (a clock that was wrong)", () => {
    expect(isBackupStale("2027-01-01T00:00:00Z", NOW)).toBe(false);
  });

  it("treats a value that isn't a time as never", () => {
    expect(isBackupStale("yesterday", NOW)).toBe(true);
  });
});

describe("isSnoozed", () => {
  it.each(ZONES)("hides the nudge for a week of calendar days (%s)", (zone) => {
    expect(isSnoozed(null, NOW, zone)).toBe(false);
    expect(isSnoozed(midDay(0, zone), NOW, zone)).toBe(true);
    expect(isSnoozed(midDay(SNOOZE_DAYS - 1, zone), NOW, zone)).toBe(true);
    expect(isSnoozed(midDay(SNOOZE_DAYS, zone), NOW, zone)).toBe(false);
  });
});

describe("nudgeDue", () => {
  const stale = { lastBackupAt: null, snoozedAt: null };
  it("shows for a stale backup with applications", () => {
    expect(nudgeDue({ applications: 1, state: stale, syncing: false, now: NOW })).toBe(true);
  });
  it("never shows in an empty database", () => {
    expect(nudgeDue({ applications: 0, state: stale, syncing: false, now: NOW })).toBe(false);
  });
  it("does not show while a sync runs", () => {
    expect(nudgeDue({ applications: 5, state: stale, syncing: true, now: NOW })).toBe(false);
  });
  it("does not show after a recent backup", () => {
    expect(nudgeDue({ applications: 5, state: { lastBackupAt: iso(NOW), snoozedAt: null }, syncing: false, now: NOW })).toBe(false);
  });
  it("does not show while snoozed, and comes back after the week", () => {
    const state = { ...NO_BACKUP_STATE, snoozedAt: iso(NOW) };
    expect(nudgeDue({ applications: 5, state, syncing: false, now: NOW })).toBe(false);
    expect(nudgeDue({ applications: 5, state, syncing: false, now: new Date(NOW.getTime() + SNOOZE_DAYS * DAY_MS) })).toBe(true);
  });
});

describe("describeLastBackup", () => {
  it("says never, today, yesterday and the number of days", () => {
    expect(describeLastBackup(null, NOW)).toBe("never");
    expect(describeLastBackup(iso(NOW), NOW)).toBe("today");
    expect(describeLastBackup(iso(NOW.getTime() - DAY_MS), NOW, "UTC")).toBe("yesterday");
    expect(describeLastBackup(iso(NOW.getTime() - 12 * DAY_MS), NOW, "UTC")).toBe("12 days ago");
  });
});

describe("stampNow", () => {
  it("is the ISO time, moved one second off exactly noon UTC so it is never read as a picked day", () => {
    expect(stampNow(new Date("2026-11-05T15:30:00.250Z"))).toBe("2026-11-05T15:30:00Z");
    expect(stampNow(new Date("2026-11-05T12:00:00Z"))).toBe("2026-11-05T12:00:01Z");
  });
});
