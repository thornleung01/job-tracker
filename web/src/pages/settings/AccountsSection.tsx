// "Email accounts": the connected mailboxes with their status, and the Connect buttons. A local build has no
// mail sync, so there it is one plain line saying so.
import { lowerMeridiem } from "../../components/TimeText";
import type { AuthUser } from "../../auth/user";
import type { AccountRow, JobTrackerDB } from "../../db/schema";
import type { ProviderName } from "../../types";
import { PROVIDER_LABEL, accountLabel, connectedAddress, isConnected } from "./actions";
import type { SettingsAuth, SettingsDeps } from "./deps";
import type { Say } from "./notice";
import { useConnect } from "./useMailActions";

export type AccountSummary = AccountRow & { emailCount: number };

interface Props {
  db: JobTrackerDB;
  /** The logged-in person, or null in a local build. */
  account: AuthUser | null;
  /** undefined while loading */
  accounts: AccountSummary[] | undefined;
  /** which providers have a token in this tab */
  mail: Record<ProviderName, boolean>;
  auth: SettingsAuth;
  deps: Pick<SettingsDeps, "createProvider" | "getAddress">;
  say: Say;
  clear(): void;
}

const formatSyncTime = (iso: string) => lowerMeridiem(new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }));

export function AccountsSection({ db, account, accounts, mail, auth, deps, say, clear }: Props) {
  const { connecting, connect, disconnect } = useConnect(db, account, auth, deps, say, clear);

  if (!account) {
    return (
      <section className="card" id="accounts" aria-labelledby="h-accounts">
        <h2 className="sec" id="h-accounts" tabIndex={-1}>Email accounts</h2>
        <p className="muted">Mail sync isn't set up on this site.</p>
      </section>
    );
  }

  return (
    <section className="card" id="accounts" aria-labelledby="h-accounts">
      <h2 className="sec" id="h-accounts" tabIndex={-1}>Email accounts</h2>
      {accounts && accounts.length > 0 ? (
        <div className="account-list">
          {accounts.map((row) => {
            const label = accountLabel(row);
            const ready = row.active && isConnected(account, row, mail);
            return (
              <div className="prof" key={row.id}>
                <div className="name">
                  {label}
                  <div className="small account-status">
                    {!row.active ? <span className="muted">Disconnected</span>
                      : row.lastError ? <span className="status-bad">{row.lastError}</span>
                      : row.lastSync ? <span className="status-ok">Synced {formatSyncTime(row.lastSync)}</span>
                      : <span className="muted">Not synced yet</span>}
                    <span className="muted"> · {row.emailCount} email{row.emailCount === 1 ? "" : "s"}</span>
                  </div>
                  {row.active && (
                    <div className="small muted">{ready ? "Connected in this tab" : "Not connected in this tab. Reconnect to sync."}</div>
                  )}
                </div>
                {!row.active ? (
                  <button aria-label={`Reconnect account ${label}`} disabled={connecting !== null} onClick={() => void connect(row.provider)}>Reconnect account</button>
                ) : (
                  <>
                    {!ready && <button className="primary" aria-label={`Reconnect account ${label}`} disabled={connecting !== null} onClick={() => void connect(row.provider)}>Reconnect account</button>}
                    <button aria-label={`Disconnect account ${label}`} onClick={() => void disconnect(row.id, label)}>Disconnect account</button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted">{accounts ? "No accounts yet. Connect Gmail or Outlook below." : ""}</p>
      )}
      <div className="providers">
        {(["gmail", "outlook"] as const).map((provider) => {
          const here = mail[provider] ? connectedAddress(account, provider) : null;
          return (
            <div className="provider" key={provider}>
              <h3>{PROVIDER_LABEL[provider]}</h3>
              {here && <div className="small muted addr">Connected as {here}</div>}
              <button className={here ? undefined : "primary"} aria-busy={connecting === provider} disabled={connecting !== null} onClick={() => void connect(provider)}>
                Connect {PROVIDER_LABEL[provider]}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
