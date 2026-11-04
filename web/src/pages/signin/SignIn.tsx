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
    auth.renderGoogleButton(el, { theme: "outline", size: "large", shape: "pill", text: "signin_with" }).catch(() => {
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
          Sign in with Google
        </button>
      )}
    </>
  );
}

export function SignIn({ auth, session, configured = buildConfigured() }: SignInProps) {
  const busy = session.status === "signing-in";
  const missing = [
    !configured.google && "VITE_GOOGLE_CLIENT_ID",
    !configured.microsoft && "VITE_MS_CLIENT_ID",
  ].filter(Boolean) as string[];

  useLayoutEffect(() => {
    document.title = "Sign in · Job Tracker";
  }, []);

  return (
    <div className="wrap signin">
      <main id="main">
        <div className="brand">Job Tracker</div>
        <h1 className="page">Sign in</h1>
        {session.error && (
          <div className="notice err" role="alert">
            {session.error}
          </div>
        )}
        {missing.length > 0 && (
          <div className="notice" role="status">
            <span>
              Sign-in is not set up in this build. Set {missing.map((m, i) => (
                <span key={m}>
                  {i > 0 && " and "}
                  <code>{m}</code>
                </span>
              ))} when building.
            </span>
          </div>
        )}
        <div className="card signin-card">
          <div className="signin-actions">
            {configured.google ? (
              <GoogleSignIn auth={auth} busy={busy} />
            ) : (
              <button disabled>Sign in with Google</button>
            )}
            <button
              className={session.lastProvider === "microsoft" ? "primary" : undefined}
              disabled={busy || !configured.microsoft}
              onClick={() => void auth.signIn("microsoft").catch(() => undefined)}
            >
              Sign in with Microsoft
            </button>
          </div>
          {busy && (
            <p className="small muted" role="status">
              Signing in
            </p>
          )}
          <p className="small muted signin-privacy">
            Your data stays on this device. <a href="./privacy.html">Privacy</a>
          </p>
        </div>
      </main>
    </div>
  );
}
