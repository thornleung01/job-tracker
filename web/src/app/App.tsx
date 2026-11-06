import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { isLocalMode } from "../config";
import { openDatabase, type JobTrackerDB } from "../db/schema";
import { BackupGuard } from "../backup/BackupGuard";
import { Notice } from "../components/Notice";
import { TrashHost } from "../components/trash/TrashHost";
import { PROVIDER_LABEL } from "../sync/accountLabel";
import { SyncBanner, defaultDeps as syncBannerDefaults, type SyncBannerDeps } from "../components/SyncBanner";
import { SignIn } from "../pages/signin/SignIn";
import { AppearanceSync, applyAppearance, applyDefaultAppearance, readLookHint } from "./appearance";
import type { Session } from "../auth";
import { defaultAuth, type ShellAuth } from "./authApi";
import { LocalBanner } from "./LocalBanner";
import { LocalDataOffer } from "./LocalDataOffer";
import { dbNameForUser, isLocalUser, LOCAL_USER, type PageUser } from "./localUser";
import { ErrorBoundary } from "./ErrorBoundary";
import { focusHeading } from "./focus";
import { matchRoute, movedTo, navigate, type RouteMatch } from "./router";
import { defaultLoaders, type PageLoaders } from "./pages";
import { Header, PAGE_TITLES, SkipLink } from "./Shell";
import { useHash } from "./useHash";
import { usePage } from "./usePage";

export interface AppProps {
  auth?: ShellAuth;
  loaders?: PageLoaders;
  openDb?: (name: string) => JobTrackerDB;
  /**
   * Run without sign-in against the one local database. Left out, it is the build's own answer (isLocalMode: true
   * only when the build has no client IDs). Only tests pass it; nothing reads it from the URL or storage.
   */
  local?: boolean;
}

// The setup guide has no auth in it, so the signed-out screen can show it without a user or a database.
const SetupGuide = lazy(() => import("../pages/setup/SetupGuide"));

function Loading() {
  return (
    <p className="muted loading" role="status">
      Loading
    </p>
  );
}

/** One database per signed-in user (or the one local database), opened once and closed when the user changes or signs out. */
export function useUserDb(user: PageUser, openDb: (name: string) => JobTrackerDB): JobTrackerDB | null {
  const name = dbNameForUser(user);
  const [open, setOpen] = useState<{ name: string; db: JobTrackerDB } | null>(null);
  useEffect(() => {
    const db = openDb(name);
    setOpen({ name, db });
    return () => {
      db.close();
      // Dexie can finish an open that was already in flight after close() returns, which would leave the previous
      // user's database open. Close again once that settles.
      for (const ms of [0, 50, 250]) setTimeout(() => { if (db.isOpen()) db.close(); }, ms);
    };
  }, [name, openDb]);
  return open?.name === name ? open.db : null;
}

function PageHost({ match, db, user, loaders }: { match: RouteMatch; db: JobTrackerDB; user: PageUser; loaders: PageLoaders }) {
  const [attempt, setAttempt] = useState(0);
  const state = usePage(match.page, loaders, attempt);
  if (state.status === "loading") return <Loading />;
  if (state.status === "missing") {
    return (
      <div className="notice" role="status">
        This page isn't available.
      </div>
    );
  }
  if (state.status === "failed") {
    return (
      <>
        <div className="notice err" role="alert">
          This page didn't load. Check your connection and try again.
        </div>
        <button onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </>
    );
  }
  const Page = state.Component;
  // Keyed by the route, so /app/5 and /app/6 are two pages with their own state (an open merge form must not carry over).
  // The key is on the page, not on PageHost, so moving between pages doesn't flash Loading. `path` leaves out the query, so filters keep their state.
  return <Page key={match.path} db={db} user={user} params={match.params} query={match.query} navigate={navigate} />;
}

/** The sync banner reads the session and the first-sync handoff from the app's auth; connecting and tokens stay the real module's. */
function bannerDepsFor(auth: ShellAuth | undefined): Partial<SyncBannerDeps> | undefined {
  if (!auth) return undefined;
  return {
    auth: { ...syncBannerDefaults.auth, getSession: auth.getSession, subscribe: auth.subscribe, takePendingSync: auth.takePendingSync },
  };
}

/** Shown once after a login that asked for mail and didn't get it. Gone when dismissed, or when a mailbox is connected. It comes back only on the next login. */
function MailDeclinedNotice({ auth }: { auth: ShellAuth }) {
  const session = useSyncExternalStore(auth.subscribe, auth.getSession);
  const [dismissed, setDismissed] = useState(false);
  if (!session.mailDeclined || dismissed) return null;
  return (
    <Notice>
      <p className="line">{`Logged in. ${PROVIDER_LABEL[session.mailDeclined]} access wasn't allowed, so nothing will sync. Connect it in Settings.`}</p>
      <div className="row">
        <button className="quiet" onClick={() => setDismissed(true)}>Dismiss</button>
      </div>
    </Notice>
  );
}

function SignedIn({ user, loaders, openDb, auth }: { user: PageUser; loaders: PageLoaders; openDb: (name: string) => JobTrackerDB; auth?: ShellAuth }) {
  const db = useUserDb(user, openDb);
  const hash = useHash();
  const match = useMemo(() => matchRoute(hash), [hash]);
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);
  // The first sync waits until the offer to bring over earlier data has been answered (or there was nothing to offer).
  const [offerResolved, setOfferResolved] = useState(false);
  const resolveOffer = useCallback(() => setOfferResolved(true), []);
  const bannerDeps = useMemo(() => bannerDepsFor(auth), [auth]);

  useLayoutEffect(() => {
    document.title = `${PAGE_TITLES[match.page]} · Job Tracker`;
  }, [match.page]);

  // An old address (#/flow) is rewritten in place, so Back doesn't land on it again.
  useLayoutEffect(() => {
    const to = movedTo(hash);
    if (to) navigate(to, { replace: true });
  }, [hash]);

  // The saved look is read from the database, which opens after the first paint. Until then use the copy kept for this user.
  const dbName = dbNameForUser(user);
  useLayoutEffect(() => {
    const hint = readLookHint(dbName);
    if (hint) applyAppearance(document.documentElement, hint);
  }, [dbName]);

  // After a navigation (not the first paint) move focus to the new page's heading.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!mainRef.current || match.authResponse) return;
    return focusHeading(mainRef.current);
  }, [match.path]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!db) {
    return (
      <div className="wrap">
        <Loading />
      </div>
    );
  }
  return (
    <>
      <AppearanceSync db={db} />
      <SkipLink target={mainRef} />
      <div className="wrap">
        <Header db={db} page={match.page} />
        {isLocalUser(user) && <LocalBanner db={db} />}
        {!isLocalUser(user) && <LocalDataOffer db={db} onResolved={resolveOffer} />}
        {auth && !isLocalUser(user) && <MailDeclinedNotice auth={auth} />}
        {/* On every page, so the first sync starts wherever the person lands and keeps going when they move. Settings has its own buttons, so there it is quiet. A signed-in user is never a local build. */}
        {!isLocalUser(user) && <SyncBanner db={db} user={user} deps={bannerDeps} autoStart={offerResolved} quiet={match.page === "settings"} />}
        <BackupGuard db={db} page={match.page} />
        <main id="main" ref={mainRef} tabIndex={-1}>
          <TrashHost db={db} />
          <ErrorBoundary
            resetKey={match.path}
            fallback={(_error, retry) => (
              <>
                <div className="notice err" role="alert" tabIndex={-1} ref={(el) => el?.focus()}>
                  Something went wrong on this page. Try again, or go back to Applications.
                </div>
                <div className="row">
                  <button onClick={retry}>Try again</button>
                  <a className="btn" href="#/">
                    Applications
                  </a>
                </div>
              </>
            )}
          >
            <PageHost match={match} db={db} user={user} loaders={loaders} />
          </ErrorBoundary>
        </main>
      </div>
    </>
  );
}

function SignedInBoundary({ user, loaders, openDb, onSignOut, auth }: { user: PageUser; loaders: PageLoaders; openDb: (name: string) => JobTrackerDB; onSignOut?: () => void; auth?: ShellAuth }) {
  return (
    <ErrorBoundary
      fallback={() => (
        <div className="wrap">
          <div className="notice err" role="alert">
            {onSignOut ? "Something went wrong. Reload the page, or log out and back in." : "Something went wrong. Reload the page."}
          </div>
          <div className="row">
            <button onClick={() => window.location.reload()}>Reload page</button>
            {onSignOut && <button onClick={onSignOut}>Log out</button>}
          </div>
        </div>
      )}
    >
      <SignedIn key={dbNameForUser(user)} user={user} loaders={loaders} openDb={openDb} auth={auth} />
    </ErrorBoundary>
  );
}

/** No sign-in: no auth call of any kind is made on this path. */
function LocalApp({ loaders, openDb }: { loaders: PageLoaders; openDb: (name: string) => JobTrackerDB }) {
  return <SignedInBoundary user={LOCAL_USER} loaders={loaders} openDb={openDb} />;
}

function AuthedApp({ auth, loaders, openDb }: { auth: ShellAuth; loaders: PageLoaders; openDb: (name: string) => JobTrackerDB }) {
  const session = useSyncExternalStore(auth.subscribe, auth.getSession);
  const signedIn = session.status === "signed-in" && session.user !== null;

  // Layout effect, so the sign-in screen is never painted for a frame with the previous look.
  useLayoutEffect(() => {
    if (!signedIn) applyDefaultAppearance();
  }, [signedIn]);

  if (signedIn) {
    return <SignedInBoundary user={session.user!} loaders={loaders} openDb={openDb} onSignOut={() => void auth.signOut()} auth={auth} />;
  }
  return <SignedOut auth={auth} session={session} />;
}

/** The sign-in screen, or the site setup guide when the address is #/setup (the owner sets the site up before anyone can log in). */
function SignedOut({ auth, session }: { auth: ShellAuth; session: Session }) {
  const hash = useHash();
  if (matchRoute(hash).page === "setup") {
    return (
      <main className="wrap" id="main">
        <p className="setup-back">
          <a className="setup-link" href="#/">Back to log in</a>
        </p>
        <Suspense fallback={<Loading />}>
          <SetupGuide />
        </Suspense>
      </main>
    );
  }
  return <SignIn auth={auth} session={session} />;
}

export function App({ auth = defaultAuth, loaders = defaultLoaders, openDb = openDatabase, local }: AppProps) {
  return (local ?? isLocalMode()) ? <LocalApp loaders={loaders} openDb={openDb} /> : <AuthedApp auth={auth} loaders={loaders} openDb={openDb} />;
}
