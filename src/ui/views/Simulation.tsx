import { useMemo } from "react";
import type { Params } from "../../engine/params/types";
import { stat, type McRun } from "../../engine/sim/aggregate";
import type { PathSummary } from "../../engine/sim/mc";
import { Chart, type Series } from "../charts/UPlot";
import { fmtBps, fmtNum, fmtPct, fmtUsd } from "../fmt";
import { Tile } from "./Overview";

const ALPHA = (c: string, a: number) => `color-mix(in srgb, ${c} ${Math.round(a * 100)}%, transparent)`;

function Fan({ run, keys, labels, colors, fmt, title, hLines, scale = 1, height = 220 }: {
  run: McRun; keys: string[]; labels: string[]; colors: string[]; fmt: (v: number) => string; title: string;
  hLines?: { y: number; color: string; label: string }[]; scale?: number; height?: number;
}) {
  const { data, series, bands } = useMemo(() => {
    const days = Array.from({ length: run.days }, (_, i) => i + 1);
    const cols: (number | null)[][] = [days];
    const series: Series[] = [];
    const bands: { upper: number; lower: number; fill: string }[] = [];
    keys.forEach((k, i) => {
      const q = run.bands[k];
      const base = cols.length;
      cols.push(Array.from(q[4], (v) => v * scale), Array.from(q[0], (v) => v * scale), Array.from(q[2], (v) => v * scale));
      series.push(
        { label: `${labels[i]} p95`, color: ALPHA(colors[i], 0.35), width: 1, value: fmt },
        { label: `${labels[i]} p5`, color: ALPHA(colors[i], 0.35), width: 1, value: fmt },
        { label: `${labels[i]} median`, color: colors[i], width: 2, value: fmt },
      );
      bands.push({ upper: base, lower: base + 1, fill: ALPHA(colors[i], 0.14) });
    });
    return { data: cols, series, bands };
  }, [run, keys, labels, colors, fmt, scale]);
  return (
    <div className="card">
      <h2>{title}</h2>
      <Chart data={data} series={series} bands={bands} xLabel="day" xFmt={(v) => `${Math.round(v)}`} yFmt={fmt} hLines={hLines} height={height} />
    </div>
  );
}

function Line({ run, keys, labels, colors, fmt, title, height = 200 }: { run: McRun; keys: string[]; labels: string[]; colors: string[]; fmt: (v: number) => string; title: string; height?: number }) {
  const { data, series } = useMemo(() => {
    const days = Array.from({ length: run.days }, (_, i) => i + 1);
    return {
      data: [days, ...keys.map((k) => Array.from(run.median[k]))],
      series: keys.map((_, i) => ({ label: labels[i], color: colors[i], value: fmt })),
    };
  }, [run, keys, labels, colors, fmt]);
  return (
    <div className="card">
      <h2>{title} <span className="muted small">median path</span></h2>
      <Chart data={data} series={series} xLabel="day" xFmt={(v) => `${Math.round(v)}`} yFmt={fmt} height={height} />
    </div>
  );
}

function Histogram({ values, color, label }: { values: number[]; color: string; label: string }) {
  const bins = 24;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const w = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++;
  const max = Math.max(...counts);
  const W = 560;
  const H = 150;
  const bw = W / bins;
  return (
    <div className="svgwrap">
      <svg viewBox={`0 0 ${W} ${H + 22}`} width="100%" role="img" aria-label={label}>
        {counts.map((c, i) => (
          <rect key={i} x={i * bw + 1} y={H - (c / max) * (H - 8)} width={bw - 2} height={(c / max) * (H - 8)} rx={2} fill={color}>
            <title>{`${fmtPct(lo + i * w)} … ${fmtPct(lo + (i + 1) * w)}: ${c} paths`}</title>
          </rect>
        ))}
        <text x={0} y={H + 16}>{fmtPct(lo)}</text>
        <text x={W} y={H + 16} textAnchor="end">{fmtPct(hi)}</text>
        <text x={W / 2} y={H + 16} textAnchor="middle">{label}</text>
      </svg>
    </div>
  );
}

const range = (xs: number[], f: (v: number) => string) => {
  const s = stat(xs);
  return { value: f(s.p50), sub: `p5 ${f(s.p5)} · p95 ${f(s.p95)}` };
};

function Cohorts({ summaries, days }: { summaries: PathSummary[]; days: number }) {
  const rows = useMemo(() => {
    const out: { vault: string; bucket: string; n: number; usd: number; apr: number }[] = [];
    for (const vault of ["eth", "btc"] as const) {
      const all = summaries.flatMap((s) => s.cohorts.filter((c) => c.vault === vault));
      const buckets = new Map<number, { aprs: number[]; usd: number }>();
      const size = Math.max(7, Math.round(days / 8));
      for (const c of all) {
        const b = c.day === 0 ? -1 : Math.floor(c.day / size);
        const x = buckets.get(b) ?? { aprs: [], usd: 0 };
        x.aprs.push(c.apr);
        x.usd += c.usd / summaries.length;
        buckets.set(b, x);
      }
      for (const [b, x] of [...buckets.entries()].sort((a, c) => a[0] - c[0])) {
        out.push({ vault: vault === "eth" ? "jETH" : "jBTC", bucket: b < 0 ? "start (Lark 4 holders)" : `days ${b * size}–${(b + 1) * size}`, n: x.aprs.length, usd: x.usd, apr: stat(x.aprs).p50 });
      }
    }
    return out;
  }, [summaries, days]);
  return (
    <table className="grid">
      <thead><tr><th>vault</th><th>joined</th><th className="num">deposited / path</th><th className="num">median APR to the end</th></tr></thead>
      <tbody>
        {rows.map((r, i) => <tr key={i}><td>{r.vault}</td><td>{r.bucket}</td><td className="num">{fmtUsd(r.usd)}</td><td className="num">{fmtPct(r.apr)}</td></tr>)}
      </tbody>
    </table>
  );
}

export function Simulation({ p, mc, onApply }: {
  p: Params;
  mc: { run: McRun | null; ranFor: string | null; progress: number | null; error: string | null; start: (p: Params) => void; workers: number };
  onApply: (p: Params) => void;
}) {
  const { run } = mc;
  const stale = run && mc.ranFor !== JSON.stringify(p);
  const s = run?.summaries ?? [];
  const col = (f: (x: PathSummary) => number) => s.map(f);
  const useCosts = () => {
    const q = structuredClone(p);
    q.costs.mode = "manual";
    q.costs.churnModel = "constant";
    q.costs.entryBps = stat(col((x) => x.entryAvgBps)).mean;
    q.costs.unwindBps = stat(col((x) => x.unwindAvgBps)).mean;
    onApply(q);
  };
  const v = p.vaults;
  return (
    <>
      <div className="controls">
        <button className="primary" disabled={mc.progress != null} onClick={() => mc.start(p)}>
          {mc.progress != null ? "running…" : `run ${p.sim.paths} paths × ${p.sim.horizonDays} days`}
        </button>
        {mc.progress != null && <span className="progress"><div style={{ width: `${Math.round(mc.progress * 100)}%` }} /></span>}
        <span className="small muted">
          {run ? `${run.paths} paths in ${(run.ms / 1000).toFixed(1)} s on ${mc.workers} workers` : `hourly steps, pool 143's stableswap math, an outside arb with finite inventory, keeper rebalances, harvests and deposit stops`}
        </span>
        {stale && <span className="flag warning"><span className="ic">!</span>settings changed since this run</span>}
        {run && <button onClick={useCosts} title="copy the simulated average entry and unwind costs into the closed form">use simulated costs in the closed form</button>}
        {mc.error && <span className="flag critical"><span className="ic">✕</span>{mc.error}</span>}
      </div>
      {!run && <div className="card"><p>Run the Monte Carlo to see paths, fans and per-path distributions. Everything above the fold of the Overview is closed form; this tab replays it hour by hour.</p></div>}
      {run && (
        <>
          <div className="tiles">
            <Tile label="jETH APR (in GIGAETH)" {...range(col((x) => x.aprEth), (x) => fmtPct(x))} />
            <Tile label="jBTC APR (in tBTC)" {...range(col((x) => x.aprBtc), (x) => fmtPct(x))} />
            <Tile label="Protocol revenue / yr" {...range(col((x) => x.protocol), (x) => fmtUsd(x))} />
            <Tile label="Worst loop deficit" {...range(col((x) => x.maxLoopDeficitBps), (x) => fmtBps(x, 0))} />
            <Tile label="Deposits stopped" {...range(col((x) => Math.max(x.stopHoursEth, x.stopHoursBtc)), (x) => `${fmtNum(x, 0)} h`)} />
            <Tile label="Entries stalled" {...range(col((x) => x.stallHours), (x) => `${fmtNum(x, 0)} h`)} />
            <Tile label="Arb out of PRIME" {...range(col((x) => x.arbDryHours), (x) => `${fmtNum(x, 0)} h`)} />
            <Tile label="Avg entry · unwind cost" value={`${stat(col((x) => x.entryAvgBps)).mean.toFixed(1)} · ${stat(col((x) => x.unwindAvgBps)).mean.toFixed(1)}`} sub="bps vs oracle, volume-weighted" />
          </div>
          <div className="cards">
            <Fan run={run} title="Value per vault share, in collateral (start = 1)" keys={["navEth", "navBtc"]} labels={["jETH", "jBTC"]} colors={["var(--series-1)", "var(--series-2)"]} fmt={(x) => x.toFixed(4)} />
            <Fan run={run} title="Deficit vs principal" keys={["loopDeficit", "defBtc"]} labels={["loop", "jBTC vault"]} colors={["var(--series-3)", "var(--series-2)"]} fmt={(x) => `${x.toFixed(0)} bps`}
              hLines={p.policy.stopBps === p.policy.admissionBps
                ? [{ y: p.policy.stopBps, color: "var(--critical)", label: `keeper stop & admission cap ${p.policy.stopBps} bps` }]
                : [{ y: p.policy.stopBps, color: "var(--critical)", label: `keeper stop ${p.policy.stopBps}` }, { y: p.policy.admissionBps, color: "var(--warning)", label: `admission ${p.policy.admissionBps}` }]} />
            <Fan run={run} title="Vault LTV" keys={["ltvEth", "ltvBtc"]} labels={["jETH", "jBTC"]} colors={["var(--series-1)", "var(--series-2)"]} fmt={(x) => fmtPct(x, 1)}
              hLines={[{ y: v.btc.bandLo, color: "var(--neutral)", label: "relever" }, { y: v.btc.bandTarget, color: "var(--text-muted)", label: "target" }, { y: v.btc.bandHi, color: "var(--neutral)", label: "delever" }]} />
            <Fan run={run} title="Collateral price (start = 1)" keys={["priceEth", "priceBtc"]} labels={["GIGAETH", "tBTC"]} colors={["var(--series-1)", "var(--series-2)"]} fmt={(x) => x.toFixed(2)} />
            <Line run={run} title="Pool 143 premium for selling PRIME" keys={["premium"]} labels={["edge after fee"]} colors={["var(--series-7)"]} fmt={(x) => `${x.toFixed(1)} bps`} />
            <Line run={run} title="Outside arb's PRIME inventory" keys={["arbPrime"]} labels={["PRIME"]} colors={["var(--series-4)"]} fmt={(x) => fmtNum(x, 0)} />
            <Fan run={run} title="Cumulative protocol revenue" keys={["protocolCum"]} labels={["protocol"]} colors={["var(--series-3)"]} fmt={(x) => fmtUsd(x)} />
            <Fan run={run} title="Cumulative trading costs" keys={["costCum"]} labels={["entries + unwinds + harvest swaps"]} colors={["var(--series-8)"]} fmt={(x) => fmtUsd(x)} />
            <div className="card">
              <h2>APR distribution across paths</h2>
              <Histogram values={col((x) => x.aprEth)} color="var(--series-1)" label="jETH" />
              <Histogram values={col((x) => x.aprBtc)} color="var(--series-2)" label="jBTC" />
            </div>
            <div className="card">
              <h2>Money flows <span className="muted small">mean per year</span></h2>
              <table className="grid">
                <tbody>
                  {([
                    ["HOLLAR interest (protocol)", (x: PathSummary) => x.hollarInterest],
                    ["fee in collateral (protocol)", (x: PathSummary) => x.collateralFee],
                    ["pool 143 LP fees (treasury)", (x: PathSummary) => x.lpFees],
                    ["deposit fees (protocol)", (x: PathSummary) => x.depositFees],
                    ["treasury desk P&L vs oracle", (x: PathSummary) => x.deskPnl],
                    ["PRIME incentives paid", (x: PathSummary) => -x.incentiveCost],
                    ["depositors' harvested yield", (x: PathSummary) => x.userEarnedUsd],
                    ["entry costs", (x: PathSummary) => -x.entryCost],
                    ["unwind costs", (x: PathSummary) => -x.unwindCost],
                    ["harvest & interest-service swaps", (x: PathSummary) => -x.harvestCost],
                    ["ICE solver", (x: PathSummary) => -x.solver],
                    ["outside arb, gross vs oracle", (x: PathSummary) => x.arbGross],
                    ["… its HOLLAR exit + bridging", (x: PathSummary) => -x.arbOtherLeg],
                    ["entry volume", (x: PathSummary) => x.entryVolume],
                    ["unwind volume", (x: PathSummary) => x.unwindVolume],
                  ] as const).map(([label, f]) => (
                    <tr key={label}><td>{label}</td><td className="num">{fmtUsd(stat(col(f)).mean)}</td></tr>
                  ))}
                  <tr><td>rebalances / yr, jETH (relever · delever)</td><td className="num">{stat(col((x) => x.releversEth)).mean.toFixed(0)} · {stat(col((x) => x.deleversEth)).mean.toFixed(0)}</td></tr>
                  <tr><td>rebalances / yr, jBTC (relever · delever)</td><td className="num">{stat(col((x) => x.releversBtc)).mean.toFixed(0)} · {stat(col((x) => x.deleversBtc)).mean.toFixed(0)}</td></tr>
                  <tr><td>deposited · blocked · withdrawn</td><td className="num">{fmtUsd(stat(col((x) => x.depositedUsd)).mean)} · {fmtUsd(stat(col((x) => x.blockedUsd)).mean)} · {fmtUsd(stat(col((x) => x.withdrawnUsd)).mean)}</td></tr>
                  <tr><td>lowest loop HF</td><td className="num">{stat(col((x) => x.minHf)).p5.toFixed(3)} (p5)</td></tr>
                </tbody>
              </table>
            </div>
            <div className="card" style={{ gridColumn: "1 / -1" }}>
              <h2>Who earned what, by when they joined</h2>
              <p className="small muted">Annualized return to the horizon end, in collateral, net of every cost each group bore. Under pooled costs, early holders pay for later entries; switch attribution to compare.</p>
              <Cohorts summaries={s} days={run.days} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
