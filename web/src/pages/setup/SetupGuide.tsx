import { useMemo, useState, type ReactNode } from "react";
import { config, configJsonText, isGoogleClientId, isMsClientId, type IdSource } from "../../config";
import { Notice } from "../../components/Notice";
import { actionsUrl, editConfigUrl } from "../../site";
import { googleLinks, inviteText, microsoftLinks, setupValues } from "./steps";
import "./setup.css";

/**
 * The owner's guide to turning on Google and Microsoft login. It needs no sign-in, so it imports only config, site and
 * steps. It never loads Google or Microsoft scripts and makes no network request: every link opens in a new tab.
 */

function CopyButton({ text, label, disabled }: { text: string; label: string; disabled?: boolean }) {
  const [note, setNote] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setNote("Copied.");
    } catch {
      setNote("Couldn't copy. Select the text and copy it yourself.");
    }
  }
  return (
    <span className="setup-copy">
      <button type="button" className="btn-small" disabled={disabled} aria-label={`Copy ${label}`} onClick={() => void copy()}>Copy</button>
      <span className="small muted" role="status">{note}</span>
    </span>
  );
}

function Value({ label, text }: { label: string; text: string }) {
  return (
    <div className="setup-value">
      <span className="setup-label">{label}</span>
      <div className="setup-line">
        <code>{text}</code>
        <CopyButton text={text} label={label} />
      </div>
    </div>
  );
}

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="btn btn-small" href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="setup-sr"> (opens in a new tab)</span>
    </a>
  );
}

function statusLine(name: string, source: IdSource): { text: string; bad: boolean } {
  if (source === "build" || source === "file") return { text: `${name} login is on.`, bad: false };
  if (source === "invalid") return { text: `${name} login is off. The value in site-config.json isn't valid.`, bad: true };
  return { text: `${name} login isn't set up yet.`, bad: false };
}

interface IdFieldProps {
  id: string;
  label: string;
  value: string;
  onChange(v: string): void;
  valid: boolean;
  hint: string;
  wrong: string;
}

function IdField({ id, label, value, onChange, valid, hint, wrong }: IdFieldProps) {
  const filled = value.trim() !== "";
  const feedback = !filled ? hint : valid ? "Looks right." : wrong;
  return (
    <div className="setup-field">
      <label className="field" htmlFor={id}>{label}</label>
      <input id={id} type="text" value={value} spellCheck={false} autoComplete="off" autoCapitalize="off"
        aria-invalid={filled && !valid} aria-describedby={`${id}-note`} onChange={(e) => onChange(e.target.value)} />
      <p className={`help flush${filled && !valid ? " status-bad" : ""}`} id={`${id}-note`} role="status">{feedback}</p>
    </div>
  );
}

export default function SetupGuide() {
  const values = useMemo(() => setupValues(window.location.origin, import.meta.env.BASE_URL), []);
  const [google, setGoogle] = useState(config.source.google === "file" ? config.googleClientId : "");
  const [microsoft, setMicrosoft] = useState(config.source.microsoft === "file" ? config.msClientId : "");

  const g = google.trim();
  const m = microsoft.trim();
  const gOk = g === "" || isGoogleClientId(g);
  const mOk = m === "" || isMsClientId(m);
  // Only IDs that pass their check go into the file, because the deploy test rejects anything else.
  const json = configJsonText({ googleClientId: g !== "" && gOk ? g : "", msClientId: m !== "" && mOk ? m : "" });
  const invite = inviteText(values.redirectUri);
  const gStatus = statusLine("Google", config.source.google);
  const mStatus = statusLine("Microsoft", config.source.microsoft);

  return (
    <div className="setup">
      <h1 className="page">Set up mail sync</h1>

      <section className="card" aria-labelledby="h-setup-status">
        <h2 className="sec" id="h-setup-status">This site now</h2>
        <Notice tone={gStatus.bad || mStatus.bad ? "err" : "info"}>
          <p className="line">{gStatus.text}</p>
          <p className="line">{mStatus.text}</p>
        </Notice>
      </section>

      <section className="card" aria-labelledby="h-setup-google">
        <h2 className="sec" id="h-setup-google">Google</h2>
        <ol className="setup-steps">
          <li>
            <h3>Create a project</h3>
            <p>Name it anything, like Job Tracker.</p>
            <ExtLink href={googleLinks.createProject}>Open Google Cloud</ExtLink>
          </li>
          <li>
            <h3>Enable the Gmail API</h3>
            <p>Choose Enable.</p>
            <ExtLink href={googleLinks.gmailApi}>Open the Gmail API page</ExtLink>
          </li>
          <li>
            <h3>Fill in Branding</h3>
            <p>Set the app name to Job Tracker and choose your email for the support and developer contacts. If it asks for a privacy policy link, use this one.</p>
            <Value label="Privacy policy link" text={values.privacyUrl} />
            <ExtLink href={googleLinks.branding}>Open Branding</ExtLink>
          </li>
          <li>
            <h3>Set the Audience</h3>
            <p>Choose External and leave the publishing status on Testing. Under Test users, add your own email and anyone you want to invite. You can add up to 100.</p>
            <ExtLink href={googleLinks.audience}>Open Audience</ExtLink>
          </li>
          <li>
            <h3>Add the Data access scope</h3>
            <p>Choose Add or remove scopes and add gmail.readonly. The app asks for these scopes in total.</p>
            <Value label="Google scopes" text={values.googleScopes} />
            <ExtLink href={googleLinks.dataAccess}>Open Data access</ExtLink>
          </li>
          <li>
            <h3>Create a Web application client</h3>
            <p>Choose Create client and set the application type to Web application. Under Authorized JavaScript origins, add this address. Leave the redirect URIs empty. When it's created, copy the Client ID.</p>
            <Value label="Authorized JavaScript origin" text={values.origin} />
            <ExtLink href={googleLinks.clients}>Open Clients</ExtLink>
          </li>
        </ol>
      </section>

      <section className="card" aria-labelledby="h-setup-microsoft">
        <h2 className="sec" id="h-setup-microsoft">Microsoft</h2>
        <ol className="setup-steps">
          <li>
            <h3>Start a new registration</h3>
            <p>Choose New registration. You need a free Azure account to have a directory.</p>
            <div className="row">
              <ExtLink href={microsoftLinks.appRegistrations}>Open App registrations</ExtLink>
              <ExtLink href={microsoftLinks.freeAzure}>Get a free Azure account</ExtLink>
            </div>
          </li>
          <li>
            <h3>Choose who can log in</h3>
            <p>Name it Job Tracker. Under Supported account types, choose Accounts in any organizational directory and personal Microsoft accounts.</p>
          </li>
          <li>
            <h3>Add the redirect URI</h3>
            <p>Under Redirect URI, choose Single-page application and paste this address. Then choose Register.</p>
            <Value label="Redirect URI" text={values.redirectUri} />
          </li>
          <li>
            <h3>Add the mail permission</h3>
            <p>Choose API permissions, then Add a permission, then Microsoft Graph, then Delegated permissions, and add Mail.Read. The app asks for these scopes in total.</p>
            <Value label="Microsoft scopes" text={values.msScopes} />
          </li>
          <li>
            <h3>Copy the Application (client) ID</h3>
            <p>It's on the Overview page.</p>
          </li>
        </ol>
        <p className="help">Edit this app later. Don't create a new one, because Microsoft gives each person a different id in each app and a new app would hide everyone's saved applications.</p>
      </section>

      <section className="card" aria-labelledby="h-setup-paste">
        <h2 className="sec" id="h-setup-paste">Paste your IDs</h2>
        <p className="help">You can leave one empty to skip that login.</p>
        <IdField id="setup-google-id" label="Google client ID" value={google} onChange={setGoogle} valid={gOk}
          hint="Leave this empty to skip Google."
          wrong="That doesn't look like a Google client ID. It ends in .apps.googleusercontent.com." />
        <IdField id="setup-ms-id" label="Microsoft client ID" value={microsoft} onChange={setMicrosoft} valid={mOk}
          hint="Leave this empty to skip Microsoft."
          wrong="That doesn't look like a Microsoft client ID. It's a code like 00000000-0000-0000-0000-000000000000." />
        <h3 className="setup-sub">site-config.json</h3>
        <pre className="setup-pre" aria-label="Contents of site-config.json">{json}</pre>
        <div className="row">
          <CopyButton text={json} label="site-config.json" disabled={!gOk || !mOk} />
          <a className="btn btn-small" href={editConfigUrl} target="_blank" rel="noopener noreferrer">
            Open site-config.json on GitHub
            <span className="setup-sr"> (opens in a new tab)</span>
          </a>
        </div>
        <p className="help">On GitHub, replace the contents with the text above and commit it to main. If main is protected, GitHub turns the edit into a pull request, so merge it.</p>
        <p className="help">The site updates when the deploy finishes, a few minutes after the commit. <a className="setup-link" href={actionsUrl} target="_blank" rel="noopener noreferrer">Watch it on GitHub Actions<span className="setup-sr"> (opens in a new tab)</span></a>.</p>
      </section>

      <section className="card" aria-labelledby="h-setup-invite">
        <h2 className="sec" id="h-setup-invite">Invite someone</h2>
        <p>Add their Gmail address under Test users first. Outlook needs nothing.</p>
        <div className="row field-block">
          <ExtLink href={googleLinks.audience}>Open the Google test users page</ExtLink>
        </div>
        <h3 className="setup-sub">Message to send</h3>
        <pre className="setup-pre" aria-label="Invite message">{invite}</pre>
        <CopyButton text={invite} label="invite message" />
      </section>
    </div>
  );
}
