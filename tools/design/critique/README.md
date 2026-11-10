# Critique tools

Support for `docs/design/critique.md`. Both scripts have no dependencies and live outside `web/`. They need Node 22+ (global
`WebSocket` and `fetch`). `shoot.mjs` also needs Google Chrome at `/Applications/Google Chrome.app` (or pass `--chrome`).

- `shoot.mjs` takes full-page PNGs of app screens (any width, light or dark) with headless Chrome over the DevTools protocol.
- `build-review.mjs` turns a review folder's `findings.json` into one self-contained `review.html` with numbered markers on the frames.

Generated screenshots and HTML are not committed. Put reviews outside the repo.

## Capture

```bash
cd web && npx vite --port 5201 --strictPort        # http://localhost:5201/job-tracker/  (Vite base is /job-tracker/)

node tools/design/critique/shoot.mjs --out "$DIR/frames" --base http://localhost:5201/job-tracker/ \
  --shots "settings-desktop:1280:light:#/settings,resume-phone:390:light:#/resume,home-desktop:1280:light:#/"
```

A shot is `name:width:theme:hash`. The script opens the app in a fresh profile, clicks "Load demo data" so screens have content (skip
with `--no-demo`), then shoots each route. It prints name, width, height and `scrollWidth vs innerWidth` (a mismatch is horizontal
overflow). Copy width and height into `findings.json`. Without `--base` it uses `http://localhost:5199/job-tracker/`.
Pages taller than 4000px are cut at 4000.

## Mark-up

```bash
node tools/design/critique/build-review.mjs --findings "$DIR/findings.json"
open "$DIR/review.html"
```

`--link` references the frames instead of inlining them; `--out <path>` changes the output file. A finding with a `box` (percent of the
frame: x, y, w, h) gets a numbered marker; one without is listed only. The schema is in `docs/design/critique.md`, section 2.5.

## Verified

On 2026-11-10 against the app at base commit `6ec25e4`: `shoot.mjs` ran unchanged against the dev server on port 5201 with the shots
above and produced correct screenshots (Settings, Setup tab, demo data loaded; sizes 1280x1121, 390x4000, 1280x4000).
`build-review.mjs` built a 124 KB `review.html` from a one-frame, one-finding sample using a real screenshot.
Not tried: `--link`, `--no-demo`, dark theme shots, Chrome at another path.
