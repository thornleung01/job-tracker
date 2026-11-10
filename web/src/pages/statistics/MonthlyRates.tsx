import { useId } from "react";
import { MONTHS } from "../../db/dayText";
import type { MonthRate } from "../../sync/statistics";
import { plural } from "../../sync/text";
import { ChartFrame } from "./ChartFrame";
import "./monthly.css";

// viewBox units. The plot runs from LEFT to RIGHT (the drawn width minus RIGHT_PAD), the 0 to 100 scale from BASE (0%) up to TOP (100%).
// The width follows the card (ChartFrame `size`), so the 12px text is 12px on a phone; W is the width before it is measured.
const W = 480;
const MAX_W = 600;
const LEFT = 40;
const RIGHT_PAD = 8;
const TOP = 10;
const BASE = 150;
const MAX_COLUMN = 28;
const MIN_LABEL_GAP = 34; // the widest label ("Aug", "2026") is about 28 units wide
const COUNT_CHAR = 6.6; // average width of one 12px character, for "12 applied"

const short = (month: string) => MONTHS[Number(month.split("-")[1]) - 1].slice(0, 3);
const yearOf = (month: string) => month.split("-")[0];
const fullName = (month: string) => `${MONTHS[Number(month.split("-")[1]) - 1]} ${yearOf(month)}`;
const shortYear = (month: string) => `${short(month)} ${yearOf(month)}`;

/** The labelled months: every month, or every second or third one when there are many, always ending on the last one. */
function labelled(count: number, slot: number): Set<number> {
  let step = count > 18 ? 3 : count > 12 ? 2 : 1;
  while (step * slot < MIN_LABEL_GAP) step++;
  const out = new Set<number>();
  for (let i = count - 1; i >= 0; i -= step) out.add(i);
  return out;
}

/** The latest month that has stopped settling and has a rate: the figure the chart's takeaway quotes. */
const latestSettled = (months: readonly MonthRate[]) => [...months].reverse().find((m) => !m.settling && m.pct !== null);

function noteText(months: readonly MonthRate[]): string | null {
  const settled = months.filter((m) => !m.settling && m.pct !== null);
  if (settled.length < 2) return null;
  const a = settled[0];
  const b = settled[settled.length - 1];
  const sameName = short(a.month) === short(b.month);
  return `Replies came to ${a.pct}% of applications sent in ${sameName ? shortYear(a.month) : short(a.month)} and ${b.pct}% of those sent in ${sameName ? shortYear(b.month) : short(b.month)}.`;
}

function settlingText(count: number): string {
  return count === 1 ? "The latest month is still coming in." : `The ${count === 2 ? "two" : count} latest months are still coming in.`;
}

function takeaway(months: readonly MonthRate[]): string {
  const parts = [`Reply rate by month sent, from ${shortYear(months[0].month)} to ${shortYear(months[months.length - 1].month)}.`];
  const latest = latestSettled(months);
  if (latest) parts.push(`${latest.pct}% of applications sent in ${short(latest.month)} heard back.`);
  const settling = months.filter((m) => m.settling).length;
  if (settling) parts.push(settlingText(settling));
  return parts.join(" ");
}

function tipContent(m: MonthRate) {
  if (m.pct === null) {
    return (
      <>
        <b>{fullName(m.month)}</b>
        <br />
        No applications
      </>
    );
  }
  return (
    <>
      <b>{fullName(m.month)}</b>
      <br />
      {m.pct}% heard back
      <br />
      <span className="t2">
        {m.heardBack} of {plural(m.applied, "application")}
      </span>
      {m.settling ? (
        <>
          <br />
          <span className="t2">Still coming in. Replies can take weeks.</span>
        </>
      ) : null}
    </>
  );
}

function ariaText(m: MonthRate): string {
  if (m.pct === null) return `${fullName(m.month)}: no applications.`;
  return `${fullName(m.month)}: ${m.pct}% heard back, ${m.heardBack} of ${plural(m.applied, "application")}.${m.settling ? " Still coming in. Replies can take weeks." : ""}`;
}

/** The 45 degree lines of the "still coming in" hatch, in the Heard back colour on a transparent background. */
function Hatch({ id }: { id: string }) {
  return (
    <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line className="hatch-line" x1="0" y1="0" x2="0" y2="6" strokeWidth="2" />
    </pattern>
  );
}

/** A column with a 4px rounded top and a flat foot. */
function columnPath(x: number, w: number, h: number): string {
  const r = Math.min(4, h / 2);
  const y = BASE - h;
  return `M${x},${BASE}V${y + r}a${r},${r} 0 0 1 ${r},${-r}H${x + w - r}a${r},${r} 0 0 1 ${r},${r}V${BASE}Z`;
}

export function MonthlyRates({ months }: { months: readonly MonthRate[] }) {
  const uid = useId().replace(/:/g, "");
  if (months.length === 0) return null;

  const hatchId = `hatch-${uid}`;
  const legendHatchId = `hatch-key-${uid}`;
  const n = months.length;
  const showCounts = n <= 12;
  const H = showCounts ? 202 : 190;
  const y = (pct: number) => BASE - ((BASE - TOP) * pct) / 100;
  const note = noteText(months);
  const anySettling = months.some((m) => m.settling);

  const table = (
    <table>
      <thead>
        <tr>
          <th>Month sent</th>
          <th className="num">Applications</th>
          <th className="num">Heard back</th>
          <th className="num">Rate</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {months.map((m) => (
          <tr key={m.month}>
            <td>{fullName(m.month)}</td>
            <td className="num">{m.applied}</td>
            <td className="num">{m.heardBack}</td>
            <td className="num">{m.pct === null ? "" : `${m.pct}%`}</td>
            <td>{m.settling ? "Still coming in" : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const footer = anySettling ? (
    <p className="monthly-legend">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <defs>
          <Hatch id={legendHatchId} />
        </defs>
        <rect className="col hatched" x="0.5" y="0.5" width="11" height="11" fill={`url(#${legendHatchId})`} />
      </svg>
      <span>Still coming in</span>
    </p>
  ) : undefined;

  return (
    <ChartFrame title="Reply rate by month sent" note={note ?? undefined} keys={months.map((m) => `m:${m.month}`)} table={table} footer={footer} size={{ fallback: W, max: MAX_W }}>
      {(bind, w) => {
        const RIGHT = w - RIGHT_PAD;
        const slot = (RIGHT - LEFT) / n;
        const colW = Math.min(MAX_COLUMN, slot * 0.65);
        const shown = labelled(n, slot);
        // Decided by the column slot width in viewBox units: "12 applied" needs its length times COUNT_CHAR plus a little air,
        // so when the slot is narrower than that only the bare number is written.
        const longestCount = Math.max(...months.map((m) => `${m.applied} applied`.length));
        const fullCounts = slot >= longestCount * COUNT_CHAR + 6;
        let lastLabelYear: string | null = null;
        const labels = months.map((m, i) => {
          if (!shown.has(i)) return null;
          const year = yearOf(m.month);
          const withYear = year !== lastLabelYear;
          lastLabelYear = year;
          return { i, withYear, text: short(m.month), year };
        });
        return (
        <svg className="chart monthly-chart" viewBox={`0 0 ${w} ${H}`} role="group" aria-label={takeaway(months)}>
          <defs>
            <Hatch id={hatchId} />
          </defs>
          <g aria-hidden="true">
            {[0, 50, 100].map((v) => (
              <g key={v}>
                <line className="gridline" x1={LEFT} x2={RIGHT} y1={y(v)} y2={y(v)} />
                <text className="axis" x={LEFT - 6} y={y(v)} textAnchor="end" dominantBaseline="middle">
                  {v}%
                </text>
              </g>
            ))}
          </g>
          {months.map((m, i) => {
            if (m.pct === null) return null;
            const h = m.pct === 0 ? 2 : ((BASE - TOP) * m.pct) / 100;
            const x = LEFT + i * slot + (slot - colW) / 2;
            return (
              <path
                key={m.month}
                className={m.settling ? "col hatched" : "col solid"}
                d={columnPath(x, colW, h)}
                fill={m.settling ? `url(#${hatchId})` : undefined}
                data-height={h}
                data-month={m.month}
                aria-hidden="true"
              />
            );
          })}
          <g aria-hidden="true">
            {labels.map((l) =>
              l ? (
                <text key={l.i} className="axis month-label" x={LEFT + (l.i + 0.5) * slot} y={BASE + 18} textAnchor="middle">
                  {l.text}
                  {l.withYear ? (
                    <tspan x={LEFT + (l.i + 0.5) * slot} dy="14">
                      {l.year}
                    </tspan>
                  ) : null}
                </text>
              ) : null,
            )}
            {showCounts
              ? months.map((m, i) => (
                  <text key={m.month} className="axis count-label" x={LEFT + (i + 0.5) * slot} y={BASE + 46} textAnchor="middle">
                    {fullCounts ? `${m.applied} applied` : m.applied}
                  </text>
                ))
              : null}
          </g>
          {months.map((m, i) => (
            <rect
              key={m.month}
              className="mark-hit"
              x={LEFT + i * slot}
              y={TOP}
              width={slot}
              height={H - TOP}
              {...bind(`m:${m.month}`, tipContent(m), ariaText(m))}
            />
          ))}
        </svg>
        );
      }}
    </ChartFrame>
  );
}
