import { useId } from "react";
import { dayText } from "../../db/dayText";
import { plural } from "../../sync/text";
import { paceNote, type Pace, type WeekCount } from "../../sync/statistics";
import { ChartFrame } from "./ChartFrame";
import "./pace.css";

/** Pace chart geometry, in viewBox units (the svg scales to the card). */
export const W = 480;
export const H = 200;
const GUTTER = 54; // room for the "0", the max and "Goal 5" labels
const TOP = 20;
const BASE = 172; // the baseline: the x labels sit under it
const PLOT_H = BASE - TOP;
const RADIUS = 4; // rounded data end
const MAX_BAR = 28;
const LABEL_Y = H - 8;
const CHAR_W = 6.6; // estimated width of one 12px character, for label collisions
const LABEL_GAP = 6;
const NOW_LABEL = "This week";

const dayLabel = (day: string, year: boolean) => (year ? `${dayText(day, "plain")}, ${day.slice(0, 4)}` : dayText(day, "plain"));
/** Every Nth week gets a date: more weeks, wider steps. */
export const labelStep = (weeks: number) => (weeks <= 6 ? 1 : weeks <= 13 ? 2 : weeks <= 26 ? 4 : 8);
const spansYears = (weeks: readonly WeekCount[]) => weeks.length > 0 && weeks[0].start.slice(0, 4) !== weeks[weeks.length - 1].end.slice(0, 4);

interface XLabel {
  text: string;
  x: number;
  anchor: "middle" | "end";
  now: boolean;
}

const spanOf = (l: XLabel): [number, number] => {
  const w = l.text.length * CHAR_W;
  return l.anchor === "end" ? [l.x - w, l.x] : [l.x - w / 2, l.x + w / 2];
};

function xLabels(weeks: readonly WeekCount[], slot: number, year: boolean): XLabel[] {
  const last = weeks.length - 1;
  const at = (i: number): XLabel => {
    const isLast = i === last;
    const now = weeks[i].current;
    return {
      text: now ? NOW_LABEL : dayLabel(weeks[i].start, year),
      x: isLast ? W : GUTTER + slot * i + slot / 2,
      anchor: now || isLast ? "end" : "middle",
      now,
    };
  };
  const step = labelStep(weeks.length);
  const order: number[] = [];
  weeks.forEach((w, i) => w.current && order.push(i)); // "This week" replaces its date
  order.push(0, last);
  for (let i = step; i < last; i += step) order.push(i);
  const kept: { i: number; l: XLabel }[] = [];
  for (const i of order) {
    if (kept.some((k) => k.i === i)) continue;
    const l = at(i);
    const [a, b] = spanOf(l);
    if (kept.every((k) => { const [c, d] = spanOf(k.l); return b + LABEL_GAP <= c || d + LABEL_GAP <= a; })) kept.push({ i, l });
  }
  return kept.sort((p, q) => p.i - q.i).map((k) => k.l);
}

const weekTitle = (w: WeekCount, year: boolean) => `Week of ${dayLabel(w.start, year)}`;
const goalText = (count: number, goal: number) => (count >= goal ? "met" : `${goal - count} short`);

export function WeeklyBars({ pace }: { pace: Pace }) {
  const clip = `pace-clip-${useId().replace(/:/g, "")}`;
  const { weeks, goal } = pace;
  const year = spansYears(weeks);
  const max = Math.max(1, goal ?? 0, ...weeks.map((w) => w.count));
  const yOf = (v: number) => BASE - (v / max) * PLOT_H;
  const slot = (W - GUTTER) / weeks.length;
  const barW = Math.min(MAX_BAR, Math.max(2, Math.min(slot * 0.65, slot - 2)));
  const now = weeks.find((w) => w.current);

  const takeaway = [
    `Applications per week over the last ${weeks.length === 1 ? "week" : `${weeks.length} weeks`}.`,
    [now ? `This week ${now.count}` : null, `average ${pace.perWeek} a week`, pace.best ? `best week ${pace.best.count}` : null, goal !== null ? `goal ${goal}` : null]
      .filter((p): p is string => p !== null)
      .join(", ")
      .replace(/^./, (c) => c.toUpperCase()) + ".",
  ].join(" ");

  // Gutter labels: "0", the max, and the goal. Never closer than a text line.
  const goalY = goal === null ? null : yOf(goal);
  const goalLabelY = goalY === null ? null : Math.min(goalY, BASE - 14) + 4;
  const showMax = goal === null || (goal !== max && Math.abs(yOf(goal) - TOP) >= 14);
  const showMaxLine = goal === null || goal !== max;

  const rows = weeks.map((w) => {
    const text = plural(w.count, "application");
    const g = goal === null ? null : goalText(w.count, goal);
    return {
      w,
      key: `w:${w.start}`,
      tip: (
        <>
          <b>{weekTitle(w, year)}</b>
          <br />
          {text}
          {g ? (
            <>
              <br />
              <span className="t2">{`Goal ${goal}, ${g}`}</span>
            </>
          ) : null}
        </>
      ),
      label: `${weekTitle(w, year)}: ${text}${goal === null ? "" : w.count >= goal ? ", goal met" : `, ${goal - w.count} short of the goal`}.`,
    };
  });

  const table = (
    <table>
      <thead>
        <tr>
          <th>Week of</th>
          <th className="num">Applications</th>
          {goal !== null ? <th>Goal met</th> : null}
        </tr>
      </thead>
      <tbody>
        {weeks.map((w) => (
          <tr key={w.start}>
            <td>{dayLabel(w.start, year)}</td>
            <td className="num">{w.count}</td>
            {goal !== null ? <td>{w.count >= goal ? "Yes" : "No"}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartFrame title="Pace" note={paceNote(pace) ?? undefined} keys={rows.map((r) => r.key)} table={table}>
      {(bind) => (
        <svg className="chart pace-chart" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={takeaway}>
          <defs>
            <clipPath id={clip}>
              <rect x={GUTTER} y={0} width={W - GUTTER} height={BASE} />
            </clipPath>
          </defs>
          <g className="axis" aria-hidden="true">
            {showMaxLine ? <line className="gridline" x1={GUTTER} x2={W} y1={yOf(max)} y2={yOf(max)} /> : null}
            <line className="gridline" x1={GUTTER} x2={W} y1={BASE} y2={BASE} />
            <text className="y-label" x={GUTTER - 8} y={BASE + 4} textAnchor="end">0</text>
            {showMax ? <text className="y-label" x={GUTTER - 8} y={yOf(max) + 4} textAnchor="end">{max}</text> : null}
            {xLabels(weeks, slot, year).map((l) => (
              <text key={l.text + l.x} className={l.now ? "x-label now-label" : "x-label"} x={l.x} y={LABEL_Y} textAnchor={l.anchor}>{l.text}</text>
            ))}
          </g>
          <g clipPath={`url(#${clip})`} aria-hidden="true">
            {weeks.map((w, i) => {
              if (!w.count) return null;
              const h = Math.max(2, (w.count / max) * PLOT_H);
              // The rect runs RADIUS below the baseline and is clipped there, so only the top end is rounded.
              return (
                <rect
                  key={w.start}
                  className={w.current ? "pace-bar now" : "pace-bar"}
                  data-count={w.count}
                  x={GUTTER + slot * i + (slot - barW) / 2}
                  y={BASE - h}
                  width={barW}
                  height={h + RADIUS}
                  rx={Math.min(RADIUS, barW / 2)}
                />
              );
            })}
          </g>
          {goal !== null && goalY !== null && goalLabelY !== null ? (
            <g aria-hidden="true">
              <line className="goal-line" x1={GUTTER} x2={W} y1={goalY} y2={goalY} />
              <text className="goal-label" x={GUTTER - 8} y={goalLabelY} textAnchor="end">{`Goal ${goal}`}</text>
            </g>
          ) : null}
          {rows.map((r, i) => (
            <rect key={r.key} className="mark-hit" x={GUTTER + slot * i} y={TOP - 6} width={slot} height={BASE - TOP + 12} {...bind(r.key, r.tip, r.label)} />
          ))}
        </svg>
      )}
    </ChartFrame>
  );
}
