import { roundHalfEven } from "../../db/time";
import { plural } from "../../sync/text";
import type { FlowData } from "../../sync/stats";
import type { Pace, Speed } from "../../sync/statistics";

interface Tile {
  label: string;
  value: string;
  sub?: string;
}

/** The four headline numbers, worked out the same way as the funnel and the charts below them, so they always agree. */
export function tilesFor(flow: FlowData, speed: Speed, pace: Pace | null): Tile[] {
  const share = (n: number) => `${roundHalfEven((100 * n) / flow.total)}%`;
  const reply = speed.reply;
  return [
    { label: "Applications", value: String(flow.total), sub: pace ? `${pace.perWeek} a week` : undefined },
    { label: "Heard back", value: share(flow.heardBack), sub: `${flow.heardBack} of ${flow.total}` },
    { label: "Interviewed", value: share(flow.interviews), sub: `${flow.interviews} of ${flow.total}` },
    reply.median === null
      ? { label: "Time to first reply", value: "Not enough yet" }
      : { label: "Time to first reply", value: plural(reply.median, "day"), sub: `median, from ${plural(reply.n, "application")}` },
  ];
}

/** A row of numbers at the top of the page: no chart, no chrome. Render it only when there are applications. */
export function StatTiles({ flow, speed, pace }: { flow: FlowData; speed: Speed; pace: Pace | null }) {
  return (
    <section className="card viz-root" aria-label="Summary">
      <dl className="tiles">
        {tilesFor(flow, speed, pace).map((t) => (
          <div key={t.label} className={t.value === "Not enough yet" ? "tile quiet" : "tile"}>
            <dt>{t.label}</dt>
            <dd>
              <span className="tile-value">{t.value}</span>
              {t.sub ? <span className="tile-sub">{t.sub}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
