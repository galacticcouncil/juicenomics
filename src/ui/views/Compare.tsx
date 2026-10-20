import type { ClosedResult } from "../../engine/model/closedForm";
import { PARAMS, getPath } from "../../engine/params/schema";
import type { Params } from "../../engine/params/types";
import { Waterfall } from "../charts/Svg";
import { fmtBps, fmtDays, fmtNum, fmtPct, fmtUsd, fmtX, toDisplay, unitLabel } from "../fmt";

const ROWS: { label: string; of: (r: ClosedResult) => number; fmt: (v: number) => string; better: "high" | "low" }[] = [
  { label: "jETH net APR", of: (r) => r.vaults.eth.net, fmt: (v) => fmtPct(v), better: "high" },
  { label: "jBTC net APR", of: (r) => r.vaults.btc.net, fmt: (v) => fmtPct(v), better: "high" },
  { label: "jETH first year", of: (r) => r.vaults.eth.year1, fmt: (v) => fmtPct(v), better: "high" },
  { label: "jBTC first year", of: (r) => r.vaults.btc.year1, fmt: (v) => fmtPct(v), better: "high" },
  { label: "entry break-even (days)", of: (r) => r.breakEven.entryDays, fmt: fmtDays, better: "low" },
  { label: "round-trip break-even (days)", of: (r) => r.breakEven.roundTripDays, fmt: fmtDays, better: "low" },
  { label: "leverage", of: (r) => r.lev.L, fmt: (v) => fmtX(v), better: "high" },
  { label: "PRIME drop to liquidation", of: (r) => r.lev.liqDrop, fmt: (v) => fmtPct(v, 1), better: "high" },
  { label: "entry cost", of: (r) => r.costs.entryBps, fmt: (v) => fmtBps(v), better: "low" },
  { label: "rebalance churn jETH", of: (r) => r.vaults.eth.churn, fmt: (v) => fmtPct(v), better: "low" },
  { label: "rebalance churn jBTC", of: (r) => r.vaults.btc.churn, fmt: (v) => fmtPct(v), better: "low" },
  { label: "deficit when ramped", of: (r) => r.deficit.structuralBps, fmt: (v) => fmtBps(v, 0), better: "low" },
  { label: "protocol revenue / yr", of: (r) => r.protocol.total, fmt: (v) => fmtUsd(v), better: "high" },
  { label: "… in collateral", of: (r) => r.protocol.collateralFee, fmt: (v) => fmtUsd(v), better: "high" },
  { label: "… as HOLLAR interest", of: (r) => r.protocol.hollarInterest, fmt: (v) => fmtUsd(v), better: "high" },
  { label: "depositors earn / yr", of: (r) => r.totals.userNet, fmt: (v) => fmtUsd(v), better: "high" },
  { label: "outside arb take / yr", of: (r) => r.external.arbGross, fmt: (v) => fmtUsd(v), better: "low" },
];

export function Compare({ A, B, rA, rB, onMakeB }: { A: Params; B: Params | null; rA: ClosedResult; rB: ClosedResult | null; onMakeB: () => void }) {
  if (!B || !rB) {
    return (
      <div className="card">
        <p>Compare needs a second scenario. Scenario B starts as a copy of A; switch between them with the A / B toggle and change B.</p>
        <button className="primary" onClick={onMakeB}>create scenario B from A</button>
      </div>
    );
  }
  const diffs = PARAMS.filter((d) => {
    const a = getPath(A, d.path);
    const b = getPath(B, d.path);
    return typeof a === "number" && typeof b === "number" ? Math.abs(a - b) > 1e-12 * Math.max(1, Math.abs(a)) : a !== b;
  });
  const show = (d: (typeof PARAMS)[number], v: unknown) => (typeof v === "number" ? `${fmtNum(toDisplay(d.unit, v), 6)}${unitLabel(d.unit)}` : String(v));
  return (
    <>
      <div className="cards">
        <div className="card">
          <h2>Results</h2>
          <table className="grid">
            <thead><tr><th>metric</th><th className="num">A</th><th className="num">B</th><th className="num">B − A</th></tr></thead>
            <tbody>
              {ROWS.map((row) => {
                const a = row.of(rA);
                const b = row.of(rB);
                const d = b - a;
                const good = row.better === "high" ? d > 0 : d < 0;
                const same = Math.abs(d) < 1e-9 * Math.max(1, Math.abs(a));
                return (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td className="num">{row.fmt(a)}</td>
                    <td className="num">{row.fmt(b)}</td>
                    <td className="num" style={{ color: same ? undefined : good ? "var(--good)" : "var(--critical)" }}>
                      {same ? "=" : `${good ? "▲" : "▼"} ${Number.isFinite(d) ? row.fmt(Math.abs(d)) : "—"}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Settings that differ ({diffs.length})</h2>
          <table className="grid">
            <thead><tr><th>setting</th><th className="num">A</th><th className="num">B</th></tr></thead>
            <tbody>
              {diffs.map((d) => (
                <tr key={d.path}><td>{d.label}</td><td className="num">{show(d, getPath(A, d.path))}</td><td className="num">{show(d, getPath(B, d.path))}</td></tr>
              ))}
              {!diffs.length && <tr><td colSpan={3} className="muted">identical so far: switch to B and change something</td></tr>}
            </tbody>
          </table>
        </div>
        {(["eth", "btc"] as const).map((k) => (
          <div className="card" key={k}>
            <h2>{rA.vaults[k].name}: A vs B</h2>
            <h3>A</h3>
            <Waterfall steps={rA.vaults[k].waterfall} height={180} color="var(--series-1)" />
            <h3>B</h3>
            <Waterfall steps={rB.vaults[k].waterfall} height={180} color="var(--series-2)" />
          </div>
        ))}
      </div>
    </>
  );
}
