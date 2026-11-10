#!/usr/bin/env node
// Screenshot Job Tracker screens with headless Chrome (no dependencies, Node 22+).
//
//   node shoot.mjs --out <review-dir>/frames [--base http://localhost:5199/job-tracker/]
//        [--shots "settings-desktop:1280:light:#/settings,review-phone:390:light:#/review"]
//        [--no-demo] [--port 9340] [--chrome "/path/to/chrome"]
//
// Start the app first (cd web && npm run dev) and pass its URL as --base.
// A shot is name:width:theme:hash. Each PNG is full-page height (capped at 4000px)
// and the script prints name, width, height so you can copy them into findings.json.
import { spawn } from "node:child_process"
import { writeFileSync, mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const argv = process.argv.slice(2)
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1] }
const out = resolve(opt("out", "frames"))
const BASE = opt("base", "http://localhost:5199/job-tracker/")
const PORT = Number(opt("port", "9340"))
const CHROME = opt("chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
const loadDemo = !argv.includes("--no-demo")
const shots = opt("shots", "settings-desktop:1280:light:#/settings,settings-phone:390:light:#/settings")
  .split(",").map((s) => { const [name, width, theme, ...h] = s.split(":"); return { name, width: Number(width), theme, hash: h.join(":") } })
mkdirSync(out, { recursive: true })

const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "chrome-prof-"))}`,
  "--no-first-run", "--hide-scrollbars", "about:blank",
], { stdio: "ignore" })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Wait for Chrome's DevTools endpoint, then attach to the first page over a websocket.
let targets
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.length) break } catch {}
  await sleep(200)
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })) })
const evalJs = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value

await send("Page.enable")
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
await send("Page.navigate", { url: BASE })
await sleep(2500)
if (loadDemo) {
  // The app starts empty in a fresh profile; the demo button fills it so screens have content.
  console.log("load demo:", await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(b=>/demo/i.test(b.textContent)); if(!b) return 'no button'; b.click(); return 'clicked'; })()`))
  await sleep(3000)
}

for (const { name, width, theme, hash } of shots) {
  const mobile = width < 600
  await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile })
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] })
  await evalJs(`location.hash = ${JSON.stringify(hash)}`)
  await sleep(1800)
  const h = Math.min(await evalJs(`Math.ceil(document.documentElement.scrollHeight)`), 4000)
  // Resize the viewport to the page height so one capture is the whole page.
  await send("Emulation.setDeviceMetricsOverride", { width, height: h, deviceScaleFactor: 1, mobile })
  await sleep(600)
  const r = await send("Page.captureScreenshot", { format: "png" })
  writeFileSync(join(out, `${name}.png`), Buffer.from(r.result.data, "base64"))
  console.log(`${name}.png  ${width}x${h}  overflow: ${await evalJs(`document.documentElement.scrollWidth + ' vs ' + innerWidth`)}`)
}
ws.close(); chrome.kill(); process.exit(0)
