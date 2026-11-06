import { useId, type ReactNode } from "react";
import type { Speed, Spread, Waiting } from "../../sync/statistics";
import { plural } from "../../sync/text";
import { listUrl } from "../applications";
import { ChartFrame } from "./ChartFrame";
import "./speed.css";

const W = 380;
const X0 = 12;
const X1 = 368;
const PITCH = 54;
const TOP = 6;
const H = TOP + PITCH * 3 + 16;
const GRID_TOP = 2;
const GRID_BOTTOM = TOP + PITCH * 3 - 4;

interface RowDef {
  key: string;
  label: string;
  /** the short name the chart's summary uses: "First reply: median 6 days." */
  short: string;
  spread: Spread;
}

/** Round up to 5, 10, 20, 30, 50, 100, 200, 300, 500, 1000 ... (never under 5). */
export function niceMax(v: number): number {
  const need = Math.max(1, v);
  if (need <= 5) return 5;
  for (let scale = 10; ; scale *= 10) {
    for (const m of [1, 2, 3, 5]) if (m * scale >= need) return m * scale;
  }
}

/** The one axis the three rows share: the largest middle-half end, rounded up. */
export function axisMax(speed: Speed): number {
  return niceMax(Math.max(1, speed.reply.p75 ?? 0, speed.interview.p75 ?? 0, speed.outcome.p75 ?? 0));
}

const days = (n: number) => plural(n, "day");
const apps = (n: number) => plural(n, "application");

/** "Median 6 days, from 14 applications", or "Not enough yet". */
export function medianText(s: Spread): string {
  return s.median === null ? "Not enough yet" : `Median ${days(s.median)}, from ${apps(s.n)}`;
}
function middleHalf(s: Spread): string {
  if (s.p25 === null || s.p75 === null) return "";
  return s.p25 === s.p75 ? days(s.p25) : `${s.p25} to ${days(s.p75)}`;
}
function markLabel(r: RowDef): string {
  const s = r.spread;
  if (s.median === null) return `${r.label}: not enough yet. ${apps(s.n)} so far.`;
  return `${r.label}: median ${days(s.median)}. Middle half took ${middleHalf(s)}, from ${apps(s.n)}.`;
}
function tip(r: RowDef): ReactNode {
  const s = r.spread;
  return (
    <>
      <b>{r.label}</b>
      <br />
      {s.median === null ? (
        <span className="t2">Not enough yet. {apps(s.n)} so far.</span>
      ) : (
        <>
          Median {days(s.median)}
          <br />
          <span className="t2">
            Middle half took {middleHalf(s)}, from {apps(s.n)}
          </span>
        </>
      )}
    </>
  );
}
function summary(rows: readonly RowDef[]): string {
  const parts = rows.map((r) => (r.spread.median === null ? `${r.short}: not enough yet.` : `${r.short}: median ${days(r.spread.median)}.`));
  return `How long companies take. ${parts.join(" ")}`;
}

function WaitingNow({ waiting, account }: { waiting: Waiting; account: number }) {
  const id = useId();
  if (waiting.fresh + waiting.followUp + waiting.ghosted === 0) return null;
  const row = (label: string, count: number, note: string, filter?: { followUp: true } | { ghosted: true }) => {
    const inner = (
      <>
        <span className="wn-text">
          <span className="wn-label">{label}</span>
          {note ? <span className="wn-note">{note}</span> : null}
        </span>
        <span className="wn-count">{count}</span>
      </>
    );
    return <li>{filter && count > 0 ? <a className="wn-row" href={`#${listUrl({ ...filter, account })}`}>{inner}</a> : <span className="wn-row">{inner}</span>}</li>;
  };
  return (
    <section className="card viz-root waiting-now" aria-labelledby={id}>
      <h2 className="section" id={id}>Waiting now</h2>
      <ul>
        {row("Under 7 days", waiting.fresh, "")}
        {row("7 to 29 days", waiting.followUp, "Follow up", { followUp: true })}
        {row("30 days or more", waiting.ghosted, "No reply", { ghosted: true })}
      </ul>
    </section>
  );
}

export function SpeedRanges({ speed, waiting, account }: { speed: Speed; waiting: Waiting; account: number }) {
  const rows: RowDef[] = [
    { key: "s:reply", label: "To first reply", short: "First reply", spread: speed.reply },
    { key: "s:interview", label: "To interview", short: "Interview", spread: speed.interview },
    { key: "s:outcome", label: "To an outcome", short: "Outcome", spread: speed.outcome },
  ];
  const max = axisMax(speed);
  const x = (d: number) => X0 + (d / max) * (X1 - X0);

  const table = (
    <table>
      <thead>
        <tr>
          <th>Step</th>
          <th>Median</th>
          <th>Middle half</th>
          <th className="num">Applications</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{r.label}</td>
            <td>{r.spread.median === null ? "Not enough yet" : days(r.spread.median)}</td>
            <td>{middleHalf(r.spread)}</td>
            <td className="num">{r.spread.n}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="stat-pair">
      <ChartFrame title="How fast companies reply" keys={rows.map((r) => r.key)} table={table}>
        {(bind) => (
          <svg className="chart speed-chart" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={summary(rows)}>
            <g aria-hidden="true" className="axis">
              {[0, max].map((v) => (
                <line key={v} className="gridline" x1={x(v)} x2={x(v)} y1={GRID_TOP} y2={GRID_BOTTOM} />
              ))}
              <text x={x(0)} y={H - 4} textAnchor="start">0</text>
              <text x={x(max)} y={H - 4} textAnchor="end">{`${max} days`}</text>
            </g>
            {rows.map((r, i) => {
              const s = r.spread;
              const top = TOP + i * PITCH;
              const cy = top + 32;
              return (
                <g key={r.key}>
                  <text className="row-label" x={X0} y={top + 14} aria-hidden="true">{r.label}</text>
                  <text className="row-text" x={X1} y={top + 14} textAnchor="end" aria-hidden="true">{medianText(s)}</text>
                  {s.median !== null && s.p25 !== null && s.p75 !== null ? (
                    <g aria-hidden="true">
                      {s.p25 !== s.p75 ? <rect className="range" x={x(s.p25)} y={cy - 3} width={x(s.p75) - x(s.p25)} height={6} rx={3} /> : null}
                      <circle className="median" cx={x(s.median)} cy={cy} r={5} />
                    </g>
                  ) : null}
                  <rect className="mark-hit" x={0} y={top} width={W} height={PITCH} {...bind(r.key, tip(r), markLabel(r))} />
                </g>
              );
            })}
          </svg>
        )}
      </ChartFrame>
      <WaitingNow waiting={waiting} account={account} />
    </div>
  );
}
