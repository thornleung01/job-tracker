// The Settings page: a heading, a switcher between four sections (mail, appearance, ai, data; #/settings/:section), the
// result message and the open section's cards. Each card is its own component with its own state (AccountsSection,
// SyncSection, MailRulesSection, AppearanceSection, AiSection, DataSection, TrashSection, AccountSection). This file only holds what they share: the message at the top, the screen-reader confirmation, the
// auth session and the two queries.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isLocalUser } from "../../app/localUser";
import type { PageProps } from "../../app/pageProps";
import { useQuery } from "../../app/useQuery";
import { accountSummaries } from "../../sync/queries";
import { loadSettings } from "../../sync/settings";
import { AccountSection } from "./AccountSection";
import { AccountsSection } from "./AccountsSection";
import { AiSection } from "./AiSection";
import { AppearanceSection } from "./AppearanceSection";
import { DataSection } from "./DataSection";
import { MailRulesSection } from "./MailRulesSection";
import { SectionSwitcher, focusRequest } from "./SectionSwitcher";
import { sectionFor } from "./sections";
import { SyncSection } from "./SyncSection";
import { TrashSection } from "./TrashSection";
import { NO_AUTH, defaultDeps, type SettingsDeps } from "./deps";
import type { NoticeState, Reporter } from "./notice";

export type { SettingsDeps } from "./deps";

/** How long the screen-reader confirmation is cleared before it is filled again, so repeating the same words is announced again. */
const REANNOUNCE_MS = 100;

export function SettingsView({ db, user, params, navigate, deps: given }: PageProps & { deps?: Partial<SettingsDeps> }) {
  const deps: SettingsDeps = { ...defaultDeps, ...given };
  const section = sectionFor(params.section);
  // A local build (no login) has no mailbox connection, so it never touches the auth module.
  const account = isLocalUser(user) ? null : user;
  const auth = account ? deps.auth : NO_AUTH;
  const session = useSyncExternalStore(auth.subscribe, auth.getSession);
  const settings = useQuery(() => loadSettings(db), [db]);
  const accounts = useQuery(() => (section === "mail" ? accountSummaries(db) : []), [db, section]); // the email counts are only shown on the Mail tab

  // Bumped when "Delete all my data" forgets the AI key, so the AI card starts again from the vault's state.
  const [aiEpoch, setAiEpoch] = useState(0);
  const [notice, setNotice] = useState<NoticeState>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice?.focus) noticeRef.current?.focus();
  }, [notice]);

  // A live region that is on the page before it has words, so the change is announced.
  const [announcement, setAnnouncement] = useState("");
  const announceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(announceTimer.current), []);

  const report: Reporter = {
    say: (kind, ...lines) => setNotice({ kind, lines, focus: true }),
    sayQuietly: (kind, ...lines) => setNotice({ kind, lines, focus: false }),
    clear: () => setNotice(null),
    announce: (text) => {
      clearTimeout(announceTimer.current);
      setAnnouncement("");
      announceTimer.current = setTimeout(() => setAnnouncement(text), REANNOUNCE_MS);
    },
  };

  const activeAccounts = (accounts ?? []).filter((a) => a.active).length;

  // Moves focus to the new section's heading after a click on the switcher (the page itself is remounted by the route key).
  const pane = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusRequest.pending) return;
    focusRequest.pending = false;
    pane.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [section]);

  return (
    <>
      <h1 className="page">Settings</h1>
      <SectionSwitcher current={section} navigate={navigate} />

      {/* Not the shared Notice component: this one takes focus when it appears, so it needs a ref. */}
      {notice && (
        <div ref={noticeRef} className={`notice${notice.kind === "err" ? " err" : ""}`} role={notice.kind === "err" ? "alert" : "status"} tabIndex={-1}>
          <div>{notice.lines.map((line, i) => <p key={i} className="line">{line}</p>)}</div>
        </div>
      )}
      <p className="sr" role="status">{announcement}</p>

      <div ref={pane} className="settings-pane">
        {section === "mail" && (
          <>
            <AccountsSection db={db} account={account} accounts={accounts} mail={session.mail} auth={auth} deps={deps} say={report.say} clear={report.clear} />
            {account && (
              <SyncSection db={db} account={account} activeAccounts={activeAccounts} settings={settings?.sync} auth={auth} deps={deps} report={report} />
            )}
            <MailRulesSection db={db} />
          </>
        )}
        {section === "appearance" && <AppearanceSection db={db} appearance={settings?.appearance} report={report} />}
        {section === "ai" && <AiSection key={aiEpoch} db={db} deps={deps.ai} report={report} />}
        {section === "data" && (
          <>
            <DataSection db={db} isLocal={isLocalUser(user)} deps={deps} report={report} onKeyForgotten={() => setAiEpoch((n) => n + 1)}>
              <TrashSection db={db} />
            </DataSection>
            {account && <AccountSection account={account} auth={auth} />}
          </>
        )}
      </div>
    </>
  );
}
