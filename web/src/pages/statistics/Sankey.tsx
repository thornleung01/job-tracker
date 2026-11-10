import { forwardRef, memo, type FocusEvent, type ForwardedRef, type MouseEvent, type ReactNode } from "react";
import { ICON_PATHS, ICON_SIZE, strokeOf, type NodeLayout, type SankeyLayout } from "./layout";

export const apps = (n: number) => `${n} application${n === 1 ? "" : "s"}`;
export const nodeKey = (id: string) => `n:${id}`;
export const flowKey = (index: number) => `f:${index}`;

/** What the tooltip says for a node or a flow. Plain React text, so nothing is ever parsed as markup. */
export function tipContent(layout: SankeyLayout, key: string): ReactNode {
  if (key.startsWith("f:")) {
    const f = layout.links[Number(key.slice(2))];
    if (!f) return null;
    return (
      <>
        <b>
          {f.source} → {f.target}
        </b>
        <br />
        {apps(f.value)} <span className="t2">· {f.pct}% of all</span>
      </>
    );
  }
  const n = layout.nodes.find((m) => nodeKey(m.id) === key);
  if (!n) return null;
  const outs = n.next.map((s) => `${s.target} ${s.value}`).join(", ");
  return (
    <>
      <b>{n.id}</b>
      <br />
      {apps(n.value)} <span className="t2">· {n.pct}% of all</span>
      {outs ? (
        <>
          <br />
          <span className="t2">Next: {outs}</span>
        </>
      ) : null}
    </>
  );
}

/** Which flows light up while a node or flow is active. */
export function flowsFor(layout: SankeyLayout, key: string | null): Set<number> {
  if (!key) return new Set();
  if (key.startsWith("f:")) return new Set([Number(key.slice(2))]);
  const n = layout.nodes.find((m) => nodeKey(m.id) === key);
  return new Set(n ? n.flows : []);
}

export interface ChartHandlers {
  onPoint(key: string, x: number, y: number): void;
  onLeave(): void;
  onFocusKey(key: string, x: number, y: number): void;
  onBlurKey(): void;
  onPick(key: string, x: number, y: number): void;
}

interface Props extends ChartHandlers {
  layout: SankeyLayout;
  /** flows to highlight; null when nothing is active */
  hl: Set<number> | null;
}

function bindProps(key: string, h: ChartHandlers) {
  return {
    onMouseMove: (e: MouseEvent) => h.onPoint(key, e.clientX, e.clientY),
    onMouseLeave: () => h.onLeave(),
    onFocus: (e: FocusEvent<Element>) => {
      const r = e.currentTarget.getBoundingClientRect();
      h.onFocusKey(key, r.left + r.width / 2, r.top + r.height / 2);
    },
    onBlur: () => h.onBlurKey(),
    onClick: (e: MouseEvent) => h.onPick(key, e.clientX, e.clientY),
  };
}

function ChartInner(props: Props, ref: ForwardedRef<SVGSVGElement>) {
  const { layout, hl, ...handlers } = props;
  const { width, height } = layout;
  return (
    <svg
      ref={ref}
      id="sankey"
      viewBox={`0 0 ${width} ${height}`}
      className={hl && hl.size ? "dim" : undefined}
      role="group"
      aria-label="Flow chart of application stages. A table with the same numbers follows."
    >
      <g>
        {layout.links.flatMap((l) =>
          l.segments.map((sg, i) => (
            <path key={`${l.index}-${i}`} d={sg.d} className={hl?.has(l.index) ? "link hl" : "link"} stroke={l.color} strokeWidth={sg.width} />
          )),
        )}
      </g>
      <g>
        {layout.links.flatMap((l) =>
          l.segments.map((sg, i) => {
            const first = i === 0; // one keyboard stop and one spoken label per flow
            const common = { d: sg.d, className: "hit", strokeWidth: sg.hitWidth };
            return first ? (
              <path
                key={`${l.index}-${i}`}
                {...common}
                tabIndex={0}
                role="img"
                aria-label={`${l.source} to ${l.target}: ${apps(l.value)}, ${l.pct}% of all`}
                {...bindProps(flowKey(l.index), handlers)}
              />
            ) : (
              <path key={`${l.index}-${i}`} {...common} aria-hidden="true" {...bindProps(flowKey(l.index), handlers)} />
            );
          }),
        )}
      </g>
      <g>
        {layout.nodes.map((n: NodeLayout) => (
          <g key={n.id} className="node" tabIndex={0} role="img" aria-label={`${n.id}: ${apps(n.value)}, ${n.pct}% of all`} {...bindProps(nodeKey(n.id), handlers)}>
            <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={2} fill={n.color} stroke={strokeOf(n.id)} strokeWidth={1} />
          </g>
        ))}
      </g>
      <g>
        {layout.nodes.map((n) => {
          const { label } = n;
          return (
            <g key={n.id}>
              {label.icon ? (
                // Lucide check / x on its 24px grid, scaled to 16px; stroke 3 renders as 2px.
                <g transform={`translate(${label.icon.x},${label.icon.y}) scale(${ICON_SIZE / 24})`} aria-hidden="true" data-icon={label.icon.kind}>
                  {ICON_PATHS[label.icon.kind].map((d) => (
                    <path key={d} d={d} className="ico" />
                  ))}
                </g>
              ) : null}
              <text x={label.x} y={label.y} textAnchor={label.anchor} className="lbl">
                {n.id}
              </text>
              <text x={label.sub.x} y={label.sub.y} textAnchor={label.anchor} className="lbl sub">
                {n.value} · {n.pct}%
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export const SankeyChart = memo(forwardRef(ChartInner));
