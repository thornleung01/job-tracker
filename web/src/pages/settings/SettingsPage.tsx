import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { ACCENT_COLORS } from "../../app/accents";
import { isLocalUser } from "../../app/localUser";
import type { PageProps } from "../../app/pageProps";
import { BookmarkletCard } from "../../components/BookmarkletCard";
import { lowerMeridiem } from "../../components/TimeText";
import { useQuery } from "../../app/useQuery";
import * as realAuth from "../../auth";
import type { Session } from "../../auth/session";
import { deactivateAccount } from "../../db/repo";
import { hasData, loadDemoData } from "../../demo/loadDemo";
import { clearAll, exportAllAsJson, ImportError } from "../../portability";
import { createProvider, getAddress } from "../../providers";
import { accountSummaries } from "../../sync/queries";
import {
  ACCENTS, COLUMNS, CORNERS, DENSITIES, FLOW_PERIODS, LOOKBACKS, PERIODS, SCAN_CHOICES, THEMES,
  loadSettings, saveSettings, type AppearanceSettings, type ColumnId,
} from "../../sync/settings";
import type { SyncProgress } from "../../sync/sync";
import type { ProviderName, TokenSource } from "../../types";
import {
  PROVIDER_LABEL, accountLabel, connectMailbox, connectedAddress, describeImport, describeSync, downloadText, exportFilename,
  isConnected, parseImportText, readFileText, runImport, runSync, type MailDeps, type ParsedImport,
} from "./actions";
import { csvFilename } from "../../portability/csv";
import { downloadCsv, exportApplicationsCsv } from "./exportCsv";

export interface SettingsDeps extends Pick<MailDeps, "createProvider" | "getAddress"> {
  auth: {
    getSession(): Session;
    subscribe(listener: () => void): () => void;
    signOut(): Promise<void>;
    connectMail(provider: ProviderName): Promise<void>;
    tokenSource: TokenSource;
  };
  download(filename: string, text: string): void;
  /** saves the applications spreadsheet; its own function because it is a different file type */
  downloadCsv(filename: string, text: string): void;
}

export const defaultDeps: SettingsDeps = {
  auth: {
    getSession: realAuth.getSession,
    subscribe: realAuth.subscribe,
    signOut: realAuth.signOut,
    connectMail: realAuth.connectMail,
    tokenSource: realAuth.tokenSource,
  },
  createProvider,
  getAddress,
  download: downloadText,
  downloadCsv,
};

type Notice = { kind: "ok" | "err"; lines: string[] } | null;
interface Progress {
  label: string;
  percent: number | null;
  note: string;
}

/** What Settings sees of auth in a local build: nothing. Never reaches the real auth module. */
const NO_AUTH: SettingsDeps["auth"] = {
  getSession: (() => {
    const session: Session = { status: "signed-out", user: null, mail: { gmail: false, outlook: false }, error: null, lastProvider: null, pendingSync: null };
    return () => session;
  })(),
  subscribe: () => () => undefined,
  signOut: async () => undefined,
  connectMail: async () => { throw new Error("Mail sync isn't set up on this site."); },
  tokenSource: async () => { throw new Error("Mail sync isn't set up on this site."); },
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const when = (iso: string) => lowerMeridiem(new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }));
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Segmented<T extends string>({ id, label, name, options, value, onChange }: {
  id: string; label: string; name: string; options: readonly T[]; value: T; onChange(v: T): void;
}) {
  return (
    <div className="field-block">
      <div className="field" id={id}>{label}</div>
      <div className="seg" role="radiogroup" aria-labelledby={id}>
        {options.map((o) => (
          <label key={o}>
            <input type="radio" name={name} value={o} checked={value === o} onChange={() => onChange(o)} />
            <span>{cap(o)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function Confirm({ children, confirm, onConfirm, onCancel, busy }: {
  children: ReactNode; confirm: string; onConfirm(): void; onCancel(): void; busy?: boolean;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  // Focus starts on Cancel, the safe choice for an action that cannot be undone.
  useEffect(() => cancel.current?.focus(), []);
  return (
    <div className="confirm" role="alertdialog" aria-label="Confirm">
      <p>{children}</p>
      <div className="row">
        <button className="danger" disabled={busy} onClick={onConfirm}>{confirm}</button>
        <button ref={cancel} className="quiet" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function SettingsView({ db, user, deps: given }: PageProps & { deps?: Partial<SettingsDeps> }) {
  const deps: SettingsDeps = { ...defaultDeps, ...given };
  // A local build (no sign-in) has no mailbox connection, so it never touches the auth module.
  const account = isLocalUser(user) ? null : user;
  const auth = account ? deps.auth : NO_AUTH;
  const session = useSyncExternalStore(auth.subscribe, auth.getSession);
  const settings = useQuery(() => loadSettings(db), [db]);
  const accounts = useQuery(() => accountSummaries(db), [db]);

  const [notice, setNotice] = useState<Notice>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const [saved, setSavedText] = useState({ text: "", n: 0 });
  const setSaved = (text: string) => setSavedText((s) => ({ text, n: s.n + 1 }));
  const [connecting, setConnecting] = useState<ProviderName | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [scan, setScan] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const [pendingImport, setPendingImport] = useState<{ name: string; parsed: ParsedImport } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDemo, setConfirmDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const say = (kind: "ok" | "err", ...lines: string[]) => setNotice({ kind, lines });

  // -- appearance and sync settings: saved as soon as they change ----
  async function saveAppearance(patch: Partial<AppearanceSettings>) {
    if (!settings) return;
    await saveSettings(db, "appearance", { ...settings.appearance, ...patch });
    setSaved("Appearance saved");
  }

  function toggleColumn(id: ColumnId, on: boolean) {
    if (!settings) return;
    const set = new Set(settings.appearance.columns);
    if (on) set.add(id);
    else set.delete(id);
    void saveAppearance({ columns: (Object.keys(COLUMNS) as ColumnId[]).filter((c) => set.has(c)) });
  }

  // -- accounts ----
  async function connect(provider: ProviderName) {
    if (!account) return;
    setConnecting(provider);
    setNotice(null);
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
    await deactivateAccount(db, id);
    say("ok", `Disconnected ${label}. Its saved emails stay on this device.`);
  }

  // -- sync ----
  async function syncNow() {
    if (!account) return;
    const controller = new AbortController();
    abort.current = controller;
    setNotice(null);
    setProgress({ label: "Starting", percent: null, note: "" });
    let label = "";
    try {
      const report = await runSync(
        db,
        { tokenSource: auth.tokenSource, createProvider: deps.createProvider, isConnected: (a) => isConnected(account, a, auth.getSession().mail) },
        {
          days: scan,
          signal: controller.signal,
          onAccount: (l) => {
            label = l;
            setProgress({ label: `${l}: finding emails`, percent: null, note: "" });
          },
          onProgress: (p: SyncProgress) =>
            setProgress({
              label: p.phase === "finding" ? `${label}: finding emails` : `${label}: reading ${p.done}${p.total ? ` of ${p.total}` : ""}`,
              percent: p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : null,
              note: p.note,
            }),
        },
      );
      const result = describeSync(report);
      say(result.ok ? "ok" : "err", ...result.lines);
    } catch (e) {
      console.error(e);
      say("err", "Sync stopped because something went wrong. Try again.");
    } finally {
      abort.current = null;
      setProgress(null);
    }
  }

  // -- your data ----
  async function exportData() {
    try {
      deps.download(exportFilename(), await exportAllAsJson(db));
      say("ok", "Your data was exported.");
    } catch (e) {
      console.error(e);
      say("err", "Couldn't export your data. Try again.");
    }
  }

  async function exportCsv() {
    try {
      deps.downloadCsv(csvFilename(), await exportApplicationsCsv(db));
      say("ok", "Your applications were exported.");
    } catch (e) {
      console.error(e);
      say("err", "Couldn't export your applications. Try again.");
    }
  }

  async function chooseFile(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    setNotice(null);
    try {
      setPendingImport({ name: file.name, parsed: parseImportText(await readFileText(file)) });
    } catch (e) {
      setPendingImport(null);
      importFailed(e);
    }
  }

  function importFailed(e: unknown) {
    if (e instanceof ImportError) say("err", "This file can't be imported.", ...e.problems.slice(0, 8), ...(e.problems.length > 8 ? [`And ${e.problems.length - 8} more problems.`] : []));
    else say("err", "Couldn't import this file. Try again.");
  }

  async function confirmImport() {
    if (!pendingImport) return;
    setBusy(true);
    try {
      const summary = await runImport(db, pendingImport.parsed);
      say("ok", describeImport(summary));
    } catch (e) {
      importFailed(e);
    } finally {
      setPendingImport(null);
      setBusy(false);
    }
  }

  async function startDemo() {
    setNotice(null);
    if (await hasData(db)) setConfirmDemo(true);
    else await confirmDemoLoad();
  }

  async function confirmDemoLoad() {
    setBusy(true);
    try {
      say("ok", describeImport(await loadDemoData(db)));
    } catch (e) {
      console.error(e);
      say("err", "Couldn't load the demo data. Try again.");
    } finally {
      setConfirmDemo(false);
      setBusy(false);
    }
  }

  async function deleteEverything() {
    setBusy(true);
    try {
      await clearAll(db);
      say("ok", "All your data was deleted from this device.");
    } catch (e) {
      console.error(e);
      say("err", "Couldn't delete your data. Try again.");
    } finally {
      setConfirmDelete(false);
      setBusy(false);
    }
  }

  const a = settings?.appearance;
  const active = (accounts ?? []).filter((x) => x.active);
  const jump = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth" });
  };

  return (
    <>
      <h1 className="page">Settings</h1>
      <nav className="sub" aria-label="Sections">
        <a href="#/settings" onClick={jump("accounts")}>Email accounts</a>
        {account && <a href="#/settings" onClick={jump("sync")}>Sync</a>}
        <a href="#/settings" onClick={jump("appearance")}>Appearance</a>
        <a href="#/settings" onClick={jump("data")}>Your data</a>
      </nav>

      {notice && (
        <div ref={noticeRef} className={`notice${notice.kind === "err" ? " err" : ""}`} role={notice.kind === "err" ? "alert" : "status"} tabIndex={-1}>
          <div>{notice.lines.map((l, i) => <p key={i} className="line">{l}</p>)}</div>
        </div>
      )}
      <p className="sr" role="status" key={saved.n}>{saved.text}</p>

      {account ? (
        <>
        <section className="card" id="accounts" aria-labelledby="h-accounts">
          <h2 className="sec" id="h-accounts">Email accounts</h2>
          {accounts && accounts.length > 0 ? (
            <div className="account-list">
              {accounts.map((x) => {
                const label = accountLabel(x);
                const ready = x.active && isConnected(account, x, session.mail);
                return (
                  <div className="prof" key={x.id}>
                    <div className="name">
                      {label}
                      <div className="small account-status">
                        {!x.active ? <span className="muted">Disconnected</span>
                          : x.lastError ? <span className="status-bad">{x.lastError}</span>
                          : x.lastSync ? <span className="status-ok">Synced {when(x.lastSync)}</span>
                          : <span className="muted">Not synced yet</span>}
                        <span className="muted"> · {x.emailCount} email{x.emailCount === 1 ? "" : "s"}</span>
                      </div>
                      {x.active && (
                        <div className="small muted">{ready ? "Connected in this tab" : "Not connected in this tab. Reconnect to sync."}</div>
                      )}
                    </div>
                    {!x.active ? (
                      <button disabled={connecting !== null} onClick={() => void connect(x.provider)}>Reconnect account</button>
                    ) : (
                      <>
                        {!ready && <button className="primary" disabled={connecting !== null} onClick={() => void connect(x.provider)}>Reconnect account</button>}
                        <button onClick={() => void disconnect(x.id, label)}>Disconnect account</button>
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
            {(["gmail", "outlook"] as const).map((p) => {
              const here = session.mail[p] ? connectedAddress(account, p) : null;
              return (
                <div className="provider" key={p}>
                  <h3>{PROVIDER_LABEL[p]}</h3>
                  <div className="small muted addr">{here ? `Connected as ${here}` : "Not connected in this tab"}</div>
                  <button className={here ? undefined : "primary"} aria-busy={connecting === p} disabled={connecting !== null} onClick={() => void connect(p)}>
                    Connect {PROVIDER_LABEL[p]}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card" id="sync" aria-labelledby="h-sync">
          <h2 className="sec" id="h-sync">Sync</h2>
          {progress ? (
            <div className="progress-card">
              <div className="top">
                <span role="status">{progress.label}</span>
                <span aria-hidden="true">{progress.percent !== null ? `${progress.percent}%` : ""}</span>
              </div>
              <div className={`bar${progress.percent === null ? " indet" : ""}`} role="progressbar" aria-label="Sync progress" aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={progress.percent ?? undefined}>
                <i style={progress.percent !== null ? { width: `${progress.percent}%` } : undefined} />
              </div>
              {progress.note && <div className="small" style={{ marginTop: 4 }}>{progress.note}</div>}
              <div className="row" style={{ marginTop: 12 }}>
                <button className="quiet" onClick={() => abort.current?.abort()}>Stop</button>
              </div>
            </div>
          ) : active.length > 0 ? (
            <div className="row field-block">
              <label className="sr" htmlFor="scan">What to scan</label>
              <select id="scan" value={scan} onChange={(e) => setScan(Number(e.target.value))}>
                {SCAN_CHOICES.map((c) => <option key={c.days} value={c.days}>{c.label}</option>)}
              </select>
              <button className="primary" onClick={() => void syncNow()}>Sync now</button>
            </div>
          ) : (
            <p className="muted field-block">Connect an email account above to sync.</p>
          )}

          <div className="field-block">
            <label className="field" htmlFor="lookback">Look back on first sync</label>
            <select id="lookback" value={settings?.sync.lookbackDays ?? 30} disabled={!settings}
              onChange={(e) => void saveSettings(db, "sync", { lookbackDays: Number(e.target.value) }).then(() => setSaved("Sync settings saved"))}>
              {LOOKBACKS.map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
          </div>
        </section>
        </>
      ) : (
        <section className="card" id="accounts" aria-labelledby="h-accounts">
          <h2 className="sec" id="h-accounts">Email accounts</h2>
          <p className="muted">Mail sync isn't set up on this site. <a href="#/setup">Set it up</a></p>
        </section>
      )}

      <section className="card" id="appearance" aria-labelledby="h-appearance">
        <h2 className="sec" id="h-appearance">Appearance</h2>
        {a && (
          <>
            <Segmented id="l-theme" label="Theme" name="theme" options={THEMES} value={a.theme} onChange={(theme) => void saveAppearance({ theme })} />
            <div className="field-block">
              <div className="field" id="l-accent">Accent colour</div>
              <div className="swatches" role="radiogroup" aria-labelledby="l-accent">
                {ACCENTS.map((name) => (
                  <label key={name}>
                    <input type="radio" name="accent" value={name} checked={a.accent === name} onChange={() => void saveAppearance({ accent: name })} />
                    <i style={{ "--l": ACCENT_COLORS[name].light, "--d": ACCENT_COLORS[name].dark } as CSSProperties} />
                    <span>{cap(name)}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="row pair">
              <Segmented id="l-density" label="Density" name="density" options={DENSITIES} value={a.density} onChange={(density) => void saveAppearance({ density })} />
              <Segmented id="l-corners" label="Corners" name="corners" options={CORNERS} value={a.corners} onChange={(corners) => void saveAppearance({ corners })} />
            </div>
            <div className="field-block">
              <div className="field" id="l-cols">Columns in the applications list</div>
              <p className="help">Company and Stage always show.</p>
              <div className="checks" role="group" aria-labelledby="l-cols">
                {(Object.keys(COLUMNS) as ColumnId[]).map((id) => {
                  const fixed = id === "company" || id === "stage";
                  return (
                    <label key={id}>
                      <input type="checkbox" checked={fixed || a.columns.includes(id)} disabled={fixed} onChange={(e) => toggleColumn(id, e.target.checked)} />
                      {COLUMNS[id]}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="field-block">
              <label className="field" htmlFor="flow_days">Default period on the Flow page</label>
              <select id="flow_days" value={a.flowDays} onChange={(e) => void saveAppearance({ flowDays: Number(e.target.value) })}>
                {PERIODS.filter((p) => (FLOW_PERIODS as readonly number[]).includes(p.days)).map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
              </select>
            </div>
          </>
        )}
      </section>

      <BookmarkletCard />

      <section className="card" id="data" aria-labelledby="h-data">
        <h2 className="sec" id="h-data">Your data</h2>
        <p className="help">Everything is stored in this browser. Export a copy to keep it safe or move it.</p>
        <div className="row field-block">
          <button onClick={() => void exportData()}>Export data</button>
          <button onClick={() => void exportCsv()}>Export CSV</button>
          <label className="btn file-pick">
            Import data
            <input ref={fileInput} type="file" accept=".json,application/json" className="sr" onChange={(e) => void chooseFile(e.target.files?.[0])} />
          </label>
          {isLocalUser(user) && <button disabled={busy} onClick={() => void startDemo()}>Load demo data</button>}
          {!confirmDelete && <button className="danger" onClick={() => setConfirmDelete(true)}>Delete all my data</button>}
        </div>
        {pendingImport && (
          <Confirm confirm="Replace my data" busy={busy} onConfirm={() => void confirmImport()} onCancel={() => setPendingImport(null)}>
            Replace everything in this browser with {pendingImport.name}
            {pendingImport.parsed.kind === "python" ? " (from the local edition)" : ""}? This can't be undone.
          </Confirm>
        )}
        {confirmDemo && (
          <Confirm confirm="Replace my data" busy={busy} onConfirm={() => void confirmDemoLoad()} onCancel={() => setConfirmDemo(false)}>
            Replace everything in this browser with the demo data? This can't be undone.
          </Confirm>
        )}
        {confirmDelete && (
          <Confirm confirm="Delete everything" busy={busy} onConfirm={() => void deleteEverything()} onCancel={() => setConfirmDelete(false)}>
            Delete your applications, emails and settings from this device? This can't be undone.
          </Confirm>
        )}
      </section>

      {account && (
        <section className="card" id="account" aria-labelledby="h-account">
          <h2 className="sec" id="h-account">Account</h2>
          <p className="help">
            Logged in as {account.name ?? account.email ?? "you"}{account.name && account.email ? ` (${account.email})` : ""} with {account.provider === "google" ? "Google" : "Microsoft"}.
          </p>
          <button onClick={() => void auth.signOut()}>Log out</button>
        </section>
      )}
    </>
  );
}
