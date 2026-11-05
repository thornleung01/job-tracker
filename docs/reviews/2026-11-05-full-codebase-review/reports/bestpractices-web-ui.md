# Best practices review: web UI layers (full-codebase pass)

Repo: /Users/thorn.leung/job-tracker, branch easy-connect. Scope: web/src/pages, web/src/components, web/src/app, web/src/styles, all component CSS, web/index.html, web/public/*.html. Read-only review, nothing in the repo was changed.

## Tech stack and conventions

- React 19 + TypeScript strict + Vite, hash router, Dexie liveQuery behind a small `useQuery` hook. No ESLint, no StrictMode.
- Conventions taken as Priority 1: DESIGN.md (tokens, sentence case, no underlined links, Lucide only, in-place confirms, `--tap` sizing, motion gated), one stylesheet per component, `useAction` for busy/error/status, `Notice` for messages, role=alert for errors.
- Where the codebase deliberately departs from a generic best practice I did not flag it: no underlines (DESIGN), redundant `role="table"` on native table elements (documented in base.css because `display:block` strips semantics), the iOS 16px input floor.

Summary: 0 Critical, 10 Important, 13 Suggestion.

---

## Critical

None. Nothing I found loses data silently, breaks a core flow end to end, or opens a hole. The detail-page state bug (BP-UI-1) and the focus-drop bug (BP-UI-2) are the closest.

---

## Important

### BP-UI-1: Routes with params reuse component state, so the detail page shows and acts on stale state after navigating between applications
Files: /Users/thorn.leung/job-tracker/web/src/app/App.tsx:169 (`<PageHost match=... />`, no key), /Users/thorn.leung/job-tracker/web/src/pages/detail/index.tsx:34-63, :123-131, /Users/thorn.leung/job-tracker/web/src/app/useQuery.ts:8-18

Evidence:
```tsx
// App.tsx
<PageHost match={match} db={db} user={user} loaders={loaders} />      // same element type for /app/5 and /app/6
// detail/index.tsx
const [step, setStep] = useState<"merge" | "delete" | null>(null);
const [notice, setNotice] = useState<string | null>(null);
...
await mergeApplications(db, id, mergeInto);
navigate(`/app/${mergeInto}`);                                         // DetailPage instance is reused
// useQuery.ts: next: setValue, never reset when deps change
```
Why it matters: after Merge, the router goes from `/app/5` to `/app/6` but React keeps the same `DetailPage`. `step` is still `"merge"`, so the target application opens with the danger "Merge applications" form already showing. `notice`, `act.status`, the merge target, the Log-a-step note and date inside `ApplicationPanel` (its `body`, `label` state) also carry over. `useQuery` keeps the previous value until the new query emits, so app 5's heading and facts render under app 6's URL, and `focusHeading` (App.tsx:125-132) fires on the path change and focuses that stale h1, so a screen reader hears the wrong company name. A "Saved." notice from a person edit also lives forever (`say` at detail/index.tsx:91 never clears it).

Fix: key the page by route identity, `<PageHost key={match.path} ... />` (the query string is excluded from `path`, so the Applications filters keep their state), or at least `<DetailPage key={id}>` in the router. Also make `useQuery` clear its value when `deps` change (`setValue(undefined)` at the top of the effect), so a different key shows the loading state, not the previous record.

### BP-UI-2: `useAction().button()` disables the control that has focus, so keyboard focus drops to the body after nearly every action
Files: /Users/thorn.leung/job-tracker/web/src/components/useAction.ts:62; consumers: pages/detail/index.tsx:182, ApplicationPanel.tsx:105,126,152, PersonCard.tsx:86,89, BulkBar.tsx:138-141, OfferDetails.tsx:60, InterviewRounds.tsx:51, pages/signin/SignIn.tsx:72,78,93, pages/flow/index.tsx:199-206, pages/settings/SettingsPage.tsx:359-362,380,412

Evidence:
```ts
const button = useCallback((key: string) => ({ ...(busy === key ? { "aria-busy": true as const } : {}), disabled: busy !== null }), [busy]);
// detail: <select name="stage" aria-label="Set stage" ... disabled={act.busy !== null} onChange={...changeStage}>
```
Why it matters: the person presses Enter/Space on "Log step", "Save offer details", "Sync now", or arrows through the stage select; `busy` flips, the focused element becomes `disabled`, and browsers apply the focus-fixup rule (focus resets to the document body; Chrome does this, Firefox is looser). When the action finishes there is no restore, so a keyboard or screen-reader user loses their place and has to Tab from the top. Only the failure path of BulkBar and the in-place editors (`useReturnFocus`) handle this. `run()` already refuses a second call (`running.current`), so the `disabled` is belt-and-braces.

Fix: stop using `disabled` for the in-flight state. Return `"aria-disabled": busy !== null || undefined` plus `"aria-busy"`, add a tiny CSS rule for `button[aria-disabled="true"]` (same 50% opacity, `cursor: not-allowed`, no hover/press), and let `run()` ignore the click. Focus then stays on the control, and the status line announces the result. Do the same for the detail stage `select` (use `aria-disabled` and ignore changes while busy).

### BP-UI-3: Five different confirm patterns, and five uses of `window.confirm` against DESIGN.md
Files: window.confirm at /Users/thorn.leung/job-tracker/web/src/components/ApplicationPanel.tsx:54,58,65, components/PersonCard.tsx:37, pages/detail/index.tsx:133. In-place versions: components/bulk/BulkDeleteConfirm.tsx:18-30, pages/detail/index.tsx:195-217, pages/settings/SettingsPage.tsx:97-112 (`Confirm`), app/LocalDataOffer.tsx:191-209.

Evidence (DESIGN.md:321 and :328): "Merge and delete confirm in place, not in a browser dialog." and "Delete asks in place, not in a browser dialog". Yet:
```tsx
if (!window.confirm("Delete this application? Its notes, steps and saved emails are removed from the app. Your mailbox isn't touched.")) return;
```
Why it matters: the same destructive action (delete an application) asks in place on the detail page and in a browser dialog from the list panel, with different copy. The dialogs cannot be styled, are blocked in some embedded browsers, and ignore the density/theme work. The in-place versions also differ in behaviour:
- Escape cancels in BulkBar and detail, but not in Settings `Confirm`.
- Focus returns to the trigger on cancel in BulkBar and detail (`closeConfirm`, `closeStep`), but not in Settings (`setConfirmDelete(false)` re-renders the "Delete all my data" button and focus is lost).
- Settings `Confirm` is `role="alertdialog" aria-label="Confirm"` with no `aria-describedby`, so the name says nothing about what is being confirmed (the others use `role="group" aria-labelledby` pointing at the question).

Fix: extract one `InlineConfirm` component (question id, help text, destructive and cancel buttons, focus to Cancel on open, Escape cancels, focus back to the opener on close, `role="group"` labelled by the question) and use it in all seven places. Replace the three `window.confirm` calls in ApplicationPanel and PersonCard (and "Not an application" on detail) with it.

### BP-UI-4: Focus is dropped after removals and results on most pages (only the bulk bar and carry-over offer handle it)
Files: /Users/thorn.leung/job-tracker/web/src/pages/review/index.tsx:35-36,98-102, components/ApplicationPanel.tsx:53-56,125, components/PersonCard.tsx:36-42, pages/settings/SettingsPage.tsx:493-510, components/bulk/BulkBar.tsx:46,126, components/quickedit/QuickStage.tsx:25,40,62, app/App.tsx:153-168 (ErrorBoundary fallback)

Evidence:
```tsx
// review: after a card is settled the card unmounts; onDone only sets a Notice (role=status) and nothing is focused
act.run(key, async () => { const done = await resolveReview(db, e.id, decision); onDone(learnedNotice(done.rules, done.cleared, prefix)); });
```
Why it matters: resolving a review email, deleting a history entry, removing a person, undoing a learned rule, restoring an ignored email, and cancelling a Settings confirm all remove or re-render the control that had focus. Keyboard and screen-reader users land on the body with no announcement that is tied to a place. BulkBar and LocalDataOffer show the right pattern (the result notice takes focus; the Notice component is `tabIndex={-1}` for exactly this reason). The 8-second Undo buttons (BulkBar, QuickStage) also vanish on a timer, possibly while focused, and the stage change itself is not announced anywhere, so the Undo appears silently. The ErrorBoundary fallback renders a role=alert but does not move focus either.

Fix: one rule for the app: when an action removes its own control, focus the result notice or the next sibling item, or the page heading if the list is now empty. Concretely: review page focuses its page-level `<Notice>` after `tell()`; ApplicationPanel focuses its existing `.panel-status` element (it already has `tabIndex={-1}` and is never focused); PersonCard/People focus the page notice; Settings `Confirm` returns focus to the opener. For the Undo timers, keep the button until blur or add a visually hidden `role="status"` line saying "Stage set to X. Undo is available for 8 seconds."

### BP-UI-5: Links inside text are visually indistinguishable from the text around them
Files: /Users/thorn.leung/job-tracker/web/src/styles/base.css:86 (`a { color: inherit; text-decoration: none; }`); instances at pages/applications/index.tsx:305,308,311,341, components/ApplicationPanel.tsx:136, pages/settings/SettingsPage.tsx:430, pages/detail/index.tsx (none styled), web/public/privacy.html (`a { color: inherit; font-weight: 500 }`)

Evidence: no generic rule styles `p a`, `.notice a`, `.help a`, `.small a`. Only a few component rules add weight (`.dup-note a`, `.setup-link`, `.signin-footer a`). So:
```tsx
<Notice>No email account connected yet. <a href="#/settings">Connect one in Settings</a> to start syncing.</Notice>
```
renders the link in the same colour and weight as the sentence, with no hover change either.
Why it matters: WCAG 1.4.1 (use of colour) and 1.4.11: a link in running text must differ by more than colour from its neighbours, and here it does not differ at all. A sighted user cannot tell "Connect one in Settings" is clickable. DESIGN.md:261 says interactivity "shows through color and tone", so the intent is a tonal cue, which is missing outside the few components that remembered it.

Fix: add one base rule, for example `p a, .notice a, .help a, .small a, li a { color: var(--ink); font-weight: 500; } p a:hover, ... { background: var(--hover); border-radius: var(--r-seg); }`, keep the underline ban, and delete the one-off copies (`.dup-note a`, `.setup-link`). Do the same in privacy.html, which has weight 500 only.

### BP-UI-6: Appearance is applied after first paint, and `--accent-l` / `--accent-d` are not defined in any stylesheet
Files: /Users/thorn.leung/job-tracker/web/src/styles/base.css:12,46,63, app/appearance.tsx:15-16,23-25, app/App.tsx:143, web/index.html

Evidence:
```css
--accent: var(--accent-l); ...   /* --accent-l is only ever set from JS: root.style.setProperty("--accent-l", ...) */
```
```tsx
useEffect(() => { if (a) applyAppearance(document.documentElement, a); }, [a?.theme, a?.density, a?.corners, a?.accent]);
```
Why it matters: until `AppearanceSync`'s effect has run (after the database opens and the settings query resolves), `--accent` is an invalid reference. `background: linear-gradient(180deg, var(--accent), var(--accent-end))` is then invalid at computed-value time, so every `.primary` button paints with no background and `--accent-ink` white text, which is invisible on the light page. In the same window users with an explicit dark theme, compact density or sharp corners get a flash of the defaults and a layout shift. The sign-in screen has the same one-frame gap before `applyDefaultAppearance()`.

Fix: put defaults in `:root` (`--accent-l: #000; --accent-d: #fff;`) so the stylesheet is valid without JS. To remove the flash, persist the last appearance (theme, density, corners, accent) in `localStorage` as a non-sensitive hint and apply it in `main.tsx` before `mount()` (CSP forbids an inline script, so do it in the module entry), then let `AppearanceSync` correct it.

### BP-UI-7: Live regions are created with their content in several places, and `aria-busy` suppresses the one message it was meant to show
Files: /Users/thorn.leung/job-tracker/web/src/components/Notice.tsx:10 (`role="status"` mounted with text), components/offer/OfferDetails.tsx:64-65, components/duplicates/DuplicateNotice.tsx:15, pages/signin/SignIn.tsx:97-101, pages/settings/SettingsPage.tsx:332 (`<p className="sr" role="status" key={saved.n}>`), app/App.tsx:38 (Loading), components/joblink/JobLinkField.tsx:30

Evidence: JobLinkField's own comment states the working pattern ("Both lines are live regions that exist before they have words, so a screen reader announces them when they fill"), and ApplicationPanel (`.panel-status`), BookmarkletCard, CopyButton and Flow's `#share-status` follow it. The others insert a new `role="status"` node already holding text, or remount it with a `key` to force a re-announce, which several screen reader and browser pairs (notably VoiceOver on iOS and NVDA with Firefox) skip. `role="alert"` insertion is the one that is reliably announced, so errors are fine.
```tsx
<p className="joblink-line small muted" id="add-link-checking" role="status" aria-busy={link.checking}>{link.checking ? "Checking the job board" : ""}</p>
```
Here `aria-busy="true"` is set in the same render the text appears, so assistive tech holds the update until busy clears, at which point the text is empty: "Checking the job board" is never spoken.
Why it matters: confirmations ("Offer details saved.", "Added Acme.", duplicate warnings, "Logging in") are inconsistently announced.

Fix: one pattern. Keep a persistent empty `role="status"` container per surface and put the text in when it changes; drop the `key` remount trick in Settings; remove `aria-busy` from the checking line (or announce "Checking" without it). `Notice` for success could render only the inner text and be hosted in a persistent status container, or success messages could simply take focus the way BulkBar's do.

### BP-UI-8: Settings section links ignore reduced motion, move no focus, and share one href
File: /Users/thorn.leung/job-tracker/web/src/pages/settings/SettingsPage.tsx:312-315,321-324

Evidence:
```tsx
const jump = (id: string) => (e: React.MouseEvent) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth" }); };
<a href="#/settings" onClick={jump("accounts")}>Email accounts</a>  // all four links have href="#/settings"
```
Why it matters: `behavior: "smooth"` runs even with `prefers-reduced-motion: reduce` (DESIGN.md Motion section says motion is gated). Focus stays on the nav link, so a keyboard or screen-reader user presses a "section" link and nothing moves in their reading order. With identical hrefs, copy-link and open-in-new-tab give the same address for every link.

Fix: `behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"`, and after scrolling focus the section heading (give the `h2` `tabIndex={-1}` and call `.focus({ preventScroll: true })`). The target `section`s already have `aria-labelledby`.

### BP-UI-9: Shell and component styles live in page-scoped stylesheets that only load with the Settings or Setup chunk
Files: /Users/thorn.leung/job-tracker/web/src/pages/settings/settings.css:17,23,38-40,43-47; app/App.tsx:102 (`<p className="line">` in MailDeclinedNotice); components/BookmarkletCard.tsx:30,32 (`h2.sec`, `.field-block`); pages/setup/setup.css:20-21

Evidence:
```css
/* settings.css, loaded only by the lazy Settings page chunk */
.notice > div > .line { margin: 0; }
.field-block { margin-bottom: 28px; }
h2.sec { font-size: 1.25rem; line-height: 1.4; margin: 0 0 6px; }
```
`MailDeclinedNotice` (rendered on every page after login) uses `.line` inside a `Notice`, but the rule that zeroes its margin ships with Settings, so until the person visits Settings the notice has the browser's default paragraph margins, and afterwards it silently changes. `BookmarkletCard` lives in components/ but depends on `.sec` and `.field-block` from settings.css. `.bar` and its keyframes are defined twice (settings.css and syncbanner.css) and `.setup-sr` duplicates `.sr` from base.css.
Why it matters: it breaks the "one stylesheet per component" rule and makes appearance depend on navigation history. It is also why `h2.sec` (margin 6px) and `h2.section` (margin 16px) both exist for the same job.

Fix: move `.notice > div > .line`, `.field-block`, `.bar` and the `.sr` helper to base.css (or `Notice` gets its own `notice.css` imported by `Notice.tsx`); give `BookmarkletCard` the classes it needs in bookmarkletcard.css; collapse `.sec` into `.section`; delete `.setup-sr` in favour of `.sr`.

### BP-UI-10: Repeated buttons share one accessible name
Files: /Users/thorn.leung/job-tracker/web/src/pages/settings/SettingsPage.tsx:359,362,363 ("Reconnect account", "Disconnect account" per account row), pages/review/index.tsx:55 ("Undo" per learned rule), :74 ("Restore email" per ignored email), :124,145,150 ("Not job mail", "Add to application", "Create application" on every review card), components/ApplicationPanel.tsx:152,154 ("Delete application", "Not an application" in every open row panel)

Evidence:
```tsx
<button onClick={() => void disconnect(x.id, label)}>Disconnect account</button>   // label (the address) is not in the name
```
Why it matters: a person navigating by buttons or a voice-control user ("click Disconnect account") has several identical targets. Context is only available by reading back through the DOM. The quick-edit controls and history Delete do this well (`aria-label={`Delete ${i.kind} from ${dayText(i.when)}`}`), so the pattern exists.

Fix: add `aria-label` that includes the object ("Disconnect Gmail jane@example.com", "Undo rule: ...", "Restore email: subject", "Delete application Acme"), or put a visually hidden suffix inside the button text. Keep the visible text short.

---

## Suggestions

### BP-UI-11: Refs written during render, no hooks lint, and StrictMode is never turned on
Files: /Users/thorn.leung/job-tracker/web/src/pages/applications/index.tsx:112-114 (`toggleRef.current = toggle`), components/joblink/useJobLink.ts:50-55 (`libRef.current = lib; setRef.current = set; live.current = values`), pages/flow/index.tsx:81-82 (`phoneRef.current = phone`), app/mount.tsx:13-14, web/package.json (no eslint), nine `eslint-disable` comments (App.tsx:132, useQuery.ts:14, appearance.tsx:25, detail/index.tsx:58, applications/index.tsx:167, useJobLink.ts:137, LocalDataOffer.tsx:87, SyncBanner.tsx:154, flow/index.tsx:152)

Why: writing a ref during render is not safe under concurrent rendering (a discarded render leaves the ref holding a value that was never committed). The codebase already does it right elsewhere (`useSelection` and `SyncBanner` assign refs in `useLayoutEffect`; `LocalDataOffer` too), so the pattern is inconsistent. The disable comments refer to `react-hooks/exhaustive-deps`, but no ESLint or plugin is installed, so nothing is checking those dependency lists. `flash.ts:9` and `SyncBanner.tsx:133` describe StrictMode behaviour, yet `mount.tsx` never wraps the app in `<StrictMode>`, and no test does. One real StrictMode hazard: `SignedIn`'s `first` ref (App.tsx:125-132) is flipped in the effect itself, so under StrictMode's second effect run it would call `focusHeading` on initial load and steal focus.

Fix: assign "latest value" refs in `useLayoutEffect` (as `useSelection` does) or use `useEffectEvent`; add `eslint` with `eslint-plugin-react-hooks` (v6 also flags refs written in render and setState in effects) and wire it into `npm run build`; wrap `mount()` in `<StrictMode>` at least in dev and in the page tests.

### BP-UI-12: Effects that copy props into state can wipe what the person is typing, and `useQuery` latches errors
Files: /Users/thorn.leung/job-tracker/web/src/pages/detail/index.tsx:51-59, components/offer/OfferDetails.tsx:23-26, pages/applications/index.tsx:99-102, pages/people/index.tsx:35, app/useQuery.ts:10,16

Evidence:
```tsx
const seen = app ? `${app.id}|${app.company}|${app.role}|${app.stage}|${app.postingUrl ?? ""}` : "";
useEffect(() => { setCompany(app.company); setRole(...); setPostingUrl(...); setStageChoice(app.stage); }, [seen]);
```
Why: `seen` includes `app.stage`, so changing the stage (or a sync moving it) resets the company, role and posting link fields too, discarding text typed in an open "Edit details" form. The effect pattern costs an extra render with the old value visible for a frame. In `useQuery`, `error` is set once and never cleared, so a single failed liveQuery re-throws on every render until the boundary remounts the page.

Fix: reset each field only when its own source changed (compare per field or track `dirty`), or key the form by `app.id` and seed state from props once. Clear `error` at the start of the effect in `useQuery`.

### BP-UI-13: Dark theme loses the quiet and open-disclosure button fills; theme token blocks are duplicated
Files: /Users/thorn.leung/job-tracker/web/src/styles/base.css:149,373 (`rgba(0,0,0,.04)` to `rgba(0,0,0,.07)`), :40-73 (two copies of the dark token block), pages/flow/flow.css:6-11 (`--neutral` three times), pages/settings/settings.css:14-16 (swatches)

Evidence: `button.quiet` and `details.action[open] > summary` use black alpha with `box-shadow: none`. On `#000` or `#171717` that is essentially invisible, so "Undo", "Stop", "Dismiss", "Fill in details" and the open Edit/Reply pills have no container in dark, while in light they do. DESIGN.md says "Do take color from the tokens so light, dark and all four accents work without per-theme overrides" and "Don't hard-code #000/#fff".
Why: the dark block is copied word for word for `prefers-color-scheme` and `[data-theme="dark"]`; any new token needs two edits (and flow.css and settings.css repeat the pattern), which invites drift.

Fix: `button.quiet { background: linear-gradient(180deg, var(--hover), var(--fog)); }` (both tokens already flip in dark). To remove the duplication, either generate both blocks from one source or use `light-dark()` with `color-scheme` (check your browser floor first, see BP-UI-20).

### BP-UI-14: Several controls hard-code heights below `--tap`, including on touch
Files: /Users/thorn.leung/job-tracker/web/src/styles/base.css:381-382 (34px), components/components.css:8 (34px), components/bulk/bulk.css:33 (28px), components/quickedit/quickedit.css:4,9,11 (36px, 30px, 28px), components/rounds/rounds.css:3,5 (32px, 36px)

Why: DESIGN.md says controls are 44px on touch in every density. The list's stage dropdown (30px), Undo (28px), role and date quick-edit buttons (about 26px) and Delete on history rows (34px) are the most-used phone controls. They pass WCAG 2.5.8's 24px minimum but miss the project's own target, and they bypass `--tap`, so the compact and coarse-pointer rules do not apply.

Fix: express them as `min-height: calc(var(--tap) - 8px)` with a `@media (pointer: coarse) { ... min-height: var(--tap) }` override (or just `var(--tap)` for Undo and the stage dropdown).

### BP-UI-15: Flow page accessibility and tidiness
Files: /Users/thorn.leung/job-tracker/web/src/pages/flow/flow.css:20,22-23, pages/flow/index.tsx:15-25,47,194,212,215,225,229,247,296, pages/flow/Sankey.tsx:117

Evidence and fixes:
- Link focus ring: `.viz-root .hit:focus-visible { stroke: var(--ink); stroke-opacity: .22; }` is a 22% ink halo over a link already drawn at .38, so the keyboard focus indicator is well under 3:1 (WCAG 1.4.11). Use a solid `outline`-style stroke (opacity 1, thinner) on the visible link instead.
- Every node and link is a tab stop (`tabIndex={0}` on each `g.node` and first `path.hit`). The table below carries the same data, so consider `tabIndex={-1}` on the chart for tabbing and keep arrow-key navigation, or at minimum say so in the label.
- Both tables have no caption or `scope` on `<th>`; add `<caption className="sr">` and `scope="col"`.
- `usePhone` calls `matchMedia(PHONE)` on every render, so the effect re-subscribes each time; use `useSyncExternalStore` with a module-level `MediaQueryList`.
- `setTip({ key, x, y })` on every `mousemove` re-renders the card and both tables; keep x/y in the layout effect via a ref and only `setTip` when `key` changes.
- 11 inline `style={{...}}` props with magic numbers (`marginTop: 12`, `marginBottom: "var(--gap)"`, `minHeight: "1.5em"`, `color: "var(--ink2)"`) break the one-stylesheet-per-component rule; move them into flow.css. Chart label sizes are `14px`/`13px` (flow.css:22-23), the one place the Rem Rule is not followed.

### BP-UI-16: Phone layout rules are split across two files and one is overridden; dead and duplicate CSS
Files: /Users/thorn.leung/job-tracker/web/src/styles/base.css:282,286-288 vs components/bulk/bulk.css:12-16; dead rules at base.css:95 (`form.who select`), :347 (`.person-name`), :375-376 (`.reply-form`), :377 (`article.sent` using the undefined `var(--linen-panel, ...)`), components.css:3 (`.f-fill`), :12 (`.panel-danger`); joblink.css:12-13 (ID selectors)

Evidence:
```css
/* base.css (phone) */ tr.app-row { grid-template-columns: 1fr auto; }   td[data-col="stage"] { grid-column: 2; grid-row: 1; }
/* bulk.css (phone)  */ tr.app-row { grid-template-columns: auto 1fr auto; }  td[data-col="stage"] { grid-column: 3; grid-row: 1; }
```
Why: the base.css grid is always overridden by bulk.css (the checkbox column is always present), and which wins depends on stylesheet order and equal specificity. Anyone changing the phone row in base.css will see no effect. A scan of every class in the CSS against the TSX found the dead selectors above (the rest of base.css is the verbatim port of the local edition, which explains them).

Fix: move the phone row grid (all three columns) into one place, base.css or a new `applist.css`, and delete the base.css rules it replaces. Remove the dead selectors, or note in base.css which ones are kept for the local edition's parity. Replace `#add-paste-box` selectors with a class.

### BP-UI-17: The review count badge is not reliably announced
File: /Users/thorn.leung/job-tracker/web/src/app/Shell.tsx:26-34

Evidence: `<span className="count" aria-label={`${n} ${n === 1 ? "email needs" : "emails need"} review`}>{n}</span>`. `aria-label` on a plain `span` (generic role) is not exposed by most screen readers, so the link reads "Needs review 3". The count changing after a sync is not announced either.

Fix: render visually hidden text inside the badge (`<span className="sr"> emails need review</span>`), and optionally mirror the count into a polite status region.

### BP-UI-18: Links that open a new tab do not say so; the bookmarklet link is focusable but inert
Files: /Users/thorn.leung/job-tracker/web/src/components/MailActions.tsx:12-13, components/PersonCard.tsx:57-58, pages/detail/index.tsx:158, components/BookmarkletCard.tsx:33; contrast with pages/setup/SetupGuide.tsx:59,216 (`<span className="setup-sr"> (opens in a new tab)</span>`)

Why: the Setup guide does this correctly; mail, person, posting links do not, and PersonCard relies on a `title` tooltip (not exposed on touch or by keyboard). The "Save to Job Tracker" bookmarklet link is a tab stop whose Enter and click do nothing (`onClick={(e) => e.preventDefault()}`), which is confusing to keyboard users even with the description; the Copy button already covers them.

Fix: share one `ExtLink` (the Setup one) and use it everywhere. For the bookmarklet, give the anchor `role="link"` plus `aria-describedby` (already there) and say "Drag, don't click" in its accessible name, or take it out of the tab order with `tabIndex={-1}`.

### BP-UI-19: Placeholder-only and aria-label-only fields, inconsistent with the rest of the app
Files: /Users/thorn.leung/job-tracker/web/src/pages/review/index.tsx:148-149 (`aria-label="Company" placeholder="Company"`), :136 (`<label htmlFor>` and a redundant `aria-label="Stage"`), pages/flow/index.tsx:48,56 (`aria-label` only), pages/detail/index.tsx:172-177 (`sr` labels plus the same text as placeholder)

Why: the Applications page and the add form use visible labels above fields (`.fgroup`); here the visible label disappears once the field has text, which hurts people with cognitive or memory difficulties and is inconsistent. The duplicate `aria-label` on the Stage select overrides its visible label.

Fix: use `.fgroup` with a visible label in the review card and Flow filters; drop the redundant `aria-label`. Keep the `sr` label approach only where space truly requires it (detail edit row).

### BP-UI-20: Browser-compat risks without a fallback
Files: /Users/thorn.leung/job-tracker/web/src/components/TimeText.tsx:32, styles/base.css:12,46,63,147,372 (`color-mix`), pages/settings/settings.css:6-12,49 (`:has`)

- `lowerMeridiem` uses a lookbehind regex literal, `(?<=\d)...`. Regex literals are parsed with the script, so on Safari older than 16.4 (iOS 16.3 and earlier) the whole chunk that imports TimeText fails to parse and the pages that use it do not load. No fallback, and esbuild cannot transpile lookbehind. Rewrite it without lookbehind (`/(\d)[\s ]*([ap])\.?m\.?(?![a-z])/gi` and keep `$1`) or set a build target that excludes those browsers.
- `--accent-end: color-mix(...)` feeds every primary button gradient; where `color-mix` is missing the declaration is invalid and the button paints transparent with white text. Baseline since 2023, so low risk, but add a plain `--accent-end: var(--accent)` line before it as a fallback.
- Settings segmented controls and swatches hide the native radio (`opacity: 0`) and signal both the checked and the focus state only through `label:has(input:...)`. Without `:has` there is no visible selected state or focus ring. Fine in current engines; guard with `@supports selector(:has(*))` or render a `data-checked` attribute from React.
- Good: `appearance: base-select` and `100cqw` are both behind `@supports` with a native fallback.

### BP-UI-21: Heading levels, document titles and the error screen
Files: /Users/thorn.leung/job-tracker/web/src/components/ApplicationPanel.tsx:85,110 (`h3.panel-h` in the list panel), app/App.tsx:121 and app/Shell.tsx:9-17, app/App.tsx:153-168

- In an open list row the panel's headings are `h3` directly under the page `h1` (the Applications page has no `h2` in that region), so the level jumps h1 to h3. Use `h2` in the list panel, or render the panel headings as `p` with a class there.
- `document.title` is `Application · Job Tracker` for every detail page; including the company name (`${app.company} · Job Tracker`) helps tab switching, history and screen-reader orientation. Unknown routes silently render Applications with the Applications title and no 404 message (`known: false` is computed but unused).
- The page-level ErrorBoundary fallback renders a role=alert but does not move focus, so the keyboard user stays on a vanished element. Focus the alert (give it `tabIndex={-1}`) in `componentDidUpdate`/a ref callback.

### BP-UI-22: Settings page robustness and size
File: /Users/thorn.leung/job-tracker/web/src/pages/settings/SettingsPage.tsx:145-157,176-179,421,438-453,56,328-331

- `void saveAppearance(...)`, `saveSettings(...).then(...)` and `disconnect()` have no `catch`, so a failed write (quota, closed database) is an unhandled rejection with no message, and the radio that was clicked silently snaps back. Wrap in one `try/catch` that calls `say("err", ...)`.
- `saveAppearance`/`toggleColumn` read the `settings` captured at render and write a whole object, so two quick changes (for example ticking two columns) make the second overwrite the first before liveQuery re-renders. Merge the patch inside the write transaction.
- The component is one 400-line function holding 12 state values, so every sync progress tick (`setProgress`) re-renders Appearance, Your data and the rest. Split into `AccountsSection`, `SyncSection`, `AppearanceSection`, `DataSection`.
- It defines its own notice markup and a local `type Notice`, shadowing the shared `Notice` component that every other page uses.

### BP-UI-23: Small correctness and duplication items
Files and notes:
- /Users/thorn.leung/job-tracker/web/src/components/Combobox.tsx:45-48: `choose(i)` does `items[i].text`; the `active` index is not clamped when `suggestions` shrink while the list is open (a sync or delete emits a new array). Use `items[i]?.text` and clamp `active` in an effect.
- `eventLabel` is copied in pages/detail/index.tsx:29 and pages/review/index.tsx:21, and `UNKNOWN_ROLE` is copied in detail, people and review although pipeline/extract.ts:8 exports it. Import them from one place.
- components/rounds/InterviewRounds.tsx:41: a handler called `useEstimate` looks like a hook to readers and to the hooks lint rule. Rename to `switchToEstimate`.
- components/PersonCard.tsx:79-84: ids are built from `c.key`, which contains `|` and, for people without an address, a name with spaces (`1|name:Jane Doe`), which is not a valid id. Use `useId()`.
- components/quickedit/QuickRole.tsx:68-69 vs QuickDate.tsx:38-40: QuickDate refocuses its field after a failed save, QuickRole does not, so after an error the disabled-then-enabled input has lost focus.
- components/useAction.ts:7-11: the fallback "Couldn't save that. Try again." is also shown for reads and deletes; "Couldn't finish that. Try again." is accurate for all of them. `SyncBanner.errorText` can show a raw `Error.message` to the person.
- Copy: "Clear" (OfferDetails.tsx:61) is the one verb-only button without an object ("Clear offer details"); setup copy says "different id" (SetupGuide.tsx:198) but "IDs" and "ID" everywhere else.

---

## Done well

- Hooks order is consistently right: every page and component that has an early return calls all of its hooks first (`ApplicationsPage`, `PeoplePage`, `ReviewPage`, `LocalBanner`, `Banner`).
- `useUserDb` closes the Dexie connection and closes again after in-flight opens settle; `SignedIn` is keyed by database name so a user switch remounts everything; `PageHost` handles loading, missing, failed with retry; a stale chunk after deploy has a recovery path.
- Router and focus: the router never writes the hash by itself, OAuth responses are not treated as routes, query-only changes do not steal focus (`match.path` is the dependency), `focusHeading` handles pages that mount their heading late and cleans up its observer and timer, a real skip link that works with the hash router.
- Dialog-like surfaces are carefully handled where done: BulkBar (focus to Cancel, Escape, refocus on failure, result takes focus), LocalDataOffer (a full focus state machine), MoreMenu (roving focus, Home/End/Escape, outside click, Tab closes), the Combobox ARIA wiring (`aria-activedescendant`, option labels).
- Quick editors save on Enter or blur, restore on Escape, return focus only for keyboard closes (`useReturnFocus`), and show `role="alert"` errors.
- `useAction` is one small, well-guarded runner (single flight, unmounted-safe), and `useSelection` keeps a stable returned object so memoised rows stay memoised (`AppRow` is `memo` with stable callbacks and plain props).
- Untrusted text is never rendered as HTML (`EmailText` rebuilds elements from a whitelist; job-link results are plain text); external links use `noopener noreferrer` and `https://` checks.
- CSS: no `!important` anywhere; tokens for colour, radius and tap size throughout; `prefers-reduced-motion` handled for transitions and the indeterminate bar; `forced-colors` handled for the last-used Google button; `@supports` guards for `base-select` and container units; the `data-col` attributes carry the phone layout as designed; dark and light contrast values are documented and the muted text values check out around 4.5:1 or better on the surfaces they sit on.
- Copy is on voice: no semicolons, no "sign in" (it is "log in" with `Continue with ...` buttons), Canadian "colour", contractions, sentence case, "email" for the message. I grepped the visible strings and found no violations.
- The Setup guide is a model for live regions and external links (persistent `role="status"` beside each Copy button, "(opens in a new tab)" text, inputs with `aria-invalid` and `aria-describedby`).

## Accessibility coverage note

Checked by reading the code (no browser or screen reader run):
- Landmarks and headings: `header`, `nav aria-label`, `main#main` with `tabIndex=-1`, h1 per page, h2/h3 order (finding BP-UI-21 for the list panel), skip link.
- Names: every input and select in the pages and components for a label, an `aria-label` or a placeholder-only case (BP-UI-19); repeated button names (BP-UI-10); icon-only controls (Settings gear and More menu are labelled).
- Focus: after navigation, after dialogs and confirms, after removals, after disabled-while-busy (BP-UI-2, 3, 4); focus-visible rules in base.css and the custom ones for the Flow chart, segmented controls and the hidden file input; keyboard traps (none found; Escape handled in menu, bulk, detail step, Combobox).
- Live regions: all `role=status` and `role=alert` usages (BP-UI-7).
- Contrast: computed the `--muted` token at its alphas on `--bg`, `--linen`, `--surface` and the tinted `--fog` rows in both themes (all at or above 4.5:1; light-on-linen is the tightest at about 4.5); the Flow focus ring (BP-UI-15), quiet buttons in dark (BP-UI-13) and in-text links (BP-UI-5) are the failures.
- Motion: transitions gated, spinner and bar handled, but Settings smooth scroll is not (BP-UI-8).
- Touch targets: grep of every `min-height` in CSS against `--tap` (BP-UI-14).
- Not covered: actual screen reader output, zoom/reflow at 400 percent, forced-colors beyond the sign-in page, the sign-in popup flow, and anything in web/src outside the listed UI directories (auth, db, sync, providers, pipeline).
