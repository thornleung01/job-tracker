// Frame-exact GIF export for an animation stage.
//
//   node export-gif.mjs --url 'http://localhost:5173/job-tracker/#/stage/resume-loop' \
//     --out ~/Desktop/resume-loop.gif
//
// --out defaults to ./stage.gif, i.e. inside the project. Anywhere outside it is
// the owner's choice to make — ask before writing there.
//
//   node export-gif.mjs --url '<page url>' --frames ./seq       # PNG sequence too
//   node export-gif.mjs --url '<page url>' --duration 12000     # stage has no data-loop-ms
//
// The loop length comes from data-loop-ms on #gif-stage, so it cannot drift out
// of sync with the stage's own LOOP_MS. --duration overrides it.
//
// playwright is resolved from the working directory first, then from this folder
// (npm install here installs it).
//
// Why this is not just "screenshot every 40ms": the page would keep animating
// while each screenshot is taken, so frames land at uneven times and the export
// stutters in a way the preview never does. Instead the page runs on a virtual
// clock — rAF, setTimeout, setInterval, performance.now and Date.now are all
// replaced before any page script loads, and time only moves when this script
// says so. Nothing is racing a screenshot, so the same command always produces
// the same bytes.
import { mkdir, writeFile, stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { execFileSync, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------
// playwright comes from the site (it is already there for the e2e tests). The
// encoder and PNG decoder are pure JS with no native build step, and they get
// installed beside this script rather than into the designer's project, so
// exporting never adds a dependency to something that gets committed.
const fromSite = createRequire(path.join(process.cwd(), "noop.js"))
const fromHere = createRequire(path.join(HERE, "noop.js"))

const { chromium } = (() => {
  for (const req of [fromSite, fromHere]) {
    for (const id of ["playwright", "@playwright/test", "playwright-core"]) {
      try {
        return req(id)
      } catch {
        /* try the next one */
      }
    }
  }
  throw new Error(`No playwright package resolvable. Run npm install in ${HERE}.`)
})()

function ensureEncoder() {
  const load = () => ({
    gifenc: fromHere("gifenc"),
    pngjs: fromHere("pngjs"),
  })
  try {
    return load()
  } catch {
    console.log("installing the GIF encoder (one time, into tools/design/animation)…")
    try {
      execFileSync(
        "npm",
        ["install", "--prefix", HERE, "--no-audit", "--no-fund", "--silent", "gifenc", "pngjs"],
        { stdio: "inherit" }
      )
    } catch {
      throw new Error(`Could not install the encoder. Run:\n  npm install --prefix ${HERE} gifenc pngjs`)
    }
    return load()
  }
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith("--")) pairs.push([arg.slice(2), all[i + 1] ?? "true"])
    return pairs
  }, [])
)

const url = args.url
if (!url) {
  console.error("--url is required")
  process.exit(1)
}

const fps = Number(args.fps ?? 25)
const out = args.out ?? "./stage.gif"
const framesDir = args.frames || null
// Render at 2x and average back down, so text and hairline borders land on the
// GIF's flat palette already antialiased instead of aliasing against it.
const supersample = Number(args.supersample ?? 2)
const maxColors = Number(args.colors ?? 256)
// Unchanged pixels are re-sent as transparent so the encoder can skip them. The
// static background is most of the frame during a hold, so this is usually a
// large size win and visually lossless — the frames are byte-identical under the
// virtual clock, so "unchanged" really means unchanged.
const diff = args.diff !== "false"
// Ordered (Bayer) dithering, off by default so existing exports are unchanged.
// Only worth turning on for large areas of smooth gradient, which a 256-colour
// palette otherwise collapses into visible bands — flat UI does not need it and
// pays for it in file size. Ordered rather than error-diffused on purpose: the
// threshold depends only on x/y, so a pixel that did not change between frames
// still quantizes to the same index and the frame differencing above keeps
// working. Floyd-Steinberg would smear one changed pixel across the whole row
// and defeat it.
const ditherArg = args.dither
const dither =
  ditherArg === undefined || ditherArg === "false"
    ? 0
    : ditherArg === "true"
      ? 12
      : Number(ditherArg)
// Also write an h264 mp4 beside the GIF. Opt-in rather than "encode one whenever
// ffmpeg happens to be installed", so the same command produces the same files
// on every machine. ffmpeg is detected, never installed — the no-native-build
// rule above still holds.
const wantMp4 = args.mp4 !== undefined && args.mp4 !== "false"

// A GIF stores frame delay in hundredths of a second, so a frame step that is
// not a whole number of centiseconds gets rounded by every player, and the
// export drifts out of time with the preview. 25, 20, 10 and 50 fps are exact.
const frameMs = 1000 / fps
if (Math.abs(frameMs / 10 - Math.round(frameMs / 10)) > 1e-9) {
  console.warn(
    `⚠︎  ${fps}fps is a ${frameMs.toFixed(2)}ms step, which GIF cannot store exactly ` +
      `(delays are whole centiseconds). Use 25, 20, 50 or 10 for exact timing.` +
      (wantMp4 ? `\n   The mp4 is unaffected — whole centiseconds are a GIF limit only.` : "")
  )
}

// Big enough that the page's fit-to-window scale lands on 1.0 and the stage
// renders at true export size.
const viewport = { width: Number(args.vw ?? 1800), height: Number(args.vh ?? 1300) }

// ---------------------------------------------------------------------------
// The virtual clock, installed before any page script runs
// ---------------------------------------------------------------------------
function installClock() {
  // Keep the real ones. `yieldReal` is how we hand control back to the browser
  // so React can commit — React 19 schedules through MessageChannel, which is
  // deliberately left alone, so it still needs real event-loop turns.
  const realSetTimeout = window.setTimeout.bind(window)
  const yieldReal = () => new Promise((r) => realSetTimeout(r, 0))

  let now = 0
  let nextId = 1
  let seq = 0
  const timers = new Map() // id -> { at, fn, args, every, seq }
  const frames = new Map() // id -> callback
  const epoch = Date.now()

  performance.now = () => now
  Date.now = () => epoch + now

  window.requestAnimationFrame = (cb) => {
    const id = nextId++
    frames.set(id, cb)
    return id
  }
  window.cancelAnimationFrame = (id) => frames.delete(id)

  window.setTimeout = (fn, delay, ...rest) => {
    const id = nextId++
    timers.set(id, { at: now + Math.max(0, Number(delay) || 0), fn, args: rest, every: null, seq: seq++ })
    return id
  }
  window.setInterval = (fn, delay, ...rest) => {
    const id = nextId++
    const every = Math.max(1, Number(delay) || 1)
    timers.set(id, { at: now + every, fn, args: rest, every, seq: seq++ })
    return id
  }
  window.clearTimeout = (id) => timers.delete(id)
  window.clearInterval = (id) => timers.delete(id)

  async function fireDueUpTo(limit) {
    for (let guard = 0; guard < 100000; guard++) {
      let pick = null
      for (const [id, t] of timers) {
        if (t.at > limit) continue
        if (!pick || t.at < pick.t.at || (t.at === pick.t.at && t.seq < pick.t.seq)) pick = { id, t }
      }
      if (!pick) return
      now = Math.max(now, pick.t.at)
      if (pick.t.every != null) pick.t.at = now + pick.t.every
      else timers.delete(pick.id)
      try {
        pick.t.fn.apply(null, pick.t.args)
      } catch (err) {
        console.error("virtual timer threw:", err)
      }
      await yieldReal()
    }
  }

  function flushFrames() {
    const batch = Array.from(frames.entries())
    frames.clear()
    for (const [, cb] of batch) {
      try {
        cb(now)
      } catch (err) {
        console.error("rAF callback threw:", err)
      }
    }
  }

  window.__stageClock = {
    now: () => now,

    // Advance to `target`, in sub-steps no larger than `maxStep`. The sub-steps
    // matter: Motion clamps how much time a single frame is allowed to advance,
    // so one big 40ms jump can make animations run slower than they do in the
    // preview. Stepping at ~display rate keeps every delta inside the clamp.
    async advanceTo(target, maxStep = 16) {
      while (now < target) {
        const next = Math.min(target, now + maxStep)
        await fireDueUpTo(next)
        now = next
        flushFrames()
        await yieldReal()
      }
      // One more pass so anything scheduled by the last callback lands before
      // the screenshot.
      await fireDueUpTo(now)
      flushFrames()
      await yieldReal()
      await yieldReal()
    },
  }
}

// ---------------------------------------------------------------------------
// Pixels
// ---------------------------------------------------------------------------
// Area average. For the usual integer 2x this is an exact 2x2 box filter; it
// also handles the arbitrary ratios you get from --width.
function downscale(src, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return src
  const dst = new Uint8ClampedArray(dw * dh * 4)
  const xRatio = sw / dw
  const yRatio = sh / dh
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * yRatio)
    const y1 = Math.max(y0 + 1, Math.min(sh, Math.ceil((y + 1) * yRatio)))
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * xRatio)
      const x1 = Math.max(x0 + 1, Math.min(sw, Math.ceil((x + 1) * xRatio)))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let sy = y0; sy < y1; sy++) {
        let o = (sy * sw + x0) * 4
        for (let sx = x0; sx < x1; sx++, o += 4) {
          r += src[o]
          g += src[o + 1]
          b += src[o + 2]
          a += src[o + 3]
          n++
        }
      }
      const d = (y * dw + x) * 4
      dst[d] = r / n
      dst[d + 1] = g / n
      dst[d + 2] = b / n
      dst[d + 3] = a / n
    }
  }
  return dst
}

const bytes = (n) =>
  n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const { gifenc, pngjs } = ensureEncoder()
const { GIFEncoder, quantize, applyPalette } = gifenc
const { PNG } = pngjs

const browser = await chromium.launch()
const page = await browser.newPage({ viewport, deviceScaleFactor: supersample })

page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()))
page.on("pageerror", (e) => console.error("page error:", e.message))

await page.addInitScript(installClock)
await page.goto(url, { waitUntil: "networkidle" })
await page.waitForSelector("#gif-stage")
await page.evaluate(() => document.fonts.ready)

// The page shrinks the stage to fit its column, so the preview is never 100%.
// Force it back so frames come out at true export size.
const previewScale = await page.evaluate(() => {
  const el = document.getElementById("gif-stage")
  const before = new DOMMatrixReadOnly(getComputedStyle(el).transform).a
  el.style.transform = "scale(1)"
  return before
})

// Loop length: the stage can publish it, otherwise it has to be passed in.
// Getting this wrong is what makes a loop visibly hitch, so it is not guessed.
const published = await page.evaluate(() => {
  const el = document.getElementById("gif-stage")
  const v = el?.dataset?.loopMs
  return v ? Number(v) : null
})
const duration = Number(args.duration ?? published ?? 0)
if (!duration) {
  console.error(
    "Could not work out the loop length. Pass --duration <ms> (the stage's LOOP_MS),\n" +
      "or add data-loop-ms={LOOP_MS} to the #gif-stage element."
  )
  await browser.close()
  process.exit(1)
}

// Frames run from 0 up to but NOT including `duration`: the frame at `duration`
// is the frame at 0 again, and shipping both is what puts a stutter in the seam.
const stamps = []
for (let t = 0; t < duration - 1e-6; t += frameMs) stamps.push(t)

const stage = page.locator("#gif-stage")
const box = await stage.boundingBox()
const srcW = Math.round(box.width * supersample)
const srcH = Math.round(box.height * supersample)
const outW = Math.round(Number(args.width ?? box.width))
const outH = Math.round((outW / box.width) * box.height)

console.log(
  `stage ${box.width}x${box.height} (preview was ${(previewScale * 100).toFixed(0)}%) → ` +
    `${outW}x${outH} · ${stamps.length} frames · ${fps}fps · ${(duration / 1000).toFixed(2)}s loop`
)

// Start from a clean t=0 even if the page has been sitting open.
// dispatchEvent rather than click: at scale 1 the stage overlaps the controls,
// so a real click would be intercepted by the artwork sitting on top of them.
await page.getByRole("button", { name: "Replay", exact: true }).dispatchEvent("click")
await page.waitForTimeout(200) // real time — let React commit the remount
if (framesDir) await mkdir(framesDir, { recursive: true })

const rgbaFrames = []
let clockAt = 0

for (const [i, at] of stamps.entries()) {
  await page.evaluate((t) => window.__stageClock.advanceTo(t), at)
  clockAt = at

  const shot = await stage.screenshot({ type: "png", animations: "disabled" })
  const png = PNG.sync.read(shot)
  const rgba = downscale(new Uint8ClampedArray(png.data), png.width, png.height, outW, outH)
  rgbaFrames.push(rgba)

  if (framesDir) {
    const file = path.join(framesDir, `frame-${String(i).padStart(4, "0")}.png`)
    const o = new PNG({ width: outW, height: outH })
    o.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length)
    await writeFile(file, PNG.sync.write(o))
  }

  if (i % 25 === 0 || i === stamps.length - 1) {
    process.stdout.write(`\r  captured ${i + 1}/${stamps.length} frames`)
  }
}
process.stdout.write("\n")

const clockEnd = await page.evaluate(() => window.__stageClock.now())
await browser.close()
if (Math.abs(clockEnd - clockAt) > 1) {
  console.warn(`⚠︎  clock ended at ${clockEnd}ms, expected ${clockAt}ms`)
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------
// One palette for the whole animation, built from evenly spaced frames. A
// per-frame palette is slightly sharper on any single frame but makes flat areas
// and gradients shimmer as the palette shifts underneath them, which is very
// visible on a slow push-in.
console.log("building the colour palette…")
const sampleEvery = Math.max(1, Math.ceil(rgbaFrames.length / 24))
const samples = rgbaFrames.filter((_, i) => i % sampleEvery === 0)
// Every 3rd pixel is plenty for choosing colours and keeps this from allocating
// a gigabyte on a long loop.
const stride = 3
const perFrame = Math.floor(rgbaFrames[0].length / 4 / stride)
const pool = new Uint8ClampedArray(samples.length * perFrame * 4)
let w = 0
for (const frame of samples) {
  for (let p = 0; p < perFrame; p++) {
    const o = p * stride * 4
    pool[w++] = frame[o]
    pool[w++] = frame[o + 1]
    pool[w++] = frame[o + 2]
    pool[w++] = 255
  }
}

// One palette slot is held back for "unchanged pixel" when differencing. The
// sentinel duplicates a real colour, so it has to stay invisible to the
// nearest-colour match below: given the full table, applyPalette will map
// genuine pixels of that colour onto the sentinel and silently turn them
// transparent — black text hollows out and ghosts the frame underneath.
// colours = what pixels may map to; palette = what gets written to the file.
const colours = quantize(pool, diff ? maxColors - 1 : maxColors, { format: "rgb565" })
const transparentIndex = colours.length
const palette = diff ? [...colours, [0, 0, 0]] : colours

// 8x8 Bayer matrix, normalised to -0.5..+0.5. Nudging each channel by a
// sub-step amount before the nearest-colour match trades a hard band edge for a
// fine checker that the eye integrates back into a smooth ramp.
const BAYER8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
].map((row) => row.map((v) => (v + 0.5) / 64 - 0.5))

// Returns a dithered copy; the original is left alone so the frame differencing
// still compares true pixel values.
function ditherFrame(rgba, width, amount) {
  const out = new Uint8ClampedArray(rgba)
  for (let p = 0, o = 0; o < out.length; p++, o += 4) {
    const t = BAYER8[((p / width) | 0) & 7][p & 7] * amount
    out[o] = rgba[o] + t
    out[o + 1] = rgba[o + 1] + t
    out[o + 2] = rgba[o + 2] + t
  }
  return out
}

console.log(
  `encoding ${rgbaFrames.length} frames at ${outW}x${outH}…` +
    (dither ? ` (ordered dither, strength ${dither})` : "")
)
const gif = GIFEncoder()
const delay = Math.round(frameMs / 10) * 10 // whole centiseconds, as GIF stores it
let previous = null

for (const [i, rgba] of rgbaFrames.entries()) {
  const index = applyPalette(
    dither ? ditherFrame(rgba, outW, dither) : rgba,
    colours,
    "rgb565"
  )

  if (diff && previous) {
    for (let p = 0, o = 0; p < index.length; p++, o += 4) {
      if (
        rgba[o] === previous[o] &&
        rgba[o + 1] === previous[o + 1] &&
        rgba[o + 2] === previous[o + 2]
      ) {
        index[p] = transparentIndex
      }
    }
  }

  gif.writeFrame(index, outW, outH, {
    palette: i === 0 ? palette : undefined,
    delay,
    repeat: 0,
    // dispose 1 = leave the frame in place, which is what makes an untouched
    // (transparent) pixel show the previous frame instead of the background.
    dispose: diff ? 1 : -1,
    transparent: diff && i > 0,
    transparentIndex,
  })
  previous = rgba

  if (i % 25 === 0 || i === rgbaFrames.length - 1) {
    process.stdout.write(`\r  encoded ${i + 1}/${rgbaFrames.length} frames`)
  }
}
process.stdout.write("\n")

gif.finish()
const output = gif.bytes()
await mkdir(path.dirname(path.resolve(out)), { recursive: true })
await writeFile(out, output)

console.log(`\n✓ ${out} — ${outW}x${outH}, ${rgbaFrames.length} frames, ${bytes(output.length)}`)
if (framesDir) console.log(`✓ ${framesDir}/ — PNG sequence at ${outW}x${outH}`)

// ---------------------------------------------------------------------------
// mp4 (opt-in)
// ---------------------------------------------------------------------------
// App Store previews cannot be GIFs, and h264 on flat UI is a fraction of the
// size at full quality. rgbaFrames is already exactly what a video encoder
// wants: full, opaque, final-size frames. --diff only rewrites the
// palette-indexed copy and ditherFrame returns a copy, so nothing above has
// touched them. Piped straight in — no temp files, no new dependency.
function haveFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

function encodeMp4(frames, file) {
  return new Promise((resolve, reject) => {
    const ff = spawn(
      "ffmpeg",
      [
        "-y",
        "-f", "rawvideo",
        "-pix_fmt", "rgba",
        "-s", `${outW}x${outH}`,
        "-framerate", String(fps),
        "-i", "-",
        // yuv420p stores chroma at half resolution, so both dimensions must be
        // even. outH is derived from the stage's aspect ratio and rounded, so an
        // odd height is reachable via --width — without this ffmpeg just fails.
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "slow",
        "-crf", "18",
        "-movflags", "+faststart",
        file,
      ],
      { stdio: ["pipe", "ignore", "pipe"] }
    )

    let log = ""
    ff.stderr.on("data", (d) => (log += d))
    ff.on("error", reject)
    ff.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(log.trim().split("\n").slice(-6).join("\n") || `ffmpeg exited ${code}`))
    )

    // Respect backpressure: a 1200x740 frame is 3.5 MB, so writing 355 of them
    // without waiting for drain buffers the whole animation in memory.
    ;(async () => {
      for (const f of frames) {
        const buf = Buffer.from(f.buffer, f.byteOffset, f.length)
        if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r))
      }
      ff.stdin.end()
    })().catch(reject)
  })
}

if (wantMp4) {
  const mp4Out = out.replace(/\.gif$/i, "") + ".mp4"
  if (!haveFfmpeg()) {
    console.log(
      `\n⚠︎  --mp4 needs ffmpeg, which is not on PATH. Install it with:\n` +
        `     brew install ffmpeg\n` +
        `   The GIF above is unaffected.`
    )
  } else {
    console.log(`encoding mp4 at ${outW}x${outH} ${fps}fps…`)
    try {
      await encodeMp4(rgbaFrames, mp4Out)
      const { size } = await stat(mp4Out)
      console.log(`✓ ${mp4Out} — ${bytes(size)}`)
    } catch (e) {
      console.log(`\n⚠︎  mp4 encode failed. The GIF above is unaffected.\n${e.message}`)
    }
  }
}
if (output.length > 12 * 1024 * 1024) {
  console.log(
    `\nThat is large for a GIF. In order of least visible damage:\n` +
      (wantMp4
        ? ""
        : `  --mp4               h264 instead, a fraction of the size at full quality\n`) +
      `  --width ${Math.round(outW * 0.75)}   smaller frame\n` +
      `  --fps 20            fewer frames\n` +
      `  shorten the loop    fewer frames, and usually a better animation`
  )
}
if (!dither) {
  console.log(
    `\nSeeing bands across a gradient or a soft shadow? Try --dither 12 ` +
      `(higher = finer bands, coarser speckle, bigger file).`
  )
}
if (existsSync(out) === false) process.exitCode = 1
