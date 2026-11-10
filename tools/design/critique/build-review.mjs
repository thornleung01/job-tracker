#!/usr/bin/env node
// Build review.html from a findings.json written as described in docs/design/critique.md (section 2.5).
//
//   node build-review.mjs --findings <dir>/findings.json
//   node build-review.mjs --findings <dir>/findings.json --link --out /tmp/r.html
//
// Frames are inlined as data URIs by default so the output is a single portable
// file. --link references the image paths instead, for large frame sets.
//
// No dependencies. The findings.json schema is in docs/design/critique.md, section 2.5.
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const opt = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? null : argv[i + 1]
}

const findingsPath = opt("findings")
if (!findingsPath) {
  console.error("usage: build-review.mjs --findings <path/to/findings.json> [--link] [--out <path>]")
  process.exit(1)
}

const baseDir = path.dirname(path.resolve(findingsPath))
const outPath = path.resolve(opt("out") ?? path.join(baseDir, "review.html"))
const linkImages = flag("link")

let doc
try {
  doc = JSON.parse(readFileSync(findingsPath, "utf8"))
} catch (err) {
  console.error(`Could not read ${findingsPath}: ${err.message}`)
  process.exit(1)
}

const frames = doc.frames ?? []
const findings = doc.findings ?? []
if (!frames.length) {
  console.error("findings.json has no frames — nothing to anchor findings to.")
  process.exit(1)
}

// Global numbering follows findings.json order, so the numbers here match the
// ones in critique.md.
findings.forEach((f, i) => {
  f.n = i + 1
})

// Display order for grouping, and the heading each layer gets.
const LAYERS = {
  craft: "Craft",
  ws: "Wealthsimple",
  pattern: "Pattern questions",
  ds: "Potential Figma / DS issues",
  content: "Content & tone",
  flow: "Flow logic",
  a11y: "Accessibility",
}
const LAYER_ORDER = Object.keys(LAYERS)
const PRIMARY_LAYERS = ["craft", "ws"]

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
}

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

function imageSrc(rel) {
  const abs = path.resolve(baseDir, rel)
  if (linkImages) return esc(path.relative(path.dirname(outPath), abs))
  const ext = path.extname(abs).toLowerCase()
  const mime = MIME[ext]
  if (!mime) {
    console.error(`Unknown image type for ${rel} — falling back to a link.`)
    return esc(path.relative(path.dirname(outPath), abs))
  }
  try {
    return `data:${mime};base64,${readFileSync(abs).toString("base64")}`
  } catch (err) {
    console.error(`Could not read frame ${rel}: ${err.message} — falling back to a link.`)
    return esc(path.relative(path.dirname(outPath), abs))
  }
}

function findingCard(f) {
  // Problem, why, fix — in that order, and nothing else. The layer is a group
  // heading rather than a pill on every finding, and `region` lives on the
  // marker's tooltip since the marker already shows where it is.
  const fixLabel = f.layer === "pattern" ? "Ask" : "Fix"
  const fix = f.fix ? `<p class="fix"><span>${fixLabel}</span> ${esc(f.fix)}</p>` : ""
  const cond = f.if ? `<p class="cond">Holds if ${esc(f.if)}</p>` : ""
  const num = f.box
    ? `<button class="num" data-goto="marker" data-n="${f.n}" title="Show on the frame">${f.n}</button>`
    : `<span class="num">${f.n}</span>`
  return `<article class="finding" data-n="${f.n}" tabindex="0">
  <h3>${num}${esc(f.title)}</h3>
  <p class="reads">${esc(f.reads)}</p>
  ${fix}
  ${cond}
</article>`
}

// Findings for one frame (or the surface), grouped by layer under a quiet
// heading, with the same primary/secondary break critique.md uses.
function findingGroups(list) {
  if (!list.length) return '<p class="clean">Nothing flagged on this frame.</p>'
  const groupsFor = (layers) =>
    layers
      .filter((k) => list.some((f) => (f.layer ?? "craft") === k))
      .map((k) => {
        const inLayer = list.filter((f) => (f.layer ?? "craft") === k)
        return `<div class="group">
      <p class="group-label">${esc(LAYERS[k])}</p>
      ${inLayer.map(findingCard).join("\n      ")}
    </div>`
      })
      .join("\n    ")

  const primary = groupsFor(PRIMARY_LAYERS)
  const secondary = groupsFor(LAYER_ORDER.filter((k) => !PRIMARY_LAYERS.includes(k)))
  return [primary, secondary && `<div class="secondary"><p class="secondary-label">Secondary FYIs</p>${secondary}</div>`]
    .filter(Boolean)
    .join("\n    ")
}

function marker(f) {
  const b = f.box
  if (!b) return ""
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v)))
  const x = clamp(b.x ?? 0, 0, 100)
  const y = clamp(b.y ?? 0, 0, 100)
  const w = clamp(b.w ?? 0, 0, 100 - x)
  const h = clamp(b.h ?? 0, 0, 100 - y)
  return `<div class="marker" data-n="${f.n}" style="left:${x}%;top:${y}%;width:${w}%;height:${h}%">
    <button class="badge" data-goto="finding" data-n="${f.n}" title="${esc(f.region ? f.n + " — " + f.region : "Finding " + f.n)}">${f.n}</button>
  </div>`
}

const frameSections = frames
  .map((frame) => {
    const own = findings.filter((f) => f.frame === frame.id)
    const dims = frame.width && frame.height ? `${frame.width} × ${frame.height}` : ""
    const unpinned = own.filter((f) => !f.box).length
    const note = unpinned
      ? `<p class="unpinned">${unpinned} finding${unpinned > 1 ? "s" : ""} on this frame ${
          unpinned > 1 ? "are" : "is"
        } not pinned to a region.</p>`
      : ""
    return `<section class="frame">
  <div class="stage">
    <div class="shot">
      <img src="${imageSrc(frame.image)}" alt="${esc(frame.label ?? frame.id)}">
      ${own.map(marker).join("\n      ")}
    </div>
    <p class="caption">${esc(frame.label ?? frame.id)}${dims ? ` <span>${dims}</span>` : ""}</p>
  </div>
  <div class="notes">
    ${findingGroups(own)}
    ${note}
  </div>
</section>`
  })
  .join("\n")

const frameIds = new Set(frames.map((f) => f.id))
const orphans = findings.filter((f) => f.frame && !frameIds.has(f.frame))
if (orphans.length) {
  console.error(
    `${orphans.length} finding(s) name a frame that doesn't exist ` +
      `(${[...new Set(orphans.map((f) => f.frame))].join(", ")}) — ` +
      `rendering them at surface level so they aren't lost.`,
  )
}
// Anything not pinned to a real frame renders at surface level rather than
// disappearing.
const flowLevel = findings.filter((f) => !f.frame || !frameIds.has(f.frame))
const flowSection = flowLevel.length
  ? `<section class="across">
  <h2>Across the ${doc.kind === "flow" ? "flow" : "surface"}</h2>
  <div class="notes">
    ${findingGroups(flowLevel)}
  </div>
</section>`
  : ""

const assumptions = doc.assumptions ?? []
const assumptionsBlock = assumptions.length
  ? `<div class="assumptions"><p class="lead">Read as</p><ul>${assumptions
      .map((a) => `<li>${esc(a)}</li>`)
      .join("")}</ul></div>`
  : ""

const followups = doc.followups ?? []
const followupsSection = followups.length
  ? `<section class="followups">
  <h2>Worth confirming</h2>
  <p class="lead">Answers here would change a finding above — nothing was blocked on them.</p>
  <ol>${followups.map((q) => `<li>${esc(q)}</li>`).join("")}</ol>
</section>`
  : ""

const counts = Object.entries(
  findings.reduce((acc, f) => {
    const k = LAYERS[f.layer] ?? "Note"
    acc[k] = (acc[k] ?? 0) + 1
    return acc
  }, {}),
)
  // Labels keep their own casing — "Wealthsimple" is a proper noun.
  .map(([k, v]) => `${v} ${k}`)
  .join(" · ")

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title ?? "Design critique")}</title>
<style>
  :root {
    --bg: #f2f2f2;
    --surface: #fafafa;
    --text: #000;
    --soft: rgba(0, 0, 0, 0.55);
    --subdued: rgba(0, 0, 0, 0.42);
    --outline: rgba(0, 0, 0, 0.08);
    --accent: #c02416;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 40px 16px 96px;
    background: var(--bg);
    color: var(--text);
    font-family: "Wealthsimple Sans Display", -apple-system, "SF Pro Display", system-ui, sans-serif;
    font-size: 16px;
    line-height: 22px;
    -webkit-font-smoothing: antialiased;
    text-wrap: pretty;
  }
  .wrap { max-width: 1180px; margin: 0 auto; }
  a { text-decoration: none; color: inherit; }
  h1 { font-size: 32px; line-height: 38px; letter-spacing: -0.64px; font-weight: 500; margin: 0; text-wrap: balance; }
  h2 { font-size: 20px; line-height: 28px; letter-spacing: -0.2px; font-weight: 500; margin: 0 0 8px; }
  h3 { font-size: 16px; line-height: 22px; font-weight: 500; margin: 0; }
  header.page { margin-bottom: 64px; }
  header.page .intent { margin: 8px 0 0; color: var(--soft); max-width: 62ch; }
  header.page .tally { margin: 16px 0 0; color: var(--subdued); font-size: 14px; line-height: 20px; }

  /* The frame renders at actual size and scrolls; the findings stay pinned
     beside it, so a callout and its finding are always co-visible. */
  .frame { display: grid; grid-template-columns: minmax(0, 420px) minmax(0, 1fr); gap: 40px; margin-bottom: 64px; align-items: start; }
  .shot { position: relative; border-radius: 20px; overflow: hidden; background: var(--surface);
          box-shadow: 0 0 0 1px rgba(0,0,0,0.05); }
  .shot img { display: block; width: 100%; height: auto; }
  .caption { margin: 8px 0 0; font-size: 14px; line-height: 20px; color: var(--soft); }
  .caption span { color: var(--subdued); }

  .notes { position: sticky; top: 40px; max-height: calc(100vh - 80px); overflow-y: auto; }

  .marker { position: absolute; border: 1.5px solid transparent; border-radius: 8px; transition: background 120ms ease-out, border-color 120ms ease-out; }
  .marker .badge {
    position: absolute; top: -11px; left: -11px; width: 22px; height: 22px; border-radius: 999px;
    background: var(--accent); color: #fff; font-size: 12px; line-height: 22px; text-align: center;
    font-weight: 500; box-shadow: 0 2px 6px rgba(0,0,0,0.3); cursor: pointer;
    border: none; padding: 0; font-family: inherit;
  }
  .marker .badge:hover, .marker .badge:focus-visible { transform: scale(1.15); outline: none; }
  .marker.on { background: rgba(192, 36, 22, 0.14); border-color: var(--accent); }

  /* Findings sit on the background, not in cards — a stack of raised cards is
     the thing W2 and W4 in the rubric warn about. */
  .group { margin-bottom: 40px; }
  .secondary { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--outline); }
  .secondary-label { margin: 0 0 16px; font-size: 14px; line-height: 20px; color: var(--subdued); }
  .group-label { margin: 0 0 8px; font-size: 14px; line-height: 20px; color: var(--subdued); }

  .finding { padding: 16px 8px; margin: 0 -8px; border-top: 1px solid var(--outline);
             border-radius: 12px; outline: none; transition: background 120ms ease-out; }
  .finding:first-of-type { border-top: none; }
  .finding.on, .finding:focus-visible, .finding:hover { background: rgba(0, 0, 0, 0.04); }

  .finding h3 { display: flex; gap: 8px; align-items: baseline; margin: 0; font-weight: 500; text-wrap: balance; }
  .finding .num { flex: 0 0 22px; width: 22px; height: 22px; border-radius: 999px; background: var(--accent);
                  color: #fff; font-size: 12px; line-height: 22px; text-align: center; font-weight: 500;
                  border: none; padding: 0; font-family: inherit; cursor: pointer; }
  .finding span.num { cursor: default; }
  .finding .num:hover, .finding .num:focus-visible { transform: scale(1.15); outline: none; }
  .finding .reads { margin: 8px 0 0 30px; color: var(--soft); }
  .finding .fix { margin: 8px 0 0 30px; }
  .finding .fix span { color: var(--subdued); }
  .finding .cond { margin: 8px 0 0 30px; font-size: 14px; line-height: 20px; color: var(--subdued); }
  @keyframes flash { 0%, 100% { background: transparent; } 35% { background: rgba(192, 36, 22, 0.12); } }
  .finding.flash { animation: flash 900ms ease-out; }
  .clean, .unpinned { margin: 0; color: var(--subdued); font-size: 14px; line-height: 20px; }

  .across { margin-top: 64px; padding-top: 40px; border-top: 1px solid var(--outline); }
  .across .notes { max-width: 720px; position: static; max-height: none; overflow: visible; }

  @media (max-width: 860px) {
    .frame { grid-template-columns: minmax(0, 1fr); gap: 16px; }
    .stage { max-width: 420px; }
    /* Single column: pinning the findings would cover the frame. */
    .notes { position: static; max-height: none; overflow: visible; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header class="page">
    <h1>${esc(doc.title ?? "Design critique")}</h1>
    ${doc.intent ? `<p class="intent">${esc(doc.intent)}</p>` : ""}
    ${counts ? `<p class="tally">${esc(counts)}</p>` : ""}
    ${assumptionsBlock}
  </header>
${frameSections}
${flowSection}
${followupsSection}
</div>
<script>
  // Hovering a finding highlights its marker, and vice versa.
  const pair = (n, on) => {
    document.querySelectorAll('.finding[data-n="' + n + '"], .marker[data-n="' + n + '"]').forEach((el) =>
      el.classList.toggle("on", on),
    )
  }
  document.querySelectorAll(".finding, .marker").forEach((el) => {
    const n = el.dataset.n
    el.addEventListener("mouseenter", () => pair(n, true))
    el.addEventListener("mouseleave", () => pair(n, false))
    el.addEventListener("focus", () => pair(n, true))
    el.addEventListener("blur", () => pair(n, false))
  })

  // Callout <-> finding navigation. A tall long-scroll frame can't keep a marker
  // and its finding on screen together, so clicking either one brings the other
  // into view.
  document.querySelectorAll("[data-goto]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation()
      const { goto: target, n } = btn.dataset
      const el = document.querySelector("." + target + '[data-n="' + n + '"]')
      if (!el) return
      el.scrollIntoView({ behavior: "smooth", block: "center" })
      pair(n, true)
      if (target === "finding") {
        el.classList.remove("flash")
        void el.offsetWidth // restart the animation if it's already played
        el.classList.add("flash")
      }
      setTimeout(() => pair(n, false), 1600)
    })
  })

</script>
</body>
</html>
`

writeFileSync(outPath, html)
const pinned = findings.filter((f) => f.box).length
console.log(
  `Wrote ${outPath}\n${frames.length} frame(s), ${findings.length} finding(s), ${pinned} pinned to a region.`,
)
