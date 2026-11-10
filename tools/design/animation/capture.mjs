// Headless capture + measurement for an animation stage.
//
//   node capture.mjs --url '<page url>' --at 0,2500,8300 --out /tmp/shots
//   node capture.mjs --url '<page url>' --at 5000 --measure '#gif-stage [data-card]'
//
// playwright is resolved from the working directory first, then from this folder
// (npm install here). Screenshots are of the capture element only (#gif-stage), at
// scale 1: the on-page preview is scaled down to fit the window, so a page
// screenshot is not the export size.
import { mkdir } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

// `playwright` itself is usually only a transitive dep under pnpm, so fall back
// to `@playwright/test`, which re-exports the same browser launchers.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const resolvers = [path.join(process.cwd(), "noop.js"), path.join(HERE, "noop.js")].map((f) => createRequire(f))
const { chromium } = (() => {
  for (const req of resolvers) {
    for (const id of ["playwright", "@playwright/test", "playwright-core"]) {
      try {
        return req(id)
      } catch {
        /* try the next one */
      }
    }
  }
  throw new Error("No playwright package resolvable. Run npm install in " + HERE)
})()

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith("--")) pairs.push([arg.slice(2), all[i + 1] ?? "true"])
    return pairs
  }, [])
)

const url = args.url
const stamps = String(args.at ?? "0").split(",").map(Number)
const outDir = args.out ?? "./shots"
const measureSel = args.measure
// Big enough that useFitScale lands on 1.0 and the stage renders at export size.
// Too narrow and every measurement comes back multiplied by the preview scale.
const viewport = { width: Number(args.vw ?? 1800), height: Number(args.vh ?? 1300) }

if (!url) {
  console.error("--url is required")
  process.exit(1)
}

await mkdir(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport, deviceScaleFactor: 2 })

const failed = []
page.on("requestfailed", (r) => failed.push(r.url()))
page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()))

await page.goto(url, { waitUntil: "networkidle" })
await page.waitForSelector("#gif-stage")
await page.evaluate(() => document.fonts.ready)

// The page shrinks the stage to fit its column, so the preview is never 100%.
// Force it back to scale 1 so screenshots come out at true export size and
// measurements are not multiplied by an arbitrary preview scale.
const stageScale = await page.evaluate(() => {
  const el = document.getElementById("gif-stage")
  if (!el) return 1
  const before = new DOMMatrixReadOnly(getComputedStyle(el).transform).a
  el.style.transform = "scale(1)"
  return before
})
console.log(`preview was at ${(stageScale * 100).toFixed(0)}%, forced to 100%`)

for (const at of stamps) {
  // Replay from t=0 and let the real timeline run, so what you capture is what
  // plays. Seeking via the scene buttons skips the intro and hides whole classes
  // of bug — only use it when you are deliberately testing a later scene.
  // dispatchEvent rather than click: at scale 1 the stage overlaps the controls,
  // so a real click would be intercepted by the artwork sitting on top of them.
  await page
    .getByRole("button", { name: "Replay", exact: true })
    .dispatchEvent("click")
  await page.waitForTimeout(at)

  const file = path.join(outDir, `t-${String(at).padStart(6, "0")}.png`)
  await page.locator("#gif-stage").screenshot({ path: file })
  console.log("wrote", file)

  if (measureSel) {
    const rows = await page.$$eval(measureSel, (els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect()
        const s = getComputedStyle(el)
        // Element-local units: divide out every ancestor transform, otherwise you
        // are measuring stage pixels multiplied by FIT and the camera scale.
        const local = r.width / (el.offsetWidth || r.width)
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? "").trim().slice(0, 28),
          rendered: { w: +r.width.toFixed(2), h: +r.height.toFixed(2) },
          authored: { w: el.offsetWidth, h: el.offsetHeight },
          effectiveScale: +local.toFixed(4),
          radius: s.borderRadius,
          border: s.borderWidth,
          padding: s.padding,
          opacity: s.opacity,
          fontWeight: s.fontWeight,
          fontSize: s.fontSize,
          overflowY: +(el.scrollHeight - el.clientHeight).toFixed(2),
        }
      })
    )
    console.log(`\n@ ${at}ms — ${measureSel}`)
    console.table(rows)
  }
}

if (failed.length) console.error("failed requests:", failed)
await browser.close()
