import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { dbNameFor, type AuthUser } from "../auth/user";
import { openDatabase, type JobTrackerDB } from "../db/schema";
import { SignIn } from "../pages/signin/SignIn";
import { AppearanceSync, applyDefaultAppearance } from "./appearance";
import { defaultAuth, type ShellAuth } from "./authApi";
import { ErrorBoundary } from "./ErrorBoundary";
import { focusHeading } from "./focus";
import { matchRoute, navigate, type RouteMatch } from "./router";
import { defaultLoaders, type PageLoaders } from "./pages";
import { Header, PAGE_TITLES, SkipLink } from "./Shell";
import { useHash } from "./useHash";
import { usePage } from "./usePage";

export interface AppProps {
  auth?: ShellAuth;
  loaders?: PageLoaders;
  openDb?: (name: string) => JobTrackerDB;
}

function Loading() {
  return (
    <p className="muted loading" role="status">
      Loading
    </p>
  );
}

/** One database per signed-in user, opened once and closed when the user changes or signs out. */
export function useUserDb(user: AuthUser, openDb: (name: string) => JobTrackerDB): JobTrackerDB | null {
  const name = dbNameFor(user);
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

function PageHost({ match, db, user, loaders }: { match: RouteMatch; db: JobTrackerDB; user: AuthUser; loaders: PageLoaders }) {
  const [attempt, setAttempt] = useState(0);
  const state = usePage(match.page, loaders, attempt);
  if (state.status === "loading") return <Loading />;
  if (state.status === "missing") {
    return (
      <div className="notice" role="status">
        This page is not available in this build.
      </div>
    );
  }
  if (state.status === "failed") {
    return (
      <>
        <div className="notice err" role="alert">
          This page did not load. Check your connection and try again.
        </div>
        <button onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </>
    );
  }
  const Page = state.Component;
  return <Page db={db} user={user} params={match.params} query={match.query} navigate={navigate} />;
}

function SignedIn({ user, loaders, openDb }: { user: AuthUser; loaders: PageLoaders; openDb: (name: string) => JobTrackerDB }) {
  const db = useUserDb(user, openDb);
  const hash = useHash();
  const match = useMemo(() => matchRoute(hash), [hash]);
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    document.title = `${PAGE_TITLES[match.page]} · Job Tracker`;
  }, [match.page]);

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
        <main id="main" ref={mainRef} tabIndex={-1}>
          <ErrorBoundary
            resetKey={match.path}
            fallback={(_error, retry) => (
              <>
                <div className="notice err" role="alert">
                  Something went wrong on this page.
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

export function App({ auth = defaultAuth, loaders = defaultLoaders, openDb = openDatabase }: AppProps) {
  const session = useSyncExternalStore(auth.subscribe, auth.getSession);
  const signedIn = session.status === "signed-in" && session.user !== null;

  useEffect(() => {
    if (!signedIn) applyDefaultAppearance();
  }, [signedIn]);

  if (signedIn) {
    return (
      <ErrorBoundary
        fallback={() => (
          <div className="wrap">
            <div className="notice err" role="alert">
              Something went wrong. Reload the page, or sign out and back in.
            </div>
            <div className="row">
              <button onClick={() => window.location.reload()}>Reload</button>
              <button onClick={() => void auth.signOut()}>Sign out</button>
            </div>
          </div>
        )}
      >
        <SignedIn key={dbNameFor(session.user!)} user={session.user!} loaders={loaders} openDb={openDb} />
      </ErrorBoundary>
    );
  }
  return <SignIn auth={auth} session={session} />;
}
