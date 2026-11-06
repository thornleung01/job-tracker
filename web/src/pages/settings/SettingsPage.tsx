// The Settings page: a heading, a row of links to the cards, the result message and the cards themselves. Each
// card is its own component with its own state (AccountsSection, SyncSection, AppearanceSection, DataSection,
// AccountSection). This file only holds what they share: the message at the top, the screen-reader confirmation, the
// auth session and the two queries.
import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { isLocalUser } from "../../app/localUser";
import type { PageProps } from "../../app/pageProps";
import { useQuery } from "../../app/useQuery";
import { BookmarkletCard } from "../../components/BookmarkletCard";
import { accountSummaries } from "../../sync/queries";
import { loadSettings } from "../../sync/settings";
import { AccountSection } from "./AccountSection";
import { AccountsSection } from "./AccountsSection";
import { AiSection } from "./AiSection";
import { AppearanceSection } from "./AppearanceSection";
import { DataSection } from "./DataSection";
import { SyncSection } from "./SyncSection";
import { TrashSection } from "./TrashSection";
import { NO_AUTH, defaultDeps, type SettingsDeps } from "./deps";
import type { NoticeState, Reporter } from "./notice";

export type { SettingsDeps } from "./deps";

/** How long the screen-reader confirmation is cleared before it is filled again, so repeating the same words is announced again. */
const REANNOUNCE_MS = 100;

/** The link row at the top: scrolls to a card and moves focus to its heading, without animation for people who asked for none. */
function jumpTo(id: string) {
  return (e: MouseEvent) => {
    e.preventDefault();
    const card = document.getElementById(id);
    if (!card) return;
    // jsdom (the tests) has no matchMedia or scrollIntoView, so both are optional here.
    const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView?.({ behavior: reduceMotion ? "auto" : "smooth" });
    card.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  };
}

export function SettingsView({ db, user, deps: given }: PageProps & { deps?: Partial<SettingsDeps> }) {
  const deps: SettingsDeps = { ...defaultDeps, ...given };
  // A local build (no login) has no mailbox connection, so it never touches the auth module.
  const account = isLocalUser(user) ? null : user;
  const auth = account ? deps.auth : NO_AUTH;
  const session = useSyncExternalStore(auth.subscribe, auth.getSession);
  const settings = useQuery(() => loadSettings(db), [db]);
  const accounts = useQuery(() => accountSummaries(db), [db]);

  // Bumped when "Delete all my data" forgets the AI key, so the AI card starts again from the vault's state.
  const [aiEpoch, setAiEpoch] = useState(0);
  const [notice, setNotice] = useState<NoticeState>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  // A live region that is on the page before it has words, so the change is announced.
  const [announcement, setAnnouncement] = useState("");
  const announceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(announceTimer.current), []);

  const report: Reporter = {
    say: (kind, ...lines) => setNotice({ kind, lines }),
    clear: () => setNotice(null),
    announce: (text) => {
      clearTimeout(announceTimer.current);
      setAnnouncement("");
      announceTimer.current = setTimeout(() => setAnnouncement(text), REANNOUNCE_MS);
    },
  };

  const activeAccounts = (accounts ?? []).filter((a) => a.active).length;

  return (
    <>
      <h1 className="page">Settings</h1>
      <nav className="sub" aria-label="Sections">
        <a href="#/settings" onClick={jumpTo("accounts")}>Email accounts</a>
        {account && <a href="#/settings" onClick={jumpTo("sync")}>Sync</a>}
        <a href="#/settings" onClick={jumpTo("appearance")}>Appearance</a>
        <a href="#/settings" onClick={jumpTo("ai")}>AI</a>
        <a href="#/settings" onClick={jumpTo("trash")}>Recently deleted</a>
        <a href="#/settings" onClick={jumpTo("data")}>Your data</a>
      </nav>

      {/* Not the shared Notice component: this one takes focus when it appears, so it needs a ref. */}
      {notice && (
        <div ref={noticeRef} className={`notice${notice.kind === "err" ? " err" : ""}`} role={notice.kind === "err" ? "alert" : "status"} tabIndex={-1}>
          <div>{notice.lines.map((line, i) => <p key={i} className="line">{line}</p>)}</div>
        </div>
      )}
      <p className="sr" role="status">{announcement}</p>

      <AccountsSection db={db} account={account} accounts={accounts} mail={session.mail} auth={auth} deps={deps} say={report.say} clear={report.clear} />
      {account && (
        <SyncSection db={db} account={account} activeAccounts={activeAccounts} settings={settings?.sync} auth={auth} deps={deps} report={report} />
      )}
      <AppearanceSection db={db} appearance={settings?.appearance} report={report} />
      <AiSection key={aiEpoch} db={db} deps={deps.ai} report={report} />
      <BookmarkletCard />
      <TrashSection db={db} />
      <DataSection db={db} isLocal={isLocalUser(user)} deps={deps} report={report} onKeyForgotten={() => setAiEpoch((n) => n + 1)} />
      {account && <AccountSection account={account} auth={auth} />}
    </>
  );
}
