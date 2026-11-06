import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { clearBackupState, parseBackupState, readBackupState, recordBackup, snoozeNudge, useBackupState } from "../../src/backup/state";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const AT = new Date("2026-11-05T15:30:00Z");

describe("backup state", () => {
  it("is empty until something is recorded", () => {
    expect(readBackupState("db-a")).toEqual({ lastBackupAt: null, snoozedAt: null });
  });

  it("keeps each account database's times apart", () => {
    recordBackup("db-a", AT);
    expect(readBackupState("db-a").lastBackupAt).toBe("2026-11-05T15:30:00Z");
    expect(readBackupState("db-b").lastBackupAt).toBeNull();
  });

  it("a snooze survives a reload (a fresh read) and is cleared by a backup", () => {
    snoozeNudge("db-a", AT);
    expect(readBackupState("db-a").snoozedAt).toBe("2026-11-05T15:30:00Z");
    recordBackup("db-a", new Date("2026-11-06T10:00:00Z"));
    expect(readBackupState("db-a")).toEqual({ lastBackupAt: "2026-11-06T10:00:00Z", snoozedAt: null });
  });

  it("snoozing keeps the last backup time", () => {
    recordBackup("db-a", AT);
    snoozeNudge("db-a", new Date("2026-11-07T10:00:00Z"));
    expect(readBackupState("db-a")).toEqual({ lastBackupAt: "2026-11-05T15:30:00Z", snoozedAt: "2026-11-07T10:00:00Z" });
  });

  it("clearing removes the key", () => {
    recordBackup("db-a", AT);
    clearBackupState("db-a");
    expect(localStorage.getItem("jobtracker:backup:db-a")).toBeNull();
  });

  it("reads hand-edited garbage as unset", () => {
    expect(parseBackupState("not json")).toEqual({ lastBackupAt: null, snoozedAt: null });
    expect(parseBackupState('{"lastBackupAt": 5, "snoozedAt": "nope"}')).toEqual({ lastBackupAt: null, snoozedAt: null });
    expect(parseBackupState("null")).toEqual({ lastBackupAt: null, snoozedAt: null });
  });

  it("is never written into the database's export: it lives outside the database", () => {
    recordBackup("db-a", AT);
    expect(Object.keys(localStorage)).toEqual(["jobtracker:backup:db-a"]);
  });

  describe("useBackupState", () => {
    const roots: { unmount(): void; el: HTMLElement }[] = [];
    afterEach(() => roots.splice(0).forEach((r) => { act(() => r.unmount()); r.el.remove(); }));

    it("re-renders when the time is recorded elsewhere in the app", async () => {
      function Probe() {
        return h("p", null, useBackupState("db-a").lastBackupAt ?? "none");
      }
      const el = document.createElement("div");
      document.body.appendChild(el);
      const root = createRoot(el);
      roots.push({ unmount: () => root.unmount(), el });
      await act(async () => root.render(h(Probe)));
      expect(el.textContent).toBe("none");
      await act(async () => recordBackup("db-a", AT));
      expect(el.textContent).toBe("2026-11-05T15:30:00Z");
    });
  });
});
