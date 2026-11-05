import { useEffect, useLayoutEffect, useState } from "react";
import type { Session } from "../../auth/session";
import type { IdentityProvider } from "../../auth/user";
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

/** Google's "G" mark, in Google's brand colours. Decorative: the button text names the action. */
function GoogleMark() {
  return (
    <svg className="google-mark" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function SignIn({ auth, session, configured = buildConfigured() }: SignInProps) {
  const busy = session.status === "signing-in";
  const none = !configured.google && !configured.microsoft;
  // The provider whose login just failed, so the person can try again without the mailbox.
  const [failed, setFailed] = useState<IdentityProvider | null>(null);

  useLayoutEffect(() => {
    document.title = "Log in · Job Tracker";
  }, []);

  // Load each provider ahead of the click, so its window can open straight from the click and not be blocked.
  useEffect(() => {
    if (configured.google) auth.prepare("google").catch(() => undefined);
    if (configured.microsoft) auth.prepare("microsoft").catch(() => undefined);
  }, [auth, configured.google, configured.microsoft]);

  // Called straight from the click handler: nothing may be awaited before the provider opens its window.
  function logIn(provider: IdentityProvider, mail: boolean) {
    setFailed(null);
    auth.signIn(provider, { mail }).catch(() => setFailed(provider));
  }

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
            {configured.google && (
              <button className={`google-btn${session.lastProvider === "google" ? " primary" : ""}`} disabled={busy} onClick={() => logIn("google", true)}>
                <GoogleMark />
                Continue with Google
              </button>
            )}
            {configured.microsoft && (
              <button className={session.lastProvider === "microsoft" ? "primary" : undefined} disabled={busy} onClick={() => logIn("microsoft", true)}>
                Continue with Microsoft
              </button>
            )}
          </div>
          {!none && (!configured.google || !configured.microsoft) && (
            <p className="small muted">{configured.google ? "Microsoft" : "Google"} login isn't available on this site yet.</p>
          )}
          {!none && (
            <p className="small muted signin-help">
              One window logs you in and lets Job Tracker read your email. Google may say it hasn't verified the app: choose Advanced, then Go to Job Tracker.
            </p>
          )}
          {failed && (
            <button className="signin-skip" disabled={busy} onClick={() => logIn(failed, false)}>
              Log in without connecting your mailbox
            </button>
          )}
          {busy && (
            <p className="small muted" role="status">
              Logging in
            </p>
          )}
          <p className="small muted signin-footer">
            <a href="./privacy.html">Privacy</a>
            <span aria-hidden="true"> · </span>
            <a href="#/setup">Site setup</a>
          </p>
        </div>
      </main>
    </div>
  );
}
