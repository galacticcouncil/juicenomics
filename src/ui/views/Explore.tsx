import { useMemo, useState } from "react";
import { evaluate } from "../../engine/model/closedForm";
import { KNOB, KNOBS, METRIC, METRICS, feasibleWith, grid, pareto, search, sweep, tornado, withKnob, type Candidate, type Constraints } from "../../engine/opt/explore";
import type { Params } from "../../engine/params/types";
import { Heatmap, Tornado } from "../charts/Svg";
import { Chart } from "../charts/UPlot";
import { fmtDays, fmtKnob, fmtMetric, fmtPct, fmtUsd } from "../fmt";


function KnobSelect({ value, onChange, exclude }: { value: string; onChange: (k: string) => void; exclude?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {KNOBS.filter((k) => k.key !== exclude).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
    </select>
  );
}

function MetricSelect({ value, onChange }: { value: string; onChange: (k: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
    </select>
  );
}

function Sweep({ p, onApply }: { p: Params; onApply: (p: Params) => void }) {
  const [knob, setKnob] = useState("leverage");
  const [metric, setMetric] = useState("worst");
  const k = KNOB.get(knob)!;
  const m = METRIC.get(metric)!;
  const second = useMemo(() => (m.unit === "pct" && m.key !== "protocolPct" ? [m, METRIC.get("protocolPct")!] : [m]), [m]);
  const data = useMemo(() => sweep(p, k, 60, second), [p, k, second]);
  const cur = k.get(p);
  const fmtY = (v: number) => (m.unit === "pct" ? fmtPct(v, 1) : fmtMetric(m)(v));
  return (
    <div className="card">
      <h2>Sweep one setting</h2>
      <div className="controls">
        <label>move <KnobSelect value={knob} onChange={setKnob} /></label>
        <label>watch <MetricSelect value={metric} onChange={setMetric} /></label>
        <span className="muted small">current {fmtKnob(k)(cur)}</span>
      </div>
      <Chart
        height={260}
        data={[data.xs, ...data.ys]}
        xLabel={k.label}
        xFmt={fmtKnob(k)}
        yFmt={fmtY}
        series={second.map((s, i) => ({ label: s.label, color: i ? "var(--series-2)" : "var(--series-1)", value: fmtMetric(s) }))}
      />
      <div className="controls">
        <span className="small muted">apply a value:</span>
        {[0.1, 0.25, 0.5, 0.75, 0.9].map((f) => {
          const v = k.unit === "bool" ? (f > 0.5 ? 1 : 0) : k.min + f * (k.max - k.min);
          return <button key={f} onClick={() => onApply(withKnob(p, k, v))}>{fmtKnob(k)(v)}</button>;
        })}
      </div>
    </div>
  );
}

const DEFAULT_CONS: Constraints = { minUserApr: 0.03, minProtocolPct: 0.05, maxBreakEvenDays: 120, noStall: true, noClose: true, minLiqDrop: 0.03 };

function HeatmapCard({ p, onApply, cons }: { p: Params; onApply: (p: Params) => void; cons: Constraints }) {
  const [kx, setKx] = useState("leverage");
  const [ky, setKy] = useState("bands.relever");
  const [metric, setMetric] = useState("worst");
  const [useCons, setUseCons] = useState(true);
  const X = KNOB.get(kx)!;
  const Y = KNOB.get(ky)!;
  const m = METRIC.get(metric)!;
  const g = useMemo(() => grid(p, X, Y, 28, m, useCons ? feasibleWith(cons) : () => true), [p, X, Y, m, useCons, cons]);
  return (
    <div className="card">
      <h2>Two settings at once</h2>
      <div className="controls">
        <label>x <KnobSelect value={kx} onChange={setKx} exclude={ky} /></label>
        <label>y <KnobSelect value={ky} onChange={setKy} exclude={kx} /></label>
        <label>colour <MetricSelect value={metric} onChange={setMetric} /></label>
        <label><input type="checkbox" checked={useCons} onChange={(e) => setUseCons(e.target.checked)} /> hatch cells that break the constraints</label>
      </div>
      <Heatmap xs={g.xs} ys={g.ys} z={g.z} xLabel={X.label} yLabel={Y.label} fmt={fmtMetric(m)} fmtX={fmtKnob(X)} fmtY={fmtKnob(Y)}
        current={{ x: X.get(p), y: Y.get(p) }} onPick={(x, y) => onApply(withKnob(withKnob(p, X, x), Y, y))} />
      <p className="small muted">click a cell to apply it</p>
    </div>
  );
}

function TornadoCard({ p }: { p: Params }) {
  const [metric, setMetric] = useState("worst");
  const m = METRIC.get(metric)!;
  const rows = useMemo(() => tornado(p, KNOBS, m).slice(0, 14), [p, m]);
  return (
    <div className="card">
      <h2>What matters most <span className="muted small">each setting moved ±25% (or across its range from zero)</span></h2>
      <div className="controls"><label>metric <MetricSelect value={metric} onChange={setMetric} /></label></div>
      <Tornado base={rows[0]?.base ?? 0} fmt={fmtMetric(m)} rows={rows.map((r) => ({
        label: r.knob.label, lo: r.lo, hi: r.hi, loLabel: fmtKnob(r.knob)(r.loValue), hiLabel: fmtKnob(r.knob)(r.hiValue),
      }))} />
    </div>
  );
}

function Scatter({ cands, front, onPick }: { cands: Candidate[]; front: Candidate[]; onPick: (c: Candidate) => void }) {
  const W = 640;
  const H = 320;
  const pad = { l: 64, r: 12, t: 10, b: 40 };
  const pts = cands.filter((c) => c.feasible);
  if (!pts.length) return <p className="muted">no feasible point: loosen the constraints</p>;
  const xs = pts.map((c) => Math.min(c.result.vaults.eth.net, c.result.vaults.btc.net));
  const ys = pts.map((c) => c.result.protocol.total);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sx = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => H - pad.b - ((v - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b);
  const fr = new Set(front);
  return (
    <div className="svgwrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="scatter">
        {pts.map((c, i) => (
          <circle key={i} cx={sx(xs[i])} cy={sy(ys[i])} r={fr.has(c) ? 5 : 2.5} fill={fr.has(c) ? "var(--series-2)" : "var(--series-1)"} opacity={fr.has(c) ? 1 : 0.35} onClick={() => onPick(c)}>
            <title>{`user APR ${fmtPct(xs[i])}, protocol ${fmtUsd(ys[i])}`}</title>
          </circle>
        ))}
        <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 6} textAnchor="middle">user APR, worse vault: {fmtPct(x0)} … {fmtPct(x1)}</text>
        <text x={14} y={H / 2} textAnchor="middle" transform={`rotate(-90 14 ${H / 2})`}>protocol / yr: {fmtUsd(y0)} … {fmtUsd(y1)}</text>
      </svg>
      <div className="legend"><span><span className="sw" style={{ background: "var(--series-2)" }} />Pareto front (click to apply)</span><span><span className="sw" style={{ background: "var(--series-1)", opacity: 0.4 }} />feasible samples</span></div>
    </div>
  );
}

function FindBest({ p, onApply, cons, setCons }: { p: Params; onApply: (p: Params) => void; cons: Constraints; setCons: (c: Constraints) => void }) {
  const [metric, setMetric] = useState("worst");
  const [onlyAdmin, setOnlyAdmin] = useState(false);
  const [chosen, setChosen] = useState<string[]>(["leverage", "bands.relever", "bands.target", "pool.feeBps", "fees.protocolFeeBps", "fees.discountMain", "fees.discountLoop", "improvements.desk"]);
  // a result keeps the settings it searched, so changing the checkboxes afterwards can't misread it
  const [res, setRes] = useState<{ best: Candidate[]; front: Candidate[]; all: Candidate[]; knobs: typeof KNOBS } | null>(null);
  const [busy, setBusy] = useState(false);
  const knobs = KNOBS.filter((k) => chosen.includes(k.key) && (!onlyAdmin || k.lever === "admin" || k.lever === "ops"));
  const run = () => {
    setBusy(true);
    setTimeout(() => {
      const out = search(p, knobs, METRIC.get(metric)!, cons, 1500);
      setRes({ best: out.best, all: out.all, front: pareto(out.all), knobs });
      setBusy(false);
    }, 20);
  };
  const base = evaluate(p);
  const m = METRIC.get(metric)!;
  const num = (label: string, value: number, set: (v: number) => void, scale = 1, suffix = "") => (
    <label>{label} <input type="number" style={{ width: 70 }} value={Number((value * scale).toPrecision(6))} onChange={(e) => set(Number(e.target.value) / scale)} />{suffix}</label>
  );
  return (
    <div className="card" style={{ gridColumn: "1 / -1" }}>
      <h2>Find the best scenario</h2>
      <div className="controls">
        <label>maximize <MetricSelect value={metric} onChange={setMetric} /></label>
        <label><input type="checkbox" checked={onlyAdmin} onChange={(e) => setOnlyAdmin(e.target.checked)} /> only settings changeable today (no contract change)</label>
      </div>
      <div className="controls">
        <span className="small muted">constraints:</span>
        {num("user APR ≥", cons.minUserApr, (v) => setCons({ ...cons, minUserApr: v }), 100, "%")}
        {num("protocol ≥", cons.minProtocolPct, (v) => setCons({ ...cons, minProtocolPct: v }), 100, "% of TVL")}
        {num("break-even ≤", cons.maxBreakEvenDays, (v) => setCons({ ...cons, maxBreakEvenDays: v }), 1, "d")}
        {num("PRIME drop to liquidation ≥", cons.minLiqDrop, (v) => setCons({ ...cons, minLiqDrop: v }), 100, "%")}
        <label><input type="checkbox" checked={cons.noStall} onChange={(e) => setCons({ ...cons, noStall: e.target.checked })} /> no lane-cap stall</label>
        <label><input type="checkbox" checked={cons.noClose} onChange={(e) => setCons({ ...cons, noClose: e.target.checked })} /> deposits stay open</label>
      </div>
      <div className="controls">
        <span className="small muted">search over:</span>
        {KNOBS.map((k) => (
          <label key={k.key} className="small" title={`${k.lever}: ${fmtKnob(k)(k.min)} … ${fmtKnob(k)(k.max)}`}>
            <input type="checkbox" checked={chosen.includes(k.key)} onChange={(e) => setChosen(e.target.checked ? [...chosen, k.key] : chosen.filter((x) => x !== k.key))} />
            {k.label}{k.lever === "contract" ? " ⚙" : ""}
          </label>
        ))}
      </div>
      <button className="primary" disabled={busy || !knobs.length} onClick={run}>{busy ? "searching…" : `search ${knobs.length} settings`}</button>
      <span className="small muted" style={{ marginLeft: 10 }}>current: {fmtMetric(m)(m.of(base))} · ⚙ needs a contract change</span>
      {res && (
        <>
          <h3>Best found</h3>
          <table className="grid">
            <thead><tr><th>#</th>{res.knobs.map((k) => <th key={k.key} className="num">{k.label}</th>)}<th className="num">jETH</th><th className="num">jBTC</th><th className="num">break-even</th><th className="num">protocol / yr</th><th /></tr></thead>
            <tbody>
              {res.best.map((c, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  {res.knobs.map((k) => <td key={k.key} className="num">{fmtKnob(k)(c.values[k.key])}</td>)}
                  <td className="num">{fmtPct(c.result.vaults.eth.net)}</td>
                  <td className="num">{fmtPct(c.result.vaults.btc.net)}</td>
                  <td className="num">{fmtDays(c.result.breakEven.entryDays)}</td>
                  <td className="num">{fmtUsd(c.result.protocol.total)}</td>
                  <td><button onClick={() => onApply(c.params)}>apply</button></td>
                </tr>
              ))}
              {!res.best.length && <tr><td colSpan={res.knobs.length + 6} className="muted">no feasible scenario under these constraints</td></tr>}
            </tbody>
          </table>
          <h3>Depositors vs protocol trade-off</h3>
          <Scatter cands={res.all} front={res.front} onPick={(c) => onApply(c.params)} />
        </>
      )}
    </div>
  );
}

export function Explore({ p, onApply }: { p: Params; onApply: (p: Params) => void }) {
  const [cons, setCons] = useState<Constraints>(DEFAULT_CONS);
  return (
    <div className="cards">
      <FindBest p={p} onApply={onApply} cons={cons} setCons={setCons} />
      <Sweep p={p} onApply={onApply} />
      <TornadoCard p={p} />
      <HeatmapCard p={p} onApply={onApply} cons={cons} />
    </div>
  );
}
