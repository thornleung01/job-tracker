// The mailbox actions behind the Mail tab and the Setup tab: Connect, Disconnect and Sync now. The same code in both places,
// so each says the same sentences and holds the same buttons while it works.
import { useState } from "react";
import { errorText, ALREADY_RUNNING } from "../../components/syncprogress/result";
import { useSyncRun } from "../../components/syncprogress/progress";
import type { AuthUser } from "../../auth/user";
import { deactivateAccount } from "../../db/repo";
import type { JobTrackerDB } from "../../db/schema";
import type { ProviderName } from "../../types";
import { PROVIDER_LABEL, connectMailbox, describeSync, isConnected, runSync } from "./actions";
import type { SettingsAuth, SettingsDeps } from "./deps";
import type { Say } from "./notice";

export function useConnect(
  db: JobTrackerDB,
  account: AuthUser | null,
  auth: SettingsAuth,
  deps: Pick<SettingsDeps, "createProvider" | "getAddress">,
  say: Say,
  clear: () => void,
) {
  const [connecting, setConnecting] = useState<ProviderName | null>(null);

  async function connect(provider: ProviderName) {
    if (!account) return;
    setConnecting(provider);
    clear();
    try {
      const { address } = await connectMailbox(db, account, provider, {
        connectMail: auth.connectMail, tokenSource: auth.tokenSource, createProvider: deps.createProvider, getAddress: deps.getAddress,
      });
      say("ok", `Connected ${PROVIDER_LABEL[provider]} ${address}.`);
    } catch (e) {
      say("err", `Couldn't connect ${PROVIDER_LABEL[provider]}. ${errorText(e)}`);
    } finally {
      setConnecting(null);
    }
  }

  async function disconnect(id: number, label: string) {
    try {
      await deactivateAccount(db, id);
      say("ok", `Disconnected ${label}. Its saved emails stay on this device.`);
    } catch (e) {
      console.error(e);
      say("err", `Couldn't disconnect ${label}. Try again.`);
    }
  }

  return { connecting, connect, disconnect };
}

/** Sync now: runs the sync with the shared progress (the banner under the header shows it too) and says how it went. `days` is how far back to scan (0: new mail only). */
export function useSyncNow(
  db: JobTrackerDB,
  account: AuthUser,
  auth: SettingsAuth,
  deps: Pick<SettingsDeps, "createProvider">,
  report: { say: Say; clear(): void },
) {
  const sync = useSyncRun();

  async function syncNow(days: number) {
    const run = sync.begin("Starting");
    if (!run) {
      report.say("ok", ALREADY_RUNNING);
      return;
    }
    report.clear();
    try {
      const result = describeSync(
        await runSync(
          db,
          { tokenSource: auth.tokenSource, createProvider: deps.createProvider, isConnected: (a) => isConnected(account, a, auth.getSession().mail) },
          { days, signal: run.signal, onAccount: run.onAccount, onProgress: run.onProgress },
        ),
      );
      report.say(result.ok ? "ok" : "err", ...result.lines);
    } catch (e) {
      console.error(e);
      report.say("err", "Sync stopped because something went wrong. Try again.");
    } finally {
      run.end();
    }
  }

  return { sync, syncNow };
}
