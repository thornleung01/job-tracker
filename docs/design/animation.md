## Animating the UI (fixed-size looping animations)

This section is self-contained. It replaces the `ui-animation` skill, which is no longer available. The scripts and the stage starter it relies on live in `tools/design/animation/`, outside `web/`, so the app build and `tsc` never see them (see that folder's `README.md` for exact commands). Nothing here ships in the app.

### 1. When to use it, and what you get

Use it when you need a looping, pixel-exact animation of the product UI: a README or release-note GIF, a marketing sheet, an App Store preview, a slide. Do not use it for in-app motion (that follows the Motion rule under Shapes above: 0.16s transitions, gated by `prefers-reduced-motion`).

The output is three things:

- **A React stage authored at the exact export pixels** (for example 1200 x 740). Everything inside is designed at those pixels. The page scales the stage down to fit the browser window for preview only.
- **A camera** that pushes in and pulls back between framed regions. It is a single transform on one wrapper element.
- **One flat timeline** (`SCRIPT`): absolute milliseconds, each entry a partial state patch. You retime the whole animation by editing numbers in one list.

A script then records the stage element, not the page, into a GIF and optionally an mp4.

Working rules, which matter more than any code:

- Never say it looks right unless you have screenshotted it and looked.
- A number someone gives you ("32 radius") is a rendered number. Make the screen measure that, then report the measured value (section 6).
- Figma CSS is applied verbatim as a named constant, decimals and all. Say so when the browser will not honour it (fractional borders).

### 2. Setup

#### Files (already in the repo)

All in `tools/design/animation/`:

| File | Purpose |
|---|---|
| `StageTemplate.tsx` + `stage.css` | Starter: stage, camera, SCRIPT, guides overlay, replay and scene controls. Plain CSS, because the app has no Tailwind |
| `export-gif.mjs` | Frame-exact GIF / mp4 / PNG-sequence export on a virtual clock |
| `capture.mjs` | Screenshots at timestamps plus geometry measurement |
| `package.json` | The tool's own dependencies: `motion`, `playwright`, `gifenc`, `pngjs` |
| `README.md`, `.gitignore` | Exact commands; ignores `node_modules/` and the lockfile |

#### One-time dependencies

The app has neither `motion` nor `playwright`, and `web/package.json` must not gain them. They live in the tool folder:

```bash
cd tools/design/animation
npm install
npx playwright install chromium
brew install ffmpeg        # only for --mp4
```

`StageTemplate.tsx` imports `motion/react`. A page inside `web/` cannot resolve it from the tool folder's `node_modules`. When you build a real stage, either add `motion` to `web/` as a dev dependency for that work (an owner decision, not part of this setup) or rewrite the stage with CSS transitions driven by the same SCRIPT; the camera maths is unchanged. The README says which parts were verified.

#### Start the dev server first

Start it before asking anything; it boots in about a second. Check for a running copy rather than starting a second on another port. The app serves under the Vite base `/job-tracker/`, so the root URL is not `localhost:5173/`.

```bash
curl -sf -o /dev/null http://localhost:5173/job-tracker/ && echo running || (cd web && npm run dev &)   # Vite base is "/job-tracker/" (web/vite.config.ts)
```

#### Where the stage lives in this app

The app has no experiments gallery and none should be built for this. A stage is one page plus one route.

1. Create `web/src/pages/stage/index.tsx` (copy `StageTemplate.tsx` and `stage.css` beside it; the README has the full snippet). Page files are picked up by `import.meta.glob("../pages/*/index.tsx")` in `web/src/app/pages.ts`, and default-export a component taking `PageProps`. Put the template's content there (or `web/src/pages/stage/ResumeLoop.tsx` and render it from `index.tsx`, which keeps room for a second stage later).
2. Add one row to `ROUTES` in `web/src/app/routes.ts`: `{ path: "/stage/:slug", page: "stage", nav: null }`. `nav: null` keeps it out of the header. In `index.tsx`, read `params.slug` and render the matching stage component, with a plain "Not found" line for an unknown slug.
3. The router is hash-based. The URL to bookmark and to hand to the scripts is:

   `http://localhost:5173/job-tracker/#/stage/<slug>`

   Keep the `#`. Without it the router falls back to Applications and relative asset paths break. On a deployed copy, the URL needs a trailing slash before the `#`.
4. Run `npm run typecheck` and `npm test` in `web/` after adding the route: `tests/pages/routeIds.test.ts` and the route table tests may enumerate pages.
5. Gate it to development so it does not ship: render the stage only when `import.meta.env.DEV` is true, and return the Not found line otherwise. The page is a separate lazy chunk, so the cost in production is one small file at most.

The app shell (header, nav) will wrap the page. That is fine: the scripts capture only the element `#gif-stage`, and the controls sit outside it.

Ask only what you cannot infer: the export size (for example 1200 x 740), what it goes inside (a sheet, a phone frame, a slide; this sets the safe area and whether the stage has rounded corners, usually not), and the slug, which becomes the filename and the URL.

### 3. Storyboard to SCRIPT

Take the storyboard in plain words ("everything loads in", "zoom to the form and paste", "zoom out, then into the list"). Turn it into one array. Each entry is a partial patch; unmentioned keys carry forward.

```ts
type Beat = {
  t: number               // absolute ms from loop start
  camera?: CameraKey
  step?: 0 | 1 | 2 | 3
  typing?: boolean
  press?: "save" | null
}

const SCRIPT: Beat[] = [
  { t: 0,    camera: "overview", step: 0, typing: false, press: null }, // seed every key at t=0
  { t: 2500, camera: "form" },
  { t: 3200, typing: true },
  ...
]
const LOOP_MS = 12000
```

Rules:

- Seed every state key at `t: 0` so a seek or a loop restart always has a full state.
- Timing lives only in this list. Never scatter delays through components.
- Start each beat about 350 to 400 ms after the previous one settles. Long enough to read as a separate move, short enough that the stage is never idle. Payoff holds (the saved state, the appearing row) get a beat longer.
- Overlap a camera move with the tail of the previous animation so a scene change does not read as a full stop.
- A duration that must line up with a gap in the script (a press squeeze of 600 ms against a 600 ms gap) gets a named constant and a comment saying the two stay in step.
- The scene component is keyed by a run id, so replay fully remounts it. Entrances are plain `initial -> animate`; there is no reset logic. Put the locale (or any variant switch) in the key too.
- Seeking applies every beat at or before the seek time instantly, then starts timers for the rest. `LOOP_MS` is published on the stage as `data-loop-ms`, which is how the exporter knows the loop length.

### 4. Build order

Build in this order and screenshot after each step. Do not start step n+1 until step n looks right.

1. **Layout at rest.** The composition in its own coordinate space, fitted into the safe area. Get sizes and alignment right before anything moves.
2. **Entrances.** Cards rise, lines draw, rows stagger.
3. **Camera.** The push-ins and pull-backs.
4. **Interactions.** Typing, press, collapse, a row appearing: the payoff beats.
5. **Pacing.** Only once everything works. Retime in SCRIPT only.

Two habits that prevent most trouble:

- **Derive geometry, never repeat it.** `ROW_WIDTH = CARD_SIZE * 2 + CARD_GAP`, not `724`. Card heights come from their own contents.
- **Make layouts self-correcting.** A full-height flex column with the flexible region on `flex-1` absorbs rounding slack. Arithmetic that must come out exact will eventually not.

### 5. Architecture in plain words

Three coordinate spaces, then the screen.

- **Content space** is where you design. A card is 350 because the design says 350; type is 40 because the type scale says 40. These numbers never change when the safe area is retuned.
- **Stage space** is the export frame, the exact pixels recorded. The composition is fitted uniformly into the safe area:

  ```ts
  const SAFE_INSET = { x: 160, y: 80 }
  const FIT = Math.min(
    (STAGE_WIDTH  - SAFE_INSET.x * 2) / CONTENT_SIZE.w,
    (STAGE_HEIGHT - SAFE_INSET.y * 2) / CONTENT_SIZE.h)
  const toStage = (r: Rect): Rect => ({ x: FIT_ORIGIN.x + r.x * FIT, y: FIT_ORIGIN.y + r.y * FIT, w: r.w * FIT, h: r.h * FIT })
  ```

  Uniform means it scales rather than stretches: the tighter axis wins and the looser axis gets more margin than asked for. Tell the designer ("you asked for 80 top and bottom and got it; the sides came out at 240 because the fit is uniform"), or the extra margin reads as a mistake. All rects cross from content to stage through `toStage`, so the camera cannot drift from the layout.
- **Screen** is preview convenience only. `useFitScale` transform-scales the stage to the window, and a readout shows the percentage so nobody mistakes the preview for real size.

**The camera frames rects, not the DOM.** Never measure elements to aim it. Define the region to show and derive the transform:

```ts
function cameraTransform(key: CameraKey) {
  const { rect, margin, biasY = 0 } = FRAMES[key]
  const scale = Math.min((STAGE_WIDTH - margin.x * 2) / rect.w, (STAGE_HEIGHT - margin.y * 2) / rect.h)
  return { scale,
    x: STAGE_WIDTH  / 2 - scale * (rect.x + rect.w / 2),
    y: STAGE_HEIGHT / 2 - scale * (rect.y + rect.h / 2) + biasY }
}
```

The order is translate then scale about the top-left (`p' = translate + scale * p`), which is the order Motion writes. Set `transformOrigin: "0px 0px"` on the camera element or the maths silently stops matching.

- Use **per-axis margins** (`{ x: ZOOM_SAFE_X, y: 96 }`), not one pad. It makes the zoomed safe area a guarantee.
- A push-in is a horizontal crop by nature. If two frames span the full width and share an x margin they land on the same scale, so the second reads as a pan. That is usually better (consistent zoom), but state it as a choice.
- `biasY` nudges the framing off dead centre. A bottom card centred often leaves bare background under it; push it down until the gap matches the safe area.

**Record the stage element.** `<div id="gif-stage" data-capture="stage" data-loop-ms={LOOP_MS} style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT }}>`. Controls (replay, scene seek, guides, size readout) live outside it so they never land in a frame. The guides overlay draws centre lines, the declared safe box in red and the composition's real bounding box in blue; the gap between them is the slack the fit gave back.

### 6. Gotchas, each with the fix

Every one was hit for real. Numbers are from the reference build.

**Authored vs rendered scale.** Nothing renders at its written size. A radius authored at 32 rendered at 29.3 in the overview (FIT 0.9148) and 41.5 in a push-in (camera 1.4193 on top), so a radius that looks right in the wide shot reads about 40% heavier in the close-up. When given a number: apply it as the authored value, measure the rendered value, report both, ask which scene it was meant for. Example: "32 is now the authored value. It renders at 29.3 in the overview and 41.5 in the push-ins. If you meant 32 on screen in the overview, the authored value should be 35." Do not quietly pick an interpretation and do not make them do the division.

**Fractional borders round to 1px.** Figma exports `border: 1.941px solid #FFF`; Chrome renders 1px. Apply it verbatim, but the roughly 0.94px of slack per side lands somewhere, and if layout arithmetic budgets the full 1.941 it shows as uneven padding. Make the layout self-correcting, and tell the designer that if the ring looks thinner than Figma, this is why and they may want to spec 2px.

**`overflow: hidden` eats the bottom padding.** Content 14px too tall does not look broken; it looks like the footer lost its padding. Fixes, both: derive the height from the contents (`HOLDINGS_HEIGHT = tile*rows + gap*(rows-1) + chrome`), and use a full-height flex column with the flexible region on `flex-1` and the footer last (a grid can use `align-content: space-between`). Remember `border-box`: `CARD_CHROME = (CARD_BORDER + CARD_PADDING) * 2`.

**Charts that bleed past padding.** "The graph reaches the tile edge with a 4px gap" means the chart escapes card padding while text keeps its inset:

```ts
const CHART_EDGE_GAP = 4
const CHART_BLEED = CARD_PADDING - CHART_EDGE_GAP   // negative margin per side
const CHART_WIDTH = CARD_INNER + CHART_BLEED * 2
```

Set the chart's horizontal inset to 0 so the line reaches both ends, keep about 10 vertical so peaks clear the top. Give the SVG `width="100%"` against a fixed `viewBox`; a fixed pixel width puts all rounding slack on one side (measured 2 left, 3.89 right). A dot on the line's end then clips into a half circle under `overflow: hidden`; usually drop the dot and say so.

**The re-expand stagger bug.** On collapse then expand, list rows replayed their scene-1 load-in stagger (0.95 to 1.3s delay written for the opening). The card sat empty for a second and the camera left before rows finished. Scene-seek testing never showed it because seeking skips the intro. Fix: track whether the section was ever collapsed and skip the stagger on re-entry.

```tsx
const hasCollapsed = useRef(false)
useEffect(() => { if (collapsed) hasCollapsed.current = true }, [collapsed])
<Row stagger={!hasCollapsed.current} />
```

The general rule: entrance timings written for the opening scene are wrong everywhere else. Any state that can be re-entered mid-timeline needs its own, faster transition. Always watch one full uninterrupted run.

**Press rings drawn on top read as artifacts.** A ring or highlight over packed content looks like a render glitch. Put the cue behind the content or drop it and use a squeeze (`scale: 0.95`, `PRESS_MS = 600`), which survives GIF quantisation. A radial shade behind content bands badly in a GIF palette.

**A flat stage background draws grey boxes around cards.** The template's radial-gradient background is load-bearing. On a flat colour the 256-colour palette rounds the shadow falloff to the same value along a whole contour, so the error becomes a straight line: measured on flat `#FFFFFF`, the background alternated between 254 and 248 in rectangular patches, tiling into a hard grey box around each card. It looks like a shadow problem and it is not; three theories died (shadow too soft, palette starved of light greys, export smaller). Fixes, do both: never put cards on a flat field (keep the gradient, or give cards contrast, such as white cards on `#EEE`), and export with `--dither 10` for large gradients inside the artwork. To read a GIF's palette without decoding:

```js
const b = readFileSync(file)
const n = 2 ** ((b[10] & 0x07) + 1)
const table = Array.from({ length: n }, (_, i) => [b[13+i*3], b[14+i*3], b[15+i*3]])
```

**Locale text.** French uses U+202F (narrow no-break space) for thousands and U+00A0 before `$` and `%`. Spell them as named constants (`NNBSP`, `NBSP`) so nobody "cleans them up". French runs longer; carry a per-locale type size in the copy object rather than shrinking the layout for everyone.

**The hash router.** `localhost:5173/job-tracker/stage/x` renders the app shell on Applications with broken relative assets. Always `.../job-tracker/#/stage/x`.

#### Interaction patterns

- **Long press** has no pointer, so the element reacts: `scale: 0.95` for 600 ms, `PRESS_MS` equal to the script gap. No ring on top.
- **Privacy or reveal masks.** Crossfade with a blur on both halves (`filter: blur(6px)`, `y` of plus or minus 6, 0.32s). Dots are real elements, staggered about 40ms. Keep the line's slot reserved when it fades to nothing, or everything below jumps.
- **Collapse and expand.** Animate height, crossfade contents, derive both heights from contents, skip the entrance stagger on re-expand. Overlapping logos use `zIndex: i` and a `box-shadow` ring in the card's own background colour.
- **Drawing a chart line.** Keep the shape as a plain `number[]` on a 0 to 100 scale and generate the path. Animate `pathLength` 0 to 1 and scale the duration by the fraction of width covered (`CHART_DRAW * progress`). Anchor fills to the highest point of the line and close partial areas at the line's own end.

### 7. Verification recipes

Run the scripts from `tools/design/animation/` (they find `playwright` there, or in the working directory).

**Screenshots at timestamps.** `capture.mjs` shoots `#gif-stage` only, at scale 1:

```bash
node capture.mjs --url 'http://localhost:5173/job-tracker/#/stage/resume-loop' \
  --at 0,1800,5000,10500,11800 --out "$SCRATCHPAD/shots"
```

Then open the PNGs and look. The measurement table catches wrong numbers; only your eyes catch a composition that is off. It handles three things hand-rolled versions get wrong: it forces the stage back to `scale(1)` (the preview is shrunk to fit, so a plain screenshot is not export size and all measurements are multiplied), it replays from t=0 on the real timeline rather than seeking (seeking skips the intro, which is how blank frames survive review), and it reports authored (`offsetWidth`) and rendered (`getBoundingClientRect()`) separately. Their ratio is FIT times camera scale.

**Measuring geometry.**

```bash
node capture.mjs --url '...' --at 1800 --out "$SCRATCHPAD/shots" \
  --measure '#gif-stage [data-card="job"]'
```

- Never measure during a camera move (about 900 ms). A card that is really 318.18 wide reads 324.58 mid-move. Pick a time at least one second clear of any beat in SCRIPT.
- Sanity check: `effectiveScale` equals `FIT` exactly in the overview. If not, you are mid-move or the preview scale is still applied.
- `overflowY` is `scrollHeight - clientHeight`; above 0 means clipping, which looks like missing bottom padding. Check after every size change.
- A gap you cannot see: compare bounding boxes and divide out ancestor transforms.

  ```js
  await page.evaluate(() => {
    const card = document.querySelector('[data-card="spend"]'), chart = card.querySelector("svg")
    const c = card.getBoundingClientRect(), g = chart.getBoundingClientRect()
    const s = c.width / card.offsetWidth
    return { left: (g.left - c.left) / s, right: (c.right - g.right) / s }
  })
  ```

  If the pair differs (2 and 3.89 is a real result) that is border-rounding slack; fix with `width="100%"`, do not split the difference.

**Which font is rendering.** Computed style shows what was requested, not what was used. Ask CDP:

```js
const client = await page.context().newCDPSession(page)
await client.send("DOM.enable"); await client.send("CSS.enable")
const { root } = await client.send("DOM.getDocument")
const { nodeId } = await client.send("DOM.querySelector", { nodeId: root.nodeId, selector: "SELECTOR" })
console.log(await client.send("CSS.getPlatformFontsForNode", { nodeId }))
```

A real load reads like `familyName: "WealthsimpleSansDisplay-Medium", isCustomFont: true`. In this app Wealthsimple Sans Display is not shipped, so expect `Figtree` with `isCustomFont: true` unless the font is installed on the recording machine. Run this before changing any type that "looks wrong".

**The full-run check.** Sample a whole loop densely and read every frame: `--at 0,2000,4000,6000,8000,10000,11800`. Look for empty cards, half-finished entrances and the loop seam: the last frame and the first frame must sit together without a jump. Also watch one real uninterrupted run in the browser, not just scene buttons.

### 8. Export

From `tools/design/animation/`:

```bash
node export-gif.mjs \
  --url 'http://localhost:5173/job-tracker/#/stage/resume-loop' \
  --out ~/Desktop/resume-loop.gif --mp4
```

Ask where the file should go before running; `--out` defaults to `./stage.gif`, inside the project, and anything outside is the owner's call. Keep the `#`. Loop length is read from `data-loop-ms`; pass `--duration <ms>` only for a stage that lacks it.

**Virtual clock.** Before any page script loads, `requestAnimationFrame`, timers, `performance.now` and `Date.now` are replaced, and time advances only between screenshots. Frames land on exact timestamps and the same command produces the same bytes. Nothing races a screenshot, which is why the export never stutters where the preview did not.

**fps rules.** Use 25 (default), 20, 50 or 10 for GIF. GIF stores delay in whole centiseconds, so 30 fps is a 33.3 ms step every player rounds, and the export drifts out of time with the preview. The script warns; the fix is choosing an exact rate. This is a GIF limit only: with `--mp4`, 30 and 60 are honest.

**mp4.** Offer it when the destination is not a web page. An App Store preview cannot be a GIF at all and needs mp4; a deck or Slack post is better served too (h264 on flat UI is a fraction of the size at full quality). It is opt-in so the same command gives the same files everywhere. h264, `yuv420p`, crf 18, preset slow, faststart; dimensions are rounded to even. Needs `ffmpeg` on PATH; if missing the script prints `brew install ffmpeg` and still writes the GIF. Note for App Store: the mp4 must match Apple's required preview resolution for the target device, so author the stage at that size (or pass `--width`), and check Apple's current spec at submission time.

| Flag | Does |
|---|---|
| `--fps 25` | Frame rate. 25, 20, 50, 10 are exact for GIF. |
| `--mp4` | Also write an h264 mp4 beside the GIF. |
| `--dither 10` | Ordered dithering for large gradients; off by default; costs about 30% size. Ordered (not error-diffused) so held frames stay byte-identical. |
| `--colors 256` | Palette size; lower only for flat art and smaller files. |
| `--supersample 2` | Render at 2x and average down, so text and hairlines are antialiased against the flat palette (the default). |
| `--frames ./seq` | Also write the PNG sequence for After Effects or a video encoder. |
| `--width <px>` | Output width (height follows the stage aspect). |
| `--duration <ms>` | Override loop length. |
| `--diff false` | Write every frame in full; only to isolate a suspected export bug. |

**Frame differencing and the decode check.** By default unchanged pixels are re-sent as transparent over a `dispose: 1` frame: a large win on a stage that holds still (43% on the 1200 x 740 reference, 11.8 MB to 6.7 MB) and visually lossless, but the part most likely to break subtly. Decode the result and look at a mid-loop frame, one from partway through a hold, never frame 0 (always written in full). Breakage looks like hollow or outlined text, hollow icons, ghost content from earlier frames. Also look for hard-edged grey rectangles around cards, which is the flat background problem in section 6, not a shadow problem.

```bash
ffmpeg -i resume-loop.gif -vf "select=eq(n\,60)" -vframes 1 /tmp/mid.png   # frame 60 = 2.4s at 25 fps
```

### 9. House style and the app's tokens

- Font: Wealthsimple Sans Display for everything on stage. Amounts at 500, labels and footers at 400. Display reads heavy at 500 by design; if numbers look thick, confirm the real face loads (section 7), then offer 400 as a deliberate choice rather than silently applying it.
- In this app the stack is `--font-ui`: `"Wealthsimple Sans Display", Figtree, -apple-system, ...`. The stage should use `var(--font-ui)` so a recording machine that has the real face uses it and everyone else gets Figtree. Weights stay 400, 500, 700 only.
- Tie colours, radii and shadows to the tokens in Colors and Elevation above, not to hand-typed values: `--bg` #f2f2f2 ground, `--surface` #fafafa cards, `--ink`, `--muted`, `--line`, the stage colours (`--stage-applied` and its siblings), `--raise` for the card shadow, 20px card radius from the corners token, pills at 999px. A stage that reuses the real components (the Resume steps, the applications list) inherits all of these and cannot drift.
- The stage background is the exception: use the template's soft grey radial gradient, never a flat fill (section 6). Because the app's ground is already a light grey, cards in `--surface` against it give the contrast the gradient fix asks for.
- Pick the theme and finish deliberately: set `data-theme="light"`, the default accent and comfortable density on `<html>` for the recording, since those settings are user-owned and will otherwise follow the recording machine.
- Sentence case, Lucide icons only, no tabular numbers; the rest of this file's Do's and Don'ts apply on stage unchanged.
- Corner radius on the stage itself is square; the container clips it, and a radius there reads as a double-rounded edge.

### 10. Pre-delivery checklist

- [ ] Screenshotted every scene, plus the loop seam (last frame beside first frame).
- [ ] Watched one full uninterrupted run, not only the scene-seek buttons.
- [ ] Measured every number the designer specified; reported authored and rendered values.
- [ ] Never measured during a camera move.
- [ ] Confirmed which font renders (CDP) and said which.
- [ ] No flat stage background; no grey boxes around cards.
- [ ] fps is 25, 20, 50 or 10 for GIF (30 or 60 only with mp4).
- [ ] Decoded the exported GIF and looked at a mid-hold frame: no hollow text, no ghosts.
- [ ] mp4 produced if the destination is an App Store preview, a deck or Slack.
- [ ] `npm run typecheck` and `npm test` in `web/` are clean; stage is dev-only.
- [ ] Output saved where the owner asked; exported file named after the slug.
- [ ] If deployed: remember the platform cannot be verified headless; ask the owner to open it, and the URL needs the trailing slash before `#`.

### 11. Worked example: "Tailor a resume" loop (12 seconds)

Draft only: it was not built, so none of the timings below were measured. Retime in SCRIPT after the first full run.

The Resume page has three sections, **Resume**, **Job** and the **tailored resume and cover letter** split with its action bar (the page used to be four steps, which this draft still counts as 0 to 3). The loop shows one job going through them: paste the job, write the tailored draft, review it, save it, and see the application appear in the list.

`step` in the SCRIPT is the index of the current stage: 0 Resume, 1 Job, 2 the split, 3 Save (the bar reads Saved and the application appears in the list). Earlier sections read done, later ones are not on screen yet.

Stage: 1200 x 740, content is the Resume page column at 560 wide, rendered with the page's real components and `ResumeDeps` fakes so nothing calls the AI or the network. The Applications list is a second composition at content x 640, so the camera can pan to it without a route change. Seed data: master resume saved ("Master resume · updated Nov 10"), job "Product Designer at Northwind", an unmodified application list. Set `data-theme="light"` on `<html>` (section 9).

Cameras: `overview` (the step column plus a sliver of the list), `job` (the pasted text, company and role, and the primary button), `review` (the draft), `list` (the Applications table, a pan right at the same scale).

| t (ms) | Beat | What the viewer sees |
|---|---|---|
| 0 | `camera: overview, step: 1, typing: false, press: null` | Strip: Your resume done, The job current, the rest waiting. Step 2 card rises in (entrance plays only on the opening). |
| 900 | `camera: job` | Push in on "Paste the job description". |
| 1300 | `typing: true` | About 200 characters of a posting type into the big box at about 8 ms per character (or paste it in one beat). Company and Role fill from the text and read "Check these". |
| 3000 | `press: "write"` | The primary "Write my resume and letter" squeezes to 0.95 for 600 ms. |
| 3600 | `press: null, writing: true` | A "Stop" button replaces it for 1.4 s; "Writing" progress line. This is faked: no AI call is made. |
| 5000 | `camera: review, step: 2, writing: false` | Strip: The job done, Review current. The tailored draft shows with change marks. |
| 5600 | `edit: 1` | One changed bullet is marked (tone change, no ring on top). |
| 6800 | `edit: 2` | A second changed line. Hold ends. |
| 7600 | `camera: overview, step: 3` | Click "Next" is not shown (no pointer); the strip moves to Add to applications. Text: "Adds Northwind, Product Designer to your applications (Applied, today)". |
| 8400 | `press: "save"` | "Save" squeezes 600 ms. |
| 9000 | `press: null, saved: true` | "Saved to Northwind" with "Open application" fades in (400 ms). |
| 9600 | `camera: list` | Camera pans to the Applications table. |
| 10000 | `listRow: true` | A new Northwind row slides in at the top with the Applied dot. The payoff. |
| 11100 | hold | The row holds so it can be read. |
| 11600 | `camera: overview, saved: false, listRow: false, step: 1, writing: false` | Pull back to the opening composition so the last frame matches frame 0. |
| 12000 | end | `LOOP_MS = 12000`. |

Notes for the build:

- The loop returns to step 1 with the cards already on screen at the seam, so entrance staggers play only when `startAt === 0` of a fresh run (the re-expand rule in section 6).
- `PRESS_MS` (600) equals the gaps at 3000 to 3600 and 8400 to 9000; keep it named and commented.
- The real page keeps "Save" behind an `InlineConfirm` only when the application already has documents; the stage shows the new-application path, which has none.
- Use `--fps 25` for the GIF; add `--mp4` for a deck. Name it after the slug: `resume-loop.gif`.
- Verify with `--at 0,1800,3200,5800,8200,10500,11800`, a measured gap check on the new row, then a full-run watch.
