import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { PageProps } from "../../app/pageProps";
import { accountSummaries } from "../../sync/queries";
import { FLOW_PERIODS, PERIODS, loadSettings } from "../../sync/settings";
import { flowSummary, type FlowData } from "../../sync/stats";
import { statistics, type Statistics } from "../../sync/statistics";
import { useQuery } from "../../app/useQuery";
import { ImageUnsupportedError, imageFileName, renderPng } from "./exportPng";
import { layoutSankey } from "./layout";
import { usePhone } from "./usePhone";
import { SankeyChart, flowsFor, tipContent } from "./Sankey";
import { MonthlyRates } from "./MonthlyRates";
import { SpeedRanges } from "./SpeedRanges";
import { StatTiles } from "./StatTiles";
import { WeeklyBars } from "./WeeklyBars";
import "./statistics.css";

const wholeNumber = (v: string | null): number | null => {
  if (v == null || !/^\d+$/.test(v.trim())) return null;
  return Number(v);
};

interface View {
  stats: Statistics;
  accounts: { id: number; address: string }[];
  account: number;
  days: number;
}

function Filters({ view, onApply }: { view: View; onApply(account: number, days: number): void }) {
  const [account, setAccount] = useState(String(view.account));
  const [days, setDays] = useState(String(view.days));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onApply(Number(account) || 0, Number(days) || 0);
  };
  return (
    <form className="row" style={{ marginBottom: "var(--gap)" }} onSubmit={submit}>
      <select name="account" aria-label="Account" value={account} onChange={(e) => setAccount(e.target.value)}>
        <option value="0">All accounts</option>
        {view.accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.address}
          </option>
        ))}
      </select>
      <select name="days" aria-label="Period" value={days} onChange={(e) => setDays(e.target.value)}>
        {PERIODS.map((p) => (
          <option key={p.days} value={p.days}>
            {p.label}
          </option>
        ))}
      </select>
      <button type="submit" className="primary">
        Apply filters
      </button>
    </form>
  );
}

interface Tip {
  key: string;
  x: number;
  y: number;
}

function Results({ view, data }: { view: View; data: FlowData }) {
  const layout = useMemo(() => layoutSankey(data), [data]);
  const summary = flowSummary(data)!;
  const phone = usePhone();
  const phoneRef = useRef(phone);
  useLayoutEffect(() => {
    phoneRef.current = phone;
  });
  const [tip, setTip] = useState<Tip | null>(null);
  const pinned = useRef<string | null>(null);
  const [tableOpen, setTableOpen] = useState(phone); // on a narrow screen the table is the readable version of the chart
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);
  const vizRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    try {
      setCanShare(typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([""], "a.png", { type: "image/png" })] }));
    } catch {
      setCanShare(false);
    }
  }, []);

  // Touch screens have no hover: tapping anywhere outside the chart closes the tooltip.
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (svgRef.current && !svgRef.current.contains(e.target as Node)) {
        pinned.current = null;
        setTip(null);
      }
    };
    document.addEventListener("click", away);
    return () => document.removeEventListener("click", away);
  }, []);

  const handlers = useMemo(
    () => ({
      onPoint: (key: string, x: number, y: number) => {
        if (!phoneRef.current) setTip({ key, x, y });
      },
      onLeave: () => {
        if (!phoneRef.current) setTip(null);
      },
      onFocusKey: (key: string, x: number, y: number) => setTip({ key, x, y }),
      onBlurKey: () => {
        pinned.current = null;
        setTip(null);
      },
      // On a phone a tap pins the tooltip; tapping the same thing again closes it.
      onPick: (key: string, x: number, y: number) => {
        if (!phoneRef.current) return;
        if (pinned.current === key) {
          pinned.current = null;
          setTip(null);
        } else {
          pinned.current = key;
          setTip({ key, x, y });
        }
      },
    }),
    [],
  );

  useLayoutEffect(() => {
    const el = tipRef.current;
    const box = vizRef.current;
    if (!tip || !el || !box) return;
    const r = box.getBoundingClientRect();
    let left = tip.x - r.left + 14;
    if (left + el.offsetWidth > r.width) left = tip.x - r.left - el.offsetWidth - 14;
    el.style.left = `${Math.max(4, left)}px`;
    el.style.top = `${tip.y - r.top + 14}px`;
  }, [tip]);

  const hl = useMemo(() => (tip ? flowsFor(layout, tip.key) : null), [layout, tip?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const periodLabel = PERIODS.find((p) => p.days === view.days)?.label ?? "";

  const image = () => {
    if (!svgRef.current || !vizRef.current) throw new ImageUnsupportedError("no chart");
    return renderPng({ svg: svgRef.current, viz: vizRef.current, parts: summary.parts, period: periodLabel });
  };
  const run = async (name: string, work: () => Promise<void>) => {
    setBusy(name);
    setStatus("Preparing the image");
    try {
      await work();
    } catch (err) {
      setStatus((err as Error)?.name === "AbortError" ? "" : "Couldn't make the image. Try again.");
    } finally {
      setBusy(null);
    }
  };
  const save = () =>
    run("save", async () => {
      const url = URL.createObjectURL(await image());
      const a = Object.assign(document.createElement("a"), { href: url, download: imageFileName() });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setStatus(`Saved ${imageFileName()}.`);
    });
  const copy = () =>
    run("copy", async () => {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("clipboard");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": image() })]);
      setStatus("Image copied. Paste it into a message or document.");
    });
  const share = () =>
    run("share", async () => {
      const file = new File([await image()], imageFileName(), { type: "image/png" });
      await navigator.share({ files: [file], title: "My job search" });
      setStatus("Shared.");
    });

  return (
    <div className="card viz-root" style={{ position: "relative" }} ref={vizRef}>
      <h2 className="section">Where applications went</h2>
      <p className="lede">
        {summary.parts.map((p, i) => (p.strong ? <strong key={i}>{p.text}</strong> : p.text))}
      </p>
      <div className="share" role="group" aria-label="Share this chart">
        <button type="button" id="share-save" disabled={busy !== null} aria-busy={busy === "save" || undefined} onClick={save}>
          Save as image
        </button>
        <button type="button" id="share-copy" disabled={busy !== null} aria-busy={busy === "copy" || undefined} onClick={copy}>
          Copy image
        </button>
        {canShare ? (
          <button type="button" id="share-native" disabled={busy !== null} aria-busy={busy === "share" || undefined} onClick={share}>
            Share
          </button>
        ) : null}
        <span className="small muted">The image shows totals only. It leaves out company names and email addresses.</span>
      </div>
      <p className="small muted" id="share-status" role="status" style={{ minHeight: "1.5em", margin: "4px 0 12px" }}>
        {status}
      </p>
      <p className="small mobile-only" style={{ color: "var(--ink2)" }}>
        The chart is wide, so swipe sideways to see all of it. The table below has the same numbers.
      </p>
      <div className="scroll">
        <SankeyChart ref={svgRef} layout={layout} hl={hl} {...handlers} />
      </div>
      <div ref={tipRef} id="tip" className="tip" hidden={!tip}>
        {tip ? tipContent(layout, tip.key) : null}
      </div>

      <details style={{ marginTop: 12 }} open={tableOpen} onToggle={(e) => setTableOpen(e.currentTarget.open)}>
        <summary className="disclosure">
          <span className="chev" aria-hidden="true"></span>Table view
        </summary>
        <table style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Stage</th>
              <th className="num">Applications</th>
              <th className="num">Share</th>
            </tr>
          </thead>
          <tbody>
            {data.nodes.map((n) => (
              <tr key={n.id}>
                <td>{n.id}</td>
                <td className="num">{n.value}</td>
                <td className="num">{n.pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th className="num">Applications</th>
              <th className="num">Share</th>
            </tr>
          </thead>
          <tbody>
            {data.links.map((l) => (
              <tr key={`${l.source}>${l.target}`}>
                <td>{l.source}</td>
                <td>{l.target}</td>
                <td className="num">{l.value}</td>
                <td className="num">{l.pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export default function StatisticsPage({ db, query, navigate }: PageProps) {
  const accountParam = wholeNumber(query.get("account")) ?? 0;
  const daysRaw = wholeNumber(query.get("days"));
  const daysParam = daysRaw !== null && (FLOW_PERIODS as readonly number[]).includes(daysRaw) ? daysRaw : null;

  const view = useQuery<View>(async () => {
    const [settings, accounts] = await Promise.all([loadSettings(db), accountSummaries(db)]);
    const days = daysParam ?? settings.appearance.flowDays; // the period in Settings is the default
    const stats = await statistics(db, { account: accountParam, days });
    return { stats, accounts: accounts.map((a) => ({ id: a.id, address: a.address })), account: accountParam, days };
  }, [db, accountParam, daysParam], { keepPrevious: true });

  const apply = (account: number, days: number) => navigate(`/statistics?account=${account}&days=${days}`);

  return (
    <>
      <h1 className="page">Statistics</h1>
      {view ? (
        <>
          <Filters key={`${view.account}-${view.days}`} view={view} onApply={apply} />
          {view.stats.flow.total ? (
            <>
              <StatTiles flow={view.stats.flow} speed={view.stats.speed} pace={view.stats.pace} />
              {view.stats.pace ? <WeeklyBars pace={view.stats.pace} /> : null}
              <SpeedRanges speed={view.stats.speed} waiting={view.stats.waiting} account={view.account} />
              <Results view={view} data={view.stats.flow} />
              <MonthlyRates months={view.stats.monthly} />
            </>
          ) : (
            <div className="card viz-root">
              <p className="muted" style={{ margin: "8px 0" }}>
                No applications to chart{view.account || view.days ? " for this filter" : ""}. Sync your mailbox or add an application on the Applications page.
              </p>
            </div>
          )}
        </>
      ) : null}
    </>
  );
}
