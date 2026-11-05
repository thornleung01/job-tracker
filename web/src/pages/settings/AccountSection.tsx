// "Account": who is logged in, and the Log out button. Not shown in a local build, which has no login.
import type { AuthUser } from "../../auth/user";
import type { SettingsAuth } from "./deps";

export function AccountSection({ account, auth }: { account: AuthUser; auth: Pick<SettingsAuth, "signOut"> }) {
  return (
    <section className="card" id="account" aria-labelledby="h-account">
      <h2 className="sec" id="h-account" tabIndex={-1}>Account</h2>
      <p className="help">
        Logged in as {account.name ?? account.email ?? "you"}{account.name && account.email ? ` (${account.email})` : ""} with {account.provider === "google" ? "Google" : "Microsoft"}.
      </p>
      <button onClick={() => void auth.signOut()}>Log out</button>
    </section>
  );
}
