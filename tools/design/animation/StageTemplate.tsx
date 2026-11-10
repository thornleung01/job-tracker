// Animation stage starter. Copy this file and stage.css into web/src/pages/stage/ (see README.md in this folder for the route and the
// page), rename the component and the exported description constants, then fill in CONTENT, FRAMES and SCRIPT.
//
// Read docs/design/animation.md (sections 3 and 5) before changing the camera or the script.
// The classes are plain CSS in stage.css (the app has no Tailwind). Colours are tuned for the app's light ground.
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { motion } from "motion/react"

export const STAGE_TEMPLATE_DESCRIPTION =
  "1200x740 animation stage." /* say what it is for */

export const STAGE_TEMPLATE_HINT = "Three scenes: load in, focus, detail."

// The app's own stack (Wealthsimple Sans Display first, then Figtree). See web/src/styles for --font-ui.
const DISPLAY = "var(--font-ui)"

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------
// Export size, fixed. Everything inside is authored at these exact pixels and
// the whole thing is transform-scaled to fit the window, so the preview is
// proportionally identical to the captured frame.
export const STAGE_WIDTH = 1200
export const STAGE_HEIGHT = 740

// Square corners on purpose: the container clips the artwork to its own radius,
// so a radius baked in here reads as a double-rounded edge. The background
// bleeds to all four edges for the same reason.
const STAGE_BACKGROUND =
  "radial-gradient(120% 90% at 50% 40%, #F1F1F1 0%, #EAEAEA 55%, #E0E0E0 100%)"

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------
// Authored in its own coordinate space, then fitted into the stage's safe area,
// so card and type sizes stay the numbers they were designed at no matter how
// the safe area is retuned.
type Rect = { x: number; y: number; w: number; h: number }

// Card style. Paste Figma's CSS here verbatim, decimals and all.
const CARD_RADIUS = 34.937
const CARD_BORDER = 1.941
const CARD_BACKGROUND = "#FAFAFA"
const CARD_SHADOW = "0 15.528px 46.583px 0 rgba(0, 0, 0, 0.05)"

// Border is inside the fixed card size (border-box), so it comes out of the
// content box along with the padding.
const CARD_PADDING = 28
const CARD_CHROME = (CARD_BORDER + CARD_PADDING) * 2

// Derived, never repeated: retuning CARD_SIZE or CARD_GAP keeps all three edges
// aligned on their own.
const CARD_SIZE = 350
const CARD_GAP = 24
const ROW_WIDTH = CARD_SIZE * 2 + CARD_GAP

// Sized from its own contents rather than a hand-picked number — a fixed height
// that was right once is what starts clipping the last row later.
const DETAIL_ROW = 52
const DETAIL_ROW_GAP = 24
const DETAIL_ROWS = 3
const DETAIL_HEIGHT = Math.ceil(
  DETAIL_ROW * DETAIL_ROWS + DETAIL_ROW_GAP * (DETAIL_ROWS - 1) + CARD_CHROME
)

const CONTENT: Record<"left" | "right" | "detail", Rect> = {
  left: { x: 0, y: 0, w: CARD_SIZE, h: CARD_SIZE },
  right: { x: CARD_SIZE + CARD_GAP, y: 0, w: CARD_SIZE, h: CARD_SIZE },
  detail: { x: 0, y: CARD_SIZE + CARD_GAP, w: ROW_WIDTH, h: DETAIL_HEIGHT },
}

const CONTENT_SIZE = { w: ROW_WIDTH, h: CARD_SIZE + CARD_GAP + DETAIL_HEIGHT }

// Nothing reaches inside this margin, so if the container crops the frame it
// eats background rather than a card. The zoomed scenes deliberately push past
// it — this governs scene 1.
const SAFE_INSET = { x: 160, y: 80 }

// Uniform, so the composition scales rather than stretches. Whichever axis is
// tighter wins; the other gets more margin than it asked for.
const FIT = Math.min(
  (STAGE_WIDTH - SAFE_INSET.x * 2) / CONTENT_SIZE.w,
  (STAGE_HEIGHT - SAFE_INSET.y * 2) / CONTENT_SIZE.h
)

const FIT_ORIGIN = {
  x: (STAGE_WIDTH - CONTENT_SIZE.w * FIT) / 2,
  y: (STAGE_HEIGHT - CONTENT_SIZE.h * FIT) / 2,
}

// The same rects in stage coordinates — what the camera frames. Reading rects
// instead of measuring the DOM is what stops the framing drifting out of sync.
const toStage = (r: Rect): Rect => ({
  x: FIT_ORIGIN.x + r.x * FIT,
  y: FIT_ORIGIN.y + r.y * FIT,
  w: r.w * FIT,
  h: r.h * FIT,
})

const LAYOUT = {
  left: toStage(CONTENT.left),
  right: toStage(CONTENT.right),
  detail: toStage(CONTENT.detail),
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
type CameraKey = "overview" | "pair" | "detail"

// Minimum left/right margin the zoomed scenes keep. A push-in is a horizontal
// crop by nature, so this is necessarily smaller than SAFE_INSET.x.
const ZOOM_SAFE_X = 130

const FRAMES: Record<
  CameraKey,
  { rect: Rect; margin: { x: number; y: number }; biasY?: number }
> = {
  overview: {
    rect: { x: 0, y: 0, w: STAGE_WIDTH, h: STAGE_HEIGHT },
    margin: { x: 0, y: 0 },
  },
  pair: {
    rect: {
      x: LAYOUT.left.x,
      y: LAYOUT.left.y,
      w: LAYOUT.right.x + LAYOUT.right.w - LAYOUT.left.x,
      h: LAYOUT.left.h,
    },
    margin: { x: ZOOM_SAFE_X, y: 96 },
  },
  detail: {
    rect: LAYOUT.detail,
    margin: { x: ZOOM_SAFE_X, y: 120 },
    // Centring leaves a band of bare background beneath, which reads
    // bottom-heavy. Push down to trade it for more of the row above.
    biasY: 120,
  },
}

// translate-then-scale about a top-left origin: p' = translate + scale * p,
// which is the order Motion writes the transform in.
function cameraTransform(key: CameraKey) {
  const { rect, margin, biasY = 0 } = FRAMES[key]
  const scale = Math.min(
    (STAGE_WIDTH - margin.x * 2) / rect.w,
    (STAGE_HEIGHT - margin.y * 2) / rect.h
  )
  return {
    scale,
    x: STAGE_WIDTH / 2 - scale * (rect.x + rect.w / 2),
    y: STAGE_HEIGHT / 2 - scale * (rect.y + rect.h / 2) + biasY,
  }
}

const CAMERA_TRANSITION = { duration: 0.9, ease: [0.32, 0.72, 0, 1] as const }

// ---------------------------------------------------------------------------
// Storyboard
// ---------------------------------------------------------------------------
// One flat script keyed by absolute ms. Every step is a partial state patch, so
// unmentioned keys carry forward and retiming is moving numbers in this list.
type PressKey = "right" | "detail"

type Beat = {
  t: number
  camera?: CameraKey
  active?: boolean
  press?: PressKey | null
}

// Paced so each beat starts ~350-400ms after the previous one has settled.
// Payoff beats get held a little longer.
const SCRIPT: Beat[] = [
  { t: 0, camera: "overview", active: false, press: null },

  { t: 2500, camera: "pair" },
  { t: 3800, press: "right" },
  { t: 4400, press: null, active: true },
  { t: 5800, press: "right" },
  { t: 6400, press: null, active: false },

  { t: 7000, camera: "overview" },
  { t: 8300, camera: "detail" },
  { t: 10600, camera: "overview" },
]

const LOOP_MS = 12000

const SCENE_MARKS: { label: string; at: number }[] = [
  { label: "1 Load in", at: 0 },
  { label: "2 Focus", at: 2300 },
  { label: "3 Detail", at: 8100 },
]

// Long-press hold. Keep in step with the gap between each press beat and its
// follow-up in SCRIPT.
const PRESS_MS = 600
const PRESS_SCALE = 0.95

// ---------------------------------------------------------------------------
// Preview fit
// ---------------------------------------------------------------------------
function useFitScale(width: number, height: number, chromeAllowance: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const availableHeight = window.innerHeight - chromeAllowance
      setScale(
        Math.min(
          1,
          el.clientWidth / width,
          Math.max(0.2, availableHeight / height)
        )
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener("resize", measure)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [width, height, chromeAllowance])

  return { ref, scale }
}

export function StageTemplate() {
  const { ref, scale } = useFitScale(STAGE_WIDTH, STAGE_HEIGHT, 320)
  const [run, setRun] = useState({ id: 0, startAt: 0 })
  const [guides, setGuides] = useState(false)
  const [looping, setLooping] = useState(true)

  useEffect(() => {
    if (!looping) return
    const remaining = LOOP_MS - run.startAt
    const timer = window.setTimeout(
      () => setRun((r) => ({ id: r.id + 1, startAt: 0 })),
      Math.max(1000, remaining)
    )
    return () => window.clearTimeout(timer)
  }, [looping, run])

  const replay = (startAt = 0) => setRun((r) => ({ id: r.id + 1, startAt }))

  return (
    <div ref={ref} className="stage-wrap">
      <div
        style={{
          width: STAGE_WIDTH * scale,
          height: STAGE_HEIGHT * scale,
          visibility: scale ? "visible" : "hidden",
        }}
        className="stage-frame"
      >
        {/* The capture target. Record this element, not the page. */}
        <div
          id="gif-stage"
          data-capture="stage"
          // Publishes the loop length so export-gif.mjs finds it on its own and
          // the export can never drift out of sync with the timeline above.
          data-loop-ms={LOOP_MS}
          style={{
            width: STAGE_WIDTH,
            height: STAGE_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            background: STAGE_BACKGROUND,
          }}
          className="stage-capture"
        >
          <Scene key={run.id} startAt={run.startAt} />
          {guides && <Guides />}
        </div>
      </div>

      {/* Controls live outside the capture element so they can never land in a
          frame. */}
      <div className="stage-controls">
        <button
          type="button"
          onClick={() => replay(0)}
          className="stage-btn stage-btn-primary"
        >
          Replay
        </button>
        {SCENE_MARKS.map((mark) => (
          <button
            key={mark.label}
            type="button"
            onClick={() => replay(mark.at)}
            className="stage-btn"
          >
            {mark.label}
          </button>
        ))}
        <Toggle active={looping} onClick={() => setLooping((v) => !v)}>
          Loop
        </Toggle>
        <Toggle active={guides} onClick={() => setGuides((v) => !v)}>
          Guides
        </Toggle>
        <span className="stage-readout">
          {STAGE_WIDTH} x {STAGE_HEIGHT} at {Math.round(scale * 100)}% - loop{" "}
          {(LOOP_MS / 1000).toFixed(1)}s
        </span>
      </div>
    </div>
  )
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`stage-btn${active ? " is-on" : ""}`}
    >
      {children}
    </button>
  )
}

// Centre lines, the declared SAFE_INSET box (red), and the composition's actual
// bounding box (blue). The gap between them is the slack the uniform fit gave
// back, which makes crop tolerance visible at a glance.
function Guides() {
  return (
    <div className="stage-guides">
      <div className="stage-guide-h" />
      <div className="stage-guide-v" />
      <div
        className="stage-guide-safe"
        style={{
          left: SAFE_INSET.x,
          top: SAFE_INSET.y,
          right: SAFE_INSET.x,
          bottom: SAFE_INSET.y,
        }}
      />
      <div
        className="stage-guide-box"
        style={{
          left: FIT_ORIGIN.x,
          top: FIT_ORIGIN.y,
          width: CONTENT_SIZE.w * FIT,
          height: CONTENT_SIZE.h * FIT,
        }}
      />
    </div>
  )
}

// ===========================================================================
// Scene
// ===========================================================================
// Remounted on every replay, so entrances are plain initial -> animate with no
// reset logic. Seeking applies every prior beat instantly and skips the intro,
// so the cards don't re-stagger in the middle of scene 3.
const IntroContext = createContext(true)

const EASE = [0.22, 1, 0.36, 1] as const

const BEAT = {
  left: 0.0,
  right: 0.18,
  detail: 0.6,
}

function Scene({ startAt }: { startAt: number }) {
  const initial = useMemo(() => {
    const state = {
      camera: "overview" as CameraKey,
      active: false,
      press: null as PressKey | null,
    }
    for (const beat of SCRIPT) {
      if (beat.t > startAt) break
      if (beat.camera !== undefined) state.camera = beat.camera
      if (beat.active !== undefined) state.active = beat.active
      if (beat.press !== undefined) state.press = beat.press
    }
    return state
  }, [startAt])

  const [camera, setCamera] = useState(initial.camera)
  const [active, setActive] = useState(initial.active)
  const [press, setPress] = useState(initial.press)

  useEffect(() => {
    const timers = SCRIPT.filter((beat) => beat.t > startAt).map((beat) =>
      window.setTimeout(() => {
        if (beat.camera !== undefined) setCamera(beat.camera)
        if (beat.active !== undefined) setActive(beat.active)
        if (beat.press !== undefined) setPress(beat.press)
      }, beat.t - startAt)
    )
    return () => timers.forEach(window.clearTimeout)
  }, [startAt])

  const target = cameraTransform(camera)

  return (
    <IntroContext.Provider value={startAt === 0}>
      <motion.div
        className="stage-abs stage-origin"
        style={{
          width: STAGE_WIDTH,
          height: STAGE_HEIGHT,
          transformOrigin: "0px 0px",
        }}
        initial={{ scale: target.scale, x: target.x, y: target.y }}
        animate={{ scale: target.scale, x: target.x, y: target.y }}
        transition={CAMERA_TRANSITION}
      >
        {/* Content space, fitted into the safe area. */}
        <div
          className="stage-abs"
          style={{
            left: FIT_ORIGIN.x,
            top: FIT_ORIGIN.y,
            width: CONTENT_SIZE.w,
            height: CONTENT_SIZE.h,
            transform: `scale(${FIT})`,
            transformOrigin: "0px 0px",
          }}
        >
          <Card rect={CONTENT.left} delay={BEAT.left} name="left">
            <Label>Left</Label>
          </Card>
          <Card
            rect={CONTENT.right}
            delay={BEAT.right}
            name="right"
            pressed={press === "right"}
          >
            <Label>{active ? "Active" : "Right"}</Label>
          </Card>
          <Card
            rect={CONTENT.detail}
            delay={BEAT.detail}
            name="detail"
            pressed={press === "detail"}
          >
            <Label>Detail</Label>
          </Card>
        </div>
      </motion.div>
    </IntroContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Card shell
// ---------------------------------------------------------------------------
// A full-height flex column, so whatever sits last lands one padding off the
// bottom regardless of how the arithmetic rounds. Chrome renders the 1.941px
// border at 1px, and that slack has to go somewhere.
function Card({
  rect,
  delay,
  name,
  children,
  pressed = false,
  height,
}: {
  rect: Rect
  delay: number
  name: string
  children: React.ReactNode
  pressed?: boolean
  height?: number
}) {
  const intro = useContext(IntroContext)
  const enter = { opacity: 1, y: 0 }

  return (
    <motion.div
      className="stage-card"
      data-card={name}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        borderRadius: CARD_RADIUS,
        border: `${CARD_BORDER}px solid #FFF`,
        padding: CARD_PADDING,
        background: CARD_BACKGROUND,
        boxShadow: CARD_SHADOW,
      }}
      initial={intro ? { opacity: 0, y: 32 } : enter}
      animate={{
        ...enter,
        height: height ?? rect.h,
        scale: pressed ? PRESS_SCALE : 1,
      }}
      transition={{
        opacity: intro ? { duration: 0.6, ease: EASE, delay } : { duration: 0 },
        y: intro ? { duration: 0.6, ease: EASE, delay } : { duration: 0 },
        height: { duration: 0.5, ease: EASE },
        scale: { duration: PRESS_MS / 1000, ease: EASE },
      }}
    >
      {children}
    </motion.div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="stage-label"
      style={{ fontFamily: DISPLAY }}
    >
      {children}
    </p>
  )
}
