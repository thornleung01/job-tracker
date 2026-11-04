// Sankey geometry, ported from the script in jobtracker/templates/flow.html. Pure: data in, coordinates out.
import type { FlowData } from "../../sync/stats";

export const NODE_W = 14;
export const COLS = 5;
export const HEIGHT_PAD = { top: 52, bottom: 18, left: 120, right: 140 } as const;
export const INNER_H = 420;
export const MIN_H = 8;
export const MAX_PX_PER_APP = 40;
export const DEFAULT_WIDTH = 1000;
/** A link is never drawn thinner than this, however few applications took the path. */
export const MIN_LINK_PX = 1.5;
/** The invisible hover and focus target around a link is at least this wide. */
export const MIN_HIT_PX = 14;

/** Stages use data-viz 01-04 in order, Offer is green, Rejected red, and "no outcome yet" grey. Defined in flow.css. */
export const COLORS: Readonly<Record<string, string>> = {
  Applied: "var(--ord-1)",
  "Heard back": "var(--ord-2)",
  Assessment: "var(--ord-3)",
  Interview: "var(--ord-4)",
  Offer: "var(--good)",
  Rejected: "var(--crit)",
  "No response yet": "var(--neutral)",
  "Still open": "var(--neutral)",
};
const colorOf = (id: string) => COLORS[id] ?? "var(--neutral)";

/** Lucide check and x on their 24px grid. The chart scales them to 16px and strokes them at 3 (2px on screen). */
export const ICON_PATHS = {
  check: ["M20 6 9 17l-5-5"],
  x: ["M18 6 6 18", "m6 6 12 12"],
} as const;
export const ICON_SIZE = 16;

export interface NodeLayout {
  id: string;
  col: number;
  value: number;
  pct: number;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  /** "Next: Heard back 2, No response yet 1", in the order the flows leave the node */
  next: { target: string; value: number }[];
  /** indexes into `links` of every flow that starts or ends here */
  flows: number[];
  label: { x: number; y: number; anchor: "start" | "middle" | "end"; sub: { x: number; y: number }; icon: null | { kind: keyof typeof ICON_PATHS; x: number; y: number } };
}

export interface SegmentLayout {
  /** real node ids, or "Source>Target@col" for the invisible stops of a flow that skips columns */
  from: string;
  to: string;
  d: string;
  /** exact band thickness: applications times the vertical scale */
  thickness: number;
  /** drawn width: thickness, but never below MIN_LINK_PX */
  width: number;
  hitWidth: number;
  sy: number;
  ty: number;
}

export interface LinkLayout {
  index: number;
  source: string;
  target: string;
  value: number;
  pct: number;
  color: string;
  segments: SegmentLayout[];
}

export interface SankeyLayout {
  width: number;
  height: number;
  /** pixels of height per application */
  scale: number;
  nodes: NodeLayout[];
  links: LinkLayout[];
}

interface N {
  id: string;
  col: number;
  real: boolean;
  in: S[];
  out: S[];
  value: number;
  size: number;
  w: number;
  h: number;
  x: number;
  y: number;
  pct: number;
}
interface F {
  index: number;
  source: string;
  target: string;
  value: number;
  pct: number;
  s: N;
  t: N;
  segs: S[];
}
interface S {
  s: N;
  t: N;
  value: number;
  flow: F;
  sy: number;
  ty: number;
}

const sum = (arr: S[]) => arr.reduce((a, s) => a + s.value, 0);

export function layoutSankey(data: Pick<FlowData, "nodes" | "links">, width: number = DEFAULT_WIDTH): SankeyLayout {
  const { top: mt, bottom: mb, left: ml, right: mr } = HEIGHT_PAD;
  const H = mt + INNER_H + mb;
  const colX = (c: number) => ml + c * ((width - ml - mr - NODE_W) / (COLS - 1));

  // A flow that skips columns is routed through invisible pass-through nodes, one per column it crosses,
  // so it travels in its own lane instead of running behind the real nodes.
  const real: N[] = data.nodes.map((n) => ({ id: n.id, col: n.col, real: true, in: [], out: [], value: n.value, size: 0, w: 0, h: 0, x: 0, y: 0, pct: n.pct }));
  const byId = new Map(real.map((n) => [n.id, n]));
  const flows: F[] = [];
  data.links.forEach((l, index) => {
    const s = byId.get(l.source);
    const t = byId.get(l.target);
    if (s && t) flows.push({ index, source: l.source, target: l.target, value: l.value, pct: l.pct, s, t, segs: [] });
  });
  const pass: N[] = [];
  const segs: S[] = [];
  const addSeg = (a: N, b: N, flow: F) => {
    const sg: S = { s: a, t: b, value: flow.value, flow, sy: 0, ty: 0 };
    a.out.push(sg);
    b.in.push(sg);
    segs.push(sg);
    flow.segs.push(sg);
  };
  for (const f of flows) {
    let prev = f.s;
    for (let c = f.s.col + 1; c < f.t.col; c++) {
      const v: N = { id: `${f.source}>${f.target}@${c}`, col: c, real: false, in: [], out: [], value: f.value, size: 0, w: 0, h: 0, x: 0, y: 0, pct: 0 };
      pass.push(v);
      addSeg(prev, v, f);
      prev = v;
    }
    addSeg(prev, f.t, f);
  }
  const all = [...real, ...pass];
  for (const n of all) {
    n.size = Math.max(sum(n.in), sum(n.out));
    n.w = n.real ? NODE_W : 0;
  }

  const cols = [...Array(COLS)].map((_, c) => all.filter((n) => n.col === c)); // top-to-bottom order, reordered below
  const gapFor = (c: number, a: N, b: N) => (c === 0 || c === COLS - 1 ? 28 : b.real ? 46 : a.real ? 14 : 6); // room for labels above real nodes
  const gapsOf = (col: N[]) => col.slice(1).reduce((t, n, i) => t + gapFor(col[0].col, col[i], n), 0);
  const heightOf = (n: N, k: number) => (n.real ? Math.max(n.size * k, MIN_H) : n.size * k);

  function place(): number {
    let k = MAX_PX_PER_APP;
    for (let i = 0; i < 8; i++) {
      for (const col of cols) {
        if (!col.length) continue;
        const gaps = gapsOf(col);
        const used = col.reduce((t, n) => t + heightOf(n, k), 0) + gaps;
        if (used > INNER_H) k *= (INNER_H - gaps) / (used - gaps);
      }
    }
    cols.forEach((col, c) => {
      if (!col.length) return;
      const total = col.reduce((t, n) => t + heightOf(n, k), 0) + gapsOf(col);
      let y = mt + (INNER_H - total) / 2;
      col.forEach((n, i) => {
        if (i) y += gapFor(c, col[i - 1], n);
        n.h = heightOf(n, k);
        n.y = y;
        n.x = colX(c) + (n.real ? 0 : NODE_W / 2);
        y += n.h;
      });
    });
    return k;
  }

  // Reorder the two middle columns so flows cross as little as possible (barycenter method).
  let ky = place();
  const center = (n: N) => n.y + n.h / 2;
  for (let round = 0; round < 12; round++) {
    for (const c of round % 2 ? [3, 2] : [2, 3]) {
      const score = new Map(
        cols[c].map((n) => {
          const nb: [N, number][] = [...n.in.map((s): [N, number] => [s.s, s.value]), ...n.out.map((s): [N, number] => [s.t, s.value])];
          const w = nb.reduce((t, [, v]) => t + v, 0);
          return [n, w ? nb.reduce((t, [m, v]) => t + center(m) * v, 0) / w : center(n)] as const;
        }),
      );
      cols[c].sort((a, b) => score.get(a)! - score.get(b)!);
    }
    ky = place();
  }

  // Where each flow enters and leaves a node, stacked in the order of the nodes it connects to.
  for (const n of all) {
    let o = n.y;
    for (const s of n.out.sort((a, b) => center(a.t) - center(b.t))) {
      s.sy = o + (s.value * ky) / 2;
      o += s.value * ky;
    }
    let i = n.y;
    for (const s of n.in.sort((a, b) => center(a.s) - center(b.s))) {
      s.ty = i + (s.value * ky) / 2;
      i += s.value * ky;
    }
  }

  const links: LinkLayout[] = flows.map((f) => ({
    index: f.index,
    source: f.source,
    target: f.target,
    value: f.value,
    pct: f.pct,
    color: colorOf(f.target),
    segments: f.segs.map((sg) => {
      const x0 = sg.s.x + sg.s.w;
      const x1 = sg.t.x;
      const xm = (x0 + x1) / 2;
      const thickness = sg.value * ky;
      const w = Math.max(thickness, MIN_LINK_PX);
      return {
        from: sg.s.id,
        to: sg.t.id,
        d: `M${x0},${sg.sy} C${xm},${sg.sy} ${xm},${sg.ty} ${x1},${sg.ty}`,
        thickness,
        width: w,
        hitWidth: Math.max(w, MIN_HIT_PX),
        sy: sg.sy,
        ty: sg.ty,
      };
    }),
  }));

  const nodes: NodeLayout[] = real.map((n) => {
    let x: number;
    let y: number;
    let anchor: "start" | "middle" | "end";
    if (n.col === 0) {
      x = n.x - 10;
      y = n.y + n.h / 2 - 2;
      anchor = "end";
    } else if (n.col === COLS - 1) {
      x = n.x + NODE_W + 10;
      y = n.y + n.h / 2 - 2;
      anchor = "start";
    } else {
      x = n.x + NODE_W / 2;
      y = n.y - 20;
      anchor = "middle";
    }
    let icon: NodeLayout["label"]["icon"] = null;
    if (n.id === "Offer" || n.id === "Rejected") {
      icon = { kind: n.id === "Offer" ? "check" : "x", x, y: y - 12.5 };
      x += 22;
    }
    return {
      id: n.id,
      col: n.col,
      value: n.value,
      pct: n.pct,
      x: n.x,
      y: n.y,
      w: NODE_W,
      h: n.h,
      color: colorOf(n.id),
      next: n.out.map((s) => ({ target: s.flow.target, value: s.value })),
      flows: [...new Set([...n.in, ...n.out].map((s) => s.flow.index))],
      label: { x, y, anchor, sub: { x, y: y + 15 }, icon },
    };
  });

  return { width, height: H, scale: ky, nodes, links };
}
