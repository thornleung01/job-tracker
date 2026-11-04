import { describe, expect, it } from "vitest";
import { COLORS, COLS, HEIGHT_PAD, INNER_H, MIN_H, layoutSankey } from "../../../src/pages/flow/layout";
import type { FlowData, FlowNodeId } from "../../../src/sync/stats";

const COL: Record<FlowNodeId, number> = {
  Applied: 0, "Heard back": 1, "No response yet": 1, Assessment: 2, Interview: 3, Offer: 4, Rejected: 4, "Still open": 4,
};

/** Build nodes and links from paths, the way stats.sankey does. */
function graph(paths: [FlowNodeId[], number][]): Pick<FlowData, "nodes" | "links"> {
  const total = paths.reduce((t, [, n]) => t + n, 0);
  const nodes = new Map<FlowNodeId, number>();
  const links = new Map<string, number>();
  for (const [path, n] of paths) {
    path.forEach((id, i) => {
      nodes.set(id, (nodes.get(id) ?? 0) + n);
      if (i) links.set(`${path[i - 1]}>${id}`, (links.get(`${path[i - 1]}>${id}`) ?? 0) + n);
    });
  }
  const pct = (n: number) => Math.round((100 * n) / total);
  return {
    nodes: [...nodes].map(([id, value]) => ({ id, col: COL[id], value, pct: pct(value) })),
    links: [...links].map(([k, value]) => {
      const [source, target] = k.split(">") as [FlowNodeId, FlowNodeId];
      return { source, target, value, pct: pct(value) };
    }),
  };
}

const BIG = graph([
  [["Applied", "No response yet"], 12],
  [["Applied", "Heard back", "Still open"], 5],
  [["Applied", "Heard back", "Rejected"], 6],
  [["Applied", "Heard back", "Assessment", "Rejected"], 2],
  [["Applied", "Heard back", "Assessment", "Interview", "Still open"], 2],
  [["Applied", "Heard back", "Interview", "Offer"], 2],
  [["Applied", "Heard back", "Assessment", "Interview", "Rejected"], 1],
]);
const TINY = graph([[["Applied", "No response yet"], 1]]);

describe("layoutSankey", () => {
  it("is deterministic", () => {
    expect(layoutSankey(BIG)).toEqual(layoutSankey(BIG));
    expect(JSON.stringify(layoutSankey(BIG, 1200))).toBe(JSON.stringify(layoutSankey(BIG, 1200)));
  });

  it("sizes the viewBox and spreads the five columns across the width", () => {
    const l = layoutSankey(BIG, 1000);
    expect(l.width).toBe(1000);
    expect(l.height).toBe(HEIGHT_PAD.top + INNER_H + HEIGHT_PAD.bottom);
    const xs = (c: number) => l.nodes.find((n) => n.col === c)!.x;
    expect(xs(0)).toBe(HEIGHT_PAD.left);
    expect(xs(COLS - 1)).toBe(1000 - HEIGHT_PAD.right - 14);
    for (let c = 1; c < COLS; c++) expect(xs(c)).toBeGreaterThan(xs(c - 1));
    expect(layoutSankey(BIG, 1400).nodes.find((n) => n.col === 4)!.x).toBeGreaterThan(xs(4));
  });

  it("makes link thickness add up to the node height at both ends", () => {
    for (const data of [BIG, TINY]) {
      const l = layoutSankey(data);
      for (const n of l.nodes) {
        const into = l.links.flatMap((k) => k.segments).filter((s) => s.to === n.id).reduce((t, s) => t + s.thickness, 0);
        const out = l.links.flatMap((k) => k.segments).filter((s) => s.from === n.id).reduce((t, s) => t + s.thickness, 0);
        const flow = Math.max(into, out);
        // a node is never shorter than MIN_H, so a very small one is taller than its bands
        if (flow >= MIN_H) expect(n.h).toBeCloseTo(flow, 6);
        else expect(n.h).toBe(MIN_H);
        if (into && out) expect(into).toBeCloseTo(out, 6);
      }
    }
  });

  it("sizes every band by applications times one shared scale", () => {
    const l = layoutSankey(BIG);
    for (const k of l.links) for (const s of k.segments) expect(s.thickness).toBeCloseTo(k.value * l.scale, 6);
  });

  it("keeps nodes in a column from overlapping, inside the chart", () => {
    for (const data of [BIG, TINY]) {
      const l = layoutSankey(data);
      for (let c = 0; c < COLS; c++) {
        const col = l.nodes.filter((n) => n.col === c).sort((a, b) => a.y - b.y);
        col.forEach((n, i) => {
          expect(n.y).toBeGreaterThanOrEqual(0);
          expect(n.y + n.h).toBeLessThanOrEqual(l.height);
          if (i) expect(n.y).toBeGreaterThan(col[i - 1].y + col[i - 1].h);
        });
      }
    }
  });

  it("ends every band inside the node it joins", () => {
    const l = layoutSankey(BIG);
    const node = (id: string) => l.nodes.find((n) => n.id === id);
    for (const k of l.links) {
      const first = k.segments[0], last = k.segments.at(-1)!;
      const s = node(k.source)!, t = node(k.target)!;
      expect(first.sy).toBeGreaterThanOrEqual(s.y);
      expect(first.sy).toBeLessThanOrEqual(s.y + s.h);
      expect(last.ty).toBeGreaterThanOrEqual(t.y);
      expect(last.ty).toBeLessThanOrEqual(t.y + t.h);
    }
  });

  it("routes a flow that skips columns through one stop per column it crosses", () => {
    const l = layoutSankey(BIG);
    const skip = l.links.find((k) => k.source === "Heard back" && k.target === "Rejected")!; // column 1 to column 4
    expect(skip.segments).toHaveLength(3);
    expect(skip.segments[0].to).toBe("Heard back>Rejected@2");
    expect(skip.segments[1].from).toBe("Heard back>Rejected@2");
    expect(skip.segments[2].to).toBe("Rejected");
    const next = l.links.find((k) => k.source === "Applied" && k.target === "Heard back")!;
    expect(next.segments).toHaveLength(1);
  });

  it("colors every stage from the one stage map, no outcome grey", () => {
    const l = layoutSankey(BIG);
    const color = (id: string) => l.nodes.find((n) => n.id === id)!.color;
    expect([color("Applied"), color("Heard back"), color("Assessment"), color("Interview")]).toEqual([
      "var(--stage-applied)", "var(--stage-heard-back)", "var(--stage-assessment)", "var(--stage-interview)",
    ]);
    expect(color("Offer")).toBe("var(--stage-offer)");
    expect(color("Rejected")).toBe("var(--stage-rejected)");
    expect(color("Still open")).toBe("var(--neutral)");
    expect(color("No response yet")).toBe("var(--neutral)");
    expect(COLORS["Offer"]).toBe("var(--stage-offer)");
    // a band takes the color of where it ends
    expect(l.links.find((k) => k.target === "Rejected")!.color).toBe("var(--stage-rejected)");
  });

  it("puts the check on Offer and the x on Rejected, and labels each side of the chart", () => {
    const l = layoutSankey(BIG);
    const n = (id: string) => l.nodes.find((m) => m.id === id)!;
    expect(n("Offer").label.icon?.kind).toBe("check");
    expect(n("Rejected").label.icon?.kind).toBe("x");
    expect(n("Applied").label.icon).toBeNull();
    expect(n("Offer").label.x).toBe(n("Offer").label.icon!.x + 22);
    expect(n("Applied").label.anchor).toBe("end");
    expect(n("Offer").label.anchor).toBe("start");
    expect(n("Heard back").label.anchor).toBe("middle");
    expect(n("Heard back").label.y).toBe(n("Heard back").y - 20);
  });

  it("lists where each node leads, and which flows touch it", () => {
    const l = layoutSankey(BIG);
    const heard = l.nodes.find((n) => n.id === "Heard back")!;
    expect(heard.next.reduce((t, s) => t + s.value, 0)).toBe(heard.value);
    const touching = l.links.filter((k) => k.source === "Heard back" || k.target === "Heard back").map((k) => k.index).sort();
    expect([...heard.flows].sort()).toEqual(touching);
  });

  it("handles an empty graph", () => {
    const l = layoutSankey({ nodes: [], links: [] });
    expect(l.nodes).toEqual([]);
    expect(l.links).toEqual([]);
  });
});
