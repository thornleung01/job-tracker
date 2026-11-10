# Animation tooling

Records fixed-size looping UI animations (README or release-note GIFs, slides) from a React "stage" page. The method is in
`docs/design/animation.md`. Nothing here is part of the app: this folder is outside `web/`, so `vite build`, `tsc` and `vitest` ignore it,
and it has its own `package.json` so `web/package.json` never gains `motion` or `playwright`.

| File | What it is |
|---|---|
| `StageTemplate.tsx`, `stage.css` | Starter stage: fixed-size stage, camera, one SCRIPT, guides, replay controls. Plain CSS (no Tailwind in the app) |
| `capture.mjs` | Headless screenshots at timestamps plus geometry measurement |
| `export-gif.mjs` | Frame-exact GIF (optional mp4 and PNG sequence) on a virtual clock |
| `package.json` | `motion`, `playwright`, `gifenc`, `pngjs` |

## Install (once)

```bash
cd tools/design/animation
npm install
npx playwright install chromium
brew install ffmpeg          # only for --mp4
```

The scripts look for `playwright` in the directory you run them from, then in this folder.

## Add a stage page to the app (not done in the repo; copy-paste when you need it)

The Vite base is `/job-tracker/` (`web/vite.config.ts`) and the router is hash-based, so a stage lives at
`http://localhost:5173/job-tracker/#/stage/<slug>`. Keep the `#`.

1. Copy `StageTemplate.tsx` and `stage.css` to `web/src/pages/stage/`.
2. `web/src/app/routes.ts`, add one row to `ROUTES` (`nav: null` keeps it out of the header):

   ```ts
   { path: "/stage/:slug", page: "stage", nav: null },
   ```

3. Create `web/src/pages/stage/index.tsx` (pages are picked up by `import.meta.glob("../pages/*/index.tsx")`):

   ```tsx
   import type { PageProps } from "../../app/pageProps";
   import { StageTemplate } from "./StageTemplate"; // rename per stage
   import "./stage.css";

   const STAGES: Record<string, () => JSX.Element> = { "resume-loop": StageTemplate };

   export default function StagePage({ params }: PageProps) {
     const Stage = import.meta.env.DEV ? STAGES[params.slug] : undefined; // dev only: never ships
     return Stage ? <Stage /> : <p>Not found.</p>;
   }
   ```

4. `StageTemplate.tsx` imports `motion/react`. Inside `web/` that needs `cd web && npm i -D motion` (your call), or rewrite the
   transitions in CSS driven by the same SCRIPT. Run `cd web && npx tsc --noEmit && npx vitest run` afterwards; route tests may
   enumerate the table.
5. The shell header wraps the page. That is fine: the scripts capture only `#gif-stage`.

## Run

```bash
cd web && npm run dev                      # http://localhost:5173/job-tracker/

cd tools/design/animation
node capture.mjs --url 'http://localhost:5173/job-tracker/#/stage/resume-loop' --at 0,1800,5000 --out /tmp/shots
node capture.mjs --url '...' --at 1800 --measure '#gif-stage [data-card="left"]' --out /tmp/shots
node export-gif.mjs --url 'http://localhost:5173/job-tracker/#/stage/resume-loop' --out ~/Desktop/resume-loop.gif --mp4
```

Flags are listed in section 8 of `docs/design/animation.md`. `capture.mjs` needs a "Replay" button and a `#gif-stage` element;
`export-gif.mjs` reads the loop length from `data-loop-ms` on `#gif-stage`.

## What was verified (and what was not)

Run on 2026-11-10, base commit `6ec25e4`:

- `node --check` passes on both scripts. `npm install` and `npx playwright install chromium` work in this folder.
- The starter (unmodified apart from plain CSS in place of Tailwind classes) was served from a throwaway Vite project at
  `/job-tracker/` outside the repo, using the app's React and the `motion` installed here. `capture.mjs` produced screenshots and
  the measurement table (preview scale forced to 100%, FIT 0.9091 at rest, 1.2983 in a push-in). `export-gif.mjs` wrote a
  300-frame 1200x740 25 fps 12 s GIF (1.8 MB).
- Not run: the `/stage/:slug` route inside the real app (deliberately not added), `--mp4` (ffmpeg not tried), `--frames`, `--dither`.
- The Resume loop in section 11 of the doc is a written storyboard only. It was not built or timed.
- In the scratch page `--font-ui` was not defined, so text rendered in a serif fallback. Inside the app it resolves to Figtree.
