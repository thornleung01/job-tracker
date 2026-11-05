import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Session } from "../../auth/session";
import type { ShellAuth } from "../../app/authApi";
import { config } from "../../config";
import "./signin.css";

export interface SignInProps {
  auth: ShellAuth;
  session: Session;
  /** Which sign-in methods this build has client IDs for. Defaults to the build's config. */
  configured?: { google: boolean; microsoft: boolean };
}

const buildConfigured = () => ({ google: config.googleClientId !== "", microsoft: config.msClientId !== "" });

function GoogleSignIn({ auth, busy }: { auth: ShellAuth; busy: boolean }) {
  const holder = useRef<HTMLDivElement>(null);
  // Google's own button is the dependable path. If its script cannot load, fall back to the One Tap prompt.
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    let live = true;
    el.replaceChildren();
    auth.renderGoogleButton(el, { theme: "outline", size: "large", shape: "pill", text: "continue_with" }).catch(() => {
      if (live) setFallback(true);
    });
    return () => {
      live = false;
      el.replaceChildren();
    };
  }, [auth]);

  return (
    <>
      <div ref={holder} className="google-button" hidden={fallback} />
      {fallback && (
        <button disabled={busy} onClick={() => void auth.signIn("google").catch(() => undefined)}>
          Log in with Google
        </button>
      )}
    </>
  );
}

export function SignIn({ auth, session, configured = buildConfigured() }: SignInProps) {
  const busy = session.status === "signing-in";
  const none = !configured.google && !configured.microsoft;

  useLayoutEffect(() => {
    document.title = "Log in · Job Tracker";
  }, []);

  return (
    <div className="wrap signin">
      <main id="main">
        <div className="brand">Job Tracker</div>
        <h1 className="page">Log in</h1>
        <p className="lede">Follow your job applications from the emails in your own mailbox. Your data stays in this browser.</p>
        {session.error && (
          <div className="notice err" role="alert">
            {session.error}
          </div>
        )}
        {none && (
          <div className="notice" role="status">
            Login isn't available on this site yet.
          </div>
        )}
        <div className="card signin-card">
          <div className="signin-actions">
            {configured.google && <GoogleSignIn auth={auth} busy={busy} />}
            {configured.microsoft && (
              <button
                className={session.lastProvider === "microsoft" ? "primary" : undefined}
                disabled={busy}
                onClick={() => void auth.signIn("microsoft").catch(() => undefined)}
              >
                Log in with Microsoft
              </button>
            )}
          </div>
          {!none && (!configured.google || !configured.microsoft) && (
            <p className="small muted">{configured.google ? "Microsoft" : "Google"} login isn't available on this site yet.</p>
          )}
          {busy && (
            <p className="small muted" role="status">
              Logging in
            </p>
          )}
          <p className="small muted signin-privacy">
            <a href="./privacy.html">Privacy</a>
          </p>
        </div>
      </main>
    </div>
  );
}
